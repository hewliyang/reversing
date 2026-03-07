/**
 * sandbox-clean.ts — Clean, annotated reimplementation of sandbox-BAMHNVll.js
 *
 * This file is the sandbox side of the Basispoints/ChatGPT-for-Excel Office.js
 * sandbox system. It runs inside a `<iframe sandbox="allow-scripts">` and
 * executes untrusted user scripts in a QuickJS WASM runtime.
 *
 * The original is a Vite-bundled, minified ES module that embeds:
 *   1. quickjs-emscripten (QuickJS WASM bindings)
 *   2. The QuickJS WASM binary (~456 KB, base64-encoded data URI)
 *   3. A guest runtime factory (Excel API proxy system)
 *   4. A MessageChannel protocol handler
 *
 * This clean version uses quickjs-emscripten from npm and re-implements
 * everything else from scratch based on reverse-engineering the original.
 *
 * Original function name mapping:
 *   Qg  → createGuestRuntime      (Excel API proxy factory)
 *   Bg  → wrapUserScript          (wraps user code in guest runtime scaffold)
 *   Lg  → runProgram              (QuickJS execution engine)
 *   Hg  → attachBootstrapListener (window message listener for BOOTSTRAP)
 *   Yg  → createPortSession       (MessagePort session handler)
 *   Jg  → getOrCreateWasmModule   (cached QuickJS WASM module init)
 *   KI  → injectGlobalFunction    (define host function in QuickJS context)
 *   nI  → drainPendingJobs        (run all pending QuickJS microtasks)
 *   OA  → extractErrorMessage     (normalize error to string)
 *   ng  → jsonToHandle            (JSON value → QuickJS handle)
 *   dA  → createErrorHandle       (Error → QuickJS Error handle)
 *   wA  → safeDispose             (dispose handle if alive)
 */

import type { QuickJSWASMModule, QuickJSRuntime, QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

// ============================================================================
// Protocol Constants & Types
// ============================================================================

/** Protocol version (must match host) */
const PROTOCOL_VERSION = 1;

/** Message type strings */
const MSG = {
  BOOTSTRAP:     "bps.officejs-sandbox.bootstrap",
  READY:         "bps.officejs-sandbox.ready",
  RUN:           "bps.officejs-sandbox.run",
  SYNC_REQUEST:  "bps.officejs-sandbox.sync_request",
  SYNC_RESPONSE: "bps.officejs-sandbox.sync_response",
  RESULT:        "bps.officejs-sandbox.result",
  ERROR:         "bps.officejs-sandbox.error",
} as const;

/** Special JSON key used to encode proxy object references in serialized values */
const SERIALIZED_REF_KEY = "__officejsRef";

/** Default sandbox execution limits */
const DEFAULT_LIMITS: SandboxLimits = {
  maxObjectIds: 256,
  maxQueuedOperations: 256,
  maxSerializedChars: 200_000,
  maxMatrixWriteCells: 10_000,
  timeoutMs: 20_000,
};

/** QuickJS runtime constraints */
const MAX_MEMORY_BYTES = 32 * 1024 * 1024;  // 32 MB
const MAX_STACK_BYTES  = 1024 * 1024;        // 1 MB

// --- Type definitions ---

interface SandboxLimits {
  maxObjectIds: number;
  maxQueuedOperations: number;
  maxSerializedChars: number;
  maxMatrixWriteCells: number;
  timeoutMs: number;
}

interface LogEntry {
  level: string;
  message: string;
}

/** Log buffer with truncation limits (matches protocol module's `z()` / `G()`) */
interface LogBuffer {
  entries: LogEntry[];
  totalChars: number;
  truncated: boolean;
}

const LOG_MAX_ENTRIES = 120;
const LOG_MAX_MESSAGE_CHARS = 800;
const LOG_MAX_TOTAL_CHARS = 20_000;
const LOG_TRUNCATED_MESSAGE = "[officejs sandbox logs truncated]";

/** An object definition sent in SYNC_REQUEST (describes the proxy object graph) */
interface ObjectDefinition {
  id: number;
  kind: "root" | "property" | "invoke";
  root?: string;           // for kind "root": "ctx" or "excel"
  parentId?: number;       // for kind "property" | "invoke"
  property?: string;       // for kind "property"
  method?: string;         // for kind "invoke"
  args?: any[];            // for kind "invoke"
}

/** A command sent in SYNC_REQUEST (describes an operation to perform) */
interface Command {
  kind: "load" | "set" | "invoke";
  targetId: number;
  spec?: any;              // for kind "load"
  property?: string;       // for kind "set"
  value?: any;             // for kind "set"
  method?: string;         // for kind "invoke"
  resultId?: number;       // for kind "invoke"
  args?: any[];            // for kind "invoke"
  write?: boolean;         // for kind "invoke" — true if method is a write operation
}

interface SyncRequestPayload {
  requestId: string;
  definitions: ObjectDefinition[];
  commands: Command[];
}

interface SyncResponsePayload {
  requestId: string;
  snapshots: Record<string, any>;
}

interface ProgramResult {
  logs: LogEntry[];
  result: any;
}

interface RunProgramOptions {
  hostCall: (payload: SyncRequestPayload) => Promise<SyncResponsePayload>;
  limits: SandboxLimits;
  moduleLoader?: () => Promise<QuickJSWASMModule>;
}

// ============================================================================
// Protocol Message Type Guards
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, any> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isProtocolMessage(msg: unknown, type: string): msg is Record<string, any> {
  return (
    isPlainObject(msg) &&
    msg.type === type &&
    msg.protocolVersion === PROTOCOL_VERSION &&
    typeof msg.invocationId === "string" &&
    typeof msg.nonce === "string"
  );
}

function isBootstrapMessage(msg: unknown): boolean {
  return isProtocolMessage(msg, MSG.BOOTSTRAP);
}

function isRunMessage(msg: unknown): msg is Record<string, any> {
  return isProtocolMessage(msg, MSG.RUN) && typeof (msg as any).script === "string" && isPlainObject((msg as any).limits);
}

function isSyncResponseMessage(msg: unknown): msg is Record<string, any> {
  return isProtocolMessage(msg, MSG.SYNC_RESPONSE) && isPlainObject((msg as any).payload);
}

// ============================================================================
// Log Buffer
// ============================================================================

function createLogBuffer(): LogBuffer {
  return { entries: [], totalChars: 0, truncated: false };
}

function truncateString(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, Math.max(0, maxLen - 3)) + "...";
}

