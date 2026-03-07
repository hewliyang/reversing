# Basispoints / ChatGPT-for-Excel — Office.js Sandbox System

## Architecture

The sandbox system runs user scripts in a **QuickJS WASM runtime** inside a **sandboxed iframe**, communicating with the host via a **MessageChannel protocol**.

### Components

| Component      | File                                    | Role                                                                      |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Sandbox entry  | `source/sandbox-BAMHNVll.js`                   | ES module loaded in iframe; boots QuickJS WASM, handles protocol messages |
| Protocol types | `source/officejs-sandbox-protocol-DHHFLCK9.js` | Shared constants, message type guards, validation                         |
| Sandbox HTML   | `sandbox/index.html`                           | Minimal HTML that loads the sandbox module                                |
| Host (app)     | `source/app-Fv2Lr-FU.js`                       | Creates iframe, drives protocol, brokers Excel API calls                  |

### Iframe Sandbox

The host creates a sandboxed iframe:

```html
<iframe sandbox="allow-scripts" src="/sandbox/"></iframe>
```

- `allow-scripts` enables JavaScript execution
- No `allow-same-origin` → unique opaque origin (blocks cookies, storage, same-origin network)
- No `allow-top-navigation`, `allow-popups`, etc.

### QuickJS WASM Runtime

- **QuickJS** compiled to WASM via Emscripten (~456 KB binary)
- WASM binary embedded as base64 data URI inside `sandbox-BAMHNVll.js`
- Uses `quickjs-emscripten` wrapper library (bundled, not from npm)
- Runtime limits: 32 MB memory, 1 MB stack size
- Interrupt handler for timeout enforcement

User code runs in a QuickJS context with **no browser APIs** — `fetch`, `document`, `window`, `XMLHttpRequest`, `WebSocket`, `setTimeout`, `navigator` are all `undefined`.

---

## Protocol

Communication uses a `MessageChannel`. The host holds `port1`; the iframe receives `port2` via the bootstrap message.

### Message Flow

```
Host                              Sandbox Iframe
  │                                     │
  │──── BOOTSTRAP (+ port2) ──────────→ │  (window.postMessage)
  │                                     │
  │←──── READY ─────────────────────────│  (port.postMessage)
  │                                     │
  │──── RUN (script, limits) ─────────→ │
  │                                     │
  │        ┌────────────────────────────│  (QuickJS evaluates script)
  │        │                            │
  │←── SYNC_REQUEST (definitions, ──────   (Excel API proxy call)
  │        commands)                    │
  │                                     │
  │──── SYNC_RESPONSE (snapshots) ────→ │
  │        │                            │
  │        └──────────────────────────── │  (may repeat 0+ times)
  │                                     │
  │←──── RESULT (result, logs) ───────── │  (or ERROR)
  │                                     │
```

### Message Types

| Type                                 | Direction     | Description                                          |
| ------------------------------------ | ------------- | ---------------------------------------------------- |
| `bps.officejs-sandbox.bootstrap`     | Host → Iframe | Initiates session; transfers `port2`                 |
| `bps.officejs-sandbox.ready`         | Iframe → Host | Sandbox loaded and ready to accept scripts           |
| `bps.officejs-sandbox.run`           | Host → Iframe | Send user script with execution limits               |
| `bps.officejs-sandbox.sync_request`  | Iframe → Host | Excel API proxy: request object definitions and data |
| `bps.officejs-sandbox.sync_response` | Host → Iframe | Excel API proxy: return snapshots of requested data  |
| `bps.officejs-sandbox.result`        | Iframe → Host | Script completed successfully                        |
| `bps.officejs-sandbox.error`         | Iframe → Host | Script failed with error                             |

All messages include `protocolVersion` (1), `invocationId`, and `nonce` for session binding.

### RUN Message

```js
{
  type: "bps.officejs-sandbox.run",
  protocolVersion: 1,
  invocationId: "uuid",
  nonce: "uuid",
  script: "return 42;",           // User code (unwrapped)
  limits: {
    maxObjectIds: 256,
    maxQueuedOperations: 256,
    maxSerializedChars: 200000,
    maxMatrixWriteCells: 10000,
    timeoutMs: 20000,
  }
}
```

### SYNC_REQUEST / SYNC_RESPONSE

