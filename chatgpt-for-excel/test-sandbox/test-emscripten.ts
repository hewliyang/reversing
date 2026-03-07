import puppeteer from "puppeteer";

// Serve the sandbox JS as a module that the iframe can load directly
const server = Bun.serve({
  port: 8790,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    
    // Serve a test page that loads sandbox-BAMHNVll.js as a module and tests QuickJS init
    if (path === "/test-init/") {
      return new Response(`<!doctype html><html><body><script type="module">
window.addEventListener("message", async (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.start();
  
  const log = (s) => { console.log(s); port.postMessage({ log: s }); };
  
  try {
    log("Loading sandbox module...");
    const mod = await import('/assets/sandbox-BAMHNVll.js');
    log("Module loaded: " + typeof mod.default);
    
    // The module already called Hg() which set up a window message listener.
    // But we received the bootstrap via our own listener first.
    // The issue is Hg checks e.source !== window.parent - since this IS a message
    // from the parent, it should match.
    
    // Actually, the problem might be that Hg() already ran and consumed 
    // the message listener. Let's just test if QuickJS itself works.
    
    // We need to somehow call Lg or the QuickJS init...
    // But those are all closures. Let's try a different approach:
    // manually extract and call newQuickJSWASMModule
    
    log("Trying to get quickjs-emscripten...");
    
    // The variable eg = uI() holds the quickjs-emscripten module
    // It's a closure but we can try to import and find it
    
    // Actually, simpler: test if the module works by simulating the full protocol
    // The module sets up Hg() which listens for window messages
    // We need to send it a BOOTSTRAP from "parent"... but we ARE the page
    
    // Wait - since we loaded this as a direct page (not iframe), 
    // window.parent === window. The Hg() code checks:
    //   if (G || c.source !== U.parent || !_I(c.data)) return;
    // When loaded directly, window.parent === window, and postMessage
    // sets source to the window that called it. If we postMessage to ourselves,
    // source === window === window.parent. So it should work!
    
    log("Testing self-bootstrap...");
    const channel = new MessageChannel();
    const iid = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    
    const result = await new Promise((resolve) => {
      channel.port1.addEventListener("message", (ev) => {
        const m = ev.data;
        log("Port1 got: " + (m?.type || JSON.stringify(m)));
        
        if (m?.type === "bps.officejs-sandbox.ready") {
          log("Got READY, sending RUN...");
          channel.port1.postMessage({
            type: "bps.officejs-sandbox.run",
            protocolVersion: 1, invocationId: iid, nonce,
            script: "return 1 + 1;",
            limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 20000 },
          });
        }
        
        if (m?.type === "bps.officejs-sandbox.result") {
          resolve({ ok: true, result: m.result });
        }
        if (m?.type === "bps.officejs-sandbox.error") {
          resolve({ ok: false, error: m.error });
        }
      });
      channel.port1.start();
      
      // Bootstrap ourselves
      window.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
      
      setTimeout(() => resolve({ timeout: true }), 20000);
    });
    
    log("Result: " + JSON.stringify(result));
    port.postMessage({ done: true, ...result });
  } catch (e) {
    log("ERROR: " + e.message);
    port.postMessage({ error: e.message });
  }
});
port.postMessage({ loaded: true });
</script></body></html>`, {
        headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      return new Response(file, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    });
  },
});

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));

// Load the page and wait for messages
await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("=== Loading test-init page in iframe ===");
const result = await page.evaluate(async () => {
  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";

    const channel = new MessageChannel();
    const logs: string[] = [];
    
    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (m?.log) { logs.push(m.log); return; }
      if (m?.loaded) return; // initial load
      // Final result
      resolve({ ...m, logs });
    });
    channel.port1.start();

    iframe.addEventListener("load", () => {
      iframe.contentWindow!.postMessage("init", "*", [channel.port2]);
    });

    iframe.src = "/test-init/";
    document.body.appendChild(iframe);
    setTimeout(() => { iframe.remove(); resolve({ timeout: true, logs }); }, 25000);
  });
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await browser.close();
server.stop();
