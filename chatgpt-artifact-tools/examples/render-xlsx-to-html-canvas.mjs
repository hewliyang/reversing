#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function usage() {
  return [
    "Usage:",
    "  node examples/render-xlsx-to-html-canvas.mjs --input <workbook.xlsx> --sheet <sheet> --out-dir <dir> [--range A1:H20] [--scale 2]",
    "",
    "Renders a spreadsheet sheet/range to PNG and emits an HTML file that draws it into a canvas.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${key}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

async function saveBlob(blob, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlDocument({ title, imageName, sheetName, range, scale }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f3f4f6;
      color: #111827;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
      box-sizing: border-box;
    }
    main {
      width: min(100%, 1180px);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: end;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #6b7280;
      font-size: 13px;
    }
    .stage {
      overflow: auto;
      border: 1px solid #d1d5db;
      background: white;
      box-shadow: 0 22px 70px rgb(17 24 39 / 14%);
    }
    canvas {
      display: block;
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(sheetName)}${range ? ` · ${escapeHtml(range)}` : ""}</h1>
        <p>Rendered by @oai/artifact-tool, drawn into an HTML canvas.</p>
      </div>
      <p>scale ${escapeHtml(scale)}</p>
    </header>
    <div class="stage">
      <canvas id="sheet-canvas"></canvas>
    </div>
  </main>
  <script>
    const canvas = document.getElementById("sheet-canvas");
    const ctx = canvas.getContext("2d");
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
    };
    image.src = ${JSON.stringify(imageName)};
  </script>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const input = args.input ? path.resolve(args.input) : undefined;
  const sheetName = args.sheet;
  const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : undefined;
  const range = args.range;
  const scale = args.scale ? Number.parseFloat(args.scale) : 2;

  if (!input || !sheetName || !outDir || !Number.isFinite(scale) || scale <= 0) {
    throw new Error(usage());
  }

  await fs.mkdir(outDir, { recursive: true });
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  const renderOptions = {
    sheetName,
    scale,
    format: "png",
    ...(range ? { range } : { autoCrop: "all" }),
  };
  const rendered = await workbook.render(renderOptions);

  const pngPath = path.join(outDir, "sheet-render.png");
  const htmlPath = path.join(outDir, "sheet-canvas.html");
  await saveBlob(rendered, pngPath);
  await fs.writeFile(
    htmlPath,
    htmlDocument({
      title: `${sheetName} canvas render`,
      imageName: path.basename(pngPath),
      sheetName,
      range,
      scale,
    }),
    "utf8",
  );

  console.log(JSON.stringify({ input, sheetName, range, scale, pngPath, htmlPath }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
