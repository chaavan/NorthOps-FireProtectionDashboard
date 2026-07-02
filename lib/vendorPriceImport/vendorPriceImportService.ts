import { createHash, randomUUID } from 'crypto';
import {
  Prisma,
  VendorPriceImportLineMatchStatus,
  type VendorPriceImport,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { catalogCostsEqual } from '@/lib/partCostLedger';
import { normalizeVendorKey } from '@/lib/vendorUtils';
import { buildReviewSnapshot, buildReviewSnapshotAsync, computeSummaryFromLines } from './buildReviewSnapshot';
import { commitVendorPriceImport } from './commitVendorPriceImport';
import { groupLinesByConflictId } from './conflictGroups';
import {
  buildVendorPartIndex,
  matchParsedRowsToParts,
  matchRowToInventory,
  type MatchedLineDraft,
} from './matchVendorPrices';
import { parseEtnaBook1V1 } from './parsers/etnaBook1V1';
import { computePercentChange } from './percentChange';
import { applyCostAfterForPart, normalizeImportCost } from './costOverride';
import type {
  UpdateReviewInput,
  VendorPriceImportListItem,
  VendorPriceReviewSnapshot,
} from './vendorPriceImportTypes';
import {
  VENDOR_PRICE_ALLOWED_EXTENSIONS,
  VENDOR_PRICE_MAX_FILE_BYTES,
} from './vendorPriceImportTypes';

function computeFileHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export function assertAcceptableVendorPriceFile(fileName: string, sizeBytes: number): void {
  const ext = extensionOf(fileName);
  if (!VENDOR_PRICE_ALLOWED_EXTENSIONS.includes(ext as (typeof VENDOR_PRICE_ALLOWED_EXTENSIONS)[number])) {
    throw new Error(`Unsupported file type. Allowed: ${VENDOR_PRICE_ALLOWED_EXTENSIONS.join(', ')}`);
  }
  if (sizeBytes > VENDOR_PRICE_MAX_FILE_BYTES) {
    throw new Error(`File exceeds maximum size of ${VENDOR_PRICE_MAX_FILE_BYTES / (1024 * 1024)}MB.`);
  }
}

function parseFileForProfile(parserType: string, fileBytes: Buffer, fileName: string) {
  if (parserType === 'etna_book1_v1') {
    return parseEtnaBook1V1(fileBytes, fileName);
  }
  throw new Error(`Unsupported parser type: ${parserType}`);
}

async function reconcileOrphanConflictLines(importId: string, matchVendorKey: string): Promise<void> {
  const conflictLines = await prisma.vendorPriceImportLine.findMany({
    where: { importId, matchStatus: 'CONFLICT_IN_FILE' },
  });
  const byGroup = groupLinesByConflictId(conflictLines);
  const orphaned = [...byGroup.values()].filter((group) => group.length === 1);
  if (orphaned.length === 0) return;

  const parts = await loadPartsForVendor(matchVendorKey);
  const index = buildVendorPartIndex(parts);

  for (const groupLines of orphaned) {
    const lone = groupLines[0];
    const draft = matchRowToInventory(
      {
        rowIndex: lone.rowIndex,
        vendorPartIdRaw: lone.vendorPartIdRaw || '',
        vendorPartIdNormalized: lone.vendorPartIdNormalized,
        descriptionFromFile: lone.descriptionFromFile,
        uomFromFile: lone.uomFromFile,
        proposedCost: Number(lone.proposedCost),
      },
      index,
    );
    await prisma.vendorPriceImportLine.update({
      where: { id: lone.id },
      data: {
        matchStatus: draft.matchStatus,
        partId: draft.partId,
        costBefore: draft.costBefore,
        costAfter: draft.costAfter,
        percentChange: draft.percentChange,
        conflictGroupId: null,
        selected: draft.selected,
      },
    });
  }
}

async function loadPartsForVendor(matchVendorKey: string) {
  const parts = await prisma.part.findMany({
    where: {
      vendorPartID: { not: null },
      vendor: { not: null },
    },
    select: {
      id: true,
      pn: true,
      nomenclature: true,
      cost: true,
      vendor: true,
      vendorPartID: true,
    },
  });
  return parts.filter((p) => normalizeVendorKey(p.vendor) === matchVendorKey);
}

const VENDOR_PRICE_LINE_CREATE_BATCH = 200;

function toOptionalDecimal(
  value: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function assertPersistableDrafts(drafts: MatchedLineDraft[]): void {
  const allowedStatuses = new Set<string>(Object.values(VendorPriceImportLineMatchStatus));
  const rowIndexes = new Set<number>();

  for (const d of drafts) {
    if (!allowedStatuses.has(d.matchStatus)) {
      throw new Error(
        `Row ${d.rowIndex} has matchStatus "${d.matchStatus}" which this Prisma client does not recognize. ` +
          'Stop the dev server, run "npx prisma generate", then restart dev.',
      );
    }
    if (!Number.isFinite(d.proposedCost)) {
      throw new Error(`Row ${d.rowIndex} has invalid proposedCost: ${d.proposedCost}`);
    }
    if (rowIndexes.has(d.rowIndex)) {
      throw new Error(`Duplicate rowIndex ${d.rowIndex} in matched import lines`);
    }
    rowIndexes.add(d.rowIndex);
  }
}

function draftToLineCreateInput(importId: string, d: MatchedLineDraft): Prisma.VendorPriceImportLineCreateManyInput {
  return {
    id: randomUUID(),
    importId,
    rowIndex: d.rowIndex,
    vendorPartIdRaw: d.vendorPartIdRaw,
    vendorPartIdNormalized: d.vendorPartIdNormalized,
    descriptionFromFile: d.descriptionFromFile,
    uomFromFile: d.uomFromFile,
    proposedCost: new Prisma.Decimal(d.proposedCost),
    matchStatus: d.matchStatus,
    partId: d.partId,
    costBefore: toOptionalDecimal(d.costBefore),
    costAfter: toOptionalDecimal(d.costAfter),
    percentChange: toOptionalDecimal(d.percentChange),
    conflictGroupId: d.conflictGroupId,
    selected: d.selected,
  };
}

async function persistLines(importId: string, drafts: MatchedLineDraft[]): Promise<void> {
  await prisma.vendorPriceImportLine.deleteMany({ where: { importId } });
  if (drafts.length === 0) return;

  assertPersistableDrafts(drafts);
  const data = drafts.map((d) => draftToLineCreateInput(importId, d));

  try {
    for (let i = 0; i < data.length; i += VENDOR_PRICE_LINE_CREATE_BATCH) {
      await prisma.vendorPriceImportLine.createMany({
        data: data.slice(i, i + VENDOR_PRICE_LINE_CREATE_BATCH),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('DUPLICATE_COLLAPSED') ||
      message.includes('vendor_price_import_line_match_status') ||
      message.includes('VendorPriceImportLineMatchStatus')
    ) {
      const migrationError = new Error(
        'Database is missing the DUPLICATE_COLLAPSED status. Run "npx prisma migrate deploy" against this database, then retry.',
      );
      (migrationError as Error & { cause?: unknown }).cause = error;
      throw migrationError;
    }
    throw error;
  }
}

export async function parseVendorPriceImport(importId: string): Promise<VendorPriceImport> {
  const importRecord = await prisma.vendorPriceImport.findUnique({
    where: { id: importId },
    include: { profile: true },
  });
  if (!importRecord) throw new Error('Import session not found.');
  if (!importRecord.sourceFileBytes) throw new Error('Source file is missing.');

  try {
    const fileBytes = Buffer.from(importRecord.sourceFileBytes);
    const parsedRows = parseFileForProfile(
      importRecord.profile.parserType,
      fileBytes,
      importRecord.sourceFileName,
    );
    const parts = await loadPartsForVendor(importRecord.profile.matchVendorKey);
    const drafts = matchParsedRowsToParts({
      parsedRows,
      parts,
      matchVendorKey: importRecord.profile.matchVendorKey,
    });

    await persistLines(importId, drafts);

    await reconcileOrphanConflictLines(importId, importRecord.profile.matchVendorKey);

    const lines = await prisma.vendorPriceImportLine.findMany({
      where: { importId },
      include: { part: { select: { id: true, pn: true, nomenclature: true } } },
    });
    const summary = computeSummaryFromLines(lines);
    const snapshot = await buildReviewSnapshotAsync({
      importRecord,
      profile: importRecord.profile,
      lines,
    });

    return await prisma.vendorPriceImport.update({
      where: { id: importId },
      data: {
        status: 'READY',
        summary: summary as unknown as Prisma.InputJsonValue,
        reviewSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
      include: { profile: true },
    });
  } catch (error) {
    return await prisma.vendorPriceImport.update({
      where: { id: importId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Failed to parse vendor price file.',
      },
      include: { profile: true },
    });
  }
}

export async function createVendorPriceImportDraft(params: {
  fileName: string;
  contentType: string | null;
  fileBytes: Buffer;
  vendorKey: string;
  createdByUserId: string;
}): Promise<VendorPriceImport> {
  assertAcceptableVendorPriceFile(params.fileName, params.fileBytes.length);

  const profile = await prisma.vendorPriceProfile.findUnique({
    where: { vendorKey: params.vendorKey, isActive: true },
  });
  if (!profile) throw new Error(`Unknown or inactive vendor profile: ${params.vendorKey}`);

  const importId = randomUUID();
  const record = await prisma.vendorPriceImport.create({
    data: {
      id: importId,
      status: 'PROCESSING',
      vendorKey: profile.vendorKey,
      sourceType: 'UPLOAD',
      sourceFileName: params.fileName,
      sourceContentType: params.contentType,
      sourceFileSize: params.fileBytes.length,
      sourceFileHash: computeFileHash(params.fileBytes),
      sourceFileBytes: params.fileBytes,
      createdBy: params.createdByUserId,
    },
    include: { profile: true },
  });

  return parseVendorPriceImport(record.id);
}

export async function getVendorPriceImportResponse(importId: string): Promise<{
  import: VendorPriceImport & { profile: { vendorKey: string; displayName: string } };
  review: VendorPriceReviewSnapshot;
}> {
  const importRecord = await prisma.vendorPriceImport.findUnique({
    where: { id: importId },
    include: {
      profile: true,
      lines: {
        include: { part: { select: { id: true, pn: true, nomenclature: true } } },
        orderBy: [{ matchStatus: 'asc' }, { rowIndex: 'asc' }],
      },
    },
  });
  if (!importRecord) throw new Error('Import session not found.');

  if (importRecord.status === 'READY') {
    await reconcileOrphanConflictLines(importId, importRecord.profile.matchVendorKey);
    importRecord.lines = await prisma.vendorPriceImportLine.findMany({
      where: { importId },
      include: { part: { select: { id: true, pn: true, nomenclature: true } } },
      orderBy: [{ matchStatus: 'asc' }, { rowIndex: 'asc' }],
    });
  }

  const review = await buildReviewSnapshotAsync({
    importRecord,
    profile: importRecord.profile,
    lines: importRecord.lines,
  });

  return { import: importRecord, review };
}

export async function listVendorPriceImports(params: {
  take?: number;
  statuses?: string[];
}): Promise<VendorPriceImportListItem[]> {
  const take = Math.min(Math.max(params.take ?? 20, 1), 50);
  const statuses = params.statuses?.length
    ? params.statuses
    : ['PROCESSING', 'READY', 'FAILED', 'COMMITTED'];

  const rows = await prisma.vendorPriceImport.findMany({
    where: { status: { in: statuses as any } },
    include: { profile: true },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    vendorKey: row.vendorKey,
    vendorDisplayName: row.profile.displayName,
    sourceFileName: row.sourceFileName,
    sourceType: row.sourceType,
    summary: (row.summary as VendorPriceImportListItem['summary']) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  }));
}

function applyMatchToLine(
  line: MatchedLineDraft,
  part: { id: string; cost: Prisma.Decimal; pn: string; nomenclature: string },
  proposedCost: number,
): MatchedLineDraft {
  const costBefore = part.cost;
  const costAfter = new Prisma.Decimal(proposedCost);
  if (catalogCostsEqual(costBefore, costAfter)) {
    return {
      ...line,
      matchStatus: 'NO_COST_CHANGE',
      partId: part.id,
      costBefore,
      costAfter,
      percentChange: null,
      selected: false,
      conflictGroupId: null,
    };
  }
  const pct = computePercentChange(Number(costBefore), proposedCost);
  return {
    ...line,
    matchStatus: 'MATCHED',
    partId: part.id,
    costBefore,
    costAfter,
    percentChange: pct === null ? null : new Prisma.Decimal(pct),
    selected: true,
    conflictGroupId: null,
  };
}

function editableImportLineStatuses(): VendorPriceImportLineMatchStatus[] {
  return ['MATCHED', 'NO_COST_CHANGE'];
}

export async function updateVendorPriceImportReview(
  importId: string,
  input: UpdateReviewInput,
): Promise<VendorPriceReviewSnapshot> {
  const importRecord = await prisma.vendorPriceImport.findUnique({
    where: { id: importId },
    include: { profile: true },
  });
  if (!importRecord) throw new Error('Import session not found.');
  if (importRecord.status !== 'READY') {
    throw new Error('Only READY imports can be updated.');
  }

  if (input.resolveConflicts?.length) {
    const parts = await loadPartsForVendor(importRecord.profile.matchVendorKey);
    const index = buildVendorPartIndex(parts);

    for (const resolution of input.resolveConflicts) {
      const groupLines = await prisma.vendorPriceImportLine.findMany({
        where: { importId, conflictGroupId: resolution.conflictGroupId },
      });
      const winner = groupLines.find((l) => l.id === resolution.winningLineId);
      if (!winner) continue;

      const matches = index.get(winner.vendorPartIdNormalized) || [];
      const partId = resolution.partId || (matches.length === 1 ? matches[0]?.id : null);
      const part = partId ? parts.find((p) => p.id === partId) : matches[0];

      if (!part) continue;

      const matched = applyMatchToLine(
        {
          rowIndex: winner.rowIndex,
          vendorPartIdRaw: winner.vendorPartIdRaw || '',
          vendorPartIdNormalized: winner.vendorPartIdNormalized,
          descriptionFromFile: winner.descriptionFromFile,
          uomFromFile: winner.uomFromFile,
          proposedCost: Number(winner.proposedCost),
          matchStatus: 'MATCHED',
          partId: null,
          costBefore: null,
          costAfter: null,
          percentChange: null,
          conflictGroupId: null,
          selected: true,
        },
        part,
        Number(winner.proposedCost),
      );

      await prisma.vendorPriceImportLine.update({
        where: { id: winner.id },
        data: {
          matchStatus: matched.matchStatus,
          partId: matched.partId,
          costBefore: matched.costBefore,
          costAfter: matched.costAfter,
          percentChange: matched.percentChange,
          selected: matched.selected,
          conflictGroupId: null,
        },
      });

      await prisma.vendorPriceImportLine.updateMany({
        where: {
          importId,
          conflictGroupId: resolution.conflictGroupId,
          id: { not: winner.id },
        },
        data: {
          matchStatus: 'EXCLUDED',
          selected: false,
        },
      });
    }
  }

  await reconcileOrphanConflictLines(importId, importRecord.profile.matchVendorKey);

  if (input.excludeLineIds?.length) {
    await prisma.vendorPriceImportLine.updateMany({
      where: {
        importId,
        id: { in: input.excludeLineIds },
        matchStatus: 'MATCHED',
      },
      data: {
        matchStatus: 'EXCLUDED',
        selected: false,
      },
    });
  }

  if (input.lineCostOverrides?.length) {
    for (const override of input.lineCostOverrides) {
      const line = await prisma.vendorPriceImportLine.findFirst({
        where: {
          id: override.lineId,
          importId,
          matchStatus: { in: editableImportLineStatuses() },
        },
        include: { part: { select: { id: true, cost: true } } },
      });
      if (!line?.part) continue;

      const costAfterValue = normalizeImportCost(override.costAfter);
      const applied = applyCostAfterForPart(line.part, costAfterValue);

      await prisma.vendorPriceImportLine.update({
        where: { id: line.id },
        data: {
          matchStatus: applied.matchStatus,
          costBefore: applied.costBefore,
          costAfter: applied.costAfter,
          percentChange: applied.percentChange,
          selected: applied.selected,
        },
      });
    }
  }

  if (input.resetLineCostIds?.length) {
    for (const lineId of input.resetLineCostIds) {
      const line = await prisma.vendorPriceImportLine.findFirst({
        where: {
          id: lineId,
          importId,
          matchStatus: { in: editableImportLineStatuses() },
        },
        include: { part: { select: { id: true, cost: true } } },
      });
      if (!line?.part) continue;

      const applied = applyCostAfterForPart(line.part, Number(line.proposedCost));

      await prisma.vendorPriceImportLine.update({
        where: { id: line.id },
        data: {
          matchStatus: applied.matchStatus,
          costBefore: applied.costBefore,
          costAfter: applied.costAfter,
          percentChange: applied.percentChange,
          selected: applied.selected,
        },
      });
    }
  }

  if (input.lineSelections?.length) {
    for (const sel of input.lineSelections) {
      const line = await prisma.vendorPriceImportLine.findFirst({
        where: { id: sel.lineId, importId },
      });
      if (!line || line.matchStatus !== 'MATCHED') continue;
      await prisma.vendorPriceImportLine.update({
        where: { id: sel.lineId },
        data: { selected: sel.selected },
      });
    }
  }

  const lines = await prisma.vendorPriceImportLine.findMany({
    where: { importId },
    include: { part: { select: { id: true, pn: true, nomenclature: true } } },
  });
  const summary = computeSummaryFromLines(lines);
  const snapshot = await buildReviewSnapshotAsync({
    importRecord,
    profile: importRecord.profile,
    lines,
  });

  await prisma.vendorPriceImport.update({
    where: { id: importId },
    data: {
      summary: summary as unknown as Prisma.InputJsonValue,
      reviewSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  return snapshot;
}

export async function discardVendorPriceImport(importId: string): Promise<void> {
  const existing = await prisma.vendorPriceImport.findUnique({ where: { id: importId } });
  if (!existing) throw new Error('Import session not found.');
  if (existing.status === 'COMMITTED') {
    throw new Error('Applied imports cannot be discarded.');
  }

  await prisma.vendorPriceImport.update({
    where: { id: importId },
    data: { status: 'DISCARDED' },
  });
}

export { commitVendorPriceImport };

export async function listVendorPriceProfiles() {
  return prisma.vendorPriceProfile.findMany({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
  });
}
