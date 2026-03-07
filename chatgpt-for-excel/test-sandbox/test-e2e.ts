/**
 * Full E2E test with SYNC_REQUEST/SYNC_RESPONSE handling
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8802,
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
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("=== E2E Sandbox Test ===\n");

// Mock Excel data
const MOCK_DATA: Record<string, any> = {
  "Sheet1!A1:B3": {
    values: [["Name", "Score"], ["Alice", 95], ["Bob", 82]],
    numberFormat: [["General", "General"], ["General", "General"], ["General", "General"]],
  }
};

const testCases = [
  { name: "simple return", script: "return 42;" },
  { name: "string return", script: 'return "hello world";' },
  { name: "console.log", script: 'console.log("test message"); return true;' },
  { name: "math expression", script: "return Math.sqrt(144);" },
  { name: "JSON manipulation", script: 'const obj = {a: 1, b: [2, 3]}; return JSON.stringify(obj);' },
  { name: "error handling", script: "throw new Error('test error');" },
  { name: "no browser APIs", script: "return typeof fetch === 'undefined' && typeof document === 'undefined';" },
  { name: "async/await", script: "const val = await Promise.resolve(99); return val;" },
];

for (const tc of testCases) {
  console.log(`--- Test: ${tc.name} ---`);
  
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
            limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 15000 },
          });
        }
        
        // Handle SYNC_REQUEST from sandbox
        if (m.type === "bps.officejs-sandbox.sync_request") {
          console.log("[HOST] SYNC_REQUEST: " + JSON.stringify(m.payload).slice(0, 200));
          
          // Build response: for each definition, provide a snapshot
          const snapshots: Record<string, any> = {};
          for (const def of m.payload.definitions || []) {
            if (def.kind === "root") {
              snapshots[String(def.id)] = {}; // root objects are proxies
            } else if (def.kind === "property") {
              snapshots[String(def.id)] = {}; // property proxies
            }
          }
          
          // Handle load commands
          for (const cmd of m.payload.commands || []) {
            if (cmd.kind === "load") {
              // Return empty data for now
              snapshots[String(cmd.targetId)] = {
                values: [["test"]],
                text: [["test"]],
              };
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
      // Note: uses patched sandbox that fixes resolvePromise executePendingJobs issue
      setTimeout(() => { iframe.remove(); resolve({ timeout: true }); }, 20000);
    });
  }, tc.script);
  
  if (result.ok) {
    console.log(`  ✅ Result: ${JSON.stringify(result.result)}`);
    if (result.logs?.length) console.log(`  📝 Logs: ${JSON.stringify(result.logs)}`);
  } else if (result.timeout) {
    console.log(`  ⏰ TIMEOUT`);
  } else {
    console.log(`  ❌ Error: ${result.error}`);
    if (result.logs?.length) console.log(`  📝 Logs: ${JSON.stringify(result.logs)}`);
  }
}

console.log("\n=== Done ===");
await browser.close();
server.stop();
