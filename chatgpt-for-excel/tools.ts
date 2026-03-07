/**
 * Clean reimplementation of the ChatGPT-for-Excel ("Basispoints") spreadsheet tools.
 *
 * These tools run entirely client-side via the Office.js Excel API.
 * The AI model emits tool_call JSON; the client dispatches to these executors,
 * runs them inside Excel.run(), and returns the result JSON to the model.
 *
 * Reconstructed from app-Fv2Lr-FU.js (Basispoints v2025)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resize descriptor for columns/rows */
interface ResizeSpec {
  type: "autofit" | "points" | "standard";
  value?: number;
}

/** Cell style properties applicable to format_range and write_range */
interface CellStyles {
  fontColor?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: "bold" | "normal";
  fontStyle?: "italic" | "normal";
  fontLine?: "underline" | "line-through" | "none";
  backgroundColor?: string;
  horizontalAlignment?: string;
  numberFormat?: string;
  borders?: BorderSpec[];
}

interface BorderSpec {
  sides: ("top" | "bottom" | "left" | "right")[];
  color?: string;
  style?: "solid" | "dashed" | "dotted" | "double";
  weight?: "thin" | "medium" | "thick";
}

interface WriteEntry {
  cell: string;
  value?: any;
  formula?: string;
  cellStyles?: CellStyles;
  resizeColumn?: ResizeSpec;
  resizeRow?: ResizeSpec;
  note?: string | null;
}

interface ChartProperties {
  source?: string;
  chartType?: string;
  seriesBy?: string;
  title?: string;
  name?: string;
  width?: number;
  height?: number;
  position?: string;
  endPosition?: string;
  legend?: { visible?: boolean; position?: string };
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
}

interface PivotFieldSpec {
  field: string;
  showSubtotals?: boolean;
}

interface PivotValueSpec {
  field: string;
  aggregation?: string;
  name?: string;
  numberFormat?: string;
}

interface PivotFilterSpec {
  field: string;
  include?: string[];
  exclude?: string[];
}

interface PivotProperties {
  source?: string;
  destination?: string;
  name?: string;
  rows?: PivotFieldSpec[];
  columns?: PivotFieldSpec[];
  values?: PivotValueSpec[];
  filters?: PivotFilterSpec[];
  layout?: {
    showRowHeaders?: boolean;
    showColumnHeaders?: boolean;
    showGrandTotalsRows?: boolean;
    showGrandTotalsColumns?: boolean;
    compactForm?: boolean;
  };
}

interface TableProperties {
  range?: string;
  hasHeaders?: boolean;
  name?: string;
  style?: string;
  showTotals?: boolean;
  showHeaders?: boolean;
  showFilterButton?: boolean;
  highlightFirstColumn?: boolean;
  highlightLastColumn?: boolean;
  showBandedRows?: boolean;
  showBandedColumns?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert Excel runtime is available */
function assertExcelRuntime(): void {
  if (typeof Excel === "undefined" || typeof Excel.run !== "function") {
    throw new Error(
      "Excel runtime is not available. Open this add-in inside Excel.",
    );
  }
}

/** Run a callback inside Excel.run with runtime assertion */
async function excelRun<T>(
  callback: (ctx: Excel.RequestContext) => Promise<T>,
): Promise<T> {
  assertExcelRuntime();
  return Excel.run(async (ctx) => callback(ctx));
}

/** Strip sheet prefix from a range address (e.g. "Sheet1!A1:B2" → "A1:B2") */
function stripSheetPrefix(address: string): string {
  const idx = address.indexOf("!");
  return idx >= 0 ? address.slice(idx + 1) : address;
}

/** Resolve a worksheet by id, name, or position index */
async function resolveSheet(
  ctx: Excel.RequestContext,
  sheetId: string,
): Promise<Excel.Worksheet> {
  const sheets = ctx.workbook.worksheets;
  const sheet = sheets.getItemOrNullObject(sheetId);
  sheet.load(["isNullObject", "id", "name", "position"]);
  await ctx.sync();

  if (!sheet.isNullObject) return sheet;

  // Fallback: try matching by name or position index
  sheets.load("items/id,name,position");
  await ctx.sync();

  const numId = Number(sheetId);
  const match = sheets.items.find(
    (s) =>
      s.id === sheetId ||
      s.name === sheetId ||
      (Number.isFinite(numId) && s.position === numId),
  );

  if (match) return match;
  throw new Error(`Sheet ${sheetId} not found`);
}

/** Require sheetId from args */
function requireSheetId(args: Record<string, any>): string {
  const raw = args.sheetId;
  const id =
    typeof raw === "string"
      ? raw
      : typeof raw === "number"
        ? String(raw)
        : undefined;
  if (!id) throw new Error("sheetId is required");
  return id;
}

/** Convert column letters to 1-based index (A=1, B=2, ..., Z=26, AA=27) */
function colLetterToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64);
  }
  return result;
}

/** Convert 1-based column index to letters */
function colIndexToLetter(index: number): string {
  let s = "";
  while (index > 0) {
    index--;
    s = String.fromCharCode(65 + (index % 26)) + s;
    index = Math.floor(index / 26);
  }
  return s;
}

/** Ensure 2D array of arrays */
function ensure2D<T>(matrix: T[][] | undefined): T[][] {
  return Array.isArray(matrix)
    ? matrix.map((r) => (Array.isArray(r) ? r : []))
    : [];
}

/** Parse a cell reference like "Sheet1!A1" or "A1" */
function parseCellAddress(cell: string): {
  address: string;
  row: number;
  col: number;
  sheet: string | null;
} {
  const trimmed = String(cell).trim();
  if (!trimmed) throw new Error("cell is required");

  let sheet: string | null = null;
  let addr = trimmed;

  const bangIdx = trimmed.indexOf("!");
  if (bangIdx >= 0) {
    let raw = trimmed.slice(0, bangIdx).trim();
    // Strip surrounding quotes
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      raw = raw.slice(1, -1);
    }
    sheet = raw;
    addr = trimmed.slice(bangIdx + 1).trim();
  }

  // Remove absolute $ signs
  addr = addr.replace(/\$/g, "").trim();
  if (addr.includes(":"))
    throw new Error(`Cell ${cell} must be a single A1 address`);

  const match = /^([A-Za-z]+)(\d+)$/.exec(addr);
  if (!match) throw new Error(`Invalid cell address: ${cell}`);

  const colStr = match[1].toUpperCase();
  const row = Number(match[2]);
  if (!Number.isFinite(row) || row <= 0)
    throw new Error(`Invalid cell address: ${cell}`);

  const col = colLetterToIndex(colStr);
  if (!Number.isFinite(col) || col <= 0)
    throw new Error(`Invalid cell address: ${cell}`);

  return { address: `${colStr}${row}`, row, col, sheet };
}

// ---------------------------------------------------------------------------
// Formula safety — block external/network formula functions
// ---------------------------------------------------------------------------

const BLOCKED_FORMULA_FUNCTIONS = [
  "IMPORTXML",
  "IMPORTHTML",
  "IMPORTDATA",
  "IMPORTFEED",
  "GOOGLEFINANCE",
  "IMAGE",
  "HYPERLINK",
  "GOOGLETRANSLATE",
  "DETECTLANGUAGE",
  "IMPORTRANGE",
  "WEBSERVICE",
  "FILTERXML",
  "ENCODEURL",
  "STOCKHISTORY",
  "RTD",
];

const BLOCKED_PATTERNS = BLOCKED_FORMULA_FUNCTIONS.map((name) => ({
  name,
  pattern: new RegExp(`\\b${name}\\s*\\(`, "iu"),
}));

function assertNoBlockedFormulas(value: any, label: string): void {
  if (typeof value === "string" && value.trim().startsWith("=")) {
    for (const { name, pattern } of BLOCKED_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(
          `${label} uses blocked external formula function ${name}. External/network formula functions are not allowed.`,
        );
      }
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoBlockedFormulas(item, `${label}[${i}]`));
  }
}

// ---------------------------------------------------------------------------
// Cell style application (shared by format_range and write_range)
// ---------------------------------------------------------------------------

function applyCellStyles(
  range: Excel.Range,
  styles: CellStyles,
  dimensions: { rowCount: number; columnCount: number },
): void {
  if (!styles) return;
  const fmt = range.format;

  if (styles.fontColor) fmt.font.color = styles.fontColor;
  if (styles.fontSize !== undefined) fmt.font.size = styles.fontSize;
  if (styles.fontFamily) fmt.font.name = styles.fontFamily;
  if (styles.fontWeight) fmt.font.bold = styles.fontWeight === "bold";
  if (styles.fontStyle) fmt.font.italic = styles.fontStyle === "italic";

  if (styles.fontLine) {
    fmt.font.underline = styles.fontLine === "underline" ? "Single" : "None";
    (fmt.font as any).strikethrough = styles.fontLine === "line-through";
  }

  if (styles.backgroundColor) fmt.fill.color = styles.backgroundColor;
  if (styles.horizontalAlignment)
    (fmt as any).horizontalAlignment = styles.horizontalAlignment;

  if (styles.numberFormat) {
    const rows = Math.max(1, dimensions.rowCount);
    const cols = Math.max(1, dimensions.columnCount);
    range.numberFormat = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => styles.numberFormat!),
    );
  }

  applyBorders(fmt.borders, styles.borders);
}

