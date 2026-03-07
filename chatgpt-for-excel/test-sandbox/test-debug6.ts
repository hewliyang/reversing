import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8785,
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
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE_ERR] ${err.message}`));

// Load sandbox page directly and try to use its QuickJS
await page.goto(`${server.url}/sandbox/`, { waitUntil: 'networkidle2', timeout: 30000 });

// Import the sandbox module and try to use QuickJS directly
const result = await page.evaluate(async () => {
  try {
    // The sandbox module auto-invokes Hg() on load.
    // Let's try importing the module again and calling newQuickJSWASMModule directly
    const protocol = await import('/assets/officejs-sandbox-protocol-DHHFLCK9.js');
    console.log("Protocol loaded, keys:", Object.keys(protocol).join(','));
    
    const sandbox = await import('/assets/sandbox-BAMHNVll.js');
    console.log("Sandbox module loaded, keys:", Object.keys(sandbox).join(','));
    console.log("Sandbox default:", typeof sandbox.default);
    
    // The sandbox module's default export is the result of rg() which runs the IIFE
    // The IIFE calls Hg() which sets up message listeners
    // But it also defines the QuickJS functions in the module scope
    
    return { loaded: true, keys: Object.keys(sandbox) };
  } catch (e: any) {
    return { error: e.message, stack: e.stack };
  }
});
console.log("Result:", JSON.stringify(result, null, 2));

// Let me try a completely different approach - just test if the WASM binary from the
// sandbox JS file can be extracted and compiled
console.log("\n--- Testing WASM binary extraction ---");
const wasmResult = await page.evaluate(async () => {
  try {
    // Get the source of the sandbox script
    const resp = await fetch('/assets/sandbox-BAMHNVll.js');
    const src = await resp.text();
    
    // Find the base64 WASM data
    const marker = 'data:application/octet-stream;base64,';
    const idx = src.indexOf(marker);
    if (idx === -1) return { error: "No base64 WASM found" };
    
    // Extract the base64 string (ends at the next quote)
    const start = idx + marker.length;
    let end = start;
    while (end < src.length && src[end] !== '"' && src[end] !== "'") end++;
    const b64 = src.slice(start, end);
    
    console.log(`Found WASM base64: ${b64.length} chars`);
    
    // Decode
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    
    console.log(`WASM binary: ${bytes.length} bytes, magic: ${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]}`);
    
    // Try to compile
    console.log("Compiling WASM...");
    const t0 = performance.now();
    const module = await WebAssembly.compile(bytes);
    const t1 = performance.now();
    console.log(`WASM compiled in ${(t1-t0).toFixed(0)}ms`);
    
    // Try to instantiate with minimal imports
    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module);
    
    return {
      compiled: true,
      compileMs: Math.round(t1-t0),
      wasmSize: bytes.length,
      importCount: imports.length,
      exportCount: exports.length,
      sampleImports: imports.slice(0, 5).map((i: any) => `${i.module}.${i.name}(${i.kind})`),
      sampleExports: exports.slice(0, 5).map((e: any) => `${e.name}(${e.kind})`),
    };
  } catch (e: any) {
    return { error: e.message, stack: e.stack };
  }
});
console.log("WASM result:", JSON.stringify(wasmResult, null, 2));

await browser.close();
server.stop();
