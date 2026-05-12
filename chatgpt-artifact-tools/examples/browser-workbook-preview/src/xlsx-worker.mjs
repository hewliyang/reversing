import { extractXlsxArtifact } from "./xlsx-artifact.mjs";

function postStatus(message) {
  self.postMessage({ type: "status", message });
}

self.addEventListener("message", async (event) => {
  const { id, bytes, options } = event.data || {};
  if (!id || !bytes) return;

  const timings = [];
  const mark = (name, start) => timings.push({ name, ms: Math.round(performance.now() - start) });

  try {
    postStatus("Starting Walnut worker...");
    let start = performance.now();
    const parsed = await extractXlsxArtifact(new Uint8Array(bytes), {
      ...(options || {}),
      onTiming: (name, ms) => timings.push({ name, ms }),
      onStatus: postStatus,
    });
    mark("worker total parse", start);
    delete parsed.protoBytes;
    self.postMessage({ type: "result", id, parsed, timings });
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error?.message || String(error),
      stack: error?.stack,
      timings,
    });
  }
});