function applyBorders(
  borders: Excel.RangeBorderCollection,
  specs?: BorderSpec[],
): void {
  if (!specs || specs.length === 0) return;

  const sideMap: Record<string, Excel.BorderIndex> = {
    top: Excel.BorderIndex.edgeTop,
    bottom: Excel.BorderIndex.edgeBottom,
    left: Excel.BorderIndex.edgeLeft,
    right: Excel.BorderIndex.edgeRight,
  };

  const styleMap: Record<string, Excel.BorderLineStyle> = {
    solid: Excel.BorderLineStyle.continuous,
    dashed: Excel.BorderLineStyle.dash,
    dotted: Excel.BorderLineStyle.dot,
    double: Excel.BorderLineStyle.double,
  };

  const weightMap: Record<string, Excel.BorderWeight> = {
    thin: Excel.BorderWeight.thin,
    medium: Excel.BorderWeight.medium,
    thick: Excel.BorderWeight.thick,
  };

  for (const spec of specs) {
    for (const side of spec.sides) {
      const border = borders.getItem(
        sideMap[side] ?? Excel.BorderIndex.edgeTop,
      );
      if (spec.color) border.color = spec.color;
      if (spec.style)
        border.style = styleMap[spec.style] ?? Excel.BorderLineStyle.continuous;
      if (spec.weight)
        border.weight = weightMap[spec.weight] ?? Excel.BorderWeight.thin;
    }
  }
}

// ---------------------------------------------------------------------------
// Row/column reference parsing for update_sheet
// ---------------------------------------------------------------------------

