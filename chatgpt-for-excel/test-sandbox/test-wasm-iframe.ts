import puppeteer from "puppeteer";

const WASM_TEST_HTML = `<!doctype html><html><body><script>
window.addEventListener("message", async (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.start();
  const results = {};

  // Test 1: Basic WASM
  try {
    const bytes = new Uint8Array([0,97,115,109,1,0,0,0]);
    const mod = await WebAssembly.compile(bytes);
    results.basicWasm = "ok";
  } catch (e) { results.basicWasm = e.message; }

  // Test 2: fetch data: URI
  try {
    const resp = await fetch("data:application/octet-stream;base64,AGFzbQEAAAA=");
    results.fetchDataUri = resp.ok ? "ok" : "not ok: " + resp.status;
    const buf = await resp.arrayBuffer();
    results.fetchSize = buf.byteLength;
  } catch (e) { results.fetchDataUri = "error: " + e.message; }

  // Test 3: fetch the actual QuickJS WASM from the sandbox bundle
  try {
    const srcResp = await fetch("/assets/sandbox-BAMHNVll.js");
    const src = await srcResp.text();
    const m = 'n="data:application/octet-stream;base64,';
    const idx = src.indexOf(m);
    const s = idx + m.length;
    const end = src.indexOf('"', s);
    const dataUri = "data:application/octet-stream;base64," + src.slice(s, end);
    
    const resp = await fetch(dataUri, { credentials: "same-origin" });
    results.fetchQuickJS = resp.ok ? "ok" : "not ok: " + resp.status;
    const buf = await resp.arrayBuffer();
    results.quickJSSize = buf.byteLength;
    
    const mod = await WebAssembly.compile(buf);
    results.compileQuickJS = "ok";
  } catch (e) { results.fetchQuickJS = "error: " + e.message; }

  port.postMessage(results);
});
</script></body></html>`;

const server = Bun.serve({
  port: 8789,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/wasm-test/") return new Response(WASM_TEST_HTML, {
      headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
    });
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
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

for (const sandbox of ["allow-scripts", null]) {
  console.log(`\n=== sandbox="${sandbox ?? 'none'}" ===`);
  const result = await page.evaluate(async (sb: string | null) => {
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      if (sb) iframe.setAttribute("sandbox", sb);
      iframe.style.display = "none";

      const channel = new MessageChannel();
      channel.port1.addEventListener("message", (ev) => resolve(ev.data));
      channel.port1.start();

      iframe.addEventListener("load", () => {
        iframe.contentWindow!.postMessage("go", "*", [channel.port2]);
      });

      iframe.src = "/wasm-test/";
      document.body.appendChild(iframe);
      setTimeout(() => { iframe.remove(); resolve({ timeout: true }); }, 15000);
    });
  }, sandbox);
  console.log("Result:", JSON.stringify(result, null, 2));
}

await browser.close();
server.stop();
