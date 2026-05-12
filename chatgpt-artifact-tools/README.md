# ChatGPT / Codex Artifact Tools — Architecture Deep Dive

Reverse-engineering of the **primary runtime** bundle that powers ChatGPT &
Codex's `.docx` / `.pptx` / `.xlsx` artifact creation.

When ChatGPT (Codex container mode) "writes a Word doc", "builds a deck", or
"creates a financial model in Excel", it is not calling out to Office or to
LibreOffice. It is running this bundle inside its Node sandbox, which combines
a single Node package (`@oai/artifact-tool`) with a Blazor/.NET WebAssembly
payload that embeds **Microsoft's official `DocumentFormat.OpenXml` SDK**.

Source artifacts copied for inspection live at
`~/Developer/oai-artifact-tools/` (see that directory's README for the
standalone usage examples). This document is the architectural write-up.

## TL;DR

- A single Node package `@oai/artifact-tool@2.7.4` is the entire artifact
  engine — one ~6 MB ESM bundle with ~1,500 named exports.
- It ships three Codex "skills" (`documents`, `presentations`, `spreadsheets`)
  that are dropped into the agent's context as long-form `SKILL.md` files +
  helper scripts + domain templates.
- All OOXML read/write is performed inside a **.NET 8 / Blazor WebAssembly**
  module called `@oai/walnut`, which links Microsoft's
  `DocumentFormat.OpenXml.dll` (4.3 MB of WASM). The JS ↔ .NET seam is a
  **Google Protobuf** message: JS encodes the model proto and hands raw bytes
  to a static .NET method; .NET writes real OOXML.
- The renderer is pure JS over **native `skia-canvas`**: text shaping, layout,
  caret/selection, charts, tables, slide layout — all in the JS bundle.
- The skills add up to ~1.8 kloc of carefully tuned prompt content telling the
  model exactly how to lay out professional documents — page geometry, list
  rhythm, financial-modelling colour conventions, etc.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      Codex sandbox container (gVisor)                     │