function normalizeRowColReference(
  ref: string,
  dimension: "rows" | "columns",
): string {
  const clean = stripSheetPrefix(ref).replace(/\$/g, "").trim();

  if (dimension === "rows") {
    const rangeMatch = /^(\d+):(\d+)$/.exec(clean);
    if (rangeMatch) {
      if (rangeMatch[1] !== rangeMatch[2]) {
        throw new Error(
          `Row range references like '${clean}' are not supported; use a single row anchor and set count`,
        );
      }
      return `${rangeMatch[1]}:${rangeMatch[1]}`;
    }
    const singleMatch = /(\d+)/.exec(clean);
    if (!singleMatch) throw new Error(`Unable to parse row reference: ${ref}`);
    return `${singleMatch[1]}:${singleMatch[1]}`;
  }

  // columns
  const rangeMatch = /^([A-Z]+):([A-Z]+)$/i.exec(clean);
  if (rangeMatch) {
    const a = rangeMatch[1].toUpperCase();
    const b = rangeMatch[2].toUpperCase();
    if (a !== b) {
      throw new Error(
        `Column range references like '${clean}' are not supported; use a single column anchor and set count`,
      );
    }
    return `${a}:${a}`;
  }
  const singleMatch = /([A-Z]+)/i.exec(clean);
  if (!singleMatch) throw new Error(`Unable to parse column reference: ${ref}`);
  return `${singleMatch[1].toUpperCase()}:${singleMatch[1].toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Notes / comments helper for write_range
// ---------------------------------------------------------------------------

async function applyNotes(
  sheet: Excel.Worksheet,
  notes: { address: string; note: string | null }[],
): Promise<void> {
  if (notes.length === 0) return;

  // Try Notes API first (newer Excel builds)
  if ("notes" in sheet) {
    const notesCollection = (sheet as any).notes;
    const items = notes.map(({ address }) => ({
      address,
      note: notesCollection.getItemOrNullObject(address),
    }));
    items.forEach(({ note }) => note.load("isNullObject"));
    await sheet.context.sync();

    for (let i = 0; i < notes.length; i++) {
      const { address, note: text } = notes[i];
      const existing = items[i].note;
      const exists = existing && existing.isNullObject === false;

      if (text && text.length > 0) {
        if (exists) existing.content = text;
        else notesCollection.add(address, text);
      } else if (exists && typeof existing.delete === "function") {
        existing.delete();
      }
    }
    await sheet.context.sync();
    return;
  }

  // Fallback: Comments API
  if ("comments" in sheet) {
    const comments = (sheet as any).comments;
    const items = notes.map(({ address }) => ({
      address,
      comment: comments.getItemOrNullObject(address),
    }));
    items.forEach(({ comment }) => comment.load("isNullObject"));
    await sheet.context.sync();

    for (let i = 0; i < notes.length; i++) {
      const { address, note: text } = notes[i];
      const existing = items[i].comment;
      const exists = existing && existing.isNullObject === false;

      if (text && text.length > 0) {
        if (exists) {
          try {
            existing.content = text;
          } catch {
            Reflect.set(existing, "text", text);
          }
        } else {
          comments.add(address, text);
        }
      } else if (exists && typeof existing.delete === "function") {
        existing.delete();
      }
    }
    await sheet.context.sync();
    return;
  }

  // Last resort: per-cell methods
  for (const { address, note } of notes) {
    const range = sheet.getRange(address);
    if (note && note.length > 0) {
      if (typeof (range as any).setNote === "function")
        (range as any).setNote(note);
      else if (typeof (range as any).addComment === "function")
        (range as any).addComment(note, Excel.ContentType.plain);
    } else {
      if (typeof (range as any).clearComments === "function")
        (range as any).clearComments();
    }
  }
}

// ---------------------------------------------------------------------------
// run_officejs safety checks
// ---------------------------------------------------------------------------

const OFFICEJS_MAX_SCRIPT_LENGTH = 20_000;

const OFFICEJS_BLOCKED_PATTERNS = [
  {
    pattern: /\bExcel\s*\.\s*run\s*\(/u,
    message: "Do not call Excel.run(). Provide only the function body.",
  },
];

const OFFICEJS_DESTRUCTIVE_PATTERNS = [
  /\.(?:clear|delete|add|copyFrom|set|merge|unmerge|insert|remove|sort|autofitColumns|autofitRows)\s*\(/u,
  /\.(?:values|value|formula|formulas|numberFormat|columnWidth|rowHeight|wrapText|horizontalAlignment|verticalAlignment|indentLevel)\s*=/u,
];

function validateOfficeJsScript(code: string, destructive: boolean): string {
  if (typeof code !== "string") throw new Error("script must be a string");
  const script = code.trim();
  if (!script) throw new Error("script is required");
  if (script.length > OFFICEJS_MAX_SCRIPT_LENGTH) {
    throw new Error(
      `script is too long (${script.length} chars). Limit is ${OFFICEJS_MAX_SCRIPT_LENGTH} chars.`,
    );
  }
  for (const { pattern, message } of OFFICEJS_BLOCKED_PATTERNS) {
    if (pattern.test(script)) throw new Error(message);
  }
  if (
    !destructive &&
    OFFICEJS_DESTRUCTIVE_PATTERNS.some((p) => p.test(script))
  ) {
    throw new Error(
      "destructive=false but the script appears to modify the workbook. Set destructive=true for edits.",
    );
  }
  return script;
}

// ---------------------------------------------------------------------------
// Table property helpers
// ---------------------------------------------------------------------------

function applyTableProperties(
  table: Excel.Table,
  props: TableProperties,
): void {
  if (typeof props.name === "string" && props.name) table.name = props.name;
  if (typeof props.style === "string") table.style = props.style;
  if (typeof props.showTotals === "boolean")
    table.showTotals = props.showTotals;
  if (typeof props.showHeaders === "boolean")
    table.showHeaders = props.showHeaders;
  if (typeof props.showFilterButton === "boolean")
    table.showFilterButton = props.showFilterButton;
  if (typeof props.highlightFirstColumn === "boolean")
    table.highlightFirstColumn = props.highlightFirstColumn;
  if (typeof props.highlightLastColumn === "boolean")
    table.highlightLastColumn = props.highlightLastColumn;
  if (typeof props.showBandedRows === "boolean")
    table.showBandedRows = props.showBandedRows;
  if (typeof props.showBandedColumns === "boolean")
    table.showBandedColumns = props.showBandedColumns;
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

/** Lookup an enum value case-insensitively from an Excel enum object */
function lookupEnum<T>(
  enumObj: Record<string, T> | null,
  key?: string,
): T | undefined {
  if (!enumObj || typeof key !== "string") return undefined;
  const lower = key.toLowerCase();
  const byValue = Object.values(enumObj).find(
    (v) => (v as string).toLowerCase() === lower,
  ) as T | undefined;
  if (byValue) return byValue;
  const byKey = Object.keys(enumObj).find((k) => k.toLowerCase() === lower);
  return byKey ? enumObj[byKey] : undefined;
}

const ALLOWED_CHART_TYPES: Excel.ChartType[] =
  typeof Excel !== "undefined"
    ? [
        Excel.ChartType.columnClustered,
        Excel.ChartType.columnStacked,
        Excel.ChartType.barClustered,
        Excel.ChartType.barStacked,
        Excel.ChartType.line,
        Excel.ChartType.lineMarkers,
        Excel.ChartType.pie,
        Excel.ChartType.pieExploded,
      ]
    : [];

function resolveChartType(name?: string): Excel.ChartType | undefined {
  const val = lookupEnum(
    typeof Excel !== "undefined" ? Excel.ChartType : null,
    name,
  );
  return val && ALLOWED_CHART_TYPES.includes(val) ? val : undefined;
}

function applyChartProperties(
  chart: Excel.Chart,
  props: ChartProperties,
): void {
  if (typeof props.title === "string") chart.title.text = props.title;
  if (typeof props.name === "string" && props.name) chart.name = props.name;

  const ct = resolveChartType(props.chartType);
  if (ct) chart.chartType = ct;

  if (typeof props.width === "number" && Number.isFinite(props.width))
    chart.width = props.width;
  if (typeof props.height === "number" && Number.isFinite(props.height))
    chart.height = props.height;

  const position =
    typeof props.position === "string" ? stripSheetPrefix(props.position) : "";
  const endPosition =
    typeof props.endPosition === "string"
      ? stripSheetPrefix(props.endPosition)
      : "";
  if (position) chart.setPosition(position, endPosition || undefined);

  if (props.legend) {
    const legend = chart.legend;
    if (typeof props.legend.visible === "boolean")
      legend.visible = props.legend.visible;
    const pos = lookupEnum(
      typeof Excel !== "undefined" ? Excel.ChartLegendPosition : null,
      props.legend.position,
    );
    if (pos) legend.position = pos;
  }

  if (typeof props.categoryAxisTitle === "string") {
    try {
      chart.axes.categoryAxis.title.text = props.categoryAxisTitle;
    } catch {}
  }
  if (typeof props.valueAxisTitle === "string") {
    try {
      chart.axes.valueAxis.title.text = props.valueAxisTitle;
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Pivot table helpers
// ---------------------------------------------------------------------------

function resolvePivotAggregation(
  name?: string,
): Excel.AggregationFunction | undefined {
  if (!name || typeof Excel === "undefined") return undefined;
  const map: Record<string, Excel.AggregationFunction> = {
    sum: Excel.AggregationFunction.sum,
    count: Excel.AggregationFunction.count,
    average: Excel.AggregationFunction.average,
    min: Excel.AggregationFunction.min,
    max: Excel.AggregationFunction.max,
  };
  return map[name.toLowerCase()];
}

async function refreshPivotHierarchies(
  pivot: Excel.PivotTable,
  ctx: Excel.RequestContext,
): Promise<void> {
  try {
    pivot.refresh();
  } catch {}
  await ctx.sync();
  pivot.hierarchies.load("items/name");
  pivot.rowHierarchies.load("items/name");
  pivot.columnHierarchies.load("items/name");
  pivot.dataHierarchies.load("items/name");
  pivot.filterHierarchies.load("items/name");
  await ctx.sync();
}

function configurePivotLayout(
  pivot: Excel.PivotTable,
  layout?: PivotProperties["layout"],
): void {
  if (!layout) return;
  const pvtLayout = pivot.layout;

  if (typeof layout.showRowHeaders === "boolean") {
    try {
      (pvtLayout as any).showRowHeaders = layout.showRowHeaders;
    } catch {}
  }
  if (typeof layout.showColumnHeaders === "boolean") {
    try {
      (pvtLayout as any).showColumnHeaders = layout.showColumnHeaders;
    } catch {}
  }
  if (typeof layout.showGrandTotalsRows === "boolean") {
    try {
      (pvtLayout as any).showRowGrandTotals = layout.showGrandTotalsRows;
    } catch {}
  }
  if (typeof layout.showGrandTotalsColumns === "boolean") {
    try {
      (pvtLayout as any).showColumnGrandTotals = layout.showGrandTotalsColumns;
    } catch {}
  }
  if (
    typeof layout.compactForm === "boolean" &&
    typeof Excel !== "undefined" &&
    Excel.PivotLayoutType
  ) {
    try {
      pvtLayout.layoutType = layout.compactForm
        ? Excel.PivotLayoutType.compact
        : Excel.PivotLayoutType.tabular;
    } catch {}
  }
}

function configurePivotFields(
  pivot: Excel.PivotTable,
  props: PivotProperties,
): void {
  const hierarchies = pivot.hierarchies;

  if (Array.isArray(props.rows)) {
    try {
      (pivot.rowHierarchies as any).removeAll();
    } catch {}
    for (const spec of props.rows) {
      try {
        const h = pivot.rowHierarchies.add(hierarchies.getItem(spec.field));
        if (typeof spec.showSubtotals === "boolean" && "showSubtotals" in h) {
          (h as any).showSubtotals = spec.showSubtotals;
        }
      } catch {}
    }
  }

  if (Array.isArray(props.columns)) {
    try {
      (pivot.columnHierarchies as any).removeAll();
    } catch {}
    for (const spec of props.columns) {
      try {
        const h = pivot.columnHierarchies.add(hierarchies.getItem(spec.field));
        if (typeof spec.showSubtotals === "boolean" && "showSubtotals" in h) {
          (h as any).showSubtotals = spec.showSubtotals;
        }
      } catch {}
    }
  }

  if (Array.isArray(props.values)) {
    try {
      (pivot.dataHierarchies as any).removeAll();
    } catch {}
    for (const spec of props.values) {
      try {
        const h = pivot.dataHierarchies.add(hierarchies.getItem(spec.field));
        const agg = resolvePivotAggregation(spec.aggregation);
        if (agg && "summarizeBy" in h) (h as any).summarizeBy = agg;
        if (typeof spec.name === "string" && "name" in h)
          (h as any).name = spec.name;
        if (typeof spec.numberFormat === "string" && "numberFormat" in h)
          (h as any).numberFormat = spec.numberFormat;
      } catch {}
    }
  }

  if (Array.isArray(props.filters)) {
    try {
      (pivot.filterHierarchies as any).removeAll();
    } catch {}
    for (const spec of props.filters) {
      try {
        const h = pivot.filterHierarchies.add(hierarchies.getItem(spec.field));
        const field = (h as any).fields?.getItem(spec.field);
        if (field && typeof field.applyFilter === "function") {
          if (Array.isArray(spec.include)) {
            field.applyFilter({ condition: "include", values: spec.include });
          } else if (Array.isArray(spec.exclude)) {
            field.applyFilter({ condition: "exclude", values: spec.exclude });
          }
        }
      } catch {}
    }
  }

  configurePivotLayout(pivot, props.layout);
}

// ===========================================================================
// TOOL IMPLEMENTATIONS
// ===========================================================================

/**
 * Read cell data from one or more ranges.
 *
 * Args: { ranges: string[], sheetId: string, includeStyles?: boolean, includeXml?: boolean, cellLimit?: number }
 */
export async function read_ranges(args: {
  ranges: string[];
  sheetId: string;
  includeStyles?: boolean;
  includeXml?: boolean;
  cellLimit?: number;
}) {
  const ranges = Array.isArray(args.ranges) ? args.ranges : [];
  if (!ranges.length) throw new Error("ranges is required");

  const includeStyles = args.includeStyles ?? true;
  const sheetId = requireSheetId(args);
  const cellLimit =
    typeof args.cellLimit === "number"
      ? Math.max(0, Math.floor(args.cellLimit))
      : 10_000;
  const results: any[] = [];

  await excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);

    for (const rangeAddr of ranges) {
      const range = sheet.getRange(stripSheetPrefix(rangeAddr));
      range.load(["address", "values", "text", "formulas", "numberFormat"]);
      if (includeStyles) {
        range.load([
          "format/fill/color",
          "format/font/name",
          "format/font/size",
          "format/font/color",
          "format/horizontalAlignment",
        ]);
      }
      await ctx.sync();

      let values = ensure2D(range.values);
      let text = ensure2D(range.text);
      let formulas = ensure2D(range.formulas);
      let numberFormat = ensure2D(range.numberFormat);

      // Apply cell limit if needed
      const totalCells = values.reduce(
        (sum, row) => sum + row.filter((c) => c != null && c !== "").length,
        0,
      );
      if (cellLimit && totalCells > cellLimit) {
        const truncated = truncateMatrices(
          { values, text, formulas, numberFormat },
          cellLimit,
        );
        values = truncated.values;
        text = truncated.text;
        formulas = truncated.formulas;
        numberFormat = truncated.numberFormat;
      }

      results.push({
        sheet: sheet.name,
        address: range.address,
        values,
        text,
        formulas,
        numberFormat: includeStyles ? numberFormat : undefined,
        styles: includeStyles
          ? {
              fill: range.format.fill.color,
              font: {
                name: range.format.font.name,
                size: range.format.font.size,
                color: range.format.font.color,
              },
              horizontalAlignment: range.format.horizontalAlignment,
            }
          : undefined,
      });
    }
  });

  return { ranges: results };
}

function truncateMatrices(
  m: {
    values: any[][];
    text: any[][];
    formulas: any[][];
    numberFormat: any[][];
  },
  limit: number,
) {
  let remaining = limit;
  const out = {
    values: [] as any[][],
    text: [] as any[][],
    formulas: [] as any[][],
    numberFormat: [] as any[][],
  };
  for (let r = 0; r < m.values.length && remaining > 0; r++) {
    const vRow: any[] = [],
      tRow: any[] = [],
      fRow: any[] = [],
      nRow: any[] = [];
    const cols = Math.max(m.values[r]?.length ?? 0, m.text[r]?.length ?? 0);
    for (let c = 0; c < cols && remaining > 0; c++) {
      const v = m.values[r]?.[c];
      vRow.push(v);
      tRow.push(m.text[r]?.[c]);
      fRow.push(m.formulas[r]?.[c]);
      nRow.push(m.numberFormat[r]?.[c]);
      if (v != null && v !== "") remaining--;
    }
    out.values.push(vRow);
    out.text.push(tRow);
    out.formulas.push(fRow);
    out.numberFormat.push(nRow);
  }
  return out;
}

/**
 * Search for text across the workbook.
 *
 * Args: { searchTerm: string, sheetId?: string, range?: string, options?: { matchCase, matchEntireCell, useRegex, matchFormulas, maxResults } }
 */
export async function search_workbook(args: {
  searchTerm: string;
  sheetId?: string;
  range?: string | null;
  options?: {
    matchCase?: boolean;
    matchEntireCell?: boolean;
    useRegex?: boolean;
    matchFormulas?: boolean;
    maxResults?: number;
  };
}) {
  const searchTerm = args.searchTerm;
  if (!searchTerm) throw new Error("searchTerm is required");

  const opts = args.options ?? {};
  const matchCase = opts.matchCase === true;
  const matchEntireCell = opts.matchEntireCell === true;
  const useRegex = opts.useRegex === true;
  const matchFormulas = opts.matchFormulas === true;
  const maxResults = Math.max(0, Math.floor(opts.maxResults ?? 500));
  if (maxResults === 0) return { matches: [] };

  const matches: any[] = [];

  await excelRun(async (ctx) => {
    let sheets: Excel.Worksheet[];
    if (args.sheetId) {
      sheets = [await resolveSheet(ctx, args.sheetId)];
    } else {
      const allSheets = ctx.workbook.worksheets;
      allSheets.load("items/id");
      await ctx.sync();
      sheets = allSheets.items;
    }

    const rangeAddr = args.range ? stripSheetPrefix(args.range) : null;
    const pending: { range: Excel.Range; checkNull: boolean }[] = [];

    for (const sheet of sheets) {
      const range = rangeAddr
        ? sheet.getRange(rangeAddr)
        : sheet.getUsedRangeOrNullObject();
      const loads = [
        "values",
        "formulas",
        "rowIndex",
        "columnIndex",
        "worksheet/name",
      ];
      if (!rangeAddr) loads.push("isNullObject");
      range.load(loads);
      pending.push({ range, checkNull: !rangeAddr });
    }

    await ctx.sync();

    const needle = matchCase ? searchTerm : searchTerm.toLowerCase();
    const regex = useRegex
      ? new RegExp(searchTerm, matchCase ? "u" : "iu")
      : null;

    for (const { range, checkNull } of pending) {
      if (checkNull && range.isNullObject) continue;

      const values = ensure2D(range.values);
      const formulas = ensure2D(range.formulas);
      const startRow = range.rowIndex;
      const startCol = range.columnIndex;
      const sheetName = range.worksheet.name;

      for (let r = 0; r < values.length && matches.length < maxResults; r++) {
        for (
          let c = 0;
          c < (values[r]?.length ?? 0) && matches.length < maxResults;
          c++
        ) {
          const cellValue = String(values[r][c] ?? "");
          const cellFormula = matchFormulas
            ? String(formulas[r]?.[c] ?? "")
            : "";
          const haystack = matchCase ? cellValue : cellValue.toLowerCase();
          const formulaHaystack = matchCase
            ? cellFormula
            : cellFormula.toLowerCase();

          let found = false;
          if (regex) {
            found =
              regex.test(cellValue) ||
              (matchFormulas && regex.test(cellFormula));
          } else if (matchEntireCell) {
            found =
              haystack === needle ||
              (matchFormulas && formulaHaystack === needle);
          } else {
            found =
              haystack.includes(needle) ||
              (matchFormulas && formulaHaystack.includes(needle));
          }

          if (found) {
            const cellRef = `${colIndexToLetter(startCol + c + 1)}${startRow + r + 1}`;
            matches.push({
              sheet: sheetName,
              cell: cellRef,
              value: cellValue,
              formula: formulas[r]?.[c] ?? null,
            });
          }
        }
      }
    }
  });

  return { matches };
}

/**
 * List charts, tables, and pivot tables in the workbook.
 *
 * Args: { sheetId?: string, itemType?: "chart" | "table" | "pivotTable" }
 */
export async function list_items(args: {
  sheetId?: string;
  itemType?: "chart" | "table" | "pivotTable";
}) {
  const result: { charts: any[]; tables: any[]; pivotTables: any[] } = {
    charts: [],
    tables: [],
    pivotTables: [],
  };

  const wantCharts = !args.itemType || args.itemType === "chart";
  const wantTables = !args.itemType || args.itemType === "table";
  const wantPivots = !args.itemType || args.itemType === "pivotTable";

  await excelRun(async (ctx) => {
    let sheets: Excel.Worksheet[];
    if (args.sheetId) {
      sheets = [await resolveSheet(ctx, args.sheetId)];
    } else {
      const allSheets = ctx.workbook.worksheets;
      allSheets.load("items/id");
      await ctx.sync();
      sheets = allSheets.items;
    }

    // Load collections
    const chartColls: (Excel.ChartCollection | null)[] = [];
    const tableColls: (Excel.TableCollection | null)[] = [];
    const pivotColls: (Excel.PivotTableCollection | null)[] = [];

    for (const sheet of sheets) {
      if (wantCharts) {
        const charts = sheet.charts;
        charts.load(
          "items/id,name,chartType,plotBy,title/text,height,width,left,top",
        );
        chartColls.push(charts);
      } else chartColls.push(null);

      if (wantTables) {
        const tables = sheet.tables;
        tables.load(
          "items/id,name,style,showTotals,showHeaders,showFilterButton,highlightFirstColumn,highlightLastColumn,showBandedRows,showBandedColumns",
        );
        tableColls.push(tables);
      } else tableColls.push(null);

      if (wantPivots) {
        const pivots = sheet.pivotTables;
        pivots.load("items/id,name,refreshOnOpen,useCustomSortLists");
        pivotColls.push(pivots);
      } else pivotColls.push(null);
    }

    if (wantCharts || wantTables || wantPivots) await ctx.sync();

    // Load table ranges and pivot sources
    const tableRangeInfos: {
      table: Excel.Table;
      entire: Excel.Range;
      data: Excel.Range;
      header: Excel.Range;
    }[][] = [];
    const pivotSourceInfos: { pivot: Excel.PivotTable; source: any }[][] = [];

    for (let i = 0; i < sheets.length; i++) {
      const tableInfos: (typeof tableRangeInfos)[0] = [];
      if (tableColls[i]) {
        for (const table of tableColls[i]!.items) {
          const entire = table.getRange();
          const data = table.getDataBodyRange();
          const header = table.getHeaderRowRange();
          entire.load("address");
          data.load("address");
          header.load("address");
          tableInfos.push({ table, entire, data, header });
        }
      }
      tableRangeInfos.push(tableInfos);

      const pivotInfos: (typeof pivotSourceInfos)[0] = [];
      if (pivotColls[i]) {
        for (const pivot of pivotColls[i]!.items) {
          pivotInfos.push({ pivot, source: pivot.getDataSourceString() });
        }
      }
      pivotSourceInfos.push(pivotInfos);
    }

    if (
      tableRangeInfos.some((a) => a.length > 0) ||
      pivotSourceInfos.some((a) => a.length > 0)
    ) {
      await ctx.sync();
    }

    // Collect results
    for (let i = 0; i < sheets.length; i++) {
      if (chartColls[i]) {
        for (const chart of chartColls[i]!.items) {
          result.charts.push({
            id: chart.id,
            name: chart.name,
            type: chart.chartType,
            plotBy: chart.plotBy,
            title: chart.title?.text,
            position: {
              left: chart.left,
              top: chart.top,
              width: chart.width,
              height: chart.height,
            },
          });
        }
      }

      for (const { table, entire, data, header } of tableRangeInfos[i]) {
        result.tables.push({
          id: table.id,
          name: table.name,
          style: table.style,
          showTotals: table.showTotals,
          showHeaders: table.showHeaders,
          showFilterButton: table.showFilterButton,
          bandedRows: table.showBandedRows,
          bandedColumns: table.showBandedColumns,
          highlightFirstColumn: table.highlightFirstColumn,
          highlightLastColumn: table.highlightLastColumn,
          ranges: {
            entire: entire.address,
            data: data.address,
            header: header.address,
          },
        });
      }

      for (const { pivot, source } of pivotSourceInfos[i]) {
        result.pivotTables.push({
          id: pivot.id,
          name: pivot.name,
          refreshOnOpen: pivot.refreshOnOpen,
          useCustomSortLists: pivot.useCustomSortLists,
          source: source.value,
        });
      }
    }
  });

  return result;
}

/**
 * Write values/formulas to individual cells.
 *
 * Args: { sheetId: string, writes: WriteEntry[] }
 */
export async function write_range(args: {
  sheetId: string;
  writes: WriteEntry[];
}) {
  const sheetId = requireSheetId(args);
  const writes = args.writes ?? [];
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new Error("writes must include at least one cell");
  }

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const colResizes = new Map<number, ResizeSpec>();
    const rowResizes = new Map<number, ResizeSpec>();
    const notesToApply: { address: string; note: string | null }[] = [];
    const appliedCells: string[] = [];

    for (let i = 0; i < writes.length; i++) {
      const w = writes[i];
      if (!w || typeof w !== "object")
        throw new Error(`Invalid write payload at index ${i}`);
      if (!w.cell || typeof w.cell !== "string")
        throw new Error(`write[${i}].cell is required`);

      const parsed = parseCellAddress(w.cell);
      // Validate sheet matches if specified
      if (parsed.sheet) {
        const sheetLower = parsed.sheet.toLowerCase();
        const idLower = sheetId.toLowerCase();
        const nameLower = sheet.name ? sheet.name.toLowerCase() : "";
        if (sheetLower !== idLower && sheetLower !== nameLower) {
          throw new Error(`Cell ${w.cell} does not match sheetId ${sheetId}`);
        }
      }

      const addr = stripSheetPrefix(parsed.address);
      const range = sheet.getRange(addr);

      const hasFormula = Object.prototype.hasOwnProperty.call(w, "formula");
      const hasValue = Object.prototype.hasOwnProperty.call(w, "value");

      if (hasFormula && hasValue)
        throw new Error(`write[${i}] cannot include both value and formula`);

      if (hasFormula) {
        if (typeof w.formula !== "string" || w.formula.length === 0)
          throw new Error(`write[${i}].formula must be a non-empty string`);
        if (!w.formula.startsWith("="))
          throw new Error(`write[${i}].formula must start with '='`);
        assertNoBlockedFormulas(w.formula, `write[${i}].formula`);
        range.formulas = [[w.formula]];
      } else if (hasValue) {
        assertNoBlockedFormulas(w.value, `write[${i}].value`);
        range.values = [[w.value]];
      }

      if (w.cellStyles)
        applyCellStyles(range, w.cellStyles, { rowCount: 1, columnCount: 1 });
      if (w.resizeColumn) colResizes.set(parsed.col, w.resizeColumn);
      if (w.resizeRow) rowResizes.set(parsed.row, w.resizeRow);

      if (w.note !== undefined) {
        const noteText =
          typeof w.note === "string"
            ? w.note === ""
              ? null
              : w.note
            : w.note === null
              ? null
              : undefined;
        if (noteText !== undefined)
          notesToApply.push({ address: addr, note: noteText });
      }

      appliedCells.push(`${sheet.name}!${addr}`);
    }

    // Apply column resizes
    colResizes.forEach((spec, colIdx) => {
      const col = sheet.getCell(0, colIdx - 1).getEntireColumn();
      applyResizeSpec(col.format, spec, "column");
    });

    // Apply row resizes
    rowResizes.forEach((spec, rowIdx) => {
      const row = sheet.getCell(rowIdx - 1, 0).getEntireRow();
      applyResizeSpec(row.format, spec, "row");
    });

    if (notesToApply.length > 0) await applyNotes(sheet, notesToApply);
    await ctx.sync();

    return {
      cells: appliedCells,
      writesApplied: appliedCells.length,
      notesApplied: notesToApply.length > 0,
    };
  });
}

function applyResizeSpec(
  format: Excel.RangeFormat,
  spec: ResizeSpec,
  dimension: "column" | "row",
): void {
  if (spec.type === "autofit") {
    dimension === "column" ? format.autofitColumns() : format.autofitRows();
  } else if (spec.type === "points" && typeof spec.value === "number") {
    dimension === "column"
      ? (format.columnWidth = spec.value)
      : (format.rowHeight = spec.value);
  } else if (spec.type === "standard") {
    const prop = dimension === "column" ? "columnWidth" : "rowHeight";
    Reflect.set(format, prop, null);
  }
}

/**
 * Clear a range of cells.
 *
 * Args: { range: string, sheetId: string, clearType?: "contents" | "formats" | "all" }
 */
export async function clear_range(args: {
  range: string;
  sheetId: string;
  clearType?: string;
}) {
  const rangeAddr = args.range;
  if (!rangeAddr) throw new Error("range is required");

  const clearType = args.clearType ?? "contents";
  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const range = sheet.getRange(stripSheetPrefix(rangeAddr));

    const clearMap: Record<string, Excel.ClearApplyTo> = {
      contents: Excel.ClearApplyTo.contents,
      content: Excel.ClearApplyTo.contents,
      formats: Excel.ClearApplyTo.formats,
      format: Excel.ClearApplyTo.formats,
      all: Excel.ClearApplyTo.all,
    };

    const apply = clearMap[clearType.toLowerCase()];
    if (apply) range.clear(apply);
    else range.clear();

    await ctx.sync();
    return { cleared: true };
  });
}

/**
 * Copy a range to another location.
 *
 * Args: { sourceRange: string, destinationRange: string, sheetId: string }
 */
export async function copy_range_to(args: {
  sourceRange: string;
  destinationRange: string;
  sheetId: string;
}) {
  if (!args.sourceRange || !args.destinationRange) {
    throw new Error("sourceRange and destinationRange are required");
  }
  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const src = sheet.getRange(stripSheetPrefix(args.sourceRange));
    sheet.getRange(stripSheetPrefix(args.destinationRange)).copyFrom(src);
    await ctx.sync();
    return { copied: true, sheet: sheet.name };
  });
}

/**
 * Apply formatting to a range.
 *
 * Args: { range: string, sheetId: string, cellStyles: CellStyles }
 */
export async function format_range(args: {
  range: string;
  sheetId: string;
  cellStyles: CellStyles;
}) {
  const rangeAddr = args.range;
  if (!rangeAddr) throw new Error("range is required for format_range");
  if (!args.cellStyles)
    throw new Error("cellStyles is required for format_range");
  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const range = sheet.getRange(stripSheetPrefix(rangeAddr));
    range.load(["rowCount", "columnCount", "address"]);
    await ctx.sync();

    applyCellStyles(range, args.cellStyles, {
      rowCount: range.rowCount,
      columnCount: range.columnCount,
    });

    await ctx.sync();
    return {
      formatted: true,
      address: range.address,
      rowCount: range.rowCount,
      columnCount: range.columnCount,
    };
  });
}

/**
 * Resize columns/rows for a given range.
 *
 * Args: { range: string, sheetId: string, width?: ResizeSpec, height?: ResizeSpec }
 */
export async function resize_range(args: {
  range: string;
  sheetId: string;
  width?: ResizeSpec;
  height?: ResizeSpec;
}) {
  if (!args.range) throw new Error("range is required for resize_range");
  if (!args.width && !args.height)
    throw new Error("width or height is required");
  if (args.width?.type === "points" && typeof args.width.value !== "number")
    throw new Error("width.value must be a number when type is 'points'");
  if (args.height?.type === "points" && typeof args.height.value !== "number")
    throw new Error("height.value must be a number when type is 'points'");

  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const range = sheet.getRange(stripSheetPrefix(args.range));
    range.load("format");
    await ctx.sync();

    if (args.width) applyResizeSpec(range.format, args.width, "column");
    if (args.height) applyResizeSpec(range.format, args.height, "row");

    await ctx.sync();
    return { resized: true };
  });
}

/**
 * Capture a range as a base64 image.
 *
 * Args: { range: string, sheetId: string }
 */
export async function read_range_image(args: {
  range: string;
  sheetId: string;
}) {
  const rangeAddr = args.range;
  if (!rangeAddr) throw new Error("range is required");
  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const range = sheet.getRange(stripSheetPrefix(rangeAddr));
    const imageResult = range.getImage();
    range.load(["address", "rowCount", "columnCount"]);
    await ctx.sync();

    const base64 = imageResult.value ?? "";
    if (typeof base64 !== "string" || base64.length === 0) {
      throw new Error("Range image is empty");
    }

    const dataUri = base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`;
    const meta: string[] = [];
    if (range.address) meta.push(`address: ${range.address}`);
    if (typeof range.rowCount === "number")
      meta.push(`rows: ${range.rowCount}`);
    if (typeof range.columnCount === "number")
      meta.push(`cols: ${range.columnCount}`);

    const content: any[] = [];
    if (meta.length)
      content.push({ type: "input_text", text: meta.join(", ") });
    content.push({ type: "input_image", image_url: dataUri, detail: "auto" });

    return content;
  });
}

