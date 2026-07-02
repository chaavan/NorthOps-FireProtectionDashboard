import type {
  ImportLineItemCandidate,
  ImportLineItemEvidence,
  ImportParsedLineItem,
} from '@/lib/jobImportTypes';
import type {
  DocumentAiLine,
  DocumentAiNormalizedBoundingBox,
  DocumentAiPage,
  DocumentAiToken,
} from '@/lib/jobImportDocumentAi';
import { normalizeJobLineQuantity } from '@/lib/quantityMath';

export type TfMaterialParseIssue = {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  lineItemId?: string | null;
};

export type TfMaterialParseResult = {
  formatTrusted: boolean;
  lineItems: ImportParsedLineItem[];
  issues: TfMaterialParseIssue[];
  materialPageNumbers: number[];
};

type ColumnAnchors = {
  looseX: number;
  fabX: number;
  totalX: number;
  descriptionX: number;
  partNumberX: number;
  headerBottomY: number;
};

const PART_NUMBER_PATTERN = /^[A-Z0-9-]{5,}$/;
const KNOWN_UOM_TOKENS = new Set([
  'EA',
  'FT',
  'LF',
  'SF',
  'CF',
  'GA',
  'GAL',
  'LB',
  'PK',
  'SET',
  'PR',
  'CT',
  'ROLL',
  'RL',
  'BOX',
  'BX',
  'CAN',
  'BAG',
]);

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim();
}

