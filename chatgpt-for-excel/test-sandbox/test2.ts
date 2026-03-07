import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8779,
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
console.log(`Server: ${server.url}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE_ERR] ${err.message}`));

await page.goto(`${server.url}`, { waitUntil: 'networkidle0', timeout: 30000 });

// Wait a bit for tests to try running
console.log("Page loaded, waiting 15s for tests...");
await new Promise(r => setTimeout(r, 15000));

await page.screenshot({ path: 'test-results.png', fullPage: true });
console.log("Screenshot taken");

const html = await page.evaluate(() => document.body.innerHTML);
console.log("Page body:", html.slice(0, 2000));

await browser.close();
server.stop();