│                                                                           │
│  ┌─ Model context (system prompt) ──────────────────────────────────────┐ │
│  │  documents/SKILL.md     419 lines   (DOCX construction contract)    │ │
│  │  presentations/SKILL.md 733 lines   (slide layout, JSX templates)   │ │
│  │  spreadsheets/SKILL.md  607 lines   (workbook design + APIs)        │ │
│  │     + style_guidelines.md, charts.md, financial_models.md,          │ │
│  │       healthcare.md, marketing.md, scientific_research.md, …        │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                  │                                        │
│                                  ▼  emits Node code                       │
│  ┌─ Node v24.14.0 ─────────────────────────────────────────────────────┐ │
│  │  builder.mjs  (model-authored, lives in a temp dir)                 │ │
│  │      import { Workbook, SpreadsheetFile, FileBlob } from            │ │
│  │             "@oai/artifact-tool";                                   │ │
│  │      …                                                              │ │
│  │                                                                     │ │
│  │  @oai/artifact-tool@2.7.4 (single 6.1 MB ESM)                       │ │
│  │  ├── JS model    (Workbook, Sheet, Range, Slide, …, formula engine) │ │
│  │  ├── JS renderer (drawSlideToCtx, drawText, drawTable, charts, …)   │ │
│  │  ├── presentation-jsx runtime (JSX → slide tree)                    │ │
│  │  ├── skia-canvas (native, headless 2D canvas + fonts)               │ │
│  │  └── @oai/walnut/wasm  ── Blazor / .NET 8 / Mono WASM ──────────┐   │ │
│  │         dotnet.native.wasm  (.NET runtime)                      │   │ │
│  │         Walnut.wasm         (XlsxReader/Export, DocxReader/…)   │   │ │
│  │         DocumentFormat.OpenXml.wasm  ← Microsoft OOXML SDK      │   │ │
│  │         Google.Protobuf.wasm                                    │   │ │
│  │         ~30 × System.*.wasm  (trimmed BCL)                      │   │ │
│  │                                                                 │   │ │
│  │  JS ↔ .NET seam: protobuf-encoded model bytes                   │   │ │
│  │     XlsxReader.ExtractXlsxProto(xlsxBytes)  → protoBytes        │   │ │
│  │     XlsxExport.ExportProtoToXlsx(protoBytes) → xlsxBytes        │   │ │
│  │     (same for Docx, Pptx)                                       │   │ │
│  └─────────────────────────────────────────────────────────────────┘   │ │
└───────────────────────────────────────────────────────────────────────────┘
```

## 1. The bundle

`runtime/runtime.json`:

```json
{
  "bundleFormatVersion": 2,
  "bundleVersion": "26.430.10722",
  "bundledPlugins": ["plugins/openai-primary-runtime"],
  "nodeVersion": "v24.14.0",
  "pythonVersion": "3.12.13",
  "targetArch": "arm64",
  "targetPlatform": "darwin",
  "skillsToRemove": [
    "codex-primary-runtime/spreadsheets",
    "codex-primary-runtime/slides",
    "docs", "spreadsheet", "slides"
  ]
}
```

`skillsToRemove` is the giveaway: this bundle is a *consolidation*. Older
Codex deployments shipped separate `docs`, `spreadsheet`, `slides` skills.
This one collapses all three behind a single Node package and unifies their
prompt scaffolding.

A single "plugin" — `openai-primary-runtime` — contains three skills:

```
plugins/openai-primary-runtime/
├── documents/skills/documents/         SKILL.md + render_docx.py + scripts + tasks/ + troubleshooting/ + ooxml/ + examples/
├── presentations/skills/presentations/ SKILL.md + subagent-instructions.md + profiles/ + scripts/ + templates/
└── spreadsheets/skills/spreadsheets/   SKILL.md + style_guidelines.md + charts.md + templates/{financial_models,healthcare,marketing_advertising,scientific_research}.md
```

## 2. `@oai/artifact-tool` — the Node package

```jsonc
// node_modules/@oai/artifact-tool/package.json
{
  "name": "@oai/artifact-tool",
  "version": "2.7.4",
  "dependencies": {
    "skia-canvas": "^3.0.6",
    "@oai/walnut": "0.1.96"
  },
  "exports": {
    ".":                                "./dist/artifact_tool.mjs",
    "./presentation-jsx":               "./dist/presentation-jsx/index.mjs",
    "./presentation-jsx/jsx-runtime":   "./dist/presentation-jsx/jsx-runtime.mjs",
    "./presentation-jsx/jsx-dev-runtime": "./dist/presentation-jsx/jsx-dev-runtime.mjs"
  },
  "bundledDependencies": ["@oai/walnut", "skia-canvas"]
}
```

The entire library is a single ~6.1 MB minified ESM at
`dist/artifact_tool.mjs`. Greppable export shape:

### Top-level entry points

| Export | Purpose |
| --- | --- |
| `FileBlob` | bytes + mime, with `FileBlob.load(path)` / `.save(path)`. The IO boundary. |
| `DocumentFile.{importDocx,exportDocx}` | `.docx` ↔ `DocumentModel` |
| `PresentationFile.{importPptx,exportPptx}` | `.pptx` ↔ `Presentation` (+ `presentation.export({slide, format:"png", scale})`) |
| `SpreadsheetFile.{importXlsx,exportXlsx}` | `.xlsx` ↔ `Workbook` |
| `Workbook.create()` | empty workbook |
| `executeTool({context, name, args})` | dispatches the agent's tool surface |
| `presentation-jsx` | React-like JSX runtime for declarative slide composition |

### Domain models

Spreadsheet side (Excel-shaped object graph): `Workbook`, `Worksheet`,
`WorksheetCollection`, `Range`, `Row`, `Cell`, `CellStore`, `Style`,
`Fill`, `Pattern`, `Color`, `BorderModel`, `Theme`, `Chart`, `ChartSeries`,
`ChartLegend`, `ChartAxis`, `ChartDataLabels`, `ChartTrendline`, `Table`,
`TableColumn`, `PivotTable`, `PivotField`, `PivotItem`, `PivotLayout`,
`PivotCacheDefinition`, `Slicer`, `ConditionalFormat`, `SparklineGroup`,
`SparklineMarkers`, `Comment`, `Thread`, `Note`, `WorkbookRecorder`,
`SpillManager`, `StyleRegistry`, `DefinedNames`, …

Presentation side: `Presentation`, `Slide`, `SlideCollection`,
`SlideBackground`, `Masters`, `Layout`, `LayoutCollection`, `Shape`,
`ShapeCollection`, `ShapeGeometry`, `ShapePlaceholder`, `Image`,
`ImageCollection`, `Text`, `TextRange`, `TextRun`, `TextStyle`,
`Paragraph`, `ParagraphCollection`, `PresentationCell`, `PresentationTable`,
`PresentationTheme`, `SpeakerNotes`, `NotesCollection`,
`PresentationLayoutExport`, …

Document side: `DocumentFile`, `DocumentModel` (`+ createDocumentTextEditAdapter`,
`paintRenderedDocumentPage`, `searchRenderedDocumentTextFragments`,
`collectRenderedDocumentTextFragments`, `preloadDocumentImageBitmaps`,
`renderTextBlock`, etc.).

Editing/UI infrastructure (suggesting an interactive product, not just a
headless agent path): `TextEditController`, `TextSelectionModel`,
`TextOverlayPainter`, `HiddenTextareaBridge`, `SelectionTool`, `Caret*`,
`GeometryHitTester`, `InputController`, `InMemoryEngineEventBus`,
`PresentationAwarenessState`, `WorkbookAwarenessState`,
`SpreadsheetKeyboardEventBus`. Translation: this same bundle clearly powers
an in-browser editing surface (likely Codex's "live artifact preview"), with
the agent CLI path being just one consumer.

### Formula engine

A full Excel-compatible formula library is exported as top-level functions —
every name from `ABS` to `Z_TEST` is right there. Quick highlights from the
~470 formula exports:

- Modern Excel 365: `LAMBDA`, `LET`, `MAP`, `REDUCE`, `SCAN`, `MAKEARRAY`,
  `BYROW`, `BYCOL`, `XLOOKUP`, `XMATCH`, `FILTER`, `SORT`, `SORTBY`,
  `UNIQUE`, `SEQUENCE`, `TEXTSPLIT`, `TEXTBEFORE`, `TEXTAFTER`,
  `WRAPCOLS`, `WRAPROWS`, `TOCOL`, `TOROW`, `VSTACK`, `HSTACK`,
  `CHOOSECOLS`, `CHOOSEROWS`, `TAKE`, `DROP`, `TRIMRANGE`, `GROUPBY`,
  `PIVOTBY`, `PERCENTOF`.
- Stats/finance: full `*_DIST` / `*_INV` family, `XIRR`, `XNPV`, `MIRR`,
  `PMT/IPMT/PPMT`, `PRICE`, `YIELD`, `DURATION`, `MDURATION`.
- AI-flavoured non-standard additions: `STOCKHISTORY`, `IMAGE`,
  `TRANSLATE`, `DETECTLANGUAGE`, `REGEXEXTRACT`, `REGEXREPLACE`,
  `REGEXTEST`, `PY` (a `=PY(...)` cell that runs Python).
- Supporting machinery: `getFormulasRegistry`, `tokenizeFormula`,
  `tokenizeExcelFormula`, `parseFormula`, `evaluateExpr`, `autocompleteFormula`,
  `withEvaluationContext`, `pushEvaluationContext`, `popEvaluationContext`,
  `SpillManager`, `recomputePivotTable`, `buildCalculationChain`,
  `updateDependenciesForFormula`.

### `executeTool` — the agent's actual tool surface

The model doesn't get a free hand on the JS API; it goes through a fixed
dispatch table:

```js
const dispatch = {
  // Workbook structured intro/help/script
  "workbook.inspect":      …,   // structured NDJSON peek
  "workbook.help":         …,   // single API/feature query
  "workbook.help.search":  …,
  "workbook.help.get":     …,
  "workbook.runCell":      …,   // sandboxed JS run inside workbook scope
  "workbook.awareness":    …,
  "workbook.render":       …,
  // Reads
  "read_ranges":           …,
  "search_workbook":       …,
  "list_items":            …,
  "read_sheets_metadata":  …,
  // Writes
  "format_range":          …,
  "write_range":           …,
  "clear_range":           …,
  "update_sheet":          …,
  "update_workbook":       …,
  "update_sheet_view":     …,
  "resize_range":          …,
  // Higher-level constructs
  "pivot_table":           …,
  "chart":                 …,
  "table":                 …,
};
```

Notable: `workbook.runCell` is an **eval-style escape hatch**. It compiles
the model's snippet, runs it synchronously against the workbook, records
chart/idMap patches, and explicitly rejects `async`/`await` (`"runCell does
not support async code. Remove async/await…"`). This is what lets the model
iterate on a workbook procedurally while still flowing every mutation
through the formula recalc + invalidation pipeline:

