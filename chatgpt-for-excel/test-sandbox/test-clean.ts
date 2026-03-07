/**
 * Test the clean sandbox reimplementation directly (no browser needed).
 * Uses runProgram() from sandbox-clean.ts with quickjs-emscripten from npm.
 */
import { runProgram, type RunProgramOptions } from "../sandbox-clean";

const tests: { name: string; script: string; check: (r: any) => boolean }[] = [
  { name: "integer",     script: "return 42;",                    check: r => r.result === 42 },
  { name: "string",      script: 'return "hello";',               check: r => r.result === "hello" },
  { name: "boolean",     script: "return true;",                  check: r => r.result === true },
  { name: "null",        script: "return null;",                  check: r => r.result === null },
  { name: "undefined",   script: "",                              check: r => r.result === undefined },
  { name: "float",       script: "return 0.1 + 0.2;",            check: r => Math.abs(r.result - 0.3) < 1e-10 },
  { name: "array",       script: "return [1, 2, 3];",            check: r => JSON.stringify(r.result) === "[1,2,3]" },
  { name: "object",      script: 'return {a: 1, b: "two"};',     check: r => r.result.a === 1 && r.result.b === "two" },
  { name: "console.log", script: 'console.log("msg"); return 1;', check: r => r.result === 1 && r.logs.length > 0 },
  { name: "await",       script: "return await Promise.resolve(99);", check: r => r.result === 99 },
  { name: "async chain", script: `
    const a = await Promise.resolve(10);
    const b = await Promise.resolve(20);
    return a + b;`, check: r => r.result === 30 },
  { name: "fibonacci",   script: `
    function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }
    return fib(10);`, check: r => r.result === 55 },
  { name: "array reduce", script: `
    const arr = Array.from({length: 100}, (_, i) => i + 1);
    return arr.reduce((a, b) => a + b, 0);`, check: r => r.result === 5050 },
  { name: "JSON round-trip", script: `
    const obj = {nested: {arr: [1, "two", true, null]}};
    return JSON.parse(JSON.stringify(obj));`,
    check: r => r.result.nested.arr[0] === 1 && r.result.nested.arr[1] === "two" },
];

const errorTests: { name: string; script: string }[] = [
  { name: "throw Error",    script: 'throw new Error("boom");' },
  { name: "syntax error",   script: "return {;" },
  { name: "reference error", script: "return nonExistentVariable;" },
];

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  Clean Sandbox Reimplementation — Direct Test       ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

const opts: RunProgramOptions = {
  hostCall: async () => { throw new Error("No host calls expected"); },
  limits: {
    maxObjectIds: 256,
    maxQueuedOperations: 256,
    maxSerializedChars: 200_000,
    maxMatrixWriteCells: 10_000,
    timeoutMs: 10_000,
  },
};

let passed = 0, failed = 0;

for (const t of tests) {
  try {
    const result = await runProgram(t.script, opts);
    if (t.check(result)) {
      console.log(`  ✅ ${JSON.stringify(result.result)?.slice(0, 50).padEnd(50)} [${t.name}]`);
      passed++;
    } else {
      console.log(`  ❌ Got: ${JSON.stringify(result.result)?.slice(0, 50).padEnd(50)} [${t.name}]`);
      failed++;
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message?.slice(0, 50).padEnd(50)} [${t.name}]`);
    failed++;
  }
}

for (const t of errorTests) {
  try {
    const result = await runProgram(t.script, opts);
    console.log(`  ❌ Expected error but got: ${JSON.stringify(result.result)?.slice(0, 30)} [${t.name}]`);
    failed++;
  } catch (e: any) {
    console.log(`  ✅ Error caught: "${e.message?.slice(0, 40)}..."`.padEnd(55) + `[${t.name}]`);
    passed++;
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed (${tests.length + errorTests.length} total)`);
console.log(`${"═".repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
