/**
 * Test the sandbox concept directly using quickjs-emscripten from npm,
 * bypassing the bundled sandbox-BAMHNVll.js entirely.
 * This proves the architecture works even if we can't get the original bundle working.
 */
import { getQuickJS } from "quickjs-emscripten";

console.log("Initializing QuickJS...");
const QuickJS = await getQuickJS();
console.log("QuickJS ready!");

// Create a runtime with limits
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(32 * 1024 * 1024);  // 32MB
runtime.setMaxStackSize(1024 * 1024);        // 1MB

const deadline = Date.now() + 20000;
runtime.setInterruptHandler(() => Date.now() > deadline);

const ctx = runtime.newContext();

// Inject mock Excel proxy globals
const logEntries: { level: string; message: string }[] = [];

// Create console.log
const consoleFn = ctx.newFunction("__bpsConsoleLog", (levelHandle, msgHandle) => {
  const level = ctx.getString(levelHandle);
  const msg = ctx.getString(msgHandle);
  logEntries.push({ level, message: msg });
});
ctx.setProp(ctx.global, "__bpsConsoleLog", consoleFn);
consoleFn.dispose();

// Test 1: Simple eval
console.log("\n=== Test 1: Simple eval ===");
const result1 = ctx.evalCode("1 + 1");
if (result1.error) {
  console.log("Error:", ctx.dump(result1.error));
  result1.error.dispose();
} else {
  console.log("Result:", ctx.dump(result1.value));
  result1.value.dispose();
}

// Test 2: Console capture
console.log("\n=== Test 2: Console capture ===");
logEntries.length = 0;
const result2 = ctx.evalCode(`
  __bpsConsoleLog("log", "hello from QuickJS sandbox");
  __bpsConsoleLog("warn", "this is a warning");
  42
`);
if (result2.error) {
  console.log("Error:", ctx.dump(result2.error));
  result2.error.dispose();
} else {
  console.log("Result:", ctx.dump(result2.value));
  console.log("Logs:", logEntries);
  result2.value.dispose();
}

// Test 3: No fetch/window/document
console.log("\n=== Test 3: No browser APIs ===");
const result3 = ctx.evalCode(`
  JSON.stringify({
    fetch: typeof fetch,
    window: typeof window,
    document: typeof document,
    XMLHttpRequest: typeof XMLHttpRequest,
    WebSocket: typeof WebSocket,
    setTimeout: typeof setTimeout,
    navigator: typeof navigator,
  })
`);
if (result3.error) {
  console.log("Error:", ctx.dump(result3.error));
  result3.error.dispose();
} else {
  console.log("Result:", JSON.parse(ctx.getString(result3.value)));
  result3.value.dispose();
}

// Test 4: Host call simulation (sync request/response pattern)
console.log("\n=== Test 4: Host call simulation ===");

// Mock spreadsheet data
const spreadsheet: Record<string, any> = {
  "Sheet1!A1": "Name", "Sheet1!B1": "Score",
  "Sheet1!A2": "Alice", "Sheet1!B2": 95,
  "Sheet1!A3": "Bob", "Sheet1!B3": 82,
};

// Create a host call function that simulates the broker
const hostCallFn = ctx.newFunction("__bpsHostCall", (requestHandle) => {
  const request = ctx.dump(requestHandle);
  console.log("  Host received sync request:", JSON.stringify(request).slice(0, 100));

  // Simulate: resolve property accesses and return snapshots
  const snapshots: Record<string, any> = {};
  for (const def of request.definitions || []) {
    if (def.kind === "root") continue;
    if (def.kind === "property") {
      snapshots[String(def.id)] = { _type: "proxy", property: def.property };
    }
  }

  // For load commands, return data
  for (const cmd of request.commands || []) {
    if (cmd.kind === "load") {
      snapshots[String(cmd.targetId)] = {
        values: [["Name", "Score"], ["Alice", 95], ["Bob", 82]],
        address: "Sheet1!A1:B3",
      };
    }
  }

  const response = { requestId: request.requestId, snapshots };
  const promise = ctx.newPromise();
  const responseHandle = ctx.evalCode(`(${JSON.stringify(response)})`);
  if (!responseHandle.error) {
    promise.resolve(responseHandle.value);
    responseHandle.value.dispose();
  }
  promise.settled.then(ctx.runtime.executePendingJobs);
  return promise.handle;
});
ctx.setProp(ctx.global, "__bpsHostCall", hostCallFn);
hostCallFn.dispose();

// Now run a script that simulates what the wrapped user code would do
const testScript = `
  (async () => {
    // Simulate a sync request (like ctx.sync() would do)
    const request = {
      requestId: "req-1",
      definitions: [
        { kind: "root", id: 1, root: "ctx" },
        { kind: "property", id: 3, parentId: 1, property: "workbook" },
      ],
      commands: [
        { kind: "load", targetId: 3, spec: ["values"] }
      ]
    };
    
    const response = await __bpsHostCall(request);
    __bpsConsoleLog("log", "Got response: " + JSON.stringify(response));
    
    // Extract data from snapshot
    const data = response.snapshots["3"];
    __bpsConsoleLog("log", "Values: " + JSON.stringify(data.values));
    
    return data.values.length;
  })()
`;

logEntries.length = 0;
const result4 = ctx.evalCode(testScript);
if (result4.error) {
  console.log("Error:", ctx.dump(result4.error));
  result4.error.dispose();
} else {
  // It's a promise, need to resolve it
  const promiseResult = ctx.resolvePromise(result4.value);
  result4.value.dispose();
  runtime.executePendingJobs();
  
  const resolved = await promiseResult;
  if (resolved.error) {
    console.log("Promise rejected:", ctx.dump(resolved.error));
    resolved.error.dispose();
  } else {
    console.log("Result:", ctx.dump(resolved.value));
    resolved.value.dispose();
  }
  console.log("Logs:", logEntries);
}

// Test 5: Timeout enforcement
console.log("\n=== Test 5: Infinite loop protection ===");
const shortDeadline = Date.now() + 100; // 100ms
runtime.setInterruptHandler(() => Date.now() > shortDeadline);
const result5 = ctx.evalCode("let i = 0; while(true) { i++; } i");
if (result5.error) {
  console.log("Caught (expected):", ctx.dump(result5.error));
  result5.error.dispose();
} else {
  console.log("Unexpected success:", ctx.dump(result5.value));
  result5.value.dispose();
}

// Cleanup
ctx.dispose();
runtime.dispose();
console.log("\n✅ All tests completed!");
