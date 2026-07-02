import type {
  Part,
  VendorPriceImport,
  VendorPriceImportLine,
  VendorPriceProfile,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeVendorKey } from '@/lib/vendorUtils';
import {
  buildConflictGroupsFromReviewLines,
  countUnresolvedConflictGroups,
  filterActionableConflictGroups,
} from './conflictGroups';
import { normalizeVendorPartId } from './vendorPartIdNormalize';
import { isManuallyAdjustedCost } from './costOverride';
import type {
  VendorPriceConflictGroup,
  VendorPriceImportSummary,
  VendorPriceReviewLine,
  VendorPriceReviewSnapshot,
} from './vendorPriceImportTypes';

type LineWithPart = VendorPriceImportLine & {
  part: Pick<Part, 'id' | 'pn' | 'nomenclature'> | null;
};

export function computeSummaryFromLines(lines: LineWithPart[]): VendorPriceImportSummary {
  const matched = lines.filter((l) => l.matchStatus === 'MATCHED');
  const selectedMatched = matched.filter((l) => l.selected);
  const manuallyAdjustedCount = selectedMatched.filter((l) =>
    isManuallyAdjustedCost(Number(l.proposedCost), l.costAfter !== null ? Number(l.costAfter) : null),
  ).length;
  const pctValues = selectedMatched
    .map((l) => (l.percentChange !== null ? Number(l.percentChange) : null))
    .filter((v): v is number => v !== null);

  const collapsedDuplicateCount = lines.filter((l) => l.matchStatus === 'DUPLICATE_COLLAPSED').length;

  return {
    fileRowCount: lines.length,
    parsedRows: lines.length,
    collapsedDuplicateCount,
    matchedCount: matched.length,
    selectedCount: selectedMatched.length,
    manuallyAdjustedCount,
    conflictInFileCount: lines.filter((l) => l.matchStatus === 'CONFLICT_IN_FILE').length,
    unmatchedCount: lines.filter((l) => l.matchStatus === 'UNMATCHED').length,
    noCostChangeCount: lines.filter((l) => l.matchStatus === 'NO_COST_CHANGE').length,
    ambiguousCount: lines.filter((l) => l.matchStatus === 'MATCHED_AMBIGUOUS').length,
    increasesCount: selectedMatched.filter((l) => l.percentChange !== null && Number(l.percentChange) > 0).length,
    decreasesCount: selectedMatched.filter((l) => l.percentChange !== null && Number(l.percentChange) < 0).length,
    avgPercentChangeSelected:
      pctValues.length > 0
        ? Math.round((pctValues.reduce((a, b) => a + b, 0) / pctValues.length) * 100) / 100
        : null,
    unresolvedConflictGroups: 0,
  };
}

function toReviewLine(line: LineWithPart): VendorPriceReviewLine {
  const proposedCost = Number(line.proposedCost);
  const costAfter = line.costAfter !== null ? Number(line.costAfter) : null;
  return {
    id: line.id,
    rowIndex: line.rowIndex,
    vendorPartIdNormalized: line.vendorPartIdNormalized,
    vendorPartIdRaw: line.vendorPartIdRaw,
    descriptionFromFile: line.descriptionFromFile,
    uomFromFile: line.uomFromFile,
    proposedCost,
    matchStatus: line.matchStatus,
    partId: line.partId,
    pn: line.part?.pn ?? null,
    nomenclature: line.part?.nomenclature ?? null,
    costBefore: line.costBefore !== null ? Number(line.costBefore) : null,
    costAfter,
    percentChange: line.percentChange !== null ? Number(line.percentChange) : null,
    conflictGroupId: line.conflictGroupId,
    selected: line.selected,
    isManuallyAdjusted: isManuallyAdjustedCost(proposedCost, costAfter),
  };
}

async function loadAmbiguousCandidates(
  matchVendorKey: string,
  vendorPartIdNormalized: string,
): Promise<VendorPriceConflictGroup['candidateParts']> {
  const parts = await prisma.part.findMany({
    where: { vendorPartID: { not: null }, vendor: { not: null } },
    select: { id: true, pn: true, nomenclature: true, cost: true, vendor: true, vendorPartID: true },
  });
  return parts
    .filter(
      (p) =>
        normalizeVendorKey(p.vendor) === matchVendorKey &&
        normalizeVendorPartId(p.vendorPartID) === vendorPartIdNormalized,
    )
    .map((p) => ({
      id: p.id,
      pn: p.pn,
      nomenclature: p.nomenclature,
      cost: Number(p.cost),
    }));
}

export async function buildReviewSnapshotAsync(params: {
  importRecord: VendorPriceImport;
  profile: VendorPriceProfile;
  lines: LineWithPart[];
}): Promise<VendorPriceReviewSnapshot> {
  const snapshot = buildReviewSnapshot(params);
  for (const group of snapshot.conflicts) {
    const isAmbiguous = group.rows.some((r) => r.matchStatus === 'MATCHED_AMBIGUOUS');
    if (isAmbiguous) {
      group.candidateParts = await loadAmbiguousCandidates(
        params.profile.matchVendorKey,
        group.vendorPartIdNormalized,
      );
    }
  }
  snapshot.conflicts = filterActionableConflictGroups(snapshot.conflicts);
  snapshot.summary.unresolvedConflictGroups = countUnresolvedConflictGroups(snapshot.conflicts);
  if (snapshot.summary.unresolvedConflictGroups === 0) {
    snapshot.blockingIssues = snapshot.blockingIssues.filter(
      (issue) => !issue.includes('vendor part ID conflict'),
    );
  }
  return snapshot;
}

export function buildReviewSnapshot(params: {
  importRecord: VendorPriceImport;
  profile: VendorPriceProfile;
  lines: LineWithPart[];
}): VendorPriceReviewSnapshot {
  const { importRecord, profile, lines } = params;
  const summary = computeSummaryFromLines(lines);

  const visibleLines = lines.filter(
    (l) =>
      l.matchStatus === 'MATCHED' ||
      l.matchStatus === 'NO_COST_CHANGE' ||
      l.matchStatus === 'CONFLICT_IN_FILE' ||
      l.matchStatus === 'MATCHED_AMBIGUOUS',
  );

  const reviewLines = visibleLines.map(toReviewLine);

  const allConflictGroups = buildConflictGroupsFromReviewLines(reviewLines);
  const conflicts = filterActionableConflictGroups(allConflictGroups);
  summary.unresolvedConflictGroups = countUnresolvedConflictGroups(conflicts);

  const blockingIssues: string[] = [];
  if (summary.unresolvedConflictGroups > 0) {
    blockingIssues.push(
      `${summary.unresolvedConflictGroups} vendor part ID conflict(s) in the file must be resolved before applying.`,
    );
  }
  if (summary.selectedCount === 0) {
    blockingIssues.push('Select at least one matched row to apply price updates.');
  }

  return {
    importId: importRecord.id,
    vendorKey: profile.vendorKey,
    vendorDisplayName: profile.displayName,
    sourceFileName: importRecord.sourceFileName,
    status: importRecord.status,
    summary,
    lines: reviewLines,
    conflicts,
    blockingIssues,
  };
}