```js
const p = o.record(() => fn(o));
…
if (recalculate) { o.recalculate(); }
return { ok: true, result: p.result, charts: p.patch, … };
```

### Presentation JSX

`@oai/artifact-tool/presentation-jsx` provides a React-shaped JSX runtime
with two custom Symbols (`@oai/granola/presentation-jsx.element` and
`.fragment`), plus parsers for compact CSS-like string forms:

```js
import { jsx, jsxs, Fragment, paint, stroke, textStyle, createRef }
  from "@oai/artifact-tool/presentation-jsx";

// strings are accepted and parsed into structured paint/stroke/textStyle
paint("linear(45deg, #FF7A00 0%, #FFD166 100%)")
stroke("2px dashed #111")
textStyle("font: bold 18pt 'Inter'; color: #111; align: center; leading: 1.2")
```

The renderer accepts either structured objects or the string shorthand —
`paint(str)` / `stroke(str)` / `textStyle(str)` parse the string into the
internal shape (gradient stops, dash styles, insets, autoFit modes …).
There's also `granola` in some Symbol names — this is the internal codename
for the presentation engine.

### Rendering pipeline

Rendering is pure JS over native skia-canvas. Visible from the exports:

- Layout: `layoutTextBlock`, `layoutDocumentPages`, `layoutComposeTree`,
  `composeSlide`, `composeSlideDetailed`, `composeTextParagraphProtos`.
