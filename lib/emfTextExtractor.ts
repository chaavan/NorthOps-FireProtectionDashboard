import type { DocumentAiLine, DocumentAiPage, DocumentAiToken } from '@/lib/jobImportDocumentAi';

/**
 * Extracts literal text from a Windows Enhanced Metafile (EMF) page produced
 * by HydraTec's .HVUF export, into the same `DocumentAiPage` shape the
 * Document AI OCR path produces — so the existing TF picksheet table parser
 * (lib/jobImportTfParser.ts) can run unchanged against it.
 *
 * Unlike OCR, the text here is decoded directly from EMR_EXTTEXTOUTW/A
 * records: exact Unicode strings with no recognition error. HydraTec emits
 * one ExtTextOut call per printed table cell, so each record maps to exactly
 * one token/line — there is deliberately no word-splitting here. (A
 * word-level token model was tried and reverted: the downstream table parser
 * needs to reason about whole cells, e.g. so a description like "HANGER
 * RING" is never mistaken word-by-word for a stray part number.)
 */

const EMR_HEADER = 1;
const EMR_EXTTEXTOUTA = 83;
const EMR_EXTTEXTOUTW = 84;

/** Vertical proximity (in normalized 0..1 page units) for grouping text records into the same row. */
const ROW_Y_TOLERANCE = 0.006;
/** Fallback per-character advance width (device units) when the Dx spacing array is absent. */
const FALLBACK_CHAR_WIDTH = 50;
/** Fixed token height (device units) — exact glyph height isn't needed, only a stable center-Y. */
const TOKEN_HEIGHT = 60;

type RawTextRecord = {
  x: number;
  y: number;
  text: string;
  /** Per-character advance widths (device units), aligned 1:1 with `text`. */
  charWidths: number[];
};

function readEmfBounds(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32LE(0) !== EMR_HEADER) {
    throw new Error('Not a valid EMF buffer (missing EMR_HEADER).');
  }
  const left = buffer.readInt32LE(8);
  const top = buffer.readInt32LE(12);
  const right = buffer.readInt32LE(16);
  const bottom = buffer.readInt32LE(20);
  return { width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function readTextRecord(buffer: Buffer, recordOffset: number, iType: number): RawTextRecord | null {
  // EMR_EXTTEXTOUT{A,W}: iType(4) nSize(4) Bounds(16) iGraphicsMode(4) exScale(4) eyScale(4) EMRTEXT
  // EMRTEXT: ptlReference(8) nChars(4) offString(4) fOptions(4) rcl(16) offDx(4)
  const emrTextOffset = recordOffset + 8 + 16 + 4 + 4 + 4;
  const refX = buffer.readInt32LE(emrTextOffset);
  const refY = buffer.readInt32LE(emrTextOffset + 4);
  const nChars = buffer.readUInt32LE(emrTextOffset + 8);
  const offString = buffer.readUInt32LE(emrTextOffset + 12);
  const offDx = buffer.readUInt32LE(emrTextOffset + 36);

  if (nChars === 0) return null;

  const strStart = recordOffset + offString;
  const text = iType === EMR_EXTTEXTOUTW
    ? buffer.toString('utf16le', strStart, strStart + nChars * 2)
    : buffer.toString('latin1', strStart, strStart + nChars);

  const charWidths: number[] = [];
  if (offDx > 0) {
    const dxStart = recordOffset + offDx;
    for (let i = 0; i < nChars; i += 1) {
      const dxOffset = dxStart + i * 4;
      charWidths.push(dxOffset + 4 <= buffer.length ? buffer.readInt32LE(dxOffset) : FALLBACK_CHAR_WIDTH);
    }
  } else {
    for (let i = 0; i < nChars; i += 1) charWidths.push(FALLBACK_CHAR_WIDTH);
  }

  return { x: refX, y: refY, text, charWidths };
}

function extractRawTextRecords(buffer: Buffer): RawTextRecord[] {
  const records: RawTextRecord[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const iType = buffer.readUInt32LE(offset);
    const nSize = buffer.readUInt32LE(offset + 4);
    if (nSize < 8 || nSize % 4 !== 0 || offset + nSize > buffer.length) break;

    if (iType === EMR_EXTTEXTOUTA || iType === EMR_EXTTEXTOUTW) {
      const record = readTextRecord(buffer, offset, iType);
      if (record && record.text.trim()) {
        records.push(record);
      }
    }

    offset += nSize;
  }
  return records;
}

function sumCharWidths(charWidths: number[]): number {
  let total = 0;
  for (const width of charWidths) total += width;
  return total;
}

/** Parses one Pg{N}.emf buffer into a DocumentAiPage-shaped structure. */
export function extractEmfTextPage(buffer: Buffer, pageNumber: number): DocumentAiPage {
  const { width: pageWidth, height: pageHeight } = readEmfBounds(buffer);
  const rawRecords = extractRawTextRecords(buffer).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  const tokens: DocumentAiToken[] = rawRecords.map((record, index) => ({
    text: record.text,
    bbox: {
      x: record.x / pageWidth,
      y: record.y / pageHeight,
      width: sumCharWidths(record.charWidths) / pageWidth,
      height: TOKEN_HEIGHT / pageHeight,
    },
    readingOrder: index,
  }));

  const lines: DocumentAiLine[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const tokenY = token.bbox?.y ?? 0;
    const existingLine = lines.find((line) => line.bbox && Math.abs(line.bbox.y - tokenY) <= ROW_Y_TOLERANCE);
    if (existingLine) {
      existingLine.tokens.push(token);
      existingLine.text = `${existingLine.text} ${token.text}`.trim();
      if (existingLine.bbox && token.bbox) {
        const minX = Math.min(existingLine.bbox.x, token.bbox.x);
        const maxX = Math.max(existingLine.bbox.x + existingLine.bbox.width, token.bbox.x + token.bbox.width);
        existingLine.bbox = { ...existingLine.bbox, x: minX, width: maxX - minX };
      }
    } else {
      lines.push({
        text: token.text,
        bbox: token.bbox,
        readingOrder: lines.length,
        tokens: [token],
      });
    }
  }

  return {
    pageNumber,
    width: pageWidth,
    height: pageHeight,
    lines,
    tokens,
  };
}
