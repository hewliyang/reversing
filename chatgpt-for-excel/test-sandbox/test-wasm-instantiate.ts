/**
 * Test WebAssembly.instantiate in a sandboxed iframe with the actual WASM binary.
 * This isolates whether the emscripten module instantiation hangs.
 */
import puppeteer from "puppeteer";

// Extract WASM binary as base64 from sandbox JS
const sandboxSrc = await Bun.file("assets/sandbox-BAMHNVll.js").text();
const marker = 'n="data:application/octet-stream;base64,';
const idx = sandboxSrc.indexOf(marker);
const b64Start = idx + marker.length;
const b64End = sandboxSrc.indexOf('"', b64Start);
const wasmBase64 = sandboxSrc.slice(b64Start, b64End);
console.log(`WASM base64 length: ${wasmBase64.length}`);

const IFRAME_HTML = `<!doctype html><html><body><script>
window.addEventListener("message", async (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.start();
  const wasmB64 = e.data;
  const results = {};
  
  try {
    // Decode base64 to bytes
    const t0 = performance.now();
    const binary = atob(wasmB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    results.decodeMs = Math.round(performance.now() - t0);
    results.wasmSize = bytes.byteLength;
    
    // Try WebAssembly.compile
    const t1 = performance.now();
    const module = await WebAssembly.compile(bytes);
    results.compileMs = Math.round(performance.now() - t1);
    
    // Check imports the module needs
    const imports = WebAssembly.Module.imports(module);
    const importModules = [...new Set(imports.map(i => i.module))];
    results.importModules = importModules;
    results.importCount = imports.length;
    
    // Try instantiate with minimal stubs
    const t2 = performance.now();
    const importObj = {};
    for (const imp of imports) {
      if (!importObj[imp.module]) importObj[imp.module] = {};
      if (imp.kind === "function") {
        importObj[imp.module][imp.name] = () => {};
      } else if (imp.kind === "memory") {
        importObj[imp.module][imp.name] = new WebAssembly.Memory({ initial: 256, maximum: 2048 });
      } else if (imp.kind === "table") {
        importObj[imp.module][imp.name] = new WebAssembly.Table({ initial: 0, element: "anyfunc" });
      } else if (imp.kind === "global") {
        importObj[imp.module][imp.name] = new WebAssembly.Global({ value: "i32" }, 0);
      }
    }
    
    try {
      const instance = await WebAssembly.instantiate(module, importObj);
      results.instantiateMs = Math.round(performance.now() - t2);
      results.instantiateOk = true;
      results.exports = Object.keys(instance.exports).slice(0, 10);
    } catch (instErr) {
      results.instantiateMs = Math.round(performance.now() - t2);
      results.instantiateError = instErr.message;
    }
    
  } catch (e) {
    results.error = e.message;
  }
  
  port.postMessage(results);
});
<\/script></body></html>`;

const server = Bun.serve({
  port: 8794,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/iframe-test/") return new Response(IFRAME_HTML, {
      headers: { "Content-Type": "text/html" }
    });
    return new Response("<html><body>Host</body></html>", { headers: { "Content-Type": "text/html" } });
  },
});

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

for (const sandbox of ["allow-scripts", null]) {
  console.log(`\n=== sandbox="${sandbox ?? 'none'}" ===`);
  const result = await page.evaluate(async (sb: string | null, b64: string) => {
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      if (sb) iframe.setAttribute("sandbox", sb);
      iframe.style.display = "none";

      const channel = new MessageChannel();
      channel.port1.addEventListener("message", (ev) => resolve(ev.data));
      channel.port1.start();

      iframe.addEventListener("load", () => {
        iframe.contentWindow!.postMessage(b64, "*", [channel.port2]);
      });

      iframe.src = "/iframe-test/";
      document.body.appendChild(iframe);
      setTimeout(() => { iframe.remove(); resolve({ timeout: true }); }, 20000);
    });
  }, sandbox, wasmBase64);
  console.log("Result:", JSON.stringify(result, null, 2));
}

await browser.close();
server.stop();