function stringifyLogValue(value: any): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (value instanceof Error) return value.stack || value.message || "Error";
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  try { return JSON.stringify(value); } catch { return String(value); }
}

function appendLog(buffer: LogBuffer, level: string, values: any[]): void {
  if (buffer.truncated) return;
  if (buffer.entries.length >= LOG_MAX_ENTRIES || buffer.totalChars >= LOG_MAX_TOTAL_CHARS) {
    buffer.entries.push({ level: "warn", message: LOG_TRUNCATED_MESSAGE });
    buffer.truncated = true;
    return;
  }
  const raw = values.length > 0 ? values.map(v => stringifyLogValue(v)).join(" ") : "";
  const capped = truncateString(raw, LOG_MAX_MESSAGE_CHARS);
  const remaining = LOG_MAX_TOTAL_CHARS - buffer.totalChars;
  if (remaining <= 0) {
    buffer.entries.push({ level: "warn", message: LOG_TRUNCATED_MESSAGE });
    buffer.truncated = true;
    return;
  }
  const message = truncateString(capped, remaining);
  buffer.entries.push({ level, message });
  buffer.totalChars += message.length;
}

function formatErrorWithLogs(error: unknown, logs: LogEntry[]): string {
  const msg = error instanceof Error && error.message.length > 0
    ? error.message
    : typeof error === "string" && error.length > 0
      ? error
      : "unknown error";
  const prefix = `Office.js sandbox execution failed: ${msg}`;
  if (logs.length === 0) return prefix;
  const logText = logs.map(e => `[${e.level}] ${e.message}`).join("\n");
  return `${prefix}\nOffice.js sandbox console output:\n${logText}`;
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Check if a value is JSON-serializable according to the sandbox protocol.
 * Allows: null, string, boolean, finite number, arrays (recursive),
 * plain objects (recursive), and proxy references (objects with __officejsRef).
 */
function isSerializableValue(value: any): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)))
    return true;
  if (Array.isArray(value)) return value.every(isSerializableValue);
  if (isPlainObject(value)) {
    // Proxy reference objects are valid
    if (typeof value[SERIALIZED_REF_KEY] === "number") return true;
    return Object.values(value).every(isSerializableValue);
  }
  return false;
}

// ============================================================================
// Guest Runtime — Proxy-based Excel API
// ============================================================================

/**
 * Creates the guest runtime that provides `ctx`, `Excel`, and `console` objects
 * to user scripts. Property accesses and method calls are recorded as definitions
 * and commands, then batched and sent to the host via `callHost` when `ctx.sync()`
 * is called.
 *
 * Original: `Qg` function (lines 43-320 of formatted source)
 */
