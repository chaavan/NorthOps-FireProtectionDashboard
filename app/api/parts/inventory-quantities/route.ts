import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/parts/inventory-quantities?partNumbers=PN1,PN2,PN3
 * 
 * Get inventory quantities for multiple part numbers in a single request
 * Returns: { [partNumber: string]: number | null }
 * - number: current inventory quantity (converted from BigInt)
 * - null: part not found in inventory database
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    // Used by the job overview/puller table to show available quantity, so
    // job view access is enough on its own — it shouldn't also require the
    // separate Inventory page permission.
    const canViewQuantities =
      (await hasPermission(session, 'inventory.view')) ||
      (await hasPermission(session, 'job.puller.view'));
    if (!canViewQuantities) {
      return NextResponse.json(
        { error: 'Forbidden - Inventory or job view access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const partNumbersParam = searchParams.get('partNumbers');

    if (!partNumbersParam) {
      return NextResponse.json({});
    }

    // Parse part numbers from comma-separated string
    const partNumbers = partNumbersParam
      .split(',')
      .map(pn => pn.trim())
      .filter(pn => pn.length > 0);

    if (partNumbers.length === 0) {
      return NextResponse.json({});
    }

    // Normalize part numbers and create all variations for matching
    const variationsMap = new Map<string, string>(); // normalized -> original
    const allVariations: string[] = [];

    partNumbers.forEach(originalPN => {
      // Normalize: remove spaces, tabs, newlines, convert to uppercase
      const normalizedPN = originalPN.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
      
      // Create variations for matching
      const variations = [
        normalizedPN,
        originalPN.trim(),
        originalPN.trim().toUpperCase(),
        originalPN.trim().toLowerCase(),
      ];

      // Store mapping from normalized to original
      variationsMap.set(normalizedPN, originalPN);

      // Add unique variations to search list
      variations.forEach(v => {
        if (v && !allVariations.includes(v)) {
          allVariations.push(v);
        }
      });
    });

    if (allVariations.length === 0) {
      return NextResponse.json({});
    }

    // Query database for all variations
    const parts = await prisma.part.findMany({
      where: {
        pn: {
          in: allVariations,
        },
      },
      select: {
        pn: true,
        quantity: true,
      },
    });

    // Build result map: original part number -> quantity
    const result: { [partNumber: string]: number | null } = {};

    // Initialize all requested part numbers to null (not found)
    partNumbers.forEach(pn => {
      result[pn] = null;
    });

    // Process found parts
    const foundNormalized = new Set<string>();
    
    parts.forEach(part => {
      // Find which original part number this matches
      const partPN = part.pn;
      const normalizedPN = partPN.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
      
      // Find matching original part number
      let matchedOriginal: string | null = null;
      
      // First try exact normalized match
      if (variationsMap.has(normalizedPN)) {
        matchedOriginal = variationsMap.get(normalizedPN)!;
      } else {
        // Try to find by checking if any original normalizes to this
        for (const [norm, orig] of variationsMap.entries()) {
          if (normalizedPN === norm) {
            matchedOriginal = orig;
            break;
          }
        }
      }

      // If still no match, try direct match with any variation
      if (!matchedOriginal) {
        for (const orig of partNumbers) {
          const origNorm = orig.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
          if (normalizedPN === origNorm || partPN.toLowerCase() === orig.toLowerCase()) {
            matchedOriginal = orig;
            break;
          }
        }
      }

      // If we found a match and haven't already set a value for it
      if (matchedOriginal && result[matchedOriginal] === null) {
        const quantity = part.quantity ? Number(part.quantity) : 0;
        result[matchedOriginal] = quantity;
        foundNormalized.add(normalizedPN);
      }
    });

    // For parts that appear multiple times with different normalization, use first match
    // Handle edge case: if same part number requested multiple times, use same quantity
    const seenNormalized = new Set<string>();
    partNumbers.forEach(pn => {
      const normalizedPN = pn.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
      if (!seenNormalized.has(normalizedPN)) {
        seenNormalized.add(normalizedPN);
      } else {
        // Duplicate part number in request - use value from first occurrence
        const firstOccurrence = partNumbers.findIndex(p => {
          const norm = p.replace(/[\s\t\r\n]+/g, '').toUpperCase().trim();
          return norm === normalizedPN;
        });
        if (firstOccurrence >= 0 && firstOccurrence < partNumbers.indexOf(pn)) {
          result[pn] = result[partNumbers[firstOccurrence]];
        }
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in /api/parts/inventory-quantities GET:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory quantities', details: (error as Error).message },
      { status: 500 }
    );
  }
}
