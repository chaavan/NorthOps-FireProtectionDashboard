import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { extractTextFromPdfWithDocumentAi } from "../lib/jobImportDocumentAi";
import { parseTfMaterialPicksheet } from "../lib/jobImportTfParser";
import { normalizePartNumber } from "../lib/inventoryQuantity";
import { COST_CONTEXT_IMPORT, recordPartCostChange } from "../lib/partCostLedger";

type PartSeed = {
  pn: string;
  nomenclature: string;
  units: string;
  quantity: number;
  sourceFiles: string[];
};

function demoPriceForPart(pn: string): number {
  let hash = 0;
  for (let i = 0; i < pn.length; i++) {
    hash = (hash * 31 + pn.charCodeAt(i)) >>> 0;
  }
  const min = 4.5;
  const max = 248.99;
  const ratio = (hash % 10_000) / 10_000;
  return Math.round((min + ratio * (max - min)) * 100) / 100;
}

async function resolveImportActorUserId(): Promise<string | null> {
  const fromEnv = process.env.PARTS_IMPORT_ACTOR_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  const admin = await prisma.user.findFirst({
    where: { role: { in: ["ADMIN", "DEVELOPER"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

async function extractPartsFromPdf(filePath: string): Promise<PartSeed[]> {
  const fileName = path.basename(filePath);
  console.log(`\nParsing ${fileName}...`);
  const fileBytes = fs.readFileSync(filePath);
  const extraction = await extractTextFromPdfWithDocumentAi(fileBytes);
  const parsed = parseTfMaterialPicksheet(extraction.pages);

  if (!parsed.formatTrusted) {
    console.warn(`  Warning: parser did not fully trust layout for ${fileName}`);
  }

  console.log(`  Found ${parsed.lineItems.length} line items`);

  return parsed.lineItems.map((item) => ({
    pn: normalizePartNumber(item.partNumber),
    nomenclature: (item.description || item.partNumber).trim(),
    units: (item.unitOfMeasurement || "EA").trim().toUpperCase(),
    quantity: Math.max(0, Math.round(item.quantityNeeded || 0)),
    sourceFiles: [fileName],
  }));
}

function mergePartSeeds(rows: PartSeed[]): PartSeed[] {
  const byPn = new Map<string, PartSeed>();

  for (const row of rows) {
    if (!row.pn) continue;
    const existing = byPn.get(row.pn);
    if (!existing) {
      byPn.set(row.pn, { ...row });
      continue;
    }

    if ((row.nomenclature?.length || 0) > (existing.nomenclature?.length || 0)) {
      existing.nomenclature = row.nomenclature;
    }
    existing.quantity = Math.max(existing.quantity, row.quantity);
    for (const file of row.sourceFiles) {
      if (!existing.sourceFiles.includes(file)) {
        existing.sourceFiles.push(file);
      }
    }
  }

  return Array.from(byPn.values()).sort((a, b) => a.pn.localeCompare(b.pn));
}

async function main() {
  if (process.env.PARTS_BULK_IMPORT_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run: set PARTS_BULK_IMPORT_CONFIRM=I_UNDERSTAND",
    );
  }

  const pdfPaths = process.argv.slice(2);
  if (pdfPaths.length === 0) {
    throw new Error(
      "Usage: npx tsx scripts/import-parts-from-picklist-pdfs.ts <pdf> [pdf...]",
    );
  }

  for (const pdfPath of pdfPaths) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`File not found: ${pdfPath}`);
    }
  }

  const actorUserId = await resolveImportActorUserId();
  if (!actorUserId) {
    throw new Error(
      "No actor user for cost audit rows. Set PARTS_IMPORT_ACTOR_USER_ID or ensure an ADMIN/DEVELOPER user exists.",
    );
  }

  const batchId = `import-picklist-pdfs:${new Date().toISOString()}`;
  console.log(`Import batch id: ${batchId}`);
  console.log(`Actor user id: ${actorUserId}`);

  const allRows: PartSeed[] = [];
  for (const pdfPath of pdfPaths) {
    const rows = await extractPartsFromPdf(pdfPath);
    allRows.push(...rows);
  }

  const parts = mergePartSeeds(allRows);
  console.log(`\nUnique parts to import: ${parts.length}`);

  const existing = await prisma.part.findMany({
    where: { pn: { in: parts.map((p) => p.pn) } },
    select: { pn: true },
  });
  const existingPn = new Set(existing.map((p) => normalizePartNumber(p.pn)));

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const part of parts) {
    if (existingPn.has(part.pn)) {
      skipped++;
      continue;
    }

    const cost = demoPriceForPart(part.pn);
    const initialQty = part.quantity > 0 ? part.quantity : 25;

    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.part.create({
          data: {
            company: 1,
            pn: part.pn,
            whse: 1,
            nomenclature: part.nomenclature,
            cost,
            type: 0,
            units: part.units,
            vendor: "DEMO",
            vendorPartID: part.pn,
            quantity: BigInt(initialQty),
            reorderPoint: 5,
            orderMinimum: 10,
            status: "Active",
            dateUpdated: new Date().toISOString().slice(0, 10),
          },
        });

        await recordPartCostChange(tx, {
          partId: created.id,
          costBefore: null,
          costAfter: cost,
          actorUserId,
          contextType: COST_CONTEXT_IMPORT,
          contextId: batchId,
          note: `Picklist PDF import | PN ${created.pn} | demo cost ${cost.toFixed(2)} | sources: ${part.sourceFiles.join(", ")}`,
        });
      });

      imported++;
      if (imported % 25 === 0) {
        console.log(`  Imported ${imported} parts...`);
      }
    } catch (error) {
      errors++;
      console.error(`  Error importing ${part.pn}:`, error);
    }
  }

  console.log("\nImport complete!");
  console.log(`Successfully imported: ${imported}`);
  console.log(`Skipped (already in catalog): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main()
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
