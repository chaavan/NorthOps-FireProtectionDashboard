import { unpackHvufPages } from '@/lib/hvufArchive';
import { extractEmfTextPage } from '@/lib/emfTextExtractor';
import type { DocumentAiLine, DocumentAiPage, DocumentAiToken } from '@/lib/jobImportDocumentAi';
import type {
  ImportLineItemEvidence,
  ImportParsedJobInfo,
  ImportParsedLineItem,
} from '@/lib/jobImportTypes';

/**
 * Deterministic parser for HydraTec's .HVUF picksheet export. No OCR, no AI —
 * every field comes from literal text decoded out of the embedded EMF pages,
 * so part numbers and quantities are byte-exact with what HydraTec printed.
 *
 * This intentionally does NOT reuse lib/jobImportTfParser.ts's table parser.
 * That parser's column-assignment heuristics (e.g. treating any 5+ character
 * alphanumeric token as "looks like a part number" to keep stray OCR noise
 * out of the description column) are tuned for noisy, word-fragmented OCR
 * tokens. HydraTec's EMF text is the opposite: each printed cell is exactly
 * one token (e.g. a whole description is one token, never split into OCR
 * words), so column membership is unambiguous — every data row is exactly
 * six cells, left to right: LOOSE, FAB'D, TOTAL, UOM, DESCRIPTION, PART NO.
 * Position alone is a fully reliable signal here, so a small dedicated
 * parser is both simpler and more accurate than forcing this data through
 * heuristics designed for a noisier source.
 */

export type HydraTecParseIssue = {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  lineItemId?: string | null;
};

export type HydraTecMaterialParseResult = {
  formatTrusted: boolean;
  lineItems: ImportParsedLineItem[];
  issues: HydraTecParseIssue[];
  materialPageNumbers: number[];
};

export type HydraTecParseResult = {
  pages: DocumentAiPage[];
  jobInfo: Partial<ImportParsedJobInfo>;
  deterministicResult: HydraTecMaterialParseResult;
};

const HEADER_LABEL_DEFS: Array<{ field: keyof ImportParsedJobInfo; labelPattern: string; colonOptional?: boolean }> = [
  { field: 'jobNumber', labelPattern: 'JOB\\s*NUMBER' },
  { field: 'listNumber', labelPattern: 'LIST\\s*(NO\\.?|NUMBER)' },
  { field: 'jobName', labelPattern: 'JOB\\s*NAME' },
  // When the Area value is long enough to wrap onto two lines, HydraTec
  // prints the bare word "AREA" with NO colon (the value is drawn as a
  // separate multi-line text box straddling the row above/below instead -
  // see extractWrappedAreaValue). colonOptional lets this still match as a
  // label/boundary even with no colon present, which matters even though
  // its own inline value comes up empty here: without it, "AREA" isn't
  // recognized as a label at all, so it gets swallowed into the END of
  // whatever label precedes it on the same row (e.g. "LOCATION : 9001
  // RILEY ST AREA").
  { field: 'area', labelPattern: 'AREA', colonOptional: true },
  { field: 'locationShipTo', labelPattern: 'LOCATION' },
  { field: 'listedBy', labelPattern: 'BY' },
  // The cover ("transmittal") page has distinct "Stocklist Date" and "Ship
  // Date" fields - these are listed before the generic "DATE" pattern (the
  // table-header page's single date field) so they take priority where
  // present. "Ship Date" is what the business considers the delivery date.
  { field: 'stocklistDeliveryShipDate', labelPattern: 'STOCKLIST\\s*DATE' },
  { field: 'deliveryDate', labelPattern: 'SHIP\\s*DATE' },
  { field: 'deliveryDate', labelPattern: 'DATE' },
];

const COMBINED_LABEL_REGEX = new RegExp(
  `\\b(?:${HEADER_LABEL_DEFS.map((def) => `(${def.labelPattern})\\s*:${def.colonOptional ? '?' : ''}`).join('|')})`,
  'gi',
);

function matchedLabelText(match: RegExpMatchArray): string {
  // One capture group per HEADER_LABEL_DEFS entry (in order) - find whichever one matched.
  for (let i = 1; i < match.length; i += 1) {
    if (match[i] !== undefined) return match[i];
  }
  return match[0];
}

function fieldForLabel(label: string): keyof ImportParsedJobInfo | null {
  const normalized = label.replace(/\s+/g, ' ').trim();
  const match = HEADER_LABEL_DEFS.find((def) => new RegExp(`^${def.labelPattern}$`, 'i').test(normalized));
  return match?.field ?? null;
}

function cleanFieldValue(value: string): string {
  return value.replace(/^[\s:]+/, '').trim();
}

/**
 * Recovers the Area value when it's long enough to wrap onto two lines.
 * HydraTec then draws the bare word "AREA" (no colon, no inline value) on
 * one row, and renders the actual value as a separate text box vertically
 * centered around that same row - e.g. one value line just above the "AREA"
 * row and another just below it, both indented to roughly the same column
 * as the label. This scans a small vertical window around the bare "AREA"
 * token for value-column text (to its right; excludes whatever unrelated
 * field's label/value happens to share that exact row, e.g. "LOCATION : ...")
 * and joins what it finds in reading order.
 */
