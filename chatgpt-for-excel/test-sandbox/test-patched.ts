/**
 * Test with the minimally-patched sandbox JS (just logging, no functional changes)
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8801,
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
page.on('pageerror', err => console.log(`  [PAGE_ERR] ${err.message}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("=== Starting test ===");
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
      console.log("[PORT] " + m.type);
      if (m.type === "bps.officejs-sandbox.ready") {
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 42;",
          limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 30000 },
        });
      }
      if (m.type === "bps.officejs-sandbox.result") resolve({ ok: true, result: m.result, logs: m.logs });
      if (m.type === "bps.officejs-sandbox.error") resolve({ ok: false, error: m.error, logs: m.logs });
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
    setTimeout(() => resolve({ timeout: true }), 20000);
  });
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await browser.close();
server.stop();
