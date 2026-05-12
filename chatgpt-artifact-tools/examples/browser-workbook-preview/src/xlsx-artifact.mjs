import { getWalnutExports } from "./walnut-loader.mjs";
import { decodeWorkbookLite } from "./workbook-proto-lite.mjs";

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError("Expected XLSX bytes as Uint8Array, ArrayBuffer, or ArrayBuffer view");
}

function uint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (uint32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function zipEntries(bytes) {
  const decoder = new TextDecoder();
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) return new Map();
  const entries = new Map();
  let offset = uint32(bytes, eocd + 16);
  const end = offset + uint32(bytes, eocd + 12);
  while (offset < end && uint32(bytes, offset) === 0x02014b50) {
    const method = uint16(bytes, offset + 10);
    const compressedSize = uint32(bytes, offset + 20);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const commentLength = uint16(bytes, offset + 32);
    const localOffset = uint32(bytes, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipText(bytes, path) {
  const entry = zipEntries(bytes).get(path);
  if (!entry) return null;
  const offset = entry.localOffset;
  if (uint32(bytes, offset) !== 0x04034b50) return null;
  const nameLength = uint16(bytes, offset + 26);
  const extraLength = uint16(bytes, offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  const data = entry.method === 0 ? compressed : entry.method === 8 ? await inflateRaw(compressed) : null;
  return data ? new TextDecoder().decode(data) : null;
}

function attr(xml, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(xml);
  return match?.[1];
}

function colorFromXml(xml) {
  const rgb = attr(xml, "rgb");
  if (rgb) return { type: 1, value: rgb };
  const theme = attr(xml, "theme");
  if (theme != null) {
    const tint = attr(xml, "tint");
    return {
      type: 2,
      value: `theme:${theme}`,
      transform: tint == null ? undefined : { tint: Math.round(Number(tint) * 100000) },
    };
  }
  const indexed = attr(xml, "indexed");
  if (indexed != null) return { type: 3, value: indexed, indexedColorId: Number(indexed) };
  return undefined;
}

function enrichFillsFromStylesXml(workbook, stylesXml) {
  if (!stylesXml || !workbook.styles?.fills?.length) return;
  const fillsXml = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1];
  if (!fillsXml) return;
  const fillMatches = [...fillsXml.matchAll(/<fill>([\s\S]*?)<\/fill>/g)];
  fillMatches.forEach((match, index) => {
    const fill = workbook.styles.fills[index];
    if (!fill) return;
    const xml = match[1];
    const gradientXml = /<gradientFill\b([^>]*)>([\s\S]*?)<\/gradientFill>/.exec(xml);
    if (gradientXml) {
      const stops = [...gradientXml[2].matchAll(/<stop\b([^>]*)>\s*<color\b([^>]*)\/>\s*<\/stop>/g)]
        .map((stopMatch) => ({
          position: Math.round(Number(attr(stopMatch[1], "position") || 0) * 100000),
          color: colorFromXml(stopMatch[2]),
        }))
        .filter((stop) => stop.color);
      if (stops.length) {
        fill.gradientStops = stops;
        fill.gradientKind = 1;
        fill.angleDeg = Number(attr(gradientXml[1], "degree") || 0);
      }
      return;
    }
    const fgColor = /<fgColor\b([^>]*)\/>/.exec(xml);
    if (!fill.color && fgColor) fill.color = colorFromXml(fgColor[1]);
  });
}

async function enrichWorkbookFromXlsx(bytes, workbook) {
  const stylesXml = await readZipText(bytes, "xl/styles.xml").catch(() => null);
  enrichFillsFromStylesXml(workbook, stylesXml);
}

export async function extractXlsxArtifact(bytes, options = {}) {
  const xlsxBytes = toUint8Array(bytes);
  let start = performance.now();
  const walnutExports = await getWalnutExports(options);
  options.onTiming?.("walnut runtime ready", Math.round(performance.now() - start));
  options.onStatus?.("Extracting workbook with Walnut WASM...");
  start = performance.now();
  const protoBytes = walnutExports.XlsxReader.ExtractXlsxProto(
    xlsxBytes,
    Boolean(options.includeUnsupportedMetadata),
  );
  options.onTiming?.("ExtractXlsxProto", Math.round(performance.now() - start));
  options.onStatus?.("Decoding workbook proto...");
  start = performance.now();
  const workbook = decodeWorkbookLite(protoBytes);
  options.onTiming?.("decodeWorkbookLite", Math.round(performance.now() - start));
  options.onStatus?.("Reading XLSX style metadata...");
  start = performance.now();
  await enrichWorkbookFromXlsx(xlsxBytes, workbook);
  options.onTiming?.("enrich styles.xml", Math.round(performance.now() - start));

  return {
    kind: "spreadsheet",
    protoBytes,
    workbook,
  };
}