function createGuestRuntime(
  callbacks: {
    callHost: (payload: SyncRequestPayload) => Promise<SyncResponsePayload>;
    log: (level: string, values: any[]) => void;
    limits: SandboxLimits;
  },
  staticConfig = { defaultLimits: DEFAULT_LIMITS, serializedRefKey: SERIALIZED_REF_KEY }
) {
  const limits = { ...staticConfig.defaultLimits, ...callbacks.limits };

  // NOTE: All helper functions used by this function MUST be defined inline here,
  // not at module scope. This is because wrapUserScript() serializes this entire
  // function via .toString() and injects it into QuickJS, where module-scope
  // bindings are not available.

  /** Check if a value is a plain object (Object.prototype or null prototype) */
  function _isPlainObject(value: unknown): value is Record<string, any> {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  // --- State ---

  /** All object definitions (the proxy object graph) */
  const definitions = new Map<number, ObjectDefinition>();

  /** Resolved snapshot data for each object ID (populated by sync responses) */
  const snapshots = new Map<number, any>();

  /** Proxy cache: object ID → Proxy instance */
  const proxyCache = new Map<number, any>();

  /** Reverse map: Proxy instance → object ID */
  const proxyToId = new WeakMap<object, number>();

  /** Child property map: parentId → Map<propertyName, childId> */
  const childProperties = new Map<number, Map<string, number>>();

  /** Pending commands (flushed on ctx.sync()) */
  const pendingCommands: Command[] = [];

  let nextObjectId = 1;
  let nextRequestId = 1;

  // --- Helpers ---

  function deepClone(value: any): any {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneIfDefined(value: any): any {
    return value === undefined ? undefined : deepClone(value);
  }

  function allocateObjectId(def: Omit<ObjectDefinition, "id">): number {
    if (nextObjectId > limits.maxObjectIds) {
      throw new Error(`run_officejs exceeded the sandbox object limit (${limits.maxObjectIds}).`);
    }
    const id = nextObjectId++;
    definitions.set(id, { ...def, id } as ObjectDefinition);
    return id;
  }

  // Pre-allocate root object IDs
  const CTX_ID = allocateObjectId({ kind: "root", root: "ctx" });
  const EXCEL_ID = allocateObjectId({ kind: "root", root: "excel" });

  function isProxy(value: any): boolean {
    return (typeof value === "object" && value !== null || typeof value === "function") && proxyToId.has(value);
  }

  function getProxyId(value: any): number | null {
    return isProxy(value) ? (proxyToId.get(value) ?? null) : null;
  }

  /**
   * Serialize a value for transmission to the host.
   * Proxy objects become `{ __officejsRef: id }`.
   * Throws if value is not serializable.
   */
  function serializeValue(value: any): any {
    const proxyId = getProxyId(value);
    if (proxyId != null) return { [staticConfig.serializedRefKey]: proxyId };

    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)))
      return value;
    if (typeof value === "bigint") return String(value);
    if (Array.isArray(value)) return value.map(v => serializeValue(v));
    if (_isPlainObject(value)) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) result[k] = serializeValue(v);
      }
      return result;
    }
    throw new Error(
      "run_officejs arguments and workbook payloads must be JSON-serializable primitives, arrays, or plain objects."
    );
  }

  /**
   * Export a result value for the RESULT message.
   * Proxy objects must have been resolved (via ctx.sync()) to be exportable.
   */
  function exportResult(value: any): any {
    if (value === undefined) return undefined;
    const proxyId = getProxyId(value);
    if (proxyId != null) {
      const snapshot = snapshots.get(proxyId);
      if (snapshot === undefined) {
        throw new Error(
          "run_officejs returned an unresolved Office proxy. Return primitives, arrays, or loaded plain objects instead."
        );
      }
      return deepClone(snapshot);
    }
    return serializeValue(value);
  }

  /**
   * Format a value for console.log display (best-effort, never throws).
   */
  function formatForLog(value: any): any {
    const proxyId = getProxyId(value);
    if (proxyId == null) {
      try { return exportResult(value); }
      catch { return String(value); }
    }
    const snapshot = snapshots.get(proxyId);
    return snapshot !== undefined ? deepClone(snapshot) : `[OfficejsProxy ${proxyId}]`;
  }

  /**
   * Check if a method name is a write operation (used to tag invoke commands).
   */
  function isWriteMethod(name: string): boolean {
    return /^(?:add|autofitColumns|autofitRows|clear|copyFrom|delete|insert|merge|remove|set|sort|unmerge)/u.test(name);
  }

  /**
   * Count cells in a matrix value (for maxMatrixWriteCells limit).
   */
  function countMatrixCells(value: any): number {
    if (!Array.isArray(value)) return 0;
    return value.every(Array.isArray)
      ? value.reduce((sum: number, row: any[]) => sum + row.length, 0)
      : value.length;
  }

  /**
   * Update the local snapshot when a property is set on a proxy.
   */
  function updateLocalSnapshot(targetId: number, property: string, value: any): void {
    const current = snapshots.get(targetId);
    const updated = _isPlainObject(current) && !Array.isArray(current)
      ? { ...current, [property]: deepClone(value) }
      : { [property]: deepClone(value) };
    snapshots.set(targetId, updated);

    // Also update the child property's snapshot if it exists
    const children = childProperties.get(targetId);
    const childId = children?.get(property);
    if (typeof childId === "number") {
      snapshots.set(childId, deepClone(value));
    }
  }

  /**
   * Enqueue a command, checking limits.
   */
  function enqueueCommand(cmd: Command): void {
    if (pendingCommands.length >= limits.maxQueuedOperations) {
      throw new Error(`run_officejs exceeded the queued operation limit (${limits.maxQueuedOperations}) before calling ctx.sync().`);
    }
    if (JSON.stringify(cmd).length > limits.maxSerializedChars) {
      throw new Error(`run_officejs produced an operation payload larger than the sandbox limit (${limits.maxSerializedChars} chars).`);
    }
    if (cmd.kind === "set") {
      const prop = cmd.property!.toLowerCase();
      if (["value", "values", "formula", "formulas", "numberformat", "numberformats"].includes(prop)) {
        if (countMatrixCells(cmd.value) > limits.maxMatrixWriteCells) {
          throw new Error(`run_officejs write payload exceeds the matrix cell limit (${limits.maxMatrixWriteCells} cells).`);
        }
      }
    }
    pendingCommands.push(cmd);
  }

  /**
   * Get or create a child property proxy.
   */
  function getOrCreateChildProxy(parentId: number, property: string): any {
    let children = childProperties.get(parentId);
    if (!children) {
      children = new Map();
      childProperties.set(parentId, children);
    }
    const existingId = children.get(property);
    if (typeof existingId === "number") return createProxy(existingId);

    const childId = allocateObjectId({ kind: "property", parentId, property });
    children.set(property, childId);
    return createProxy(childId);
  }

  /**
   * Apply sync response snapshots to the local state.
   */
  function applySyncResponse(responseSnapshots: Record<string, any>): void {
    for (const [key, value] of Object.entries(responseSnapshots)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0) continue;
      const cloned = deepClone(value);
      snapshots.set(id, cloned);

      // Propagate to child properties that already exist
      const children = childProperties.get(id);
      if (children && _isPlainObject(cloned) && !Array.isArray(cloned)) {
        for (const [prop, childId] of children.entries()) {
          if (Object.prototype.hasOwnProperty.call(cloned, prop)) {
            snapshots.set(childId, deepClone(cloned[prop]));
          }
        }
      }
    }
  }

  /**
   * Flush pending commands to the host via ctx.sync().
   */
  async function sync(): Promise<void> {
    const requestId = `req-${nextRequestId++}`;
    const payload: SyncRequestPayload = {
      requestId,
      definitions: Array.from(definitions.values()),
      commands: pendingCommands.splice(0, pendingCommands.length),
    };
    const response = await callbacks.callHost(payload);
    if (!response || response.requestId !== requestId) {
      throw new Error("run_officejs sandbox received an invalid sync response.");
    }
    applySyncResponse(response.snapshots);
  }

  /**
   * Get a primitive representation of a proxy (for valueOf / Symbol.toPrimitive).
   */
  function proxyToPrimitive(objectId: number): any {
    const snapshot = snapshots.get(objectId);
    if (snapshot === null) return null;
    if (typeof snapshot === "string" || typeof snapshot === "number" || typeof snapshot === "boolean")
      return snapshot;
    return `[OfficejsProxy ${objectId}]`;
  }

  /**
   * Create a Proxy object for a given object ID.
   * This is the core of the Excel API emulation.
   *
   * The proxy records property accesses, method calls, and property sets,
   * building up definitions and commands that are sent to the host on sync().
   *
   * Original: `AA` function (lines 234-310 of formatted source)
   */
  function createProxy(objectId: number): any {
    const cached = proxyCache.get(objectId);
    if (cached !== undefined) return cached;

    // Use a function target so the proxy can be called (for method invocations)
    const target = function () {};
    const proxy = new Proxy(target, {

      // --- Property access ---
      get(_target, prop) {
        // Prevent promise-like behavior (proxies should not be awaitable directly)
        if (prop === "then") return undefined;

        // .load() — enqueue a load command
        if (prop === "load") {
          return (...args: any[]) => {
            const spec = args.length <= 1 ? serializeValue(args[0] ?? null) : serializeValue(args);
            enqueueCommand({ kind: "load", targetId: objectId, spec });
            return proxy; // chainable
          };
        }

        // ctx.sync() — flush all pending operations
        if (objectId === CTX_ID && prop === "sync") return sync;

        // Serialization hooks
        if (prop === "toJSON") return () => cloneIfDefined(snapshots.get(objectId)) ?? {};
        if (prop === "valueOf") return () => proxyToPrimitive(objectId);
        if (prop === Symbol.toPrimitive) return () => proxyToPrimitive(objectId);
        if (prop === Symbol.toStringTag) return "OfficejsSandboxProxy";

        // Ignore non-string properties (symbols, etc.)
        if (typeof prop !== "string") return undefined;

        // If we have a snapshot with this property, return the value directly
        const snapshot = snapshots.get(objectId);
        const children = childProperties.get(objectId);
        const childId = children?.get(prop);

        if (_isPlainObject(snapshot) && !Array.isArray(snapshot) &&
            Object.prototype.hasOwnProperty.call(snapshot, prop)) {
          const value = snapshot[prop];
          // If it's a child proxy with a complex value, return the proxy
          if (typeof childId === "number" && _isPlainObject(value) && !Array.isArray(value)) {
            return createProxy(childId);
          }
          // Otherwise return a deep clone of the primitive/array value
          return deepClone(value);
        }

        // No snapshot data — return a child proxy (will be resolved on next sync)
        return getOrCreateChildProxy(objectId, prop);
      },

      // --- Property assignment ---
      set(_target, prop, value) {
        if (typeof prop !== "string") return false;
        const serialized = serializeValue(value);
        enqueueCommand({ kind: "set", targetId: objectId, property: prop, value: serialized });
        updateLocalSnapshot(objectId, prop, serialized);
        return true;
      },

      // --- Method invocation (proxy called as a function) ---
      apply(_target, _thisArg, args) {
        const def = definitions.get(objectId);
        if (!def || def.kind !== "property") {
          throw new Error("Only Office member proxies can be invoked as functions.");
        }
        const serializedArgs = Array.isArray(args) ? args.map(a => serializeValue(a)) : [];
        const resultId = allocateObjectId({
          kind: "invoke",
          parentId: def.parentId!,
          method: def.property!,
          args: serializedArgs,
        });
        enqueueCommand({
          kind: "invoke",
          targetId: def.parentId!,
          method: def.property!,
          resultId,
          args: serializedArgs,
          write: isWriteMethod(def.property!),
        });
        return createProxy(resultId);
      },
    });

    proxyCache.set(objectId, proxy);
    proxyToId.set(proxy, objectId);
    return proxy;
  }

  // --- Console wrapper ---

  function createConsoleMethod(level: string) {
    return (...args: any[]) => {
      callbacks.log(level, args.map(a => formatForLog(a)));
    };
  }

  // --- Public API ---

  return {
    ctx: createProxy(CTX_ID),
    Excel: createProxy(EXCEL_ID),
    console: {
      log: createConsoleMethod("log"),
      info: createConsoleMethod("info"),
      warn: createConsoleMethod("warn"),
      error: createConsoleMethod("error"),
      debug: createConsoleMethod("debug"),
      dir: createConsoleMethod("debug"),
      table: createConsoleMethod("log"),
    },
    /** Flush any remaining pending commands (called after user script completes) */
    flushPending: async () => {
      if (pendingCommands.length !== 0) await sync();
    },
    /** Export the user script's return value for the RESULT message */
    exportResult: (value: any) => exportResult(value),
  };
}

