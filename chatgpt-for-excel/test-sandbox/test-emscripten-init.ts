/**
 * Test: load the actual sandbox JS module in a sandboxed iframe and try to
 * call the emscripten factory to initialize QuickJS WASM.
 * We strip the bootstrap/message-handler code and just test WASM init directly.
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8795,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      const ct = path.endsWith(".js") ? "application/javascript" : 
                 path.endsWith(".html") ? "text/html" : "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" } });
    });
  },
});

// Create a minimal HTML that imports the sandbox module and tests WASM init
const IFRAME_HTML = `<!doctype html><html><body>
<script type="module">
  // Import the sandbox module - it auto-runs Hg() which sets up message listener
  // But we also need to manually test the WASM initialization
  try {
    // Dynamic import of the sandbox module
    const module = await import("../assets/sandbox-BAMHNVll.js");
    console.log("[IFRAME] Module loaded, default export type:", typeof module.default);
    
    // The module auto-registers a message listener (Hg function)
    // Let's also manually try to initialize QuickJS by sending messages through normal protocol
    // Signal to parent that module loaded
    window.__moduleLoaded = true;
  } catch (e) {
    console.error("[IFRAME] Module load error:", e.message, e.stack);
    window.__moduleError = e.message;
  }
</script>
</body></html>`;

await Bun.write("test-iframe-init.html", IFRAME_HTML);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`  [PAGE_ERR] ${err.message}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

// Test 1: sandboxed iframe
console.log("\n=== Test: sandbox='allow-scripts' ===");
let result = await page.evaluate(async () => {
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
      console.log("[PORT] type=" + m.type);
      
      if (m.type === "bps.officejs-sandbox.ready") {
        console.log("[HOST] Got READY, sending RUN...");
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 42;",
          limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 30000 },
        });
      }
      
      if (m.type === "bps.officejs-sandbox.result") {
        resolve({ ok: true, result: m.result, logs: m.logs });
      }
      if (m.type === "bps.officejs-sandbox.error") {
        resolve({ ok: false, error: m.error, logs: m.logs });
      }
    });
    channel.port1.start();
    
    iframe.addEventListener("load", () => {
      console.log("[HOST] iframe loaded, sending bootstrap...");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });
    
    iframe.src = "/test-iframe-init.html";
    document.body.appendChild(iframe);
    setTimeout(() => resolve({ timeout: true }), 35000);
  });
});
console.log("Result:", JSON.stringify(result));

// Test 2: no sandbox at all
console.log("\n=== Test: no sandbox ===");
result = await page.evaluate(async () => {
  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    // NO sandbox attribute
    iframe.style.display = "none";
    
    const channel = new MessageChannel();
    const iid = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    
    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      console.log("[PORT2] type=" + m.type);
      
      if (m.type === "bps.officejs-sandbox.ready") {
        console.log("[HOST2] Got READY, sending RUN...");
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 42;",
          limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 30000 },
        });
      }
      
      if (m.type === "bps.officejs-sandbox.result") {
        resolve({ ok: true, result: m.result, logs: m.logs });
      }
      if (m.type === "bps.officejs-sandbox.error") {
        resolve({ ok: false, error: m.error, logs: m.logs });
      }
    });
    channel.port1.start();
    
    iframe.addEventListener("load", () => {
      console.log("[HOST2] iframe loaded, sending bootstrap...");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });
    
    iframe.src = "/test-iframe-init.html";
    document.body.appendChild(iframe);
    setTimeout(() => resolve({ timeout: true }), 35000);
  });
});
console.log("Result:", JSON.stringify(result));

await browser.close();
server.stop();
