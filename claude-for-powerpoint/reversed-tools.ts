/**
 * Reversed tool implementations from Claude for PowerPoint Office.js add-in.
 *
 * The add-in uses SES (Secure ECMAScript / Hardened JavaScript) to sandbox
 * LLM-generated code. Code runs in a Compartment with restricted globals.
 * The context object is wrapped in a deep Proxy that tracks all mutations
 * and method calls for permission prompting.
 */

import JSZip from "jszip";

// ============================================================================
// Constants & Namespaces
// ============================================================================

const NS_DRAWING =
  "http://schemas.openxmlformats.org/drawingml/2006/main"; // a:
const NS_PRESENTATION =
  "http://schemas.openxmlformats.org/presentationml/2006/main"; // p:
const NS_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships"; // r:

/** Timeout for tool execution (90 seconds) */
const TOOL_TIMEOUT_MS = 90_000;

/** Timeout for Office.run on OfficeOnline (120 seconds) */
const OFFICE_ONLINE_TIMEOUT_MS = 120_000;

// ============================================================================
// Platform Utilities
// ============================================================================

function getPlatform(): string | undefined {
  if (typeof Office === "undefined") return undefined;
  try {
    return Office.context?.platform;
  } catch {
    return undefined;
  }
}

/**
 * Wraps Office.run to serialize calls on Office Online (which can't handle
 * concurrent Office.run calls) and adds a hard timeout.
 */
let onlineRunQueue = Promise.resolve();

