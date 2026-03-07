/**
 * sandbox-host.ts — Clean reimplementation of the host-side sandbox broker.
 *
 * This runs in the main add-in context (not in the iframe). It:
 * 1. Creates a sandboxed iframe and establishes a MessageChannel
 * 2. Drives the BOOTSTRAP → READY → RUN protocol
 * 3. Handles SYNC_REQUEST by replaying definitions/commands against the real Excel API
 * 4. Returns the RESULT or throws on ERROR/timeout
 *
 * Original function mapping (from app-Fv2Lr-FU.js):
 *   CFe  → createSyncRequestBroker   (replays sandbox operations against Excel)
 *   EFe  → runSandboxSession         (iframe lifecycle + protocol driver)
 *   bFe  → createSandboxIframe       (iframe element factory)
 *   Wd   → safeSerialize             (serialize Office.js objects to JSON)
 *   WQ   → readProperty              (read property from host object)
 *   WT   → callMethod                (call method on host object)
 *   mFe  → writeProperty             (write property on host object)
 *   zH   → assertObject              (assert value is an object/function)
 */

// ============================================================================
// Types
// ============================================================================

/** Mirrors the sandbox-side types */

interface SandboxLimits {
  maxObjectIds: number;
  maxQueuedOperations: number;
  maxSerializedChars: number;
  maxMatrixWriteCells: number;
  timeoutMs: number;
}

interface ObjectDefinition {
  id: number;
  kind: "root" | "property" | "invoke";
  root?: string;
  parentId?: number;
  property?: string;
  method?: string;
  args?: any[];
}

interface Command {
  kind: "load" | "set" | "invoke";
  targetId: number;
  spec?: any;
  property?: string;
  value?: any;
  method?: string;
  resultId?: number;
  args?: any[];
  write?: boolean;
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

interface LogEntry {
  level: string;
  message: string;
}

interface SandboxResult {
  result: any;
  logs: LogEntry[];
}

// ============================================================================
// Protocol Constants
// ============================================================================

const PROTOCOL_VERSION = 1;

const MSG = {
  BOOTSTRAP:     "bps.officejs-sandbox.bootstrap",
  READY:         "bps.officejs-sandbox.ready",
  RUN:           "bps.officejs-sandbox.run",
  SYNC_REQUEST:  "bps.officejs-sandbox.sync_request",
  SYNC_RESPONSE: "bps.officejs-sandbox.sync_response",
  RESULT:        "bps.officejs-sandbox.result",
  ERROR:         "bps.officejs-sandbox.error",
} as const;

const SERIALIZED_REF_KEY = "__officejsRef";

const DEFAULT_LIMITS: SandboxLimits = {
  maxObjectIds: 256,
  maxQueuedOperations: 256,
  maxSerializedChars: 200_000,
  maxMatrixWriteCells: 10_000,
  timeoutMs: 20_000,
};

// ============================================================================
// Message Type Guards
// ============================================================================

function isPlainObject(v: unknown): v is Record<string, any> {
  if (typeof v !== "object" || v === null) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function isObjectOrFunction(v: unknown): v is object {
  return (typeof v === "object" && v !== null) || typeof v === "function";
}

function isProtoMsg(msg: unknown, type: string): msg is Record<string, any> {
  return (
    isPlainObject(msg) &&
    msg.type === type &&
    msg.protocolVersion === PROTOCOL_VERSION &&
    typeof msg.invocationId === "string" &&
    typeof msg.nonce === "string"
  );
}

function isReadyMessage(msg: unknown): boolean {
  return isProtoMsg(msg, MSG.READY);
}

function isSyncRequestMessage(msg: unknown): msg is Record<string, any> {
  return isProtoMsg(msg, MSG.SYNC_REQUEST) && isPlainObject((msg as any).payload);
}

function isResultMessage(msg: unknown): msg is Record<string, any> {
  return isProtoMsg(msg, MSG.RESULT) && Array.isArray((msg as any).logs);
}

function isErrorMessage(msg: unknown): msg is Record<string, any> {
  return isProtoMsg(msg, MSG.ERROR) && typeof (msg as any).error === "string";
}

// ============================================================================
// Serialization — Host Object → JSON
// ============================================================================

/**
 * Safely serialize an Office.js object (or any value) to a JSON-compatible form.
 * Handles loaded properties, toJSON(), circular references, Date, etc.
 *
 * Original: `Wd` function
 */
function safeSerialize(value: any, seen = new Set<object>()): any {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)))
    return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol")
    return undefined;

  if (Array.isArray(value)) {
    return value.map(item => {
      const s = safeSerialize(item, seen);
      return s === undefined ? null : s;
    });
  }

  if (!isObjectOrFunction(value)) return String(value);

  // Circular reference guard
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  // Date → ISO string
  if (value instanceof Date) return value.toISOString();

  // Try toJSON()
  if (typeof (value as any).toJSON === "function") {
    try {
      const json = (value as any).toJSON();
      if (json !== value) return safeSerialize(json, seen);
    } catch { /* ignore */ }
  }

  // Plain object
  if (isPlainObject(value)) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = safeSerialize(v, seen);
      if (s !== undefined) result[k] = s;
    }
    return result;
  }

  // Last resort: try JSON round-trip
  try {
    const parsed = JSON.parse(JSON.stringify(value));
    if (isSerializableValue(parsed)) return parsed;
  } catch { /* ignore */ }

  return undefined;
}

