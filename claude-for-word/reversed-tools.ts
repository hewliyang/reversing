/**
 * Reversed tool implementations for Claude for Word Office.js add-in.
 * Extracted from claude-for-word.js (minified bundle)
 * Sentry release: 35554e0360e29c5c1a8dab347258e2926f3455e3
 *
 * The add-in uses SES (Secure ECMAScript / Hardened JavaScript) to sandbox
 * LLM-generated code, same as PowerPoint. Code runs in a Compartment with
 * restricted globals.
 *
 * KEY FINDING: The XY() function (Zod-to-JSON-Schema converter) injects an
 * `explanation` field into EVERY custom tool's input_schema. This is not
 * tool-specific — it's a universal schema transform applied at registration
 * time via: i.properties.explanation = { type: "string", maxLength: 50,
 *   description: "A very brief description of the action (max 50 chars).
 *   Shown next to the tool icon & permission prompts." }
 */

// ============================================================================
// Constants
// ============================================================================

/** Max chars for Word search API anchor text. `md` in bundle. */
const MAX_ANCHOR_CHARS = 255;

/** Timeout for Office.run on OfficeOnline. `V5t` in bundle. */
const OFFICE_ONLINE_TIMEOUT_MS = 120_000;

/** Inner edit timeout (caller). `hUt` in bundle. */
const EDIT_INNER_TIMEOUT_MS = 30_000;

/** Outer edit chain timeout. `hRe` in bundle. */
const EDIT_CHAIN_TIMEOUT_MS = 120_000;

/** Regex for detecting curly/smart punctuation. `EFt` in bundle. */
const SMART_PUNCT_RE = /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g;

