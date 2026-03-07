import puppeteer from "puppeteer";

// Start HTTP server
const server = Bun.serve({
  port: 8778,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file("." + path);
    return file.exists().then(exists => {
      if (!exists) { console.log(`404: ${path}`); return new Response("Not found", { status: 404 }); }
      console.log(`200: ${path}`);
      return new Response(file, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Opener-Policy": "same-origin",
        }
      });
    });
  },
});
console.log(`Server running at ${server.url}`);

try {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[PAGE ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

  console.log("Opening test page...");
  await page.goto(`${server.url}`, { waitUntil: 'networkidle0', timeout: 30000 });

  console.log("Waiting for tests to complete...");
  await page.waitForFunction(
    () => document.body.innerText.includes("tests passed"),
    { timeout: 60000 }
  );

  const text = await page.evaluate(() => document.body.innerText);
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));

  await page.screenshot({ path: 'test-results.png', fullPage: true });
  console.log("\nScreenshot saved to test-results.png");

  await browser.close();
} finally {
  server.stop();
}