// ============================================================================
// Script Wrapping
// ============================================================================

/**
 * Wraps the user's script in the guest runtime scaffold.
 *
 * The wrapped script:
 * 1. Creates a guest runtime with ctx/Excel/console proxies
 * 2. Runs the user code as an async function with ctx, Excel, console args
 * 3. Flushes any pending commands
 * 4. Exports the result
 *
 * Original: `Bg` function (line 322 of formatted source)
 */
function wrapUserScript(userCode: string, limits: SandboxLimits = DEFAULT_LIMITS): string {
  const guestRuntimeSource = createGuestRuntime.toString();
  const limitsJson = JSON.stringify(limits);
  const staticConfigJson = JSON.stringify({
    defaultLimits: DEFAULT_LIMITS,
    serializedRefKey: SERIALIZED_REF_KEY,
  });

  return `
(() => {
  const __name = (target, _value) => target;
  const __createOfficejsSandboxGuestRuntime = (${guestRuntimeSource});
  const __guestRuntimeStaticConfig = ${staticConfigJson};
  const __guest = __createOfficejsSandboxGuestRuntime({
    callHost: __bpsHostCall,
    log: (level, values) => __bpsConsoleLog(level, values),
    limits: ${limitsJson},
  }, __guestRuntimeStaticConfig);
  return (async () => {
    const __result = await (async function runOfficeJsScript(ctx, Excel, console) {
      "use strict";
      ${userCode}
    })(__guest.ctx, __guest.Excel, __guest.console);
    await __guest.flushPending();
    return __guest.exportResult(__result);
  })();
})()
`;
}

