import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8781,
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

// Load the sandbox page DIRECTLY (not as an iframe) to see if QuickJS loads
await page.goto(`${server.url}/sandbox/`, { waitUntil: 'networkidle0', timeout: 30000 });
console.log("Sandbox page loaded directly, waiting 5s...");
await new Promise(r => setTimeout(r, 5000));

// Check if the sandbox module initialized  
const check = await page.evaluate(() => {
  return {
    hasWasm: typeof WebAssembly !== 'undefined',
    errors: (window as any).__errors || [],
  };
});
console.log("Check:", JSON.stringify(check));

await browser.close();
server.stop();
