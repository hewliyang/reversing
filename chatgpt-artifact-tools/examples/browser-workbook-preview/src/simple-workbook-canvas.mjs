const rowHeaderWidth = 48;
const colHeaderHeight = 28;
const defaultColumnWidth = 112;
const defaultRowHeight = 24;
const minimumGridRows = 200;
const minimumGridColumns = 50;
const indexedColors = {
  0: "#000000",
  1: "#ffffff",
  2: "#ff0000",
  3: "#00ff00",
  4: "#0000ff",
  5: "#ffff00",
  6: "#ff00ff",
  7: "#00ffff",
  64: "#000000",
  65: "#ffffff",
};

const themeColors = {
  0: "#ffffff",
  1: "#000000",
  2: "#e7e6e6",
  3: "#44546a",
  4: "#4472c4",
  5: "#ed7d31",
  6: "#a5a5a5",
  7: "#ffc000",
  8: "#5b9bd5",
  9: "#70ad47",
  10: "#0563c1",
  11: "#954f72",
};

const builtinNumberFormats = new Map([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0;(#,##0)"],
  [38, "#,##0;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [44, '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)'],
]);

function parseA1(address) {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) return null;
  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + char.charCodeAt(0) - 64;
  }
  return { col, row: Number(match[2]) };
}

function parseRangeAddress(range) {
  if (!range) return null;
  if (typeof range === "string") {
    const normalized = range.includes("!") ? range.split("!").pop() : range;
    const [startText, endText] = normalized.replaceAll("$", "").split(":");
    const start = parseA1(startText);
    const end = parseA1(endText || startText);
    if (!start || !end) return null;
    return {
      r1: Math.min(start.row, end.row),
      c1: Math.min(start.col, end.col),
      r2: Math.max(start.row, end.row),
      c2: Math.max(start.col, end.col),
    };
  }
  if (range.startAddress && range.endAddress) {
    const start = parseA1(range.startAddress);
    const end = parseA1(range.endAddress);
    if (start && end) {
      return {
        r1: Math.min(start.row, end.row),
        c1: Math.min(start.col, end.col),
        r2: Math.max(start.row, end.row),
        c2: Math.max(start.col, end.col),
      };
    }
  }
  const compact = range.startAddress || "";
  const [startText, endText] = compact.split(":");
  const start = parseA1(startText);
  const end = parseA1(endText || startText);
  if (!start || !end) return null;
  return {
    r1: Math.min(start.row, end.row),
    c1: Math.min(start.col, end.col),
    r2: Math.max(start.row, end.row),
    c2: Math.max(start.col, end.col),
  };
}

function parseSqref(sqref) {
  if (!sqref) return [];
  return String(sqref)
    .trim()
    .split(/\s+/)
    .map((part) => parseRangeAddress(part))
    .filter(Boolean);
}

function colName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function cellAddress(row, col) {
  return `${colName(col)}${row}`;
}

function rangeAddress(range) {
  const normalized = normalizeRange(range);
  const start = cellAddress(normalized.r1, normalized.c1);
  const end = cellAddress(normalized.r2, normalized.c2);
  return start === end ? start : `${start}:${end}`;
}

function normalizeRange(range) {
  const r1 = Math.min(range.r1, range.r2);
  const r2 = Math.max(range.r1, range.r2);
  const c1 = Math.min(range.c1, range.c2);
  const c2 = Math.max(range.c1, range.c2);
  return { r1, c1, r2, c2 };
}

function cellText(cell, options = {}) {
  if (!cell) return "";
  if (options.showFormulas && cell.formula) return `=${cell.formula}`;
  if (cell.value != null) return String(cell.value);
  if (cell.formula) return `=${cell.formula}`;
  return "";
}

function cellDisplayText(workbook, cell, style, options = {}) {
  return formatCell(workbook, cell, style, options);
}

function isNumericCell(cell) {
  return cell?.dataType === 5 && cell.value != null && cell.value !== "";
}

function isDateFormat(formatCode) {
  return /[ymdhHs]/.test(formatCode.replace(/"[^"]*"/g, ""));
}

function excelSerialToDate(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86400000);
}

function formatDate(serial, formatCode) {
  const date = excelSerialToDate(serial);
  if (!Number.isFinite(date.getTime())) return String(serial);
  const hasTime = /[hHs]/.test(formatCode);
  const datePart = date.toLocaleDateString(undefined, {
    year: "2-digit",
    month: /mmm/i.test(formatCode) ? "short" : "numeric",
    day: "numeric",
  });
  if (!hasTime) return datePart;
  return `${datePart} ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function numberFormatCode(workbook, style) {
  const numFmtId = style?.cellFormat?.numFmtId;
  if (numFmtId == null) return "General";
  const custom = workbook.styles?.numberFormats?.find((format) => format.id === numFmtId)?.formatCode;
  return custom || builtinNumberFormats.get(numFmtId) || "General";
}

function formatCell(workbook, cell, style, options = {}) {
  const text = cellText(cell, options);
  if (options.showFormulas && cell?.formula) return text;
  if (!isNumericCell(cell)) return text;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  const formatCode = numberFormatCode(workbook, style);
  if (isDateFormat(formatCode)) return formatDate(value, formatCode);
  if (formatCode.includes("%")) {
    const decimals = /0\.0+%/.exec(formatCode)?.[0].split(".")[1]?.replace("%", "").length ?? 0;
    return `${(value * 100).toFixed(decimals)}%`;
  }
  const isCurrency = formatCode.includes("$");
  const decimals = /0\.(0+)/.exec(formatCode)?.[1]?.length;
  const useGrouping = formatCode.includes(",");
  const currencyOptions = isCurrency ? { style: "currency", currency: "USD" } : {};
  if (decimals != null) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping,
      ...currencyOptions,
    });
  }
  if (Number.isInteger(value)) return value.toLocaleString(undefined, { useGrouping, ...currencyOptions });
  return value.toLocaleString(undefined, { maximumFractionDigits: 3, useGrouping, ...currencyOptions });
}

function getSheetBounds(sheet) {
  let maxRow = 1;
  let maxCol = 1;
  for (const row of sheet.rows) {
    if (row.hidden) continue;
    maxRow = Math.max(maxRow, row.index);
    for (const cell of row.cells) {
      const parsed = parseA1(cell.address);
      if (!parsed) continue;
      maxRow = Math.max(maxRow, parsed.row);
      maxCol = Math.max(maxCol, parsed.col);
    }
  }
  for (const column of sheet.columns) {
    if (!column.hidden) maxCol = Math.max(maxCol, column.max || column.min || 1);
  }
  for (const table of sheet.tables || []) {
    const range = parseRangeAddress(table.ref);
    if (!range) continue;
    maxRow = Math.max(maxRow, range.r2);
    maxCol = Math.max(maxCol, range.c2);
  }
  for (const pivotTable of sheet.pivotTables || []) {
    const range = parseRangeAddress(pivotTable.location?.reference);
    if (!range) continue;
    maxRow = Math.max(maxRow, range.r2);
    maxCol = Math.max(maxCol, range.c2);
  }
  for (const group of sheet.sparklineGroups?.groups || []) {
    for (const sparkline of group.sparklines || []) {
      const range = parseRangeAddress(sparkline.reference);
      if (!range) continue;
      maxRow = Math.max(maxRow, range.r2);
      maxCol = Math.max(maxCol, range.c2);
    }
  }
  for (const object of [...(sheet.slicers || []), ...(sheet.timelines || []), ...(sheet.drawings || [])]) {
    const row = anchorIndex(object.toAnchor?.rowId ?? object.fromAnchor?.rowId);
    const col = anchorIndex(object.toAnchor?.colId ?? object.fromAnchor?.colId);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }
  return {
    maxRow: Math.min(Math.max(maxRow, minimumGridRows), 1000),
    maxCol: Math.min(Math.max(maxCol, minimumGridColumns), 100),
  };
}

function defaultWorkbookFont(workbook) {
  const baseFormat = workbook?.styles?.cellXfs?.[0];
  return workbook?.styles?.fonts?.[baseFormat?.fontId ?? 0] || workbook?.styles?.fonts?.[0] || {};
}

function columnDigitWidth(workbook) {
  const font = defaultWorkbookFont(workbook);
  const fontSize = Number(font.fontSize) || 11;
  return fontSize > 12 ? fontSize * 0.75 : 7;
}

function excelColumnWidthToPx(width, digitWidth) {
  const value = Number(width);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(4, Math.round(value * digitWidth));
}

function buildColumnWidths(workbook, sheet, maxCol, zoom = 1) {
  const digitWidth = columnDigitWidth(workbook);
  const defaultWidth = excelColumnWidthToPx(sheet.defaultColumnWidth || 8.43, digitWidth) || defaultColumnWidth;
  const widths = Array.from({ length: maxCol + 1 }, () => defaultWidth);
  for (const column of sheet.columns) {
    const width = column.hidden
      ? 0
      : column.width > 0
        ? excelColumnWidthToPx(column.width, digitWidth)
        : defaultWidth;
    for (let col = Math.max(1, column.min); col <= Math.min(maxCol, column.max || column.min); col += 1) {
      widths[col] = width;
    }
  }
  return widths.map((width) => Math.round(width * zoom));
}

function buildRowHeights(sheet, maxRow, zoom = 1) {
  const baseHeight = sheet.defaultRowHeight > 0 ? Math.round(sheet.defaultRowHeight * (96 / 72) + 3) : defaultRowHeight;
  const heights = Array.from({ length: maxRow + 1 }, () => Math.max(defaultRowHeight, baseHeight));
  for (const row of sheet.rows) {
    if (row.index > maxRow) continue;
    if (row.hidden) {
      heights[row.index] = 0;
      continue;
    }
    if (row.height > 0) heights[row.index] = Math.max(20, Math.round(row.height * (96 / 72) + 3));
  }
  return heights.map((height) => Math.round(height * zoom));
}

function buildRowMap(sheet) {
  const rows = new Map();
  for (const row of sheet.rows) rows.set(row.index, row);
  return rows;
}

function buildColumnMap(sheet, maxCol) {
  const columns = Array.from({ length: maxCol + 1 }, () => null);
  for (const column of sheet.columns) {
    const min = Math.max(1, column.min);
    const max = Math.min(maxCol, column.max || column.min);
    for (let col = min; col <= max; col += 1) columns[col] = column;
  }
  return columns;
}

function ensureColumn(sheet, colIndex) {
  let column = sheet.columns.find((candidate) => candidate.min === colIndex && (candidate.max || candidate.min) === colIndex);
  if (!column) {
    column = { min: colIndex, max: colIndex, width: sheet.defaultColumnWidth || 8.43, customWidth: true };
    sheet.columns.push(column);
  }
  column.customWidth = true;
  return column;
}

function prefixSums(values) {
  const offsets = [0];
  offsets[1] = 0;
  for (let i = 2; i < values.length; i += 1) {
    offsets[i] = offsets[i - 1] + (values[i - 1] ?? 0);
  }
  return offsets;
}

function buildCellMap(sheet) {
  const cells = new Map();
  for (const row of sheet.rows) {
    if (row.hidden) continue;
    for (const cell of row.cells) {
      const parsed = parseA1(cell.address);
      if (!parsed) continue;
      cells.set(`${parsed.row}:${parsed.col}`, cell);
    }
  }
  return cells;
}

function normalizeColorValue(value) {
  if (!value) return null;
  if (value.startsWith("#")) return value.length === 9 ? `#${value.slice(3)}` : value;
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
  if (/^[0-9a-f]{8}$/i.test(value)) return `#${value.slice(2)}`;
  return null;
}

function hexToRgb(color) {
  const normalized = normalizeColorValue(color);
  if (!normalized) return null;
  const hex = normalized.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function applyColorTransform(color, transform) {
  const rgb = hexToRgb(color);
  if (!rgb || !transform) return color;
  const apply = (value) => {
    let next = value;
    if (transform.lumMod != null) next *= transform.lumMod / 100000;
    if (transform.lumOff != null) next += 255 * (transform.lumOff / 100000);
    if (transform.tint != null) {
      const tint = transform.tint / 100000;
      next = tint >= 0 ? next + (255 - next) * tint : next * (1 + tint);
    }
    if (transform.shade != null) next *= transform.shade / 100000;
    return next;
  };
  return rgbToHex({ r: apply(rgb.r), g: apply(rgb.g), b: apply(rgb.b) });
}

function resolveColor(color, fallback = null) {
  if (!color) return fallback;
  const themeMatch = /^theme:(\d+)$/i.exec(color.value || "");
  const base =
    normalizeColorValue(color.lastColor) ||
    normalizeColorValue(color.value) ||
    (themeMatch ? themeColors[Number(themeMatch[1])] : null) ||
    indexedColors[color.indexedColorId] ||
    fallback;
  return applyColorTransform(base, color.transform);
}

function mixColors(startColor, endColor, ratio) {
  const start = hexToRgb(startColor);
  const end = hexToRgb(endColor);
  if (!start || !end) return startColor || endColor || null;
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: start.r + (end.r - start.r) * t,
    g: start.g + (end.g - start.g) * t,
    b: start.b + (end.b - start.b) * t,
  });
}

