import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8784,
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

// Load the sandbox page directly and check for errors after a long wait
const page = await browser.newPage();

const allLogs: string[] = [];
page.on('console', msg => { allLogs.push(`[${msg.type()}] ${msg.text()}`); });
page.on('pageerror', err => { allLogs.push(`[PAGE_ERR] ${err.message}`); });

// Intercept all requests to see what the page is trying to fetch
page.on('requestfailed', req => {
  allLogs.push(`[REQ_FAIL] ${req.url()} ${req.failure()?.errorText}`);
});
page.on('request', req => {
  if (!req.url().includes('favicon'))
    allLogs.push(`[REQ] ${req.method()} ${req.url()}`);
});

console.log("Loading sandbox page directly...");
await page.goto(`${server.url}/sandbox/`, { waitUntil: 'load', timeout: 30000 });
console.log("Load event fired, waiting 10s for WASM...");
await new Promise(r => setTimeout(r, 10000));

console.log("\nAll logs:");
allLogs.forEach(l => console.log("  " + l));

// Check if there are pending promises or errors
const status = await page.evaluate(() => {
  const result: any = {};
  result.hasCrypto = typeof crypto !== 'undefined';
  result.hasWASM = typeof WebAssembly !== 'undefined';
  
  // Try to compile a tiny WASM module to verify WASM works
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0]);
  try {
    const mod = new WebAssembly.Module(bytes);
    result.wasmWorks = true;
  } catch (e: any) {
    result.wasmWorks = false;
    result.wasmError = e.message;
  }
  
  // Check performance of base64 decode (the WASM binary path)
  try {
    const testB64 = btoa("hello world");
    result.btoa = testB64;
    result.atob = atob(testB64);
  } catch (e: any) {
    result.atobError = e.message;
  }
  
  return result;
});
console.log("\nPage status:", JSON.stringify(status, null, 2));

await browser.close();
server.stop();
