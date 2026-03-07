import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8780,
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
console.log(`Server: ${server.url}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE_ERR] ${err.message}`));

// Minimal test: just try the sandbox protocol directly
await page.goto(`${server.url}`, { waitUntil: 'networkidle0', timeout: 30000 });

console.log("\n--- Running inline debug test ---");

const result = await page.evaluate(async () => {
  const PROTOCOL_VERSION = 1;
  const logs: string[] = [];
  const log = (s: string) => { logs.push(s); console.log("[DEBUG] " + s); };

  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";

    const channel = new MessageChannel();
    const invocationId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    let done = false;

    channel.port1.addEventListener("message", (event) => {
      const msg = event.data;
      log(`Port1 received: ${JSON.stringify(msg).slice(0, 200)}`);

      if (msg?.type === "bps.officejs-sandbox.ready") {
        log("Got READY! Sending RUN...");
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: PROTOCOL_VERSION,
          invocationId, nonce,
          script: "return 42;",
          limits: {
            maxObjectIds: 256, maxQueuedOperations: 256,
            maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 20000,
          },
        });
      }

      if (msg?.type === "bps.officejs-sandbox.result") {
        log(`Got RESULT: ${JSON.stringify(msg.result)}`);
        done = true;
        resolve({ success: true, result: msg.result, logs: msg.logs, debugLogs: logs });
      }

      if (msg?.type === "bps.officejs-sandbox.error") {
        log(`Got ERROR: ${msg.error}`);
        done = true;
        resolve({ success: false, error: msg.error, logs: msg.logs, debugLogs: logs });
      }
    });
    channel.port1.start();

    iframe.addEventListener("load", () => {
      log("Iframe loaded, posting BOOTSTRAP...");
      const cw = iframe.contentWindow;
      if (!cw) { log("No contentWindow!"); resolve({ success: false, debugLogs: logs }); return; }
      cw.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: PROTOCOL_VERSION, invocationId, nonce },
        "*",
        [channel.port2]
      );
      log("BOOTSTRAP posted with port transfer");
    });

    iframe.addEventListener("error", () => {
      log("Iframe error event");
      resolve({ success: false, debugLogs: logs });
    });

    iframe.src = "/sandbox/";
    document.body.appendChild(iframe);

    // Timeout
    setTimeout(() => {
      if (!done) {
        log("Timed out after 15s");
        resolve({ success: false, timeout: true, debugLogs: logs });
      }
    }, 15000);
  });
});

console.log("\n--- Result ---");
console.log(JSON.stringify(result, null, 2));

await browser.close();
server.stop();
