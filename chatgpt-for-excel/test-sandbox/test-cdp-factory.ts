/**
 * Use Puppeteer frame evaluation to directly test WASM factory inside sandboxed iframe
 */
import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8798,
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

// Create sandboxed iframe loading the sandbox module
console.log("Creating sandboxed iframe...");
await page.evaluate(async () => {
  const iframe = document.createElement("iframe");
  iframe.id = "test-frame";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.src = "/sandbox/";
  document.body.appendChild(iframe);
  
  await new Promise<void>(resolve => {
    iframe.addEventListener("load", () => resolve());
  });
  console.log("iframe loaded");
});

await new Promise(r => setTimeout(r, 2000)); // Wait for module to initialize

const frames = page.frames();
const iframeFrame = frames.find(f => f.url().includes('/sandbox/'));

if (!iframeFrame) {
  console.log("ERROR: No iframe frame found!");
  await browser.close();
  server.stop();
  process.exit(1);
}

console.log("\nFound iframe frame. Testing WASM factory...\n");

// Test 1: Fetch the WASM data URI
const fetchResult = await iframeFrame.evaluate(async () => {
  try {
    // Get the data URI from the module's code
    // Since the module has already loaded, we can test the same fetch path
    const dataUri = "data:application/octet-stream;base64,AGFzbQEAAAA="; // tiny test
    const resp = await fetch(dataUri, { credentials: "same-origin" });
    return { fetchOk: resp.ok, status: resp.status };
  } catch (e: any) {
    return { error: e.message };
  }
});
console.log("Test 1 (fetch data URI):", fetchResult);

// Test 2: Full WASM fetch + compile + instantiate with real WASM
const wasmResult = await iframeFrame.evaluate(async () => {
  try {
    const sandboxSrc = await fetch("../assets/sandbox-BAMHNVll.js").then(r => r.text());
    const marker = 'n="data:application/octet-stream;base64,';
    const idx = sandboxSrc.indexOf(marker);
    const b64Start = idx + marker.length;
    const b64End = sandboxSrc.indexOf('"', b64Start);
    const dataUri = "data:application/octet-stream;base64," + sandboxSrc.slice(b64Start, b64End);
    
    console.log("Data URI length: " + dataUri.length);
    
    const t0 = performance.now();
    const resp = await fetch(dataUri, { credentials: "same-origin" });
    const buf = await resp.arrayBuffer();
    const t1 = performance.now();
    console.log("Fetch+arrayBuffer: " + Math.round(t1-t0) + "ms, size=" + buf.byteLength);
    
    const { module, instance } = await WebAssembly.instantiate(buf, {
      a: Object.fromEntries(
        WebAssembly.Module.imports(await WebAssembly.compile(buf))
          .filter(i => i.module === 'a')
          .map(i => [i.name, i.kind === 'function' ? () => {} : undefined])
          .filter(([k, v]) => v !== undefined)
      )
    });
    const t2 = performance.now();
    console.log("Instantiate: " + Math.round(t2-t1) + "ms");
    
    return { ok: true, exports: Object.keys(instance.exports).length };
  } catch (e: any) {
    return { error: e.message, stack: e.stack?.slice(0, 200) };
  }
});
console.log("Test 2 (full WASM):", wasmResult);

// Test 3: Check if the emscripten module's `ready` promise is pending
const readyState = await iframeFrame.evaluate(async () => {
  // The sandbox module should have set up globals we can probe
  // Check if there's a pending Promise
  const results: any = {};
  
  // Can we access the module scope? It's an ES module, so no.
  // But we can test the same path manually
  
  // Reproduce the emscripten module initialization
  const sandboxSrc = await fetch("../assets/sandbox-BAMHNVll.js").then(r => r.text());
  
  // Extract the emscripten factory function
  // It's wrapped as: var h = (() => { ... return function(k={}) { ... return k.ready }; })();
  // We can extract it by finding the WASM data URI and building a minimal factory
  
  // Actually, let's test the _exact_ scenario: import the module and call its internal factory
  // We can't do this from outside. Instead, let's create our own mini emscripten loader:
  
  const marker = 'n="data:application/octet-stream;base64,';
  const idx = sandboxSrc.indexOf(marker);
  const b64Start = idx + marker.length;
  const b64End = sandboxSrc.indexOf('"', b64Start);
  const dataUri = "data:application/octet-stream;base64," + sandboxSrc.slice(b64Start, b64End);
  
  // Fetch WASM
  console.log("Fetching WASM...");
  const wasmBuf = await fetch(dataUri, { credentials: "same-origin" }).then(r => r.arrayBuffer());
  console.log("WASM fetched, size: " + wasmBuf.byteLength);
  
  // Compile
  const wasmModule = await WebAssembly.compile(wasmBuf);
  const imports = WebAssembly.Module.imports(wasmModule);
  console.log("WASM compiled, imports: " + imports.length);
  
  // Build import object with proper stubs
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 });
  const importObj: any = { a: {} };
  for (const imp of imports) {
    if (imp.kind === "function") {
      importObj.a[imp.name] = function() { return 0; };
    } else if (imp.kind === "memory") {
      importObj.a[imp.name] = memory;
    }
  }
  
  console.log("Instantiating WASM...");
  const t0 = performance.now();
  const instance = await WebAssembly.instantiate(wasmModule, importObj);
  const t1 = performance.now();
  console.log("Instantiated in " + Math.round(t1-t0) + "ms");
  
  // Call __wasm_call_ctors (export 'q')
  try {
    console.log("Calling __wasm_call_ctors...");
    const exports = instance.exports as any;
    if (exports.q) {
      exports.q();
      console.log("__wasm_call_ctors succeeded");
    }
  } catch (e: any) {
    console.log("__wasm_call_ctors error: " + e.message);
  }
  
  return { ok: true };
});
console.log("Test 3 (emscripten init):", readyState);

await browser.close();
server.stop();
