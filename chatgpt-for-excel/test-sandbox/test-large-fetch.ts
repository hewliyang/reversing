import puppeteer from "puppeteer";

// Extract the actual WASM data URI from the sandbox JS
const sandboxSrc = await Bun.file("assets/sandbox-BAMHNVll.js").text();
const marker = 'n="data:application/octet-stream;base64,';
const idx = sandboxSrc.indexOf(marker);
const b64Start = idx + marker.length;
const b64End = sandboxSrc.indexOf('"', b64Start);
const dataUri = "data:application/octet-stream;base64," + sandboxSrc.slice(b64Start, b64End);
console.log(`Data URI length: ${dataUri.length} chars`);

const IFRAME_HTML = `<!doctype html><html><body><script>
window.addEventListener("message", async (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.start();
  const results = {};
  const dataUri = e.data;
  
  try {
    console.log("Fetching data URI of length " + dataUri.length);
    const t0 = performance.now();
    const resp = await fetch(dataUri, { credentials: "same-origin" });
    const t1 = performance.now();
    results.fetchOk = resp.ok;
    results.fetchMs = Math.round(t1 - t0);
    
    const buf = await resp.arrayBuffer();
    const t2 = performance.now();
    results.bufSize = buf.byteLength;
    results.bufMs = Math.round(t2 - t1);
    
    const mod = await WebAssembly.compile(buf);
    const t3 = performance.now();
    results.compileOk = true;
    results.compileMs = Math.round(t3 - t2);
  } catch (e) {
    results.error = e.message;
  }
  
  port.postMessage(results);
});
<\/script></body></html>`;

const server = Bun.serve({
  port: 8793,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/iframe-test/") return new Response(IFRAME_HTML, {
      headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
    });
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

for (const sandbox of ["allow-scripts", null]) {
  console.log(`\n=== sandbox="${sandbox ?? 'none'}" ===`);
  const result = await page.evaluate(async (sb: string | null, uri: string) => {
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      if (sb) iframe.setAttribute("sandbox", sb);
      iframe.style.display = "none";

      const channel = new MessageChannel();
      channel.port1.addEventListener("message", (ev) => resolve(ev.data));
      channel.port1.start();

      iframe.addEventListener("load", () => {
        iframe.contentWindow!.postMessage(uri, "*", [channel.port2]);
      });

      iframe.src = "/iframe-test/";
      document.body.appendChild(iframe);
      setTimeout(() => { iframe.remove(); resolve({ timeout: true }); }, 15000);
    });
  }, sandbox, dataUri);
  console.log("Result:", JSON.stringify(result));
}

await browser.close();
server.stop();