// ============================================================================
// QuickJS Execution Engine
// ============================================================================

/**
 * Cached QuickJS WASM module (reused across invocations).
 * Original: `XA` variable + `Jg` function
 */
let cachedModule: Promise<QuickJSWASMModule> | null = null;

async function getOrCreateWasmModule(
  moduleLoader?: () => Promise<QuickJSWASMModule>
): Promise<QuickJSWASMModule> {
  if (moduleLoader) return moduleLoader();
  if (!cachedModule) {
    // Dynamic import so this file can be used without bundling quickjs-emscripten
    const { newQuickJSWASMModule } = await import("quickjs-emscripten");
    cachedModule = newQuickJSWASMModule();
  }
  return cachedModule;
}

/** Extract a human-readable error message from any value. Original: `OA` */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isPlainObject(error) && typeof (error as any).message === "string")
    return (error as any).message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

/** Safely dispose a QuickJS handle (no-op if null/disposed). Original: `wA` */
function safeDispose(handle: QuickJSHandle | null | undefined): void {
  handle?.dispose();
}

/** Convert a JSON-serializable value into a QuickJS handle. Original: `ng` */
function jsonToHandle(ctx: QuickJSContext, value: any): QuickJSHandle {
  const json = JSON.stringify(value);
  return ctx.unwrapResult(ctx.evalCode(`(${json})`));
}

