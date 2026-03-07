/**
 * Extract and run the actual emscripten factory inside the sandboxed iframe
 */
import puppeteer from "puppeteer";

// Extract the emscripten factory from the formatted source
const formatted = await Bun.file("../sandbox-BAMHNVll.formatted.js").text();
const lines = formatted.split('\n');

// The factory function starts at "function Ng() {" line 2949 and contains the entire 
// emscripten module. But it's wrapped in CommonJS. We need to extract just the factory.
// 
// The raw factory is: var h = (() => { ... return function(k={}) { ... } })();
// It's inside lines ~2955 to ~3970
//
// Actually, let me just extract from the minified source and eval it

const raw = await Bun.file("assets/sandbox-BAMHNVll.js").text();

// Find the emscripten factory. It's inside Ng() which is a CommonJS module wrapper.
// The factory is assigned to C.exports = h where h is the IIFE return.
// Let me find it by looking for the characteristic emscripten pattern

// Find: "var h=(()=>{var G=typeof document" ... "return function(k={}){" 
const factoryStart = raw.indexOf('var h=(()=>{var G=typeof document<"u"&&document.currentScript?document.currentScript.src:void 0;');
console.log("Factory starts at:", factoryStart);

// Find the matching end - it should end with "})();" before "C.exports=h"
// Actually let me find C.exports=h
const exportsAssign = raw.indexOf('C.exports=h})(WA))', factoryStart);
console.log("Exports assign at:", exportsAssign);

// Extract: from "var h=" to just before "C.exports"
// Actually we need the factory function itself. Let me extract differently.
// The factory is: (()=>{ ... return function(k={}){ ... return k.ready} })()
// When called, it returns a function. Calling that function returns k.ready (a Promise)

// Find the inner function: "return function(k={}){" 
const innerFuncStart = raw.indexOf('return function(k={}){', factoryStart);
console.log("Inner function at:", innerFuncStart);

// For safety, let's extract the whole thing as a self-contained function
// by wrapping it. The factory IIFE captures `G` (document.currentScript) and returns the factory func.
// Then h = that factory func.

// Let me just extract everything from factoryStart to the point where h is defined
// and eval it in the iframe
const factoryEnd = raw.indexOf('})(WA))', factoryStart);
// h is defined by the IIFE. Extract: "var h=(()=>{...})();"
// Find the end of the IIFE
let braceCount = 0;
let iifEnd = -1;
const searchStart = raw.indexOf('(()=>{', factoryStart);
for (let i = searchStart; i < raw.length; i++) {
  if (raw[i] === '{') braceCount++;
  if (raw[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      // Found matching brace. The pattern should be "})();"
      if (raw.slice(i, i+5) === '})();') {
        iifEnd = i + 5;
        break;
      }
    }
  }
}
console.log("IIFE end at:", iifEnd, "factory length:", iifEnd - factoryStart);

const factoryCode = raw.slice(factoryStart, iifEnd);
console.log("Factory code preview:", factoryCode.slice(0, 100), "...", factoryCode.slice(-50));

// Now let's test this in the iframe
const server = Bun.serve({
  port: 8799,
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

// Create sandboxed iframe  
console.log("\nCreating sandboxed iframe...");
await page.evaluate(async () => {
  const iframe = document.createElement("iframe");
  iframe.id = "test-frame";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.src = "/sandbox/";
  document.body.appendChild(iframe);
  await new Promise<void>(resolve => iframe.addEventListener("load", () => resolve()));
});

await new Promise(r => setTimeout(r, 2000));

const iframeFrame = page.frames().find(f => f.url().includes('/sandbox/'));
if (!iframeFrame) { console.log("No iframe"); process.exit(1); }

console.log("Running emscripten factory in iframe...\n");

// Run the factory inside the iframe
const result = await Promise.race([
  iframeFrame.evaluate(async (code: string) => {
    console.log("Evaluating factory code, length: " + code.length);
    
    // Eval the factory code
    const fn = new Function(`
      ${code}
      return h;
    `);
    
    console.log("Created factory function");
    const factory = fn();
    console.log("Got factory, type: " + typeof factory);
    
    // Call the factory to create emscripten module
    console.log("Calling factory...");
    const t0 = performance.now();
    
    // The factory returns module.ready (a Promise)
    const moduleInstance = await Promise.race([
      factory(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("factory timeout after 10s")), 10000))
    ]);
    
    const t1 = performance.now();
    console.log("Factory resolved in " + Math.round(t1 - t0) + "ms!");
    
    return {
      ok: true,
      timeMs: Math.round(t1 - t0),
      type: typeof moduleInstance,
      hasAsm: moduleInstance && !!moduleInstance.asm,
      hasCwrap: moduleInstance && typeof moduleInstance.cwrap === "function",
    };
  }, factoryCode),
  new Promise<any>((resolve) => setTimeout(() => resolve({ timeout: true }), 15000))
]);

console.log("\nResult:", JSON.stringify(result, null, 2));

await browser.close();
server.stop();