function isSerializableValue(v: any): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v)))
    return true;
  if (Array.isArray(v)) return v.every(isSerializableValue);
  if (isPlainObject(v)) return Object.values(v).every(isSerializableValue);
  return false;
}

function isProxyRef(v: any): boolean {
  return isPlainObject(v) && typeof v[SERIALIZED_REF_KEY] === "number";
}

function isWriteMethod(name: string): boolean {
  return /^(?:add|autofitColumns|autofitRows|clear|copyFrom|delete|insert|merge|remove|set|sort|unmerge)/u.test(name);
}

function countMatrixCells(value: any): number {
  if (!Array.isArray(value)) return 0;
  return value.every(Array.isArray)
    ? value.reduce((sum: number, row: any[]) => sum + row.length, 0)
    : value.length;
}

function jsonSize(value: any): number {
  return JSON.stringify(value).length;
}

function deepClone(value: any): any {
  return JSON.parse(JSON.stringify(value));
}

// ============================================================================
// Host Object Operations
// ============================================================================

/** Assert that a value is an object or function. Original: `zH` */
function assertObject(value: any, message: string): any {
  if (!isObjectOrFunction(value)) throw new Error(message);
  return value;
}

/** Read a property from a host object. Original: `WQ` */
function readProperty(obj: any, property: string): any {
  return assertObject(obj, `Cannot read property "${property}" from a non-object host reference.`)[property];
}

/** Write a property on a host object. Original: `mFe` */
function writeProperty(obj: any, property: string, value: any): void {
  assertObject(obj, `Cannot write property "${property}" on a non-object host reference.`)[property] = value;
}

/** Call a method on a host object. Original: `WT` */
function callMethod(obj: any, method: string, args: any[]): any {
  const fn = assertObject(obj, `Cannot call "${method}" on a non-object host reference.`)[method];
  if (typeof fn !== "function") {
    throw new Error(`Office.js sandbox tried to call missing method "${method}".`);
  }
  return Reflect.apply(fn, obj, args);
}

// ============================================================================
// Sync Request Broker
// ============================================================================

interface BrokerOptions {
  /** The real Excel.RequestContext */
  context: any;
  /** The real Excel namespace object */
  excelApi: any;
  /** Sandbox execution limits */
  limits: SandboxLimits;
  /** Whether the script is allowed to make destructive changes */
  destructive: boolean;
}

/**
 * Creates a broker that replays sandbox SYNC_REQUEST operations against the
 * real Excel API.
 *
 * The broker maintains a mapping from sandbox object IDs to real Office.js objects.
 * When a SYNC_REQUEST arrives:
 * 1. Walk the definitions to build the object graph (resolve properties, record invocations)
 * 2. Execute commands (load, set, invoke)
 * 3. Call ctx.sync() to flush to Excel
 * 4. Serialize all resolved objects into snapshots
 * 5. Return the SYNC_RESPONSE
 *
 * Original: `CFe` function (lines 26490-26600 of formatted app source)
 */
