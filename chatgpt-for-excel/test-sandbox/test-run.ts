import puppeteer from "puppeteer";

const server = Bun.serve({
  port: 8786,
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

// Use CDP to capture ALL frames' console output
const client = await page.createCDPSession();
await client.send('Runtime.enable');
client.on('Runtime.consoleAPICalled', (params: any) => {
  const args = params.args?.map((a: any) => a.value ?? a.description ?? '?').join(' ');
  console.log(`[CDP ${params.type}] ${args}`);
});
client.on('Runtime.exceptionThrown', (params: any) => {
  const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text;
  console.log(`[CDP EXCEPTION] ${desc}`);
});

await page.goto(`${server.url}/test-direct.html`, { waitUntil: 'networkidle2', timeout: 30000 });

console.log("Page loaded, waiting up to 35s...");
try {
  await page.waitForFunction(
    () => document.getElementById('out')?.textContent?.includes('Final:') ||
          document.getElementById('out')?.textContent?.includes('TIMEOUT'),
    { timeout: 35000 }
  );
} catch (e) {
  console.log("Wait failed:", (e as any).message);
}

const text = await page.evaluate(() => document.getElementById('out')?.textContent);
console.log("\n=== Page Output ===\n" + text);

await browser.close();
server.stop();
