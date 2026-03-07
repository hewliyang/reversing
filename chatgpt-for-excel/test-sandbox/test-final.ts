import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8791,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) return new Response("Not found", { status: 404 });
      const headers: Record<string,string> = { "Access-Control-Allow-Origin": "*" };
      if (path.endsWith(".js")) headers["Content-Type"] = "application/javascript";
      if (path.endsWith(".html")) headers["Content-Type"] = "text/html";
      return new Response(file, { headers });
    });
  },
});
console.log(`Server: ${server.url}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-web-security'],  // Disable CORS for testing
});

const page = await browser.newPage();
const logs: string[] = [];
page.on('console', msg => {
  const text = `[${msg.type()}] ${msg.text()}`;
  logs.push(text);
  console.log(text);
});
page.on('pageerror', err => {
  const text = `[PAGE_ERR] ${err.message}`;
  logs.push(text);
  console.log(text);
});

// Capture iframe console too
const client = await page.createCDPSession();
await client.send('Runtime.enable');
client.on('Runtime.exceptionThrown', (params: any) => {
  const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'unknown';
  console.log(`[CDP EXCEPTION] ${desc}`);
});
// Track ALL console calls from ALL contexts
client.on('Runtime.consoleAPICalled', (params: any) => {
  // Only log iframe messages (different executionContextId)
  const args = params.args?.map((a: any) => a.value ?? a.description ?? '?').join(' ');
  if (!args.includes('[HOST]') && !args.includes('[PORT]') && !args.includes('Failed to load'))
    console.log(`[CDP:${params.executionContextId} ${params.type}] ${args}`);
});

// Simple host page that creates an iframe and tests the sandbox
await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

console.log("\n=== Starting sandbox test ===\n");

const result = await page.evaluate(async () => {
  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";

    const channel = new MessageChannel();
    const iid = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const debugLog: string[] = [];

    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      debugLog.push(`[PORT] ${m.type}`);
      console.log(`[PORT] ${m.type}`);

      if (m.type === "bps.officejs-sandbox.ready") {
        console.log("[HOST] Got READY, sending RUN...");
        debugLog.push("[HOST] Sending RUN");
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 1 + 1;",
          limits: {
            maxObjectIds: 256, maxQueuedOperations: 256,
            maxSerializedChars: 200000, maxMatrixWriteCells: 10000,
            timeoutMs: 20000
          },
        });
      }

      if (m.type === "bps.officejs-sandbox.result") {
        console.log("[HOST] Got RESULT: " + JSON.stringify(m.result));
        resolve({ ok: true, result: m.result, logs: m.logs, debugLog });
      }

      if (m.type === "bps.officejs-sandbox.error") {
        console.log("[HOST] Got ERROR: " + m.error);
        resolve({ ok: false, error: m.error, logs: m.logs, debugLog });
      }
    });
    channel.port1.start();

    iframe.addEventListener("load", () => {
      console.log("[HOST] Iframe loaded, bootstrapping...");
      debugLog.push("[HOST] Bootstrapping");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });

    iframe.src = "/sandbox/";
    document.body.appendChild(iframe);

    setTimeout(() => {
      debugLog.push("[HOST] Timeout");
      resolve({ ok: false, timeout: true, debugLog });
    }, 30000);
  });
});

console.log("\n=== Result ===");
console.log(JSON.stringify(result, null, 2));

await browser.close();
server.stop();