- Text shaping/metrics: `FontMetricsProvider`, `defaultFontMetricsProvider`,
  `buildFontShorthand`, `canvasFont`, `parseFontSizeToPx`, `splitGraphemes`,
  `normalizeFamilyName`.
- Drawing: `drawSlideToCtx`, `drawDocumentToCtx`, `drawText`, `drawTable`,
  `drawChartInternal`, `drawChartStandalone`, `drawChartReference`,
  `drawViewport`, `paintRenderedDocumentPage`.
- Charts: `createMapChartContext`, `createThreeChartContext`,
  `applyDragRotateEuler`, `MAX_DRAG_PITCH`, `WORLD_DEPTH`/`WORLD_HEIGHT`/
  `WORLD_WIDTH` — 3D chart support, full map projections
  (`MAP_PROJECTION_TO/FROM_PROTO`).
- Interactive editing: `TextEditController` is a full caret/selection/IME
  controller including `pointerDown/Move/Up`, `keyDown`, `beforeInput`,
  `compositionStart/End`, `selectWordAtPoint`, `selectParagraphAtPoint`,
  `splitParagraph`, `deleteSelection`, with a `HiddenTextareaBridge` that
  positions an invisible `<textarea>` at the caret for browser IME — strong
  signal this engine drives a real Codex/ChatGPT in-browser editor.

