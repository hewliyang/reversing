/**
 * Clean reimplementation of the Basispoints Office.js sandbox system.
 *
 * The sandbox allows AI-generated JavaScript to interact with the Excel API
 * without direct access to the DOM, network, or host environment. It works via:
 *
 * 1. Host creates a sandboxed iframe (`allow-scripts` only — no DOM/network access)
 * 2. Host sends the script to the iframe over a MessageChannel
 * 3. The iframe executes the script; when it needs Excel API access, it sends
 *    structured "sync requests" back to the host via the MessageChannel
 * 4. The host "broker" resolves those requests against real Office.js objects
 *    and sends snapshots (serialized property values) back to the iframe
 * 5. The iframe returns the final result (or error) to the host
 *
 * Reconstructed from app-Fv2Lr-FU.js + officejs-sandbox-protocol-DHHFLCK9.js
 */

// ===========================================================================
// PROTOCOL CONSTANTS & TYPES
// ===========================================================================

/** Protocol version */
export const PROTOCOL_VERSION = 1;

/** Message type constants for the host ↔ iframe communication */
export const MessageTypes = {
  /** Host → iframe: initial bootstrap (carries MessagePort) */
  BOOTSTRAP: "bps.officejs-sandbox.bootstrap",
  /** Iframe → host: sandbox is ready to receive script */
  READY: "bps.officejs-sandbox.ready",
  /** Host → iframe: run this script */
  RUN: "bps.officejs-sandbox.run",
  /** Iframe → host: need to execute Office.js operations */
  SYNC_REQUEST: "bps.officejs-sandbox.sync_request",
  /** Host → iframe: here are the results of your operations */
  SYNC_RESPONSE: "bps.officejs-sandbox.sync_response",
  /** Iframe → host: script completed successfully */
  RESULT: "bps.officejs-sandbox.result",
  /** Iframe → host: script failed */
  ERROR: "bps.officejs-sandbox.error",
} as const;

/** Special property key used to reference host objects from the sandbox */
export const OFFICEJS_REF_KEY = "__officejsRef";

/** Default resource limits for the sandbox */
export const DEFAULT_LIMITS: SandboxLimits = {
  maxObjectIds: 256,
  maxQueuedOperations: 256,
  maxSerializedChars: 200_000,
  maxMatrixWriteCells: 10_000,
  timeoutMs: 20_000,
};

/** Console log limits */
const MAX_LOG_ENTRIES = 120;
const MAX_LOG_ENTRY_CHARS = 800;
const MAX_TOTAL_LOG_CHARS = 20_000;
const LOG_TRUNCATED_MSG = "[officejs sandbox logs truncated]";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface SandboxLimits {
  maxObjectIds: number;
  maxQueuedOperations: number;
  maxSerializedChars: number;
  maxMatrixWriteCells: number;
  timeoutMs: number;
}

/** Log entry captured from sandbox console output */
export interface LogEntry {
  level: string;
  message: string;
}

/** Result returned from sandbox execution */
export interface SandboxResult {
  result?: any;
  logs: LogEntry[];
}

/**
 * An object definition that tells the broker how to resolve a host object.
 *
 * - `root`: a root object (Excel.RequestContext or Excel API namespace)
 * - `property`: a property access on a parent object
 * - `invoke`: the result of a method call on a parent object
 */
export type ObjectDefinition =
  | { kind: "root"; id: number; root: "ctx" | "excel" }
  | { kind: "property"; id: number; parentId: number; property: string }
  | {
      kind: "invoke";
      id: number;
      parentId: number;
      method: string;
      args: any[];
    };

/**
 * A command the sandbox wants the broker to execute.
 *
 * - `load`: call .load() on an object (Office.js proxy loading)
 * - `set`: set a property on an object
 * - `invoke`: call a method on an object
 */
export type BrokerCommand =
  | { kind: "load"; targetId: number; spec: any }
  | { kind: "set"; targetId: number; property: string; value: any }
  | {
      kind: "invoke";
      targetId: number;
      method: string;
      resultId: number;
      write: boolean;
      args: any[];
    };

/** A sync request from the sandbox containing object definitions and commands */
export interface SyncRequest {
  requestId: string;
  definitions: ObjectDefinition[];
  commands: BrokerCommand[];
}

