# Codex Spreadsheet Artifact Parity Plan

Goal: build a browser-native spreadsheet previewer from scratch on top of Walnut's XLSX parser and the recovered Codex artifact protos, without importing Codex Desktop webview UI chunks and without using a PNG bridge.

Parity target: match the Codex desktop spreadsheet artifact viewer's decoded proto model and static rendering behavior for `.xlsx` previews. This is not Excel editing parity; it is Codex app preview parity.

Source of truth:

- Recovered protos: `/Users/m1a1/Developer/oai-artifact-tools/tmp/proto-extract/protos/src/oaiproto/coworker`
- Generated Codex spreadsheet codec: `/tmp/codex-app-asar/webview/assets/spreadsheet-Bpv2Ypgr.js`
- Viewer implementation reference: `/tmp/codex-app-asar/webview/assets/workbook-ChU80maf.js` and `/tmp/codex-app-asar/webview/assets/PopcornElectronWorkbookPanel-BZz8NPb4.js`

## Architecture

The viewer has four explicit layers:

1. XLSX ingest
   - Use Walnut WASM only for `XlsxReader.ExtractXlsxProto(bytes, false)`.
   - Treat Walnut as the durable XLSX/OpenXML parser boundary.

2. Proto decode
   - Decode the workbook protobuf locally from the recovered `.proto` schema.
   - Keep the decoder source readable and testable, but cross-check it against the generated Codex codec.
   - Decode unknown fields safely so adding new message fields does not corrupt the read position.

3. Workbook model
   - Normalize sparse sheet rows/cells into indexed lookup tables.
   - Resolve style inheritance from cell, row, column, default styles, and theme/indexed colors.
   - Normalize dimensions, merges, hidden rows/columns, formulas, and display values.

4. Canvas renderer
   - Draw directly to DOM canvas.
   - Use viewport virtualization for large sheets.
   - Keep interaction state independent from the workbook model: scroll, active sheet, selection, hover, zoom.

## Milestones

### M0: Portable Baseline

Status: done.

- Walnut runs in browser from `/walnut-wasm`.
- Local proto-lite decoder reads sheets, rows, columns, cells, and merge ranges.
- Local canvas renderer draws a grid and values.
- No `/codex-assets`, React, Popcorn, app.asar extraction, or `Workbook.decode`.

### M1: Static Excel Fidelity

Status: in progress.

Target: make normal business spreadsheets visually plausible.

- Decode workbook styles: fonts, fills, borders, number formats, cell formats. Done for the current lite schema.
- Resolve and render cell background fills. Done.
- Resolve and render font bold/italic/size/color. Done for whole-cell styles.
- Apply number format categories: integer, decimal, percent, currency, date/time, text. Initial support done.
- Render merged cells as single spans. Initial support done.
- Respect hidden rows and columns. Renderer support done when hidden flags are present in Walnut output.
- Draw basic borders. Initial support done.
- Resolve row/column style inheritance. Initial support done.
- Add fixture screenshots and pixel-ish regression checks.

### M2: Viewport Correctness

Status: in progress.

Target: handle large workbooks.

- Replace whole-sheet canvas sizing with virtualized viewport rendering. Done.
- Add scroll model, sticky row/column headers, active sheet state. Done.
- Add frozen panes.
- Add zoom. Done.
- Add hit testing for cells and ranges. Done.

### M3: Selection and Navigation

Status: started.

Target: feel like a spreadsheet viewer.

- Active cell selection. Done.
- Keyboard navigation. Done for arrow keys.
- Mouse drag selection. Done.
- Copy selected visible text/TSV. Done.
- Formula/value toggle. Done.

### M4: Rich Content

Status: in progress.

Target: support common workbook features beyond grids.

- Rich text runs.
- Comments and notes. Initial static cell-corner indicators done from workbook `notes`/`threads`.
- Data validation indicators. Initial list dropdown indicators and clickable select overlay done.
- Conditional formatting. Initial `cellIs`/`containsText`, color-scale fill, data-bar, and icon-set placeholder support done.
- Tables and autofilter chrome. Initial table bands/filter indicators done.
- Images and anchored drawings. Initial image decode/render done.
- Sparklines. Initial line/column/static render done.
- Shapes. Initial `Drawing.shape` decode/render for common geometry/fill/line/text done.

### M5: Charts and Pivots

Status: in progress.

Target: render complex workbook objects.

- Chart model decode from `oaiproto.coworker.pptx.Chart`. Initial decode done.
- Basic chart renderer: bar, line, area, pie, scatter. Bar/line/pie first pass done.
- Pivot table display. Initial range outline/badge done; generated pivot cell values still come from Walnut output.
- Slicers and timelines as static preview widgets. Initial slicer widgets done; timeline renderer exists but fixture generation is still pending because the current generator surface does not expose timeline creation.

### M6: Codex Viewer Parity Closure

Target: compare behavior against the app viewer rather than intuition.

- Build fixture corpus covering one feature per workbook: styles, merges, tables, validations, CF, images, shapes, charts, pivots, slicers, timelines, comments, sparklines, hidden rows/columns, shared formulas. Combined chart/shape/table/validation/CF/slicer/pivot/sparkline fixture done.
- For every fixture, inspect decoded proto with both local decoder and Codex generated codec.
- Render the same fixture through this previewer and the Codex viewer where possible.
- Track known gaps in `REVERSE_ENGINEERING_NOTES.md`.

## Immediate Work Queue

1. Expand chart support: area/scatter/bubble, axis labels, legends, multi-series categories, and cross-sheet formula resolution.
2. Expand conditional formatting: top/bottom, above/below average, time periods, true icon-set glyphs, negative data bars.
3. Improve shape fidelity: arrows, callouts, connectors, freeforms, rotation, z-order, and theme refs.
4. Add freeze pane/view-state reconstruction if it is recoverable from Codex viewer state or raw workbook XML.
5. Add Playwright fixture screenshots and proto parity checks against `spreadsheet-Bpv2Ypgr.js`.

## Non-Goals

- Editing parity in the first pass.
- Reimplementing Excel formula calculation in the browser. Walnut/Excel-saved cached values are the display source for now.
- Exact Excel application parity beyond what the Codex artifact viewer supports.
