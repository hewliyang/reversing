# Claude for Word — Virtual Filesystem & Conductor Notes

Reverse-engineered from `claude-for-word.js` (Sentry release `35554e0360e29c5c1a8dab347258e2926f3455e3`).

## Agent Identity

- **Interface:** `doc`
- **Agent ID format:** `word-<random6hex>` (e.g., `word-ffee11`)
- **App name:** `word`

## Conductor Schema

```json
{
  "instructions": "...",
  "appName": "word",
  "version": 2,
  "interface": "doc",
  "capabilities": {
    "receive_message": {},
    "file_sharing": {
      "accept": ["txt", "md", "html", "json", "xml"]
    }
  },
  "display": {
    "label": "word"
  }
}
```

## Accepted File Formats

| Surface | Interface | Accepted formats |
|---------|-----------|-----------------|
| Word    | `doc`     | `txt`, `md`, `html`, `json`, `xml` |

Note: Word accepts `html` which PowerPoint and Excel do not. Word does not accept `csv`, `tsv`, or `svg`.

## Virtual Filesystem Layout (per-peer)

```
/agents/
├── excel-a1b2c3/
│   ├── transcript.jsonl
│   ├── metadata.json
│   ├── status.json
│   └── files/
│       └── data.csv
└── powerpoint-0e0009/
    ├── transcript.jsonl
    ├── metadata.json
    ├── status.json
    └── files/
        └── slides.json
```

## Virtual `bash` — Sandboxed Read-Only Shell

Scoped to `/agents/`. Allowed commands:
- `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `cut`, `sort`, `uniq`, `jq`, `ls`, `diff`
- And similar read-only utilities (see full list in bundle's shell command registry)

**NOT allowed:** `awk`, `sed`, `echo`, `curl`, `python`, or any write operations.

Purpose: Peek at peer state cheaply before deciding whether to use `send_message`.

```bash
head -5 /agents/excel-a1b2c3/files/data.csv    # inspect structure
grep 'revenue' /agents/excel-a1b2c3/transcript.jsonl  # search history
```

## Conductor File Sharing Workflow

The Word agent follows the same conductor protocol as PowerPoint and Excel:

1. `conductor.writeFile("data.json", jsonString)` — broadcast artifact to all peers
2. `send_message("Make a chart from data.json")` — tell a specific peer what to do

### Chart Sharing (Word → PowerPoint/Excel)

The bundle includes specific chart XML extraction logic. When sharing chart data:
- Use `execute_office_js` to read data
- Call `conductor.writeFile("name.json", JSON.stringify(data))`
- File is immediately visible at `/agents/<your-id>/files/name.json`

## DOC_WRITE_TOOLS

The following tools are tracked as document-modifying operations:
- `execute_office_js`
- `edit_doc_text`
- `edit_doc_list`

These trigger `<user_changes>` detection on subsequent turns and participate in the undo tracking system.

## Context Injection Blocks

Each turn, the agent receives these private context blocks:

| Block | Content |
|-------|---------|
| `<doc_state>` | Document outline, comments (with IDs), tracked changes, change-tracking mode, paragraph count |
| `<user_selection>` | What the user highlighted (style, text, structure metadata) |
| `<user_changes>` | Paragraph edits the user made since last turn |
| `<user_reviewed_edits>` | After Apply/Dismiss on proposal cards — which IDs were applied/dismissed/failed |
| `<uploaded_files>` | Attached files with metadata (PDFs show page count) |
| `<user_instructions>` | Persistent user preferences (stored via `update_instructions`) |
| `<initial_state>` | One-time injection: Office API capabilities, display language, etc. |

### `<doc_state>` Schema

Key fields:
- `textPreview` / `fullText` — document body text (fullText only when small enough to inline)
- `textPreviewIsOriginal` — true when showing pre-revision baseline
- `wordCount`, `characterCount`, `paragraphCount`
- `sectionLayout` — per-section column count (when multi-column)
- `changeTrackingMode` — "Off", "TrackAll", or "TrackMineOnly"
- Comment threads with IDs, authors, anchor previews
- Tracked changes with type, author, date
- Heading outline (for `read_doc_section` heading matching)

### `<user_selection>` Variants

- **Cursor:** `Cursor (style "Normal") — no text selected`
- **Single paragraph:** Shows full paragraph text and highlight within it
- **Multi-paragraph:** `Content not included — call context.document.getSelection()`
- **Entire document:** `Entire document selected`

## Transcript Sync Filtering

`bash` calls that inspect `/agents/...` are filtered out of transcript sync — prevents echoing conductor-inspection chatter back to peers.

## Word-Specific Conductor Behavior

- Word's conductor interface is `doc` (not `word`)
- The max anchor text length for search operations is **255 characters** (Word search API cap)
- Quote normalization: curly ↔ straight quotes are auto-normalized during `edit_doc_text` matching
