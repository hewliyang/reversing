#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const port = Number.parseInt(process.env.PORT ?? "4180", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const largeFixture = path.join(root, "tmp/browser-workbook-fixtures/large-fixture.xlsx");
const imageFixture = path.join(root, "tmp/browser-workbook-fixtures/image-drawing-fixture.xlsx");
const chartFixture = path.join(root, "tmp/browser-workbook-fixtures/chart-fixture.xlsx");
const conditionalFormattingFixture = path.join(root, "tmp/browser-workbook-fixtures/conditional-formatting-fixture.xlsx");
const combinedFixture = path.join(root, "tmp/browser-workbook-fixtures/pivot-slicer-validation-fixture.xlsx");
const fixtureGenerator = path.join(here, "scripts/generate-workbook-fixtures.mjs");

function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(here, "server.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Retry until the child server binds.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start at ${baseUrl}`);
}

async function testDefaultSample(page) {
  await page.goto(`${baseUrl}/?sample=1`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("/ A1"), null, {
    timeout: 60000,
  });
  await page.click("#zoom-in");
  await page.click("#formula-toggle");
  const target = await page.evaluate(() => {
    const layout = globalThis.__portableWorkbookPreview.mountedPreview.getActiveLayout();
    const rect = document.querySelector('canvas[aria-label="Spreadsheet canvas"]').getBoundingClientRect();
    return {
      x: rect.left + layout.rowHeaderWidth + layout.columnOffsets[4] - layout.scrollLeft + layout.columnWidths[4] / 2,
      y: rect.top + layout.colHeaderHeight + layout.rowOffsets[2] - layout.scrollTop + layout.rowHeights[2] / 2,
    };
  });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  return page.evaluate(async () => ({
    status: document.getElementById("status")?.textContent,
    zoom: document.getElementById("zoom-label")?.textContent,
    toggleText: document.getElementById("formula-toggle")?.textContent,
    clipboard: await navigator.clipboard.readText().catch((error) => `ERR:${error.message}`),
    codexAssets: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/codex-assets/")).length,
  }));
}

async function testLargeSample(page) {
  await page.goto(`${baseUrl}/?sample=1`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("/ A1"), null, {
    timeout: 60000,
  });
  await page.click("#zoom-out");
  for (let i = 0; i < 80; i += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  return page.evaluate(async () => ({
    status: document.getElementById("status")?.textContent,
    zoom: document.getElementById("zoom-label")?.textContent,
    scrollTop: document.querySelector(".canvas-scroller")?.scrollTop,
    clipboard: await navigator.clipboard.readText().catch((error) => `ERR:${error.message}`),
    codexAssets: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/codex-assets/")).length,
  }));
}

async function testImageSample(page) {
  await page.goto(`${baseUrl}/?sample=1`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.workbook?.sheets?.[0], null, {
    timeout: 60000,
  });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const workbook = globalThis.__portableWorkbookPreview.workbook;
    const sheet = workbook.sheets[0];
    const canvas = document.querySelector('canvas[aria-label="Spreadsheet canvas"]');
    const ctx = canvas.getContext("2d");
    const sample = ctx.getImageData(Math.floor(48 + 112 + 30), Math.floor(28 + 24 + 30), 1, 1).data;
    return {
      status: document.getElementById("status")?.textContent,
      imageCount: workbook.images?.length ?? 0,
      drawingCount: sheet.drawings?.length ?? 0,
      imageId: workbook.images?.[0]?.id,
      drawingImageId: sheet.drawings?.[0]?.imageReference?.id,
      sample: Array.from(sample),
      codexAssets: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/codex-assets/")).length,
    };
  });
}

async function testChartSample(page) {
  await page.goto(`${baseUrl}/?sample=1`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.workbook?.sheets?.[0], null, {
    timeout: 60000,
  });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const sheet = globalThis.__portableWorkbookPreview.workbook.sheets[0];
    const chart = sheet.drawings?.find((drawing) => drawing.chart)?.chart;
    const canvas = document.querySelector('canvas[aria-label="Spreadsheet canvas"]');
    const ctx = canvas.getContext("2d");
    const image = ctx.getImageData(320, 40, canvas.width - 320, Math.min(360, canvas.height - 40));
    const samples = [];
    for (let y = 0; y < image.height && samples.length < 4; y += 1) {
      for (let x = 0; x < image.width && samples.length < 4; x += 1) {
        const index = (y * image.width + x) * 4;
        const sample = Array.from(image.data.slice(index, index + 4));
        if (sample[2] > 150 && sample[0] < 120) samples.push(sample);
      }
    }
    return {
      status: document.getElementById("status")?.textContent,
      drawingCount: sheet.drawings?.length ?? 0,
      chartTitle: chart?.title,
      chartFormula: chart?.series?.[0]?.formula,
      samples,
      codexAssets: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/codex-assets/")).length,
    };
  });
}

