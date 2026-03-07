/**
 * Use CDP to inspect execution contexts and manually run code in the iframe
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8797,
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

// Create sandbox iframe and wait for READY
const { iid, nonce } = await page.evaluate(async () => {
  const iframe = document.createElement("iframe");
  iframe.id = "sandbox-frame";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  
  const iid = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  
  // Store channel globally so we can access it
  const channel = new MessageChannel();
  (window as any).__port = channel.port1;
  (window as any).__iid = iid;
  (window as any).__nonce = nonce;
  
  const ready = new Promise<void>((resolve) => {
    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (m?.type === "bps.officejs-sandbox.ready") {
        console.log("Got READY");
        resolve();
      }
    });
    channel.port1.start();
  });
  
  await new Promise<void>((resolve) => {
    iframe.addEventListener("load", () => {
      console.log("iframe loaded");
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
      resolve();
    });
    iframe.src = "/sandbox/";
    document.body.appendChild(iframe);
  });
  
  // Wait for READY
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej("timeout"), 5000))]);
  
  return { iid, nonce };
});

console.log(`Bootstrap complete, iid=${iid.slice(0,8)}`);

// Now send RUN but also use CDP to check the iframe's internal state
const client = await page.createCDPSession();

// Get all execution contexts
await client.send('Runtime.enable');

// Wait a second, then find the iframe context
await new Promise(r => setTimeout(r, 1000));

// Evaluate in iframe context - get all frames
const frames = page.frames();
console.log(`\nFrames: ${frames.length}`);
for (const frame of frames) {
  console.log(`  - URL: ${frame.url()}`);
}

const iframeFrame = frames.find(f => f.url().includes('/sandbox/'));
if (iframeFrame) {
  console.log("\nFound iframe frame. Checking internal state...");
  
  // Check if the emscripten factory is available
  try {
    const check = await iframeFrame.evaluate(() => {
      // Check what globals are available
      return {
        hasWebAssembly: typeof WebAssembly !== "undefined",
        hasFetch: typeof fetch !== "undefined",
        hasSetTimeout: typeof setTimeout !== "undefined",
        windowType: typeof window,
        parentExists: window.parent !== window,
      };
    });
    console.log("Iframe globals:", check);
  } catch (e: any) {
    console.log("Can't evaluate in sandboxed iframe directly:", e.message);
  }
}

// Send the RUN message
console.log("\nSending RUN message...");
const result = await page.evaluate(async () => {
  const port = (window as any).__port;
  const iid = (window as any).__iid;
  const nonce = (window as any).__nonce;
  
  return new Promise<any>((resolve) => {
    port.addEventListener("message", (ev: MessageEvent) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      console.log("[PORT] " + m.type);
      if (m.type === "bps.officejs-sandbox.result") {
        resolve({ ok: true, result: m.result, logs: m.logs });
      }
      if (m.type === "bps.officejs-sandbox.error") {
        resolve({ ok: false, error: m.error, logs: m.logs });
      }
    });
    
    port.postMessage({
      type: "bps.officejs-sandbox.run",
      protocolVersion: 1, invocationId: iid, nonce,
      script: "return 42;",
      limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 30000 },
    });
    
    // Also set a check timer
    let checks = 0;
    const timer = setInterval(() => {
      checks++;
      console.log(`[WAIT] Still waiting after ${checks}s...`);
      if (checks >= 15) {
        clearInterval(timer);
        resolve({ timeout: true, checks });
      }
    }, 1000);
  });
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await browser.close();
server.stop();