/**
 * Get metadata about all sheets in the workbook.
 *
 * Args: {} (no required args)
 */
export async function read_sheets_metadata(args: Record<string, any>) {
  return excelRun(async (ctx) => {
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/id,name,position,visibility,tabColor");
    await ctx.sync();

    return {
      sheets: sheets.items.map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        visibility: s.visibility,
        tabColor: (s as any).tabColor ?? null,
      })),
    };
  });
}

/**
 * Manage sheet structure: insert/delete/hide/unhide rows or columns, freeze/unfreeze panes.
 *
 * Args: { sheetId, operation, dimension?, reference?, count?, position? }
 */
export async function update_sheet(args: {
  sheetId: string;
  operation: "insert" | "delete" | "hide" | "unhide" | "freeze" | "unfreeze";
  dimension?: "rows" | "columns";
  reference?: string;
  count?: number;
  position?: "before" | "after";
}) {
  const { operation } = args;
  if (!operation) throw new Error("operation is required");

  const sheetId = requireSheetId(args);
  const dimension = args.dimension;
  const reference = args.reference;
  const count =
    typeof args.count === "number" ? Math.max(1, Math.floor(args.count)) : 1;
  const position = args.position ?? "before";

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);

    switch (operation) {
      case "insert": {
        if (!reference || !dimension)
          throw new Error("reference and dimension are required");
        const addr = normalizeRowColReference(reference, dimension);
        const baseRange = sheet.getRange(addr);
        const target =
          position === "after"
            ? baseRange.getOffsetRange(
                dimension === "rows" ? 1 : 0,
                dimension === "columns" ? 1 : 0,
              )
            : baseRange;
        const expanded =
          count > 1
            ? target.getResizedRange(
                dimension === "rows" ? count - 1 : 0,
                dimension === "columns" ? count - 1 : 0,
              )
            : target;
        const dir =
          dimension === "rows"
            ? Excel.InsertShiftDirection.down
            : Excel.InsertShiftDirection.right;
        expanded.insert(dir);
        break;
      }
      case "delete": {
        if (!reference || !dimension)
          throw new Error("reference and dimension are required");
        const addr = normalizeRowColReference(reference, dimension);
        const baseRange = sheet.getRange(addr);
        const expanded =
          count > 1
            ? baseRange.getResizedRange(
                dimension === "rows" ? count - 1 : 0,
                dimension === "columns" ? count - 1 : 0,
              )
            : baseRange;
        const dir =
          dimension === "rows"
            ? Excel.DeleteShiftDirection.up
            : Excel.DeleteShiftDirection.left;
        expanded.delete(dir);
        break;
      }
      case "hide": {
        if (!reference || !dimension)
          throw new Error("reference and dimension are required");
        const addr = normalizeRowColReference(reference, dimension);
        const range = sheet.getRange(addr);
        dimension === "rows"
          ? (range.rowHidden = true)
          : (range.columnHidden = true);
        break;
      }
      case "unhide": {
        if (!reference || !dimension)
          throw new Error("reference and dimension are required");
        const addr = normalizeRowColReference(reference, dimension);
        const range = sheet.getRange(addr);
        dimension === "rows"
          ? (range.rowHidden = false)
          : (range.columnHidden = false);
        break;
      }
      case "freeze": {
        if (!dimension) throw new Error("dimension is required for freeze");
        if (dimension === "rows") sheet.freezePanes.freezeRows(count);
        else if (dimension === "columns")
          sheet.freezePanes.freezeColumns(count);
        break;
      }
      case "unfreeze": {
        sheet.freezePanes.unfreeze();
        break;
      }
      default:
        throw new Error(`Unsupported operation ${operation}`);
    }

    await ctx.sync();
    return { status: "ok", operation };
  });
}

