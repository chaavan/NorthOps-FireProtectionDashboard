import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config(); // Load .env file

const prisma = new PrismaClient();

async function listParts() {
  try {
    // Get total count first
    const countResult = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM "parts"
    `) as Array<{ count: bigint }>;

    const totalCount = Number(countResult[0].count);

    // Query all parts from database (limit to 100 for display, can be adjusted)
    const parts = await prisma.$queryRawUnsafe(`
      SELECT 
        "pn" as "partNumber",
        "nomenclature" as "description",
        "vendor" as "supplier",
        "cost",
        "company",
        "whse",
        "units",
        "altPN" as "altPartNumber",
        "code",
        "createdAt",
        "updatedAt"
      FROM "parts"
      ORDER BY "pn" ASC
      LIMIT 100
    `) as Array<{
      partNumber: string;
      description: string;
      supplier: string | null;
      cost: number;
      company: number;
      whse: number;
      units: string;
      altPartNumber: string | null;
      code: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;

    console.log('\n📦 Parts in Database:\n');
    console.log('─'.repeat(100));

    if (parts.length === 0) {
      console.log('No parts found in database.');
    } else {
      parts.forEach((part, index) => {
        const supplierEmoji = part.supplier
          ? (part.supplier.toUpperCase().includes('ETNA') ? '🔵'
            : part.supplier.toUpperCase().includes('GALLOUP') ? '🟢'
              : part.supplier.toUpperCase().includes('VIKING') ? '🟣'
                : part.supplier.toUpperCase().includes('CORE') ? '🟠'
                  : '⚪')
          : '⚪';

        console.log(`${index + 1}. ${part.partNumber}`);
        console.log(`   Description: ${part.description || 'N/A'}`);
        console.log(`   Supplier: ${supplierEmoji} ${part.supplier || 'N/A'}`);
        console.log(`   Cost: $${part.cost.toFixed(2)}`);
        console.log(`   Company: ${part.company} | Warehouse: ${part.whse} | Units: ${part.units}`);
        if (part.altPartNumber) {
          console.log(`   Alt PN: ${part.altPartNumber}`);
        }
        if (part.code) {
          console.log(`   Code: ${part.code}`);
        }
        console.log(`   Created: ${part.createdAt.toLocaleDateString()}`);
        console.log('─'.repeat(100));
      });
    }

    console.log(`\nShowing ${parts.length} of ${totalCount} total parts\n`);

    // Show vendor breakdown if we have parts
    if (parts.length > 0) {
      const vendorBreakdown = new Map<string, number>();
      parts.forEach(part => {
        const vendor = part.supplier || 'No Supplier';
        vendorBreakdown.set(vendor, (vendorBreakdown.get(vendor) || 0) + 1);
      });

      console.log('📊 Vendor Breakdown (from displayed parts):');
      Array.from(vendorBreakdown.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([vendor, count]) => {
          console.log(`   ${vendor}: ${count} parts`);
        });
      console.log('');
    }
  } catch (error) {
    console.error('Error listing parts:', error);
    throw error;
  }
}

listParts()
  .catch(console.error)
  .finally(() => prisma.$disconnect());


