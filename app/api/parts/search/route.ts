import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { PermissionKey } from "@/lib/permissionCatalog";

export const dynamic = "force-dynamic";

function scoreMatch(query: string, pn: string, description: string): number {
  const q = query.toLowerCase();
  const partNumber = pn.toLowerCase();
  const desc = description.toLowerCase();

  if (partNumber === q) return 400;
  if (partNumber.startsWith(q)) return 300;
  if (partNumber.includes(q)) return 200;
  if (desc.includes(q)) return 100;
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const permissionContext = {
      jobNumber: searchParams.get("jobNumber") || undefined,
      listNumber: searchParams.get("listNumber") || undefined,
    };
    const lookupPermissions: PermissionKey[] = [
      "inventory.view",
      "inventory.add_part",
      "inventory.edit_part",
      "job.puller.add_line",
      "job.puller.edit_line",
      "job.preorder.edit",
    ];
    const canLookupParts = (
      await Promise.all(
        lookupPermissions.map((key) =>
          hasPermission(session, key, permissionContext),
        ),
      )
    ).some(Boolean);

    if (!canLookupParts) {
      return NextResponse.json(
        { error: "Forbidden - Part lookup permission required" },
        { status: 403 },
      );
    }

    const query = String(searchParams.get("q") || "").trim();
    const requestedLimit = Number(searchParams.get("limit") || 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(1, Math.floor(requestedLimit)), 25)
      : 10;

    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const candidates = await prisma.part.findMany({
      where: {
        OR: [
          { pn: { contains: query, mode: "insensitive" } },
          { nomenclature: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        pn: true,
        nomenclature: true,
        units: true,
        vendor: true,
        cost: true,
        quantity: true,
      },
      take: 80,
      orderBy: [{ pn: "asc" }],
    });

    const results = candidates
      .map((part) => {
        const partNumber = String(part.pn || "").trim();
        const description = String(part.nomenclature || "").trim();
        const score = scoreMatch(query, partNumber, description);
        return {
          partNumber,
          description: description || null,
          uom: part.units ? String(part.units).trim() : null,
          vendor: part.vendor ? String(part.vendor).trim() : null,
          cost:
            part.cost === null || part.cost === undefined
              ? null
              : Number(part.cost),
          quantity:
            part.quantity === null || part.quantity === undefined
              ? null
              : Number(part.quantity),
          _score: score,
        };
      })
      .filter((row) => row.partNumber && row._score > 0)
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return a.partNumber.localeCompare(b.partNumber);
      })
      .slice(0, limit)
      .map(({ _score, ...row }) => row);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error in /api/parts/search GET:", error);
    return NextResponse.json(
      { error: "Failed to search parts", details: (error as Error).message },
      { status: 500 },
    );
  }
}
