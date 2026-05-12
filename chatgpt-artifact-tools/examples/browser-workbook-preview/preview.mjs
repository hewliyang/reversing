import { extractXlsxArtifact } from "/src/xlsx-artifact.mjs";
import { mountWorkbookCanvas } from "/src/simple-workbook-canvas.mjs";

const rootElement = document.getElementById("root");
const statusElement = document.getElementById("status");
const fileInput = document.getElementById("file-input");
const loadSampleButton = document.getElementById("load-sample");
const fixturePicker = document.getElementById("fixture-picker");
const formulaToggleButton = document.getElementById("formula-toggle");
const zoomOutButton = document.getElementById("zoom-out");
const zoomInButton = document.getElementById("zoom-in");
const zoomLabel = document.getElementById("zoom-label");

let mountedPreview = null;
let showFormulas = false;
let zoom = 1;
let parseJobId = 0;
let activeWorker = null;
const nativeBridgeThresholdBytes = 2 * 1024 * 1024;

function setStatus(message) {
  statusElement.textContent = message;
}

function setZoom(value) {
  zoom = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  mountedPreview?.setZoom(zoom);
}

async function mountWorkbook(bytes, title) {
  setStatus("Parsing .xlsx with Walnut WASM worker...");
  const parsed = await parseWorkbook(bytes);
  if (parsed.kind !== "spreadsheet") {
    throw new Error(`Expected spreadsheet artifact, got ${parsed.kind}`);
  }

  setStatus("Drawing workbook to portable canvas...");
  mountedPreview?.destroy();
  mountedPreview = mountWorkbookCanvas(rootElement, parsed.workbook, {
    title,
    onRender: (sheet, address) => setStatus(`Rendered ${title} / ${sheet.name || "Sheet"} / ${address}`),
    onSelectionChange: (sheet, address) => setStatus(`Rendered ${title} / ${sheet.name || "Sheet"} / ${address}`),
  });
  formulaToggleButton.disabled = false;
  zoomOutButton.disabled = false;
  zoomInButton.disabled = false;
  mountedPreview.setShowFormulas(showFormulas);
  mountedPreview.setZoom(zoom);
  globalThis.__portableWorkbookPreview = {
    title,
    workbook: parsed.workbook,
    mountedPreview,
  };
}

function summarizeTimings(timings) {
  return timings.map((entry) => `${entry.name} ${entry.ms}ms`).join(", ");
}

async function parseWorkbook(bytes) {
  if (bytes.byteLength >= nativeBridgeThresholdBytes) {
    return parseWorkbookNative(bytes);
  }

  if (!globalThis.Worker) {
    return extractXlsxArtifact(bytes, {
      onStatus: setStatus,
      onTiming: (name, ms) => console.debug(`[xlsx] ${name}: ${ms}ms`),
    });
  }

  activeWorker?.terminate();
  const jobId = ++parseJobId;
  const worker = new Worker("/src/xlsx-worker.mjs", { type: "module" });
  activeWorker = worker;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const clear = () => {
      clearInterval(progressTimer);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
    };
    const progressTimer = setInterval(() => {
      const elapsed = Math.round((performance.now() - startedAt) / 1000);
      if (elapsed < 8) return;
      setStatus(`Still extracting workbook in Walnut worker... ${elapsed}s elapsed`);
    }, 1000);

    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "status") {
        setStatus(message.message);
        return;
      }
      if (message.id !== jobId) return;
      if (message.type === "result") {
        clear();
        if (message.timings?.length) console.debug(`[xlsx] ${summarizeTimings(message.timings)}`);
        resolve(message.parsed);
        return;
      }
      if (message.type === "error") {
        clear();
        const error = new Error(message.message || "Workbook worker failed");
        error.stack = message.stack || error.stack;
        reject(error);
      }
    });
    worker.addEventListener("error", (event) => {
      clear();
      reject(event.error || new Error(event.message));
    });
    worker.postMessage({ id: jobId, bytes: buffer }, [buffer]);
  });
}

async function parseWorkbookNative(bytes) {
  activeWorker?.terminate();
  activeWorker = null;
  setStatus("Parsing large .xlsx with native .NET OpenXML bridge...");
  const startedAt = performance.now();
  const response = await fetch("/api/parse-xlsx-native", {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Native XLSX bridge failed: ${response.status} ${text.slice(0, 500)}`);
  }
  setStatus("Decoding native bridge workbook JSON...");
  const parsed = await response.json();
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (parsed.timings?.length) console.debug(`[xlsx-native] ${summarizeTimings(parsed.timings)}, browser total ${elapsedMs}ms`);
  parsed.workbook ??= { sheets: [], styles: {} };
  parsed.workbook.nativeBridge = true;
  return parsed;
}

async function loadSample() {
  const fixture = fixturePicker?.value || new URLSearchParams(location.search).get("fixture");
  const sampleUrl = fixture ? `/sample.xlsx?fixture=${encodeURIComponent(fixture)}` : "/sample.xlsx";
  const response = await fetch(sampleUrl);
  if (!response.ok) throw new Error(`Sample request failed: ${response.status}`);
  await mountWorkbook(new Uint8Array(await response.arrayBuffer()), fixture ? `${fixture}.xlsx` : "calc-probe.xlsx");
  const url = new URL(location.href);
  url.searchParams.set("sample", "1");
  if (fixture) url.searchParams.set("fixture", fixture);
  else url.searchParams.delete("fixture");
  history.replaceState(null, "", url);
}

async function loadFile(file) {
  await mountWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
}

loadSampleButton.addEventListener("click", () => {
  loadSample().catch((error) => {
    console.error(error);
    setStatus(error?.message || String(error));
  });
});

fixturePicker?.addEventListener("change", () => {
  loadSample().catch((error) => {
    console.error(error);
    setStatus(error?.message || String(error));
  });
});

formulaToggleButton.addEventListener("click", () => {
  showFormulas = !showFormulas;
  formulaToggleButton.textContent = showFormulas ? "Show values" : "Show formulas";
  mountedPreview?.setShowFormulas(showFormulas);
});

zoomOutButton.addEventListener("click", () => setZoom(zoom - 0.1));
zoomInButton.addEventListener("click", () => setZoom(zoom + 0.1));

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  loadFile(file).catch((error) => {
    console.error(error);
    setStatus(error?.message || String(error));
  });
});

const initialParams = new URLSearchParams(location.search);
const initialFixture = initialParams.get("fixture");
if (fixturePicker && initialFixture) fixturePicker.value = initialFixture;

if (initialParams.get("sample") === "1") {
  loadSample().catch((error) => {
    console.error(error);
    setStatus(error?.message || String(error));
  });
}