## 3. `@oai/walnut` — the .NET / OOXML WASM backend

```
node_modules/@oai/artifact-tool/node_modules/@oai/walnut/
├── package.json   (just exports ./wasm/*)
└── wasm/
    ├── blazor.boot.json   "mainAssemblyName": "Walnut"
    ├── dotnet.js, dotnet.native.{js,wasm}, dotnet.runtime.js
    ├── Walnut.dll                                 1.78 MB wasm  ← custom code
    ├── Walnut.webcil
    ├── DocumentFormat.OpenXml.wasm                4.33 MB       ← MS OOXML SDK
    ├── DocumentFormat.OpenXml.Framework.wasm       0.28 MB
    ├── Google.Protobuf.wasm                        0.32 MB
    ├── System.Private.CoreLib.wasm                 1.55 MB
    ├── System.Private.Xml.wasm                     0.50 MB
    ├── System.IO.Packaging.wasm    (ZIP/OPC)       0.07 MB
    ├── System.IO.Compression.wasm                  0.07 MB
    ├── System.Net.Http.wasm                        0.14 MB
    ├── System.Security.Cryptography.wasm
    └── ~22 more trimmed BCL assemblies
```

This is a standard .NET 8 Blazor WASM bundle. The "main assembly" is a
custom `Walnut.dll` that statically links Microsoft's official
`DocumentFormat.OpenXml` SDK and exposes four reader/writer surfaces to JS
via `JSExport`:

```
DocxReader.ExtractDocxProto(byte[])  -> byte[]    // .docx -> protobuf
DocxExport.ExportProtoToDocx(byte[]) -> byte[]    // protobuf -> .docx

PptxReader.ExtractSlidesProto(byte[]) -> byte[]
PptxExport.ExportProtoToPptx(byte[])  -> byte[]

XlsxReader.ExtractXlsxProto(byte[])  -> byte[]
XlsxExport.ExportProtoToXlsx(byte[]) -> byte[]
```

The seam is **always protobuf**. From `dist/artifact_tool.mjs`:

```js
class SpreadsheetFile {
  static async importXlsx(blob) {
    const data = blob instanceof FileBlob ? blob.data : new Uint8Array(blob);
    const wasm = await loadWalnut();                 // Pm()
    const protoBytes = wasm.XlsxReader.ExtractXlsxProto(data);
    const protoMsg   = WorkbookProto.decode(protoBytes);     // Sw.decode
    return Workbook.load(protoMsg);                          // jR.load
  }
  static async exportXlsx(workbook) {
    const wasm = await loadWalnut();
    const bytes = WorkbookProto.encode(workbook.toProto()).finish();
    const xlsx  = wasm.XlsxExport.ExportProtoToXlsx(bytes);
    return new FileBlob(new Uint8Array(xlsx),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
}
```

Implications:

1. **OpenAI does not maintain its own OOXML parser.** They use Microsoft's
   SDK, compiled to WASM. They write only the protobuf model adapter on
   the .NET side (`Walnut.dll`) and a richer JS model + renderer + formula
   engine on top.
2. **The JS-side `Workbook` / `Presentation` / `DocumentModel` are
   isomorphic to the protobuf schema.** Every interesting export comes in
   `*_TO_PROTO` / `*_FROM_PROTO` pairs (e.g. `CHART_TYPE_TO_PROTO`,
   `BAR_DIRECTION_TO_PROTO`, `MARKER_SYMBOL_FROM_PROTO`,
   `MAP_PROJECTION_TO_PROTO`, `PLACEHOLDER_TYPE_FROM_PROTO`,
   `TICK_LABEL_POSITION_TO_PROTO`, `compilePivotToProto`,
   `parsePivotFromProto`, …). The model can be serialised in full to a
   protobuf message and that message round-trips through the WASM into a
   real OOXML file.