The sandbox uses a **proxy-based** Excel API. Property accesses and method calls on `ctx` and `Excel` objects are recorded as "definitions" and "commands", then batched and sent to the host via `SYNC_REQUEST` when `ctx.sync()` is called.

**Request payload:**

```js
{
  requestId: "req-1",
  definitions: [
    { kind: "root", id: 1, root: "ctx" },
    { kind: "property", id: 2, parentId: 1, property: "workbook" },
    { kind: "property", id: 3, parentId: 2, property: "worksheets" },
  ],
  commands: [
    { kind: "load", targetId: 3, spec: ["name", "values"] }
  ]
}
```

**Response payload:**

```js
{
  requestId: "req-1",
  snapshots: {
    "3": { name: "Sheet1", values: [["A1", "B1"], ["A2", "B2"]] }
  }
}
```

---

## Script Wrapping

User code is wrapped by `Bg()` before evaluation in QuickJS:

```js
(() => {
  const __name = (target, _value) => target;
  const __createOfficejsSandboxGuestRuntime = (/* Qg function source */);
  const __guestRuntimeStaticConfig = { defaultLimits: {...}, serializedRefKey: "..." };
  const __guest = __createOfficejsSandboxGuestRuntime({
    callHost: __bpsHostCall,
    log: (level, values) => __bpsConsoleLog(level, values),
    limits: { /* from RUN message */ },
  }, __guestRuntimeStaticConfig);
  return (async () => {
    const __result = await (async function runOfficeJsScript(ctx, Excel, console) {
      "use strict";
      /* USER CODE HERE */
    })(__guest.ctx, __guest.Excel, __guest.console);
    await __guest.flushPending();
    return __guest.exportResult(__result);
  })();
})()
```

Key points:

- User code receives `ctx`, `Excel`, `console` as function arguments (shadowing globals)
- `ctx` and `Excel` are proxy objects that record operations for batched sync
- `console` is a wrapper that captures logs via `__bpsConsoleLog`
- `flushPending()` sends any remaining batched operations before returning
- `exportResult()` serializes the return value (must be JSON-serializable)

---

## Internal Execution Flow

### Sandbox Side (`Lg` function)

```
1. Jg(moduleLoader)           → Initialize QuickJS WASM module (cached after first call)
2. module.newRuntime()         → Create QuickJS runtime with memory/stack limits
3. A.newContext()              → Create QuickJS execution context
4. setInterruptHandler()       → Register timeout check
5. KI(c, "__bpsConsoleLog")    → Inject console capture function
6. KI(c, "__bpsHostCall")     → Inject host call function (returns Promise)
7. Bg(script, limits)          → Wrap user code in guest runtime scaffold
8. c.evalCode(wrappedScript)   → Evaluate in QuickJS → returns Promise handle
9. nI(A)                       → Execute pending jobs (runs async function body)
10. c.resolvePromise(g)        → Await the QuickJS Promise from native JS
11. c.dump(result)             → Extract result value
12. Post RESULT message        → Send back to host
```

### Host Call Flow (`__bpsHostCall`)

When user code calls `ctx.sync()`:

1. Guest runtime builds a `SYNC_REQUEST` with accumulated definitions and commands
2. `__bpsHostCall(request)` is called from QuickJS
3. Native side creates a Promise and posts `SYNC_REQUEST` on MessagePort
4. Host receives request, resolves Excel API calls, sends `SYNC_RESPONSE`
5. Native Promise resolves, QuickJS Promise resolves via `executePendingJobs()`
6. User code continues after `await ctx.sync()`

---

## Guest Runtime (`Qg` function)

The guest runtime (injected into the wrapped script) provides:

### Object ID System

- Every proxy object gets a unique integer ID
- `definitions` array tracks the object graph (roots, properties, method results)
- `commands` array tracks operations (load, method calls)
- IDs are sent to the host which resolves them against the real Excel API

### Proxy Objects

- `ctx` → root proxy (id=1, root="ctx")
- `Excel` → root proxy (id=2, root="excel")
- Property access creates child proxies (`ctx.workbook` → new definition)
- Method calls create command entries
- `ctx.sync()` flushes all pending operations via `__bpsHostCall`

### Limits Enforcement

