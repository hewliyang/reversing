/**
 * Load the sandbox module in the iframe, then call Jg/newQuickJSWASMModule
 * using the module's own internal code, triggered by RUN message
 * BUT also add error catching at promise boundaries
 */
import puppeteer from "puppeteer";

// Create a patched sandbox that adds timing/error logs
const raw = await Bun.file("assets/sandbox-BAMHNVll.js").text();

// Patch 1: Add logging to the Lg function (runProgram)
// Original: async function Lg(C,U){const h={...fA,...U.limits},G=XI(),A=(await Jg(U.moduleLoader)).newRuntime()
let patched = raw.replace(
  'async function Lg(C,U){const h={...fA,...U.limits},G=XI(),A=(await Jg(U.moduleLoader)).newRuntime()',
  `async function Lg(C,U){console.error("[P] Lg enter");const h={...fA,...U.limits},G=XI();console.error("[P] calling Jg...");let _jgResult;try{_jgResult=await Jg(U.moduleLoader);console.error("[P] Jg resolved:",typeof _jgResult)}catch(_e){console.error("[P] Jg REJECTED:",_e);throw _e}const A=_jgResult.newRuntime();console.error("[P] newRuntime ok")`
);

// Patch 2: Add logging to Jg  
// Original: function Jg(C){return C?C():(XA||(XA=eg.newQuickJSWASMModule()),XA)}
patched = patched.replace(
  'function Jg(C){return C?C():(XA||(XA=eg.newQuickJSWASMModule()),XA)}',
  `function Jg(C){console.error("[P] Jg enter, hasModuleLoader:",!!C);if(C)return C();console.error("[P] creating WASM module, XA exists:",!!XA);if(!XA){XA=eg.newQuickJSWASMModule();XA.then(r=>{console.error("[P] newQuickJSWASMModule resolved:",typeof r)},e=>{console.error("[P] newQuickJSWASMModule REJECTED:",e)})}return XA}`
);

// Patch 3: Add logging to newQuickJSWASMModule
// Original: async function A(a=C.RELEASE_SYNC){const[I,w,{QuickJSWASMModule:Q}]=await Promise.all([a.importModuleLoader(),a.importFFI(),Promise.resolve().then(()=>G(fI())).then(k.unwrapTypescript)]),D=await I();
patched = patched.replace(
  'async function A(a=C.RELEASE_SYNC){const[I,w,{QuickJSWASMModule:Q}]=await Promise.all([a.importModuleLoader(),a.importFFI(),Promise.resolve().then(()=>G(fI())).then(k.unwrapTypescript)]),D=await I()',
  `async function A(a=C.RELEASE_SYNC){console.error("[P] newQuickJSWASMModule enter");const _p1=a.importModuleLoader();_p1.then(r=>console.error("[P] importModuleLoader resolved:",typeof r),e=>console.error("[P] importModuleLoader rejected:",e));const _p2=a.importFFI();_p2.then(r=>console.error("[P] importFFI resolved:",typeof r),e=>console.error("[P] importFFI rejected:",e));const _p3=Promise.resolve().then(()=>G(fI())).then(k.unwrapTypescript);_p3.then(r=>console.error("[P] fI resolved:",typeof r,Object.keys(r||{}).slice(0,5)),e=>console.error("[P] fI rejected:",e));const[I,w,{QuickJSWASMModule:Q}]=await Promise.all([_p1,_p2,_p3]);console.error("[P] all 3 promises resolved");console.error("[P] calling factory I()...");const D=await I()`
);

// Verify patches
for (const tag of ['[P] Lg enter', '[[P] Jg enter', '[P] newQuickJSWASMModule enter']) {
  console.log(patched.includes(tag) ? `✅ ${tag}` : `❌ ${tag}`);
}

await Bun.write("assets/sandbox-patched2.js", patched);

// Create patched sandbox HTML
await Bun.write("sandbox-patched/index.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <base href="/sandbox-patched/" />
  <script type="module" crossorigin src="../assets/sandbox-patched2.js"></script>
  <link rel="modulepreload" crossorigin href="../assets/officejs-sandbox-protocol-DHHFLCK9.js">
</head>
<body></body>
</html>`);

// Validate syntax
const proc = Bun.spawnSync(["node", "-c", "assets/sandbox-patched2.js"]);
console.log("Syntax check:", proc.exitCode === 0 ? "OK" : "FAILED: " + proc.stderr.toString());

// Also validate as module
const proc2 = Bun.spawnSync(["node", "--input-type=module", "-e", `import './assets/sandbox-patched2.js'`], {
  cwd: process.cwd()
});
console.log("Module check:", proc2.exitCode === 0 ? "OK" : "FAILED");
if (proc2.exitCode !== 0) {
  const stderr = proc2.stderr.toString();
  // Find the error line
  const match = stderr.match(/SyntaxError: (.+)/);
  if (match) console.log("  Error:", match[1]);
  const lineMatch = stderr.match(/:(\d+)/);
  if (lineMatch) console.log("  Near line:", lineMatch[1]);
}

const server = Bun.serve({
  port: 8800,
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

console.log("\n=== Starting test ===");
const result = await page.evaluate(async () => {
  return new Promise<any>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    
    const channel = new MessageChannel();
    const iid = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    
    channel.port1.addEventListener("message", (ev) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      console.log("[PORT] " + m.type);
      
      if (m.type === "bps.officejs-sandbox.ready") {
        channel.port1.postMessage({
          type: "bps.officejs-sandbox.run",
          protocolVersion: 1, invocationId: iid, nonce,
          script: "return 42;",
          limits: { maxObjectIds: 256, maxQueuedOperations: 256, maxSerializedChars: 200000, maxMatrixWriteCells: 10000, timeoutMs: 30000 },
        });
      }
      if (m.type === "bps.officejs-sandbox.result") resolve({ ok: true, result: m.result });
      if (m.type === "bps.officejs-sandbox.error") resolve({ ok: false, error: m.error });
    });
    channel.port1.start();
    
    iframe.addEventListener("load", () => {
      iframe.contentWindow!.postMessage(
        { type: "bps.officejs-sandbox.bootstrap", protocolVersion: 1, invocationId: iid, nonce },
        "*", [channel.port2]
      );
    });
    
    iframe.src = "/sandbox-patched/";
    document.body.appendChild(iframe);
    setTimeout(() => resolve({ timeout: true }), 20000);
  });
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await browser.close();
server.stop();