function createSyncRequestBroker(options: BrokerOptions) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };

  /**
   * All definitions ever received (accumulated across multiple sync requests).
   * Once a definition is registered, it cannot be redefined with different content.
   */
  const definitions = new Map<number, ObjectDefinition>();

  /**
   * Resolved host objects by ID. Pre-populated with the two roots:
   *   id 1 → ctx (Excel.RequestContext)
   *   id 2 → Excel namespace
   */
  const resolvedObjects = new Map<number, any>([
    [1, options.context],
    [2, options.excelApi],
  ]);

  /**
   * Register new definitions, checking for conflicts with existing ones.
   */
  function registerDefinitions(defs: ObjectDefinition[]): void {
    for (const def of defs) {
      const existing = definitions.get(def.id);
      if (!existing) {
        definitions.set(def.id, def);
        continue;
      }
      // Verify it's the same definition (idempotent re-registration is OK)
      if (JSON.stringify(existing) !== JSON.stringify(def)) {
        throw new Error(
          `run_officejs sandbox attempted to redefine host object id ${def.id}.`
        );
      }
    }
  }

  /**
   * Resolve a definition ID to a real host object.
   * Walks the definition graph recursively.
   */
  function resolveObject(id: number): any {
    // Already resolved?
    if (resolvedObjects.has(id)) return resolvedObjects.get(id);

    const def = definitions.get(id);
    if (!def) {
      throw new Error(`run_officejs sandbox referenced unknown host object id ${id}.`);
    }

    if (def.kind === "root") {
      const obj = def.root === "ctx" ? options.context : options.excelApi;
      resolvedObjects.set(id, obj);
      return obj;
    }

    if (def.kind === "invoke") {
      // Invocation results are populated by commands, not definitions.
      // If we get here, the sandbox tried to use an invocation result before
      // the command that produces it has been executed.
      throw new Error(
        `run_officejs sandbox referenced invocation result ${id} before it was produced by the broker.`
      );
    }

    // kind === "property"
    const parent = resolveObject(def.parentId!);
    const value = readProperty(parent, def.property!);
    resolvedObjects.set(id, value);
    return value;
  }

  /**
   * Deserialize a value from the sandbox, resolving any proxy references
   * (objects with __officejsRef) back to real host objects.
   */
  function deserializeValue(value: any): any {
    if (isProxyRef(value)) return resolveObject(value[SERIALIZED_REF_KEY]);
    if (Array.isArray(value)) return value.map(v => deserializeValue(v));
    if (isPlainObject(value)) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) result[k] = deserializeValue(v);
      return result;
    }
    return value;
  }

  /**
   * Assert destructive permission. Throws if destructive=false.
   */
  function assertDestructive(reason: string): void {
    if (!options.destructive) throw new Error(reason);
  }

  /**
   * Validate a sync request payload (size limits, cell limits).
   */
  function validatePayload(payload: SyncRequestPayload): void {
    const serialized = safeSerialize(payload);
    if (!serialized) return;
    if (jsonSize(serialized) > limits.maxSerializedChars) {
      throw new Error(
        `run_officejs sandbox payload exceeds the broker size limit (${limits.maxSerializedChars} chars).`
      );
    }
    for (const cmd of payload.commands) {
      if (cmd.kind === "set" && countMatrixCells(cmd.value) > limits.maxMatrixWriteCells) {
        throw new Error(
          `run_officejs write payload exceeds the matrix cell limit (${limits.maxMatrixWriteCells} cells).`
        );
      }
    }
  }

  /**
   * Process a SYNC_REQUEST: replay operations against Excel, call ctx.sync(),
   * and return snapshots.
   */
  async function handleSyncRequest(payload: SyncRequestPayload): Promise<SyncResponsePayload> {
    // 1. Register all definitions
    registerDefinitions(payload.definitions);

    // 2. Validate payload limits
    validatePayload(payload);

    // 3. Execute commands
    for (const cmd of payload.commands) {
      if (cmd.kind === "load") {
        // Load properties on a host object
        const target = resolveObject(cmd.targetId);
        const spec = deserializeValue(cmd.spec);
        if (spec === null) {
          callMethod(target, "load", []);
        } else {
          callMethod(target, "load", [spec]);
        }
        continue;
      }

      if (cmd.kind === "set") {
        // Write a property on a host object
        assertDestructive(
          "destructive=false but the script appears to modify the workbook. Set destructive=true for edits."
        );
        const target = resolveObject(cmd.targetId);
        writeProperty(target, cmd.property!, deserializeValue(cmd.value));
        continue;
      }

      // cmd.kind === "invoke"
      // Check destructive permission for write methods
      if (cmd.write || isWriteMethod(cmd.method!)) {
        assertDestructive(
          "destructive=false but the script appears to modify the workbook. Set destructive=true for edits."
        );
      }

      const target = resolveObject(cmd.targetId);
      const args = cmd.args!.map(a => deserializeValue(a));
      const result = callMethod(target, cmd.method!, args);
      resolvedObjects.set(cmd.resultId!, result);
    }

    // 4. Call ctx.sync() to flush all queued operations to Excel
    const syncFn = readProperty(options.context, "sync");
    if (typeof syncFn !== "function") {
      throw new Error("Excel RequestContext is missing sync().");
    }
    await Reflect.apply(syncFn, options.context, []);

    // 5. Build snapshots from all resolved objects
    const snapshots: Record<string, any> = {};
    let totalSize = 0;

    for (const [id, def] of definitions.entries()) {
      // Skip root definitions (ctx, Excel)
      if (def.kind === "root") continue;

      // Get the resolved host object
      const hostObj = def.kind === "property"
        ? resolveObject(id)
        : resolvedObjects.has(id)
          ? resolvedObjects.get(id)
          : undefined;

      const serialized = safeSerialize(hostObj);
      if (serialized === undefined) continue;

      totalSize += jsonSize(serialized);
      if (totalSize > limits.maxSerializedChars) {
        throw new Error(
          `run_officejs sandbox response exceeds the broker size limit (${limits.maxSerializedChars} chars).`
        );
      }

      snapshots[String(id)] = deepClone(serialized);
    }

    return { requestId: payload.requestId, snapshots };
  }

  return { handleSyncRequest };
}