/** Create a QuickJS Error handle from a JS error. Original: `dA` */
function createErrorHandle(ctx: QuickJSContext, error: unknown): QuickJSHandle {
  return ctx.newError(extractErrorMessage(error));
}

/** Define a global function in a QuickJS context. Original: `KI` */
function injectGlobalFunction(
  ctx: QuickJSContext,
  name: string,
  fn: (...args: QuickJSHandle[]) => QuickJSHandle
): void {
  const handle = ctx.newFunction(name, fn);
  ctx.setProp(ctx.global, name, handle);
  safeDispose(handle);
}

/**
 * Drain all pending QuickJS jobs (microtasks).
 * Keeps calling executePendingJobs() until no more jobs remain.
 * Original: `nI`
 */
function drainPendingJobs(runtime: QuickJSRuntime): void {
  while (runtime.hasPendingJob()) {
    const result = runtime.executePendingJobs();
    if ("error" in result) {
      const errorValue = (result.error as any).context.dump(result.error);
      safeDispose(result.error as any);
      throw new Error(extractErrorMessage(errorValue));
    }
  }
}

/**
 * Run a user script in the QuickJS sandbox.
 *
 * This is the core execution function. It:
 * 1. Initializes QuickJS with memory/stack limits and timeout
 * 2. Injects __bpsConsoleLog and __bpsHostCall bridge functions
 * 3. Wraps and evaluates the user script
 * 4. Returns the result and captured logs
 *
 * Original: `Lg` function (lines 4370-4447 of formatted source)
 */
async function runProgram(script: string, options: RunProgramOptions): Promise<ProgramResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const logBuffer = createLogBuffer();

  const module = await getOrCreateWasmModule(options.moduleLoader);
  const runtime = module.newRuntime();
  const ctx = runtime.newContext();
  const deadline = Date.now() + limits.timeoutMs;

  let alive = true;
  let deferredError: Error | null = null;

  // Configure runtime limits
  runtime.setMemoryLimit(MAX_MEMORY_BYTES);
  runtime.setMaxStackSize(MAX_STACK_BYTES);
  runtime.setInterruptHandler(() => Date.now() > deadline);

  /**
   * Record a captured error (first error wins).
   */
  const captureError = (error: unknown) => {
    if (!deferredError) {
      deferredError = error instanceof Error ? error : new Error(extractErrorMessage(error));
    }
  };

  /**
   * Drain pending jobs, capturing any errors.
   * Called after resolving host call promises so QuickJS can continue.
   * Original: `D` callback inside `Lg`
   */
  const pumpJobs = () => {
    if (!alive) return;
    try { drainPendingJobs(runtime); }
    catch (e) { captureError(e); }
  };

  // --- Inject __bpsConsoleLog ---
  injectGlobalFunction(ctx, "__bpsConsoleLog", (levelHandle, valuesHandle) => {
    const level = ctx.dump(levelHandle);
    const values = ctx.dump(valuesHandle);
    appendLog(
      logBuffer,
      typeof level === "string" && ["log", "info", "warn", "error", "debug"].includes(level)
        ? level : "log",
      Array.isArray(values) ? values : [values],
    );
    return ctx.undefined;
  });

  // --- Inject __bpsHostCall ---
  injectGlobalFunction(ctx, "__bpsHostCall", (payloadHandle) => {
    const payload = ctx.dump(payloadHandle);
    const deferred = ctx.newPromise();

    // Validate the sync request payload
    if (!isValidSyncRequest(payload)) {
      const err = createErrorHandle(ctx, new Error(
        "run_officejs sandbox produced an invalid sync request payload."
      ));
      deferred.reject(err);
      safeDispose(err);
      pumpJobs();
      return deferred.handle;
    }

    // Send to host and handle response
    options.hostCall(payload).then(
      (response) => {
        if (!alive) return;
        try {
          if (!isValidSyncResponse(response)) {
            const err = createErrorHandle(ctx, new Error(
              "run_officejs sandbox received an invalid sync response payload."
            ));
            deferred.reject(err);
            safeDispose(err);
            return;
          }
          const handle = jsonToHandle(ctx, response);
          deferred.resolve(handle);
          safeDispose(handle);
        } catch (e) {
          captureError(e);
          const err = createErrorHandle(ctx, e);
          deferred.reject(err);
          safeDispose(err);
        } finally {
          pumpJobs();
        }
      },
      (error) => {
        if (!alive) return;
        try {
          const err = createErrorHandle(ctx, error);
          deferred.reject(err);
          safeDispose(err);
        } catch (e) {
          captureError(e);
        } finally {
          pumpJobs();
        }
      }
    );

    return deferred.handle;
  });

  // --- Execute the script ---
  const wrappedScript = wrapUserScript(script, limits);
  let promiseHandle: QuickJSHandle | undefined;
  let resultHandle: QuickJSHandle | undefined;

  try {
    // Evaluate the wrapped script (returns a QuickJS Promise handle)
    promiseHandle = ctx.unwrapResult(ctx.evalCode(wrappedScript));

    // Drain initial pending jobs (runs the async function body)
    drainPendingJobs(runtime);

    // Await the QuickJS promise from native JS.
    //
    // BUG FIX: resolvePromise() internally calls promise.then(resolve, reject)
    // inside QuickJS, which registers a pending job. We must call
    // drainPendingJobs() AFTER resolvePromise sets up the .then() callback,
    // otherwise the native Promise never resolves.
    //
    // We schedule it as a microtask so it runs after resolvePromise returns
    // but before the await suspends to the event loop.
    const resultPromise = ctx.resolvePromise(promiseHandle);
    Promise.resolve().then(() => { try { drainPendingJobs(runtime); } catch (e) { captureError(e); } });

    // Race with a timeout to prevent unresolvable promises from hanging forever.
    // QuickJS's interrupt handler only fires during active JS execution, not
    // while a promise is pending. Without this, `await new Promise(() => {})`
    // would hang indefinitely.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("interrupted")), Math.max(0, deadline - Date.now()));
    });
    const resolved = await Promise.race([resultPromise, timeoutPromise]);

    resultHandle = ctx.unwrapResult(resolved);

    // Check for deferred errors from host calls
    if (deferredError) throw deferredError;

    // Extract and validate the result
    const result = ctx.dump(resultHandle);
    if (result !== undefined && !isSerializableValue(result)) {
      throw new Error(
        "run_officejs returned a non-serializable value. Return primitives, arrays, or plain objects."
      );
    }

    return { logs: logBuffer.entries, result };

  } catch (error) {
    throw new Error(formatErrorWithLogs(error, logBuffer.entries));
  } finally {
    alive = false;
    safeDispose(resultHandle);
    safeDispose(promiseHandle);
    ctx.dispose();
    runtime.dispose();
  }
}