/**
 * Modify sheet view settings (gridlines, headings, zoom, RTL).
 *
 * Args: { sheetId, showGridlines?, showHeadings?, displayRightToLeft?, zoomScale? }
 */
export async function update_sheet_view(args: {
  sheetId: string;
  showGridlines?: boolean;
  showHeadings?: boolean;
  displayRightToLeft?: boolean;
  zoomScale?: number;
}) {
  const sheetId = requireSheetId(args);
  const showGridlines =
    typeof args.showGridlines === "boolean" ? args.showGridlines : undefined;
  const showHeadings =
    typeof args.showHeadings === "boolean" ? args.showHeadings : undefined;
  const displayRTL =
    typeof args.displayRightToLeft === "boolean"
      ? args.displayRightToLeft
      : undefined;
  const zoomScale =
    typeof args.zoomScale === "number" && Number.isFinite(args.zoomScale)
      ? Math.max(10, Math.min(400, Math.floor(args.zoomScale)))
      : undefined;

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);

    if (showGridlines !== undefined) sheet.showGridlines = showGridlines;
    if (showHeadings !== undefined) sheet.showHeadings = showHeadings;
    if (displayRTL !== undefined && "displayRightToLeft" in sheet) {
      Reflect.set(sheet, "displayRightToLeft", displayRTL);
    }
    if (zoomScale !== undefined && "zoomScale" in sheet) {
      (sheet as any).zoomScale = zoomScale;
    }

    await ctx.sync();
    return {
      sheetId,
      showGridlines,
      showHeadings,
      displayRightToLeft: displayRTL,
      zoomScale,
      status: "ok",
    };
  });
}

