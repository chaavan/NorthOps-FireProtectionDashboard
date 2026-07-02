import type {
  VendorPriceConflictGroup,
  VendorPriceReviewLine,
} from './vendorPriceImportTypes';

type ConflictLineLike = {
  conflictGroupId: string | null;
  matchStatus: string;
  selected?: boolean;
};

export function groupLinesByConflictId<T extends ConflictLineLike>(lines: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const line of lines) {
    if (!line.conflictGroupId) continue;
    const list = map.get(line.conflictGroupId) || [];
    list.push(line);
    map.set(line.conflictGroupId, list);
  }
  return map;
}

export function countFileConflictRows<T extends { matchStatus: string }>(lines: T[]): number {
  return lines.filter((l) => l.matchStatus === 'CONFLICT_IN_FILE').length;
}

/** True when the file has two or more competing rows for the same vendor ID. */
export function isActionableFileConflictGroup<T extends { matchStatus: string }>(groupLines: T[]): boolean {
  return countFileConflictRows(groupLines) >= 2;
}

export function isActionableAmbiguousConflictGroup(
  candidateParts: Array<{ id: string }> | null | undefined,
): boolean {
  return (candidateParts?.length ?? 0) >= 2;
}

export function isActionableConflictGroupLines<T extends { matchStatus: string }>(
  groupLines: T[],
): boolean {
  const fileCount = countFileConflictRows(groupLines);
  if (fileCount >= 2) return true;
  if (fileCount === 1) return false;
  return groupLines.some((l) => l.matchStatus === 'MATCHED_AMBIGUOUS');
}

export function isActionableReviewConflictGroup(group: VendorPriceConflictGroup): boolean {
  const fileCount = countFileConflictRows(group.rows);
  if (fileCount > 0) return fileCount >= 2;
  if (group.rows.some((r) => r.matchStatus === 'MATCHED_AMBIGUOUS')) {
    return isActionableAmbiguousConflictGroup(group.candidateParts);
  }
  return false;
}

export function countUnresolvedActionableGroups(lines: ConflictLineLike[]): number {
  const byGroup = groupLinesByConflictId(
    lines.filter(
      (l) =>
        l.conflictGroupId &&
        (l.matchStatus === 'CONFLICT_IN_FILE' || l.matchStatus === 'MATCHED_AMBIGUOUS'),
    ),
  );

  let count = 0;
  for (const groupLines of byGroup.values()) {
    if (!isActionableConflictGroupLines(groupLines)) continue;
    const hasWinner = groupLines.some((l) => l.matchStatus === 'MATCHED' && l.selected);
    if (!hasWinner) count += 1;
  }
  return count;
}

export function filterActionableConflictGroups(
  groups: VendorPriceConflictGroup[],
): VendorPriceConflictGroup[] {
  return groups.filter(isActionableReviewConflictGroup);
}

export function isConflictGroupResolved(group: VendorPriceConflictGroup): boolean {
  return group.rows.some((r) => r.matchStatus === 'MATCHED' && r.selected);
}

/** Unresolved groups shown on the Conflicts tab (after actionable filtering). */
export function countUnresolvedConflictGroups(groups: VendorPriceConflictGroup[]): number {
  return groups.filter((g) => !isConflictGroupResolved(g)).length;
}

export function buildConflictGroupsFromReviewLines(
  lines: VendorPriceReviewLine[],
): VendorPriceConflictGroup[] {
  const conflictMap = new Map<string, VendorPriceConflictGroup>();
  for (const line of lines) {
    if (!line.conflictGroupId) continue;
    if (line.matchStatus !== 'CONFLICT_IN_FILE' && line.matchStatus !== 'MATCHED_AMBIGUOUS') continue;
    const existing = conflictMap.get(line.conflictGroupId);
    if (existing) {
      existing.rows.push(line);
    } else {
      conflictMap.set(line.conflictGroupId, {
        conflictGroupId: line.conflictGroupId,
        vendorPartIdNormalized: line.vendorPartIdNormalized,
        rows: [line],
      });
    }
  }
  return Array.from(conflictMap.values());
}
