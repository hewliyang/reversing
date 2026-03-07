import puppeteer from "puppeteer";

const PORT_HTML = `<!doctype html><html><body><script>
window.addEventListener("message", (e) => {
  const port = e.ports[0];
  if (!port) { console.log("NO PORT"); return; }
  console.log("GOT PORT, testing...");
  
  // Simple echo test
  port.addEventListener("message", (ev) => {
    console.log("Got message on port:", JSON.stringify(ev.data));
    port.postMessage({ echo: ev.data, ok: true });
  });
  port.start();
  port.postMessage({ ready: true });
});
console.log("Port test page loaded");
</script></body></html>`;

const server = Bun.serve({
  port: 8788,
  hostname: "127.0.0.1",
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/port-test/") return new Response(PORT_HTML, {
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

const client = await page.createCDPSession();
await client.send('Runtime.enable');
client.on('Runtime.consoleAPICalled', (params: any) => {
  const args = params.args?.map((a: any) => a.value ?? a.description ?? '?').join(' ');
  if (!args.includes('[')) console.log(`[CDP ${params.type}] ${args}`);
});

await page.goto(`${server.url}`, { waitUntil: 'networkidle2', timeout: 10000 });

// Test MessageChannel port transfer to sandboxed iframe
for (const sandbox of ["allow-scripts", "allow-scripts allow-same-origin", null]) {
  console.log(`\n=== sandbox="${sandbox ?? 'none'}" ===`);
  const result = await page.evaluate(async (sb: string | null) => {
    return new Promise<any>((resolve) => {
      const iframe = document.createElement("iframe");
      if (sb) iframe.setAttribute("sandbox", sb);
      iframe.style.display = "none";

      const channel = new MessageChannel();
      
      channel.port1.addEventListener("message", (ev) => {
        console.log("[HOST PORT] received:", JSON.stringify(ev.data));
        if (ev.data?.ready) {
          channel.port1.postMessage({ ping: "hello" });
        }
        if (ev.data?.echo) {
          resolve({ ok: true, echo: ev.data });
        }
      });
      channel.port1.start();

      iframe.addEventListener("load", () => {
        console.log("[HOST] iframe loaded, posting with port");
        iframe.contentWindow!.postMessage("bootstrap", "*", [channel.port2]);
      });

      iframe.src = "/port-test/";
      document.body.appendChild(iframe);

      setTimeout(() => {
        iframe.remove();
        resolve({ timeout: true });
      }, 5000);
    });
  }, sandbox);
  console.log("Result:", JSON.stringify(result));
}

await browser.close();
server.stop();