async function testConditionalFormattingSample(page) {
  await page.goto(`${baseUrl}/?sample=1`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.workbook?.sheets?.[0], null, {
    timeout: 60000,
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const workbook = globalThis.__portableWorkbookPreview.workbook;
    const sheet = workbook.sheets[0];
    const canvas = document.querySelector('canvas[aria-label="Spreadsheet canvas"]');
    const ctx = canvas.getContext("2d");
    const layout = globalThis.__portableWorkbookPreview.mountedPreview.getActiveLayout();
    const sampleCell = (row, col) => {
      const x = Math.floor(layout.rowHeaderWidth + layout.columnOffsets[col] - layout.scrollLeft + layout.columnWidths[col] / 2);
      const y = Math.floor(layout.colHeaderHeight + layout.rowOffsets[row] - layout.scrollTop + layout.rowHeights[row] / 2);
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    };
    const b3 = sampleCell(3, 2);
    const b2 = sampleCell(2, 2);
    return {
      rule: sheet.conditionalFormattings?.[0]?.rules?.[0],
      dxfCount: workbook.styles?.dxfs?.length ?? 0,
      b3,
      b2,
      codexAssets: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/codex-assets/")).length,
    };
  });
}

async function testCombinedFixture(page) {
  await page.goto(`${baseUrl}/?sample=1&fixture=pivot-slicer-validation`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.workbook?.sheets?.length >= 3, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const workbook = globalThis.__portableWorkbookPreview.workbook;
    const dataSheet = workbook.sheets.find((sheet) => sheet.name === "Data");
    const pivotSheet = workbook.sheets.find((sheet) => sheet.name === "Pivot");
    const sparkSheet = workbook.sheets.find((sheet) => sheet.name === "Sparklines");
    const layout = globalThis.__portableWorkbookPreview.mountedPreview.getActiveLayout();
    const canvasRect = document.querySelector('canvas[aria-label="Spreadsheet canvas"]').getBoundingClientRect();
    const validationCell = { row: 2, col: 7 };
    const bounds = {
      x: canvasRect.left + layout.rowHeaderWidth + layout.columnOffsets[validationCell.col] - layout.scrollLeft,
      y: canvasRect.top + layout.colHeaderHeight + layout.rowOffsets[validationCell.row] - layout.scrollTop,
      width: layout.columnWidths[validationCell.col],
      height: layout.rowHeights[validationCell.row],
    };
    return {
      sheets: workbook.sheets.map((sheet) => sheet.name),
      data: {
        drawings: dataSheet.drawings?.length ?? 0,
        charts: dataSheet.drawings?.filter((drawing) => drawing.chart).length ?? 0,
        shapes: dataSheet.drawings?.filter((drawing) => drawing.shape).length ?? 0,
        tables: dataSheet.tables?.length ?? 0,
        validations: dataSheet.dataValidations?.items?.length ?? 0,
        cfs: dataSheet.conditionalFormattings?.length ?? 0,
        slicers: dataSheet.slicers?.length ?? 0,
        validationOptions: layout.validationMetadata.byCell.get("2:7")?.options ?? [],
        validationCellValue: dataSheet.rows.find((row) => row.index === 2)?.cells.find((cell) => cell.address === "G2")?.value,
      },
      pivot: {
        pivots: pivotSheet.pivotTables?.length ?? 0,
      },
      sparklines: {
        groups: sparkSheet.sparklineGroups?.groups?.length ?? 0,
      },
      workbookCaches: {
        slicerCaches: workbook.slicerCaches?.length ?? 0,
        pivotCaches: workbook.pivotCaches?.length ?? 0,
      },
      bounds,
    };
  });

  await page.mouse.click(before.bounds.x + before.bounds.width - 8, before.bounds.y + before.bounds.height / 2);
  await page.waitForFunction(() => document.querySelector(".validation-menu"), null, { timeout: 5000 });
  await page.selectOption(".validation-menu", "Closed");
  await page.getByRole("button", { name: "Pivot" }).click();
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.mountedPreview?.getActiveSheet?.()?.name === "Pivot", null, {
    timeout: 5000,
  });
  for (let i = 0; i < 3; i += 1) await page.click("#zoom-out");
  await page.waitForFunction(() => globalThis.__portableWorkbookPreview?.mountedPreview?.getZoom?.() === 0.7, null, {
    timeout: 5000,
  });

  const after = await page.evaluate(() => {
    const workbook = globalThis.__portableWorkbookPreview.workbook;
    const dataSheet = workbook.sheets.find((sheet) => sheet.name === "Data");
    const layout = globalThis.__portableWorkbookPreview.mountedPreview.getActiveLayout();
    return {
      value: dataSheet.rows.find((row) => row.index === 2)?.cells.find((cell) => cell.address === "G2")?.value,
      menuOpen: Boolean(document.querySelector(".validation-menu")),
      pivotComputedValues: layout.pivotMetadata?.computedValues?.size ?? 0,
      pivotSample: layout.pivotMetadata?.computedValues?.get("6:4")?.value,
      zoom: globalThis.__portableWorkbookPreview.mountedPreview.getZoom(),
      rowHeight: layout.rowHeights[4],
    };
  });

  return { before, after };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!existsSync(combinedFixture)) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fixtureGenerator], { cwd: root, stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Fixture generator exited with ${code}`))));
      child.on("error", reject);
    });
  }

  let server = startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 760 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  const defaultResult = await testDefaultSample(page);
  assert(defaultResult.status?.includes("/ D2"), `Expected D2 status, got ${defaultResult.status}`);
  assert(defaultResult.zoom === "110%", `Expected 110% zoom, got ${defaultResult.zoom}`);
  assert(defaultResult.clipboard === "=B2*C2", `Expected formula clipboard, got ${defaultResult.clipboard}`);
  assert(defaultResult.codexAssets === 0, `Expected no Codex assets, got ${defaultResult.codexAssets}`);

  await browser.close();
  server.kill();

  server = startServer({ SAMPLE_XLSX: largeFixture });
  await waitForServer();
  const browser2 = await chromium.launch({ headless: true });
  const context2 = await browser2.newContext({
    viewport: { width: 1000, height: 500 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page2 = await context2.newPage();
  const largeResult = await testLargeSample(page2);
  assert(largeResult.status?.includes("/ A81:B81"), `Expected A81:B81 status, got ${largeResult.status}`);
  assert(largeResult.scrollTop > 0, `Expected positive scrollTop, got ${largeResult.scrollTop}`);
  assert(largeResult.clipboard === "80\tItem 80", `Expected TSV clipboard, got ${largeResult.clipboard}`);
  assert(largeResult.codexAssets === 0, `Expected no Codex assets, got ${largeResult.codexAssets}`);

  await browser2.close();
  server.kill();

  server = startServer({ SAMPLE_XLSX: imageFixture });
  await waitForServer();
  const browser3 = await chromium.launch({ headless: true });
  const page3 = await browser3.newPage({ viewport: { width: 900, height: 560 } });
  const imageResult = await testImageSample(page3);
  assert(imageResult.imageCount === 1, `Expected one image asset, got ${imageResult.imageCount}`);
  assert(imageResult.drawingCount === 1, `Expected one drawing, got ${imageResult.drawingCount}`);
  assert(imageResult.imageId === imageResult.drawingImageId, `Expected drawing image reference to match image asset`);
  assert(
    imageResult.sample[0] >= 180 && imageResult.sample[1] <= 80 && imageResult.sample[2] <= 80,
    `Expected reddish image pixel, got ${imageResult.sample}`,
  );
  assert(imageResult.codexAssets === 0, `Expected no Codex assets, got ${imageResult.codexAssets}`);

  await browser3.close();
  server.kill();

  server = startServer({ SAMPLE_XLSX: chartFixture });
  await waitForServer();
  const browser4 = await chromium.launch({ headless: true });
  const page4 = await browser4.newPage({ viewport: { width: 1000, height: 620 } });
  const chartResult = await testChartSample(page4);
  assert(chartResult.drawingCount === 1, `Expected one chart drawing, got ${chartResult.drawingCount}`);
  assert(chartResult.chartTitle === "Revenue by Quarter", `Expected chart title, got ${chartResult.chartTitle}`);
  assert(chartResult.chartFormula === "'Chart'!$B$2:$B$5", `Expected chart formula, got ${chartResult.chartFormula}`);
  assert(
    chartResult.samples.some((sample) => sample[2] > 150 && sample[0] < 120),
    `Expected blue chart pixels, got ${JSON.stringify(chartResult.samples)}`,
  );
  assert(chartResult.codexAssets === 0, `Expected no Codex assets, got ${chartResult.codexAssets}`);

  await browser4.close();
  server.kill();

  server = startServer({ SAMPLE_XLSX: conditionalFormattingFixture });
  await waitForServer();
  const browser5 = await chromium.launch({ headless: true });
  const page5 = await browser5.newPage({ viewport: { width: 900, height: 560 } });
  const conditionalFormattingResult = await testConditionalFormattingSample(page5);
  assert(conditionalFormattingResult.rule?.type === "cellIs", `Expected cellIs rule`);
  assert(conditionalFormattingResult.rule?.operator === "greaterThan", `Expected greaterThan rule`);
  assert(conditionalFormattingResult.rule?.formula?.[0] === "80", `Expected formula 80`);
  assert(conditionalFormattingResult.dxfCount > 0, `Expected at least one dxf`);
  assert(
    conditionalFormattingResult.b3[0] > 240 &&
      conditionalFormattingResult.b3[1] < 220 &&
      conditionalFormattingResult.b3[2] < 230,
    `Expected red CF fill for B3, got ${conditionalFormattingResult.b3}`,
  );
  assert(
    !(conditionalFormattingResult.b2[0] > 240 &&
      conditionalFormattingResult.b2[1] < 220 &&
      conditionalFormattingResult.b2[2] < 230),
    `Did not expect red CF fill for B2, got ${conditionalFormattingResult.b2}`,
  );
  assert(conditionalFormattingResult.codexAssets === 0, `Expected no Codex assets, got ${conditionalFormattingResult.codexAssets}`);

  await browser5.close();
  server.kill();

  server = startServer();
  await waitForServer();
  const browser6 = await chromium.launch({ headless: true });
  const page6 = await browser6.newPage({ viewport: { width: 1200, height: 760 } });
  const combinedResult = await testCombinedFixture(page6);
  assert(combinedResult.before.sheets.includes("Data"), `Expected Data sheet`);
  assert(combinedResult.before.sheets.includes("Pivot"), `Expected Pivot sheet`);
  assert(combinedResult.before.sheets.includes("Sparklines"), `Expected Sparklines sheet`);
  assert(combinedResult.before.data.charts >= 1, `Expected chart drawing`);
  assert(combinedResult.before.data.shapes >= 1, `Expected shape drawing`);
  assert(combinedResult.before.data.tables >= 1, `Expected table`);
  assert(combinedResult.before.data.validations >= 1, `Expected validation`);
  assert(combinedResult.before.data.cfs >= 1, `Expected conditional formatting`);
  assert(combinedResult.before.data.slicers >= 1, `Expected slicer`);
  assert(combinedResult.before.workbookCaches.slicerCaches >= 1, `Expected slicer cache`);
  assert(combinedResult.before.workbookCaches.pivotCaches >= 1, `Expected pivot cache`);
  assert(combinedResult.before.pivot.pivots >= 1, `Expected pivot table`);
  assert(combinedResult.before.sparklines.groups >= 1, `Expected sparkline groups`);
  assert(combinedResult.before.data.validationOptions.includes("Closed"), `Expected Closed validation option`);
  assert(combinedResult.after.value === "Closed", `Expected dropdown selection to update G2, got ${combinedResult.after.value}`);
  assert(combinedResult.after.menuOpen === false, `Expected dropdown menu to close after selection`);
  assert(combinedResult.after.pivotComputedValues > 0, `Expected pivot fallback values`);
  assert(combinedResult.after.pivotSample > 0, `Expected positive pivot sample, got ${combinedResult.after.pivotSample}`);
  assert(combinedResult.after.zoom === 0.7, `Expected pivot zoom regression path at 70%, got ${combinedResult.after.zoom}`);
  assert(combinedResult.after.rowHeight > 0, `Expected positive row height after zoom, got ${combinedResult.after.rowHeight}`);

  await browser6.close();
  server.kill();

  console.log(
    JSON.stringify(
      { defaultResult, largeResult, imageResult, chartResult, conditionalFormattingResult, combinedResult },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