- `maxObjectIds` — max proxy objects (default 256)
- `maxQueuedOperations` — max pending commands (default 256)
- `maxSerializedChars` — max JSON size for host call payloads
- `maxMatrixWriteCells` — max cells for range writes
- `timeoutMs` — overall execution timeout

### Serialization

- Return values must be JSON-serializable (primitives, arrays, plain objects)
- Proxy references are encoded with a special key (`serializedRefKey`)
- Unresolved proxies cannot be returned (must call `ctx.sync()` first)

---

## Bug: `resolvePromise` / `executePendingJobs` Timing Issue

### Symptom

After sending `RUN`, the sandbox never responds — no `RESULT` or `ERROR`. The QuickJS WASM initializes correctly, `evalCode` succeeds, but `resolvePromise` hangs forever.

### Root Cause

In `Lg()`, the execution flow is:

```js
// 1. Evaluate wrapped script (returns QuickJS Promise)
g = c.unwrapResult(c.evalCode(s));

// 2. Run pending jobs — resolves the QuickJS Promise
nI(A); // executePendingJobs()

// 3. Wait for the resolved value
const o = await c.resolvePromise(g); // ← HANGS
```

`resolvePromise(g)` internally does:

1. Calls `Promise.resolve(g)` inside QuickJS (creates a new resolved promise)
2. Calls `.then(resolveCallback, rejectCallback)` on it
3. Returns a native `Promise` that resolves when the callback fires

But `.then()` on an already-resolved QuickJS Promise registers a **pending job** (microtask). Nobody calls `executePendingJobs()` after step 2, so the `.then()` callback never fires, and the native Promise never resolves.

### Fix

Schedule `executePendingJobs()` as a microtask after `resolvePromise` sets up its `.then()`:

```js
// Before (hangs):
const o = await c.resolvePromise(g);

// After (works):
const _rp = c.resolvePromise(g);
Promise.resolve().then(() => {
  try {
    nI(A);
  } catch (e) {}
});
const o = await _rp;
```

This ensures the QuickJS `.then()` microtask fires before `await` suspends.

### Why It Works in Production

In production, user scripts typically call `ctx.sync()` which triggers `__bpsHostCall`. When the host responds with `SYNC_RESPONSE`, the `D()` callback calls `nI(A)` (executePendingJobs), which incidentally also processes the `.then()` from `resolvePromise`. So the bug only manifests for scripts that **don't make any Excel API calls** (e.g., `return 42;`).

---

## E2E Test Results

With the `resolvePromise` fix applied, **28/28 tests pass**:

| Category            | Tests                                                    | Status |
| ------------------- | -------------------------------------------------------- | ------ |
| Basic types         | int, string, bool, null, undefined, float, array, object | ✅ 8/8 |
| Console capture     | log, warn, error                                         | ✅ 3/3 |
| Async/await         | Promise.resolve, chains                                  | ✅ 2/2 |
| Error handling      | thrown errors, syntax errors, reference errors           | ✅ 3/3 |
| Sandbox security    | no fetch/document/window/XHR                             | ✅ 5/5 |
| Excel API           | ctx, Excel, console objects exist                        | ✅ 3/3 |
| Complex computation | fibonacci, array reduce, JSON round-trip, regex          | ✅ 4/4 |

### Test Files

| File                                      | Purpose                                       |
| ----------------------------------------- | --------------------------------------------- |
| `test-sandbox/test-e2e-full.ts`           | Full 28-test E2E suite                        |
| `test-sandbox/test-e2e.ts`                | Basic 8-test suite with sync request handling |
| `test-sandbox/test-patched.ts`            | Single-test runner using patched sandbox      |
| `test-sandbox/test-quickjs-direct.ts`     | Direct quickjs-emscripten tests (no iframe)   |
| `test-sandbox/assets/sandbox-patched2.js` | Patched sandbox JS with resolvePromise fix    |
| `test-sandbox/sandbox-patched/index.html` | HTML loading patched sandbox                  |

### Running Tests

```bash
cd chatgpt-for-excel/test-sandbox

# Full E2E suite (28 tests)
bun run test-e2e-full.ts

# Basic suite (8 tests)
bun run test-e2e.ts

# Direct QuickJS tests (no browser needed)
bun run test-quickjs-direct.ts
```

Requires: `bun`, `puppeteer` (for headless Chrome), original sandbox assets in `assets/`.
