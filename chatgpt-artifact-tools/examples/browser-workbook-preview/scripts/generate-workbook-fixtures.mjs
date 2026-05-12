#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "/Users/m1a1/Developer/headless-spreadjs/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outputDir = path.join(root, "tmp/browser-workbook-fixtures");

function style(GC, options = {}) {
  const value = new GC.Spread.Sheets.Style();
  Object.assign(value, options);
  return value;
}

function writeRows(sheet, rows, startRow = 0, startCol = 0) {
  rows.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => {
      sheet.setValue(startRow + rowOffset, startCol + colOffset, value);
    });
  });
}

async function createPivotSlicerFixture(GC, ExcelFile) {
  const file = new ExcelFile();
  const workbook = file.workbook;
  const sheet = workbook.getActiveSheet();
  sheet.name("Data");

  const headers = ["Region", "Product", "Quarter", "Month", "Revenue", "Units", "Status", "Score"];
  const records = [
    ["North", "Widget A", "Q1", "Jan", 12500, 120, "Review", 82],
    ["North", "Widget A", "Q2", "Apr", 16800, 156, "Open", 91],
    ["North", "Widget B", "Q1", "Feb", 9800, 98, "Blocked", 63],
    ["South", "Widget A", "Q1", "Jan", 14200, 132, "Closed", 76],
    ["South", "Widget B", "Q2", "May", 19100, 178, "Review", 88],
    ["South", "Widget C", "Q3", "Jul", 17600, 164, "Open", 84],
    ["East", "Widget A", "Q2", "Apr", 15300, 145, "Closed", 79],
    ["East", "Widget C", "Q3", "Aug", 21700, 196, "Open", 94],
    ["East", "Widget B", "Q4", "Nov", 13100, 118, "Review", 72],
    ["West", "Widget A", "Q1", "Mar", 11800, 105, "Blocked", 59],
    ["West", "Widget B", "Q3", "Sep", 16400, 150, "Closed", 81],
    ["West", "Widget C", "Q4", "Dec", 23600, 210, "Open", 97],
    ["Central", "Widget A", "Q2", "Jun", 14800, 137, "Review", 74],
    ["Central", "Widget B", "Q3", "Aug", 18800, 171, "Closed", 86],
    ["Central", "Widget C", "Q4", "Oct", 20200, 189, "Open", 90],
    ["North", "Widget C", "Q4", "Dec", 22400, 205, "Closed", 93],
  ];

  writeRows(sheet, [headers, ...records]);
  sheet.setColumnWidth(0, 90);
  sheet.setColumnWidth(1, 95);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 95);
  sheet.setColumnWidth(5, 70);
  sheet.setColumnWidth(6, 95);
  sheet.setColumnWidth(7, 70);
  for (let row = 1; row <= records.length; row += 1) {
    sheet.setFormatter(row, 4, "$#,##0");
  }

  const table = sheet.tables.add(
    "SalesTable",
    0,
    0,
    records.length + 1,
    headers.length,
    GC.Spread.Sheets.Tables.TableThemes.medium2,
  );
  table.showFooter(true);

  const validator = GC.Spread.Sheets.DataValidation.createListValidator("Open,Review,Closed,Blocked");
  validator.inputTitle("Status");
  validator.inputMessage("Choose a workflow status.");
  validator.errorTitle("Invalid status");
  validator.errorMessage("Use one of Open, Review, Closed, or Blocked.");
  validator.inCellDropdown(true);
  sheet.setDataValidator(1, 6, records.length, 1, validator);

  const hotStyle = style(GC, { backColor: "#DCFCE7", foreColor: "#166534" });
  sheet.conditionalFormats.addCellValueRule(
    GC.Spread.Sheets.ConditionalFormatting.ComparisonOperators.greaterThan,
    85,
    null,
    hotStyle,
    [new GC.Spread.Sheets.Range(1, 7, records.length, 1)],
  );

  const chart = sheet.charts.add(
    "RevenueByRegion",
    GC.Spread.Sheets.Charts.ChartType.columnClustered,
    20,
    330,
    560,
    300,
    "A1:E17",
  );
  chart.title({ text: "Revenue by Region/Product" });
  chart.legend({ visible: true, position: GC.Spread.Sheets.Charts.LegendPosition.bottom });

  const regionSlicer = sheet.slicers.add("RegionSlicer", "SalesTable", "Region");
  regionSlicer.position(new GC.Spread.Sheets.Point(620, 20));
  regionSlicer.width(180);
  regionSlicer.height(170);
  regionSlicer.style(GC.Spread.Sheets.Slicers.SlicerStyles.light1());

  const productSlicer = sheet.slicers.add("ProductSlicer", "SalesTable", "Product");
  productSlicer.position(new GC.Spread.Sheets.Point(820, 20));
  productSlicer.width(180);
  productSlicer.height(150);
  productSlicer.style(GC.Spread.Sheets.Slicers.SlicerStyles.light2());

  const rect = sheet.shapes.add("StatusCallout", GC.Spread.Sheets.Shapes.AutoShapeType.rectangle, 620, 220, 280, 70);
  rect.style({
    ...rect.style(),
    fill: { type: 0, color: "#FEF3C7" },
    line: { color: "#F59E0B", width: 2 },
    textEffect: { font: "12px Arial", color: "#78350F" },
  });

  const pivotSheet = new GC.Spread.Sheets.Worksheet("Pivot");
  workbook.addSheet(workbook.getSheetCount(), pivotSheet);
  const pivotTable = pivotSheet.pivotTables.add(
    "SalesPivot",
    "'Data'!A1:H17",
    2,
    0,
    GC.Spread.Pivot.PivotTableLayoutType.outline,
  );
  pivotTable.add("Region", "Region", GC.Spread.Pivot.PivotTableFieldType.rowField);
  pivotTable.add("Product", "Product", GC.Spread.Pivot.PivotTableFieldType.rowField);
  pivotTable.add("Quarter", "Quarter", GC.Spread.Pivot.PivotTableFieldType.columnField);
  pivotTable.add("Total Revenue", "Revenue", GC.Spread.Pivot.PivotTableFieldType.valueField);
  pivotTable.add("Total Units", "Units", GC.Spread.Pivot.PivotTableFieldType.valueField);
  pivotSheet.setColumnWidth(0, 130);
  pivotSheet.setColumnWidth(1, 120);
  pivotSheet.setColumnWidth(2, 110);

  const sparkSheet = new GC.Spread.Sheets.Worksheet("Sparklines");
  workbook.addSheet(workbook.getSheetCount(), sparkSheet);
  writeRows(sparkSheet, [
    ["Rep", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Trend", "Bars"],
    ["Alice", 4200, 3800, 5100, 4700, 6200, 5900, "", ""],
    ["Bob", 3100, 3600, 2900, 3200, 3800, 4100, "", ""],
    ["Carol", 5500, 4900, 5200, -300, 6100, 6800, "", ""],
    ["Dan", 2800, 3100, 2500, 2200, 2900, 3400, "", ""],
  ]);
  const Sparklines = GC.Spread.Sheets.Sparklines;
  const lineSettings = new Sparklines.SparklineSetting();
  lineSettings.options.seriesColor = "#2563EB";
  lineSettings.options.showHigh = true;
  lineSettings.options.showLow = true;
  const columnSettings = new Sparklines.SparklineSetting();
  columnSettings.options.seriesColor = "#0EA5E9";
  columnSettings.options.negativeColor = "#DC2626";
  columnSettings.options.showNegative = true;
  for (let row = 1; row <= 4; row += 1) {
    const source = new GC.Spread.Sheets.Range(row, 1, 1, 6);
    sparkSheet.setSparkline(row, 7, source, Sparklines.DataOrientation.horizontal, Sparklines.SparklineType.line, lineSettings);
    sparkSheet.setSparkline(
      row,
      8,
      source,
      Sparklines.DataOrientation.horizontal,
      Sparklines.SparklineType.column,
      columnSettings,
    );
    sparkSheet.setRowHeight(row, 30);
  }
  for (let col = 0; col <= 8; col += 1) sparkSheet.setColumnWidth(col, col >= 7 ? 110 : 70);

  const output = path.join(outputDir, "pivot-slicer-validation-fixture.xlsx");
  await file.save(output);
  return output;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const { ExcelFile, GC, dispose } = await init();
  try {
    const output = await createPivotSlicerFixture(GC, ExcelFile);
    console.log(output);
  } finally {
    dispose();
  }
}

await main();