/**
 * Workbook-level sheet operations: create, delete, rename, duplicate.
 *
 * Args: { operation, sheetId?, sheetName?, tabColor?, newName? }
 */
export async function update_workbook(args: {
  operation: "create" | "delete" | "rename" | "duplicate";
  sheetId?: string;
  sheetName?: string;
  tabColor?: string;
  newName?: string;
}) {
  const { operation } = args;
  if (!operation) throw new Error("operation is required");

  if (operation === "create") {
    const name = args.sheetName?.trim() || "Sheet";
    const tabColor = args.tabColor || undefined;

    return excelRun(async (ctx) => {
      const sheet = ctx.workbook.worksheets.add(name);
      if (tabColor) Reflect.set(sheet, "tabColor", tabColor);
      sheet.load(["id", "name", "position"]);
      await ctx.sync();
      return { id: sheet.id, name: sheet.name, position: sheet.position };
    });
  }

  const sheetId = requireSheetId(args);

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);

    switch (operation) {
      case "delete":
        sheet.delete();
        break;
      case "rename": {
        const newName = args.newName?.trim();
        if (!newName) throw new Error("newName is required for rename");
        sheet.name = newName;
        break;
      }
      case "duplicate": {
        const newName = args.newName?.trim() || undefined;
        const copy = sheet.copy(Excel.WorksheetPositionType.after, sheet);
        if (newName) copy.name = newName;
        copy.load(["id", "name", "position"]);
        await ctx.sync();
        return {
          status: "ok",
          operation,
          id: copy.id,
          name: copy.name,
          position: copy.position,
        };
      }
      default:
        throw new Error(`Unsupported operation ${operation}`);
    }

    await ctx.sync();
    return { status: "ok", operation, id: sheet.id, name: sheet.name };
  });
}

/**
 * Create, update, or delete a chart.
 *
 * Args: { sheetId, operation, id?, properties? }
 */
export async function chart(args: {
  sheetId: string;
  operation: "create" | "update" | "delete";
  id?: string;
  properties?: ChartProperties;
}) {
  const sheetId = requireSheetId(args);
  const { operation, id, properties: props = {} } = args;

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const charts = sheet.charts;

    if (operation === "delete") {
      if (!id) throw new Error("id is required to delete a chart");
      const c = charts.getItemOrNullObject(id);
      c.load("isNullObject");
      await ctx.sync();
      if (c.isNullObject) throw new Error(`Chart ${id} not found`);
      c.delete();
      await ctx.sync();
      return { status: "deleted", id };
    }

    if (operation === "create") {
      const source = typeof props.source === "string" ? props.source : null;
      if (!source)
        throw new Error("properties.source is required to create a chart");

      const chartType =
        resolveChartType(props.chartType) ?? Excel.ChartType.columnClustered;
      const seriesBy =
        lookupEnum(Excel.ChartSeriesBy, props.seriesBy) ??
        Excel.ChartSeriesBy.auto;
      const dataRange = sheet.getRange(stripSheetPrefix(source));

      let newChart: Excel.Chart | null = null;
      try {
        newChart = charts.add(chartType, dataRange, seriesBy);
        applyChartProperties(newChart, props);
        newChart.load(["id", "name", "chartType"]);
        await ctx.sync();
        return {
          status: "created",
          id: newChart.id,
          name: newChart.name,
          chartType: newChart.chartType,
        };
      } catch (err) {
        if (newChart) {
          try {
            newChart.delete();
            await ctx.sync();
          } catch {}
        }
        throw err;
      }
    }

    if (operation === "update") {
      if (!id) throw new Error("id is required to update a chart");
      const c = charts.getItemOrNullObject(id);
      c.load(["isNullObject", "id", "name"]);
      await ctx.sync();
      if (c.isNullObject) throw new Error(`Chart ${id} not found`);

      if (typeof props.source === "string") {
        const dataRange = sheet.getRange(stripSheetPrefix(props.source));
        const seriesBy =
          lookupEnum(Excel.ChartSeriesBy, props.seriesBy) ??
          Excel.ChartSeriesBy.auto;
        c.setData(dataRange, seriesBy);
      }

      applyChartProperties(c, props);
      await ctx.sync();
      return { status: "updated", id: c.id, name: c.name };
    }

    throw new Error(`Unsupported chart operation: ${operation}`);
  });
}

/**
 * Create, update, or delete a table.
 *
 * Args: { sheetId, operation, id?, properties? }
 */
