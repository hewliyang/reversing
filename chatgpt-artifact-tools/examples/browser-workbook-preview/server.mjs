#!/usr/bin/env node

import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, "src");
const fixtureDir = path.resolve(here, "../../tmp/browser-workbook-fixtures");
const walnutWasmDir =
  process.env.WALNUT_WASM_DIR ??
  path.resolve(here, "../../node_modules/@oai/artifact-tool/node_modules/@oai/walnut/wasm");
const defaultSample = path.resolve(here, "../../tmp/spreadsheet-probe/calc-probe.xlsx");
const nativeBridgeProject = path.join(here, "dotnet/XlsxBridge/XlsxBridge.csproj");
const nativeBridgeOut = path.join(os.tmpdir(), "browser-workbook-preview-xlsx-bridge");
const dotnetBinary =
  process.env.DOTNET ??
  (existsSync("/tmp/dotnet-sdk/dotnet") ? "/tmp/dotnet-sdk/dotnet" : "dotnet");
const sampleFixtures = new Map([
  ["chart", "chart-fixture.xlsx"],
  ["conditional-formatting", "conditional-formatting-fixture.xlsx"],
  ["fidelity", "fidelity-fixture.xlsx"],
  ["image", "image-drawing-fixture.xlsx"],
  ["large", "large-fixture.xlsx"],
  ["pivot-slicer-validation", "pivot-slicer-validation-fixture.xlsx"],
  ["table-validation", "table-validation-fixture.xlsx"],
]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function ensureWalnutAvailable() {
  if (existsSync(path.join(walnutWasmDir, "dotnet.js"))) return;
  throw new Error(`Walnut WASM runtime not found at ${walnutWasmDir}`);
}

let nativeBridgeBuildPromise = null;

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: stdoutBuffer, stderr: stderrText });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stderrText}`));
    });
  });
}

async function ensureNativeBridgeBuilt() {
  nativeBridgeBuildPromise ??= fs
    .mkdir(nativeBridgeOut, { recursive: true })
    .then(() => runProcess(dotnetBinary, ["build", nativeBridgeProject, "-c", "Release", "-o", nativeBridgeOut]));
  await nativeBridgeBuildPromise;
  return path.join(nativeBridgeOut, "XlsxBridge.dll");
}

async function readRequestBody(req, limitBytes = 250 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error(`Request body too large: ${size} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function parseXlsxNative(req, res) {
  const startedAt = Date.now();
  const body = await readRequestBody(req);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xlsx-bridge-"));
  const inputPath = path.join(tempDir, "input.xlsx");
  try {
    await fs.writeFile(inputPath, body);
    const bridgeDll = await ensureNativeBridgeBuilt();
    const result = await runProcess(dotnetBinary, [bridgeDll, inputPath], {
      maxBuffer: 512 * 1024 * 1024,
    });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": result.stdout.length,
      "X-Native-Bridge-Ms": String(Date.now() - startedAt),
    });
    res.end(result.stdout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function isWithin(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function sendFile(res, filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  createReadStream(filePath).pipe(res);
}

async function handler(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      await sendFile(res, path.join(here, "index.html"));
      return;
    }
    if (url.pathname === "/preview.mjs") {
      await sendFile(res, path.join(here, "preview.mjs"));
      return;
    }
    if (url.pathname === "/api/parse-xlsx-native" && req.method === "POST") {
      await parseXlsxNative(req, res);
      return;
    }
    if (url.pathname.startsWith("/src/")) {
      const relative = decodeURIComponent(url.pathname.slice("/src/".length));
      const filePath = path.resolve(sourceDir, relative);
      if (!isWithin(sourceDir, filePath)) throw new Error("Source path traversal rejected");
      await sendFile(res, filePath);
      return;
    }
    if (url.pathname.startsWith("/walnut-wasm/")) {
      const relative = decodeURIComponent(url.pathname.slice("/walnut-wasm/".length));
      const filePath = path.resolve(walnutWasmDir, relative);
      if (!isWithin(walnutWasmDir, filePath)) throw new Error("Walnut path traversal rejected");
      await sendFile(res, filePath);
      return;
    }
    if (url.pathname === "/sample.xlsx") {
      const fixture = url.searchParams.get("fixture");
      const fixtureFile = fixture ? sampleFixtures.get(fixture) : null;
      const sample = fixtureFile
        ? path.join(fixtureDir, fixtureFile)
        : process.env.SAMPLE_XLSX
          ? path.resolve(process.env.SAMPLE_XLSX)
          : defaultSample;
      await sendFile(res, sample);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error?.stack || String(error));
  }
}

ensureWalnutAvailable();

const port = Number.parseInt(process.env.PORT ?? "4177", 10);
const server = http.createServer((req, res) => {
  void handler(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Browser workbook preview: http://127.0.0.1:${port}/`);
  console.log(`Serving Walnut WASM from ${walnutWasmDir}`);
});