/** Regex for detecting straight equivalents that should be smart-ified. `CFt` in bundle. */
const STRAIGHT_PUNCT_RE = /['"]|--|\.{3}/;

/** Word boundary regex for smart-quote direction detection. `AFt` in bundle. */
const WORD_BOUNDARY_RE = /[\s([{\u2018\u201C\u2013\u2014-]/;

/** List styles map. `fUt` in bundle. */
const LIST_STYLE_MAP: Record<string, string> = {
  bullet: "List Bullet",
  number: "List Number",
};

/** Max chars returned by read_doc_section. `DS` in bundle. */
const MAX_READ_CHARS = 36_000;

/** Cross-product limit for long-text search. `TFt` in bundle. */
const LONG_TEXT_CROSS_LIMIT = 256;

/** Batch size for collapse_blank_paragraphs. `W0e` in bundle. */
const BLANK_PARA_BATCH_SIZE = 20;

/** OOXML structural content regex. `wUt` in bundle. */
const OOXML_STRUCTURAL_RE =
  /<w:drawing|<w:pict|<w:object|<w:sectPr|<w:bookmark|<w:del|<w:ins|<w:commentRange/;

/** Tracked change revision markup regex. `xvt` in bundle. */
const TRACKED_CHANGE_OOXML_RE =
  /<w:(ins|del|rPrChange|pPrChange|tblPrChange|tblPrExChange|trPrChange|tcPrChange|cellIns|cellDel|cellMerge|sectPrChange|numberingChange|moveFrom|moveTo)\b/;

/** Max heading level included in outline. `fSe` in bundle. */
const MAX_OUTLINE_HEADING_LEVEL = 3;

/** Suffix appended to validation errors in propose_doc_edits. `SFt` in bundle. */
const REPROPOSE_SUFFIX =
  "Re-propose with corrected old_text — do not fall back to execute_office_js for this edit.";

/** Inline ref guard fallback hint. `kFt` in bundle. */
const INLINE_REF_FALLBACK_HINT =
  'Or fall back to execute_office_js and edit each side separately (see the "Inline References" pattern — search() ranges never span a field marker, so per-side Replace is safe).';

// ============================================================================
// Platform Utilities (shared with PowerPoint)
// ============================================================================

function getPlatform(): string | undefined {
  try { return Office?.context?.platform; } catch { return undefined; }
}

/**
 * Serialize Office.run on OfficeOnline + hard timeout. `Qi` in bundle.
 * On non-OfficeOnline platforms, just calls runFn directly.
 */
let onlineRunQueue = Promise.resolve();
function safeOfficeRun<T>(
  runFn: (cb: (ctx: any) => Promise<T>) => Promise<T>,
  callback: (ctx: any) => Promise<T>,
  timeoutMs = OFFICE_ONLINE_TIMEOUT_MS,
): Promise<T> {
  if (getPlatform() !== "OfficeOnline") return runFn(callback);
  const run = () => {
    if (timeoutMs <= 0) return runFn(callback);
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      runFn(callback).finally(() => clearTimeout(timer)),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Office.run timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  };
  const task = onlineRunQueue.catch(() => {}).then(run);
  onlineRunQueue = task.catch(() => {});
  return task;
}

// ============================================================================
// Edit Serializer — `vC` / `V0e` / `$0e` in bundle
// ============================================================================

/**
 * Timeout race helper. `V0e` in bundle.
 */
function timeoutRace<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Edit operation timed out after ${ms}ms — Word may be unresponsive. The operation may still complete in the background; verify with verify_doc or a read before retrying so you don't duplicate the change.`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

/**
 * Chain-based serializer for edit operations. `vC` in bundle.
 * Ensures edits run sequentially. Two timeouts:
 * - Inner (30s) for the caller
 * - Outer (120s) for the chain tail
 */
const editChain = { tail: Promise.resolve() };
function serializedEdit<T>(
  fn: () => Promise<T>,
  innerTimeoutMs = EDIT_INNER_TIMEOUT_MS,
): Promise<T> {
  const prev = editChain.tail;
  const result = prev.then(fn);
  editChain.tail = timeoutRace(result, EDIT_CHAIN_TIMEOUT_MS).catch(() => {});
  return prev.then(() => timeoutRace(result, innerTimeoutMs));
}

// ============================================================================
// Change Tracking Toggle — `ff` in bundle
// ============================================================================

/**
 * Ref-counted guard for suppressing change-tracking-related side effects
 * during tool execution. While count > 0, the UI doesn't fire user-change
 * detection. `Jm` and `tc` in bundle. `q5t` is the cooldown delay.
 */
let changeTrackingDepth = 0;
let changeTrackingTimer: ReturnType<typeof setTimeout> | undefined;

function enterToolExecution(active: boolean): void {
  if (active) {
    if (changeTrackingTimer) {
      clearTimeout(changeTrackingTimer);
      changeTrackingTimer = undefined;
    }
    changeTrackingDepth++;
  } else {
    if (changeTrackingDepth > 0) {
      changeTrackingDepth--;
      if (changeTrackingDepth === 0 && !changeTrackingTimer) {
        changeTrackingTimer = setTimeout(() => {
          changeTrackingTimer = undefined;
        }, 2000);
      }
    }
  }
}

// ============================================================================
// Quote Normalization
// ============================================================================

/**
 * Convert smart/curly quotes to their straight equivalents.
 * `N0e` in bundle. Used by `JV` for fuzzy comparison.
 */
function normalizeToStraightPunct(text: string): string {
  return text.replace(SMART_PUNCT_RE, (ch) =>
    ch === "\u2018" || ch === "\u2019"
      ? "'"
      : ch === "\u201C" || ch === "\u201D"
        ? '"'
        : ch === "\u2013"
          ? "-"
          : ch === "\u2014"
            ? "--"
            : "...",
  );
}

/**
 * Convert straight quotes/dashes to their smart Unicode equivalents.
 * `C2` in bundle. Used as fallback when search fails with literal text.
 */
function normalizeToSmartPunct(text: string): string {
  const isWordBoundary = (ch: string | undefined) => !ch || WORD_BOUNDARY_RE.test(ch);
  return text
    .replace(/\.{3}/g, "\u2026")      // ... → …
    .replace(/--/g, "\u2014")          // -- → —
    .replace(/"/g, (_, pos, str) =>    // " → " or "
      isWordBoundary(str[pos - 1]) ? "\u201C" : "\u201D")
    .replace(/'/g, (_, pos, str) =>    // ' → ' or '
      isWordBoundary(str[pos - 1]) ? "\u2018" : "\u2019");
}

/**
 * Fuzzy comparison: normalize both sides to straight punct, then compare.
 * `JV` in bundle.
 */
function fuzzyTextMatch(a: string, b: string): boolean {
  return normalizeToStraightPunct(a) === normalizeToStraightPunct(b);
}

// ============================================================================
// Text Utilities
// ============================================================================

/**
 * Split multi-line old_text into paragraph lines. `YY` in bundle.
 */
function splitParagraphLines(text: string): string[] {
  return text.replace(/[\r\n]+$/, "").split(/\r\n|\r|\n/);
}

/**
 * Check if old_text is "simple" — single line, within search API limit.
 * `M0e` in bundle.
 */
function isSimpleOldText(text: string): boolean {
  const lines = splitParagraphLines(text);
  return lines.length === 1 && lines[0].length <= MAX_ANCHOR_CHARS;
}

/**
 * Truncate text for display in error messages. `kU` in bundle.
 */
function truncateForDisplay(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}\u2026` : text;
}

/**
 * Parse a styleBuiltIn string like "Heading2" into its numeric level.
 * `FA` in bundle. Returns null if not a heading style.
 */
function parseHeadingLevel(styleBuiltIn: string): number | null {
  const match = /^Heading([1-9])$/.exec(styleBuiltIn);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Validation — `Pk` in bundle
// ============================================================================

/**
 * Unified old_text validation/error reporter. `Pk` in bundle.
 * Takes the old_text and the match count from search.
 * Returns error string or null if valid (matchCount === 1).
 *
 * NOTE: This is called BOTH for preflight (with matchCount=1 to check only
 * structural issues) and post-search (with actual match count).
 */
function validateOldText(text: string, matchCount: number): string | null {
  const lines = splitParagraphLines(text);
  if (lines[0].length === 0) {
    return lines.length > 1
      ? "old_text starts with a blank line. The first \\n-separated line is the search anchor — start old_text at the heading or first sentence of the range."
      : "old_text is empty — provide the exact phrase to replace.";
  }
  if (matchCount === 0) {
    return "old_text not found in the document (curly/straight quote variants are matched automatically). Check for exact spelling and whitespace, or re-read the section with read_doc_section to get the exact text.";
  }
  if (matchCount > 1) {
    return `old_text matched ${matchCount} ranges — it must be unique. Add surrounding words to disambiguate (e.g., include the start of the next sentence or a distinctive phrase nearby).`;
  }
  return null;
}

// ============================================================================
// Body Search — `oRe` in bundle (used by QY for edit_doc_text)
// ============================================================================

type SearchResult =
  | Word.Range[]
  | { unsearchable: string };

/**
 * Search for text in the document body, handling both short and long text,
 * with smart-quote fallback. `oRe` in bundle.
 *
 * For short text (≤ 255 chars): direct body.search with smart-quote fallback.
 * For long text (> 255 chars): searches first/last 255-char segments separately,
 * cross-joins candidate spans, and filters by fuzzy text match.
 */
async function searchBodyForText(
  context: Word.RequestContext,
  text: string,
): Promise<SearchResult> {
  const body = context.document.body;

  // Short text path: direct search
  if (text.length <= MAX_ANCHOR_CHARS) {
    const results = body.search(text, { matchCase: true });
    results.load("items");
    await context.sync();

    if (results.items.length === 0 && STRAIGHT_PUNCT_RE.test(text)) {
      const smartText = normalizeToSmartPunct(text);
      if (smartText !== text) {
        const smartResults = body.search(smartText, { matchCase: true });
        smartResults.load("items");
        await context.sync();
        return [...smartResults.items];
      }
    }
    return [...results.items];
  }

  // Long text path: first/last 255-char segments
  const head = text.slice(0, MAX_ANCHOR_CHARS);
  const tail = text.slice(-MAX_ANCHOR_CHARS);

  // Homogeneous run detection
  if (head === tail) {
    return {
      unsearchable:
        "old_text is a long homogeneous run (e.g., signature blank or rule line) and can't be located by content alone. Anchor on adjacent distinctive text — include the label or sentence next to it in old_text.",
    };
  }

  const smartHead = normalizeToSmartPunct(head);
  const smartTail = normalizeToSmartPunct(tail);

  const headResults = body.search(head, { matchCase: true });
  const tailResults = body.search(tail, { matchCase: true });
  const smartHeadResults = smartHead !== head ? body.search(smartHead, { matchCase: true }) : null;
  const smartTailResults = smartTail !== tail ? body.search(smartTail, { matchCase: true }) : null;

  headResults.load("items");
  tailResults.load("items");
  smartHeadResults?.load("items");
  smartTailResults?.load("items");
  await context.sync();

  const allHeads = [...headResults.items, ...(smartHeadResults?.items ?? [])];
  const allTails = [...tailResults.items, ...(smartTailResults?.items ?? [])];

  if (allHeads.length === 0 || allTails.length === 0) return [];

  // Too many candidate pairs
  if (allHeads.length * allTails.length > LONG_TEXT_CROSS_LIMIT) {
    return {
      unsearchable: `old_text overlaps boilerplate that appears widely in the document (start \u00d7${allHeads.length}, end \u00d7${allTails.length}) — too many candidate spans to verify. Shorten old_text to the distinctive part of the change, or include the section heading on a line before it.`,
    };
  }

  // Cross-join: expand each head to each tail, load text, filter
  const candidates: Word.Range[] = [];
  for (const h of allHeads) {
    for (const t of allTails) {
      const expanded = h.expandTo(t);
      expanded.load("text");
      candidates.push(expanded);
    }
  }
  await context.sync();
  return candidates.filter((r) => fuzzyTextMatch(r.text, text));
}

// ============================================================================
// Simple Body Search — `bRe` in bundle (used by edit_doc_list only)
// ============================================================================

/**
 * Simple search with smart-quote fallback. `bRe` in bundle.
 * Does NOT handle long text — only used by edit_doc_list where anchors are short.
 */
async function searchBodySimple(
  context: Word.RequestContext,
  searchText: string,
): Promise<Word.RangeCollection> {
  let results = context.document.body.search(searchText, { matchCase: true });
  results.load("items");
  await context.sync();

  if (results.items.length === 0) {
    const normalized = normalizeToSmartPunct(searchText);
    if (normalized !== searchText) {
      results = context.document.body.search(normalized, { matchCase: true });
      results.load("items");
      await context.sync();
    }
  }
  return results;
}

// ============================================================================
// Multi-Paragraph Range Finder — `DFt` in bundle
// ============================================================================

/**
 * Find a contiguous multi-paragraph span matching the given lines.
 * `DFt` in bundle. Called by `QY` when old_text has multiple lines.
 *
 * Algorithm:
 * 1. Search for line[0] in the body via oRe
 * 2. For each match, load the first paragraph and walk forward with getNextOrNullObject
 * 3. Compare each subsequent paragraph text to the corresponding line via fuzzy match
 * 4. If exactly one complete match, expand the anchor range to cover all paragraphs
 */
async function findMultiParagraphRange(
  context: Word.RequestContext,
  lines: string[],
): Promise<{ range: Word.Range } | { error: string; reason: string }> {
  const firstLineMatches = await searchBodyForText(context, lines[0]);
  if ("unsearchable" in firstLineMatches) {
    return { error: firstLineMatches.unsearchable, reason: "unsearchable" };
  }
  if (firstLineMatches.length === 0) {
    return {
      error: `old_text line 1 ("${truncateForDisplay(lines[0])}") not found in the document (curly/straight quote variants are matched automatically). Re-read the section to get the exact text.`,
      reason: "no_match",
    };
  }

  // For each first-line match, load first paragraph and walk subsequent paragraphs
  const matchData = firstLineMatches.map((matchRange) => {
    const firstPara = matchRange.paragraphs.getFirst();
    firstPara.load("text");
    let lastPara = matchRange.paragraphs.getLast();
    const nextParas: Word.Paragraph[] = [];
    for (let i = 1; i < lines.length; i++) {
      lastPara = lastPara.getNextOrNullObject();
      lastPara.load("text, isNullObject");
      nextParas.push(lastPara);
    }
    return { firstPara, next: nextParas };
  });
  await context.sync();

  // Check which matches have all subsequent paragraphs matching
  const fullMatches: Word.Range[] = [];
  let firstMismatch: { line: number; expected: string; actual: string } | null = null;

  for (let m = 0; m < firstLineMatches.length; m++) {
    const firstParaText = matchData[m].firstPara.text.trim();
    if (!fuzzyTextMatch(firstParaText, lines[0].trim())) {
      firstMismatch ??= { line: 1, expected: lines[0].trim(), actual: firstParaText };
      continue;
    }

    let mismatch: { line: number; expected: string; actual: string } | null = null;
    for (let i = 1; i < lines.length; i++) {
      const nextPara = matchData[m].next[i - 1];
      const nextText = nextPara.isNullObject ? "(end of document)" : nextPara.text.trim();
      if (nextPara.isNullObject || !fuzzyTextMatch(nextText, lines[i].trim())) {
        mismatch = { line: i + 1, expected: lines[i].trim(), actual: nextText };
        break;
      }
    }
    if (mismatch) {
      firstMismatch ??= mismatch;
      continue;
    }

    // All lines matched — expand anchor range to cover the last paragraph
    const lastNext = matchData[m].next[lines.length - 2];
    fullMatches.push(firstLineMatches[m].expandTo(lastNext.getRange("Content")));
  }

  if (fullMatches.length === 1) {
    return { range: fullMatches[0] };
  }
  if (fullMatches.length > 1) {
    return {
      error: `old_text matched ${fullMatches.length} paragraph spans — it must be unique. Add another paragraph or more of line 1 to disambiguate.`,
      reason: "multi_match",
    };
  }
  return {
    error: firstMismatch
      ? `old_text line ${firstMismatch.line} ("${truncateForDisplay(firstMismatch.expected)}") doesn't match the ${firstMismatch.line === 1 ? "full" : "next"} paragraph ("${truncateForDisplay(firstMismatch.actual)}"). Each \\n-separated line must be one FULL paragraph. Re-read with read_doc_section to get exact paragraph text.`
      : "old_text not found as a contiguous paragraph span.",
    reason: "no_match",
  };
}

// ============================================================================
// Unique Range Finder — `QY` in bundle
// ============================================================================

/**
 * Find a unique range matching oldText. Delegates to DFt for multi-line text
 * or uses oRe + Pk for single-line text. `QY` in bundle.
 */
async function findUniqueRange(
  context: Word.RequestContext,
  oldText: string,
): Promise<{ range: Word.Range } | { error: string; reason: string }> {
  const lines = splitParagraphLines(oldText);
  if (lines.length > 1) return findMultiParagraphRange(context, lines);

  const results = await searchBodyForText(context, lines[0]);
  if ("unsearchable" in results) {
    return { error: results.unsearchable, reason: "unsearchable" };
  }
  const error = validateOldText(oldText, results.length);
  return error
    ? { error, reason: results.length === 0 ? "no_match" : "multi_match" }
    : { range: results[0] };
}

// ============================================================================
// Find-and-Edit Wrapper — `aRe` in bundle
// ============================================================================

/**
 * Core search-and-callback wrapper for edit_doc_text.
 * Validates old_text structurally (preflight), then finds it and calls callback.
 * `aRe` in bundle.
 */
async function findAndEdit<T>(
  oldText: string,
  callback: (range: Word.Range, context: Word.RequestContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { error: string; reason: string }> {
  const preflight = validateOldText(oldText, 1);
  if (preflight) return { error: preflight, reason: "preflight_invalid" };

  return safeOfficeRun(Word.run.bind(Word), async (context) => {
    const searchResult = await findUniqueRange(context, oldText);
    if ("error" in searchResult) return searchResult;
    const value = await callback(searchResult.range, context);
    await context.sync();
    return { ok: true as const, value };
  });
}

// ============================================================================
// Inline Reference Guard — `j5` + `QV` + `pRe` in bundle
// ============================================================================

/**
 * Load inline reference metadata from a range. `j5` in bundle.
 * Gated on feature flags `si.wordRangeFields()` and `si.wordFootnotes()`.
 * Returns null if the feature flag is off (range fields not available).
 */
function loadInlineReferences(range: Word.Range): {
  fields: Word.FieldCollection;
  bookmarks: Word.OfficeExtension.ClientResult<string[]>;
  footnotes: Word.NoteItemCollection | null;
  endnotes: Word.NoteItemCollection | null;
} | null {
  if (!featureFlags.wordRangeFields()) return null;
  const fields = range.fields;
  fields.load("items");
  const bookmarks = range.getBookmarks(true, true);
  const hasFootnotes = featureFlags.wordFootnotes();
  const footnotes = hasFootnotes ? range.footnotes : null;
  const endnotes = hasFootnotes ? range.endnotes : null;
  footnotes?.load("items");
  endnotes?.load("items");
  return { fields, bookmarks, footnotes, endnotes };
}

/**
 * Format inline reference warning message. `QV` in bundle.
 * Returns null if no inline references found, or a descriptive error string.
 */
function formatInlineRefWarning(
  refs: ReturnType<typeof loadInlineReferences>,
): string | null {
  if (!refs) return null;
  const parts: string[] = [];
  if (refs.fields.items.length > 0) {
    parts.push(`${refs.fields.items.length} field(s) (cross-references or page numbers)`);
  }
  if (refs.footnotes && refs.footnotes.items.length > 0) {
    parts.push(`${refs.footnotes.items.length} footnote marker(s)`);
  }
  if (refs.endnotes && refs.endnotes.items.length > 0) {
    parts.push(`${refs.endnotes.items.length} endnote marker(s)`);
  }
  if (refs.bookmarks.value.length > 0) {
    parts.push(`bookmark(s): ${refs.bookmarks.value.join(", ")}`);
  }
  return parts.length === 0
    ? null
    : `old_text overlaps inline references that Replace would destroy: ${parts.join("; ")}. Shorten old_text to the plain-text fragment on ONE side of the reference.`;
}

/**
 * Check inline references on a range, with sync. `pRe` in bundle.
 * Returns full warning string (with fallback hint) or null.
 */
async function checkInlineReferences(
  context: Word.RequestContext,
  range: Word.Range,
): Promise<string | null> {
  const refs = loadInlineReferences(range);
  if (!refs) return null;
  await context.sync();
  const warning = formatInlineRefWarning(refs);
  return warning ? `${warning} ${INLINE_REF_FALLBACK_HINT}` : null;
}

// ============================================================================
// Tracked Change Warning — `uue` in bundle
// ============================================================================

/**
 * After a replacement, check if the edit landed inside a tracked change region.
 * Reads the OOXML of the first paragraph in the range and checks for revision markup.
 * `uue` in bundle. Gated on `si.wordComments()` feature flag.
 *
 * Returns a warning string if tracking is on but no revision markup found
 * (meaning the edit bypassed tracking), or undefined if all is well.
 */
async function checkTrackedChangeWarning(
  context: Word.RequestContext,
  range: Word.Range,
): Promise<string | undefined> {
  if (!featureFlags.wordComments()) return undefined;

  let changeTrackingMode: string;
  let ooxml: string;
  try {
    context.document.load("changeTrackingMode");
    const ooxmlResult = range.paragraphs.getFirst().getOoxml();
    await context.sync();
    changeTrackingMode = context.document.changeTrackingMode;
    ooxml = ooxmlResult.value;
  } catch {
    return undefined;
  }

  if (changeTrackingMode !== "Off" && !TRACKED_CHANGE_OOXML_RE.test(ooxml)) {
    return `TrackedChangeGuard: Track Changes is on (${changeTrackingMode}) but this edit landed without <w:ins>/<w:del> revision markup — it was applied directly, not as a redline. Tell the user the change was made directly instead of as a tracked change, and offer to undo it (Ctrl+Z).`;
  }
  return undefined;
}

// ============================================================================
// Compute Minimal Replace Range — `JY` + `mRe` in bundle
// ============================================================================

/**
 * Given old_text and new_text, compute the minimal diff bounds.
 * `JY` in bundle.
 */
function computeDiffBounds(oldText: string, newText: string): {
  pre: number; suf: number; aMid: string; bMid: string;
} {
  let pre = 0;
  const preLimit = Math.min(oldText.length, newText.length);
  while (pre < preLimit && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  const sufLimit = Math.min(oldText.length - pre, newText.length - pre);
  while (
    suf < sufLimit &&
    oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]
  ) suf++;
  return {
    pre,
    suf,
    aMid: oldText.slice(pre, oldText.length - suf),
    bMid: newText.slice(pre, newText.length - suf),
  };
}

/**
 * Given a matched range and old/new text, compute the narrowest possible
 * replacement (range, text, location) for clean tracked changes.
 * `mRe` in bundle.
 *
 * Strategies:
 * 1. If no common prefix/suffix, full replace.
 * 2. If aMid (changed middle) ≥ 4 chars, sub-search it within the matched range.
 * 3. If aMid is empty and prefix ≥ 4 chars (pure insertion), search for prefix
 *    and use InsertLocation.after.
 * 4. If prefix covers the entire old text (pure append), use InsertLocation.after
 *    on the full range.
 */
async function computeReplaceLocation(
  context: Word.RequestContext,
  matchedRange: Word.Range,
  oldText: string,
  newText: string,
): Promise<{ range: Word.Range; text: string; location: Word.InsertLocation }> {
  const fullReplace = {
    range: matchedRange,
    text: newText,
    location: Word.InsertLocation.replace,
  };

  const { pre, suf, aMid, bMid } = computeDiffBounds(oldText, newText);
  if (pre === 0 && suf === 0) return fullReplace;

  const trySubSearch = async (searchText: string): Promise<Word.Range | null> => {
    if (searchText.length > MAX_ANCHOR_CHARS || searchText.includes("\n")) return null;
    const hits = matchedRange.search(searchText, { matchCase: true });
    hits.load("items");
    await context.sync();
    return hits.items.length === 1 ? hits.items[0] : null;
  };

  // Strategy 2: sub-search the changed middle
  if (aMid.length >= 4) {
    const subRange = await trySubSearch(aMid);
    if (subRange) return { range: subRange, text: bMid, location: Word.InsertLocation.replace };
  } else if (aMid.length === 0 && pre >= 4) {
    // Strategy 3/4: pure insertion
    if (pre === oldText.length) {
      // Entire old text is prefix — append after the full range
      return { range: matchedRange, text: bMid, location: Word.InsertLocation.after };
    }
    const prefixRange = await trySubSearch(oldText.slice(0, pre));
    if (prefixRange) return { range: prefixRange, text: bMid, location: Word.InsertLocation.after };
  }

  return fullReplace;
}

// ============================================================================
// Font Snapshot/Restore — `pUt` / `mUt` in bundle
// ============================================================================

interface FontSnapshot {
  start: number;
  length: number;
  bold: boolean | undefined;
  italic: boolean | undefined;
  underline: string | undefined;
  highlightColor: string | undefined;
}

/**
 * Before a replacement, snapshot the font formatting of the range.
 * `pUt` in bundle. Loads bold, italic, underline, highlightColor.
 */
async function snapshotFontFormatting(
  context: Word.RequestContext,
  range: Word.Range,
): Promise<FontSnapshot[]> {
  range.font.load("bold, italic, underline, highlightColor");
  await context.sync();
  const font = range.font;
  // If font properties are mixed (null), can't snapshot a single value
  if (font.bold !== null && font.italic !== null) {
    return [{
      start: 0,
      length: -1,
      bold: font.bold,
      italic: font.italic,
      underline: font.underline === "Mixed" ? undefined : font.underline,
      highlightColor: font.highlightColor || undefined,
    }];
  }
  return [];
}

/**
 * After replacement, restore font formatting if it was overwritten.
 * `mUt` in bundle.
 */
async function restoreFontFormatting(
  context: Word.RequestContext,
  range: Word.Range,
  snapshots: FontSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) return;
  const snap = snapshots[0];
  if (snap.bold !== undefined) range.font.bold = snap.bold;
  if (snap.italic !== undefined) range.font.italic = snap.italic;
  if (snap.underline !== undefined) range.font.underline = snap.underline as any;
  if (snap.highlightColor !== undefined) range.font.highlightColor = snap.highlightColor;
  await context.sync();
}

// ============================================================================
// Replacement Executor — `gRe` in bundle
// ============================================================================

/**
 * Execute the actual text replacement with font preservation and tracked
 * change detection. `gRe` in bundle.
 *
 * 1. Normalizes \n → \r for Word paragraph marks
 * 2. Snapshots font formatting (for replace operations)
 * 3. Enters tool execution mode (suppresses change detection)
 * 4. Performs the insert
 * 5. Checks for tracked change warning
 * 6. Restores font formatting
 * 7. Returns the resulting range and any warning
 */
async function executeReplacement(
  context: Word.RequestContext,
  spec: { range: Word.Range; text: string; location: Word.InsertLocation },
): Promise<{ range: Word.Range; trackedChangeWarning?: string }> {
  // Normalize newlines for Word
  spec = { ...spec, text: spec.text.replace(/\r?\n/g, "\r") };

  const isReplace = spec.location === Word.InsertLocation.replace;
  const fontSnapshots = isReplace ? await snapshotFontFormatting(context, spec.range) : undefined;

  enterToolExecution(true);
  try {
    let resultRange: Word.Range;
    let trackedChangeWarning: string | undefined;

    if (isReplace) {
      spec.range.insertText(spec.text, Word.InsertLocation.replace);
      await context.sync();
      trackedChangeWarning = await checkTrackedChangeWarning(context, spec.range);

      try {
        await restoreFontFormatting(context, spec.range, fontSnapshots ?? []);
      } catch { /* best-effort */ }

      resultRange = spec.range;
    } else {
      resultRange = spec.range.insertText(spec.text, spec.location);
      await context.sync();
      trackedChangeWarning = await checkTrackedChangeWarning(context, resultRange);
    }

    return { range: resultRange, trackedChangeWarning };
  } finally {
    enterToolExecution(false);
  }
}

// ============================================================================
// Tool: edit_doc_text — `_Ut` in bundle
// ============================================================================

interface EditDocTextResult {
  success: boolean;
  tracked_change_warning?: string;
  result?: {
    replaced: boolean;
    paragraph?: { text: string; styleBuiltIn: string };
  };
  error?: string;
}

/**
 * Main edit_doc_text handler. `_Ut` in bundle.
 */
async function editDocText(params: {
  old_text: string;
  new_text: string;
  explanation?: string;
}): Promise<EditDocTextResult> {
  // _t("doc_edit_received", { tool: "edit_doc_text" });
  const parsed = { parsed: false };
  let applied = false;
  let trackedWarning: string | undefined;

  try {
    const result = await findAndEdit(params.old_text, async (range, context) => {
      parsed.parsed = true;

      // Compute minimal replacement range for clean tracked changes
      const replaceSpec = await computeReplaceLocation(
        context, range, params.old_text, params.new_text,
      );

      // Guard: check for inline references before replacing
      if (replaceSpec.location === Word.InsertLocation.replace) {
        const refWarning = await checkInlineReferences(context, replaceSpec.range);
        if (refWarning) return { refErr: refWarning };
      }

      // Execute the replacement
      const { range: resultRange, trackedChangeWarning } =
        await executeReplacement(context, replaceSpec);
      applied = true;
      trackedWarning = trackedChangeWarning;

      // Read back the result
      const para = resultRange.paragraphs.getFirst();
      para.load("text, styleBuiltIn");

      return { para, trackedChangeWarning };
    });

    if ("error" in result) {
      // _t("doc_edit_parsed", { tool: "edit_doc_text", outcome: result.reason });
      return { success: false, error: result.error };
    }
    if ("refErr" in (result as any).value) {
      // _t("doc_edit_parsed", { tool: "edit_doc_text", outcome: "inline_ref_guard" });
      return { success: false, error: (result as any).value.refErr };
    }

    const { para, trackedChangeWarning } = (result as any).value;
    return {
      success: true,
      ...(trackedChangeWarning && { tracked_change_warning: trackedChangeWarning }),
      result: {
        replaced: true,
        paragraph: { text: para.text, styleBuiltIn: para.styleBuiltIn },
      },
    };
  } catch (err: any) {
    // If the replacement was applied but readback threw, still report success
    if (applied) {
      return {
        success: true,
        ...(trackedWarning && { tracked_change_warning: trackedWarning }),
        result: { replaced: true },
      };
    }
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Tool: edit_doc_list — `CUt`, `AUt`, `kUt` in bundle
// ============================================================================

interface EditDocListResult {
  success: boolean;
  result?: {
    items: Array<{
      text: string;
      isListItem: boolean;
      level: number;
      listString: string;
    }>;
  };
  error?: string;
}

/**
 * Validate edit_doc_list parameters. `Lk` in bundle.
 * Returns error string on failure, or a validated params object on success.
 */
function validateListParams(
  params: any,
  matchCount: number,
  isListItem?: boolean,
): string | { action: string; [key: string]: any } {
  let anchor: string;
  if (params.action === "create_list") {
    const { anchor_text, items, list_style } = params;
    if (!anchor_text || !items || items.length === 0 || items.some((i: string) => !i) || !list_style) {
      return "create_list requires: anchor_text, items (non-empty strings), list_style.";
    }
    anchor = anchor_text;
  } else {
    const { anchor_item_text, new_item_text, position } = params;
    if (!anchor_item_text || !new_item_text || !position) {
      return "insert_item requires: anchor_item_text, new_item_text, position.";
    }
    anchor = anchor_item_text;
  }

  if (anchor.length > MAX_ANCHOR_CHARS) {
    return `Anchor text is ${anchor.length} chars; Word's search API caps at ${MAX_ANCHOR_CHARS}. Use a shorter, still-unique excerpt.`;
  }
  if (matchCount === 0) {
    return "Anchor text not found (curly/straight quote variants are matched automatically). Check exact spelling and whitespace.";
  }
  if (matchCount > 1) {
    return `Anchor text matched ${matchCount} ranges — it must be unique. Add surrounding words.`;
  }
  if (params.action === "insert_item" && isListItem === false) {
    return 'Anchor paragraph is not a list item — insert_item attaches to the anchor\'s list, so the anchor must already be in one. For a new list, use action: "create_list". For custom multi-level numbering, fall back to execute_office_js with the attachToList pattern.';
  }

  // Success: return validated params
  if (params.action === "create_list") {
    return {
      action: "create_list",
      anchor_text: anchor,
      items: params.items,
      list_style: params.list_style,
    };
  }
  return {
    action: "insert_item",
    anchor_item_text: anchor,
    new_item_text: params.new_item_text,
    position: params.position,
  };
}

/** Read back list items after insertion. `vRe` in bundle. */
async function readBackListItems(
  context: Word.RequestContext,
  paragraphs: Word.Paragraph[],
): Promise<Array<{ text: string; isListItem: boolean; level: number; listString: string }>> {
  const listItems = paragraphs.map((p) => {
    p.load("text, isListItem");
    const li = p.listItemOrNullObject;
    li.load("isNullObject, level, listString");
    return li;
  });
  await context.sync();

  return paragraphs.map((p, i) => {
    const li = listItems[i];
    const isNull = li.isNullObject;
    return {
      text: p.text,
      isListItem: p.isListItem,
      listString: isNull ? "" : li.listString,
      level: isNull ? 0 : li.level,
    };
  });
}

/** Create a new list. `AUt` in bundle. */
async function createList(
  context: Word.RequestContext,
  params: { anchor_text: string; items: string[]; list_style: string },
  parsed: { parsed: boolean },
): Promise<EditDocListResult["result"] | { error: string }> {
  const results = await searchBodySimple(context, params.anchor_text);
  const matchCount = results.items.length;

  const validation = validateListParams(params, matchCount);
  if (typeof validation === "string") {
    parsed.parsed = true;
    return { error: validation };
  }

  parsed.parsed = true;
  const anchorPara = results.items[0].paragraphs.getFirst();
  const listStyleName = LIST_STYLE_MAP[params.list_style];

  enterToolExecution(true);
  try {
    const newItems: Word.Paragraph[] = [];
    let current = anchorPara;
    for (const itemText of params.items) {
      const newPara = current.insertParagraph(itemText, Word.InsertLocation.after);
      newPara.style = listStyleName;
      newItems.push(newPara);
      current = newPara;
    }
    await context.sync();
    return { items: await readBackListItems(context, newItems) };
  } finally {
    enterToolExecution(false);
  }
}

/** Insert an item into an existing list. `kUt` in bundle. */
async function insertListItem(
  context: Word.RequestContext,
  params: { anchor_item_text: string; new_item_text: string; position: string },
  parsed: { parsed: boolean },
): Promise<EditDocListResult["result"] | { error: string }> {
  const results = await searchBodySimple(context, params.anchor_item_text);
  const matchCount = results.items.length;

  let validation: string | Record<string, any> = validateListParams(params, matchCount);
  if (typeof validation === "string") {
    parsed.parsed = true;
    return { error: validation };
  }

  const anchorPara = results.items[0].paragraphs.getFirst();
  const list = anchorPara.listOrNullObject;
  const listItem = anchorPara.listItemOrNullObject;
  anchorPara.load("isListItem");
  list.load("isNullObject, id");
  listItem.load("isNullObject, level");
  await context.sync();

  validation = validateListParams(params, results.items.length, anchorPara.isListItem);
  if (typeof validation === "string") {
    parsed.parsed = true;
    return { error: validation };
  }

  parsed.parsed = true;
  enterToolExecution(true);
  try {
    const newPara = anchorPara.insertParagraph(
      params.new_item_text,
      params.position as Word.InsertLocation,
    );
    newPara.load("isListItem");
    await context.sync();

    // If not auto-attached to list, manually attach
    if (!newPara.isListItem) {
      try {
        newPara.attachToList(list.id, listItem.level);
        await context.sync();
      } catch (e) {
        // Attachment failed — clean up and throw
        newPara.delete();
        await context.sync().catch(() => {});
        throw e;
      }
    }

    return { items: await readBackListItems(context, [newPara]) };
  } finally {
    enterToolExecution(false);
  }
}

/** Main edit_doc_list handler. `CUt` in bundle. */
async function editDocList(params: {
  action: "create_list" | "insert_item";
  anchor_text?: string;
  items?: string[];
  list_style?: string;
  anchor_item_text?: string;
  new_item_text?: string;
  position?: string;
  explanation?: string;
}): Promise<EditDocListResult> {
  // _t("doc_edit_received", { tool: "edit_doc_list" });
  const parsed = { parsed: false };

  // Preflight validation (pass matchCount=1 so it only checks structural issues)
  const preflight = validateListParams(params, 1);
  if (typeof preflight === "string") {
    return { success: false, error: preflight };
  }

  try {
    const result = await safeOfficeRun(Word.run.bind(Word), async (context) =>
      preflight.action === "create_list"
        ? await createList(context, preflight as any, parsed)
        : await insertListItem(context, preflight as any, parsed),
    );

    if ("error" in result) return { success: false, error: result.error };

    const failedItems = result.items.filter((i) => !i.isListItem);
    if (failedItems.length > 0) {
      return {
        success: false,
        error: `List attachment failed — ${failedItems.length} of ${result.items.length} item(s) came back without a list marker (the text was inserted as plain paragraphs; check result.items and undo or delete before retrying). Word may have rejected the style or the anchor's list uses a custom scheme this tool doesn't handle. Fall back to execute_office_js with the attachToList pattern.`,
        result,
      };
    }

    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Tool: collapse_blank_paragraphs — `xUt` + `vUt` in bundle
// ============================================================================

/**
 * Compute indices to delete from a boolean "is blank" array.
 * `vUt` in bundle. Returns indices in reverse order.
 */
function computeDeleteIndices(isBlank: boolean[], maxConsecutive: number): number[] {
  const toDelete: number[] = [];
  let runLength = 0;
  for (let i = 0; i < isBlank.length; i++) {
    if (isBlank[i]) {
      runLength++;
      if (runLength > maxConsecutive) toDelete.push(i);
    } else {
      runLength = 0;
    }
  }
  return toDelete.reverse();
}

/**
 * Collapse runs of consecutive empty paragraphs. `xUt` in bundle.
 *
 * Preserves paragraphs that are text-empty but carry structural content by
 * checking OOXML for drawing, pictures, objects, section breaks, bookmarks,
 * tracked changes, and comment anchors. Also preserves list items and
 * table-cell paragraphs.
 *
 * Deletes in reverse-index-order batches of 20 with OOXML structural check
 * and a sync between each batch.
 */
async function collapseBlankParagraphs(params: {
  max_consecutive?: number;
  explanation?: string;
}): Promise<{ success: boolean; result?: any; error?: string }> {
  const maxConsecutive = params.max_consecutive ?? 1;

  try {
    return await safeOfficeRun(Word.run.bind(Word), async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text, items/isListItem");
      await context.sync();

      // Also check if paragraph is in a table
      const tableChecks = paragraphs.items.map((p) => {
        const table = p.parentTableOrNullObject;
        table.load("isNullObject");
        return table;
      });
      await context.sync();

      // Build blank array: text-empty AND not a list item AND not in a table
      const isBlank = paragraphs.items.map((p, i) =>
        p.text.trim() === "" && !p.isListItem && tableChecks[i].isNullObject,
      );

      const toDelete = computeDeleteIndices(isBlank, maxConsecutive);
      if (toDelete.length === 0) {
        return {
          success: true,
          result: { deleted: 0, scanned: isBlank.length, skipped_with_content: 0 },
        };
      }

      enterToolExecution(true);
      let deleted = 0;
      let skippedWithContent = 0;

      try {
        for (let batchStart = 0; batchStart < toDelete.length; batchStart += BLANK_PARA_BATCH_SIZE) {
          const batch = toDelete.slice(batchStart, batchStart + BLANK_PARA_BATCH_SIZE);

          // Get OOXML for each paragraph in the batch
          const ooxmlResults = batch.map((idx) => paragraphs.items[idx].getOoxml());
          await context.sync();

          // Filter: only delete paragraphs whose OOXML has no structural content
          const safeToDelete: number[] = [];
          for (let i = 0; i < batch.length; i++) {
            const paraXml = ooxmlResults[i].value.match(/<w:p[\s>][\s\S]*<\/w:p>/)?.[0] ?? "";
            if (OOXML_STRUCTURAL_RE.test(paraXml)) {
              skippedWithContent++;
            } else {
              safeToDelete.push(batch[i]);
            }
          }

          for (const idx of safeToDelete) {
            paragraphs.items[idx].delete();
          }
          if (safeToDelete.length > 0) await context.sync();
          deleted += safeToDelete.length;
        }
      } finally {
        enterToolExecution(false);
      }

      return {
        success: true,
        result: { deleted, scanned: isBlank.length, skipped_with_content: skippedWithContent },
      };
    });
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Tool: read_doc_section — `dUt` helper + handler in `bUt`
// ============================================================================

/**
 * Compute the paragraph range for a heading or paragraph_start/end query.
 * `dUt` in bundle.
 */
function computeSectionRange(
  paragraphs: Array<{ text: string; styleBuiltIn: string }>,
  params: { heading?: string; paragraph_start?: number; paragraph_end?: number },
): { start: number; end: number } | { error: string } {
  if (params.heading !== undefined) {
    const headingText = params.heading.trim();
    const headingLower = headingText.toLowerCase();
    const stripNumbering = (t: string) => t.replace(/^(\d+\.)+\d*\s+/, "");

    let exactIdx = -1;
    let exactLevel = 0;
    let fuzzyIdx = -1;
    let fuzzyLevel = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const level = parseHeadingLevel(paragraphs[i].styleBuiltIn);
      if (level === null || level > MAX_OUTLINE_HEADING_LEVEL) continue;
      const paraText = paragraphs[i].text.trim();
      if (paraText === headingText) {
        exactIdx = i;
        exactLevel = level;
        break;
      }
      if (fuzzyIdx === -1 && stripNumbering(paraText).toLowerCase() === headingLower) {
        fuzzyIdx = i;
        fuzzyLevel = level;
      }
    }

    // Fall back to fuzzy match if no exact match
    if (exactIdx === -1 && fuzzyIdx !== -1) {
      exactIdx = fuzzyIdx;
      exactLevel = fuzzyLevel;
    }

    if (exactIdx === -1) {
      return {
        error: `Heading "${headingText}" not found. Check the heading outline in <doc_state> for exact text.`,
      };
    }

    // Find next heading of same or higher level
    let endIdx = paragraphs.length;
    for (let i = exactIdx + 1; i < paragraphs.length; i++) {
      const level = parseHeadingLevel(paragraphs[i].styleBuiltIn);
      if (level !== null && level <= exactLevel) {
        endIdx = i;
        break;
      }
    }

    return { start: exactIdx, end: endIdx };
  }

  if (params.paragraph_start !== undefined) {
    const start = params.paragraph_start;
    const end = params.paragraph_end ?? start + 1;

    if (start < 0 || start >= paragraphs.length) {
      return { error: `paragraph_start ${start} is out of range (document has ${paragraphs.length} paragraphs).` };
    }
    if (end <= start) {
      return { error: `paragraph_end ${end} must be greater than paragraph_start ${start}.` };
    }
    if (end > paragraphs.length) {
      return { error: `paragraph_end ${end} is out of range (document has ${paragraphs.length} paragraphs).` };
    }
    return { start, end };
  }

  return { error: "Provide either heading or paragraph_start." };
}

/**
 * read_doc_section handler. In `bUt` object in bundle.
 */
async function readDocSection(params: {
  heading?: string;
  paragraph_start?: number;
  paragraph_end?: number;
  explanation?: string;
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    return await safeOfficeRun(Word.run.bind(Word), async (context) => {
      const paragraphs = context.document.body.paragraphs;
      const byHeading = params.heading !== undefined;
      paragraphs.load(byHeading ? "items/text, items/styleBuiltIn" : "items/text");
      await context.sync();

      const paraData = paragraphs.items.map((p) => ({
        text: p.text,
        styleBuiltIn: byHeading ? p.styleBuiltIn : "",
      }));

      const range = computeSectionRange(paraData, params);
      if ("error" in range) return { success: false, error: range.error };

      const slice = paraData.slice(range.start, range.end);
      let text = "";
      let count = 0;

      for (let i = 0; i < slice.length; i++) {
        const line = `${i > 0 ? "\n" : ""}[${range.start + i}] ${slice[i].text}`;
        if (text.length + line.length > MAX_READ_CHARS && count > 0) break;
        text += line;
        count++;
      }

      const charTruncated = text.length > MAX_READ_CHARS;
      if (charTruncated) text = text.slice(0, MAX_READ_CHARS);

      const notes: string[] = [];
      if (charTruncated) {
        notes.push(
          `Paragraph ${range.start + count - 1} exceeds ${MAX_READ_CHARS} chars and was character-truncated; use body.search() on a phrase near the cutoff in execute_office_js to read past it.`,
        );
      }
      if (count < slice.length) {
        notes.push(
          `Section spans ${slice.length} paragraphs (indices ${range.start}..${range.end - 1}); showing first ${count}. Call again with paragraph_start=${range.start + count}, paragraph_end=${range.end} to read the rest.`,
        );
      }
      const truncated = notes.length > 0 ? notes.join(" ") : undefined;

      return {
        success: true,
        result: {
          paragraphStart: range.start,
          paragraphEnd: range.start + count,
          paragraphCount: count,
          text,
          truncated,
        },
      };
    });
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Tool: verify_doc — structural check. `uUt` helper + handler in `bUt`.
// ============================================================================

/**
 * Format verify_doc results. `uUt` in bundle.
 */
function formatVerifyDocResult(
  paraData: Array<{ style: string; listItem: { level: number; listString: string } | null }>,
  tableData: Array<{ cellsPerRow: number[] }>,
): { styles: Record<string, number>; lists: any[]; tables: any[] } {
  const styles: Record<string, number> = {};
  for (const p of paraData) styles[p.style] = (styles[p.style] ?? 0) + 1;

  const lists: any[] = [];
  paraData.forEach((p, i) => {
    if (p.listItem) {
      lists.push({
        paraIndex: i,
        level: p.listItem.level,
        listString: p.listItem.listString,
      });
    }
  });

  const tables = tableData.map((t, i) => ({
    tableIndex: i,
    rowCount: t.cellsPerRow.length,
    cellsPerRow: t.cellsPerRow,
    uniform: t.cellsPerRow.length > 0 && t.cellsPerRow.every((c) => c === t.cellsPerRow[0]),
  }));

  return { styles, lists, tables };
}

/**
 * verify_doc handler. In `bUt` object in bundle.
 */
async function verifyDoc(params: {
  explanation?: string;
}): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const result = await safeOfficeRun(Word.run.bind(Word), async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      const tables = body.tables;

      paragraphs.load("items/style");
      tables.load("items/rows/items/cellCount");
      await context.sync();

      // Load list items in a second sync
      const listItems = paragraphs.items.map((p) => {
        const li = p.listItemOrNullObject;
        li.load("isNullObject, level, listString");
        return li;
      });
      await context.sync();

      const paraData = paragraphs.items.map((p, i) => ({
        style: p.style,
        listItem: listItems[i].isNullObject
          ? null
          : { level: listItems[i].level, listString: listItems[i].listString },
      }));

      const tableData = tables.items.map((t) => ({
        cellsPerRow: t.rows.items.map((r) => r.cellCount),
      }));

      return formatVerifyDocResult(paraData, tableData);
    });

    return { success: true, result: JSON.parse(JSON.stringify(result)) };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Tool: verify_doc_visual — PDF export + client-side LLM call
// ============================================================================

/** Export document slices via Office.getFileAsync. `gSe` in bundle. */
async function exportFileAsSlices(fileType: Office.FileType): Promise<ArrayBuffer[]> {
  const file: Office.File = await new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(fileType, {}, (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) return reject(result.error);
      resolve(result.value);
    });
  });

  try {
    const slices: ArrayBuffer[] = [];
    for (let i = 0; i < file.sliceCount; i++) {
      const slice: ArrayBuffer = await new Promise((resolve, reject) => {
        file.getSliceAsync(i, (result) => {
          if (result.status !== Office.AsyncResultStatus.Succeeded) return reject(result.error);
          resolve(result.value.data);
        });
      });
      slices.push(slice);
    }
    return slices;
  } finally {
    file.closeAsync();
  }
}

/** Export document as PDF and return base64 string. `kvt` in bundle. */
async function exportPdfAsBase64(): Promise<string> {
  const slices = await exportFileAsSlices(Office.FileType.Pdf);
  const totalLength = slices.reduce((sum, s) => sum + s.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const slice of slices) {
    merged.set(new Uint8Array(slice), offset);
    offset += slice.byteLength;
  }
  // Convert to base64 in chunks to avoid call-stack limits
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < merged.length; i += chunkSize) {
    binary += String.fromCharCode(...merged.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** System prompt for the visual verifier. `cUt` in bundle — verbatim. */
const VERIFY_DOC_VISUAL_SYSTEM_PROMPT = `Inspect this Word document's rendered appearance. Assume there are formatting issues — find them.

Look for:
- Font inconsistency: a paragraph that's Calibri in a sea of Times, or a size jump mid-section
- Style breaks: inserted text that looks like "Normal" when surrounding paragraphs are styled headings or body text
- Numbering/bullet breaks: a list item that lost its marker, or (a)(b) that restarted as (1)(2)
- Table reflow: columns that shifted width or wrapped unexpectedly after a cell edit
- Orphaned formatting: a bold or italic run that extends past where it should stop
- Spacing anomalies: double blank lines, a paragraph jammed against the one above, inconsistent indent
- Tracked-change rendering: insertions/deletions that look garbled or overlap with normal text

If a specific page or section was called out, focus there first but still scan adjacent pages for collateral damage.

Report each issue with its page number and a one-line description. If the document looks clean, say so.`;

/**
 * verify_doc_visual handler. In `bUt` object in bundle.
 * Exports PDF, sends to a fresh Claude call with the PDF as a document attachment.
 * Uses `zD()` for the Anthropic client, `Zt.getState().model` for the model.
 */
async function verifyDocVisual(params: {
  page_hint?: string;
  explanation?: string;
}): Promise<{ success: boolean; details?: string; error?: string }> {
  let pdfBase64: string;
  try {
    pdfBase64 = await exportPdfAsBase64();
  } catch (err: any) {
    return {
      success: false,
      error: `PDF export failed (not supported on Word for Web): ${err?.message ?? String(err)}`,
    };
  }

  const client = getAnthropicClient(); // zD()
  const model = getActiveModel();       // Zt.getState().model

  const content: any[] = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
    },
  ];
  if (params.page_hint) {
    content.push({ type: "text", text: `Focus area: ${params.page_hint}` });
  }

  const messages = [{ role: "user", content }];
  const response = await client.messages
    .stream({
      model,
      max_tokens: 2000,
      system: VERIFY_DOC_VISUAL_SYSTEM_PROMPT,
      messages,
    })
    .finalMessage();

  return {
    success: true,
    details: response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n"),
  };
}

// ============================================================================
// Tool: explain_edits — legal reasoning verifier (client-side LLM call)
// ============================================================================

/** System prompt for the skeptical verifier. `JFt` in bundle — verbatim. */
const EXPLAIN_EDITS_VERIFIER_PROMPT = `You are a skeptical reviewer checking a drafting assistant's PLANNED edits. The assistant has not yet modified the document — these are proposed changes with stated justifications. You have the document as it currently stands, its pending tracked changes, any loaded skill content, and the user's standing instructions. You do NOT know what task the assistant was given — check only whether its stated claims are true.

For each claim, based on its basis:
- document_text: Find the referenced passage in <document_text>. Quote it. Does it say what the claim asserts?
- tracked_change: Find the referenced revision in <tracked_changes_at_turn_start>. Quote it. Does it propose what the claim asserts?
- skill_instruction: Find the relevant instruction in the named skill. Quote it. Does it instruct what the claim asserts?
- user_instruction: Find the relevant rule in the user's standing instructions. Quote it. Does it say what the claim asserts?
- external_law: Search for the cited authority. Does it exist? Does it support the stated proposition?
- model_judgment: Skip — these are opinions, not facts.

If a claim references a skill or instruction source that is NOT in the context you received, return could_not_verify with note "source not loaded" — do not return not_found (that means you looked and the source doesn't support the claim, which is different).

Be adversarial. Your job is to find where the assistant is wrong. If you cannot locate the source for a claim, return not_found — do not assume it exists. If the source exists but doesn't support the claim, return contradicted.

Return ONLY a JSON array, one object per claim, in the same order as the input:
[
  {"verdict": "verified" | "contradicted" | "not_found" | "could_not_verify", "quote": "...", "note": "..."},
  ...
]

The quote field is the exact text from the source that grounds (or contradicts) the claim. Keep quotes under 200 characters. The note field is optional context (one line max).`;

/**
 * Gather context for the verifier. `QFt` in bundle.
 */
async function gatherVerifierContext(
  requestedSkillNames: string[],
): Promise<{
  documentText: string;
  trackedChanges: Array<{ author: string; type: string; text: string }>;
  skills: Record<string, string>;
  userInstructions: string;
}> {
  const documentText = await safeOfficeRun(Word.run.bind(Word), async (ctx) => {
    const body = ctx.document.body;
    body.load("text");
    await ctx.sync();
    return body.text;
  });

  const trackedChanges = getDocStateSnapshot()?.trackedChanges ?? [];

  const allSkills = getStoreState().skills ?? [];
  const skillDownloads = getStoreState().skillDownloads ?? {};
  const skills: Record<string, string> = {};
  for (const name of requestedSkillNames) {
    const decoded = name.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const skill = allSkills.find((s: any) => s.name === decoded && s.enabled)
      ?? allSkills.find((s: any) => s.name === name && s.enabled);
    if (!skill) continue;
    const content = skillDownloads[skill.id]?.instructions ?? skill.instructions;
    if (content) skills[name] = content;
  }

  const userInstructions = getSettingsState().getAlwaysOnInstructions("doc");

  return { documentText, trackedChanges, skills, userInstructions };
}

/**
 * Format the verifier's user message from gathered context + claims.
 * `eUt` in bundle.
 */
function buildVerifierMessage(
  context: Awaited<ReturnType<typeof gatherVerifierContext>>,
  claims: Array<{ claim: string; basis: string; reference?: string; skill_name?: string }>,
): string {
  const sections: string[] = [];

  sections.push(`<document_text>\n${context.documentText}\n</document_text>`);

  if (context.trackedChanges.length > 0) {
    const lines = context.trackedChanges.map(
      (tc, i) => `[revision ${i}] ${tc.author} ${tc.type}: "${tc.text.slice(0, 200)}"`,
    );
    sections.push(`<tracked_changes_at_turn_start>\n${lines.join("\n")}\n</tracked_changes_at_turn_start>`);
  }

  for (const [name, content] of Object.entries(context.skills)) {
    sections.push(`<skill name="${name}">\n${content}\n</skill>`);
  }

  if (context.userInstructions) {
    sections.push(`<user_instructions>\n${context.userInstructions}\n</user_instructions>`);
  }

  const claimLines = claims.map((c, i) => {
    const ref = c.reference ? `, ref=${c.reference}` : "";
    const skill = c.skill_name ? `, skill=${c.skill_name}` : "";
    return `${i + 1}. [basis=${c.basis}${ref}${skill}] ${c.claim}`;
  });
  sections.push(`<claims_to_verify>\n${claimLines.join("\n")}\n</claims_to_verify>`);

  return sections.join("\n\n");
}

/**
 * Parse the verifier's JSON response. `nUt` in bundle.
 */
function parseVerifierResponse(
  text: string,
  expectedCount: number,
): Array<{ verdict: string; quote?: string; note?: string }> {
  const fallback = Array.from({ length: expectedCount }, () => ({
    verdict: "could_not_verify" as const,
    note: "verifier returned malformed output",
  }));

  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "");
  const arrayStart = cleaned.search(/\[\s*\{/);
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd <= arrayStart) return fallback;

  const jsonStr = cleaned.slice(arrayStart, arrayEnd + 1);
  let parsed: any[];
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    try {
      parsed = JSON.parse(fixMalformedJson(jsonStr));
    } catch {
      return fallback;
    }
  }

  if (!Array.isArray(parsed)) return fallback;

  const validVerdicts = new Set(["verified", "contradicted", "not_found", "could_not_verify"]);
  return Array.from({ length: expectedCount }, (_, i) => {
    const item = parsed[i];
    if (!item || !validVerdicts.has(item.verdict)) return { verdict: "could_not_verify" };
    return { verdict: item.verdict, quote: item.quote, note: item.note };
  });
}

/**
 * Run the verifier: gather context, make LLM call, parse response.
 * `tUt` in bundle. If any claims have basis="external_law" and web search
 * is enabled, the verifier gets access to web_search tool (max 5 uses).
 */
async function runVerifier(
  context: Awaited<ReturnType<typeof gatherVerifierContext>>,
  allGrounding: Array<{ claim: string; basis: string; reference?: string; skill_name?: string }>,
): Promise<Array<{ claim: string; basis: string; verdict: string; quote?: string; note?: string }>> {
  const checkable = allGrounding.filter((g) => g.basis !== "model_judgment");
  if (checkable.length === 0) {
    return allGrounding.map((g) => ({ ...g, verdict: "not_checked" }));
  }

  const client = getAnthropicClient();
  const model = getActiveModel();

  const tools = checkable.some((g) => g.basis === "external_law") && isWebSearchEnabled()
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
    : undefined;

  const messages = [{
    role: "user",
    content: [{ type: "text", text: buildVerifierMessage(context, checkable) }],
  }];

  const response = await client.messages
    .stream({
      model,
      max_tokens: 4000,
      system: EXPLAIN_EDITS_VERIFIER_PROMPT,
      messages,
      ...(tools ? { tools } : {}),
    })
    .finalMessage();

  const responseText = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  const verdicts = parseVerifierResponse(responseText, checkable.length);

  let checkableIdx = 0;
  return allGrounding.map((g) => {
    if (g.basis === "model_judgment") {
      return { claim: g.claim, basis: g.basis, verdict: "not_checked" };
    }
    const v = verdicts[checkableIdx++];
    return { claim: g.claim, basis: g.basis, ...v };
  });
}

/**
 * Main explain_edits handler. `iUt` in bundle.
 */
async function explainEdits(params: {
  edits: Array<{
    location: string;
    change_summary: string;
    proposed_text?: string | null;
    reasoning: string;
    grounding: Array<{ claim: string; basis: string; reference?: string; skill_name?: string }>;
    confidence: string;
    open_question?: string;
  }>;
  explanation?: string;
}): Promise<{ success: boolean; edits: any[]; has_unverified_claims: boolean; error?: string }> {
  try {
    const skillNames = Array.from(new Set(
      params.edits.flatMap((e) =>
        e.grounding
          .filter((g) => g.basis === "skill_instruction" && g.skill_name)
          .map((g) => g.skill_name!),
      ),
    ));

    const context = await gatherVerifierContext(skillNames);
    const allGrounding = params.edits.flatMap((e) => e.grounding);
    const allVerdicts = await runVerifier(context, allGrounding);

    let offset = 0;
    const editsWithVerdicts = params.edits.map((edit) => {
      const editVerdicts = allVerdicts.slice(offset, offset + edit.grounding.length);
      offset += edit.grounding.length;
      return { ...edit, verdicts: editVerdicts };
    });

    const hasUnverified = allVerdicts.some(
      (v) => v.verdict !== "verified" && v.verdict !== "not_checked",
    );

    return { success: true, edits: editsWithVerdicts, has_unverified_claims: hasUnverified };
  } catch (err: any) {
    return {
      success: false,
      edits: [],
      has_unverified_claims: true,
      error: err?.message ?? String(err),
    };
  }
}

// ============================================================================
// Tool: propose_doc_edits — `lUt` in bundle
// ============================================================================

/**
 * propose_doc_edits handler. `lUt` in bundle.
 *
 * Validates every old_text is uniquely findable NOW (at propose time),
 * with batched search for simple edits and sequential QY for complex
 * (multi-paragraph) edits. Also checks inline references on the diff
 * sub-range (computed across ALL alternatives, not just new_text).
 *
 * Does NOT modify the document — stages each edit as a UI card.
 */
async function proposeDocEdits(params: {
  edits: Array<{
    id: string;
    section: string;
    location?: string;
    change_summary: string;
    old_text: string;
    new_text: string;
    new_text_label?: string;
    alternatives?: Array<{ label: string; text: string }>;
    context_before?: string;
    context_after?: string;
    reasoning?: string;
  }>;
  explanation?: string;
}): Promise<{ success: boolean; result?: any; error?: string }> {
  // Step 1: Preflight validation (structural checks only, matchCount=1)
  const preflightErrors = params.edits
    .map((e) => ({ id: e.id, error: validateOldText(e.old_text, 1) }))
    .filter((e) => e.error !== null);
  const preflightFailedIds = new Set(preflightErrors.map((e) => e.id));

  // Split remaining edits into simple (single-line ≤255 chars) and complex
  const validEdits = params.edits.filter((e) => !preflightFailedIds.has(e.id));
  const simpleEdits = validEdits.filter((e) => isSimpleOldText(e.old_text));
  const complexEdits = validEdits.filter((e) => !isSimpleOldText(e.old_text));

  let allInvalid = preflightErrors;
  let passedEdits = validEdits;

  if (validEdits.length > 0) {
    try {
      const { counts, refErrors, complexErrors } = await safeOfficeRun(
        Word.run.bind(Word),
        async (context) => {
          // --- Complex edits: sequential QY ---
          const complexErrorMap = new Map<string, string>();
          const complexRangeMap = new Map<string, Word.Range>();
          for (const edit of complexEdits) {
            const result = await findUniqueRange(context, edit.old_text);
            if ("error" in result) {
              complexErrorMap.set(edit.id, result.error);
            } else {
              complexRangeMap.set(edit.id, result.range);
            }
          }

          // --- Simple edits: batched body.search ---
          const simpleSearchResults = simpleEdits.map((e) => {
            const r = context.document.body.search(e.old_text, { matchCase: true });
            r.load("items");
            return r;
          });
          await context.sync();

          const simpleCounts = simpleSearchResults.map((r) => r.items.length);

          // Smart-quote fallback for simple edits with 0 matches
          const smartFallbacks = simpleEdits.map((e, i) => {
            if (simpleCounts[i] !== 0) return null;
            const smart = normalizeToSmartPunct(e.old_text);
            if (smart === e.old_text) return null;
            const r = context.document.body.search(smart, { matchCase: true });
            r.load("items");
            return r;
          });
          const usedSmart = simpleEdits.map(() => false);

          if (smartFallbacks.some((f) => f !== null)) {
            await context.sync();
            for (let i = 0; i < smartFallbacks.length; i++) {
              const fb = smartFallbacks[i];
              if (fb && fb.items.length > 0) {
                simpleSearchResults[i] = fb;
                simpleCounts[i] = fb.items.length;
                usedSmart[i] = true;
              }
            }
          }

          // --- Compute diff bounds across ALL alternatives for each edit ---
          const computeMinDiff = (edit: typeof simpleEdits[0]) => {
            const allTexts = [
              edit.new_text,
              ...(edit.alternatives ?? []).map((a) => a.text),
            ];
            let minPre = Infinity;
            let minSuf = Infinity;
            for (const t of allTexts) {
              const d = computeDiffBounds(edit.old_text, t);
              minPre = Math.min(minPre, d.pre);
              minSuf = Math.min(minSuf, d.suf);
            }
            return {
              aMid: edit.old_text.slice(minPre, edit.old_text.length - minSuf),
              pre: minPre,
              suf: minSuf,
            };
          };

          const simpleDiffs = simpleEdits.map(computeMinDiff);

          // Sub-search within matched ranges for inline ref checking (simple edits)
          const simpleSubSearches = simpleSearchResults.map((r, i) => {
            if (simpleCounts[i] !== 1) return null;
            const { aMid, pre } = simpleDiffs[i];
            const searchText = aMid.length >= 4
              ? aMid
              : (aMid.length === 0 && pre >= 4)
                ? simpleEdits[i].old_text.slice(0, pre)
                : null;
            if (!searchText) return null;
            const actualSearch = usedSmart[i] ? normalizeToSmartPunct(searchText) : searchText;
            const sub = r.items[0].search(actualSearch, { matchCase: true });
            sub.load("items");
            return sub;
          });

          // Sub-search for complex edits inline ref checking
          const complexProbes = complexEdits.flatMap((edit) => {
            const range = complexRangeMap.get(edit.id);
            if (!range) return [];
            const { aMid, pre } = computeMinDiff(edit);
            const searchText = aMid.length >= 4
              ? aMid
              : (aMid.length === 0 && pre >= 4)
                ? edit.old_text.slice(0, pre)
                : null;
            if (!searchText || searchText.length > MAX_ANCHOR_CHARS || searchText.includes("\n")) {
              return [{ id: edit.id, inner: null as any, innerSmart: null as any }];
            }
            const inner = range.search(searchText, { matchCase: true });
            inner.load("items");
            const smartSearch = normalizeToSmartPunct(searchText);
            let innerSmart: Word.RangeCollection | null = null;
            if (smartSearch !== searchText) {
              innerSmart = range.search(smartSearch, { matchCase: true });
              innerSmart.load("items");
            }
            return [{ id: edit.id, inner, innerSmart }];
          });

          if (simpleSubSearches.some((s) => s !== null) || complexProbes.some((p) => p.inner)) {
            await context.sync();
          }

          // Load inline references on the narrowest available range (simple)
          const simpleRefProbes = simpleSearchResults.map((r, i) => {
            if (simpleCounts[i] !== 1) return null;
            const { aMid, pre } = simpleDiffs[i];
            // Pure append — no risk to inline refs
            if (aMid.length === 0 && pre === simpleEdits[i].old_text.length) return null;
            const sub = simpleSubSearches[i];
            const subRange = sub?.items.length === 1 ? sub.items[0] : null;
            if (aMid.length === 0 && pre >= 4 && subRange) return null; // pure insertion after prefix
            return aMid.length >= 4 && subRange
              ? loadInlineReferences(subRange)
              : loadInlineReferences(r.items[0]);
          });

          // Load inline references for complex edits
          const complexRefProbes = complexProbes.flatMap((probe) => {
            const edit = complexEdits.find((e) => e.id === probe.id)!;
            const { aMid, pre } = computeMinDiff(edit);
            if (aMid.length === 0 && pre === edit.old_text.length) return [];
            const innerRange = probe.inner?.items.length === 1
              ? probe.inner.items[0]
              : probe.innerSmart?.items.length === 1
                ? probe.innerSmart.items[0]
                : null;
            if (aMid.length === 0 && pre >= 4 && innerRange) return [];
            const target = aMid.length >= 4 && innerRange
              ? innerRange
              : complexRangeMap.get(probe.id);
            return target ? [{ id: probe.id, probe: loadInlineReferences(target) }] : [];
          });

          if (simpleRefProbes.some((p) => p !== null) || complexRefProbes.some((p) => p.probe !== null)) {
            await context.sync();
          }

          // Collect inline ref errors for complex edits
          for (const { id, probe } of complexRefProbes) {
            const warning = formatInlineRefWarning(probe);
            if (warning) complexErrorMap.set(id, warning);
          }

          return {
            counts: simpleCounts,
            refErrors: simpleRefProbes.map(formatInlineRefWarning),
            complexErrors: complexErrorMap,
          };
        },
      );

      // Merge errors from simple edits
      const simpleErrors = simpleEdits
        .map((e, i) => ({
          id: e.id,
          error: validateOldText(e.old_text, counts[i]) ?? refErrors[i],
        }))
        .filter((e) => e.error !== null);

      // Merge errors from complex edits
      const complexErrorsList = [...complexErrors].map(([id, error]) => ({ id, error }));

      const failedIds = new Set([...simpleErrors, ...complexErrorsList].map((e) => e.id));
      allInvalid = [...preflightErrors, ...simpleErrors, ...complexErrorsList];
      passedEdits = validEdits.filter((e) => !failedIds.has(e.id));
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  }

  // Append re-propose suffix to all error messages
  allInvalid = allInvalid.map((e) => ({ ...e, error: `${e.error} ${REPROPOSE_SUFFIX}` }));

  if (passedEdits.length === 0) {
    return {
      success: false,
      error: "No proposed edits passed validation. Failures: " +
        allInvalid.map((e) => `${e.id}: ${e.error}`).join("; "),
    };
  }

  const sections = Array.from(new Set(passedEdits.map((e) => e.section)));
  return {
    success: true,
    result: {
      pending_review: true,
      edits: passedEdits,
      sections,
      invalid_edits: allInvalid.length > 0 ? allInvalid : undefined,
    },
  };
}

// ============================================================================
// Stub references — these access app-level singletons in the bundle
// ============================================================================

/** `zD()` — returns the Anthropic SDK client instance */
declare function getAnthropicClient(): any;
/** `Zt.getState().model` — the currently active model name */
declare function getActiveModel(): string;
/** `G5e()` — whether web search is enabled */
declare function isWebSearchEnabled(): boolean;
/** `rvt()` — doc state snapshot including tracked changes */
declare function getDocStateSnapshot(): any;
/** `Wt.getState()` — Zustand store for skills/downloads */
declare function getStoreState(): any;
/** `Zt.getState()` — Zustand store for settings */
declare function getSettingsState(): any;
/** `fRe()` — fix malformed JSON (trailing commas, etc.) */
declare function fixMalformedJson(json: string): string;
/** `si` — feature flags object */
declare const featureFlags: {
  wordRangeFields(): boolean;
  wordFootnotes(): boolean;
  wordComments(): boolean;
};

// ============================================================================
// Schema Transform: XY() — universal explanation field injection
// ============================================================================

/**
 * `XY()` in bundle — converts a Zod schema to JSON Schema and injects
 * the `explanation` field into every custom tool's properties.
 *
 * ```js
 * function XY(t) {
 *   const e = Cf(t, { io: "input" }),       // Zod → JSON Schema
 *     { $schema: n, additionalProperties: r, ...i } = e;
 *   return (
 *     i.required || (i.required = []),
 *     i.type || (i.type = "object"),
 *     i.properties || (i.properties = {}),
 *     (i.properties.explanation = {
 *       type: "string",
 *       maxLength: 50,
 *       description: "A very brief description of the action (max 50 chars). Shown next to the tool icon & permission prompts.",
 *     }),
 *     i
 *   );
 * }
 * ```
 */

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Word-specific tools registered in `yRe` object + `bUt` function.
 *
 * The full tool list for Word surface:
 * - verify_doc         — structural check (no LLM)
 * - verify_doc_visual  — PDF export + visual reviewer (sub-agent)
 * - edit_doc_text      — surgical text replacement
 * - edit_doc_list      — list creation/insertion
 * - read_doc_section   — read by heading or paragraph range
 * - read_attachment_pages — read PDF pages with visual fidelity
 * - collapse_blank_paragraphs — batch blank paragraph cleanup
 * - explain_edits      — legal reasoning verifier (sub-agent)
 * - propose_doc_edits  — stage edits for user review
 * - execute_office_js  — free-form Office.js (shared, sandboxed via SES)
 * - store_blob         — fetch files into blob store
 * - bash               — sandboxed read-only shell (conductor VFS)
 * - get_connected_agents — list conductor peers
 * - send_message       — message a conductor peer
 *
 * All tools receive `explanation` via XY() schema injection.
 *
 * Tool handlers in `bUt` are wrapped:
 * - edit_doc_text, edit_doc_list, collapse_blank_paragraphs go through
 *   `vC()` (serializedEdit) for chain-based serialization with timeouts.
 * - explain_edits wraps result in { success, result, error }.
 * - propose_doc_edits is called directly.
 */
export function createToolHandlers() {
  return {
    verify_doc: verifyDoc,
    verify_doc_visual: verifyDocVisual,
    read_doc_section: readDocSection,
    collapse_blank_paragraphs: (params: any) =>
      serializedEdit(() => collapseBlankParagraphs(params), EDIT_CHAIN_TIMEOUT_MS),
    edit_doc_text: (params: any) =>
      serializedEdit(() => editDocText(params)),
    edit_doc_list: (params: any) =>
      serializedEdit(() => editDocList(params)),
    explain_edits: async (params: any) => {
      const result = await explainEdits(params);
      return { success: result.success, result, error: result.error };
    },
    propose_doc_edits: proposeDocEdits,
    // execute_office_js: shared SES sandbox (same as PowerPoint — see reversed-tools.ts in claude-for-powerpoint)
    // read_attachment_pages: PDF page reader (uses _Ft PDF slicer)
  };
}
