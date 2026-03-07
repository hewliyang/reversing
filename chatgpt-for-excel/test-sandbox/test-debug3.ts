import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8782,
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

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`  [PAGE_ERR] ${err.message}`));

// Load a blank page first
await page.goto(`${server.url}`, { waitUntil: 'networkidle0', timeout: 30000 });

async function testWithSandbox(sandboxAttr: string | null) {
  const label = sandboxAttr ?? "(none)";
  console.log(`\n=== Testing sandbox="${label}" ===`);

  const result = await page.evaluate(async (sbAttr) => {
    const PV = 1;
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      if (sbAttr !== null) iframe.setAttribute("sandbox", sbAttr);
      iframe.style.display = "none";

      const channel = new MessageChannel();
      const iid = crypto.randomUUID();
      const nonce = crypto.randomUUID();

      channel.port1.addEventListener("message", (ev) => {
        const m = ev.data;
        if (!m || typeof m !== "object") return;
        console.log(`[PORT] type=${m.type}`);

        if (m.type === "bps.officejs-sandbox.ready") {
          channel.port1.postMessage({
            type: "bps.officejs-sandbox.run",
            protocolVersion: PV, invocationId: iid, nonce,
            script: "return 1 + 1;",
            limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 20000 },
          });
        }

        if (m.type === "bps.officejs-sandbox.sync_request") {
          // Respond with empty snapshots
          channel.port1.postMessage({
            type: "bps.officejs-sandbox.sync_response",
            protocolVersion: PV, invocationId: iid, nonce,
            payload: { requestId: m.payload.requestId, snapshots: {} },
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
          { type: "bps.officejs-sandbox.bootstrap", protocolVersion: PV, invocationId: iid, nonce },
          "*", [channel.port2]
        );
      });

      iframe.src = "/sandbox/";
      document.body.appendChild(iframe);

      setTimeout(() => { iframe.remove(); resolve({ ok: false, timeout: true }); }, 20000);
    });
  }, sandboxAttr);

  console.log(`  Result:`, JSON.stringify(result));
  return result;
}

await testWithSandbox("allow-scripts");
await testWithSandbox("allow-scripts allow-same-origin");
await testWithSandbox(null);

await browser.close();
server.stop();
