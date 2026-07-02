/**
 * Backfill list-scoped delivery/access/note data so each (job_number, list_number)
 * has its own records. Designed to be idempotent.
 *
 * Actions:
 * 1) For every distinct (job_number, list_number) in jobs:
 *    - If a delivery exists for that list_number: keep.
 *    - Else if a legacy delivery exists for list_number "1": clone scalars + locations to the list_number.
 *    - Else create a stub delivery with minimal fields.
 * 2) For every job_access row (legacy list_number "1"):
 *    - Duplicate to each list_number that exists for that job_number if missing.
 * 3) For every job_note row (legacy list_number "1"):
 *    - Duplicate to each list_number that exists for that job_number if missing.
 *    - Attachments are duplicated and linked to the duplicated note.
 *
 * Output: Summary printed to console.
 *
 * Safety:
 * - Does not delete any existing records.
 * - Uses upserts where possible to avoid unique constraint errors.
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const key = (jobNumber, listNumber) => `${jobNumber}|${listNumber}`;

async function main() {
  const summary = {
    deliveriesCreated: 0,
    deliveriesCloned: 0,
    deliveryStubs: 0,
    accessDuplicated: 0,
    notesDuplicated: 0,
    attachmentsDuplicated: 0,
    skippedMissingLegacy: 0,
  };

  // Distinct job/list combos from jobs table
  const combos = await prisma.$queryRaw`
    SELECT job_number, list_number, MIN(job_name) AS job_name, MIN(area) AS area
    FROM jobs
    GROUP BY job_number, list_number
  `;

  // Legacy deliveries keyed by jobNumber (list_number = '1')
  const legacyDeliveries = await prisma.delivery.findMany({
    where: { listNumber: "1" },
    include: { locations: true },
  });
  const legacyByJob = new Map(
    legacyDeliveries.map((d) => [d.jobNumber, d]),
  );

  // Existing deliveries keyed by (jobNumber,listNumber)
  const existingDeliveries = new Set(
    (
      await prisma.delivery.findMany({
        select: { jobNumber: true, listNumber: true },
      })
    ).map((d) => key(d.jobNumber, d.listNumber)),
  );

  for (const combo of combos) {
    const jobNumber = combo.job_number;
    const listNumber = combo.list_number?.trim() || "1";
    const jobName = combo.job_name || null;
    const jobArea = combo.area || null;

    const comboKey = key(jobNumber, listNumber);
    if (existingDeliveries.has(comboKey)) continue;

    const legacy = legacyByJob.get(jobNumber);
    if (legacy) {
      // Clone legacy delivery to new list number
      await prisma.$transaction(async (tx) => {
        const { id, createdAt, updatedAt, listNumber: _legacyList, locations, ...rest } =
          legacy;
        const created = await tx.delivery.create({
          data: {
            ...rest,
            jobNumber,
            listNumber,
          },
        });
        if (locations && locations.length > 0) {
          await tx.deliveryLocation.createMany({
            data: locations.map((loc) => ({
              deliveryId: created.id,
              locationType: loc.locationType,
              row: loc.row,
              column: loc.column,
              order: loc.order,
            })),
          });
        }
      });
      summary.deliveriesCloned += 1;
      summary.deliveriesCreated += 1;
    } else {
      // Create minimal stub
      await prisma.delivery.create({
        data: {
          jobNumber,
          listNumber,
          jobName,
          jobArea,
          isServiceJob: false,
        },
      });
      summary.deliveryStubs += 1;
      summary.deliveriesCreated += 1;
      summary.skippedMissingLegacy += 1;
    }
  }

  // Duplicate job_access
  const accessRows = await prisma.jobAccess.findMany({
    where: { listNumber: "1" },
  });
  const accessKeys = new Set(
    (
      await prisma.jobAccess.findMany({
        select: { jobNumber: true, listNumber: true, userEmail: true },
      })
    ).map((r) => key(`${r.jobNumber}|${r.userEmail}`, r.listNumber)),
  );

  for (const row of accessRows) {
    const jobLists = combos
      .filter((c) => c.job_number === row.jobNumber)
      .map((c) => c.list_number?.trim() || "1");
    for (const listNumber of jobLists) {
      const k = key(`${row.jobNumber}|${row.userEmail}`, listNumber);
      if (accessKeys.has(k)) continue;
      await prisma.jobAccess.create({
        data: {
          jobNumber: row.jobNumber,
          listNumber,
          userEmail: row.userEmail,
          accessLevel: row.accessLevel,
        },
      });
      accessKeys.add(k);
      summary.accessDuplicated += 1;
    }
  }

  // Duplicate job_notes + attachments
  const notes = await prisma.jobNote.findMany({
    where: { listNumber: "1" },
    include: { attachments: true },
  });
  const notesKeys = new Set(
    (
      await prisma.jobNote.findMany({
        select: { id: true, jobNumber: true, listNumber: true },
      })
    ).map((n) => key(n.jobNumber, n.listNumber)),
  );

  for (const note of notes) {
    const jobLists = combos
      .filter((c) => c.job_number === note.jobNumber)
      .map((c) => c.list_number?.trim() || "1");
    for (const listNumber of jobLists) {
      const noteKey = key(note.jobNumber, listNumber);
      if (notesKeys.has(noteKey)) continue;

      const createdNote = await prisma.jobNote.create({
        data: {
          jobNumber: note.jobNumber,
          listNumber,
          content: note.content,
          createdBy: note.createdBy,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          parentId: null,
        },
      });
      summary.notesDuplicated += 1;
      notesKeys.add(noteKey);

      // Duplicate attachments for this note
      if (note.attachments && note.attachments.length > 0) {
        for (const att of note.attachments) {
          await prisma.jobNoteAttachment.create({
            data: {
              noteId: createdNote.id,
              jobNumber: note.jobNumber,
              listNumber,
              r2Key: `${att.r2Key}__${listNumber}`, // avoid unique conflict
              contentType: att.contentType,
              sizeBytes: att.sizeBytes,
              width: att.width,
              height: att.height,
              fileName: att.fileName,
              createdBy: att.createdBy,
              createdAt: att.createdAt,
            },
          });
          summary.attachmentsDuplicated += 1;
        }
      }
    }
  }

  console.log("Backfill complete:", summary);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