function normalizePartNumber(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

function toNonNegativeInt(value: string | null | undefined): number {
  const text = normalizeText(value);
  if (!text) return 0;
  const numeric = Number(text.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return normalizeJobLineQuantity(numeric);
}

function isNumericToken(token: DocumentAiToken): boolean {
  return /^\d+$/.test(token.text.trim());
}

function isLikelySectionHeader(line: DocumentAiLine): boolean {
  const text = normalizeText(line.text).toUpperCase();
  if (!text) return false;
  if (text.includes('LOOSE') || text.includes('DESCRIPTION') || text.includes('PART NO')) return false;
  if (/\d/.test(text)) return false;
  return /^[A-Z ,.'&/-]+$/.test(text);
}

function overlapsVertically(a: DocumentAiNormalizedBoundingBox | null, b: DocumentAiNormalizedBoundingBox | null): boolean {
  if (!a || !b) return false;
  const aTop = a.y;
  const aBottom = a.y + a.height;
  const bTop = b.y;
  const bBottom = b.y + b.height;
  const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
  return overlap >= Math.min(a.height, b.height) * 0.25 || Math.abs((aTop + aBottom) / 2 - (bTop + bBottom) / 2) <= 0.02;
}

function bboxUnion(boxes: Array<DocumentAiNormalizedBoundingBox | null>): DocumentAiNormalizedBoundingBox | null {
  const valid = boxes.filter(Boolean) as DocumentAiNormalizedBoundingBox[];
  if (valid.length === 0) return null;
  const minX = Math.min(...valid.map((box) => box.x));
  const minY = Math.min(...valid.map((box) => box.y));
  const maxX = Math.max(...valid.map((box) => box.x + box.width));
  const maxY = Math.max(...valid.map((box) => box.y + box.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function sortTokens(tokens: DocumentAiToken[]): DocumentAiToken[] {
  return [...tokens].sort((a, b) => {
    const ay = a.bbox?.y ?? 0;
    const by = b.bbox?.y ?? 0;
    if (Math.abs(ay - by) > 0.005) return ay - by;
    const ax = a.bbox?.x ?? 0;
    const bx = b.bbox?.x ?? 0;
    return ax - bx;
  });
}

function tokenCenterX(token: DocumentAiToken): number {
  return (token.bbox?.x || 0) + (token.bbox?.width || 0) / 2;
}

function tokenCenterY(token: DocumentAiToken): number {
  return (token.bbox?.y || 0) + (token.bbox?.height || 0) / 2;
}

function normalizeUomToken(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase().replace(/[^A-Z]/g, '');
}

function isKnownUomToken(value: string | null | undefined): boolean {
  const normalized = normalizeUomToken(value);
  return KNOWN_UOM_TOKENS.has(normalized);
}

function pageLooksLikeMaterialPicksheetTable(pageText: string): boolean {
  const partHeader =
    pageText.includes('PART NO') ||
    pageText.includes('PARTNO') ||
    pageText.includes('PART NUMBER') ||
    (pageText.includes('PART') && pageText.includes('NO.'));
  return (
    pageText.includes('LOOSE') && pageText.includes('DESCRIPTION') && partHeader
  );
}

function detectMaterialPages(pages: DocumentAiPage[]): DocumentAiPage[] {
  return pages.filter((page) => {
    const pageText = page.lines.map((line) => line.text.toUpperCase()).join('\n');
    return pageText.includes('MATERIAL PICKSHEET') || pageLooksLikeMaterialPicksheetTable(pageText);
  });
}

function detectColumnAnchors(page: DocumentAiPage): ColumnAnchors | null {
  const headerKeywordTokens = page.tokens.filter((token) => {
    const text = token.text.toUpperCase();
    return (
      text.includes('LOOSE') ||
      text.includes('FAB') ||
      text.includes('TOTAL') ||
      text.includes('DESCRIPTION') ||
      text.includes('PART') ||
      text.includes('NO')
    );
  });

  if (headerKeywordTokens.length === 0) {
    return null;
  }

  const headerClusters: Array<{ y: number; tokens: DocumentAiToken[] }> = [];
  for (const token of sortTokens(headerKeywordTokens)) {
    const y = tokenCenterY(token);
    const existing = headerClusters.find((cluster) => Math.abs(cluster.y - y) <= 0.02);
    if (existing) {
      existing.tokens.push(token);
      existing.y = (existing.y * (existing.tokens.length - 1) + y) / existing.tokens.length;
    } else {
      headerClusters.push({ y, tokens: [token] });
    }
  }

  const headerTokens =
    headerClusters.sort((left, right) => right.tokens.length - left.tokens.length)[0]?.tokens || [];
  if (headerTokens.length === 0) {
    return null;
  }

  const findTokenX = (pattern: RegExp, fallback: number): number => {
    const token = headerTokens.find((candidate) => pattern.test(candidate.text.toUpperCase()));
    return token ? tokenCenterX(token) : fallback;
  };

  return {
    looseX: findTokenX(/LOOSE/, 0.12),
    fabX: findTokenX(/FAB/, 0.22),
    totalX: findTokenX(/TOTAL/, 0.32),
    descriptionX: findTokenX(/DESCRIPTION/, 0.52),
    partNumberX: findTokenX(/PART|NO/, 0.83),
    headerBottomY: Math.max(...headerTokens.map((token) => (token.bbox ? token.bbox.y + token.bbox.height : 0))),
  };
}

function tokensForRow(tokens: DocumentAiToken[], rowY: number): DocumentAiToken[] {
  return sortTokens(
    tokens.filter((token) => {
      if (!token.bbox) return false;
      return Math.abs(tokenCenterY(token) - rowY) <= 0.012;
    }),
  );
}

function buildCandidate(
  source: ImportLineItemCandidate['source'],
  item: Pick<
    ImportParsedLineItem,
    'partNumber' | 'quantityNeeded' | 'quantityFab' | 'quantityLoose' | 'description' | 'unitOfMeasurement'
  >,
  confidenceScore: number | null,
  note?: string | null,
): ImportLineItemCandidate {
  return {
    source,
    partNumber: item.partNumber,
    quantityNeeded: item.quantityNeeded,
    quantityFab: item.quantityFab,
    quantityLoose: item.quantityLoose,
    description: item.description,
    unitOfMeasurement: item.unitOfMeasurement,
    confidenceScore,
    note: note || null,
  };
}

export function parseTfMaterialPicksheet(pages: DocumentAiPage[]): TfMaterialParseResult {
  const materialPages = detectMaterialPages(pages);
  const issues: TfMaterialParseIssue[] = [];

  if (materialPages.length === 0) {
    return {
      formatTrusted: false,
      lineItems: [],
      issues: [
        {
          code: 'unsupported_format',
          severity: 'error',
          message: 'The PDF does not contain a trusted TF material picksheet table.',
        },
      ],
      materialPageNumbers: [],
    };
  }

  const lineItems: ImportParsedLineItem[] = [];

  for (const page of materialPages) {
    const anchors = detectColumnAnchors(page);
    if (!anchors) {
      issues.push({
        code: 'missing_column_anchors',
        severity: 'error',
        message: `Page ${page.pageNumber} is missing the TF table column anchors.`,
      });
      continue;
    }

    const rowAnchorTokens = sortTokens(
      page.tokens.filter((token) => {
        if (!token.bbox || !isNumericToken(token)) return false;
        const centerX = tokenCenterX(token);
        const centerY = tokenCenterY(token);
        return (
          centerY > anchors.headerBottomY + 0.01 &&
          centerX >= anchors.totalX - 0.05 &&
          centerX <= anchors.totalX + 0.09
        );
      }),
    );
    const rowCenters: number[] = [];
    for (const token of rowAnchorTokens) {
      const y = tokenCenterY(token);
      if (!rowCenters.some((existing) => Math.abs(existing - y) <= 0.012)) {
        rowCenters.push(y);
      }
    }

    let currentSection = '';
    const sectionHeaders = page.lines
      .filter((line) => isLikelySectionHeader(line))
      .map((line) => ({
        sectionName: line.text.trim(),
        y: line.bbox?.y ?? 0,
      }))
      .sort((a, b) => a.y - b.y);

    for (const rowY of rowCenters) {
      while (sectionHeaders.length > 0 && sectionHeaders[0].y <= rowY + 0.01) {
        currentSection = sectionHeaders.shift()?.sectionName || currentSection;
      }

      const rowTokens = tokensForRow(page.tokens, rowY);
      const rowPartTokens = rowTokens.filter(
        (token) =>
          token.bbox &&
          tokenCenterX(token) >= anchors.partNumberX - 0.12,
      );
      const columnNumberTokens = rowTokens.filter(
        (token) => token.bbox && isNumericToken(token) && tokenCenterX(token) <= anchors.totalX + 0.03,
      );
      const bbox = bboxUnion(rowTokens.map((token) => token.bbox));

      const looseToken = rowTokens.find(
        (token) => token.bbox && isNumericToken(token) && tokenCenterX(token) <= anchors.looseX + 0.05,
      );
      const fabToken = rowTokens.find(
        (token) =>
          token.bbox &&
          isNumericToken(token) &&
          tokenCenterX(token) >= anchors.fabX - 0.05 &&
          tokenCenterX(token) <= anchors.fabX + 0.08,
      );
      const totalToken = rowTokens.find(
        (token) =>
          token.bbox &&
          isNumericToken(token) &&
          tokenCenterX(token) >= anchors.totalX - 0.05 &&
          tokenCenterX(token) <= anchors.totalX + 0.09,
      );
      const uomTokens = rowTokens.filter((token) => {
        const centerX = tokenCenterX(token);
        return isKnownUomToken(token.text) && centerX > anchors.totalX && centerX < anchors.descriptionX - 0.02;
      });
      const descriptionTokens = rowTokens.filter((token) => {
        if (!token.bbox) return false;
        const centerX = tokenCenterX(token);
        const normalized = normalizePartNumber(token.text);
        return (
          centerX >= anchors.totalX + 0.03 &&
          centerX <= anchors.partNumberX - 0.05 &&
          !uomTokens.includes(token) &&
          !PART_NUMBER_PATTERN.test(normalized)
        );
      });

      const quantityLoose = toNonNegativeInt(looseToken?.text);
      const quantityFab = toNonNegativeInt(fabToken?.text);
      const quantityNeeded = Math.max(toNonNegativeInt(totalToken?.text), quantityLoose + quantityFab);
      const partNumber = normalizePartNumber(rowPartTokens.map((token) => token.text).join(''));
      const unitOfMeasurement = normalizeText(uomTokens.map((token) => normalizeUomToken(token.text)).join(' ')) || null;
      const description = normalizeText(descriptionTokens.map((token) => token.text).join(' ')) || null;
      const rowText =
        normalizeText(rowTokens.map((token) => token.text).join(' ')) ||
        rowPartTokens.map((token) => token.text).join(' ');

      const validationFlags: string[] = [];
      let confidencePenalty = 0;

      if (!partNumber || !PART_NUMBER_PATTERN.test(partNumber) || !/[0-9]/.test(partNumber)) {
        continue;
      }
      if (quantityNeeded <= 0) {
        validationFlags.push('missing_total_quantity');
        confidencePenalty += 1;
      }
      if (quantityNeeded !== quantityLoose + quantityFab) {
        validationFlags.push('quantity_mismatch');
        confidencePenalty += 1;
      }
      if (!description) {
        validationFlags.push('description_missing');
        confidencePenalty += 1;
      }
      if (rowPartTokens.length > 3) {
        validationFlags.push('merged_line_suspected');
        confidencePenalty += 1;
      }
      if (columnNumberTokens.length > 3) {
        validationFlags.push('extra_numeric_tokens');
        confidencePenalty += 1;
      }

      const confidenceScore = Math.max(0.2, 0.92 - confidencePenalty * 0.14);
      const id = `${partNumber}-${page.pageNumber}-${lineItems.length + 1}`;
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
        confidenceScore,
        validationFlags,
        verificationWarnings: [],
        arbitrationNotes: [],
        evidence: {
          page: page.pageNumber,
          bbox,
          ocrText: rowText,
          primaryCandidate: buildCandidate(
            'primary',
            {
              partNumber,
              quantityNeeded,
              quantityFab,
              quantityLoose,
              description,
              unitOfMeasurement,
            },
            confidenceScore,
          ),
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
          code: 'row_auto_validation_warning',
          severity: 'warning',
          message: `Row ${item.partNumber} on page ${page.pageNumber} triggered validation checks.`,
          lineItemId: id,
        });
      }
    }
  }

  const formatTrusted =
    issues.every((issue) => issue.code !== 'missing_column_anchors') && lineItems.length > 0;

  return {
    formatTrusted,
    lineItems,
    issues,
    materialPageNumbers: materialPages.map((page) => page.pageNumber),
  };
}

export function compareLineItemsByOrder(
  primaryItems: ImportParsedLineItem[],
  secondaryItems: ImportParsedLineItem[],
): {
  agreedRowCount: number;
  disagreedRowCount: number;
  riskyIds: Set<string>;
} {
  const riskyIds = new Set<string>();
  let agreedRowCount = 0;
  let disagreedRowCount = 0;
  const maxLength = Math.max(primaryItems.length, secondaryItems.length);

  for (let index = 0; index < maxLength; index += 1) {
    const primary = primaryItems[index];
    const secondary = secondaryItems[index];
    if (!primary || !secondary) {
      if (primary?.id) riskyIds.add(primary.id);
      disagreedRowCount += 1;
      continue;
    }

    const samePart = primary.partNumber === secondary.partNumber;
    const sameQuantities =
      primary.quantityNeeded === secondary.quantityNeeded &&
      primary.quantityFab === secondary.quantityFab &&
      primary.quantityLoose === secondary.quantityLoose;
    const sameDescription =
      normalizeText(primary.description || '').toUpperCase() ===
      normalizeText(secondary.description || '').toUpperCase();

    if (samePart && sameQuantities && sameDescription) {
      agreedRowCount += 1;
      continue;
    }

    riskyIds.add(primary.id);
    disagreedRowCount += 1;
  }

  const byPartNumber = new Map<string, ImportParsedLineItem[]>();
  for (const item of primaryItems) {
    const existing = byPartNumber.get(item.partNumber) || [];
    existing.push(item);
    byPartNumber.set(item.partNumber, existing);
  }
  for (const items of byPartNumber.values()) {
    const uniqueDescriptions = new Set(
      items.map((item) => normalizeText(item.description || '').toUpperCase()).filter(Boolean),
    );
    if (items.length > 1 && uniqueDescriptions.size > 1) {
      for (const item of items) {
        riskyIds.add(item.id);
      }
    }
  }

  return { agreedRowCount, disagreedRowCount, riskyIds };
}