// ============================================================================
// Iframe Sandbox Session
// ============================================================================

interface SandboxSessionOptions {
  /** User script to execute */
  script: string;
  /** The real Excel.RequestContext (from Excel.run callback) */
  context: any;
  /** The real Excel namespace object */
  excelApi: any;
  /** Whether the script may modify the workbook */
  destructive: boolean;
  /** Execution limits */
  limits?: Partial<SandboxLimits>;
  /** URL path to the sandbox page (default: auto-detected from meta tag) */
  sandboxUrl?: string;
  /** Override: window reference */
  windowRef?: Window;
  /** Override: document reference */
  documentRef?: Document;
  /** Override: iframe factory */
  iframeFactory?: (doc: Document) => HTMLIFrameElement;
  /** Override: MessageChannel factory */
  createMessageChannel?: () => MessageChannel;
}

/**
 * Create the sandbox iframe element.
 * Original: `bFe` function
 */
function createSandboxIframe(doc: Document): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.display = "none";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  return iframe;
}

/**
 * Generate a unique ID (UUID if available, fallback to timestamp+random).
 * Original: `GQ` function
 */
function generateId(win: Window): string {
  if (typeof win.crypto?.randomUUID === "function") {
    return win.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Detect the sandbox page URL from the document's meta tag.
 * The production app uses: <meta name="bps-app-base-path" content="/path/">
 * and appends "sandbox/" to it.
 *
 * Original: `xFe` function (combines `vFe`, `yFe`, `_Fe`)
 */
function detectSandboxUrl(doc: Document, win: Window): string {
  const meta = doc.querySelector('meta[name="bps-app-base-path"]');
  const content = meta?.getAttribute("content")?.trim();
  if (!content) {
    throw new Error("Missing app base path metadata for run_officejs sandbox bootstrap.");
  }

  let basePath: string;
  if (content.startsWith("/")) {
    basePath = content.endsWith("/") ? content : `${content}/`;
  } else {
    const url = new URL(content, win.location.href);
    basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  }

  return `${basePath}sandbox/`;
}

/**
 * Format an error with optional console logs for display.
 */
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

/**
 * Run a script in a sandboxed iframe, brokering all Excel API calls.
 *
 * This is the main host-side entry point. It:
 * 1. Creates a sandboxed iframe and MessageChannel
 * 2. Posts BOOTSTRAP with the port
 * 3. Waits for READY, sends RUN
 * 4. Handles SYNC_REQUEST/SYNC_RESPONSE for Excel API calls
 * 5. Returns the RESULT or throws on ERROR/timeout
 *
 * Original: `EFe` function (lines 26690-26860 of formatted app source)
 */
async function runSandboxSession(options: SandboxSessionOptions): Promise<SandboxResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const win = options.windowRef ?? window;
  const doc = options.documentRef ?? document;
  const body = doc.body;
  if (!body) {
    throw new Error("run_officejs sandbox requires document.body to exist.");
  }

  // Create the sync request broker
  const broker = createSyncRequestBroker({
    context: options.context,
    excelApi: options.excelApi,
    limits,
    destructive: options.destructive,
  });

  // Create iframe and message channel
  const iframe = options.iframeFactory?.(doc) ?? createSandboxIframe(doc);
  const channel = options.createMessageChannel?.() ?? new MessageChannel();
  const invocationId = generateId(win);
  const nonce = generateId(win);

  console.info("[bps][officejs-sandbox] starting iframe sandbox session", {
    invocationId,
    timeoutMs: limits.timeoutMs,
  });

  return new Promise<SandboxResult>((resolve, reject) => {
    let timeoutHandle = 0;
    let settled = false;

    /** Settle exactly once (first call wins) */
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    /** Clean up all resources */
    const cleanup = () => {
      if (timeoutHandle) win.clearTimeout(timeoutHandle);
      channel.port1.removeEventListener("message", onPortMessage);
      channel.port1.close?.();
      channel.port2.close?.();
      iframe.removeEventListener("load", onIframeLoad);
      iframe.removeEventListener("error", onIframeError);
      iframe.remove();
    };

    /** Fail the session */
    const fail = (message: string) => {
      console.error("[bps][officejs-sandbox] iframe sandbox failed", {
        invocationId,
        message,
      });
      settle(() => {
        cleanup();
        reject(new Error(message));
      });
    };

    /** Succeed the session */
    const succeed = (result: SandboxResult) => {
      console.info("[bps][officejs-sandbox] iframe sandbox completed", {
        invocationId,
        logCount: result.logs.length,
      });
      settle(() => {
        cleanup();
        resolve(result);
      });
    };

    // --- Port message handler ---
    const onPortMessage = (event: MessageEvent) => {
      const msg = event.data;

      console.info("[bps][officejs-sandbox] parent received port message", {
        invocationId,
        type: isPlainObject(msg) ? msg.type : typeof msg,
      });

      // --- READY ---
      if (isReadyMessage(msg)) {
        if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
          fail("run_officejs sandbox iframe replied with the wrong bootstrap identity.");
          return;
        }
        console.info("[bps][officejs-sandbox] sandbox ready; sending run request", {
          invocationId,
        });
        channel.port1.postMessage({
          type: MSG.RUN,
          protocolVersion: PROTOCOL_VERSION,
          invocationId,
          nonce,
          script: options.script,
          limits,
        });
        return;
      }

      // --- SYNC_REQUEST ---
      if (isSyncRequestMessage(msg)) {
        if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
          fail("run_officejs sandbox iframe sent a sync request for the wrong invocation.");
          return;
        }
        console.info("[bps][officejs-sandbox] sandbox requested host sync", {
          invocationId,
          requestId: msg.payload.requestId,
          commandCount: msg.payload.commands.length,
        });

        broker.handleSyncRequest(msg.payload).then(
          (response) => {
            console.info("[bps][officejs-sandbox] sending host sync response", {
              invocationId,
              requestId: response.requestId,
            });
            channel.port1.postMessage({
              type: MSG.SYNC_RESPONSE,
              protocolVersion: PROTOCOL_VERSION,
              invocationId,
              nonce,
              payload: response,
            });
          },
          (error) => {
            fail(formatErrorWithLogs(error, []));
          },
        );
        return;
      }

      // --- RESULT ---
      if (isResultMessage(msg)) {
        if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
          fail("run_officejs sandbox iframe returned a result for the wrong invocation.");
          return;
        }
        succeed({ logs: msg.logs, result: msg.result });
        return;
      }

      // --- ERROR ---
      if (isErrorMessage(msg)) {
        if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
          fail("run_officejs sandbox iframe returned an error for the wrong invocation.");
          return;
        }
        fail(formatErrorWithLogs(new Error(msg.error), msg.logs));
        return;
      }

      fail("run_officejs sandbox iframe sent an invalid protocol message.");
    };

    // --- Iframe load handler: send BOOTSTRAP ---
    const onIframeLoad = () => {
      console.info("[bps][officejs-sandbox] iframe load event fired", {
        invocationId,
        src: iframe.src,
      });
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) {
        fail("run_officejs sandbox iframe did not expose a contentWindow.");
        return;
      }
      console.info("[bps][officejs-sandbox] posting bootstrap message to iframe", {
        invocationId,
      });
      contentWindow.postMessage(
        {
          type: MSG.BOOTSTRAP,
          protocolVersion: PROTOCOL_VERSION,
          invocationId,
          nonce,
        },
        "*",
        [channel.port2],
      );
    };

    // --- Iframe error handler ---
    const onIframeError = () => {
      console.error("[bps][officejs-sandbox] iframe error event fired", {
        invocationId,
        src: iframe.src,
      });
      fail("run_officejs sandbox iframe failed to load.");
    };

    // --- Wire up event listeners ---
    channel.port1.addEventListener("message", onPortMessage);
    channel.port1.start?.();
    iframe.addEventListener("load", onIframeLoad);
    iframe.addEventListener("error", onIframeError);

    // --- Set iframe source and append to DOM ---
    iframe.src = options.sandboxUrl ?? detectSandboxUrl(doc, win);

    console.info("[bps][officejs-sandbox] appending iframe", {
      invocationId,
      src: iframe.src,
    });

    body.appendChild(iframe);

    // --- Timeout ---
    timeoutHandle = win.setTimeout(() => {
      console.error("[bps][officejs-sandbox] iframe sandbox timed out", {
        invocationId,
        timeoutMs: limits.timeoutMs,
        src: iframe.src,
      });
      fail(`run_officejs sandbox timed out after ${limits.timeoutMs}ms.`);
    }, limits.timeoutMs) as unknown as number;
  });
}