3. **The Codex container does not need Office or LibreOffice installed for
   any of this.** Word docs, slide decks, and workbooks are produced
   end-to-end inside Node.

Side note: the documents skill *does* require LibreOffice / `soffice` —
but only for the **render-and-inspect QA gate** (`render_docx.py` rasterises
the produced `.docx` to PNGs that the model visually inspects). The DOCX
itself is built by artifact-tool. If LibreOffice is unavailable, the skill
explicitly falls back to "ship without rendered QA".

## 4. The three skills

Each skill is a long, opinionated SKILL.md plus a small set of helper assets,
loaded straight into the agent's context.

```
documents/SKILL.md       419 lines
presentations/SKILL.md   733 lines
spreadsheets/SKILL.md    607 lines
```

### `spreadsheets` — workbook authoring contract

Key constraints (verbatim from `spreadsheets/SKILL.md`):

- "Use Codex workspace dependencies for spreadsheet artifact work … Do not
  use system node, system python, global npm packages, or repo-local
  installs."
- "Use `@oai/artifact-tool` JS library … for authoring, editing, inspecting,
  rendering, and exporting spreadsheet `.xlsx` workbooks."
- "Do not search package internals or dump prototypes to discover APIs. Use
  the API reference below; if blocked, run at most one exact
  `workbook.help("<api_or_feature>")` query before building." — i.e. the
  bundle is treated as opaque, with `workbook.help` as the only sanctioned
  introspection.
- "Do not use alternate workbook creation/editing libraries such as
  `openpyxl`, `xlsxwriter`, or `pandas.ExcelWriter` …"
- Final response policy: "include a short user-visible summary and
  standalone Markdown link(s) only to final `.xlsx` artifact(s)".
- Domain templates loaded conditionally: `financial_models.md`,
  `healthcare.md`, `marketing_advertising.md`, `scientific_research.md`.
- For finance models specifically: "executive summary or dashboard first,
  then source/assumptions, then model/detail sheets … Only add Checks
  sheets for models where correctness depends on linked calculations,
  source reconciliation, or financial statement/model integrity."

The skill calls `setupSpreadsheetAgent` / `granolaSpreadsheetAgentTools_*`
behind the scenes — these are top-level exports of the JS bundle.

### `documents` — DOCX render-and-verify gate

The DOCX skill has an absolutely characteristic shipping rule:

> **Non-negotiable: render → inspect PNGs → iterate**
>
> You do not "know" a DOCX is satisfactory until you've rendered it and
> visually inspected page images. DOCX text extraction (or reading XML) will
> miss layout defects: clipping, overlap, missing glyphs, broken tables,
> spacing drift, and header/footer issues.

The skill specifies down to the DXA the Word-compatible defaults:

- US Letter, 1-inch margins (= 9360 DXA content width).
- Body Arial 12pt, 1.08 line spacing, 6pt after paragraphs.
- Heading 1/2/3 at 16/14/12 pt bold with explicit before/after spacing.
- Tables: DXA widths only (never %), exact `tblW`/`tblGrid/gridCol`/`tcW`
  agreement, cell margins 80/120 DXA, mandatory `scripts/table_geometry.py`
  normalisation step (Python helper that shares space with the JS API).
- Lists: real Word numbering, marker 360 DXA, text 720 DXA hanging,
  ~32 px rendered gap target between bullets.

This is the most prescriptive of the three skills — visible evidence that
"polished DOCX out of an LLM" is a layout problem first, content second.

### `presentations` — slide composition

This is the largest SKILL.md (733 lines) and uniquely has a separate
`subagent-instructions.md`, plus a `profiles/` directory and a `templates/`
directory of pre-baked slide layouts. Composition uses the
`presentation-jsx` runtime, so the model emits a JSX file that artifact-tool
materialises into a `Presentation` model, which then exports to `.pptx` via
`PptxExport.ExportProtoToPptx`.

