import { prisma } from '@/lib/prisma';
import { COST_CONTEXT_AUTO, recordPartCostChange } from '@/lib/partCostLedger';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { computePercentChange } from './percentChange';
import { isManuallyAdjustedCost } from './costOverride';
import { buildReviewSnapshot } from './buildReviewSnapshot';

/** Prisma default interactive tx timeout is 5s — too short for large vendor sheets. */
function vendorPriceCommitTransactionOptions(rowCount: number) {
  return {
    maxWait: 10_000,
    timeout: Math.min(120_000, Math.max(30_000, rowCount * 150)),
  };
}

export async function commitVendorPriceImport(params: {
  importId: string;
  actorUserId: string | null;
}): Promise<{ appliedCount: number; skippedCount: number }> {
  const importRecord = await prisma.vendorPriceImport.findUnique({
    where: { id: params.importId },
    include: {
      profile: true,
      lines: { include: { part: true } },
    },
  });

  if (!importRecord) throw new Error('Import session not found.');
  if (importRecord.status !== 'READY') {
    throw new Error('Only READY imports can be committed.');
  }

  const snapshot = buildReviewSnapshot({
    importRecord,
    profile: importRecord.profile,
    lines: importRecord.lines,
  });

  if (snapshot.blockingIssues.length > 0) {
    throw new Error(snapshot.blockingIssues.join(' '));
  }

  const toApply = importRecord.lines.filter(
    (l) => l.matchStatus === 'MATCHED' && l.selected && l.partId && l.costAfter !== null,
  );

  if (toApply.length === 0) {
    throw new Error('No selected rows to apply.');
  }

  const dateUpdated = formatDateInAppTimeZone(new Date());
  let appliedCount = 0;

  const txOptions = vendorPriceCommitTransactionOptions(toApply.length);

  await prisma.$transaction(async (tx) => {
    const partIds = toApply.map((l) => l.partId).filter((id): id is string => Boolean(id));
    const parts = await tx.part.findMany({ where: { id: { in: partIds } } });
    const partById = new Map(parts.map((p) => [p.id, p]));

    for (const line of toApply) {
      if (!line.partId || line.costAfter === null) continue;

      const part = partById.get(line.partId);
      if (!part) continue;

      const costBefore = part.cost;
      const costAfter = line.costAfter;
      const proposedCost = Number(line.proposedCost);
      const manuallyAdjusted = isManuallyAdjustedCost(
        proposedCost,
        costAfter !== null ? Number(costAfter) : null,
      );
      const pct =
        line.percentChange !== null
          ? Number(line.percentChange)
          : computePercentChange(Number(costBefore), Number(costAfter));

      await tx.part.update({
        where: { id: line.partId },
        data: {
          cost: costAfter,
          costChangePercentage: pct !== null ? String(pct) : null,
          dateUpdated,
        },
      });

      const baseNote = `${importRecord.profile.displayName} price sheet | ${importRecord.sourceFileName}`;
      const note = manuallyAdjusted
        ? `${baseNote} | Vendor sheet $${proposedCost.toFixed(2)} → manually set $${Number(costAfter).toFixed(2)}`
        : baseNote;

      await recordPartCostChange(tx, {
        partId: line.partId,
        costBefore,
        costAfter,
        actorUserId: params.actorUserId,
        contextType: COST_CONTEXT_AUTO,
        contextId: params.importId,
        note,
        metadata: {
          vendorPartId: line.vendorPartIdNormalized,
          percentChange: pct,
          importId: params.importId,
          vendorKey: importRecord.vendorKey,
          proposedCost,
          manuallyAdjusted,
        },
      });

      appliedCount += 1;
    }

    await tx.vendorPriceImport.update({
      where: { id: params.importId },
      data: {
        status: 'COMMITTED',
        committedBy: params.actorUserId,
        committedAt: new Date(),
        commitSummary: {
          appliedCount,
          sourceFileName: importRecord.sourceFileName,
          vendorKey: importRecord.vendorKey,
        },
      },
    });
  }, txOptions);

  return { appliedCount, skippedCount: toApply.length - appliedCount };
}