function resolveFillColor(fill) {
  if (!fill) return null;
  return resolveColor(fill.color);
}

function resolveFillPaint(ctx, fill, x, y, width, height) {
  const stops = (fill?.gradientStops || [])
    .map((stop) => ({
      position: Number.isFinite(stop.position) ? Math.max(0, Math.min(1, stop.position / 100000)) : 0,
      color: resolveColor(stop.color),
    }))
    .filter((stop) => stop.color)
    .sort((a, b) => a.position - b.position);
  if (stops.length === 0) return resolveFillColor(fill);
  if (stops.length === 1) return stops[0].color;

  const angle = Number.isFinite(fill.angleDeg) ? fill.angleDeg : 0;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = x + halfWidth;
  const centerY = y + halfHeight;
  const scale = Math.abs(dx) * halfWidth + Math.abs(dy) * halfHeight || halfWidth || 1;
  const gradient = ctx.createLinearGradient(centerX - dx * scale, centerY - dy * scale, centerX + dx * scale, centerY + dy * scale);
  for (const stop of stops) gradient.addColorStop(stop.position, stop.color);
  return gradient;
}

function resolveCellStyle(workbook, cell, row, column) {
  const styleIndex = cell?.styleIndex ?? row?.styleIndex ?? column?.styleIndex ?? 0;
  const cellFormat = workbook.styles?.cellXfs?.[styleIndex];
  const font = workbook.styles?.fonts?.[cellFormat?.fontId ?? 0];
  const fill = workbook.styles?.fills?.[cellFormat?.fillId ?? 0];
  const border = workbook.styles?.borders?.[cellFormat?.borderId ?? 0];
  return {
    cellFormat,
    font,
    border,
    fill,
    fillColor: resolveFillColor(fill),
    fontColor: resolveFillColor(font?.fill) || "#181812",
    bold: Boolean(font?.bold),
    italic: Boolean(font?.italic),
    underline: font?.underline,
    fontSize: font?.fontSize ? Math.max(10, Math.round(font.fontSize * (96 / 72))) : 15,
    fontFamily: font?.typeface || font?.name || "system-ui",
  };
}

function emuToPx(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / 9525 : 0;
}

function anchorIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number) + 1) : 1;
}

function anchorPoint(layout, anchor) {
  if (!anchor) return null;
  const col = Math.min(layout.maxCol, anchorIndex(anchor.colId));
  const row = Math.min(layout.maxRow, anchorIndex(anchor.rowId));
  return {
    x: layout.rowHeaderWidth + (layout.columnOffsets[col] ?? 0) + emuToPx(anchor.colOffset) * layout.zoom - layout.scrollLeft,
    y: layout.colHeaderHeight + (layout.rowOffsets[row] ?? 0) + emuToPx(anchor.rowOffset) * layout.zoom - layout.scrollTop,
  };
}

function buildMergeMaps(sheet) {
  const anchors = new Map();
  const covered = new Set();
  for (const rawRange of sheet.mergedCells || []) {
    const range = parseRangeAddress(rawRange);
    if (!range || (range.r1 === range.r2 && range.c1 === range.c2)) continue;
    anchors.set(`${range.r1}:${range.c1}`, range);
    for (let row = range.r1; row <= range.r2; row += 1) {
      for (let col = range.c1; col <= range.c2; col += 1) {
        if (row !== range.r1 || col !== range.c1) covered.add(`${row}:${col}`);
      }
    }
  }
  return { anchors, covered };
}

function tableHeaderRows(table) {
  return table?.headerRowCount === 0 ? 0 : 1;
}

function tableTotalRows(table) {
  if (table?.totalsRowCount === 0) return 0;
  return typeof table?.totalsRowCount === "number" || table?.totalsRowShown ? 1 : 0;
}

function buildTableMetadata(sheet) {
  const ranges = [];
  const byRow = new Map();
  const horizontalBoundaries = new Set();
  for (const table of sheet.tables || []) {
    const range = parseRangeAddress(table.ref);
    if (!range) continue;
    const metadata = {
      ...range,
      table,
      headerRows: tableHeaderRows(table),
      totalRows: tableTotalRows(table),
      showRowStripes: Boolean(table.style?.showRowStripes),
      showColumnStripes: Boolean(table.style?.showColumnStripes),
      showFirstColumn: Boolean(table.style?.showFirstColumn),
      showLastColumn: Boolean(table.style?.showLastColumn),
    };
    if (metadata.r1 > metadata.r2 || metadata.c1 > metadata.c2) continue;
    ranges.push(metadata);
    for (let row = metadata.r1; row <= metadata.r2; row += 1) {
      const rowTables = byRow.get(row);
      if (rowTables) rowTables.push(metadata);
      else byRow.set(row, [metadata]);
    }
    for (let row = metadata.r1 + 1; row <= metadata.r2; row += 1) {
      for (let col = metadata.c1; col <= metadata.c2; col += 1) {
        horizontalBoundaries.add(`${row}:${col}`);
      }
    }
  }
  return { ranges, byRow, horizontalBoundaries };
}

function resolveTableCell(tableMetadata, row, col) {
  const candidates = tableMetadata.byRow.get(row) || [];
  return candidates.find((table) => row >= table.r1 && row <= table.r2 && col >= table.c1 && col <= table.c2);
}

function tableCellAppearance(table, row, col) {
  if (!table) return null;
  const headerEnd = table.r1 + table.headerRows - 1;
  const totalStart = table.r2 - table.totalRows + 1;
  const isHeader = table.headerRows > 0 && row <= headerEnd;
  const isTotal = table.totalRows > 0 && row >= totalStart;
  const isBody = !isHeader && !isTotal;
  const bodyRow = row - table.r1 - table.headerRows;
  const bodyCol = col - table.c1;
  const rowStripe = table.showRowStripes && isBody && bodyRow % 2 === 1;
  const columnStripe = table.showColumnStripes && isBody && bodyCol % 2 === 1;
  const firstColumn = table.showFirstColumn && col === table.c1;
  const lastColumn = table.showLastColumn && col === table.c2;

  return {
    isHeader,
    isTotal,
    isBody,
    isFiltered:
      Boolean(table.table?.autoFilter) &&
      isHeader &&
      (table.table.autoFilter.ref === "" || parseRangeAddress(table.table.autoFilter.ref)),
    fillColor: isHeader
      ? "#dbeafe"
      : isTotal
        ? "#e0f2fe"
        : columnStripe
          ? "#f3f4ff"
          : rowStripe
            ? "#f8fafc"
            : null,
    fontColor: isHeader ? "#102a43" : null,
    bold: isHeader || isTotal || firstColumn || lastColumn,
  };
}

function pivotCacheFieldName(cache, fieldIndex) {
  const field = cache?.fields?.[fieldIndex];
  return field?.name || field?.caption || field?.uniqueName || null;
}

function pivotSourceRows(workbook, pivotTable) {
  const cache = findCache(workbook.pivotCaches, pivotTable.cacheId, pivotTable.cache);
  const sourceSheetName = cache?.worksheetSourceSheet || sheetNameFromFormula(cache?.worksheetSourceReference);
  const sourceSheet = sourceSheetName ? workbook.sheets.find((sheet) => sheet.name === sourceSheetName) : null;
  const sourceRange = parseRangeAddress(cache?.worksheetSourceReference);
  if (!sourceSheet || !sourceRange) return null;

  const sourceCells = buildCellMap(sourceSheet);
  const headers = [];
  for (let col = sourceRange.c1; col <= sourceRange.c2; col += 1) {
    headers.push(String(sourceCells.get(`${sourceRange.r1}:${col}`)?.value ?? ""));
  }

  const rows = [];
  for (let row = sourceRange.r1 + 1; row <= sourceRange.r2; row += 1) {
    const record = {};
    let hasValue = false;
    for (let col = sourceRange.c1; col <= sourceRange.c2; col += 1) {
      const header = headers[col - sourceRange.c1];
      if (!header) continue;
      const value = sourceCells.get(`${row}:${col}`)?.value;
      if (value != null && value !== "") hasValue = true;
      record[header] = value;
    }
    if (hasValue) rows.push(record);
  }

  return { cache, headers, rows };
}

function inferPivotValueField(source, pivotTable) {
  const cache = source?.cache;
  for (const dataField of pivotTable.dataFields || []) {
    const fieldName = pivotCacheFieldName(cache, dataField.field ?? dataField.baseField ?? dataField.fieldIndex);
    if (fieldName && source.rows.some((row) => Number.isFinite(Number(row[fieldName])))) return fieldName;
  }

  const rowFieldNames = new Set((pivotTable.rowFields || []).map((fieldIndex) => pivotCacheFieldName(cache, fieldIndex)).filter(Boolean));
  const columnFieldNames = new Set((pivotTable.columnFields || []).map((fieldIndex) => pivotCacheFieldName(cache, fieldIndex)).filter(Boolean));
  const preferred = ["Revenue", "Sales", "Amount", "Total", "Units", "Value"];
  for (const name of preferred) {
    if (source.headers.includes(name) && source.rows.some((row) => Number.isFinite(Number(row[name])))) return name;
  }
  return source.headers.find(
    (name) => !rowFieldNames.has(name) && !columnFieldNames.has(name) && source.rows.some((row) => Number.isFinite(Number(row[name]))),
  );
}

