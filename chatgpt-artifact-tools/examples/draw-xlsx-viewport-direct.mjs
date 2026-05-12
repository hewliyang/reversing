#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, drawViewport } from "@oai/artifact-tool";

function usage() {
  return [
    "Usage:",
    "  node examples/draw-xlsx-viewport-direct.mjs --input <workbook.xlsx> --sheet <sheet> --out <png> [--start-row 0] [--start-col 0] [--rows 20] [--cols 8] [--scale 2]",
    "",
    "Paints a worksheet viewport directly into an OffscreenCanvas 2D context using drawViewport(...).",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected positional argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function numberArg(args, key, fallback) {
  const raw = args[key];
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid --${key}: ${raw}`);
  return value;
}

function cumulative(values) {
  const out = [0];
  for (let i = 0; i < values.length; i += 1) {
    out[i + 1] = (out[i] ?? 0) + (values[i] ?? 0);
  }
  return out;
}

async function saveCanvas(canvas, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await fs.writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const input = args.input ? path.resolve(args.input) : undefined;
  const sheetName = args.sheet;
  const output = args.out ? path.resolve(args.out) : undefined;
  const startRow = numberArg(args, "start-row", 0);
  const startCol = numberArg(args, "start-col", 0);
  const rows = numberArg(args, "rows", 20);
  const cols = numberArg(args, "cols", 8);
  const scale = numberArg(args, "scale", 2);

  if (!input || !sheetName || !output || rows <= 0 || cols <= 0 || scale <= 0) {
    throw new Error(usage());
  }

  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  const sheet = workbook.worksheets.getItem(sheetName);
  const assets = workbook.getSpreadsheetRenderAssets();
  const layout = sheet.__getViewportLayout({
    maxCols: Math.ceil(startCol + cols),
    maxRows: Math.ceil(startRow + rows),
  });

  const allColWidths = layout.viewColWidthsPx;
  const allRowHeights = layout.rowHeightsPx;
  const colOffsets = cumulative(allColWidths);
  const rowOffsets = cumulative(allRowHeights);
  const colWidths = allColWidths.slice(startCol, startCol + cols);
  const rowHeights = allRowHeights.slice(startRow, startRow + rows);

  const scrollX = colOffsets[startCol] ?? 0;
  const scrollY = rowOffsets[startRow] ?? 0;
  const dataW = (colOffsets[startCol + cols] ?? colOffsets.at(-1) ?? 0) - scrollX;
  const dataH = (rowOffsets[startRow + rows] ?? rowOffsets.at(-1) ?? 0) - scrollY;
  const rowHeaderWidth = 46;
  const colHeaderHeight = 24;

  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil((dataW + rowHeaderWidth) * scale)),
    Math.max(1, Math.ceil((dataH + colHeaderHeight) * scale)),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale);

  drawViewport(
    ctx,
    workbook,
    sheetName,
    colWidths,
    rowHeights,
    scrollX,
    scrollY,
    dataW,
    dataH,
    null,
    null,
    scale,
    assets.styleInfos,
    {},
    new Set(),
    new Set(),
    false,
    assets.themeMap,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  await saveCanvas(canvas, output);
  console.log(JSON.stringify({ input, sheetName, output, startRow, startCol, rows, cols, scale, width: canvas.width, height: canvas.height }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
