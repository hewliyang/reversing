import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8783,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
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

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
  dumpio: true,  // Show browser stderr/stdout
});
const page = await browser.newPage();
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE_ERR] ${err.message}`));

// Load the sandbox page directly and test QuickJS
console.log("\n--- Loading sandbox page directly ---");
await page.goto(`${server.url}/sandbox/`, { waitUntil: 'networkidle2', timeout: 30000 });
console.log("Page loaded, waiting 3s for WASM init...");
await new Promise(r => setTimeout(r, 3000));

// Now try to manually trigger the guest runtime
const result = await page.evaluate(async () => {
  // The sandbox page's module should have already loaded
  // Let's see what globals are available
  const globals = Object.keys(window).filter(k => k.startsWith('_') || k.startsWith('bps'));
  
  // Try to see if there are any errors we can catch
  const output: string[] = [];
  
  // Override console to capture sandbox-internal logs
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;
  
  output.push(`Globals with _: ${globals.join(', ')}`);
  output.push(`typeof WebAssembly: ${typeof WebAssembly}`);
  
  // Check if the module exported anything accessible
  output.push(`document.scripts count: ${document.scripts.length}`);
  
  return output;
});
console.log("Direct page eval:", result);

// Now test: load as parent page and send messages to an iframe sandbox
console.log("\n--- Testing iframe communication with error capture ---");
await page.goto(`${server.url}`, { waitUntil: 'networkidle0', timeout: 30000 });

// Create an iframe but capture ALL its console output via CDP
const client = await page.createCDPSession();

// Enable log domain to capture iframe console
await client.send('Log.enable');
client.on('Log.entryAdded', (params: any) => {
  console.log(`[CDP LOG] ${params.entry.level}: ${params.entry.text} (${params.entry.url})`);
});

// Enable runtime to see exceptions from all contexts
await client.send('Runtime.enable');
client.on('Runtime.exceptionThrown', (params: any) => {
  const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text;
  console.log(`[CDP EXCEPTION] ${desc}`);
});

// Also capture console from all execution contexts (including iframes)
client.on('Runtime.consoleAPICalled', (params: any) => {
  const args = params.args?.map((a: any) => a.value || a.description || '?').join(' ');
  console.log(`[CDP CONSOLE ${params.type}] ${args}`);
});

const result2 = await page.evaluate(async () => {
  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    // No sandbox attribute - just test the basic flow
    iframe.style.display = "none";
    
    const channel = new MessageChannel();
    const iid = crypto.randomUUID();
    const nonce = crypto.randomUUID();

    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (!m) return;
      console.log(`[HOST PORT] ${m.type}`);
      
      if (m.type === "bps.officejs-sandbox.ready") {
        console.log("[HOST] Sending RUN...");
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 1 + 1;",
          limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 20000 },
        });
      }

      if (m.type === "bps.officejs-sandbox.result") {
        console.log("[HOST] Got RESULT!");
        iframe.remove();
        resolve({ ok: true, result: m.result, logs: m.logs });
      }

      if (m.type === "bps.officejs-sandbox.error") {
        console.log("[HOST] Got ERROR: " + m.error);
        iframe.remove();
        resolve({ ok: false, error: m.error, logs: m.logs });
      }
    });
    channel.port1.start();

    iframe.addEventListener("load", () => {
      console.log("[HOST] Iframe loaded, posting BOOTSTRAP...");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });

    iframe.src = "/sandbox/";
    document.body.appendChild(iframe);

    setTimeout(() => {
      console.log("[HOST] Timeout!");
      iframe.remove();
      resolve({ ok: false, timeout: true });
    }, 25000);
  });
});

console.log("\nFinal result:", JSON.stringify(result2, null, 2));

await browser.close();
server.stop();