// ============================================================================
// Integration with run_officejs tool
// ============================================================================

/**
 * Create a sandbox runner function suitable for passing to the `run_officejs`
 * tool as `_sandboxRunner`.
 *
 * Usage in the add-in:
 * ```ts
 * import { run_officejs } from "./tools";
 * import { createSandboxRunner } from "./sandbox-host";
 *
 * // Inside your tool dispatch:
 * const result = await run_officejs({
 *   code: userScript,
 *   destructive: true,
 *   _sandboxRunner: createSandboxRunner({ sandboxUrl: "/sandbox/" }),
 * });
 * ```
 */
function createSandboxRunner(options: {
  sandboxUrl?: string;
  excelApi?: any;
} = {}) {
  return async function sandboxRunner(
    script: string,
    ctx: any, // Excel.RequestContext
  ): Promise<{ result?: any; logs?: LogEntry[] }> {
    const excelApi = options.excelApi ?? (typeof globalThis !== "undefined" && (globalThis as any).Excel ? (globalThis as any).Excel : undefined);
    if (!excelApi) {
      throw new Error("Excel API not available.");
    }

    const result = await runSandboxSession({
      script,
      context: ctx,
      excelApi,
      destructive: true, // The tool validates destructive permission before calling us
      sandboxUrl: options.sandboxUrl,
    });

    return { result: result.result, logs: result.logs };
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  // Main entry points
  runSandboxSession,
  createSyncRequestBroker,
  createSandboxRunner,

  // Helpers
  createSandboxIframe,
  detectSandboxUrl,
  safeSerialize,
  formatErrorWithLogs,

  // Re-exported for testing
  readProperty,
  writeProperty,
  callMethod,
  assertObject,

  // Types
  type SandboxSessionOptions,
  type SandboxResult,
  type SandboxLimits,
  type SyncRequestPayload,
  type SyncResponsePayload,
  type LogEntry,
  type ObjectDefinition,
  type Command,
  type BrokerOptions,
};
