# ChatGPT-for-Excel Tool Summary

19 Office.js-based Excel add-in tools that an AI model calls via `tool_call` JSON. Reconstructed from the Basispoints v2025 client.

---

## 📖 Reading Tools

| Tool                       | Description                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`read_ranges`**          | Read cell values, text, formulas, number formats, and styles from one or more ranges. Supports cell limits (default 10k) and optional style inclusion.             |
| **`read_range_image`**     | Capture a range as a base64-encoded PNG image.                                                                                                                     |
| **`read_sheets_metadata`** | Get metadata (id, name, position, visibility, tab color) for all sheets.                                                                                           |
| **`search_workbook`**      | Search for text across all sheets or a specific sheet/range. Supports regex, case-sensitive, whole-cell matching, formula searching, with max 500 results default. |
| **`list_items`**           | List charts, tables, and/or pivot tables in the workbook (with full property details).                                                                             |

## ✏️ Writing / Editing Tools

| Tool                | Description                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`write_range`**   | Write values or formulas to individual cells with optional styling, notes/comments, and column/row resizing. Blocks dangerous external formula functions (e.g. `WEBSERVICE`, `HYPERLINK`, `RTD`). |
| **`clear_range`**   | Clear contents, formats, or everything from a range.                                                                                                                                              |
| **`copy_range_to`** | Copy a range to another location on the same sheet.                                                                                                                                               |
| **`format_range`**  | Apply cell styling (font color/size/family/weight/style, fill, borders, number format, alignment) to a range.                                                                                     |
| **`resize_range`**  | Resize columns/rows for a range — autofit, set to specific points, or reset to standard.                                                                                                          |

## 📋 Sheet Structure Tools

| Tool                    | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| **`update_sheet`**      | Insert/delete/hide/unhide rows or columns, freeze/unfreeze panes.       |
| **`update_sheet_view`** | Toggle gridlines, headings, RTL direction, or set zoom level (10–400%). |
| **`update_workbook`**   | Create, delete, rename, or duplicate worksheets.                        |

## 📊 Object Management Tools

| Tool              | Description                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **`chart`**       | Create, update, or delete charts. Supports column, bar, line, pie types with positioning, legends, axis titles. Limited to 8 safe chart types. |
| **`table`**       | Create, update, or delete Excel tables with full property control (headers, totals, banding, filter buttons, styles).                          |
| **`pivot_table`** | Create, update, or delete pivot tables with row/column/value/filter hierarchies, aggregation functions, layout options.                        |

## 🔧 Advanced / Meta Tools

| Tool                | Description                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`run_officejs`**  | Execute arbitrary Office.js JavaScript in a sandboxed iframe. Max 20k chars. Validates for destructive operations and blocks `Excel.run()` calls. |
| **`run_appscript`** | Stub — always throws; only available in Google Sheets runtime.                                                                                    |
| **`update_plan`**   | No-op coordination signal for the agent to acknowledge/update its execution plan.                                                                 |

---

## Key Safety Features

- **Blocked formulas**: 15 external/network functions are blocked (`WEBSERVICE`, `HYPERLINK`, `RTD`, `IMPORTXML`, `IMPORTHTML`, `IMPORTDATA`, `IMPORTFEED`, `GOOGLEFINANCE`, `IMAGE`, `GOOGLETRANSLATE`, `DETECTLANGUAGE`, `IMPORTRANGE`, `FILTERXML`, `ENCODEURL`, `STOCKHISTORY`)
- **Script validation**: `run_officejs` enforces a 20k char limit, blocks `Excel.run()` calls, and requires `destructive=true` for write operations
- **Sheet resolution**: Sheets can be referenced by id, name, or position index
