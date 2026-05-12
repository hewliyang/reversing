# Browser Workbook Preview

Minimal browser-native `.xlsx` previewer using portable parser, proto decode, and canvas renderer source.

## Run

```bash
node examples/browser-workbook-preview/server.mjs
```

Then open:

```text
http://127.0.0.1:4177/?sample=1
```

Use `SAMPLE_XLSX=/absolute/path/file.xlsx` to change the sample served by the `Load sample` button.

## Verify

```bash
node examples/browser-workbook-preview/smoke-test.mjs
```

The smoke test covers formula/value mode, zoom, virtualized large-sheet scrolling, range selection, TSV copy, and confirms no `/codex-assets` are requested.

## Flow

1. `server.mjs` serves `@oai/walnut/wasm` from the extracted `@oai/artifact-tool` package at `/walnut-wasm/`.
2. `src/walnut-loader.mjs` initializes the .NET WASM runtime from `dotnet.js` and returns the Walnut assembly exports.
3. `src/xlsx-artifact.mjs` calls `XlsxReader.ExtractXlsxProto(bytes, false)`.
4. `src/workbook-proto-lite.mjs` decodes the subset of the workbook protobuf needed for previewing sheets, rows, columns, cells, and formula results.
5. `src/simple-workbook-canvas.mjs` draws the decoded workbook directly onto a DOM `<canvas>`.

## Portable Boundary

This demo no longer imports Codex Desktop webview chunks or extracts `app.asar`. The only non-local runtime dependency is Walnut's .NET WASM bundle.

This is not a PNG bridge and does not call the Node `@oai/artifact-tool` renderer for previewing.

The renderer is still intentionally lite and does not attempt editing parity or rich-text parity. It now covers first-pass static previews for images, charts, shapes, conditional formatting, comments/notes, sparklines, pivots, slicers, and timelines.

See `FULL_FIDELITY_PLAN.md` for the from-scratch roadmap. Current coverage includes local decode/render for workbook styles, fonts, fills, custom number formats, borders, merged-cell spans, row/column style inheritance, hidden row/column geometry when present in the proto, virtualized viewport rendering, active/range selection, arrow-key navigation, TSV copy, formula/value toggle, zoom, image drawings, common shape geometry, bar/line/pie charts, basic conditional formatting, and static workbook-object overlays.

## Fixtures

The main combined fixture is:

`/Users/m1a1/Developer/oai-artifact-tools/tmp/browser-workbook-fixtures/pivot-slicer-validation-fixture.xlsx`

It includes a chart, shape drawing, table, list data validation, conditional formatting, slicers, a pivot table/cache, and sparklines. Regenerate it with:

```bash
node /Users/m1a1/Developer/oai-artifact-tools/examples/browser-workbook-preview/scripts/generate-workbook-fixtures.mjs
```

Open it in the preview server with:

`http://127.0.0.1:4177/?sample=1&fixture=pivot-slicer-validation`