function pivotSum(sourceRows, valueField, filters) {
  let total = 0;
  for (const row of sourceRows) {
    let matches = true;
    for (const [field, expected] of Object.entries(filters)) {
      if (expected == null || expected === "") continue;
      if (String(row[field] ?? "") !== String(expected)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const value = Number(row[valueField]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

function buildPivotMetadata(workbook, sheet, cellMap) {
  const ranges = [];
  const byCell = new Map();
  const computedValues = new Map();

  for (const pivotTable of sheet.pivotTables || []) {
    const range = parseRangeAddress(pivotTable.location?.reference);
    if (!range) continue;
    const source = pivotSourceRows(workbook, pivotTable);
    const valueField = source ? inferPivotValueField(source, pivotTable) : null;
    const rowFieldNames = (pivotTable.rowFields || []).map((fieldIndex) => pivotCacheFieldName(source?.cache, fieldIndex)).filter(Boolean);
    const columnFieldName = pivotCacheFieldName(source?.cache, pivotTable.columnFields?.[0]);
    const entry = { ...range, pivotTable, source, valueField, rowFieldNames, columnFieldName };
    ranges.push(entry);

    for (let row = range.r1; row <= range.r2; row += 1) {
      for (let col = range.c1; col <= range.c2; col += 1) byCell.set(`${row}:${col}`, entry);
    }

    if (!source?.rows.length || !valueField || !rowFieldNames.length || !columnFieldName) continue;
    const headerRow = range.r1 + 1;
    const dataStartCol = range.c1 + rowFieldNames.length;
    const grandTotalCol = range.c2;
    const columnHeaders = new Map();
    for (let col = dataStartCol; col <= grandTotalCol; col += 1) {
      const text = String(cellMap.get(`${headerRow}:${col}`)?.value ?? "");
      if (text) columnHeaders.set(col, text);
    }

    let currentTopLevel = null;
    for (let row = headerRow + 1; row <= range.r2; row += 1) {
      const firstLabel = String(cellMap.get(`${row}:${range.c1}`)?.value ?? "");
      const secondLabel = String(cellMap.get(`${row}:${range.c1 + 1}`)?.value ?? "");
      const isGrandTotalRow = /^Grand Total$/i.test(firstLabel);
      const totalMatch = /^(.+?)\s+Total$/i.exec(firstLabel);
      if (firstLabel && !totalMatch && !isGrandTotalRow) currentTopLevel = firstLabel;

      const filters = {};
      if (isGrandTotalRow) {
        // Grand total rows intentionally do not filter by row fields.
      } else if (totalMatch) {
        filters[rowFieldNames[0]] = totalMatch[1];
      } else if (secondLabel) {
        filters[rowFieldNames[0]] = currentTopLevel;
        if (rowFieldNames[1]) filters[rowFieldNames[1]] = secondLabel;
      } else {
        continue;
      }

      for (const [col, header] of columnHeaders) {
        const cellAlreadyHasValue = cellMap.get(`${row}:${col}`)?.value != null && cellMap.get(`${row}:${col}`)?.value !== "";
        if (cellAlreadyHasValue) continue;
        const value =
          col === grandTotalCol || /^Grand Total$/i.test(header)
            ? pivotSum(source.rows, valueField, filters)
            : pivotSum(source.rows, valueField, { ...filters, [columnFieldName]: header });
        if (value === 0) continue;
        computedValues.set(`${row}:${col}`, { value, dataType: 5 });
      }
    }
  }

  return { ranges, byCell, computedValues };
}

function pivotCellAppearance(pivotEntry, cell, row, col) {
  if (!pivotEntry) return null;
  const headerRow = pivotEntry.r1 + 1;
  const text = String(cell?.value ?? "");
  const isTitle = row === pivotEntry.r1;
  const isHeader = row === headerRow;
  const isTotal = /(^Grand Total$|\sTotal$)/i.test(text);
  const isGroup = col === pivotEntry.c1 && text && !isTotal && row > headerRow;
  return {
    fillColor: isTitle || isHeader || text === "Grand Total" ? "#dbeafe" : isTotal ? "#eff6ff" : null,
    fontColor: isTitle || isHeader ? "#111827" : null,
    bold: isTitle || isHeader || isTotal || isGroup,
    borderColor: isHeader || isTotal || isGroup ? "#93c5fd" : "#e5e7eb",
  };
}

function sheetNameFromFormula(formula) {
  const text = formula == null ? "" : String(formula).trim().replace(/^=/, "");
  const bang = text.lastIndexOf("!");
  if (bang < 0) return null;
  return text.slice(0, bang).replace(/^'/, "").replace(/'$/, "");
}

function valuesFromFormulaRange(workbook, currentSheet, formula) {
  const range = parseRangeAddress(formula);
  if (!range) return [];
  const sheetName = sheetNameFromFormula(formula);
  const targetSheet = sheetName ? workbook.sheets.find((sheet) => sheet.name === sheetName) : currentSheet;
  if (!targetSheet) return [];
  const cellMap = buildCellMap(targetSheet);
  const values = [];
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      const value = cellMap.get(`${row}:${col}`)?.value;
      if (value != null && value !== "") values.push(String(value));
    }
  }
  return values;
}

function buildValidationMetadata(workbook, sheet) {
  const entries = [];
  const byCell = new Map();
  for (const validation of sheet.dataValidations?.items || []) {
    if (validation.type !== 4 || !validation.sqref) continue;
    const ranges = parseSqref(validation.sqref);
    if (ranges.length === 0) continue;
    const options = parseValidationOptions(validation.formula1);
    if (options.length === 0) options.push(...valuesFromFormulaRange(workbook, sheet, validation.formula1));
    const entry = { validation, ranges, options };
    entries.push(entry);
    for (const range of ranges) {
      for (let row = range.r1; row <= Math.min(range.r2, 1000); row += 1) {
        for (let col = range.c1; col <= Math.min(range.c2, 100); col += 1) {
          byCell.set(`${row}:${col}`, entry);
        }
      }
    }
  }
  return { entries, byCell };
}

function targetSheetMatches(sheet, target) {
  if (!target) return false;
  if (target.sheetId && sheet.sheetId && String(target.sheetId) === String(sheet.sheetId)) return true;
  if (target.sheetName && sheet.name && target.sheetName === sheet.name) return true;
  return !target.sheetId && !target.sheetName;
}

function annotationAddress(sheet, target) {
  if (!target) return null;
  if (target.cell && targetSheetMatches(sheet, target.cell)) return parseA1(target.cell.address);
  if (target.range && targetSheetMatches(sheet, target.range)) return parseA1(target.range.startAddress);
  return null;
}

function buildAnnotationMetadata(workbook, sheet) {
  const people = new Map((workbook.people || []).map((person) => [person.id, person]));
  const byCell = new Map();
  const add = (parsed, annotation) => {
    if (!parsed) return;
    const key = `${parsed.row}:${parsed.col}`;
    const current = byCell.get(key);
    if (current) current.push(annotation);
    else byCell.set(key, [annotation]);
  };
  for (const note of workbook.notes || []) {
    add(annotationAddress(sheet, note.target), {
      kind: "note",
      author: people.get(note.authorId)?.displayName || note.authorId || "Note",
      text: note.body?.plainText || "",
    });
  }
  for (const thread of workbook.threads || []) {
    if (thread.resolved) continue;
    const comments = (thread.comments || []).filter((comment) => !comment.isDeleted);
    if (!comments.length) continue;
    const first = comments[0];
    add(annotationAddress(sheet, thread.target), {
      kind: "thread",
      count: comments.length,
      author: people.get(first.authorId)?.displayName || first.authorId || "Comment",
      text: first.body?.plainText || "",
    });
  }
  return { byCell };
}

function parseValidationOptions(formula) {
  const text = formula == null ? "" : String(formula).trim();
  if (!text) return [];
  const withoutEquals = text.startsWith("=") ? text.slice(1).trim() : text;
  if (withoutEquals.startsWith('"') && withoutEquals.endsWith('"')) {
    return withoutEquals
      .slice(1, -1)
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }
  return [];
}

function numericValue(cell) {
  const value = Number(cell?.value);
  return Number.isFinite(value) ? value : null;
}

function collectRangeNumbers(cellMap, range) {
  const values = [];
  for (let row = range.r1; row <= Math.min(range.r2, 1000); row += 1) {
    for (let col = range.c1; col <= Math.min(range.c2, 100); col += 1) {
      const value = numericValue(cellMap.get(`${row}:${col}`));
      if (value != null) values.push(value);
    }
  }
  return values;
}

function buildConditionalFormattingMetadata(workbook, sheet, cellMap) {
  const entries = [];
  const byCell = new Map();
  for (const formatting of sheet.conditionalFormattings || []) {
    for (const rangeTarget of formatting.ranges || []) {
      const range = parseRangeAddress(rangeTarget);
      if (!range) continue;
      const rangeValues = collectRangeNumbers(cellMap, range);
      const min = rangeValues.length ? Math.min(...rangeValues) : 0;
      const max = rangeValues.length ? Math.max(...rangeValues) : 0;
      for (const rule of formatting.rules || []) {
        const dxf = rule.dxfId == null ? null : workbook.styles?.dxfs?.[rule.dxfId];
        const fillColor = resolveFillColor(dxf?.fill);
        const fontColor = resolveFillColor(dxf?.font?.fill);
        const entry = { range, rule, dxf, fillColor, fontColor, min, max };
        entries.push(entry);
        for (let row = range.r1; row <= Math.min(range.r2, 1000); row += 1) {
          for (let col = range.c1; col <= Math.min(range.c2, 100); col += 1) {
            const key = `${row}:${col}`;
            const current = byCell.get(key);
            if (current) current.push(entry);
            else byCell.set(key, [entry]);
          }
        }
      }
    }
  }
  return { entries, byCell };
}

function compareConditionalValue(value, operator, formulas) {
  const target = Number(value);
  if (!Number.isFinite(target)) return false;
  const first = Number(formulas?.[0]);
  const second = Number(formulas?.[1]);
  switch (operator) {
    case "greaterThan":
      return Number.isFinite(first) && target > first;
    case "greaterThanOrEqual":
      return Number.isFinite(first) && target >= first;
    case "lessThan":
      return Number.isFinite(first) && target < first;
    case "lessThanOrEqual":
      return Number.isFinite(first) && target <= first;
    case "equal":
      return Number.isFinite(first) && target === first;
    case "notEqual":
      return Number.isFinite(first) && target !== first;
    case "between":
      return Number.isFinite(first) && Number.isFinite(second) && target >= first && target <= second;
    case "notBetween":
      return Number.isFinite(first) && Number.isFinite(second) && (target < first || target > second);
    default:
      return false;
  }
}

function resolveConditionalStyle(layout, cell, row, col) {
  const entries = layout.conditionalFormattingMetadata.byCell.get(`${row}:${col}`) || [];
  for (const entry of entries) {
    const rule = entry.rule;
    if (rule.type === "cellIs" && compareConditionalValue(cell?.value, rule.operator, rule.formula)) return entry;
    if (rule.type === "containsText" && rule.text && String(cell?.value ?? "").includes(rule.text)) return entry;
    if (rule.colorScale) {
      const value = numericValue(cell);
      if (value == null) continue;
      const colors = rule.colorScale.colors.map((color) => resolveColor(color)).filter(Boolean);
      if (colors.length >= 2) {
        const ratio = entry.max === entry.min ? 0 : (value - entry.min) / (entry.max - entry.min);
        return { ...entry, fillColor: mixColors(colors[0], colors[colors.length - 1], ratio) };
      }
    }
  }
  return null;
}

function activeConditionalVisuals(layout, cell, row, col) {
  const entries = layout.conditionalFormattingMetadata.byCell.get(`${row}:${col}`) || [];
  return entries.filter((entry) => entry.rule.dataBar || entry.rule.iconSet);
}

function sumSpan(sizes, start, end) {
  let total = 0;
  for (let index = start; index <= end; index += 1) total += sizes[index] ?? 0;
  return total;
}

function normalizeHorizontalAlignment(value, cell) {
  if (value === "center" || value === "right" || value === "left") return value;
  if (value === "distributed" || value === "justify" || value === "fill") return "left";
  return isNumericCell(cell) ? "right" : "left";
}

function textBaselineY(y, height, fontSize, verticalAlignment) {
  if (verticalAlignment === "top") return y + Math.max(fontSize, 12);
  if (verticalAlignment === "bottom") return y + height - 4;
  return y + height / 2 + Math.max(1, Math.round(fontSize * 0.08));
}

function zoomedFontSize(fontSize, zoom, min = 8) {
  return Math.max(min, Math.round(fontSize * zoom));
}

function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = String(text).split(/\r?\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const char of word) {
        const next = `${chunk}${char}`;
        if (chunk && ctx.measureText(next).width > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = next;
        }
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function wrappedTextStartY(y, height, lineHeight, lineCount, verticalAlignment) {
  const totalHeight = lineHeight * lineCount;
  if (verticalAlignment === "top") return y + 3 + lineHeight / 2;
  if (verticalAlignment === "bottom") return y + height - 3 - totalHeight + lineHeight / 2;
  return y + height / 2 - totalHeight / 2 + lineHeight / 2;
}

function shouldUnderline(value) {
  return Boolean(value && value !== "none");
}

function drawTextLine(ctx, text, x, y, fontSize, underline) {
  ctx.fillText(text, x, y);
  if (!shouldUnderline(underline) || !text) return;
  const width = ctx.measureText(text).width;
  const startX = ctx.textAlign === "center" ? x - width / 2 : ctx.textAlign === "right" || ctx.textAlign === "end" ? x - width : x;
  const underlineY = y + Math.max(2, Math.round(fontSize * 0.38));
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1, Math.round(fontSize / 16));
  ctx.beginPath();
  ctx.moveTo(startX, underlineY);
  ctx.lineTo(startX + width, underlineY);
  ctx.stroke();
  ctx.restore();
}

function canvasFont(style, fontSize, forceBold = false) {
  return `${style.italic ? "italic " : ""}${style.bold || forceBold ? "600 " : ""}${fontSize}px ${style.fontFamily}, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function styleFromTextStyle(baseStyle, textStyle) {
  if (!textStyle) return baseStyle;
  return {
    ...baseStyle,
    bold: textStyle.bold ?? baseStyle.bold,
    italic: textStyle.italic ?? baseStyle.italic,
    underline: textStyle.underline ?? baseStyle.underline,
    fontColor: resolveFillColor(textStyle.fill) || baseStyle.fontColor,
    fontSize: textStyle.fontSize ? Math.max(10, Math.round(textStyle.fontSize * (96 / 72))) : baseStyle.fontSize,
    fontFamily: textStyle.typeface || textStyle.name || baseStyle.fontFamily,
  };
}

function richTextRuns(cell, baseStyle) {
  if (!cell?.paragraphs?.length) return [];
  const cellStyle = styleFromTextStyle(baseStyle, cell.textStyle);
  const runs = [];
  cell.paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0) runs.push({ text: "\n", style: cellStyle });
    const paragraphStyle = styleFromTextStyle(cellStyle, paragraph.textStyle);
    for (const run of paragraph.runs || []) {
      if (!run.text) continue;
      runs.push({ text: run.text, style: styleFromTextStyle(paragraphStyle, run.textStyle) });
    }
  });
  return runs;
}

function measureRichRuns(ctx, runs) {
  let width = 0;
  let lineWidth = 0;
  for (const run of runs) {
    const parts = String(run.text).split(/(\r?\n)/);
    for (const part of parts) {
      if (!part) continue;
      if (/\r?\n/.test(part)) {
        width = Math.max(width, lineWidth);
        lineWidth = 0;
        continue;
      }
      ctx.font = canvasFont(run.style, run.style.fontSize);
      lineWidth += ctx.measureText(part).width;
    }
  }
  return Math.max(width, lineWidth);
}

function splitRichRun(run) {
  return String(run.text)
    .split(/(\r?\n|\s+)/)
    .filter((part) => part.length > 0)
    .map((text) => ({ text, style: run.style }));
}

function wrapRichRuns(ctx, runs, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;
  const pushLine = () => {
    lines.push(line);
    line = [];
    width = 0;
  };
  for (const run of runs) {
    for (const segment of splitRichRun(run)) {
      if (/\r?\n/.test(segment.text)) {
        pushLine();
        continue;
      }
      const isSpace = /^\s+$/.test(segment.text);
      ctx.font = canvasFont(segment.style, segment.style.fontSize);
      const segmentWidth = ctx.measureText(segment.text).width;
      if (!isSpace && line.length && width + segmentWidth > maxWidth) pushLine();
      if (isSpace && line.length === 0) continue;
      line.push(segment);
      width += segmentWidth;
    }
  }
  if (line.length || lines.length === 0) lines.push(line);
  return lines;
}

function drawRichLine(ctx, segments, x, y, textAlign) {
  const lineWidth = segments.reduce((sum, segment) => {
    ctx.font = canvasFont(segment.style, segment.style.fontSize);
    return sum + ctx.measureText(segment.text).width;
  }, 0);
  let cursorX = textAlign === "center" ? x - lineWidth / 2 : textAlign === "right" ? x - lineWidth : x;
  for (const segment of segments) {
    ctx.font = canvasFont(segment.style, segment.style.fontSize);
    ctx.fillStyle = segment.style.fontColor;
    ctx.textAlign = "left";
    drawTextLine(ctx, segment.text, cursorX, y, segment.style.fontSize, segment.style.underline);
    cursorX += ctx.measureText(segment.text).width;
  }
}

function cellBlocksTextOverflow(layout, row, col) {
  if (layout.mergeMaps.covered.has(`${row}:${col}`)) return true;
  const mergeRange = layout.mergeMaps.anchors.get(`${row}:${col}`);
  if (mergeRange && (mergeRange.r1 !== row || mergeRange.r2 !== row || mergeRange.c1 !== col || mergeRange.c2 !== col)) return true;
  const cell = layout.cellMap.get(`${row}:${col}`);
  return cell?.value != null && cell.value !== "";
}

function textOverflowWidth(ctx, layout, row, col, text, baseWidth, leftInset, rightInset) {
  return textOverflowWidthForMeasured(layout, row, col, ctx.measureText(String(text)).width, baseWidth, leftInset, rightInset);
}

function textOverflowWidthForMeasured(layout, row, col, measuredWidth, baseWidth, leftInset, rightInset) {
  const desired = measuredWidth + leftInset + rightInset;
  if (desired <= baseWidth) return baseWidth;
  let width = baseWidth;
  for (let nextCol = col + 1; nextCol <= layout.maxCol && width < desired; nextCol += 1) {
    if (cellBlocksTextOverflow(layout, row, nextCol)) break;
    width += layout.columnWidths[nextCol] ?? 0;
  }
  return width;
}

function drawBorder(ctx, x, y, width, height, border) {
  if (!border) return;
  ctx.save();
  ctx.strokeStyle = resolveColor(border.bottom?.color, "#c8c8bd") || "#c8c8bd";
  ctx.lineWidth = border.bottom?.style ? 1.5 : 1;
  if (border.top?.style) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
  }
  if (border.right?.style) {
    ctx.beginPath();
    ctx.moveTo(x + width, y);
    ctx.lineTo(x + width, y + height);
    ctx.stroke();
  }
  if (border.bottom?.style) {
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x + width, y + height);
    ctx.stroke();
  }
  if (border.left?.style) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDropdownIndicator(ctx, x, y, width, height) {
  const size = Math.min(14, Math.max(9, height - 8));
  const buttonX = x + width - size - 3;
  const buttonY = y + Math.max(3, (height - size) / 2);
  ctx.save();
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(buttonX, buttonY, size, size, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#475569";
  ctx.beginPath();
  ctx.moveTo(buttonX + size * 0.3, buttonY + size * 0.42);
  ctx.lineTo(buttonX + size * 0.7, buttonY + size * 0.42);
  ctx.lineTo(buttonX + size * 0.5, buttonY + size * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFilterIndicator(ctx, x, y, width, height) {
  const size = Math.min(13, Math.max(8, height - 10));
  const cx = x + width - size / 2 - 6;
  const cy = y + height / 2;
  ctx.save();
  ctx.fillStyle = "#1e3a8a";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.35, cy - size * 0.2);
  ctx.lineTo(cx + size * 0.35, cy - size * 0.2);
  ctx.lineTo(cx, cy + size * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAnnotationIndicator(ctx, x, y, width, annotations) {
  if (!annotations?.length) return;
  const color = annotations.some((annotation) => annotation.kind === "thread") ? "#f97316" : "#facc15";
  const size = Math.min(10, Math.max(7, width * 0.18));
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width - size, y);
  ctx.lineTo(x + width, y + size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawConditionalVisuals(ctx, layout, cell, row, col, x, y, width, height) {
  const visuals = activeConditionalVisuals(layout, cell, row, col);
  if (!visuals.length) return;
  const value = numericValue(cell);
  if (value == null) return;
  for (const entry of visuals) {
    const rule = entry.rule;
    if (rule.dataBar) {
      const span = entry.max - entry.min || 1;
      const ratio = Math.max(0, Math.min(1, (value - Math.min(0, entry.min)) / (Math.max(entry.max, 0) - Math.min(0, entry.min) || span)));
      const barWidth = Math.max(0, (width - 10) * ratio);
      const barHeight = Math.max(4, height * 0.48);
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = resolveColor(rule.dataBar.color, "#60a5fa") || "#60a5fa";
      ctx.fillRect(x + 5, y + (height - barHeight) / 2, barWidth, barHeight);
      if (rule.dataBar.border) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = resolveColor(rule.dataBar.borderColor, "#2563eb") || "#2563eb";
        ctx.strokeRect(x + 5, y + (height - barHeight) / 2, Math.max(1, barWidth), barHeight);
      }
      ctx.restore();
    }
    if (rule.iconSet) {
      ctx.save();
      const mid = entry.min + (entry.max - entry.min) / 2;
      ctx.fillStyle = value >= mid ? "#16a34a" : "#f59e0b";
      ctx.beginPath();
      ctx.arc(x + 12, y + height / 2, Math.min(5, height / 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawSparklines(ctx, sheet, layout) {
  for (const group of sheet.sparklineGroups?.groups || []) {
    const color = resolveColor(group.seriesColor, "#2563eb") || "#2563eb";
    for (const sparkline of group.sparklines || []) {
      const target = parseRangeAddress(sparkline.reference);
      if (!target) continue;
      const x = layout.rowHeaderWidth + layout.columnOffsets[target.c1] - layout.scrollLeft;
      const y = layout.colHeaderHeight + layout.rowOffsets[target.r1] - layout.scrollTop;
      const width = sumSpan(layout.columnWidths, target.c1, target.c2);
      const height = sumSpan(layout.rowHeights, target.r1, target.r2);
      if (width <= 8 || height <= 8) continue;
      if (x + width < layout.rowHeaderWidth || y + height < layout.colHeaderHeight || x > layout.viewportWidth || y > layout.viewportHeight) continue;
      const values = formulaRangeValues(layout, sparkline.formula || group.formula);
      if (!values.length) continue;
      const min = group.manualMin ?? Math.min(...values, 0);
      const max = group.manualMax ?? Math.max(...values, 1);
      const span = max - min || 1;
      const pad = 4;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, width - 4, height - 4);
      ctx.clip();
      if (group.displayXAxis) {
        const zeroY = y + height - pad - ((0 - min) / span) * (height - pad * 2);
        ctx.strokeStyle = resolveColor(group.axisColor, "#cbd5e1") || "#cbd5e1";
        ctx.beginPath();
        ctx.moveTo(x + pad, zeroY);
        ctx.lineTo(x + width - pad, zeroY);
        ctx.stroke();
      }
      if (group.type === 2 || group.type === 3) {
        const barWidth = Math.max(2, (width - pad * 2) / values.length - 2);
        values.forEach((value, index) => {
          const ratio = (value - min) / span;
          const barHeight = Math.max(1, Math.abs(ratio) * (height - pad * 2));
          const bx = x + pad + index * ((width - pad * 2) / values.length);
          const by = y + height - pad - barHeight;
          ctx.fillStyle = value < 0 ? resolveColor(group.negativeColor, "#dc2626") || "#dc2626" : color;
          ctx.fillRect(bx, by, barWidth, barHeight);
        });
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, group.lineWeight || 1.5);
        ctx.beginPath();
        values.forEach((value, index) => {
          const px = x + pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
          const py = y + height - pad - ((value - min) / span) * (height - pad * 2);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function objectBounds(layout, object, fallbackWidth, fallbackHeight) {
  const from = anchorPoint(layout, object.fromAnchor);
  if (!from) return null;
  const to = anchorPoint(layout, object.toAnchor);
  const width = to ? to.x - from.x : (object.width || fallbackWidth) * layout.zoom;
  const height = to ? to.y - from.y : (object.height || fallbackHeight) * layout.zoom;
  if (width <= 0 || height <= 0) return null;
  return { x: from.x, y: from.y, width, height };
}

function findCache(caches, id, name) {
  return (caches || []).find((cache) => (id != null && cache.id === id) || (id != null && cache.cacheId === id) || (name && cache.name === name));
}

function tableColumnValues(sheet, tableName, columnName, tableId) {
  if (!columnName) return [];
  const tables = tableName
    ? (sheet.tables || []).filter((table) => table.name === tableName || table.displayName === tableName)
    : tableId != null
      ? (sheet.tables || []).filter((table) => table.id === tableId)
      : sheet.tables || [];
  const cellMap = buildCellMap(sheet);
  for (const table of tables) {
    const range = parseRangeAddress(table.ref);
    if (!range) continue;
    let sourceCol = null;
    const tableColumnIndex = (table.columns || []).findIndex(
      (column) => String(column.id) === String(columnName) || column.name === columnName,
    );
    if (tableColumnIndex >= 0) sourceCol = range.c1 + tableColumnIndex;
    for (let col = range.c1; col <= range.c2; col += 1) {
      if (sourceCol) break;
      const header = String(cellMap.get(`${range.r1}:${col}`)?.value ?? "");
      if (header === columnName) {
        sourceCol = col;
        break;
      }
    }
    if (!sourceCol) continue;
    const values = [];
    const seen = new Set();
    for (let row = range.r1 + 1; row <= range.r2; row += 1) {
      const value = cellMap.get(`${row}:${sourceCol}`)?.value;
      const text = value == null ? "" : String(value);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      values.push(text);
    }
    if (values.length) return values;
  }
  return [];
}

function pivotCacheColumnValues(workbook, cache, columnName) {
  if (!columnName) return [];
  const pivotCache = findCache(workbook.pivotCaches, cache?.pivotCacheId);
  const field = pivotCache?.fields?.find((candidate) => candidate.name === columnName || candidate.caption === columnName);
  return (field?.sharedItems || []).map((item) => String(item.value ?? item.text ?? item)).filter(Boolean);
}

function slicerItems(sheet, layout, cache) {
  const decodedItems = (cache?.items || []).filter((item) => !item.hidden && item.value);
  if (decodedItems.length) return decodedItems;
  const columnName = cache?.columnName || cache?.sourceName || cache?.caption;
  const values = tableColumnValues(sheet, cache?.tableName, columnName, cache?.tableId);
  const sourceValues = values.length || columnName === cache?.sourceName ? values : tableColumnValues(sheet, cache?.tableName, cache?.sourceName, cache?.tableId);
  const fallbackValues = sourceValues.length ? sourceValues : pivotCacheColumnValues(layout.workbook, cache, cache?.sourceName || columnName);
  return fallbackValues.map((value, index) => ({ index, value, selected: true, hasData: true }));
}

function drawSlicerWidgets(ctx, sheet, layout) {
  for (const slicer of sheet.slicers || []) {
    const bounds = objectBounds(layout, slicer, 170, 150);
    if (!bounds) continue;
    if (bounds.x + bounds.width < layout.rowHeaderWidth || bounds.y + bounds.height < layout.colHeaderHeight) continue;
    if (bounds.x > layout.viewportWidth || bounds.y > layout.viewportHeight) continue;
    const cache = findCache(layout.workbook.slicerCaches, slicer.cacheId, slicer.cache);
    const items = slicerItems(sheet, layout, cache).slice(0, 8);
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillStyle = "#e0f2fe";
    ctx.fillRect(bounds.x, bounds.y, bounds.width, Math.min(30, bounds.height));
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(slicer.caption || cache?.caption || cache?.columnName || slicer.name || "Slicer", bounds.x + 9, bounds.y + 15);
    items.forEach((item, index) => {
      const iy = bounds.y + 36 + index * 20;
      if (iy > bounds.y + bounds.height - 10) return;
      ctx.fillStyle = item.selected === false || item.hasData === false ? "#f1f5f9" : "#bfdbfe";
      ctx.fillRect(bounds.x + 8, iy, bounds.width - 16, 16);
      ctx.fillStyle = "#0f172a";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(item.value || `(item ${item.index ?? index + 1})`, bounds.x + 14, iy + 8);
    });
    ctx.restore();
  }
}

function drawTimelineWidgets(ctx, sheet, layout) {
  for (const timeline of sheet.timelines || []) {
    const bounds = objectBounds(layout, timeline, 260, 92);
    if (!bounds) continue;
    const cache = findCache(layout.workbook.timelineCaches, timeline.cacheId, timeline.cache);
    const items = (cache?.items || []).slice(0, 10);
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#94a3b8";
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillStyle = "#ecfeff";
    ctx.fillRect(bounds.x, bounds.y, bounds.width, 28);
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(timeline.caption || cache?.caption || cache?.columnName || timeline.name || "Timeline", bounds.x + 10, bounds.y + 14);
    const trackX = bounds.x + 14;
    const trackY = bounds.y + bounds.height - 34;
    const trackWidth = bounds.width - 28;
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackWidth, trackY);
    ctx.stroke();
    items.forEach((item, index) => {
      const px = trackX + (index / Math.max(1, items.length - 1)) * trackWidth;
      ctx.fillStyle = item.selected === false ? "#cbd5e1" : "#0284c7";
      ctx.beginPath();
      ctx.arc(px, trackY, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
}

function drawPivotOutlines(ctx, sheet, layout) {
  for (const pivotTable of sheet.pivotTables || []) {
    const range = parseRangeAddress(pivotTable.location?.reference);
    if (!range) continue;
    const x = layout.rowHeaderWidth + layout.columnOffsets[range.c1] - layout.scrollLeft;
    const y = layout.colHeaderHeight + layout.rowOffsets[range.r1] - layout.scrollTop;
    const width = sumSpan(layout.columnWidths, range.c1, range.c2);
    const height = sumSpan(layout.rowHeights, range.r1, range.r2);
    if (width <= 0 || height <= 0) continue;
    ctx.save();
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ccfbf1";
    ctx.fillRect(x + 2, y + 2, Math.min(width - 4, 130), 20);
    ctx.fillStyle = "#134e4a";
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(pivotTable.name || "PivotTable", x + 8, y + 12);
    ctx.restore();
  }
}

function drawDrawingImages(ctx, sheet, layout, imageCache) {
  if (!imageCache || !sheet.drawings?.length) return;
  for (const drawing of sheet.drawings) {
    const imageId = drawing.imageReference?.id;
    if (!imageId) continue;
    const entry = imageCache.get(imageId);
    const from = anchorPoint(layout, drawing.fromAnchor);
    if (!from) continue;
    const to = anchorPoint(layout, drawing.toAnchor);
    const width = to
      ? to.x - from.x
      : drawing.extentCx
        ? emuToPx(drawing.extentCx) * layout.zoom
        : (entry?.image?.naturalWidth || 120) * layout.zoom;
    const height = to
      ? to.y - from.y
      : drawing.extentCy
        ? emuToPx(drawing.extentCy) * layout.zoom
        : (entry?.image?.naturalHeight || 80) * layout.zoom;
    if (width <= 0 || height <= 0) continue;
    if (from.x + width < layout.rowHeaderWidth || from.y + height < layout.colHeaderHeight) continue;
    if (from.x > layout.viewportWidth || from.y > layout.viewportHeight) continue;

    if (entry?.loaded) {
      ctx.drawImage(entry.image, from.x, from.y, width, height);
      continue;
    }

    ctx.save();
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#94a3b8";
    ctx.setLineDash([4, 3]);
    ctx.fillRect(from.x, from.y, width, height);
    ctx.strokeRect(from.x, from.y, width, height);
    ctx.fillStyle = "#64748b";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Image", from.x + width / 2, from.y + height / 2);
    ctx.restore();
  }
}

const chartPalette = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

function chartBounds(layout, drawing) {
  const from = anchorPoint(layout, drawing.fromAnchor);
  if (!from) return null;
  const to = anchorPoint(layout, drawing.toAnchor);
  const width = to ? to.x - from.x : drawing.extentCx ? emuToPx(drawing.extentCx) * layout.zoom : 320 * layout.zoom;
  const height = to ? to.y - from.y : drawing.extentCy ? emuToPx(drawing.extentCy) * layout.zoom : 200 * layout.zoom;
  if (width <= 0 || height <= 0) return null;
  return { x: from.x, y: from.y, width, height };
}

function formulaRangeValues(layout, formula, options = {}) {
  const range = parseRangeAddress(formula);
  if (!range) return [];
  const values = [];
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      const cell = layout.cellMap.get(`${row}:${col}`);
      const raw = cell?.value;
      if (options.text) {
        if (raw != null && raw !== "") values.push(String(raw));
      } else {
        const value = Number(raw);
        if (Number.isFinite(value)) values.push(value);
      }
    }
  }
  return values;
}

function chartSeriesValues(chart, layout) {
  return (chart.series || []).map((series) => ({
    ...series,
    values:
      series.values?.length > 0
        ? series.values.filter((value) => Number.isFinite(value))
        : formulaRangeValues(layout, series.formula),
    categories:
      series.categories?.length > 0
        ? series.categories
        : chart.categories?.length > 0
          ? chart.categories
          : formulaRangeValues(layout, series.categoryFormula, { text: true }),
  }));
}

function compactChartNumber(value, options = {}) {
  const abs = Math.abs(value);
  const suffix = abs >= 1_000_000 ? "M" : abs >= 1_000 ? "k" : "";
  const divisor = suffix === "M" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  const scaled = value / divisor;
  const digits = Math.abs(scaled) >= 10 || Number.isInteger(scaled) ? 0 : 1;
  const text = `${scaled.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
  return options.currency ? `$${text}` : text;
}

function chartCategoryLabels(seriesList) {
  const categories = seriesList.find((series) => series.categories?.length)?.categories || [];
  return categories.map((category) => String(category));
}

function drawChartYAxis(ctx, plot, minValue, maxValue, options = {}) {
  const tickCount = 4;
  const span = maxValue - minValue || 1;
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const ratio = tick / tickCount;
    const value = minValue + span * (1 - ratio);
    const y = plot.y + plot.height * ratio;
    ctx.strokeStyle = tick === tickCount ? "#94a3b8" : "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillStyle = "#475569";
    ctx.fillText(compactChartNumber(value, options), plot.x - 6, y);
  }
  ctx.restore();
}

function drawChartCategories(ctx, plot, labels) {
  if (!labels.length) return;
  const step = Math.max(1, Math.ceil(labels.length / Math.max(3, Math.floor(plot.width / 54))));
  ctx.save();
  ctx.fillStyle = "#475569";
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  labels.forEach((label, index) => {
    if (index % step !== 0 && index !== labels.length - 1) return;
    const x = plot.x + ((index + 0.5) / labels.length) * plot.width;
    const clipped = label.length > 10 ? `${label.slice(0, 9)}...` : label;
    ctx.fillText(clipped, x, plot.y + plot.height + 6);
  });
  ctx.restore();
}

function drawChartLegend(ctx, bounds, seriesList) {
  if (seriesList.length <= 1) return;
  const legendY = bounds.y + bounds.height - 16;
  let x = bounds.x + 12;
  ctx.save();
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  seriesList.slice(0, 4).forEach((series, index) => {
    const label = series.name || `Series ${index + 1}`;
    ctx.fillStyle = chartPalette[index % chartPalette.length];
    ctx.fillRect(x, legendY - 4, 8, 8);
    ctx.fillStyle = "#475569";
    ctx.fillText(label, x + 12, legendY);
    x += Math.min(120, 18 + ctx.measureText(label).width);
  });
  ctx.restore();
}

function drawChartFrame(ctx, chart, bounds) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(chart.title || "Chart", bounds.x + bounds.width / 2, bounds.y + 8);
  ctx.restore();
}

function drawBarChart(ctx, chart, bounds, layout) {
  const seriesList = chartSeriesValues(chart, layout).filter((series) => series.values.length);
  if (!seriesList.length) return;
  const allValues = seriesList.flatMap((series) => series.values);
  const maxValue = Math.max(1, ...allValues);
  const labels = chartCategoryLabels(seriesList);
  const plot = {
    x: bounds.x + 56,
    y: bounds.y + 34,
    width: Math.max(10, bounds.width - 74),
    height: Math.max(10, bounds.height - 78),
  };
  const count = Math.max(...seriesList.map((series) => series.values.length));
  const groupWidth = plot.width / Math.max(1, count);
  const barWidth = Math.max(3, (groupWidth * 0.72) / seriesList.length);

  ctx.save();
  drawChartYAxis(ctx, plot, 0, maxValue, { currency: /revenue|sales|amount/i.test(chart.title || "") });
  drawChartCategories(ctx, plot, labels);
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.stroke();

  seriesList.forEach((series, seriesIndex) => {
    ctx.fillStyle = chartPalette[seriesIndex % chartPalette.length];
    series.values.forEach((value, index) => {
      const height = (Math.max(0, value) / maxValue) * plot.height;
      const x = plot.x + index * groupWidth + groupWidth * 0.14 + seriesIndex * barWidth;
      const y = plot.y + plot.height - height;
      ctx.fillRect(x, y, barWidth, height);
    });
  });
  drawChartLegend(ctx, bounds, seriesList);
  ctx.restore();
}

function drawLineChart(ctx, chart, bounds, layout) {
  const seriesList = chartSeriesValues(chart, layout).filter((series) => series.values.length);
  if (!seriesList.length) return;
  const allValues = seriesList.flatMap((series) => series.values);
  const minValue = Math.min(0, ...allValues);
  const maxValue = Math.max(1, ...allValues);
  const span = maxValue - minValue || 1;
  const labels = chartCategoryLabels(seriesList);
  const plot = {
    x: bounds.x + 56,
    y: bounds.y + 34,
    width: Math.max(10, bounds.width - 74),
    height: Math.max(10, bounds.height - 78),
  };

  ctx.save();
  drawChartYAxis(ctx, plot, minValue, maxValue, { currency: /revenue|sales|amount/i.test(chart.title || "") });
  drawChartCategories(ctx, plot, labels);
  ctx.strokeStyle = "#94a3b8";
  ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  seriesList.forEach((series, seriesIndex) => {
    ctx.strokeStyle = chartPalette[seriesIndex % chartPalette.length];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.values.forEach((value, index) => {
      const x = plot.x + (index / Math.max(1, series.values.length - 1)) * plot.width;
      const y = plot.y + plot.height - ((value - minValue) / span) * plot.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  drawChartLegend(ctx, bounds, seriesList);
  ctx.restore();
}

function drawPieChart(ctx, chart, bounds, layout) {
  const series = chartSeriesValues(chart, layout).find((series) => series.values.length);
  if (!series) return;
  const total = series.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2 + 8;
  const radius = Math.max(8, Math.min(bounds.width, bounds.height) * 0.28);
  let start = -Math.PI / 2;
  ctx.save();
  series.values.forEach((value, index) => {
    const angle = (Math.max(0, value) / total) * Math.PI * 2;
    ctx.fillStyle = chartPalette[index % chartPalette.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fill();
    start += angle;
  });
  ctx.restore();
}

function drawDrawingCharts(ctx, sheet, layout) {
  if (!sheet.drawings?.length) return;
  for (const drawing of sheet.drawings) {
    const chart = drawing.chart;
    if (!chart) continue;
    const bounds = chartBounds(layout, drawing);
    if (!bounds) continue;
    if (bounds.x + bounds.width < layout.rowHeaderWidth || bounds.y + bounds.height < layout.colHeaderHeight) continue;
    if (bounds.x > layout.viewportWidth || bounds.y > layout.viewportHeight) continue;
    drawChartFrame(ctx, chart, bounds);
    if (chart.type === 16 || chart.type === 8 || chart.type === 15) drawPieChart(ctx, chart, bounds, layout);
    else if (chart.type === 13 || chart.type === 12 || chart.type === 18) drawLineChart(ctx, chart, bounds, layout);
    else drawBarChart(ctx, chart, bounds, layout);
  }
}

function elementText(element) {
  return (element?.paragraphs || [])
    .map((paragraph) => (paragraph.runs || []).map((run) => run.text).join(""))
    .filter(Boolean)
    .join("\n");
}

function shapePath(ctx, geometry, bounds) {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.beginPath();
  switch (geometry) {
    case 1:
    case 2:
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width, y + height / 2);
      return;
    case 3:
    case 4:
      ctx.moveTo(cx, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return;
    case 6:
      ctx.moveTo(cx, y);
      ctx.lineTo(x + width, cy);
      ctx.lineTo(cx, y + height);
      ctx.lineTo(x, cy);
      ctx.closePath();
      return;
    case 35:
      ctx.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2);
      return;
    case 26:
      ctx.roundRect(x, y, width, height, Math.min(14, width / 5, height / 5));
      return;
    default:
      ctx.rect(x, y, width, height);
  }
}

function drawDrawingShapes(ctx, sheet, layout) {
  if (!sheet.drawings?.length) return;
  for (const drawing of sheet.drawings) {
    const element = drawing.shape;
    if (!element) continue;
    const bounds = chartBounds(layout, drawing);
    if (!bounds) continue;
    if (bounds.x + bounds.width < layout.rowHeaderWidth || bounds.y + bounds.height < layout.colHeaderHeight) continue;
    if (bounds.x > layout.viewportWidth || bounds.y > layout.viewportHeight) continue;
    const shape = element.shape || {};
    const fill = shape.fill || element.fill;
    const line = shape.line || element.line;
    const fillColor = resolveFillColor(fill) || "rgba(241, 245, 249, 0.92)";
    const lineColor = resolveFillColor(line?.fill) || "#64748b";

    ctx.save();
    shapePath(ctx, shape.geometry, bounds);
    if (shape.geometry !== 1 && shape.geometry !== 2) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = Math.max(1, emuToPx(line?.widthEmu || 9525) * layout.zoom);
    if (line?.style === 2 || line?.style === 6) ctx.setLineDash([6, 4]);
    ctx.stroke();
    const text = elementText(element);
    if (text && bounds.width > 28 && bounds.height > 18) {
      ctx.setLineDash([]);
      ctx.fillStyle = "#0f172a";
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text.split("\n")[0], bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
    ctx.restore();
  }
}

function drawSelection(ctx, layout, selectedRange) {
  if (!selectedRange) return;
  const range = normalizeRange(selectedRange);
  const width = sumSpan(layout.columnWidths, range.c1, range.c2);
  const height = sumSpan(layout.rowHeights, range.r1, range.r2);
  if (width <= 0 || height <= 0) return;
  const x = layout.rowHeaderWidth + layout.columnOffsets[range.c1] - layout.scrollLeft;
  const y = layout.colHeaderHeight + layout.rowOffsets[range.r1] - layout.scrollTop;
  if (x + width < layout.rowHeaderWidth || y + height < layout.colHeaderHeight || x > layout.viewportWidth || y > layout.viewportHeight) return;

  ctx.save();
  ctx.fillStyle = "rgba(37, 99, 235, 0.10)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  ctx.fillStyle = "#dbeafe";
  ctx.fillRect(x, 0, width, layout.colHeaderHeight);
  ctx.fillRect(0, y, layout.rowHeaderWidth, height);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, 0, width, layout.colHeaderHeight);
  ctx.strokeRect(0, y, layout.rowHeaderWidth, height);
  ctx.fillStyle = "#1d4ed8";
  ctx.font = `600 ${zoomedFontSize(12, layout.zoom)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(colName(range.c1), x + (layout.columnWidths[range.c1] ?? width) / 2, layout.colHeaderHeight / 2);
  ctx.textAlign = "right";
  ctx.fillText(String(range.r1), layout.rowHeaderWidth - 8, y + (layout.rowHeights[range.r1] ?? height) / 2);
  ctx.restore();
}

function createImageCache(workbook, onLoad) {
  const cache = new Map();
  const urls = [];
  for (const imageAsset of workbook.images || []) {
    if (!imageAsset.id) continue;
    const image = new Image();
    const entry = { image, loaded: false };
    image.onload = () => {
      entry.loaded = true;
      onLoad();
    };
    image.onerror = () => onLoad();
    if (imageAsset.data?.length) {
      const blob = new Blob([imageAsset.data], { type: imageAsset.contentType || "image/png" });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      image.src = url;
    } else if (imageAsset.uri) {
      image.src = imageAsset.uri;
    }
    cache.set(imageAsset.id, entry);
  }
  return {
    get(id) {
      return cache.get(id);
    },
    destroy() {
      for (const url of urls) URL.revokeObjectURL(url);
      cache.clear();
    },
  };
}

function buildLayout(sheet, viewport) {
  const zoom = viewport.zoom ?? 1;
  const { maxRow, maxCol } = getSheetBounds(sheet);
  const columnWidths = buildColumnWidths(viewport.workbook, sheet, maxCol, zoom);
  const rowHeights = buildRowHeights(sheet, maxRow, zoom);
  const rowMap = buildRowMap(sheet);
  const columnMap = buildColumnMap(sheet, maxCol);
  const columnOffsets = prefixSums(columnWidths);
  const rowOffsets = prefixSums(rowHeights);
  const cellMap = buildCellMap(sheet);
  const mergeMaps = buildMergeMaps(sheet);
  const tableMetadata = buildTableMetadata(sheet);
  const pivotMetadata = buildPivotMetadata(viewport.workbook, sheet, cellMap);
  const validationMetadata = buildValidationMetadata(viewport.workbook, sheet);
  const annotationMetadata = buildAnnotationMetadata(viewport.workbook, sheet);
  const conditionalFormattingMetadata = buildConditionalFormattingMetadata(viewport.workbook, sheet, cellMap);
  const scaledRowHeaderWidth = Math.round(rowHeaderWidth * zoom);
  const scaledColHeaderHeight = Math.round(colHeaderHeight * zoom);
  const sheetWidth = scaledRowHeaderWidth + columnOffsets[maxCol] + columnWidths[maxCol];
  const sheetHeight = scaledColHeaderHeight + rowOffsets[maxRow] + rowHeights[maxRow];
  return {
    maxRow,
    maxCol,
    columnWidths,
    rowHeights,
    rowMap,
    columnMap,
    columnOffsets,
    rowOffsets,
    cellMap,
    mergeMaps,
    tableMetadata,
    pivotMetadata,
    validationMetadata,
    annotationMetadata,
    conditionalFormattingMetadata,
    sheetWidth,
    sheetHeight,
    rowHeaderWidth: scaledRowHeaderWidth,
    colHeaderHeight: scaledColHeaderHeight,
    zoom,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
    workbook: viewport.workbook,
  };
}

function findVisibleRange(offsets, sizes, max, scroll, viewportSize) {
  let start = 1;
  let end = max;
  const viewEnd = scroll + viewportSize;
  for (let index = 1; index <= max; index += 1) {
    if ((sizes[index] ?? 0) <= 0) continue;
    if ((offsets[index] ?? 0) + (sizes[index] ?? 0) >= scroll) {
      start = index;
      break;
    }
  }
  for (let index = start; index <= max; index += 1) {
    if ((sizes[index] ?? 0) <= 0) continue;
    if ((offsets[index] ?? 0) > viewEnd) {
      end = Math.max(start, index);
      break;
    }
    end = index;
  }
  return { start: Math.max(1, start - 1), end: Math.min(max, end + 1) };
}

function drawSheet(canvas, workbook, sheet, state = {}) {
  const viewport = state.viewport || { width: 1, height: 1, scrollLeft: 0, scrollTop: 0 };
  const layout = buildLayout(sheet, { ...viewport, workbook });
  const scale = globalThis.devicePixelRatio || 1;
  const cssWidth = Math.max(1, viewport.width);
  const cssHeight = Math.max(1, viewport.height);

  if (canvas.width !== Math.floor(cssWidth * scale)) canvas.width = Math.floor(cssWidth * scale);
  if (canvas.height !== Math.floor(cssHeight * scale)) canvas.height = Math.floor(cssHeight * scale);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.transform = `translate(${layout.scrollLeft}px, ${layout.scrollTop}px)`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.font = `${zoomedFontSize(12, layout.zoom)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  ctx.fillStyle = "#f4f4ef";
  ctx.fillRect(0, 0, cssWidth, layout.colHeaderHeight);
  ctx.fillRect(0, 0, layout.rowHeaderWidth, cssHeight);
  ctx.strokeStyle = "#d9d9d0";

  const visibleCols = findVisibleRange(
    layout.columnOffsets,
    layout.columnWidths,
    layout.maxCol,
    layout.scrollLeft,
    Math.max(0, cssWidth - layout.rowHeaderWidth),
  );
  const visibleRows = findVisibleRange(
    layout.rowOffsets,
    layout.rowHeights,
    layout.maxRow,
    layout.scrollTop,
    Math.max(0, cssHeight - layout.colHeaderHeight),
  );
  const showGridLines = sheet.showGridLines !== false;

  for (let col = visibleCols.start; col <= visibleCols.end; col += 1) {
    if ((layout.columnWidths[col] ?? 0) <= 0) continue;
    const x = layout.rowHeaderWidth + layout.columnOffsets[col] - layout.scrollLeft;
    const width = layout.columnWidths[col];
    ctx.strokeRect(x, 0, width, layout.colHeaderHeight);
    ctx.fillStyle = "#55554c";
    ctx.textAlign = "center";
    ctx.fillText(colName(col), x + width / 2, layout.colHeaderHeight / 2);
  }

  for (let row = visibleRows.start; row <= visibleRows.end; row += 1) {
    if ((layout.rowHeights[row] ?? 0) <= 0) continue;
    const y = layout.colHeaderHeight + layout.rowOffsets[row] - layout.scrollTop;
    const height = layout.rowHeights[row];
    ctx.strokeStyle = "#d9d9d0";
    ctx.strokeRect(0, y, layout.rowHeaderWidth, height);
    ctx.fillStyle = "#55554c";
    ctx.textAlign = "right";
    ctx.fillText(String(row), layout.rowHeaderWidth - 8, y + height / 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    layout.rowHeaderWidth,
    layout.colHeaderHeight,
    cssWidth - layout.rowHeaderWidth,
    cssHeight - layout.colHeaderHeight,
  );
  ctx.clip();

  const deferredTextDraws = [];
  for (let row = visibleRows.start; row <= visibleRows.end; row += 1) {
    if ((layout.rowHeights[row] ?? 0) <= 0) continue;
    const rowMeta = layout.rowMap.get(row);
    const y = layout.colHeaderHeight + layout.rowOffsets[row] - layout.scrollTop;
    const height = layout.rowHeights[row];
    for (let col = visibleCols.start; col <= visibleCols.end; col += 1) {
      if ((layout.columnWidths[col] ?? 0) <= 0) continue;
      const cellKey = `${row}:${col}`;
      const x = layout.rowHeaderWidth + layout.columnOffsets[col] - layout.scrollLeft;
      const width = layout.columnWidths[col];
      const cell = layout.cellMap.get(cellKey);
      const pivotComputedCell = layout.pivotMetadata.computedValues.get(cellKey);
      const displayCell = pivotComputedCell && (cell?.value == null || cell.value === "") ? { ...cell, ...pivotComputedCell } : cell;
      const columnMeta = layout.columnMap[col];
      const mergeRange = layout.mergeMaps.anchors.get(cellKey);
      if (layout.mergeMaps.covered.has(cellKey)) continue;
      const spanWidth = mergeRange ? sumSpan(layout.columnWidths, mergeRange.c1, mergeRange.c2) : width;
      const spanHeight = mergeRange ? sumSpan(layout.rowHeights, mergeRange.r1, mergeRange.r2) : height;
      if (spanWidth <= 0 || spanHeight <= 0) continue;
      const style = resolveCellStyle(workbook, displayCell, rowMeta, columnMeta);
      const table = resolveTableCell(layout.tableMetadata, row, col);
      const tableAppearance = tableCellAppearance(table, row, col);
      const pivotEntry = layout.pivotMetadata.byCell.get(`${row}:${col}`);
      const pivotAppearance = pivotCellAppearance(pivotEntry, displayCell, row, col);
      const conditionalStyle = resolveConditionalStyle(layout, displayCell, row, col);
      const conditionalVisuals = activeConditionalVisuals(layout, displayCell, row, col);
      const isHeader = row === 1 || Boolean(style.bold) || Boolean(tableAppearance?.isHeader) || Boolean(pivotAppearance?.bold);
      const validation = layout.validationMetadata.byCell.get(`${row}:${col}`);
      const annotations = layout.annotationMetadata.byCell.get(`${row}:${col}`);

      ctx.fillStyle =
        conditionalStyle?.fillColor ||
        resolveFillPaint(ctx, style.fill, x, y, spanWidth, spanHeight) ||
        tableAppearance?.fillColor ||
        pivotAppearance?.fillColor ||
        (isHeader ? "#eef2ff" : "#ffffff");
      ctx.fillRect(x, y, spanWidth, spanHeight);
      if (showGridLines || table || pivotAppearance?.borderColor) {
        ctx.strokeStyle = table ? "#bfdbfe" : pivotAppearance?.borderColor || "#e5e5dc";
        ctx.strokeRect(x, y, spanWidth, spanHeight);
      }
      drawBorder(ctx, x, y, spanWidth, spanHeight, style.border);
      drawConditionalVisuals(ctx, layout, displayCell, row, col, x, y, spanWidth, spanHeight);

      const text = formatCell(workbook, displayCell, style, { showFormulas: state.showFormulas });
      if (text) {
        const fontSize = zoomedFontSize(style.fontSize, layout.zoom);
        const font = canvasFont(style, fontSize, isHeader || tableAppearance?.bold || pivotAppearance?.bold);
        const textAlign = normalizeHorizontalAlignment(style.cellFormat?.horizontalAlignment, displayCell);
        ctx.font = font;
        const rightInset = validation || tableAppearance?.isFiltered ? 24 : 8;
        const leftInset = conditionalVisuals.some((entry) => entry.rule.iconSet) ? 24 : 8;
        const shouldWrap = style.cellFormat?.wrapText || String(text).includes("\n");
        const runs = !state.showFormulas && !isNumericCell(displayCell) ? richTextRuns(displayCell, style) : [];
        const useRichText = runs.length > 0;
        const canOverflow =
          !shouldWrap &&
          !mergeRange &&
          textAlign === "left" &&
          !validation &&
          !tableAppearance?.isFiltered &&
          !conditionalVisuals.length;
        const textClipWidth = canOverflow
          ? useRichText
            ? textOverflowWidthForMeasured(layout, row, col, measureRichRuns(ctx, runs), spanWidth, leftInset, rightInset)
            : textOverflowWidth(ctx, layout, row, col, text, spanWidth, leftInset, rightInset)
          : spanWidth;
        const textX =
          textAlign === "right" ? x + spanWidth - rightInset : textAlign === "center" ? x + spanWidth / 2 : x + leftInset;
        const drawText = () => {
          ctx.save();
          ctx.fillStyle = conditionalStyle?.fontColor || tableAppearance?.fontColor || pivotAppearance?.fontColor || style.fontColor;
          ctx.font = font;
          ctx.textBaseline = "middle";
          ctx.textAlign = textAlign;
          ctx.beginPath();
          ctx.rect(x + 4, y, Math.max(1, textClipWidth - 8), spanHeight);
          ctx.clip();
          if (useRichText) {
            const lineHeight = Math.max(10, Math.round(fontSize * 1.22));
            const maxLines = shouldWrap ? Math.max(1, Math.floor((spanHeight - 4) / lineHeight)) : 1;
            const lines = (shouldWrap ? wrapRichRuns(ctx, runs, Math.max(1, spanWidth - leftInset - rightInset)) : [runs]).slice(0, maxLines);
            let lineY = wrappedTextStartY(y, spanHeight, lineHeight, lines.length, style.cellFormat?.verticalAlignment);
            for (const line of lines) {
              drawRichLine(ctx, line, textX, lineY, textAlign);
              lineY += lineHeight;
            }
          } else if (shouldWrap) {
            const lineHeight = Math.max(10, Math.round(fontSize * 1.22));
            const maxLines = Math.max(1, Math.floor((spanHeight - 4) / lineHeight));
            const lines = wrapCanvasText(ctx, text, Math.max(1, spanWidth - leftInset - rightInset)).slice(0, maxLines);
            let lineY = wrappedTextStartY(y, spanHeight, lineHeight, lines.length, style.cellFormat?.verticalAlignment);
            for (const line of lines) {
              drawTextLine(ctx, line, textX, lineY, fontSize, style.underline);
              lineY += lineHeight;
            }
          } else {
            drawTextLine(ctx, text, textX, textBaselineY(y, spanHeight, fontSize, style.cellFormat?.verticalAlignment), fontSize, style.underline);
          }
          ctx.restore();
        };
        if (canOverflow && textClipWidth > spanWidth) {
          deferredTextDraws.push(drawText);
        } else {
          drawText();
        }
      }
      if (tableAppearance?.isFiltered) drawFilterIndicator(ctx, x, y, spanWidth, spanHeight);
      if (validation) drawDropdownIndicator(ctx, x, y, spanWidth, spanHeight);
      if (annotations) drawAnnotationIndicator(ctx, x, y, spanWidth, annotations);
    }
  }
  for (const drawText of deferredTextDraws) drawText();
  ctx.restore();

  drawSparklines(ctx, sheet, layout);
  drawDrawingImages(ctx, sheet, layout, state.imageCache);
  drawDrawingShapes(ctx, sheet, layout);
  drawDrawingCharts(ctx, sheet, layout);
  drawSlicerWidgets(ctx, sheet, layout);
  drawTimelineWidgets(ctx, sheet, layout);
  drawSelection(ctx, layout, state.selectedRange);
  return layout;
}

function findIndexAt(offsets, sizes, max, coord) {
  for (let index = 1; index <= max; index += 1) {
    const start = offsets[index] ?? 0;
    const size = sizes[index] ?? 0;
    if (size <= 0) continue;
    if (coord >= start && coord < start + size) return index;
  }
  return null;
}

function hitTestCell(layout, x, y) {
  if (x < layout.rowHeaderWidth || y < layout.colHeaderHeight) return null;
  const col = findIndexAt(
    layout.columnOffsets,
    layout.columnWidths,
    layout.maxCol,
    x - layout.rowHeaderWidth + layout.scrollLeft,
  );
  const row = findIndexAt(
    layout.rowOffsets,
    layout.rowHeights,
    layout.maxRow,
    y - layout.colHeaderHeight + layout.scrollTop,
  );
  return row && col ? { row, col } : null;
}

function hitTestHeader(layout, x, y) {
  if (x < layout.rowHeaderWidth && y < layout.colHeaderHeight) {
    return { axis: "sheet", row: 1, col: 1 };
  }
  if (y < layout.colHeaderHeight && x >= layout.rowHeaderWidth) {
    const col = findIndexAt(
      layout.columnOffsets,
      layout.columnWidths,
      layout.maxCol,
      x - layout.rowHeaderWidth + layout.scrollLeft,
    );
    return col ? { axis: "col", col } : null;
  }
  if (x < layout.rowHeaderWidth && y >= layout.colHeaderHeight) {
    const row = findIndexAt(
      layout.rowOffsets,
      layout.rowHeights,
      layout.maxRow,
      y - layout.colHeaderHeight + layout.scrollTop,
    );
    return row ? { axis: "row", row } : null;
  }
  return null;
}

function hitTestResizeHandle(layout, x, y, tolerance = 5) {
  if (y < layout.colHeaderHeight && x >= layout.rowHeaderWidth) {
    const coord = x - layout.rowHeaderWidth + layout.scrollLeft;
    for (let col = 1; col <= layout.maxCol; col += 1) {
      const width = layout.columnWidths[col] ?? 0;
      if (width <= 0) continue;
      const edge = (layout.columnOffsets[col] ?? 0) + width;
      if (Math.abs(coord - edge) <= tolerance) return { axis: "col", index: col };
    }
  }
  if (x < layout.rowHeaderWidth && y >= layout.colHeaderHeight) {
    const coord = y - layout.colHeaderHeight + layout.scrollTop;
    for (let row = 1; row <= layout.maxRow; row += 1) {
      const height = layout.rowHeights[row] ?? 0;
      if (height <= 0) continue;
      const edge = (layout.rowOffsets[row] ?? 0) + height;
      if (Math.abs(coord - edge) <= tolerance) return { axis: "row", index: row };
    }
  }
  return null;
}

function stepVisible(layout, axis, index, delta) {
  const sizes = axis === "row" ? layout.rowHeights : layout.columnWidths;
  const max = axis === "row" ? layout.maxRow : layout.maxCol;
  let next = index + delta;
  while (next >= 1 && next <= max) {
    if ((sizes[next] ?? 0) > 0) return next;
    next += delta;
  }
  return index;
}

function ensureRangeVisible(scroller, layout, range) {
  const normalized = normalizeRange(range);
  const focusRow = normalized.r2;
  const focusCol = normalized.c2;
  const cellLeft = layout.columnOffsets[focusCol] ?? 0;
  const cellRight = cellLeft + (layout.columnWidths[focusCol] ?? 0);
  const cellTop = layout.rowOffsets[focusRow] ?? 0;
  const cellBottom = cellTop + (layout.rowHeights[focusRow] ?? 0);
  const viewWidth = Math.max(0, scroller.clientWidth - layout.rowHeaderWidth);
  const viewHeight = Math.max(0, scroller.clientHeight - layout.colHeaderHeight);

  if (cellLeft < scroller.scrollLeft) scroller.scrollLeft = cellLeft;
  else if (cellRight > scroller.scrollLeft + viewWidth) scroller.scrollLeft = Math.max(0, cellRight - viewWidth);

  if (cellTop < scroller.scrollTop) scroller.scrollTop = cellTop;
  else if (cellBottom > scroller.scrollTop + viewHeight) scroller.scrollTop = Math.max(0, cellBottom - viewHeight);
}

function selectionAnchor(range) {
  return { row: range.r1, col: range.c1 };
}

function selectionFocus(range) {
  return { row: range.r2, col: range.c2 };
}

function makeSingleCellRange(cell) {
  return { r1: cell.row, c1: cell.col, r2: cell.row, c2: cell.col };
}

function cellBounds(layout, row, col) {
  return {
    x: layout.rowHeaderWidth + layout.columnOffsets[col] - layout.scrollLeft,
    y: layout.colHeaderHeight + layout.rowOffsets[row] - layout.scrollTop,
    width: layout.columnWidths[col] ?? 0,
    height: layout.rowHeights[row] ?? 0,
  };
}

function setCellValue(sheet, rowIndex, colIndex, value) {
  let row = sheet.rows.find((candidate) => candidate.index === rowIndex);
  if (!row) {
    row = { index: rowIndex, cells: [], height: 0, customHeight: false };
    sheet.rows.push(row);
    sheet.rows.sort((a, b) => a.index - b.index);
  }
  const address = cellAddress(rowIndex, colIndex);
  let cell = row.cells.find((candidate) => candidate.address === address);
  if (!cell) {
    cell = { address, value: "", dataType: 2 };
    row.cells.push(cell);
    row.cells.sort((a, b) => (parseA1(a.address)?.col ?? 0) - (parseA1(b.address)?.col ?? 0));
  }
  cell.value = value;
  cell.dataType = Number.isFinite(Number(value)) && value !== "" ? 5 : 2;
}

function setColumnWidthPx(workbook, sheet, colIndex, widthPx, zoom = 1) {
  const rawWidthPx = Math.max(8, widthPx / Math.max(0.1, zoom));
  const column = ensureColumn(sheet, colIndex);
  column.width = rawWidthPx / columnDigitWidth(workbook);
  column.hidden = false;
}

function setRowHeightPx(sheet, rowIndex, heightPx, zoom = 1) {
  let row = sheet.rows.find((candidate) => candidate.index === rowIndex);
  if (!row) {
    row = { index: rowIndex, cells: [], height: 0, customHeight: false };
    sheet.rows.push(row);
    sheet.rows.sort((a, b) => a.index - b.index);
  }
  const rawHeightPx = Math.max(8, heightPx / Math.max(0.1, zoom));
  row.height = Math.max(1, ((rawHeightPx - 3) * 72) / 96);
  row.customHeight = true;
  row.hidden = false;
}

function buildTsv(workbook, sheet, layout, range, options = {}) {
  const normalized = normalizeRange(range);
  const rows = [];
  for (let row = normalized.r1; row <= normalized.r2; row += 1) {
    if ((layout.rowHeights[row] ?? 0) <= 0) continue;
    const values = [];
    const rowMeta = layout.rowMap.get(row);
    for (let col = normalized.c1; col <= normalized.c2; col += 1) {
      if ((layout.columnWidths[col] ?? 0) <= 0) continue;
      const cell = layout.cellMap.get(`${row}:${col}`);
      const style = resolveCellStyle(workbook, cell, rowMeta, layout.columnMap[col]);
      const value = cellDisplayText(workbook, cell, style, options);
      values.push(/[	\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
    }
    rows.push(values.join("\t"));
  }
  return rows.join("\n");
}

function isTextEditingElement(element) {
  if (!element) return false;
  const tagName = element.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
}

export function mountWorkbookCanvas(container, workbook, options = {}) {
  const sheets = workbook.sheets.length > 0 ? workbook.sheets : [{ name: "Sheet1", rows: [], columns: [] }];
  let activeIndex = 0;
  let selectedRange = { r1: 1, c1: 1, r2: 1, c2: 1 };
  let dragAnchor = null;
  let resizeDrag = null;
  let activeLayout = null;
  let pendingFrame = 0;
  let showFormulas = false;
  let zoom = 1;
  let validationMenu = null;
  const imageCache = createImageCache(workbook, () => scheduleRender());

  container.innerHTML = "";
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  frame.tabIndex = 0;
  const tabBar = document.createElement("div");
  tabBar.className = "sheet-tabs";
  const scroller = document.createElement("div");
  scroller.className = "canvas-scroller";
  const surface = document.createElement("div");
  surface.className = "sheet-surface";
  const canvas = document.createElement("canvas");
  canvas.className = "sheet-canvas";
  canvas.setAttribute("aria-label", "Spreadsheet canvas");
  canvas.dataset.testid = "portable-workbook-canvas";
  scroller.append(surface, canvas);
  frame.append(scroller, tabBar);
  container.append(frame);

  function announceSelection(sheet) {
    if (options.onSelectionChange) {
      options.onSelectionChange(sheet, rangeAddress(selectedRange));
    }
  }

  function viewport() {
    const rect = scroller.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      zoom,
    };
  }

  function render() {
    tabBar.innerHTML = "";
    sheets.forEach((sheet, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === activeIndex ? "active" : "";
      button.textContent = sheet.name || `Sheet ${index + 1}`;
      button.addEventListener("click", () => {
        activeIndex = index;
        selectedRange = { r1: 1, c1: 1, r2: 1, c2: 1 };
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
        render();
      });
      tabBar.append(button);
    });
    activeLayout = drawSheet(canvas, workbook, sheets[activeIndex], {
      selectedRange,
      viewport: viewport(),
      showFormulas,
      imageCache,
    });
    surface.style.width = `${activeLayout.sheetWidth}px`;
    surface.style.height = `${activeLayout.sheetHeight}px`;
    if (options.onRender) options.onRender(sheets[activeIndex], rangeAddress(selectedRange));
    announceSelection(sheets[activeIndex]);
  }

  function scheduleRender() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      render();
    });
  }

  function closeValidationMenu() {
    validationMenu?.remove();
    validationMenu = null;
  }

  function hitFromEvent(event) {
    if (!activeLayout) return;
    const rect = canvas.getBoundingClientRect();
    return hitTestCell(activeLayout, event.clientX - rect.left, event.clientY - rect.top);
  }

  function canvasPointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function headerFromEvent(event) {
    if (!activeLayout) return null;
    const point = canvasPointFromEvent(event);
    return hitTestHeader(activeLayout, point.x, point.y);
  }

  function resizeHandleFromEvent(event) {
    if (!activeLayout) return null;
    const point = canvasPointFromEvent(event);
    return hitTestResizeHandle(activeLayout, point.x, point.y);
  }

  function setCursorForEvent(event) {
    if (resizeDrag) return;
    const handle = resizeHandleFromEvent(event);
    canvas.style.cursor = handle?.axis === "col" ? "col-resize" : handle?.axis === "row" ? "row-resize" : "";
  }

  function openValidationMenu(hit) {
    if (!activeLayout) return false;
    const validation = activeLayout.validationMetadata.byCell.get(`${hit.row}:${hit.col}`);
    if (!validation?.options?.length) return false;
    closeValidationMenu();
    selectedRange = makeSingleCellRange(hit);
    const bounds = cellBounds(activeLayout, hit.row, hit.col);
    const select = document.createElement("select");
    select.className = "validation-menu";
    select.style.left = `${Math.max(activeLayout.rowHeaderWidth, bounds.x + bounds.width - 160)}px`;
    select.style.top = `${Math.max(activeLayout.colHeaderHeight, bounds.y + bounds.height + 2)}px`;
    select.style.width = `${Math.max(140, Math.min(260, bounds.width + 24))}px`;

    const currentCell = activeLayout.cellMap.get(`${hit.row}:${hit.col}`);
    const currentValue = currentCell?.value == null ? "" : String(currentCell.value);
    if (!validation.options.includes(currentValue)) {
      const option = document.createElement("option");
      option.value = currentValue;
      option.textContent = currentValue || "(blank)";
      select.append(option);
    }
    for (const value of validation.options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    select.value = currentValue;
    select.addEventListener("change", () => {
      setCellValue(sheets[activeIndex], hit.row, hit.col, select.value);
      closeValidationMenu();
      render();
    });
    select.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeValidationMenu();
        frame.focus();
      }
    });
    select.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== select) closeValidationMenu();
      }, 0);
    });
    scroller.append(select);
    validationMenu = select;
    render();
    requestAnimationFrame(() => {
      validationMenu?.focus();
    });
    return true;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!activeLayout) return;
    const resizeHandle = resizeHandleFromEvent(event);
    if (resizeHandle) {
      closeValidationMenu();
      resizeDrag = {
        ...resizeHandle,
        startX: event.clientX,
        startY: event.clientY,
        startSize:
          resizeHandle.axis === "col" ? activeLayout.columnWidths[resizeHandle.index] || 0 : activeLayout.rowHeights[resizeHandle.index] || 0,
      };
      selectedRange =
        resizeHandle.axis === "col"
          ? { r1: 1, c1: resizeHandle.index, r2: activeLayout.maxRow, c2: resizeHandle.index }
          : { r1: resizeHandle.index, c1: 1, r2: resizeHandle.index, c2: activeLayout.maxCol };
      canvas.style.cursor = resizeHandle.axis === "col" ? "col-resize" : "row-resize";
      frame.focus();
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      render();
      return;
    }

    const header = headerFromEvent(event);
    if (header) {
      closeValidationMenu();
      if (header.axis === "col") selectedRange = { r1: 1, c1: header.col, r2: activeLayout.maxRow, c2: header.col };
      else if (header.axis === "row") selectedRange = { r1: header.row, c1: 1, r2: header.row, c2: activeLayout.maxCol };
      else selectedRange = { r1: 1, c1: 1, r2: activeLayout.maxRow, c2: activeLayout.maxCol };
      frame.focus();
      render();
      event.preventDefault();
      return;
    }

    const hit = hitFromEvent(event);
    if (!hit) return;
    if (openValidationMenu(hit)) {
      event.preventDefault();
      return;
    }
    closeValidationMenu();
    dragAnchor = hit;
    selectedRange = makeSingleCellRange(hit);
    frame.focus();
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (resizeDrag) {
      const delta = resizeDrag.axis === "col" ? event.clientX - resizeDrag.startX : event.clientY - resizeDrag.startY;
      const size = Math.max(8, resizeDrag.startSize + delta);
      if (resizeDrag.axis === "col") setColumnWidthPx(workbook, sheets[activeIndex], resizeDrag.index, size, zoom);
      else setRowHeightPx(sheets[activeIndex], resizeDrag.index, size, zoom);
      render();
      event.preventDefault();
      return;
    }
    setCursorForEvent(event);
    if (!dragAnchor || !activeLayout) return;
    const hit = hitFromEvent(event);
    if (!hit) return;
    selectedRange = { r1: dragAnchor.row, c1: dragAnchor.col, r2: hit.row, c2: hit.col };
    scheduleRender();
  });

  canvas.addEventListener("pointerup", (event) => {
    resizeDrag = null;
    dragAnchor = null;
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointercancel", (event) => {
    resizeDrag = null;
    dragAnchor = null;
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerleave", () => {
    if (!resizeDrag) canvas.style.cursor = "";
  });

  scroller.addEventListener(
    "scroll",
    () => {
      closeValidationMenu();
      scheduleRender();
    },
    { passive: true },
  );

  scroller.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      closeValidationMenu();
      const beforeLayout = activeLayout;
      if (!beforeLayout) return;
      const oldZoom = zoom;
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      const nextZoom = oldZoom * Math.exp(-delta * 0.002);
      const rect = scroller.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const sheetX = scroller.scrollLeft + Math.max(0, pointerX - beforeLayout.rowHeaderWidth);
      const sheetY = scroller.scrollTop + Math.max(0, pointerY - beforeLayout.colHeaderHeight);
      setZoom(nextZoom);
      const ratio = zoom / oldZoom;
      scroller.scrollLeft = Math.max(0, sheetX * ratio - Math.max(0, pointerX - activeLayout.rowHeaderWidth));
      scroller.scrollTop = Math.max(0, sheetY * ratio - Math.max(0, pointerY - activeLayout.colHeaderHeight));
      render();
    },
    { passive: false },
  );

  function handleKeydown(event) {
    if (!activeLayout) return;
    const activeElement = document.activeElement;
    if (isTextEditingElement(activeElement)) return;
    closeValidationMenu();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      const tsv = buildTsv(workbook, sheets[activeIndex], activeLayout, selectedRange, { showFormulas });
      if (navigator.clipboard?.writeText) {
        event.preventDefault();
        navigator.clipboard.writeText(tsv).catch(() => {});
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=" || event.key === "-")) {
      event.preventDefault();
      setZoom(zoom + (event.key === "-" ? -0.1 : 0.1));
      return;
    }
    const keyMap = {
      ArrowUp: ["row", -1],
      ArrowDown: ["row", 1],
      ArrowLeft: ["col", -1],
      ArrowRight: ["col", 1],
    };
    const movement = keyMap[event.key];
    if (!movement) return;
    event.preventDefault();
    const [axis, delta] = movement;
    const focus = selectionFocus(selectedRange);
    const next = {
      row: axis === "row" ? stepVisible(activeLayout, "row", focus.row, delta) : focus.row,
      col: axis === "col" ? stepVisible(activeLayout, "col", focus.col, delta) : focus.col,
    };
    if (event.shiftKey) {
      const anchor = selectionAnchor(selectedRange);
      selectedRange = { r1: anchor.row, c1: anchor.col, r2: next.row, c2: next.col };
    } else {
      selectedRange = makeSingleCellRange(next);
    }
    ensureRangeVisible(scroller, activeLayout, selectedRange);
    render();
  }

  function handleCopy(event) {
    if (!activeLayout) return;
    const activeElement = document.activeElement;
    if (isTextEditingElement(activeElement)) return;
    const tsv = buildTsv(workbook, sheets[activeIndex], activeLayout, selectedRange, { showFormulas });
    event.clipboardData?.setData("text/plain", tsv);
    event.preventDefault();
  }

  frame.addEventListener("keydown", handleKeydown);
  frame.addEventListener("copy", handleCopy);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("copy", handleCopy);
  globalThis.addEventListener("resize", scheduleRender);

  render();

  function setZoom(value) {
    zoom = Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
    render();
  }

  return {
    render,
    canvas,
    setShowFormulas(value) {
      showFormulas = Boolean(value);
      render();
    },
    getShowFormulas() {
      return showFormulas;
    },
    setZoom,
    getZoom() {
      return zoom;
    },
    getActiveLayout() {
      return activeLayout;
    },
    getActiveSheet() {
      return sheets[activeIndex];
    },
    getSelectedRange() {
      return selectedRange;
    },
    destroy() {
      closeValidationMenu();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("copy", handleCopy);
      globalThis.removeEventListener("resize", scheduleRender);
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      imageCache.destroy();
    },
  };
}