function extractWrappedAreaValue(pages: DocumentAiPage[]): string | null {
  const headerPages = pages.slice(0, Math.min(2, pages.length));
  const Y_WINDOW = 0.02;
  const X_MARGIN = 0.05;

  for (const page of headerPages) {
    for (const line of page.lines) {
      const areaToken = line.tokens.find((token) => token.text.trim().toUpperCase() === 'AREA');
      if (!areaToken?.bbox) continue;

      const labelY = areaToken.bbox.y;
      const labelX = areaToken.bbox.x;

      const nearbyLines = page.lines
        .filter((candidate) => candidate.bbox && Math.abs(candidate.bbox.y - labelY) <= Y_WINDOW)
        .sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));

      const valueParts: string[] = [];
      for (const candidateLine of nearbyLines) {
        for (const token of candidateLine.tokens) {
          if (token === areaToken) continue;
          if (!token.bbox || token.bbox.x < labelX - X_MARGIN) continue;
          const text = token.text.replace(/^\s*:\s*/, '').trim();
          if (text) valueParts.push(text);
        }
      }

      if (valueParts.length > 0) {
        return valueParts.join(' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return null;
}

/**
 * HydraTec prints header fields as "LABEL : value" pairs, often several per
 * printed row (e.g. "JOB NUMBER : 24-1287   LIST NO : 1426   DATE : 06/19/26"
 * once the row's EMF text records are merged into one line). Each value runs
 * from right after its own label's colon up to the start of the next label
 * on the same line, so multiple fields per row resolve correctly regardless
 * of whether HydraTec emitted the label+colon+value as one text record or
 * split the label and value into separate adjacent records.
 */
export function extractHydraTecHeaderFields(pages: DocumentAiPage[]): Partial<ImportParsedJobInfo> {
  const result: Partial<ImportParsedJobInfo> = {};
  const headerPages = pages.slice(0, Math.min(2, pages.length));

  for (const page of headerPages) {
    for (const line of page.lines) {
      const lineText = line.text.trim();
      if (!lineText) continue;

      const matches = [...lineText.matchAll(COMBINED_LABEL_REGEX)];
      for (let i = 0; i < matches.length; i += 1) {
        const match = matches[i];
        const field = fieldForLabel(matchedLabelText(match));
        if (!field || result[field] || match.index === undefined) continue;

        const valueStart = match.index + match[0].length;
        const valueEnd = matches[i + 1]?.index ?? lineText.length;
        const value = cleanFieldValue(lineText.slice(valueStart, valueEnd));
        if (value) {
          result[field] = value;
        }
      }
    }
  }

  if (!result.area) {
    const wrappedArea = extractWrappedAreaValue(pages);
    if (wrappedArea) {
      result.area = wrappedArea;
    }
  }

  return result;
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim();
}

function toNonNegativeInt(value: string | null | undefined): number {
  const text = normalizeText(value);
  if (!text) return 0;
  const numeric = Number(text.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function lineLooksLikeColumnHeader(line: DocumentAiLine): boolean {
  const text = line.text.toUpperCase();
  return text.includes('LOOSE') && text.includes('DESCRIPTION') && (text.includes('PART NO') || text.includes('PARTNO'));
}

function pageLooksLikeMaterialTable(page: DocumentAiPage): boolean {
  return page.lines.some(lineLooksLikeColumnHeader);
}

/**
 * A section header row (e.g. "PIPE", "FITTINGS‚ WELDED" — HydraTec uses a
 * non-ASCII U+201A comma in some labels) is a single non-numeric, all-caps
 * cell occupying its own row.
 */
function lineLooksLikeSectionHeader(line: DocumentAiLine): boolean {
  if (line.tokens.length !== 1) return false;
  const text = line.tokens[0].text.trim();
  if (!text || /\d/.test(text)) return false;
  return text === text.toUpperCase() && /[A-Z]/.test(text);
}

function sortedTokens(tokens: DocumentAiToken[]): DocumentAiToken[] {
  return [...tokens].sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
}

const PART_NUMBER_SANITY_PATTERN = /[A-Z0-9]/i;

/**
 * Parses the deterministic material picksheet table out of HydraTec EMF
 * pages. Each data row is exactly six cells, left to right: LOOSE, FAB'D,
 * TOTAL, UOM, DESCRIPTION, PART NO. — see module doc for why this can be
 * assigned by position instead of column-anchor heuristics.
 */
export function parseHydraTecMaterialTable(pages: DocumentAiPage[]): HydraTecMaterialParseResult {
  const materialPages = pages.filter(pageLooksLikeMaterialTable);
  const issues: HydraTecParseIssue[] = [];

  if (materialPages.length === 0) {
    return {
      formatTrusted: false,
      lineItems: [],
      issues: [
        {
          code: 'unsupported_format',
          severity: 'error',
          message: 'No material picksheet table (LOOSE/FAB\'D/TOTAL/DESCRIPTION/PART NO.) page was found in the .HVUF export.',
        },
      ],
      materialPageNumbers: [],
    };
  }

  const lineItems: ImportParsedLineItem[] = [];
  let currentSection = '';

  for (const page of materialPages) {
    const sortedLines = [...page.lines].sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));

    for (const line of sortedLines) {
      if (lineLooksLikeColumnHeader(line)) continue;
      if (lineLooksLikeSectionHeader(line)) {
        currentSection = line.tokens[0].text.trim();
        continue;
      }

      const tokens = sortedTokens(line.tokens);
      if (tokens.length < 6) {
        if (tokens.length > 0) {
          issues.push({
            code: 'incomplete_row',
            severity: 'warning',
            message: `A row on page ${page.pageNumber} had ${tokens.length} cell(s) instead of the expected 6 and was skipped: "${line.text}".`,
          });
        }
        continue;
      }

      const looseToken = tokens[0];
      const fabToken = tokens[1];
      const totalToken = tokens[2];
      const uomToken = tokens[3];
      const partNumberToken = tokens[tokens.length - 1];
      const descriptionTokens = tokens.slice(4, tokens.length - 1);

      const quantityLoose = toNonNegativeInt(looseToken.text);
      const quantityFab = toNonNegativeInt(fabToken.text);
      const quantityNeeded = toNonNegativeInt(totalToken.text);
      const unitOfMeasurement = normalizeText(uomToken.text) || null;
      const description = normalizeText(descriptionTokens.map((token) => token.text).join(' ')) || null;
      const partNumber = normalizeText(partNumberToken.text).toUpperCase().replace(/\s+/g, '');

      const validationFlags: string[] = [];
      if (!partNumber || !PART_NUMBER_SANITY_PATTERN.test(partNumber)) {
        issues.push({
          code: 'unparseable_part_number',
          severity: 'warning',
          message: `Row on page ${page.pageNumber} did not resolve to a usable part number and was skipped: "${line.text}".`,
        });
        continue;
      }
      if (quantityNeeded !== quantityLoose + quantityFab) {
        validationFlags.push('quantity_mismatch');
      }
      if (!description) {
        validationFlags.push('description_missing');
      }

      const id = `${partNumber}-${page.pageNumber}-${lineItems.length + 1}`;
      const bbox = line.bbox
        ? { x: line.bbox.x, y: line.bbox.y, width: line.bbox.width, height: line.bbox.height }
        : null;

      const item: ImportParsedLineItem = {
        id,
        partNumber,
        quantityNeeded,
        quantityFab,
        quantityLoose,
        description,
        unitOfMeasurement,
        type: null,
        sourceNeeded: quantityNeeded,
        sourceFab: quantityFab,
        sourceLoose: quantityLoose,
        uomFromPdf: unitOfMeasurement,
        warnings: validationFlags.map((flag) => flag.replace(/_/g, ' ')),
        unknownPart: false,
        reviewStatus: 'trusted',
        resolutionSource: 'ocr',
        confidenceScore: 1,
        validationFlags,
        verificationWarnings: [],
        arbitrationNotes: [],
        evidence: {
          page: page.pageNumber,
          bbox,
          ocrText: line.text,
          primaryCandidate: {
            source: 'primary',
            partNumber,
            quantityNeeded,
            quantityFab,
            quantityLoose,
            description,
            unitOfMeasurement,
            confidenceScore: 1,
            note: null,
          },
          secondaryCandidate: null,
          catalogMatch: null,
        } satisfies ImportLineItemEvidence,
        rowOrder: lineItems.length + 1,
        sectionName: currentSection || null,
        provenance: {
          partNumber: 'printed',
          quantityNeeded: 'printed',
          quantityFab: 'printed',
          description: 'printed',
          unitOfMeasurement: 'printed',
        },
      };

      lineItems.push(item);

      if (validationFlags.length > 0) {
        issues.push({
          code: 'row_validation_warning',
          severity: 'warning',
          message: `Row ${item.partNumber} on page ${page.pageNumber} triggered validation checks.`,
          lineItemId: id,
        });
      }
    }
  }

  return {
    formatTrusted: lineItems.length > 0,
    lineItems,
    issues,
    materialPageNumbers: materialPages.map((page) => page.pageNumber),
  };
}

export function parseHydraTecExport(fileBytes: Buffer): HydraTecParseResult {
  const pageBuffers = unpackHvufPages(fileBytes);
  if (pageBuffers.length === 0) {
    throw new Error('The .HVUF file did not contain any printable pages.');
  }

  const pages = pageBuffers.map((buffer, index) => extractEmfTextPage(buffer, index + 1));
  const jobInfo = extractHydraTecHeaderFields(pages);
  const deterministicResult = parseHydraTecMaterialTable(pages);

  return { pages, jobInfo, deterministicResult };
}
