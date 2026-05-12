#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

function usage() {
  return [
    "Usage:",
    "  node examples/spreadsheet-formula-probe.mjs --out-dir <dir>",
    "",
    "Creates a workbook, writes formulas, inspects calculated values, renders a PNG,",
    "exports XLSX, reimports it, and verifies formulas still evaluate.",
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

async function buildWorkbook() {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Calc");

  sheet.getRange("A1:F1").values = [["Month", "Units", "Price", "Revenue", "Growth", "Running total"]];
  sheet.getRange("A2:C5").values = [
    ["Jan", 120, 14.5],
    ["Feb", 138, 14.5],
    ["Mar", 151, 15.0],
    ["Apr", 169, 15.5],
  ];
  sheet.getRange("D2").formulas = [["=B2*C2"]];
  sheet.getRange("D2:D5").fillDown();
  sheet.getRange("E2").values = [[null]];
  sheet.getRange("E3").formulas = [["=D3/D2-1"]];
  sheet.getRange("E3:E5").fillDown();
  sheet.getRange("F2").formulas = [["=SUM($D$2:D2)"]];
  sheet.getRange("F2:F5").fillDown();
  sheet.getRange("A7:B11").values = [
    ["Total revenue", null],
    ["Average growth", null],
    ["Best month", null],
    ["Lookup Mar revenue", null],
    ["Scenario next month", null],
  ];
  sheet.getRange("B7:B11").formulas = [
    ["=SUM(D2:D5)"],
    ["=AVERAGE(E3:E5)"],
    ["=INDEX(A2:A5,MATCH(MAX(D2:D5),D2:D5,0))"],
    ['=XLOOKUP("Mar",A2:A5,D2:D5)'],
    ["=LET(lastUnits,B5,nextUnits,lastUnits*1.08,nextUnits*C5)"],
  ];

  sheet.getRange("A1:F1").format = {
    fill: "#111827",
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("B2:B5").format.numberFormat = "0";
  sheet.getRange("C2:D5").format.numberFormat = "$#,##0.00";
  sheet.getRange("E3:E5").format.numberFormat = "0.0%";
  sheet.getRange("F2:F5").format.numberFormat = "$#,##0.00";
  sheet.getRange("B7:B11").format.numberFormat = "$#,##0.00";
  sheet.getRange("B8").format.numberFormat = "0.0%";
  sheet.getRange("B9").format.numberFormat = "@";
  sheet.getRange("A7:A11").format = { font: { bold: true } };

  return workbook;
}

async function inspectTable(workbook, range, summary) {
  const result = await workbook.inspect({
    kind: "table",
    range,
    include: "values,formulas",
    tableMaxRows: 20,
    tableMaxCols: 8,
    summary,
  });
  return result.ndjson;
}

async function formulaErrorScan(workbook) {
  const result = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "formula error scan",
  });
  return result.ndjson;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : undefined;
  if (!outDir) {
    throw new Error(usage());
  }
  await fs.mkdir(outDir, { recursive: true });

  const workbook = await buildWorkbook();
  const initialInspect = await inspectTable(workbook, "Calc!A1:F11", "initial calculated workbook");
  const initialErrors = await formulaErrorScan(workbook);

  sheetEdit(workbook, "Calc", "B5", [[200]]);
  const afterEditInspect = await inspectTable(workbook, "Calc!A1:F11", "after changing Apr units to 200");

  const png = await workbook.render({ sheetName: "Calc", autoCrop: "all", scale: 1, format: "png" });
  const pngPath = path.join(outDir, "calc-preview.png");
  await saveBlob(png, pngPath);

  const xlsxPath = path.join(outDir, "calc-probe.xlsx");
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(xlsxPath);

  const imported = await SpreadsheetFile.importXlsx(await FileBlob.load(xlsxPath));
  const reimportInspect = await inspectTable(imported, "Calc!A1:F11", "reimported calculated workbook");
  const reimportErrors = await formulaErrorScan(imported);

  console.log(
    JSON.stringify(
      {
        xlsxPath,
        pngPath,
        initialInspect,
        initialErrors,
        afterEditInspect,
        reimportInspect,
        reimportErrors,
      },
      null,
      2,
    ),
  );
}

function sheetEdit(workbook, sheetName, rangeAddress, values) {
  workbook.worksheets.getItem(sheetName).getRange(rangeAddress).values = values;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
