# Codex Workbook Viewer Reverse-Engineering Notes

This previewer should be driven by the Codex desktop viewer contract, not by guessed workbook shapes.

## Local App Assets

The desktop app webview bundle is unpacked at:

- `/tmp/codex-app-asar/webview/assets/PopcornElectronWorkbookPanel-BZz8NPb4.js`
- `/tmp/codex-app-asar/webview/assets/workbook-ChU80maf.js`
- `/tmp/codex-app-asar/webview/assets/spreadsheet-C5teyo92.js`

No source maps were present in `/tmp/codex-app-asar/webview/assets`.

## Viewer Handoff

`PopcornElectronWorkbookPanel-BZz8NPb4.js` passes the artifact proto directly into the workbook model:

```js
function $o(e){return e==null?Qo():N.load(e)}
...
new to({ ..., workbook:$o(initialWorkbookProto) })
```

`workbook-ChU80maf.js` implements:

```js
static load(t){return new e(t)}
```

So the viewer consumes the decoded workbook proto rather than importing XLSX directly in the panel.

## Worksheet Model Fields

The worksheet constructor in `workbook-ChU80maf.js` preserves these decoded fields:

```js
{
  rows,
  columns,
  mergedCells,
  conditionalFormattings,
  dataValidations: dataValidations?.items ?? [],
  sharedFormulas,
  tables,
  pivotTables,
  slicers,
  timelines,
  drawings
}
```

This confirms that tables, validations, conditional formatting, pivots, slicers, timelines, drawings, merged cells, and shared formulas are first-class viewer inputs.

## Proto Field Map Used Here

`spreadsheet-C5teyo92.js` contains the generated protobuf codec. The portable decoder mirrors these fields:

- Workbook: `1 sheets`, `2 styles`, `10 id`
- Sheet: `1 index`, `2 name`, `3 rows`, `6 columns`, `7 defaultRowHeight`, `9 defaultColWidth`, `10 showGridLines`, `11 id`, `12 mergedCells`, `13 conditionalFormattings`, `15 tables`, `20 sheetId`, `21 baseColWidth`, `28 dataValidations`
- Row: `1 index`, `2 cells`, `3 height`, `4 customHeight`, `5 styleIndex`, `6 hidden`
- Cell: `1 address`, `2 value`, `3 formula`, `4 dataType`, `5 styleIndex`
- Table: `1 id`, `2 name`, `3 displayName`, `4 ref`, `5 columns`, `6 style`, `7 totalsRowShown`, `8 headerRowCount`, `9 totalsRowCount`, `10 autoFilter`, `11 dataDxfId`, `12 headerRowCellStyle`
- DataValidation: `1 sqref`, `2 type`, `6 allowBlank`, `7 showDropDown`, `14 formula1`, `15 formula2`, plus prompt/error metadata
- ConditionalFormatting: `1 ranges`, `2 rules`

The cleaner app-bundle re-export is `/tmp/codex-app-asar/webview/assets/spreadsheet-Bpv2Ypgr.js`. It exports concrete generated codec objects:

```js
import { Workbook, Sheet, Cell, Table, DataValidation } from "./spreadsheet-Bpv2Ypgr.js";

const workbook = Workbook.decode(protoBytes);
const bytes = Workbook.encode(workbook).finish();
```

It also exports enums such as `CellDataType`, `CellFormulaType`, and `DataValidationType`. The recovered TypeScript surface used by this preview lives in `src/walnut-spreadsheet-proto.d.ts`, and `scripts/inspect-codex-spreadsheet-codec.mjs` can re-inspect the local Codex app bundle.

## Render Metadata Pattern

`workbook-ChU80maf.js` has `__getSpreadsheetRenderMetadata(themeMap)`, which computes:

- `sharedFormulaMap`
- `colStyleIndices`
- `listValidationEntries`
- `tableResolvers`
- `tableResolversByRow`
- `tableHorizontalBoundaries`

The portable renderer mirrors that architecture with `buildTableMetadata()` and `buildValidationMetadata()`.

## Table Semantics

The Codex viewer parses table dimensions with:

```js
function Rr(e){return e.headerRowCount===0?0:1}
function zr(e){return e.totalsRowCount===0?0:typeof e.totalsRowCount=="number"||e.totalsRowShown?1:0}
```

The portable renderer uses the same header/total row semantics. It currently renders a simplified table style layer: header fill, total fill, row/column stripes, bold first/last/header/total cells, and filter indicators.

## Validation Semantics

The Codex viewer only builds dropdown metadata for list validations:

```js
if (isListValidation(validation) && validation.sqref) {
  ranges = parseSqref(validation.sqref)
  options = parseOptions(validation.formula1)
}
```

The portable renderer mirrors this for `type === 4` (`DATA_VALIDATION_TYPE_LIST`) and currently draws dropdown affordances.

## Current Gaps

- Conditional formatting has first-pass rendering for `cellIs`, `containsText`, color scales, data bars, and icon-set placeholders. Remaining gaps are top/bottom, above-average, time-period, formula-expression, true icon glyphs, and richer data-bar behavior.
- Table style `dxfs` and theme-aware color resolution are not fully ported.
- Pivots, slicers, timelines, comments/notes, sparklines, and drawings have concrete generated spreadsheet codecs and are represented in `src/walnut-spreadsheet-proto.d.ts`; the portable decoder now reads the core static fields for these objects.
- Drawing charts/images/shapes cross into the shared presentation proto bundle. Spreadsheet `Drawing` uses fields `chart`, `imageReference`, and `shape`, whose nested codecs are imported from `presentation-BnmUWZ9U.js`. Images, common chart data, and first-pass shape geometry/fill/line/text are rendered.
- Rendering for pivots, slicers, timelines, comments/notes, and sparklines is first-pass static only. It does not yet implement interactive filtering, pivot recomputation, comment panels, or exact Codex component styling.
- Freeze panes appear to be view/controller state in the panel path, not an obvious field in the current spreadsheet proto bundle.
