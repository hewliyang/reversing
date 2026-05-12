#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

function usage() {
  return [
    "Usage:",
    "  node examples/render-pptx.mjs --input <deck.pptx> --out-dir <dir> [--scale 1]",
    "",
    "Renders each slide in a PPTX to PNG using the extracted @oai/artifact-tool package.",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const input = args.input ? path.resolve(args.input) : undefined;
  const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : undefined;
  const scale = args.scale ? Number.parseFloat(args.scale) : 1;

  if (!input || !outDir || !Number.isFinite(scale) || scale <= 0) {
    throw new Error(usage());
  }

  const deckBlob = await FileBlob.load(input);
  const presentation = await PresentationFile.importPptx(deckBlob);
  const slideCount = presentation.slides.count;
  if (!slideCount) {
    throw new Error(`No slides found in ${input}`);
  }

  const rendered = [];
  for (let index = 0; index < slideCount; index += 1) {
    const slide = presentation.slides.getItem(index);
    const png = await presentation.export({ slide, format: "png", scale });
    const outputPath = path.join(outDir, `slide-${String(index + 1).padStart(2, "0")}.png`);
    await saveBlob(png, outputPath);
    rendered.push(outputPath);
  }

  console.log(JSON.stringify({ input, outDir, slideCount, scale, rendered }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
