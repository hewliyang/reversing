/**
 * Test with CDP to monitor unhandled rejections and exceptions in the iframe
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8796,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    
    // Serve sandbox HTML with added error handler
    if (path === "/sandbox/index.html") {
      return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <base href="/sandbox/" />
  <script>
    // Catch ALL errors
    window.onerror = function(msg, src, line, col, err) {
      console.error("[IFRAME-ERR] onerror:", msg, src, line, col, err ? err.stack : "no stack");
    };
    window.addEventListener("unhandledrejection", function(e) {
      console.error("[IFRAME-ERR] unhandledrejection:", e.reason, e.reason instanceof Error ? e.reason.stack : typeof e.reason);
    });
    window.addEventListener("error", function(e) {
      console.error("[IFRAME-ERR] error event:", e.message);
    });
  </script>
  <script type="module" crossorigin src="../assets/sandbox-BAMHNVll.js"></script>
  <link rel="modulepreload" crossorigin href="../assets/officejs-sandbox-protocol-DHHFLCK9.js">
</head>
<body></body>
</html>`, { headers: { "Content-Type": "text/html" } });
    }
    
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Access-Control-Allow-Origin": "*" } });
    });
  },
});

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

// Listen to ALL console messages from all targets (including iframes)
const client = await page.createCDPSession();
await client.send('Runtime.enable');
await client.send('Log.enable');

client.on('Runtime.consoleAPICalled', (event) => {
  const args = event.args.map((a: any) => a.value ?? a.description ?? a.type).join(' ');
  console.log(`  [CDP ${event.type}] ${args}`);
});

client.on('Runtime.exceptionThrown', (event) => {
  const ex = event.exceptionDetails;
  console.log(`  [CDP EXCEPTION] ${ex.text} ${ex.exception?.description ?? ''}`);
});

client.on('Log.entryAdded', (event) => {
  console.log(`  [LOG ${event.entry.level}] ${event.entry.text}`);
});

page.on('console', msg => console.log(`  [page.${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`  [page.error] ${err.message}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("\n=== Starting sandbox test ===");
const result = await page.evaluate(async () => {
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
        console.log("[HOST] READY → sending RUN");
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
      console.log("[HOST] iframe loaded");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });
    
    iframe.src = "/sandbox/";
    document.body.appendChild(iframe);
    setTimeout(() => resolve({ timeout: true }), 35000);
  });
});

console.log("\n=== Result ===");
console.log(JSON.stringify(result, null, 2));

await browser.close();
server.stop();