function safeOfficeRun<T>(
  runFn: (callback: (ctx: any) => Promise<T>) => Promise<T>,
  callback: (ctx: any) => Promise<T>
): Promise<T> {
  if (getPlatform() !== "OfficeOnline") {
    return runFn(callback);
  }

  // Serialize: wait for previous run to finish, then race against timeout
  const task = onlineRunQueue.catch(() => {}).then(() =>
    Promise.race([
      runFn(callback),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Office.run timed out after ${OFFICE_ONLINE_TIMEOUT_MS}ms`)),
          OFFICE_ONLINE_TIMEOUT_MS
        )
      ),
    ])
  );
  onlineRunQueue = task.catch(() => {});
  return task;
}

// ============================================================================
// Timeout Guard
// ============================================================================

class TimeoutError extends Error {
  constructor(message = "The operation was timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Creates a timeout guard that tracks elapsed wall-clock time (excluding
 * user-interaction pauses). Used to abort long-running LLM-generated code.
 */
function createTimeoutGuard(timeoutMs: number) {
  let pausedTime = 0;
  let startedAt: number;
  let rejectFn: ((err: Error) => void) | null = null;
  let timerId: ReturnType<typeof setTimeout>;
  let finished = false;

  function check() {
    clearTimeout(timerId);
    if (finished) return;
    const remaining = timeoutMs - (Date.now() - startedAt - pausedTime);
    if (remaining <= 0) {
      rejectFn?.(new TimeoutError());
    } else {
      timerId = setTimeout(check, remaining);
    }
  }

  return {
    /** Run the given async function with a timeout guard. */
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        rejectFn = reject;
        startedAt = Date.now();
        check();

        fn().then(
          (result) => {
            finished = true;
            clearTimeout(timerId);
            resolve(result);
          },
          (err) => {
            finished = true;
            clearTimeout(timerId);
            reject(err);
          }
        );
      });
    },

    /**
     * Exclude time spent in the given async function from the timeout
     * (used for user permission prompts — don't count wait time).
     */
    async exclude<T>(fn: () => Promise<T>): Promise<T> {
      if (finished) return fn();
      clearTimeout(timerId);
      const pauseStart = Date.now();
      try {
        return await fn();
      } finally {
        pausedTime += Date.now() - pauseStart;
        check();
      }
    },
  };
}

// ============================================================================
// XML Utilities
// ============================================================================

/**
 * Escape XML special characters for safe embedding in XML text content.
 * Exposed as a global `escapeXml` inside sandboxed code.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Fix bare & characters in XML that aren't already part of an entity.
 * Applied as a safety net before re-importing OOXML back into PowerPoint.
 */
const BARE_AMPERSAND_RE = /&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g;

function sanitizeXmlAmpersands(xml: string): string {
  return xml.replace(BARE_AMPERSAND_RE, "&amp;");
}

function escapeXmlForAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================================================
// Icon Tools
// ============================================================================

const ICONS_API_BASE = "https://pivot.claude.ai";
const ICON_DEFAULT_SIZE = 72;
const ICON_PNG_SIZE = 192;
const SLIDE_WIDTH_PT = 720;
const SLIDE_HEIGHT_PT = 540;
const EMU_PER_PT = 12700;

const iconCache = new Map<string, string>();

async function registerContentType(
  zip: JSZip,
  extension: string,
  contentType: string
): Promise<void> {
  const path = "[Content_Types].xml";
  const xml = await zip.file(path)?.async("string");
  if (!xml) return;

  const NS = "http://schemas.openxmlformats.org/package/2006/content-types";
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const defaults = doc.getElementsByTagNameNS(NS, "Default");
  for (let i = 0; i < defaults.length; i++) {
    if (defaults[i].getAttribute("Extension") === extension) return;
  }

  const el = doc.createElementNS(NS, "Default");
  el.setAttribute("Extension", extension);
  el.setAttribute("ContentType", contentType);
  doc.documentElement.appendChild(el);
  zip.file(path, new XMLSerializer().serializeToString(doc));
}

function recolorSvg(svg: string, color: string): string {
  const style = `<style>.iconFill{fill:${color};}</style>`;
  let result: string;
  if (/<style[\s\S]*?<\/style>/.test(svg)) {
    result = svg.replace(/<style[\s\S]*?<\/style>/, style);
  } else {
    const idx = svg.indexOf(">", svg.indexOf("<svg"));
    if (idx === -1) return svg;
    result = svg.slice(0, idx + 1) + style + svg.slice(idx + 1);
  }
  return result.replace(
    /<(path|rect|circle|polygon|ellipse)(\s[^>]*)?(\/?)>/g,
    (m, tag, attrs, slash) =>
      attrs && /\bclass=/.test(attrs)
        ? m
        : `<${tag} class="iconFill"${attrs || ""}${slash}>`
  );
}

async function rasterizeSvgToPng(svg: string, width: number, height: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create canvas 2D context for SVG rasterization");

  const img = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load SVG for rasterization"));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png").split(",")[1]!;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// Shape Lookup
// ============================================================================

/**
 * Find a shape by name in a slide's OOXML DOM, with support for duplicate
 * names via the occurrence parameter (0-based).
 */
function findShapeByName(
  doc: Document,
  shapeName: string,
  occurrence: number = 0
): Element | null {
  const shapes = doc.getElementsByTagNameNS(NS_PRESENTATION, "sp");
  let matchIndex = 0;

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const nvSpPr = shape.getElementsByTagNameNS(NS_PRESENTATION, "nvSpPr")[0];
    if (!nvSpPr) continue;

    const cNvPr = nvSpPr.getElementsByTagNameNS(NS_PRESENTATION, "cNvPr")[0];
    if (cNvPr?.getAttribute("name") === shapeName) {
      if (matchIndex === occurrence) return shape;
      matchIndex++;
    }
  }

  return null;
}

// ============================================================================
// External Reference Security
// ============================================================================

/**
 * Extract all external reference URLs from .rels files in the ZIP.
 * Used to block LLM code from adding external references (data exfil prevention).
 */
async function extractExternalReferences(zip: JSZip): Promise<Set<string>> {
  const refs = new Set<string>();
  const relsFiles = Object.keys(zip.files).filter((f) => f.endsWith(".rels"));

  const EXTERNAL_REL_RE = /<Relationship[^>]*TargetMode\s*=\s*["']External["'][^>]*>/gi;
  const TARGET_RE = /Target\s*=\s*["']([^"']*)["']/i;

  for (const relsPath of relsFiles) {
    const content = await zip.file(relsPath)?.async("string");
    if (content) {
      for (const match of content.matchAll(EXTERNAL_REL_RE)) {
        const targetMatch = match[0].match(TARGET_RE);
        if (targetMatch?.[1]) {
          refs.add(targetMatch[1]);
        }
      }
    }
  }

  return refs;
}

// ============================================================================
// Core Slide Export/Import Engine
// ============================================================================

/**
 * The core engine used by edit_slide_xml, edit_slide_chart, edit_slide_master,
 * read_slide_text, and edit_slide_text.
 *
 * 1. Saves the currently selected slides
 * 2. Exports the target slide as a single-slide PPTX (base64 → JSZip)
 * 3. Runs the user/LLM callback with { zip, markDirty }
 * 4. If dirty:
 *    a. Sanitizes bare & in the slide XML
 *    b. Checks no new external references were added (security)
 *    c. Re-imports the modified slide (insertSlidesFromBase64 after the
 *       previous slide, then deletes the original)
 *    d. Restores the original slide selection
 * 5. Returns whatever the callback returned
 *
 * @param context       - PowerPoint.RequestContext from PowerPoint.run()
 * @param slideIndex    - 0-based slide index to export
 * @param callback      - async fn receiving { zip, markDirty }
 * @param permissionFn  - optional permission check callback (for execute_office_js)
 * @param presentationAccessor - optional fn to unwrap proxied presentation (for execute_office_js)
 */
async function withSlideZip<T>(
  context: PowerPoint.RequestContext,
  slideIndex: number,
  callback: (args: { zip: JSZip; markDirty: () => void }) => Promise<T>,
  permissionFn?: (actions: any[]) => Promise<boolean>,
  presentationAccessor: (obj: any) => any = (o) => o
): Promise<T> {
  const slides = context.presentation.slides;
  slides.load("items/id");

  const selectedSlides = context.presentation.getSelectedSlides();
  selectedSlides.load("items/id");
  await context.sync();

  // Validate index
  if (slideIndex < 0 || slideIndex >= slides.items.length) {
    throw new Error(
      `Slide index ${slideIndex} out of range (0-${slides.items.length - 1})`
    );
  }

  // Remember selection (by mapping IDs to indices)
  const idToIndex = new Map(slides.items.map((s, i) => [s.id, i]));
  const selectedIndices = selectedSlides.items
    .map((s) => idToIndex.get(s.id))
    .filter((i) => i !== undefined);

  // The slide to insert AFTER (undefined if inserting at position 0)
  const targetSlideId =
    slideIndex > 0 ? slides.items[slideIndex - 1].id : undefined;

  // Export the target slide as a single-slide PPTX
  const exportResult = slides.getItemAt(slideIndex).exportAsBase64();
  await context.sync();

  const zip = await JSZip.loadAsync(exportResult.value, { base64: true });

  // Snapshot external refs before callback runs
  let dirty = false;
  const refsBefore = await extractExternalReferences(zip);

  // Run the callback
  const result = await callback({
    zip,
    markDirty: () => {
      dirty = true;
    },
  });

  // Re-import if modified
  if (dirty) {
    // Safety: fix bare ampersands in slide XML
    const slideFile = zip.file("ppt/slides/slide1.xml");
    if (slideFile) {
      const slideXml = await slideFile.async("string");
      const sanitized = sanitizeXmlAmpersands(slideXml);
      if (sanitized !== slideXml) {
        zip.file("ppt/slides/slide1.xml", sanitized);
      }
    }

    // Security: block new external references
    const refsAfter = await extractExternalReferences(zip);
    for (const ref of refsAfter) {
      if (!refsBefore.has(ref)) {
        throw new Error(
          `IllegalAccessError: Adding external references is blocked (${ref})`
        );
      }
    }

    // Generate the modified PPTX as base64
    const modifiedBase64 = await zip.generateAsync({ type: "base64" });

    // Optional permission check (used by execute_office_js sandbox)
    if (
      permissionFn &&
      !(await permissionFn([
        {
          type: "method",
          name: "withSlideZip",
          chain: [
            "presentation",
            "slides",
            `getItemAt(${slideIndex})`,
            "withSlideZip",
          ],
          isDestructive: true,
          warning: `Modify slide ${slideIndex + 1}`,
        },
      ]))
    ) {
      throw new Error("PermissionDenied: User denied slide modification");
    }

    // Re-import: insert the modified slide after the previous one, delete original
    const pres = presentationAccessor(context.presentation);
    pres.insertSlidesFromBase64(modifiedBase64, {
      targetSlideId,
    });
    presentationAccessor(slides.items[slideIndex]).delete();
    await context.sync();

    // Restore selection
    if (selectedIndices.length > 0) {
      slides.load("items/id");
      await context.sync();
      const selectedIds = selectedIndices.map((i) => slides.items[i!].id);
      pres.setSelectedSlides(selectedIds);
      await context.sync();
    }
  }

  return result;
}

// ============================================================================
// Slide Master Cleanup
// ============================================================================

/**
 * After editing the slide master, if the edit introduced a new slide master
 * (by re-importing), reassign all slides to use layouts from the original
 * master, then remove orphaned masters.
 */
async function cleanupSlideMasters(context: PowerPoint.RequestContext) {
  const masters = context.presentation.slideMasters;
  const slides = context.presentation.slides;
  masters.load("items");
  slides.load("items");
  await context.sync();

  if (masters.items.length <= 1) return;

  // Load layouts for all masters and current layout for all slides
  for (const master of masters.items) {
    master.layouts.load("items/name,items/id");
  }
  for (const slide of slides.items) {
    slide.layout.load("name,id");
  }
  await context.sync();

  // Find the master that owns slide 0's layout (the "primary" master)
  const primaryLayoutId = slides.items[0].layout.id;
  const primaryMaster = masters.items.find((m) =>
    m.layouts.items.some((l) => l.id === primaryLayoutId)
  );
  if (!primaryMaster) return;

  // Reassign all other slides to matching layouts from the primary master
  for (let i = 1; i < slides.items.length; i++) {
    const layoutName = slides.items[i].layout.name;
    const matchingLayout = primaryMaster.layouts.items.find(
      (l) => l.name === layoutName
    );
    if (matchingLayout) {
      slides.items[i].applyLayout(matchingLayout);
    }
  }
  await context.sync();

  // Remove orphaned masters by adding+deleting a temp slide using their layout
  // (this triggers PowerPoint to garbage-collect the unused master)
  const orphanedMasters = masters.items.filter((m) => m !== primaryMaster);
  for (const master of orphanedMasters) {
    await forceRemoveMaster(context, master);
  }
}

/**
 * Force-remove an orphaned slide master by temporarily adding a slide
 * that references it, then immediately deleting that slide.
 */
async function forceRemoveMaster(
  context: PowerPoint.RequestContext,
  master: PowerPoint.SlideMaster
) {
  const firstLayout = master.layouts.items[0];
  if (!firstLayout) return;

  context.presentation.slides.add({ layoutId: firstLayout.id });
  await context.sync();

  const slides = context.presentation.slides;
  slides.load("items");
  await context.sync();

  slides.items[slides.items.length - 1].delete();
  await context.sync();
}

// ============================================================================
// SES Sandbox (Secure ECMAScript)
// ============================================================================

/**
 * Blocked Office.js globals — prevent LLM code from opening dialogs,
 * getting auth tokens, or associating actions.
 */
const BLOCKED_OFFICE_PATHS = [
  "context.ui.openBrowserWindow",
  "context.ui.displayDialogAsync",
  "context.auth.getAccessToken",
  "actions.associate",
];

/**
 * Blocked methods on the context proxy — prevent LLM code from calling
 * import/insert methods that could inject arbitrary content.
 */
const BLOCKED_CONTEXT_METHODS = new Set([
  "addAsJson",
  "sendForReview",
  "sendFaxOverInternet",
  "sendFax",
  "sendMail",
  "insertHtml",
  "insertOoxml",
  "insertWorksheetsFromBase64",
  "insertFileFromBase64",
  "insertSlidesFromBase64",
]);

/**
 * Destructive methods — flagged in permission prompts.
 */
const DESTRUCTIVE_METHODS = new Set([
  "delete",
  "clear",
  "clearAll",
  "deleteAll",
  "deleteRows",
  "deleteColumns",
  "removeDuplicates",
  "replaceAll",
  "moveTo",
  "cut",
  "clearOrResetContents",
  "deleteText",
  "clearFilters",
  "acceptAllRevisions",
  "rejectAllRevisions",
  "acceptAll",
  "rejectAll",
  "ungroup",
  "markDirty",
  "unmerge",
  "split",
  "convertToText",
  "breakAllLinks",
  "breakLinks",
  "removePageBreaks",
  "save",
  "close",
  "autoFill",
  "flashFill",
]);

/**
 * Tracked setter properties — writes to these are recorded for permission
 * prompts (e.g., setting .values, .formulas, .text, .name, .left, etc.).
 */
const TRACKED_SETTERS = new Set([
  "values",
  "formulas",
  "formulasLocal",
  "formulasR1C1",
  "formulasR1C1Local",
  "formulaArray",
  "numberFormat",
  "numberFormatLocal",
  "text",
  "name",
  "position",
  "visibility",
  "visible",
  "style",
  "hyperlink",
  "left",
  "top",
  "width",
  "height",
  "rotation",
]);

/**
 * Object methods stripped from the sandbox's Object global.
 * Prevents prototype manipulation from LLM code.
 */
const BLOCKED_OBJECT_METHODS = new Set([
  "defineProperty",
  "getOwnPropertyDescriptor",
  "getPrototypeOf",
  "setPrototypeOf",
]);

/**
 * Initialize SES lockdown (idempotent). This hardens the JavaScript
 * environment to prevent prototype pollution and sandbox escapes.
 */
let lockdownDone = false;

function initLockdown() {
  if (lockdownDone) return;
  lockdownDone = true;

  try {
    // Save Function statics before lockdown freezes them
    const fnStatics = new Map<string, any>();
    for (const key of Object.getOwnPropertyNames(Function)) {
      if (!new Set(["length", "name", "prototype"]).has(key)) {
        fnStatics.set(key, (Function as any)[key]);
      }
    }

    // SES lockdown — freezes all intrinsics
    (globalThis as any).lockdown({
      errorTaming: "unsafe",
      consoleTaming: "unsafe",
      overrideTaming: "severe",
    });

    // Restore Office.js validation functions that lockdown would break
    // (_validateParams etc. are needed by Office.js internals)
    const OFFICE_VALIDATORS = new Set([
      "_validateParams",
      "_validateParameterCount",
      "_validateParameter",
      "_validateParameterType",
    ]);
    for (const key of OFFICE_VALIDATORS) {
      if (fnStatics.has(key)) {
        fnStatics.set(key, () => null); // neuter but keep present
      }
    }

    // Re-attach statics to Function (either directly or via Proxy)
    restoreFunctionStatics(fnStatics);
  } catch (e) {
    if (
      !(
        e instanceof TypeError &&
        String(e).includes("SES_ALREADY_LOCKED_DOWN")
      )
    ) {
      throw e;
    }
  }
}

function restoreFunctionStatics(statics: Map<string, any>) {
  if (statics.size === 0) return;

  const Fn = globalThis.Function;
  if (Object.isExtensible(Fn)) {
    try {
      for (const [key, value] of statics) {
        Object.defineProperty(Fn, key, {
          value,
          writable: false,
          enumerable: false,
          configurable: false,
        });
      }
      return;
    } catch {}
  }

  // Fallback: wrap Function in a Proxy that exposes the statics
  const desc = Object.getOwnPropertyDescriptor(globalThis, "Function");
  if (!desc || (!desc.writable && !desc.configurable)) return;

  const proxy = new Proxy(Fn, {
    get(target, prop, receiver) {
      return statics.has(prop as string)
        ? statics.get(prop as string)
        : Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return statics.has(prop as string) ? true : Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      return statics.has(prop as string)
        ? {
            value: statics.get(prop as string),
            writable: false,
            enumerable: false,
            configurable: true,
          }
        : Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });

  Object.defineProperty(globalThis, "Function", {
    value: proxy,
    writable: desc.writable ?? false,
    configurable: desc.configurable ?? false,
  });
}

/**
 * Create a restricted Object global for the sandbox.
 * Strips defineProperty, getPrototypeOf, etc.
 */
function createSafeObjectGlobal(): Record<string, any> {
  const safe: Record<string, any> = {};
  for (const key of Object.getOwnPropertyNames(Object)) {
    if (!BLOCKED_OBJECT_METHODS.has(key)) {
      safe[key] = (Object as any)[key];
    }
  }
  return safe;
}

/**
 * Create a blocking proxy for Office/Excel/Word/PowerPoint globals.
 * Blocks access to specific nested paths (e.g., "context.ui.openBrowserWindow").
 */
function createBlockingProxy(target: any, blockedPaths: string[]): any {
  const nestedBlocks = new Map<string, string[]>();
  const directBlocks = new Set<string>();

  for (const path of blockedPaths) {
    const dotIndex = path.indexOf(".");
    if (dotIndex === -1) {
      directBlocks.add(path);
    } else {
      const key = path.slice(0, dotIndex);
      const rest = path.slice(dotIndex + 1);
      if (!nestedBlocks.has(key)) nestedBlocks.set(key, []);
      nestedBlocks.get(key)!.push(rest);
    }
  }

  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (typeof prop === "string" && directBlocks.has(prop)) {
        throw new Error(`IllegalAccessError: Access to '${prop}' is blocked`);
      }
      const value = Reflect.get(target, prop);
      if (typeof prop === "string" && nestedBlocks.has(prop) && value && typeof value === "object") {
        return createBlockingProxy(value, nestedBlocks.get(prop)!);
      }
      return value;
    },
  });
}

// ============================================================================
// Context Proxy (Permission Tracking)
// ============================================================================

/**
 * Deep-proxy wrapper around the Office.js context object.
 *
 * Tracks all method calls and property sets, building up a list of "actions"
 * that get shown to the user in a permission prompt when context.sync() is
 * called. If the user denies, the sync throws PermissionDenied.
 *
 * Also blocks access to dangerous methods (insertSlidesFromBase64, etc.)
 * and freezes values written by the LLM to prevent prototype pollution.
 */
const proxyToReal = new WeakMap<any, any>();

function createContextProxy(
  target: any,
  actions: any[] | undefined,
  chain: string[] | undefined,
  permissionFn?: (actions: any[]) => Promise<boolean>
): any {
  if (!target || typeof target !== "object") return target;

  // Arrays
  if (Array.isArray(target)) {
    const proxy = new Proxy(target, {
      get(arr, prop) {
        const value = Reflect.get(arr, prop);
        return value && typeof value === "object" && !Array.isArray(value)
          ? createContextProxy(value, actions, chain, permissionFn)
          : value;
      },
    });
    proxyToReal.set(proxy, target);
    return proxy;
  }

  // Objects
  const proxy = new Proxy(Object.create(null), {
    set(_obj, prop, value) {
      if (typeof prop === "string") {
        // Validate formulas for blocked functions (Excel)
        // (validation logic omitted — checks for WEBSERVICE, etc.)
        // Freeze complex values to prevent prototype pollution
        deepFreeze(value);
      }

      // Track the setter for permission prompting
      if (actions && typeof prop === "string") {
        if (TRACKED_SETTERS.has(prop)) {
          actions.push({
            type: "setter",
            name: prop,
            chain: [...(chain ?? []), prop],
            isDestructive: false,
          });
        }
      }

      return Reflect.set(target, prop, value);
    },

    get(_obj, prop) {
      // Block dangerous methods
      if (typeof prop === "string" && BLOCKED_CONTEXT_METHODS.has(prop)) {
        throw new Error(
          `IllegalAccessError: Access to '${prop}' is blocked`
        );
      }

      const value = Reflect.get(target, prop);

      if (typeof value === "function") {
        // Special handling for context.sync() — trigger permission prompt
        if (actions && prop === "sync" && (chain ?? []).length === 0) {
          return async () => {
            const pendingActions = [...actions];
            if (pendingActions.length > 0 && permissionFn) {
              if (!(await permissionFn(pendingActions))) {
                throw new Error("PermissionDenied: User denied permission");
              }
            }
            actions.length = 0;
            return value.apply(target);
          };
        }

        // Wrap all other method calls
        return function (...args: any[]) {
          // Unwrap proxied args back to real objects
          const realArgs = args.map((a) =>
            a && typeof a === "object" && proxyToReal.has(a)
              ? proxyToReal.get(a)
              : a
          );

          // Track the method call
          if (actions && typeof prop === "string") {
            actions.push({
              type: "method",
              name: prop,
              chain: [...(chain ?? []), `${prop}()`],
              isDestructive: DESTRUCTIVE_METHODS.has(prop),
            });
          }

          const result = value.apply(target, realArgs);
          return createContextProxy(
            result,
            actions,
            [...(chain ?? []), String(prop)],
            permissionFn
          );
        };
      }

      // Recurse into nested objects
      if (value && typeof value === "object") {
        return createContextProxy(
          value,
          actions,
          [...(chain ?? []), prop as string],
          permissionFn
        );
      }

      return value;
    },

    has(_obj, prop) {
      return Reflect.has(target, prop);
    },

    ownKeys(_obj) {
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(_obj, prop) {
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc) {
        if ("value" in desc && desc.value !== null && typeof desc.value === "object") {
          return { enumerable: desc.enumerable, configurable: true };
        }
        if (typeof desc.value === "function" || "get" in desc || "set" in desc) {
          return { enumerable: desc.enumerable, configurable: true };
        }
        return { ...desc, configurable: true };
      }
    },
  });

  proxyToReal.set(proxy, target);
  return proxy;
}

/** Recursively freeze plain objects and arrays (prevents prototype pollution). */
function deepFreeze(value: any, seen = new WeakSet()): any {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
    return Object.freeze(value);
  }

  if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const v of Object.values(value)) deepFreeze(v, seen);
    return Object.freeze(value);
  }

  return value;
}

// ============================================================================
// Sandbox: compile_slide_code (for edit_slide_xml, edit_slide_chart, edit_slide_master)
// ============================================================================

/**
 * Compile LLM-generated code for OOXML manipulation tools.
 * Runs in a SES Compartment with access to DOMParser, XMLSerializer,
 * Math, Date, console, and the escapeXml helper. No access to Office.js,
 * Reflect, Proxy, or prototype manipulation.
 */
function compileSlideCode(
  code: string
): (args: { zip: JSZip; markDirty: () => void }) => Promise<any> {
  initLockdown();

  const compartment = new (globalThis as any).Compartment({
    console,
    Math,
    Date,
    DOMParser: typeof DOMParser !== "undefined" ? DOMParser : undefined,
    XMLSerializer: typeof XMLSerializer !== "undefined" ? XMLSerializer : undefined,
    escapeXml,
    // Explicitly blocked:
    Reflect: undefined,
    Proxy: undefined,
    Object: createSafeObjectGlobal(),
    Compartment: undefined,
    harden: undefined,
    lockdown: undefined,
  });

  const wrappedCode = "(async function({ zip, markDirty }) { " + code + " })";
  return compartment.evaluate(wrappedCode);
}

// ============================================================================
// Sandbox: compile_office_js (for execute_office_js)
// ============================================================================

/**
 * Compile LLM-generated code for direct Office.js execution.
 * Runs in a SES Compartment with proxied Office globals that block
 * dangerous operations. The context is further wrapped in a deep Proxy
 * for permission tracking.
 */
function compileOfficeJsCode(
  code: string,
  permissionFn?: (actions: any[]) => Promise<boolean>
): (context: any) => Promise<any> {
  initLockdown();

  // Build restricted Office globals
  const officeGlobals = {
    Office:
      typeof Office !== "undefined"
        ? createBlockingProxy(Office, BLOCKED_OFFICE_PATHS)
        : undefined,
    Excel:
      typeof Excel !== "undefined"
        ? createBlockingProxy(Excel, ["run"])
        : undefined,
    Word:
      typeof Word !== "undefined"
        ? createBlockingProxy(Word, ["run"])
        : undefined,
    PowerPoint:
      typeof PowerPoint !== "undefined"
        ? createBlockingProxy(PowerPoint, ["run"])
        : undefined,
    // Expose withSlideZip so LLM code can do OOXML manipulation from execute_office_js
    pptx:
      typeof PowerPoint !== "undefined"
        ? {
            withSlideZip: (
              ctx: any,
              slideIndex: number,
              callback: any
            ) =>
              withSlideZip(
                ctx,
                slideIndex,
                callback,
                permissionFn,
                // Unwrap proxied objects back to real ones
                (obj: any) =>
                  obj && typeof obj === "object" && proxyToReal.has(obj)
                    ? proxyToReal.get(obj)
                    : obj
              ),
          }
        : undefined,
  };

  const compartment = new (globalThis as any).Compartment({
    console,
    Math,
    Date,
    DOMParser: typeof DOMParser !== "undefined" ? DOMParser : undefined,
    XMLSerializer: typeof XMLSerializer !== "undefined" ? XMLSerializer : undefined,
    Reflect: undefined,
    Proxy: undefined,
    Object: createSafeObjectGlobal(),
    Compartment: undefined,
    harden: undefined,
    lockdown: undefined,
    ...officeGlobals,
  });

  const wrappedCode = "(async function(context) { " + code + " })";
  const fn = compartment.evaluate(wrappedCode);

  // Return a function that wraps the real context in the tracking proxy
  return async (realContext: any) =>
    fn(createContextProxy(realContext, [], [], permissionFn));
}

// ============================================================================
// Tool Implementations
// ============================================================================

interface ToolResult {
  success: boolean;
  result?: any;
  _images?: Array<{ data: string; mediaType: string }>;
  error?: string;
}

// ------ screenshot_slide ------

async function screenshotSlide(params: {
  slide_index: number;
}): Promise<ToolResult> {
  try {
    const imageData = await PowerPoint.run(async (context) => {
      const imageResult = context.presentation.slides
        .getItemAt(params.slide_index)
        .getImageAsBase64({ width: 960 });
      await context.sync();
      return imageResult.value;
    });

    return {
      success: true,
      _images: [{ data: imageData, mediaType: "image/png" }],
    };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ edit_slide_xml / edit_slide_chart ------

/**
 * Both edit_slide_xml and edit_slide_chart use the same implementation.
 * Exports the slide as a ZIP, runs sandboxed code, re-imports if dirty.
 */
async function editSlideXml(params: {
  slide_index: number;
  code: string;
}): Promise<ToolResult> {
  try {
    const result = await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) => {
        const compiledFn = compileSlideCode(params.code);
        const { run } = createTimeoutGuard(TOOL_TIMEOUT_MS);
        return run(() => withSlideZip(context, params.slide_index, compiledFn));
      }
    );

    return {
      success: true,
      result: result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
    };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ edit_slide_master ------

/**
 * Like edit_slide_xml but always targets slide 0, and after the edit,
 * cleans up orphaned slide masters that may result from the re-import.
 */
async function editSlideMaster(params: { code: string }): Promise<ToolResult> {
  try {
    const result = await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) => {
        const compiledFn = compileSlideCode(params.code);
        const { run } = createTimeoutGuard(TOOL_TIMEOUT_MS);
        return run(async () => {
          const callbackResult = await withSlideZip(context, 0, compiledFn);
          await cleanupSlideMasters(context);
          return callbackResult;
        });
      }
    );

    return {
      success: true,
      result: result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
    };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ duplicate_slide ------

async function duplicateSlide(params: {
  slide_index: number;
}): Promise<ToolResult> {
  try {
    await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();

        if (
          params.slide_index < 0 ||
          params.slide_index >= slides.items.length
        ) {
          throw new Error(
            `Slide index ${params.slide_index} out of range (0-${slides.items.length - 1})`
          );
        }

        // Export the slide and immediately re-import after itself
        const exported = slides
          .getItemAt(params.slide_index)
          .exportAsBase64();
        await context.sync();

        const targetSlideId = slides.items[params.slide_index].id;
        context.presentation.insertSlidesFromBase64(exported.value, {
          targetSlideId,
        });
        await context.sync();
      }
    );

    return { success: true };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ verify_slides ------

interface ShapeInfo {
  id: string;
  name: string;
  left: number;
  top: number;
  w: number;
  h: number;
}

interface VerifyResult {
  shapes: ShapeInfo[];
  overflows: Array<{
    shape: ShapeInfo;
    overflowBy: number;
    [key: string]: any;
  }>;
  overlaps: Array<{
    shapeA: ShapeInfo;
    shapeB: ShapeInfo;
    overlapX: number;
    overlapY: number;
  }>;
}

function verifyShapes(
  shapes: any[],
  slideWidth: number,
  slideHeight: number
): VerifyResult {
  const infos: ShapeInfo[] = [];
  const overflows: any[] = [];
  const overlaps: any[] = [];

  for (const shape of shapes) {
    const info: ShapeInfo = {
      id: shape.id,
      name: shape.name,
      left: shape.left,
      top: shape.top,
      w: shape.width,
      h: shape.height,
    };
    infos.push(info);

    // Check vertical overflow
    if (shape.top + shape.height > slideHeight) {
      overflows.push({
        shape: info,
        bottom: shape.top + shape.height,
        slideH: slideHeight,
        overflowBy: shape.top + shape.height - slideHeight,
      });
    }
    // Check horizontal overflow
    if (shape.left + shape.width > slideWidth) {
      overflows.push({
        shape: info,
        right: shape.left + shape.width,
        slideW: slideWidth,
        overflowBy: shape.left + shape.width - slideWidth,
      });
    }
  }

  // Check all pairs for overlaps (AABB intersection)
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const a = infos[i];
      const b = infos[j];

      if (
        a.left < b.left + b.w &&
        a.left + a.w > b.left &&
        a.top < b.top + b.h &&
        a.top + a.h > b.top
      ) {
        const overlapX =
          Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left);
        const overlapY =
          Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top);
        overlaps.push({ shapeA: a, shapeB: b, overlapX, overlapY });
      }
    }
  }

  return { shapes: infos, overflows, overlaps };
}

async function verifySlides(): Promise<ToolResult> {
  try {
    const result = await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) => {
        const slides = context.presentation.slides;
        slides.load("items");

        const pageSetup = context.presentation.pageSetup;
        pageSetup.load(["slideWidth", "slideHeight"]);
        await context.sync();

        const slideWidth = pageSetup.slideWidth;
        const slideHeight = pageSetup.slideHeight;
        const results: VerifyResult[] = [];

        for (const slide of slides.items) {
          const shapes = slide.shapes;
          shapes.load(
            "items/id,items/name,items/left,items/top,items/width,items/height"
          );
          await context.sync();

          results.push(verifyShapes(shapes.items, slideWidth, slideHeight));
        }

        return { slides: results };
      }
    );

    return {
      success: true,
      result: result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
    };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ read_slide_text ------

async function readSlideText(params: {
  slide_index: number;
  shape_name: string;
  occurrence?: number;
}): Promise<ToolResult> {
  try {
    const result = await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) =>
        withSlideZip(context, params.slide_index, async ({ zip }) => {
          const slideFile = zip.file("ppt/slides/slide1.xml");
          if (!slideFile) throw new Error("Slide XML not found in archive");

          const xml = await slideFile.async("string");
          const doc = new DOMParser().parseFromString(xml, "text/xml");
          const occurrence = params.occurrence ?? 0;

          const shape = findShapeByName(doc, params.shape_name, occurrence);
          if (!shape) {
            throw new Error(
              occurrence > 0
                ? `Shape "${params.shape_name}" occurrence ${occurrence} not found on slide ${params.slide_index + 1}`
                : `Shape "${params.shape_name}" not found on slide ${params.slide_index + 1}`
            );
          }

          const txBody = shape.getElementsByTagNameNS(NS_PRESENTATION, "txBody")[0];
          if (!txBody) {
            return "(empty — shape has no text body in the exported OOXML. This is normal for empty placeholders. You can still write to it with edit_slide_text.)";
          }

          const serializer = new XMLSerializer();
          const paragraphs: string[] = [];
          for (let i = 0; i < txBody.childNodes.length; i++) {
            const node = txBody.childNodes[i];
            if (
              node.nodeType === 1 &&
              node.localName === "p" &&
              node.namespaceURI === NS_DRAWING
            ) {
              paragraphs.push(serializer.serializeToString(node));
            }
          }

          return paragraphs.length === 0
            ? "(empty — shape has a text body but no paragraph content. You can write to it with edit_slide_text.)"
            : paragraphs.join("\n");
        })
    );

    return { success: true, result };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ edit_slide_text ------

async function editSlideText(params: {
  slide_index: number;
  shape_name: string;
  code: string; // raw <a:p> XML
  occurrence?: number;
}): Promise<ToolResult> {
  try {
    await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) => {
        await withSlideZip(
          context,
          params.slide_index,
          async ({ zip, markDirty }) => {
            const slideFile = zip.file("ppt/slides/slide1.xml");
            if (!slideFile)
              throw new Error("Slide XML not found in archive");

            const xml = await slideFile.async("string");
            const doc = new DOMParser().parseFromString(xml, "text/xml");
            const occurrence = params.occurrence ?? 0;

            const shape = findShapeByName(
              doc,
              params.shape_name,
              occurrence
            );
            if (!shape) {
              throw new Error(
                occurrence > 0
                  ? `Shape "${params.shape_name}" occurrence ${occurrence} not found on slide ${params.slide_index + 1}`
                  : `Shape "${params.shape_name}" not found on slide ${params.slide_index + 1}`
              );
            }

            // Find or create txBody
            let txBody = shape.getElementsByTagNameNS(
              NS_PRESENTATION,
              "txBody"
            )[0];

            if (txBody) {
              // Preserve bodyPr and lstStyle, remove everything else
              const bodyPr = txBody.getElementsByTagNameNS(
                NS_DRAWING,
                "bodyPr"
              )[0];
              const lstStyle = txBody.getElementsByTagNameNS(
                NS_DRAWING,
                "lstStyle"
              )[0];

              while (txBody.firstChild) txBody.removeChild(txBody.firstChild);
              if (bodyPr) txBody.appendChild(bodyPr);
              if (lstStyle) txBody.appendChild(lstStyle);
            } else {
              // Create a new txBody with empty bodyPr and lstStyle
              txBody = doc.createElementNS(NS_PRESENTATION, "p:txBody");
              const bodyPr = doc.createElementNS(NS_DRAWING, "a:bodyPr");
              const lstStyle = doc.createElementNS(NS_DRAWING, "a:lstStyle");
              txBody.appendChild(bodyPr);
              txBody.appendChild(lstStyle);
              shape.appendChild(txBody);
            }

            // Parse the new paragraph XML (with ampersand sanitization)
            const sanitizedXml = sanitizeXmlAmpersands(params.code);
            const wrapperXml = `<wrapper xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}">${sanitizedXml}</wrapper>`;
            const parsedDoc = new DOMParser().parseFromString(
              wrapperXml,
              "text/xml"
            );

            // Check for parse errors
            const parseError =
              parsedDoc.getElementsByTagName("parsererror")[0];
            if (parseError) {
              throw new Error(`Invalid XML: ${parseError.textContent}`);
            }

            // Validate and import only <a:p> elements
            const wrapper = parsedDoc.documentElement;
            let paragraphCount = 0;

            for (let i = 0; i < wrapper.childNodes.length; i++) {
              const child = wrapper.childNodes[i];
              if (child.nodeType === 1) {
                const el = child as Element;
                if (
                  el.localName !== "p" ||
                  el.namespaceURI !== NS_DRAWING
                ) {
                  throw new Error(
                    `Invalid element <${el.nodeName}> — only <a:p> paragraph elements are allowed`
                  );
                }
                txBody.appendChild(doc.importNode(child, true));
                paragraphCount++;
              }
            }

            if (paragraphCount === 0) {
              throw new Error(
                "xml must contain at least one <a:p> paragraph element"
              );
            }

            // Write back
            const serialized = new XMLSerializer().serializeToString(doc);
            zip.file("ppt/slides/slide1.xml", serialized);

            markDirty();
          }
        );
      }
    );

    return { success: true };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ search_icons ------