/** A sync response from the broker with serialized property snapshots */
export interface SyncResponse {
  requestId: string;
  snapshots: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Protocol message type guards
// ---------------------------------------------------------------------------

function isBaseMessage(msg: any, type: string): boolean {
  return (
    isPlainObject(msg) &&
    msg.type === type &&
    msg.protocolVersion === PROTOCOL_VERSION &&
    typeof msg.invocationId === "string" &&
    typeof msg.nonce === "string"
  );
}

export function isBootstrapMsg(msg: any): boolean {
  return isBaseMessage(msg, MessageTypes.BOOTSTRAP);
}
export function isReadyMsg(msg: any): boolean {
  return isBaseMessage(msg, MessageTypes.READY);
}
export function isRunMsg(msg: any): boolean {
  return (
    isBaseMessage(msg, MessageTypes.RUN) &&
    typeof msg.script === "string" &&
    isPlainObject(msg.limits)
  );
}
export function isSyncRequestMsg(msg: any): boolean {
  return (
    isBaseMessage(msg, MessageTypes.SYNC_REQUEST) &&
    isValidSyncRequest(msg.payload)
  );
}
export function isSyncResponseMsg(msg: any): boolean {
  return (
    isBaseMessage(msg, MessageTypes.SYNC_RESPONSE) &&
    isValidSyncResponse(msg.payload)
  );
}
export function isResultMsg(msg: any): boolean {
  return (
    isBaseMessage(msg, MessageTypes.RESULT) &&
    Array.isArray(msg.logs) &&
    msg.logs.every(
      (e: any) =>
        isPlainObject(e) &&
        typeof e.level === "string" &&
        typeof e.message === "string",
    ) &&
    (typeof msg.result === "undefined" || isSafeValue(msg.result))
  );
}
export function isErrorMsg(msg: any): boolean {
  return (
    isBaseMessage(msg, MessageTypes.ERROR) &&
    typeof msg.error === "string" &&
    Array.isArray(msg.logs) &&
    msg.logs.every(
      (e: any) =>
        isPlainObject(e) &&
        typeof e.level === "string" &&
        typeof e.message === "string",
    )
  );
}

// ---------------------------------------------------------------------------
// Value validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(val: any): val is Record<string, any> {
  if (typeof val !== "object" || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function isObjectRef(val: any): boolean {
  return (
    isPlainObject(val) &&
    typeof val[OFFICEJS_REF_KEY] === "number" &&
    Number.isInteger(val[OFFICEJS_REF_KEY]) &&
    val[OFFICEJS_REF_KEY] >= 0
  );
}

/** Check if a value is safe for cross-boundary serialization */
function isSafeValue(val: any): boolean {
  if (
    val === null ||
    typeof val === "string" ||
    typeof val === "boolean" ||
    (typeof val === "number" && Number.isFinite(val))
  )
    return true;
  if (Array.isArray(val)) return val.every(isSafeValue);
  if (isPlainObject(val))
    return isObjectRef(val) || Object.values(val).every(isSafeValue);
  return false;
}

function isValidObjectDefinition(def: any): def is ObjectDefinition {
  if (
    !isPlainObject(def) ||
    typeof def.kind !== "string" ||
    typeof def.id !== "number" ||
    !Number.isInteger(def.id) ||
    def.id < 0
  )
    return false;
  if (def.kind === "root") return def.root === "ctx" || def.root === "excel";
  if (
    typeof def.parentId !== "number" ||
    !Number.isInteger(def.parentId) ||
    def.parentId < 0
  )
    return false;
  if (def.kind === "property") return typeof def.property === "string";
  if (def.kind === "invoke")
    return (
      typeof def.method === "string" &&
      Array.isArray(def.args) &&
      def.args.every(isSafeValue)
    );
  return false;
}

function isValidCommand(cmd: any): cmd is BrokerCommand {
  if (
    !isPlainObject(cmd) ||
    typeof cmd.kind !== "string" ||
    typeof cmd.targetId !== "number" ||
    !Number.isInteger(cmd.targetId) ||
    cmd.targetId < 0
  )
    return false;
  if (cmd.kind === "load") return isSafeValue(cmd.spec);
  if (cmd.kind === "set")
    return typeof cmd.property === "string" && isSafeValue(cmd.value);
  if (cmd.kind === "invoke") {
    return (
      typeof cmd.method === "string" &&
      typeof cmd.resultId === "number" &&
      Number.isInteger(cmd.resultId) &&
      cmd.resultId >= 0 &&
      typeof cmd.write === "boolean" &&
      Array.isArray(cmd.args) &&
      cmd.args.every(isSafeValue)
    );
  }
  return false;
}

function isValidSyncRequest(req: any): req is SyncRequest {
  return (
    isPlainObject(req) &&
    typeof req.requestId === "string" &&
    Array.isArray(req.definitions) &&
    req.definitions.every(isValidObjectDefinition) &&
    Array.isArray(req.commands) &&
    req.commands.every(isValidCommand)
  );
}

function isValidSyncResponse(resp: any): resp is SyncResponse {
  return (
    isPlainObject(resp) &&
    typeof resp.requestId === "string" &&
    isPlainObject(resp.snapshots) &&
    Object.values(resp.snapshots).every(isSafeValue)
  );
}

/** Check if a method name is known to be destructive (writes to the workbook) */
function isDestructiveMethod(name: string): boolean {
  return /^(?:add|autofitColumns|autofitRows|clear|copyFrom|delete|insert|merge|remove|set|sort|unmerge)/u.test(
    name,
  );
}

function serializedCharCount(val: any): number {
  return JSON.stringify(val).length;
}

function matrixCellCount(val: any): number {
  if (!Array.isArray(val) || val.length === 0) return 0;
  if (val.every(Array.isArray))
    return val.reduce((sum: number, row: any[]) => sum + row.length, 0);
  return val.length;
}

// ===========================================================================
// LOG COLLECTOR — captures console output from the sandbox
// ===========================================================================

export interface LogCollector {
  entries: LogEntry[];
  totalChars: number;
  truncated: boolean;
}

export function createLogCollector(): LogCollector {
  return { entries: [], totalChars: 0, truncated: false };
}

export function appendLog(
  collector: LogCollector,
  level: string,
  args: any[],
): void {
  if (collector.truncated) return;
  if (
    collector.entries.length >= MAX_LOG_ENTRIES ||
    collector.totalChars >= MAX_TOTAL_LOG_CHARS
  ) {
    collector.entries.push({ level: "warn", message: LOG_TRUNCATED_MSG });
    collector.truncated = true;
    return;
  }

  const raw = args.length > 0 ? args.map(stringifyLogArg).join(" ") : "";
  const trimmed = truncateString(raw, MAX_LOG_ENTRY_CHARS);
  const budget = MAX_TOTAL_LOG_CHARS - collector.totalChars;
  if (budget <= 0) {
    collector.entries.push({ level: "warn", message: LOG_TRUNCATED_MSG });
    collector.truncated = true;
    return;
  }

  const final = truncateString(trimmed, budget);
  collector.entries.push({ level, message: final });
  collector.totalChars += final.length;
}

function stringifyLogArg(val: any): string {
  if (typeof val === "string") return val;
  if (
    typeof val === "number" ||
    typeof val === "boolean" ||
    typeof val === "bigint"
  )
    return String(val);
  if (val instanceof Error) return val.stack || val.message || "Error";
  if (val === null) return "null";
  if (typeof val === "undefined") return "undefined";
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function truncateString(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`;
}

export function formatLogs(entries: LogEntry[]): string {
  return entries.map((e) => `[${e.level}] ${e.message}`).join("\n");
}

export function formatError(error: any, logs: LogEntry[]): string {
  const msg =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string" && error.length > 0
        ? error
        : "unknown error";
  const prefix = `Office.js sandbox execution failed: ${msg}`;
  return logs.length === 0
    ? prefix
    : `${prefix}\nOffice.js sandbox console output:\n${formatLogs(logs)}`;
}

// ===========================================================================
// SAFE SERIALIZATION — deep-clone values for cross-boundary transfer
// ===========================================================================

/**
 * Recursively serialize a value for safe transfer across the sandbox boundary.
 * Handles circular references, Dates, BigInts, functions, and non-plain objects.
 */
export function safeSerialize(val: any, seen = new Set<any>()): any {
  if (val === null) return null;
  if (
    typeof val === "string" ||
    typeof val === "boolean" ||
    (typeof val === "number" && Number.isFinite(val))
  )
    return val;
  if (typeof val === "bigint") return String(val);
  if (
    typeof val === "undefined" ||
    typeof val === "function" ||
    typeof val === "symbol"
  )
    return undefined;

  if (Array.isArray(val)) {
    return val.map((item) => {
      const s = safeSerialize(item, seen);
      return typeof s === "undefined" ? null : s;
    });
  }

  if (typeof val !== "object") return String(val);
  if (seen.has(val)) return "[Circular]";
  seen.add(val);

  if (val instanceof Date) return val.toISOString();

  // Try toJSON() if available
  if (typeof val.toJSON === "function") {
    try {
      const jsonVal = val.toJSON();
      if (jsonVal !== val) return safeSerialize(jsonVal, seen);
    } catch {}
  }

  // Plain objects — serialize all enumerable properties
  if (isPlainObject(val)) {
    const result: Record<string, any> = {};
    for (const [key, v] of Object.entries(val)) {
      const s = safeSerialize(v, seen);
      if (typeof s !== "undefined") result[key] = s;
    }
    return result;
  }

  // Non-plain objects — try JSON round-trip
  try {
    const parsed = JSON.parse(JSON.stringify(val));
    if (isSafeValue(parsed)) return parsed;
  } catch {}

  return undefined;
}

// ===========================================================================
// HOST-SIDE BROKER — resolves sandbox sync requests against real Office.js
// ===========================================================================

export interface BrokerOptions {
  context: Excel.RequestContext;
  excelApi: typeof Excel;
  destructive: boolean;
  limits?: Partial<SandboxLimits>;
}

export interface Broker {
  syncRequest(request: SyncRequest): Promise<SyncResponse>;
}

/**
 * Create a broker that processes sync requests from the sandbox.
 *
 * The broker maintains a mapping of object IDs → real Office.js proxy objects.
 * When the sandbox sends commands (load, set, invoke), the broker:
 * 1. Resolves object references to real proxy objects
 * 2. Executes the operations
 * 3. Calls context.sync()
 * 4. Serializes and returns property snapshots
 */
export function createBroker(options: BrokerOptions): Broker {
  const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...options.limits };

  // Object definitions registry — maps ID → definition
  const definitions = new Map<number, ObjectDefinition>();

  // Resolved objects cache — maps ID → real Office.js object
  const resolved = new Map<number, any>([
    [1, options.context], // id=1 is always the RequestContext
    [2, options.excelApi], // id=2 is always the Excel namespace
  ]);

  /** Register new object definitions, rejecting redefinitions */
  function registerDefinitions(defs: ObjectDefinition[]): void {
    for (const def of defs) {
      const existing = definitions.get(def.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(def)) {
          throw new Error(
            `run_officejs sandbox attempted to redefine host object id ${def.id}.`,
          );
        }
        continue;
      }
      definitions.set(def.id, def);
    }
  }

  /** Resolve an object ID to the actual Office.js proxy object */
  function resolveObject(id: number): any {
    // Check cache first
    if (resolved.has(id)) return resolved.get(id);

    const def = definitions.get(id);
    if (!def)
      throw new Error(
        `run_officejs sandbox referenced unknown host object id ${id}.`,
      );

    if (def.kind === "root") {
      const obj = def.root === "ctx" ? options.context : options.excelApi;
      resolved.set(id, obj);
      return obj;
    }

    if (def.kind === "invoke") {
      throw new Error(
        `run_officejs sandbox referenced invocation result ${id} before it was produced by the broker.`,
      );
    }

    // kind === "property"
    const parent = resolveObject(def.parentId);
    const val = readProperty(parent, def.property);
    resolved.set(id, val);
    return val;
  }

  /** Recursively resolve __officejsRef values in arguments */
  function resolveRefs(val: any): any {
    if (isObjectRef(val)) return resolveObject(val[OFFICEJS_REF_KEY]);
    if (Array.isArray(val)) return val.map(resolveRefs);
    if (isPlainObject(val)) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) result[k] = resolveRefs(v);
      return result;
    }
    return val;
  }

  /** Assert destructive operations are allowed */
  function assertDestructive(message: string): void {
    if (!options.destructive) throw new Error(message);
  }

  /** Validate request size limits */
  function validateRequestLimits(request: SyncRequest): void {
    const serialized = safeSerialize(request);
    if (!serialized) return;

    if (serializedCharCount(serialized) > limits.maxSerializedChars) {
      throw new Error(
        `run_officejs sandbox payload exceeds the broker size limit (${limits.maxSerializedChars} chars).`,
      );
    }

    for (const cmd of request.commands) {
      if (
        cmd.kind === "set" &&
        matrixCellCount(cmd.value) > limits.maxMatrixWriteCells
      ) {
        throw new Error(
          `run_officejs write payload exceeds the matrix cell limit (${limits.maxMatrixWriteCells} cells).`,
        );
      }
    }
  }

  /** Process a sync request: execute commands, sync, return snapshots */
  async function syncRequest(request: SyncRequest): Promise<SyncResponse> {
    registerDefinitions(request.definitions);
    validateRequestLimits(request);

    // Execute commands
    for (const cmd of request.commands) {
      if (cmd.kind === "load") {
        const target = resolveObject(cmd.targetId);
        const spec = resolveRefs(cmd.spec);
        if (spec === null) callMethod(target, "load", []);
        else callMethod(target, "load", [spec]);
        continue;
      }

      if (cmd.kind === "set") {
        assertDestructive(
          "destructive=false but the script appears to modify the workbook. Set destructive=true for edits.",
        );
        const target = resolveObject(cmd.targetId);
        writeProperty(target, cmd.property, resolveRefs(cmd.value));
        continue;
      }

      // cmd.kind === "invoke"
      if (cmd.write || isDestructiveMethod(cmd.method)) {
        assertDestructive(
          "destructive=false but the script appears to modify the workbook. Set destructive=true for edits.",
        );
      }

      const target = resolveObject(cmd.targetId);
      const args = cmd.args.map(resolveRefs);
      const result = callMethod(target, cmd.method, args);
      resolved.set(cmd.resultId, result);
    }

    // Sync the Excel context
    const syncFn = readProperty(options.context, "sync");
    if (typeof syncFn !== "function") {
      throw new Error("Excel RequestContext is missing sync().");
    }
    await Reflect.apply(syncFn, options.context, []);

    // Build snapshots of all resolved objects
    const snapshots: Record<string, any> = {};
    let totalChars = 0;

    for (const [id, def] of definitions.entries()) {
      if (def.kind === "root") continue;

      const obj =
        def.kind === "property"
          ? resolveObject(id)
          : resolved.has(id)
            ? resolved.get(id)
            : undefined;

      const serialized = safeSerialize(obj);
      if (typeof serialized === "undefined") continue;

      totalChars += serializedCharCount(serialized);
      if (totalChars > limits.maxSerializedChars) {
        throw new Error(
          `run_officejs sandbox response exceeds the broker size limit (${limits.maxSerializedChars} chars).`,
        );
      }

      snapshots[String(id)] = JSON.parse(JSON.stringify(serialized));
    }

    return { requestId: request.requestId, snapshots };
  }

  return { syncRequest };
}

// ---------------------------------------------------------------------------
// Property access helpers (with safety checks)
// ---------------------------------------------------------------------------

function assertObject(val: any, msg: string): Record<string, any> {
  if (typeof val !== "object" || val === null) throw new Error(msg);
  return val;
}

function readProperty(obj: any, prop: string): any {
  return assertObject(
    obj,
    `Cannot read property "${prop}" from a non-object host reference.`,
  )[prop];
}

function writeProperty(obj: any, prop: string, value: any): void {
  assertObject(
    obj,
    `Cannot write property "${prop}" on a non-object host reference.`,
  )[prop] = value;
}

function callMethod(obj: any, method: string, args: any[]): any {
  const target = assertObject(
    obj,
    `Cannot call "${method}" on a non-object host reference.`,
  );
  const fn = target[method];
  if (typeof fn !== "function") {
    throw new Error(
      `Office.js sandbox tried to call missing method "${method}".`,
    );
  }
  return Reflect.apply(fn, target, args);
}

// ===========================================================================
// HOST-SIDE IFRAME MANAGER — orchestrates the full sandbox lifecycle
// ===========================================================================

export interface RunSandboxOptions {
  /** The validated script to execute */
  script: string;
  /** The Excel RequestContext */
  context: Excel.RequestContext;
  /** The Excel API namespace */
  excelApi: typeof Excel;
  /** Whether the script is allowed to modify the workbook */
  destructive: boolean;
  /** Resource limits (merged with defaults) */
  limits?: Partial<SandboxLimits>;
  /** Override: custom iframe factory */
  iframeFactory?: (doc: Document) => HTMLIFrameElement;
  /** Override: custom MessageChannel factory */
  createMessageChannel?: () => MessageChannel;
  /** Override: window reference (for setTimeout etc.) */
  windowRef?: Window;
  /** Override: document reference */
  documentRef?: Document;
}

/**
 * Run an Office.js script in a sandboxed iframe.
 *
 * Lifecycle:
 * 1. Create a sandboxed iframe (allow-scripts only) and a MessageChannel
 * 2. Append iframe to body; on load, post bootstrap message with MessagePort
 * 3. Iframe responds with READY; host sends RUN message with script + limits
 * 4. Iframe executes script; sends SYNC_REQUEST messages for Office.js operations
 * 5. Host broker processes sync requests and sends SYNC_RESPONSE messages back
 * 6. Iframe sends RESULT (success) or ERROR (failure) when done
 * 7. Host cleans up iframe, ports, and timers
 */
export async function runInSandbox(
  options: RunSandboxOptions,
): Promise<SandboxResult> {
  const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const win = options.windowRef ?? window;
  const doc = options.documentRef ?? document;
  const body = doc.body;

  if (!body)
    throw new Error("run_officejs sandbox requires document.body to exist.");

  // Create the broker for handling sync requests
  const broker = createBroker({
    context: options.context,
    excelApi: options.excelApi,
    destructive: options.destructive,
    limits,
  });

  // Create iframe and message channel
  const iframe = options.iframeFactory?.(doc) ?? createSandboxIframe(doc);
  const channel = options.createMessageChannel?.() ?? new MessageChannel();

  // Generate unique identifiers for this invocation
  const invocationId = generateId(win);
  const nonce = generateId(win);

  // Create a deferred promise for the result
  let resolve!: (val: SandboxResult) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<SandboxResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  let timeoutId: number = 0;
  let settled = false;

  /** Ensure we only settle once */
  function settle(fn: () => void): void {
    if (settled) return;
    settled = true;
    fn();
  }

  /** Clean up all resources */
  function cleanup(): void {
    if (timeoutId) win.clearTimeout(timeoutId);
    channel.port1.removeEventListener("message", onPortMessage);
    try {
      channel.port1.close();
    } catch {}
    try {
      channel.port2.close();
    } catch {}
    iframe.removeEventListener("load", onIframeLoad);
    iframe.removeEventListener("error", onIframeError);
    iframe.remove();
  }

  /** Handle failure */
  function fail(message: string): void {
    settle(() => {
      cleanup();
      reject(new Error(message));
    });
  }

  /** Handle success */
  function succeed(result: SandboxResult): void {
    settle(() => {
      cleanup();
      resolve(result);
    });
  }

  /** Handle messages from the sandbox iframe via the MessageChannel port */
  function onPortMessage(event: MessageEvent): void {
    const msg = event.data;

    // READY: sandbox is initialized, send the script
    if (isReadyMsg(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        fail(
          "run_officejs sandbox iframe replied with the wrong bootstrap identity.",
        );
        return;
      }
      channel.port1.postMessage({
        type: MessageTypes.RUN,
        protocolVersion: PROTOCOL_VERSION,
        invocationId,
        nonce,
        script: options.script,
        limits,
      });
      return;
    }

    // SYNC_REQUEST: sandbox needs Office.js operations executed
    if (isSyncRequestMsg(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        fail(
          "run_officejs sandbox iframe sent a sync request for the wrong invocation.",
        );
        return;
      }
      broker.syncRequest(msg.payload).then(
        (response) => {
          channel.port1.postMessage({
            type: MessageTypes.SYNC_RESPONSE,
            protocolVersion: PROTOCOL_VERSION,
            invocationId,
            nonce,
            payload: response,
          });
        },
        (error) => {
          fail(formatError(error, []));
        },
      );
      return;
    }

    // RESULT: sandbox completed successfully
    if (isResultMsg(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        fail(
          "run_officejs sandbox iframe returned a result for the wrong invocation.",
        );
        return;
      }
      succeed({ logs: msg.logs, result: msg.result });
      return;
    }

    // ERROR: sandbox execution failed
    if (isErrorMsg(msg)) {
      if (msg.invocationId !== invocationId || msg.nonce !== nonce) {
        fail(
          "run_officejs sandbox iframe returned an error for the wrong invocation.",
        );
        return;
      }
      fail(formatError(new Error(msg.error), msg.logs));
      return;
    }

    fail("run_officejs sandbox iframe sent an invalid protocol message.");
  }

  /** Handle iframe load event — post the bootstrap message */
  function onIframeLoad(): void {
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) {
      fail("run_officejs sandbox iframe did not expose a contentWindow.");
      return;
    }
    // Send bootstrap message via window.postMessage, transferring port2
    contentWindow.postMessage(
      {
        type: MessageTypes.BOOTSTRAP,
        protocolVersion: PROTOCOL_VERSION,
        invocationId,
        nonce,
      },
      "*",
      [channel.port2],
    );
  }

  /** Handle iframe error event */
  function onIframeError(): void {
    fail("run_officejs sandbox iframe failed to load.");
  }

  // Wire up event listeners
  channel.port1.addEventListener("message", onPortMessage);
  channel.port1.start();
  iframe.addEventListener("load", onIframeLoad);
  iframe.addEventListener("error", onIframeError);

  // Resolve the sandbox page URL and set iframe src
  iframe.src = resolveSandboxPath(doc, win);

  // Append to DOM to trigger load
  body.appendChild(iframe);

  // Set timeout
  timeoutId = win.setTimeout(() => {
    fail(`run_officejs sandbox timed out after ${limits.timeoutMs}ms.`);
  }, limits.timeoutMs) as unknown as number;

  return promise;
}

// ---------------------------------------------------------------------------
// Iframe creation & path resolution helpers
// ---------------------------------------------------------------------------

/** Create a minimal sandboxed iframe — only `allow-scripts` (no DOM, no network, no same-origin) */
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

/** Generate a unique ID for invocation/nonce */
function generateId(win: Window): string {
  if (typeof win.crypto?.randomUUID === "function") {
    return win.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Resolve the URL for the sandbox iframe page.
 * Reads `bps-app-base-path` and `bps-auth-base-path` meta tags to construct the path.
 */
function resolveSandboxPath(doc: Document, win: Window): string {
  const appMeta = doc.querySelector('meta[name="bps-app-base-path"]');
  const appBasePath = appMeta?.getAttribute("content")?.trim();
  if (!appBasePath) {
    throw new Error(
      "Missing app base path metadata for run_officejs sandbox bootstrap.",
    );
  }

  let basePath: string;
  if (appBasePath.startsWith("/")) {
    basePath = appBasePath.endsWith("/") ? appBasePath : `${appBasePath}/`;
  } else {
    const url = new URL(appBasePath, win.location.href);
    basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  }

  // Check for auth base path override
  const authMeta = doc.querySelector('meta[name="bps-auth-base-path"]');
  const authBasePath = authMeta?.getAttribute("content")?.trim();
  if (authBasePath) {
    let authPath: string;
    if (authBasePath.startsWith("/")) {
      authPath = authBasePath.endsWith("/") ? authBasePath : `${authBasePath}/`;
    } else {
      const url = new URL(authBasePath, win.location.href);
      authPath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    }
    return `${authPath}sandbox/`;
  }

  // Strip trailing /sheets/ or /sandbox/ from base path
  let stripped = basePath;
  if (stripped.endsWith("/sheets/")) stripped = stripped.slice(0, -7);
  else if (stripped.endsWith("/sandbox/")) stripped = stripped.slice(0, -8);

  return `${stripped}sandbox/`;
}