export async function table(args: {
  sheetId: string;
  operation: "create" | "update" | "delete";
  id?: string;
  properties?: TableProperties;
}) {
  const sheetId = requireSheetId(args);
  const { operation, id, properties: props = {} } = args;

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const tables = sheet.tables;

    if (operation === "delete") {
      if (!id) throw new Error("id is required to delete a table");
      const t = tables.getItemOrNullObject(id);
      t.load("isNullObject");
      await ctx.sync();
      if (t.isNullObject) throw new Error(`Table ${id} not found`);
      t.delete();
      await ctx.sync();
      return { status: "deleted", id };
    }

    if (operation === "create") {
      const rangeAddr = typeof props.range === "string" ? props.range : null;
      if (!rangeAddr)
        throw new Error("properties.range is required to create a table");
      const hasHeaders =
        typeof props.hasHeaders === "boolean" ? props.hasHeaders : true;
      const name =
        typeof props.name === "string" && props.name
          ? props.name
          : `Table_${Date.now()}`;
      const t = tables.add(stripSheetPrefix(rangeAddr), hasHeaders);
      const tRange = t.getRange();
      tRange.load("address");
      t.name = name;
      applyTableProperties(t, props);
      await ctx.sync();
      return {
        status: "created",
        id: t.id,
        name: t.name,
        address: tRange.address,
      };
    }

    if (operation === "update") {
      if (!id) throw new Error("id is required to update a table");
      const t = tables.getItemOrNullObject(id);
      t.load(["isNullObject", "id", "name"]);
      await ctx.sync();
      if (t.isNullObject) throw new Error(`Table ${id} not found`);
      applyTableProperties(t, props);
      await ctx.sync();
      return { status: "updated", id: t.id, name: t.name };
    }

    throw new Error(`Unsupported table operation: ${operation}`);
  });
}

/**
 * Create, update, or delete a pivot table.
 *
 * Args: { sheetId, operation, id?, properties? }
 */
export async function pivot_table(args: {
  sheetId: string;
  operation: "create" | "update" | "delete";
  id?: string;
  properties?: PivotProperties;
}) {
  const sheetId = requireSheetId(args);
  const { operation, id, properties: props = {} } = args;

  return excelRun(async (ctx) => {
    const sheet = await resolveSheet(ctx, sheetId);
    const pivots = sheet.pivotTables;

    if (operation === "delete") {
      if (!id) throw new Error("id is required to delete a pivot table");
      const p = pivots.getItemOrNullObject(id);
      p.load("isNullObject");
      await ctx.sync();
      if (p.isNullObject) throw new Error(`Pivot table ${id} not found`);
      p.delete();
      await ctx.sync();
      return { status: "deleted", id };
    }

    if (operation === "create") {
      const source = typeof props.source === "string" ? props.source : null;
      const destination =
        typeof props.destination === "string" ? props.destination : null;
      if (!source)
        throw new Error(
          "properties.source is required to create a pivot table",
        );
      if (!destination)
        throw new Error(
          "properties.destination is required to create a pivot table",
        );

      const name =
        typeof props.name === "string" && props.name
          ? props.name
          : `Pivot_${Date.now()}`;
      const srcRange = sheet.getRange(stripSheetPrefix(source));
      const destRange = sheet.getRange(stripSheetPrefix(destination));

      let pivot: Excel.PivotTable;
      let usedName = name;
      try {
        pivot = pivots.add(name, srcRange, destRange);
      } catch {
        usedName = `Pivot_${Date.now()}`;
        pivot = pivots.add(usedName, srcRange, destRange);
      }

      await ctx.sync();
      try {
        await refreshPivotHierarchies(pivot, ctx);
        configurePivotFields(pivot, props);
        await ctx.sync();
        pivot.load(["id", "name"]);
        await ctx.sync();
        return {
          status: "created",
          id: pivot.id,
          name: pivot.name ?? usedName,
        };
      } catch (err) {
        try {
          pivot.delete();
          await ctx.sync();
        } catch {}
        throw err;
      }
    }

    if (operation === "update") {
      if (!id) throw new Error("id is required to update a pivot table");
      const p = pivots.getItemOrNullObject(id);
      p.load(["isNullObject", "id", "name"]);
      await ctx.sync();
      if (p.isNullObject) throw new Error(`Pivot table ${id} not found`);

      if (typeof props.name === "string" && props.name) p.name = props.name;

      if (typeof props.source === "string") {
        try {
          const srcRange = sheet.getRange(stripSheetPrefix(props.source));
          const changeDS = Reflect.get(p, "changeDataSource");
          if (typeof changeDS === "function") changeDS.call(p, srcRange);
        } catch {}
      }

      await refreshPivotHierarchies(p, ctx);
      configurePivotFields(p, props);
      await ctx.sync();
      return { status: "updated", id: p.id, name: p.name };
    }

    throw new Error(`Unsupported pivot_table operation: ${operation}`);
  });
}

/**
 * Run arbitrary Office.js code in a sandboxed iframe.
 *
 * Note: The actual sandbox iframe bootstrapping is handled by the host harness.
 * This executor validates the script and delegates to the sandbox broker.
 *
 * Args: { code: string, destructive?: boolean }
 */
export async function run_officejs(args: {
  code: string;
  destructive?: boolean;
  _sandboxRunner?: (
    script: string,
    ctx: Excel.RequestContext,
  ) => Promise<{ result?: any; logs?: any[] }>;
}) {
  const script = validateOfficeJsScript(args.code, args.destructive ?? false);

  return excelRun(async (ctx) => {
    if (!args._sandboxRunner) {
      throw new Error("run_officejs requires a sandbox runner implementation");
    }
    const { result, logs } = await args._sandboxRunner(script, ctx);

    if (result !== undefined) {
      // Validate serializability
      try {
        JSON.stringify(result);
      } catch {
        throw new Error(
          "run_officejs returned a non-serializable value. Return primitives, arrays, or plain objects.",
        );
      }
      return { status: "ok", result, logs };
    }
    return { status: "ok", logs };
  });
}

/**
 * Run Google Apps Script (Sheets only — throws in Excel).
 */
export async function run_appscript(_args: any): Promise<never> {
  throw new Error("run_appscript is only available in the Sheets runtime.");
}

/**
 * Acknowledge/update the agent's execution plan (no-op client-side).
 */
export async function update_plan(_args: any) {
  return { status: "ok" };
}

// ===========================================================================
// TOOL REGISTRY — maps tool names to executors
// ===========================================================================

export const toolExecutors: Record<string, (args: any) => Promise<any>> = {
  read_ranges,
  search_workbook,
  list_items,
  write_range,
  clear_range,
  copy_range_to,
  format_range,
  resize_range,
  read_range_image,
  read_sheets_metadata,
  update_sheet,
  update_sheet_view,
  update_workbook,
  chart,
  table,
  pivot_table,
  run_officejs,
  run_appscript,
  update_plan,
};

// ===========================================================================
// JSON TOOL SCHEMAS — reconstructed from the implementations
// ===========================================================================