// ============================================================================
// Sync Request/Response Validation
// ============================================================================

function isValidSyncRequest(payload: any): payload is SyncRequestPayload {
  return (
    isPlainObject(payload) &&
    typeof payload.requestId === "string" &&
    Array.isArray(payload.definitions) &&
    Array.isArray(payload.commands)
  );
}

function isValidSyncResponse(payload: any): payload is SyncResponsePayload {
  return (
    isPlainObject(payload) &&
    typeof payload.requestId === "string" &&
    isPlainObject(payload.snapshots)
  );
}

// ============================================================================
// MessageChannel Protocol Handler
// ============================================================================

/**
 * Attach a bootstrap listener on the window.
 * Waits for a BOOTSTRAP message from the host, then creates a port session.
 *
 * Original: `Hg` function (lines 4449-4471)
 */
function attachBootstrapListener(
  options: {
    windowRef?: Window;
    runProgram?: typeof runProgram;
  } = {}
): () => void {
  const win = options.windowRef ?? window;
  const run = options.runProgram ?? runProgram;
  let bootstrapped = false;
  let disposeSession: (() => void) | null = null;

  const onMessage = (event: MessageEvent) => {
    if (bootstrapped || event.source !== win.parent || !isBootstrapMessage(event.data)) return;

    console.info("[bps][officejs-sandbox] guest received bootstrap message", {
      invocationId: event.data.invocationId,
    });

    const [port] = event.ports;
    if (!port) {
      console.error("[bps][officejs-sandbox] guest bootstrap missing MessagePort");
      return;
    }

    bootstrapped = true;
    disposeSession = createPortSession(port, {
      invocationId: event.data.invocationId,
      nonce: event.data.nonce,
      runProgram: run,
    });
  };

  win.addEventListener("message", onMessage);
  console.info("[bps][officejs-sandbox] guest bootstrap listener attached");

  return () => {
    win.removeEventListener("message", onMessage);
    disposeSession?.();
    disposeSession = null;
  };
}

/**
 * Create a MessagePort session that handles the RUN/SYNC protocol.
 *
 * Lifecycle:
 * 1. Send READY on the port
 * 2. Wait for RUN message with script + limits
 * 3. Execute script, brokering SYNC_REQUEST/SYNC_RESPONSE as needed
 * 4. Send RESULT or ERROR
 * 5. Dispose session
 *
 * Original: `Yg` function (lines 4473-4571)
 */