async function searchIcons(params: {
  query: string;
  top?: number;
}): Promise<ToolResult> {
  try {
    const top = Math.min(Math.max(1, params.top ?? 5), 20);
    const res = await fetch(
      `${ICONS_API_BASE}/api/icons/search?q=${encodeURIComponent(params.query)}&top=${top}`
    );
    if (!res.ok)
      throw new Error(`Icon search error: ${res.status} ${res.statusText}`);

    const data = (await res.json())[0];
    if (!data?.MicrosoftContents) return { success: true, result: [] };

    const results: Array<{
      id: string;
      description: string;
      isMono: boolean;
      contentTier: string;
      searchScore: number;
    }> = [];

    for (const item of data.MicrosoftContents) {
      iconCache.set(item.Id, item.Inline);
      results.push({
        id: item.Id,
        description: item.Description,
        isMono: item.IsMono,
        contentTier: item.ContentTier,
        searchScore: item.SearchScore,
      });
    }

    return { success: true, result: results };
  } catch (err: any) {
    throw new Error(
      JSON.stringify({ success: false, error: err.message })
    );
  }
}

// ------ insert_icon ------

async function insertIcon(params: {
  icon_id: string;
  slide_index: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  description?: string;
  color?: string;
}): Promise<ToolResult> {
  const svg = iconCache.get(params.icon_id);
  if (!svg)
    throw new Error(
      `Icon "${params.icon_id}" not found in cache. Call search_icons first to populate the cache.`
    );

  const width = params.width ?? ICON_DEFAULT_SIZE;
  const height = params.height ?? ICON_DEFAULT_SIZE;
  const x = params.x ?? (SLIDE_WIDTH_PT - width) / 2;
  const y = params.y ?? (SLIDE_HEIGHT_PT - height) / 2;
  const descr = params.description ?? "";
  const svgToUse = params.color ? recolorSvg(svg, params.color) : svg;
  const pngBase64 = await rasterizeSvgToPng(svgToUse, ICON_PNG_SIZE, ICON_PNG_SIZE);

  try {
    await safeOfficeRun(
      PowerPoint.run.bind(PowerPoint),
      async (context) =>
        withSlideZip(context, params.slide_index, async ({ zip, markDirty }) => {
          const mediaCount =
            Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/")).length + 1;
          const svgPath = `ppt/media/icon${mediaCount}.svg`;
          const pngPath = `ppt/media/icon${mediaCount}.png`;

          zip.file(svgPath, svgToUse);
          zip.file(pngPath, pngBase64, { base64: true });
          await registerContentType(zip, "svg", "image/svg+xml");
          await registerContentType(zip, "png", "image/png");

          const relsPath = "ppt/slides/_rels/slide1.xml.rels";
          const relsXml =
            (await zip.file(relsPath)?.async("string")) ??
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
          const relsDoc = new DOMParser().parseFromString(relsXml, "text/xml");
          const relsNs = "http://schemas.openxmlformats.org/package/2006/relationships";
          const imgType =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
          const rels = relsDoc.getElementsByTagName("Relationship");
          let maxId = 0;
          for (let i = 0; i < rels.length; i++) {
            const id = rels[i].getAttribute("Id") ?? "";
            const n = parseInt(id.replace(/\D/g, ""), 10);
            if (!Number.isNaN(n) && n > maxId) maxId = n;
          }
          const rIdPng = `rId${maxId + 1}`;
          const rIdSvg = `rId${maxId + 2}`;

          const relPng = relsDoc.createElementNS(relsNs, "Relationship");
          relPng.setAttribute("Id", rIdPng);
          relPng.setAttribute("Type", imgType);
          relPng.setAttribute("Target", `../media/icon${mediaCount}.png`);
          relsDoc.documentElement.appendChild(relPng);

          const relSvg = relsDoc.createElementNS(relsNs, "Relationship");
          relSvg.setAttribute("Id", rIdSvg);
          relSvg.setAttribute("Type", imgType);
          relSvg.setAttribute("Target", `../media/icon${mediaCount}.svg`);
          relsDoc.documentElement.appendChild(relSvg);
          zip.file(relsPath, new XMLSerializer().serializeToString(relsDoc));

          const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
          if (!slideXml) throw new Error("Could not read slide XML");

          const slideDoc = new DOMParser().parseFromString(slideXml, "text/xml");
          const spTree = slideDoc.getElementsByTagNameNS(NS_PRESENTATION, "spTree")[0];
          if (!spTree) throw new Error("Could not find <p:spTree> in slide XML");

          let maxShapeId = 0;
          const pCnvPr = slideDoc.getElementsByTagNameNS(NS_PRESENTATION, "cNvPr");
          const aCnvPr = slideDoc.getElementsByTagNameNS(NS_DRAWING, "cNvPr");
          for (const list of [pCnvPr, aCnvPr]) {
            for (let i = 0; i < list.length; i++) {
              const idAttr = list[i].getAttribute("id");
              if (idAttr) {
                const n = parseInt(idAttr, 10);
                if (!Number.isNaN(n) && n > maxShapeId) maxShapeId = n;
              }
            }
          }
          const shapeId = maxShapeId + 1;

          const offX = Math.round(x * EMU_PER_PT);
          const offY = Math.round(y * EMU_PER_PT);
          const extCx = Math.round(width * EMU_PER_PT);
          const extCy = Math.round(height * EMU_PER_PT);

          const picXml = `<p:pic
        xmlns:p="${NS_PRESENTATION}"
        xmlns:a="${NS_DRAWING}"
        xmlns:r="${NS_RELATIONSHIPS}">
        <p:nvPicPr>
          <p:cNvPr id="${shapeId}" name="Graphic ${shapeId}" descr="${escapeXmlForAttr(descr)}"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="${rIdPng}">
            <a:extLst>
              <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
                <asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${rIdSvg}"/>
              </a:ext>
            </a:extLst>
          </a:blip>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="${offX}" y="${offY}"/>
            <a:ext cx="${extCx}" cy="${extCy}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>`;

          const picDoc = new DOMParser().parseFromString(picXml, "text/xml");
          spTree.appendChild(slideDoc.importNode(picDoc.documentElement, true));
          zip.file("ppt/slides/slide1.xml", new XMLSerializer().serializeToString(slideDoc));
          markDirty();
        })
    );

    return { success: true, result: { inserted: true, icon_id: params.icon_id } };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ------ execute_office_js ------

/**
 * Execute arbitrary Office.js code from the LLM, sandboxed via SES
 * Compartment with a proxied context that tracks all mutations and
 * prompts the user for permission on context.sync().
 */
async function executeOfficeJs(
  params: { code: string },
  permissionFn?: (actions: any[]) => Promise<boolean>
): Promise<ToolResult> {
  const hostName = Office.context.host as string;
  const runFn: Record<string, (cb: any) => Promise<any>> = {
    Excel: (cb: any) => safeOfficeRun(Excel.run, cb),
    Word: (cb: any) => safeOfficeRun(Word.run, cb),
    PowerPoint: (cb: any) =>
      safeOfficeRun(PowerPoint.run.bind(PowerPoint), cb),
  };

  const run = runFn[hostName];
  if (!run) {
    throw new Error(
      JSON.stringify({
        success: false,
        error: `UnsupportedHostError: ${hostName}`,
      })
    );
  }

  const isOnlinePowerPoint =
    typeof Office !== "undefined" &&
    hostName === (Office as any).HostType.PowerPoint &&
    getPlatform() === "OfficeOnline";

  try {
    const result = await run(async (context: any) => {
      const { run: timedRun, exclude } = createTimeoutGuard(TOOL_TIMEOUT_MS);

      // Compile code in sandbox with proxied globals
      const compiledFn = compileOfficeJsCode(
        params.code,
        permissionFn
          ? (actions) =>
              exclude(async () => {
                // On Office Online, sync before showing prompt to flush pending ops
                if (isOnlinePowerPoint) {
                  await context.sync();
                }
                return permissionFn(actions);
              })
          : undefined
      );

      return timedRun(() => compiledFn(context));
    });

    return {
      success: true,
      result:
        result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
    };
  } catch (err: any) {
    const debugInfo = err.debugInfo || {};
    throw new Error(
      JSON.stringify({ success: false, error: err.message, ...debugInfo })
    );
  }
}

// ============================================================================
// Tool Registry (returned by NCe() in the bundle)
// ============================================================================

export function createToolHandlers() {
  return {
    screenshot_slide: screenshotSlide,
    edit_slide_chart: editSlideXml,
    edit_slide_xml: editSlideXml,
    edit_slide_master: editSlideMaster,
    duplicate_slide: duplicateSlide,
    verify_slides: verifySlides,
    read_slide_text: readSlideText,
    edit_slide_text: editSlideText,
    execute_office_js: executeOfficeJs,
    search_icons: searchIcons,
    insert_icon: insertIcon,
  };
}
