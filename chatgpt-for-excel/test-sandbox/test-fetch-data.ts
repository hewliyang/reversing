import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8787,
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

// Test 1: Can we fetch data: URIs from the sandbox iframe?
console.log("=== Test: fetch data: URI in sandboxed iframe ===");
const page = await browser.newPage();
page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`  [PAGE_ERR] ${err.message}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

// Create a simple test HTML for the iframe that just tests fetch
const testResult = await page.evaluate(async () => {
  // Create a sandboxed iframe with inline script
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";

  const channel = new MessageChannel();

  const result = await new Promise<any>((resolve) => {
    channel.port1.addEventListener("message", (ev) => {
      resolve(ev.data);
    });
    channel.port1.start();

    // Create a blob URL for the iframe content
    const html = `<!DOCTYPE html><html><body><script>
      window.addEventListener("message", async (e) => {
        const port = e.ports[0];
        if (!port) return;
        
        const results = {};
        
        // Test 1: fetch data: URI
        try {
          const resp = await fetch("data:application/octet-stream;base64,AQID");
          results.fetchOk = resp.ok;
          results.fetchStatus = resp.status;
          const buf = await resp.arrayBuffer();
          results.fetchBytes = buf.byteLength;
        } catch (err) {
          results.fetchError = err.message;
        }
        
        // Test 2: WebAssembly compile
        try {
          const wasmBytes = new Uint8Array([0,97,115,109,1,0,0,0]);
          const mod = await WebAssembly.compile(wasmBytes);
          results.wasmOk = true;
        } catch (err) {
          results.wasmError = err.message;
        }
        
        // Test 3: WebAssembly compile with fetch of data URI
        try {
          const resp = await fetch("data:application/octet-stream;base64,AGFzbQEAAAA=");
          const buf = await resp.arrayBuffer();
          const mod = await WebAssembly.compile(buf);
          results.wasmFetchOk = true;
        } catch (err) {
          results.wasmFetchError = err.message;
        }
        
        // Test 4: Can we do a large base64 decode + WASM compile?
        try {
          // Small valid WASM module
          const b64 = btoa(String.fromCharCode(0,97,115,109,1,0,0,0));
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const mod = await WebAssembly.compile(bytes);
          results.btoa_atob_wasm = true;
        } catch (err) {
          results.btoaError = err.message;
        }
        
        port.postMessage(results);
      });
    <\\/script></body></html>`;

    // Use srcdoc instead of blob URL (works with sandbox)
    iframe.srcdoc = html;
    document.body.appendChild(iframe);

    iframe.addEventListener("load", () => {
      iframe.contentWindow!.postMessage("test", "*", [channel.port2]);
    });

    setTimeout(() => resolve({ timeout: true }), 10000);
  });

  iframe.remove();
  return result;
});

console.log("\nSandboxed iframe results:", JSON.stringify(testResult, null, 2));

// Test 2: Load QuickJS directly in the page (not in iframe)
console.log("\n=== Test: QuickJS directly in page ===");
const page2 = await browser.newPage();
page2.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));

await page2.goto(`${server.url}/sandbox/`, { waitUntil: 'networkidle2', timeout: 15000 });
console.log("Sandbox page loaded directly, trying to init QuickJS...");

// Wait longer for WASM
await new Promise(r => setTimeout(r, 5000));

// Try to test if QuickJS initialized by checking if the module's internals are accessible
const qjsResult = await page2.evaluate(async () => {
  // Try importing the module to see if it re-exports anything useful
  try {
    const mod = await import('/assets/sandbox-BAMHNVll.js');
    // The module calls Hg() which listens for messages. 
    // Simulate being a parent sending a bootstrap
    // But we can't because window.parent === window when loaded directly

    // Let's check: can we manually load QuickJS?
    // We need to find the QuickJS module from the bundle
    // It's all closures... but we can test if the WASM compilation works
    // by trying the same fetch pattern

    const resp = await fetch('/assets/sandbox-BAMHNVll.js');
    const src = await resp.text();
    
    // Extract the data URI
    const marker = 'n="data:application/octet-stream;base64,';
    const idx = src.indexOf(marker);
    const b64Start = idx + marker.length;
    const b64End = src.indexOf('"', b64Start);
    const dataUri = "data:application/octet-stream;base64," + src.slice(b64Start, b64End);

    console.log(`Data URI length: ${dataUri.length}`);

    // Try to fetch it
    const t0 = performance.now();
    const wasmResp = await fetch(dataUri, { credentials: "same-origin" });
    const t1 = performance.now();
    console.log(`fetch took ${(t1-t0).toFixed(0)}ms, ok=${wasmResp.ok}, status=${wasmResp.status}`);
    
    const buf = await wasmResp.arrayBuffer();
    const t2 = performance.now();
    console.log(`arrayBuffer took ${(t2-t1).toFixed(0)}ms, size=${buf.byteLength}`);
    
    const module = await WebAssembly.compile(buf);
    const t3 = performance.now();
    console.log(`WASM compile took ${(t3-t2).toFixed(0)}ms`);
    
    return { ok: true, fetchMs: Math.round(t1-t0), bufMs: Math.round(t2-t1), compileMs: Math.round(t3-t2), size: buf.byteLength };
  } catch (e: any) {
    return { error: e.message, stack: e.stack };
  }
});
console.log("QuickJS WASM result:", JSON.stringify(qjsResult, null, 2));

await browser.close();
server.stop();