The corresponding `Presentation.export({ slide, format: "png" })` method
provides the PNG-per-slide QA loop (identical pattern to documents).

## 5. Standalone reproduction

Because the package bundles its native and WASM dependencies, the extracted
copy works as a normal Node module — no Codex sandbox required.

See `~/Developer/oai-artifact-tools/examples/`:

- `render-pptx.mjs` — open a `.pptx` and render each slide to PNG via
  `presentation.export({ slide, format: "png", scale })`.
- `spreadsheet-formula-probe.mjs` — build a workbook, write modern
  formulas (`XLOOKUP`, `LET`, `INDEX/MATCH`, `XLOOKUP("Mar", …)`),
  `workbook.inspect` calculated values, mutate inputs, re-recalc, export
  `.xlsx`, reimport, re-verify.
- `render-xlsx-to-html-canvas.mjs` — render an `.xlsx` range to PNG and
  drop it into an HTML `<canvas>`.

```bash
node examples/render-pptx.mjs --input deck.pptx --out-dir out/ --scale 1
node examples/spreadsheet-formula-probe.mjs --out-dir out/
```

## 6. Observations

- **OpenAI's "make me a Word doc" capability is a managed runtime, not a
  toolchain assembled per request.** The bundle ships pinned Node, pinned
  Python, pinned WASM assemblies and pinned native skia-canvas; the model
  is forbidden from substituting alternatives. This is the same engineering
  pattern as Anthropic's "Claude for Excel / Word" (see
  `reversing/claude-for-excel/`), but the architectures invert:
  - Anthropic: a thin in-Office add-in proxies Excel's own COM/JS API back
    to a server-side container; **the user's Excel does the work.**
  - OpenAI: a self-contained Node + .NET + Skia engine produces the file
    inside the sandbox; **no Office, no add-in, no client.**
- **Microsoft's official OOXML SDK in WASM.** Probably the cleanest way to
  guarantee schema fidelity without porting it; the cost is a 4 MB WASM
  blob and a Blazor boot.
- **`workbook.runCell` is a per-cell JS interpreter inside the workbook
  scope** — the model can author imperative code that mutates the workbook
  and have those mutations recorded into a structured patch (charts,
  idMap, …). It is sync-only by design.
- **The same bundle clearly powers an interactive in-browser editor.** The
  presence of `TextEditController`, `HiddenTextareaBridge`,
  `SpreadsheetKeyboardEventBus`, `PresentationAwarenessState`,
  `WorkbookAwarenessState`, and `GoogleSheetsAdapter` /
  `GoogleSlidesAdapter` exports (with both `Fetch*` and `Gapi*` client
  variants) suggests the artifact engine is shared between the agent
  pipeline and a Codex/ChatGPT live editing surface — possibly with
  Google Workspace import paths.
- **Codename "granola"** appears in JSX Symbols
  (`@oai/granola/presentation-jsx.element`) and in tool dispatchers
  (`granolaSpreadsheetAgentTools_*`). The package is exported under
  `@oai/artifact-tool` but the internal project name is Granola — likely
  the in-house brand for the artifact engine.
- **Codename "walnut"** is the OOXML/.NET layer (`Walnut.dll`,
  `@oai/walnut`). Granola sits on Walnut.

## 7. References

- Extracted source: `~/Developer/oai-artifact-tools/`
- Original cache: `~/.cache/codex-runtimes/codex-primary-runtime`
- Microsoft OOXML SDK: <https://github.com/dotnet/Open-XML-SDK> (MIT)
- skia-canvas: <https://github.com/samizdatco/skia-canvas>
- For contrast (different architecture, same goal): `reversing/claude-for-excel/`,
  `reversing/claude-for-word/`, `reversing/claude-for-powerpoint/`.