function createPortSession(
  port: MessagePort,
  options: {
    invocationId: string;
    nonce: string;
    runProgram: (script: string, opts: RunProgramOptions) => Promise<ProgramResult>;
  }
): () => void {
  const { invocationId, nonce, runProgram: run } = options;

  /** Pending sync request promises (requestId → resolve/reject) */
  const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

  let disposed = false;
  let hasReceivedRun = false;

  // --- Host call handler (sends SYNC_REQUEST, returns Promise for SYNC_RESPONSE) ---
  const hostCall = (payload: SyncRequestPayload): Promise<SyncResponsePayload> => {
    return new Promise((resolve, reject) => {
      console.info("[bps][officejs-sandbox] guest sending sync request", {
        invocationId,
        requestId: payload.requestId,
        commandCount: payload.commands.length,
      });
      pendingRequests.set(payload.requestId, { resolve, reject });
      port.postMessage({
        type: MSG.SYNC_REQUEST,
        protocolVersion: PROTOCOL_VERSION,
        invocationId,
        nonce,
        payload,
      });
    });
  };

  // --- Send error and dispose ---
  const sendError = (message: string): void => {
    if (disposed) return;
    console.error("[bps][officejs-sandbox] guest session failed", { invocationId, message });
    port.postMessage({
      type: MSG.ERROR,
      protocolVersion: PROTOCOL_VERSION,
      invocationId,
      nonce,
      error: message,
      logs: [],
    });
    dispose();
  };

  // --- Port message handler ---
  const onPortMessage = (event: MessageEvent): void => {
    if (disposed) return;
    const msg = event.data;

    console.info("[bps][officejs-sandbox] guest received port message", {
      invocationId,
      type: typeof msg === "object" && msg !== null && "type" in msg ? msg.type : typeof msg,
    });

    // --- SYNC_RESPONSE ---
    if (isSyncResponseMessage(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        sendError("run_officejs sandbox received a sync response for the wrong invocation.");
        return;
      }
      const pending = pendingRequests.get(msg.payload.requestId);
      if (!pending) {
        sendError("run_officejs sandbox received an unexpected sync response id.");
        return;
      }
      pendingRequests.delete(msg.payload.requestId);
      pending.resolve(msg.payload);
      return;
    }

    // --- RUN ---
    if (isRunMessage(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        sendError("run_officejs sandbox received a run request for the wrong invocation.");
        return;
      }
      if (hasReceivedRun) {
        sendError("run_officejs sandbox received a duplicate run request.");
        return;
      }
      hasReceivedRun = true;

      console.info("[bps][officejs-sandbox] guest received run request", {
        invocationId,
        timeoutMs: msg.limits.timeoutMs,
      });

      run(msg.script, { hostCall, limits: msg.limits }).then(
        (result) => {
          if (disposed) return;
          console.info("[bps][officejs-sandbox] guest run completed", {
            invocationId,
            logCount: result.logs.length,
          });
          port.postMessage({
            type: MSG.RESULT,
            protocolVersion: PROTOCOL_VERSION,
            invocationId,
            nonce,
            result: result.result,
            logs: result.logs,
          });
          dispose();
        },
        (error) => {
          if (disposed) return;
          console.error("[bps][officejs-sandbox] guest run failed", {
            invocationId,
            error: error instanceof Error ? error.message : String(error),
          });
          port.postMessage({
            type: MSG.ERROR,
            protocolVersion: PROTOCOL_VERSION,
            invocationId,
            nonce,
            error: error instanceof Error ? error.message : String(error),
            logs: [],
          });
          dispose();
        },
      );
      return;
    }

    // --- Unknown message ---
    sendError("run_officejs sandbox received an invalid port message.");
  };

  // --- Dispose session ---
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    port.removeEventListener("message", onPortMessage);
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error("run_officejs sandbox session was disposed."));
    }
    pendingRequests.clear();
    port.close?.();
  };

  // --- Start session ---
  port.addEventListener("message", onPortMessage);
  port.start?.();

  console.info("[bps][officejs-sandbox] guest port session attached", { invocationId });

  // Send READY to tell the host we're listening
  port.postMessage({
    type: MSG.READY,
    protocolVersion: PROTOCOL_VERSION,
    invocationId,
    nonce,
  });

  return dispose;
}

// ============================================================================
// Entry Point
// ============================================================================

// Auto-attach bootstrap listener when running in a browser iframe
if (typeof window !== "undefined") {
  console.info("[bps][officejs-sandbox] guest sandbox entry loaded");
  attachBootstrapListener();
}

// ============================================================================
// Exports (for testing)
// ============================================================================

export {
  // Protocol
  MSG,
  PROTOCOL_VERSION,
  DEFAULT_LIMITS,
  SERIALIZED_REF_KEY,

  // Core functions
  createGuestRuntime,
  wrapUserScript,
  runProgram,
  attachBootstrapListener,
  createPortSession,

  // Helpers
  createLogBuffer,
  appendLog,
  formatErrorWithLogs,
  isSerializableValue,
  drainPendingJobs,
  extractErrorMessage,

  // Types
  type SandboxLimits,
  type LogEntry,
  type LogBuffer,
  type SyncRequestPayload,
  type SyncResponsePayload,
  type ProgramResult,
  type RunProgramOptions,
  type ObjectDefinition,
  type Command,
};
