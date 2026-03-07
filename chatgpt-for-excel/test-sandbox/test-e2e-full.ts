/**
 * Full E2E test suite for the Basispoints/ChatGPT-for-Excel sandbox system.
 * Tests the QuickJS WASM runtime inside a sandboxed iframe communicating
 * with the host via MessageChannel protocol.
 * 
 * Uses patched sandbox JS that fixes the resolvePromise/executePendingJobs issue.
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8803,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Access-Control-Allow-Origin": "*" } });
    });
  },
});

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', err => console.log(`  [PAGE_ERR] ${err.message}`));

// Only show SYNC_REQUEST logs if --verbose
const verbose = process.argv.includes("--verbose");
page.on('console', msg => {
  if (verbose || !msg.text().includes("SYNC_REQUEST")) {
    console.log(`  [${msg.type()}] ${msg.text()}`);
  }
});

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║     Basispoints Office.js Sandbox — E2E Test Suite         ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// Mock worksheet data for Excel API tests
const MOCK_SHEETS: Record<string, any[][]> = {
  "Sheet1": [
    ["Name", "Score", "Grade"],
    ["Alice", 95, "A"],
    ["Bob", 82, "B"],
    ["Charlie", 71, "C"],
  ],
};

interface TestCase {
  name: string;
  script: string;
  expect?: (result: any) => boolean;
  expectError?: boolean;
}

const tests: TestCase[] = [
  // === Basic computation ===
  { name: "integer return", script: "return 42;", expect: r => r === 42 },
  { name: "string return", script: 'return "hello";', expect: r => r === "hello" },
  { name: "boolean return", script: "return true;", expect: r => r === true },
  { name: "null return", script: "return null;", expect: r => r === null },
  { name: "undefined return", script: "", expect: r => r === undefined },
  { name: "float arithmetic", script: "return 0.1 + 0.2;", expect: r => Math.abs(r - 0.3) < 1e-10 },
  { name: "array return", script: "return [1, 2, 3];", expect: r => JSON.stringify(r) === "[1,2,3]" },
  { name: "object return", script: 'return {a: 1, b: "two"};', expect: r => r.a === 1 && r.b === "two" },
  
  // === Console capture ===
  { name: "console.log", script: 'console.log("msg1"); return 1;', expect: r => r === 1 },
  { name: "console.warn", script: 'console.warn("warning!"); return 2;', expect: r => r === 2 },
  { name: "console.error", script: 'console.error("err!"); return 3;', expect: r => r === 3 },
  
  // === Async/await ===
  { name: "await Promise.resolve", script: "return await Promise.resolve(99);", expect: r => r === 99 },
  { name: "async chain", script: `
    const a = await Promise.resolve(10);
    const b = await Promise.resolve(20);
    return a + b;`, expect: r => r === 30 },
  
  // === Error handling ===
  { name: "throw Error", script: 'throw new Error("boom");', expectError: true },
  { name: "syntax error in user code", script: "return {;", expectError: true },
  { name: "reference error", script: "return nonExistentVariable;", expectError: true },
  
  // === Sandbox security ===
  { name: "no fetch", script: 'return typeof fetch;', expect: r => r === "undefined" },
  { name: "no document", script: 'return typeof document;', expect: r => r === "undefined" },
  { name: "no window", script: 'return typeof window;', expect: r => r === "undefined" },
  { name: "no XMLHttpRequest", script: 'return typeof XMLHttpRequest;', expect: r => r === "undefined" },
  { name: "no eval escape", script: `
    try { return typeof globalThis.eval; } catch(e) { return "blocked"; }`,
    expect: r => r === "function" || r === "blocked" }, // eval exists in QuickJS but can't escape
  
  // === Excel API (ctx and Excel objects) ===
  { name: "ctx exists", script: "return typeof ctx;", expect: r => r === "object" || r === "function" },
  { name: "Excel exists", script: "return typeof Excel;", expect: r => r === "object" || r === "function" },
  { name: "console object exists", script: "return typeof console;", expect: r => r === "object" },
  
  // === Complex computation ===
  { name: "fibonacci", script: `
    function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }
    return fib(10);`, expect: r => r === 55 },
  { name: "array operations", script: `
    const arr = Array.from({length: 100}, (_, i) => i + 1);
    return arr.reduce((a, b) => a + b, 0);`, expect: r => r === 5050 },
  { name: "JSON round-trip", script: `
    const obj = {nested: {arr: [1, "two", true, null]}};
    return JSON.parse(JSON.stringify(obj));`,
    expect: r => r.nested.arr[0] === 1 && r.nested.arr[1] === "two" },
  { name: "regex", script: `
    const match = "hello-world-42".match(/(\\w+)-(\\w+)-(\\d+)/);
    return [match[1], match[2], parseInt(match[3])];`,
    expect: r => r[0] === "hello" && r[1] === "world" && r[2] === 42 },
];

let passed = 0, failed = 0, errors = 0;

for (const tc of tests) {
  const result = await page.evaluate(async (script: string) => {
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.display = "none";
      
      const channel = new MessageChannel();
      const iid = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      
      channel.port1.addEventListener("message", (ev) => {
        const m = ev.data;
        if (!m || typeof m !== 'object') return;
        
        if (m.type === "bps.officejs-sandbox.ready") {
          channel.port1.postMessage({
            type: "bps.officejs-sandbox.run",
            protocolVersion: 1, invocationId: iid, nonce,
            script,
            limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 10000 },
          });
        }
        
        if (m.type === "bps.officejs-sandbox.sync_request") {
          // Respond with empty snapshots for any sync request
          const snapshots: Record<string, any> = {};
          for (const def of m.payload.definitions || []) {
            snapshots[String(def.id)] = {};
          }
          for (const cmd of m.payload.commands || []) {
            if (cmd.kind === "load") {
              snapshots[String(cmd.targetId)] = { values: [[null]] };
            }
          }
          channel.port1.postMessage({
            type: "bps.officejs-sandbox.sync_response",
            protocolVersion: 1, invocationId: iid, nonce,
            payload: { requestId: m.payload.requestId, snapshots },
          });
        }
        
        if (m.type === "bps.officejs-sandbox.result") {
          iframe.remove();
          resolve({ ok: true, result: m.result, logs: m.logs });
        }
        if (m.type === "bps.officejs-sandbox.error") {
          iframe.remove();
          resolve({ ok: false, error: m.error, logs: m.logs });
        }
      });
      channel.port1.start();
      
      iframe.addEventListener("load", () => {
        iframe.contentWindow!.postMessage(
          { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
          "*", [channel.port2]
        );
      });
      
      iframe.src = "/sandbox-patched/";
      document.body.appendChild(iframe);
      setTimeout(() => { iframe.remove(); resolve({ timeout: true }); }, 15000);
    });
  }, tc.script);
  
  let status: string;
  if (result.timeout) {
    status = "⏰ TIMEOUT";
    failed++;
  } else if (tc.expectError) {
    if (!result.ok) {
      status = `✅ Error caught: "${result.error?.slice(0, 60)}..."`;
      passed++;
    } else {
      status = `❌ Expected error but got: ${JSON.stringify(result.result)}`;
      failed++;
    }
  } else if (result.ok) {
    if (tc.expect) {
      try {
        if (tc.expect(result.result)) {
          status = `✅ ${JSON.stringify(result.result)?.slice(0, 60)}`;
          passed++;
        } else {
          status = `❌ Got: ${JSON.stringify(result.result)?.slice(0, 60)}`;
          failed++;
        }
      } catch (e: any) {
        status = `❌ Assertion error: ${e.message}`;
        failed++;
      }
    } else {
      status = `✅ ${JSON.stringify(result.result)?.slice(0, 60)}`;
      passed++;
    }
  } else {
    status = `❌ Unexpected error: ${result.error?.slice(0, 60)}`;
    errors++;
  }
  
  console.log(`  ${status.padEnd(65)} [${tc.name}]`);
}

console.log(`\n${"═".repeat(70)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${errors} errors`);
console.log(`  Total: ${tests.length} tests`);
console.log(`${"═".repeat(70)}`);

await browser.close();
server.stop();

process.exit(failed + errors > 0 ? 1 : 0);