export const toolSchemas = [
  {
    type: "function",
    name: "read_ranges",
    description:
      "Read cell values, text, formulas, number formats, and styles from one or more ranges in a worksheet.",
    parameters: {
      type: "object",
      required: ["ranges", "sheetId"],
      properties: {
        sheetId: {
          type: "string",
          description: "Worksheet id, name, or position index.",
        },
        ranges: {
          type: "array",
          items: { type: "string" },
          description: "Array of A1-style range addresses to read.",
        },
        includeStyles: {
          type: "boolean",
          description: "Include fill/font/alignment info. Default true.",
        },
        includeXml: {
          type: "boolean",
          description: "Return data as XML string. Default true.",
        },
        cellLimit: {
          type: "integer",
          description: "Max non-empty cells to return. Default 10000.",
        },
      },
    },
  },
  {
    type: "function",
    name: "search_workbook",
    description: "Search for text across all sheets or a specific sheet/range.",
    parameters: {
      type: "object",
      required: ["searchTerm"],
      properties: {
        searchTerm: {
          type: "string",
          description: "Text or regex pattern to search for.",
        },
        sheetId: { type: "string", description: "Limit search to this sheet." },
        range: {
          type: "string",
          description: "Limit search to this range within the sheet.",
        },
        options: {
          type: "object",
          properties: {
            matchCase: { type: "boolean" },
            matchEntireCell: { type: "boolean" },
            useRegex: { type: "boolean" },
            matchFormulas: { type: "boolean" },
            maxResults: {
              type: "integer",
              description: "Max matches to return. Default 500.",
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "list_items",
    description:
      "List charts, tables, and/or pivot tables in the workbook or a specific sheet.",
    parameters: {
      type: "object",
      properties: {
        sheetId: { type: "string", description: "Limit to this sheet." },
        itemType: {
          type: "string",
          enum: ["chart", "table", "pivotTable"],
          description: "Filter by item type.",
        },
      },
    },
  },
  {
    type: "function",
    name: "write_range",
    description:
      "Write values or formulas to individual cells, with optional styling, notes, and column/row resizing.",
    parameters: {
      type: "object",
      required: ["sheetId", "writes"],
      properties: {
        sheetId: { type: "string" },
        writes: {
          type: "array",
          items: {
            type: "object",
            required: ["cell"],
            properties: {
              cell: {
                type: "string",
                description:
                  "A1-style cell address, optionally with sheet prefix.",
              },
              value: {
                description: "Value to write (string, number, boolean).",
              },
              formula: {
                type: "string",
                description: "Formula to write (must start with '=').",
              },
              cellStyles: {
                type: "object",
                description: "Style properties to apply to this cell.",
              },
              resizeColumn: {
                type: "object",
                description: "Column resize spec: { type, value? }.",
              },
              resizeRow: {
                type: "object",
                description: "Row resize spec: { type, value? }.",
              },
              note: {
                type: ["string", "null"],
                description: "Note/comment text, or null to remove.",
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "clear_range",
    description: "Clear contents, formats, or all from a range.",
    parameters: {
      type: "object",
      required: ["range", "sheetId"],
      properties: {
        range: { type: "string", description: "A1-style range address." },
        sheetId: { type: "string" },
        clearType: {
          type: "string",
          enum: ["contents", "formats", "all"],
          description: "What to clear. Default 'contents'.",
        },
      },
    },
  },
  {
    type: "function",
    name: "copy_range_to",
    description: "Copy a range to another location on the same sheet.",
    parameters: {
      type: "object",
      required: ["sourceRange", "destinationRange", "sheetId"],
      properties: {
        sourceRange: { type: "string" },
        destinationRange: { type: "string" },
        sheetId: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: "format_range",
    description:
      "Apply cell styling (font, fill, borders, number format, alignment) to a range.",
    parameters: {
      type: "object",
      required: ["range", "sheetId", "cellStyles"],
      properties: {
        range: { type: "string" },
        sheetId: { type: "string" },
        cellStyles: {
          type: "object",
          properties: {
            fontColor: { type: "string" },
            fontSize: { type: "number" },
            fontFamily: { type: "string" },
            fontWeight: { type: "string", enum: ["bold", "normal"] },
            fontStyle: { type: "string", enum: ["italic", "normal"] },
            fontLine: {
              type: "string",
              enum: ["underline", "line-through", "none"],
            },
            backgroundColor: { type: "string" },
            horizontalAlignment: { type: "string" },
            numberFormat: { type: "string" },
            borders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sides: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["top", "bottom", "left", "right"],
                    },
                  },
                  color: { type: "string" },
                  style: {
                    type: "string",
                    enum: ["solid", "dashed", "dotted", "double"],
                  },
                  weight: { type: "string", enum: ["thin", "medium", "thick"] },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "resize_range",
    description:
      "Resize columns and/or rows for a range (autofit, set points, or reset to standard).",
    parameters: {
      type: "object",
      required: ["range", "sheetId"],
      properties: {
        range: { type: "string" },
        sheetId: { type: "string" },
        width: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["autofit", "points", "standard"] },
            value: { type: "number" },
          },
        },
        height: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["autofit", "points", "standard"] },
            value: { type: "number" },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "read_range_image",
    description: "Capture a range as a base64-encoded PNG image.",
    parameters: {
      type: "object",
      required: ["range", "sheetId"],
      properties: {
        range: { type: "string" },
        sheetId: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: "read_sheets_metadata",
    description:
      "Get metadata (id, name, position, visibility, tab color) for all sheets in the workbook.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "update_sheet",
    description:
      "Insert, delete, hide, or unhide rows/columns, or freeze/unfreeze panes.",
    parameters: {
      type: "object",
      required: ["sheetId", "operation"],
      properties: {
        sheetId: { type: "string" },
        operation: {
          type: "string",
          enum: ["insert", "delete", "hide", "unhide", "freeze", "unfreeze"],
        },
        dimension: { type: "string", enum: ["rows", "columns"] },
        reference: {
          type: "string",
          description: "Row number or column letter to anchor the operation.",
        },
        count: {
          type: "integer",
          description: "Number of rows/columns. Default 1.",
        },
        position: {
          type: "string",
          enum: ["before", "after"],
          description: "Insert position. Default 'before'.",
        },
      },
    },
  },
  {
    type: "function",
    name: "update_sheet_view",
    description:
      "Toggle gridlines, headings, RTL, or set zoom level for a sheet.",
    parameters: {
      type: "object",
      required: ["sheetId"],
      properties: {
        sheetId: { type: "string" },
        showGridlines: { type: "boolean" },
        showHeadings: { type: "boolean" },
        displayRightToLeft: { type: "boolean" },
        zoomScale: {
          type: "integer",
          description: "Zoom percentage (10–400).",
        },
      },
    },
  },
  {
    type: "function",
    name: "update_workbook",
    description: "Create, delete, rename, or duplicate worksheets.",
    parameters: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: ["create", "delete", "rename", "duplicate"],
        },
        sheetId: {
          type: "string",
          description: "Required for delete/rename/duplicate.",
        },
        sheetName: {
          type: "string",
          description: "Name for new sheet (create).",
        },
        tabColor: {
          type: "string",
          description: "Tab color for new sheet (create).",
        },
        newName: {
          type: "string",
          description: "New name (rename/duplicate).",
        },
      },
    },
  },
  {
    type: "function",
    name: "chart",
    description: "Create, update, or delete a chart on a worksheet.",
    parameters: {
      type: "object",
      required: ["sheetId", "operation"],
      properties: {
        sheetId: { type: "string" },
        operation: { type: "string", enum: ["create", "update", "delete"] },
        id: {
          type: "string",
          description: "Chart id (required for update/delete).",
        },
        properties: {
          type: "object",
          properties: {
            source: { type: "string", description: "Data source range." },
            chartType: {
              type: "string",
              description: "e.g. columnClustered, barClustered, line, pie.",
            },
            seriesBy: { type: "string" },
            title: { type: "string" },
            name: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            position: { type: "string" },
            endPosition: { type: "string" },
            legend: {
              type: "object",
              properties: {
                visible: { type: "boolean" },
                position: { type: "string" },
              },
            },
            categoryAxisTitle: { type: "string" },
            valueAxisTitle: { type: "string" },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "table",
    description: "Create, update, or delete an Excel table on a worksheet.",
    parameters: {
      type: "object",
      required: ["sheetId", "operation"],
      properties: {
        sheetId: { type: "string" },
        operation: { type: "string", enum: ["create", "update", "delete"] },
        id: {
          type: "string",
          description: "Table id (required for update/delete).",
        },
        properties: {
          type: "object",
          properties: {
            range: {
              type: "string",
              description: "Range for the table (create).",
            },
            hasHeaders: { type: "boolean" },
            name: { type: "string" },
            style: { type: "string" },
            showTotals: { type: "boolean" },
            showHeaders: { type: "boolean" },
            showFilterButton: { type: "boolean" },
            highlightFirstColumn: { type: "boolean" },
            highlightLastColumn: { type: "boolean" },
            showBandedRows: { type: "boolean" },
            showBandedColumns: { type: "boolean" },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "pivot_table",
    description: "Create, update, or delete a pivot table.",
    parameters: {
      type: "object",
      required: ["sheetId", "operation"],
      properties: {
        sheetId: { type: "string" },
        operation: { type: "string", enum: ["create", "update", "delete"] },
        id: {
          type: "string",
          description: "Pivot table id (required for update/delete).",
        },
        properties: {
          type: "object",
          properties: {
            source: { type: "string", description: "Data source range." },
            destination: {
              type: "string",
              description: "Where to place the pivot (create).",
            },
            name: { type: "string" },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  showSubtotals: { type: "boolean" },
                },
              },
            },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  showSubtotals: { type: "boolean" },
                },
              },
            },
            values: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  aggregation: {
                    type: "string",
                    enum: ["sum", "count", "average", "min", "max"],
                  },
                  name: { type: "string" },
                  numberFormat: { type: "string" },
                },
              },
            },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  include: { type: "array", items: { type: "string" } },
                  exclude: { type: "array", items: { type: "string" } },
                },
              },
            },
            layout: {
              type: "object",
              properties: {
                showRowHeaders: { type: "boolean" },
                showColumnHeaders: { type: "boolean" },
                showGrandTotalsRows: { type: "boolean" },
                showGrandTotalsColumns: { type: "boolean" },
                compactForm: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    name: "run_officejs",
    description:
      "Execute arbitrary Office.js JavaScript code in a sandboxed iframe. The code receives the Excel context — do NOT call Excel.run(). Set destructive=true if the script modifies the workbook.",
    parameters: {
      type: "object",
      required: ["code"],
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript code to execute. Max 20,000 chars. Must not call Excel.run().",
        },
        destructive: {
          type: "boolean",
          description: "Set true if the script writes/modifies the workbook.",
        },
      },
    },
  },
  {
    type: "function",
    name: "run_appscript",
    description: "Execute Google Apps Script code (Google Sheets only).",
    parameters: {
      type: "object",
      required: ["code"],
      properties: {
        code: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: "update_plan",
    description:
      "Acknowledge or update the agent's execution plan. This is a coordination signal — no spreadsheet changes are made.",
    parameters: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Updated plan text." },
      },
    },
  },
];
