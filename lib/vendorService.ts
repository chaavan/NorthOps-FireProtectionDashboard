import type { Vendor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  displaySupplierName,
  isValidEmail,
  normalizeSupplierKey,
  parseEmailList,
} from "@/lib/suppliers";
import { mergeManualVendorKeys, normalizeVendorKey } from "@/lib/vendorUtils";

export type VendorSetupStatus = "ready" | "needs_setup" | "inactive" | "inventory_only";

export type UnifiedVendor = {
  id: string | null;
  vendorKey: string;
  displayName: string;
  toEmails: string[];
  ccEmails: string[];
  isActive: boolean;
  setupStatus: VendorSetupStatus;
  partCount: number;
  isMaster: boolean;
};

export type VendorRecord = {
  id: string;
  vendorKey: string;
  displayName: string;
  toEmails: string[];
  ccEmails: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function parseStoredEmails(value: unknown): string[] {
  if (Array.isArray(value)) {
    return parseEmailList(value as string[]);
  }
  return [];
}

export function toVendorRecord(vendor: Vendor): VendorRecord {
  return {
    id: vendor.id,
    vendorKey: vendor.vendorKey,
    displayName: vendor.displayName,
    toEmails: parseStoredEmails(vendor.toEmails),
    ccEmails: parseStoredEmails(vendor.ccEmails),
    isActive: vendor.isActive,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
  };
}

export function computeSetupStatus(params: {
  isActive: boolean;
  toEmails: string[];
  isMaster: boolean;
}): VendorSetupStatus {
  if (!params.isMaster) return "inventory_only";
  if (!params.isActive) return "inactive";
  if (params.toEmails.length === 0) return "needs_setup";
  return "ready";
}

async function getPartCountByVendorKey(): Promise<Map<string, number>> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT UPPER(TRIM("vendor")) AS vendor_key, COUNT(*)::int AS part_count
     FROM "parts"
     WHERE "vendor" IS NOT NULL AND TRIM("vendor") != ''
     GROUP BY UPPER(TRIM("vendor"))`,
  )) as Array<{ vendor_key: string; part_count: number }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeSupplierKey(row.vendor_key);
    if (key === "UNASSIGNED") continue;
    counts.set(key, (counts.get(key) ?? 0) + Number(row.part_count));
  }
  return counts;
}

async function getDistinctInventoryVendorKeys(): Promise<string[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "vendor" FROM "parts" WHERE "vendor" IS NOT NULL AND TRIM("vendor") != ''`,
  )) as Array<{ vendor: string }>;

  const keys = new Set<string>();
  for (const row of rows) {
    const key = normalizeSupplierKey(row.vendor);
    if (key !== "UNASSIGNED") keys.add(key);
  }
  return Array.from(keys);
}

export async function listUnifiedVendors(): Promise<UnifiedVendor[]> {
  const [masterRows, partCounts, inventoryKeys] = await Promise.all([
    prisma.vendor.findMany({ orderBy: [{ displayName: "asc" }] }),
    getPartCountByVendorKey(),
    getDistinctInventoryVendorKeys(),
  ]);

  const masterByKey = new Map(masterRows.map((row) => [row.vendorKey, row]));
  const unified: UnifiedVendor[] = masterRows.map((row) => {
    const toEmails = parseStoredEmails(row.toEmails);
    const ccEmails = parseStoredEmails(row.ccEmails);
    return {
      id: row.id,
      vendorKey: row.vendorKey,
      displayName: row.displayName,
      toEmails,
      ccEmails,
      isActive: row.isActive,
      setupStatus: computeSetupStatus({ isActive: row.isActive, toEmails, isMaster: true }),
      partCount: partCounts.get(row.vendorKey) ?? 0,
      isMaster: true,
    };
  });

  for (const vendorKey of inventoryKeys) {
    if (masterByKey.has(vendorKey)) continue;
    unified.push({
      id: null,
      vendorKey,
      displayName: displaySupplierName(vendorKey),
      toEmails: [],
      ccEmails: [],
      isActive: true,
      setupStatus: "inventory_only",
      partCount: partCounts.get(vendorKey) ?? 0,
      isMaster: false,
    });
  }

  unified.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return unified;
}

export async function getActiveVendorKeysForDropdown(): Promise<string[]> {
  const [activeMaster, partKeys] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { vendorKey: true },
      orderBy: { displayName: "asc" },
    }),
    getDistinctInventoryVendorKeys(),
  ]);

  const lowercaseKeys = [
    ...activeMaster.map((row) => normalizeVendorKey(row.vendorKey)),
    ...partKeys.map((key) => normalizeVendorKey(key)),
  ];

  return mergeManualVendorKeys(lowercaseKeys);
}

export async function getVendorDirectoryByKeys(keys: string[]): Promise<Map<string, VendorRecord>> {
  const normalizedKeys = [...new Set(keys.map((key) => normalizeSupplierKey(key)))];
  if (normalizedKeys.length === 0) return new Map();

  const rows = await prisma.vendor.findMany({
    where: {
      vendorKey: { in: normalizedKeys },
      isActive: true,
    },
  });

  return new Map(rows.map((row) => [row.vendorKey, toVendorRecord(row)]));
}

function validateEmails(toEmails: string[], ccEmails: string[]): string | null {
  const invalid = [...toEmails, ...ccEmails].find((email) => !isValidEmail(email));
  return invalid ? `Invalid email: ${invalid}` : null;
}

export async function createVendor(params: {
  displayName: string;
  toEmails?: string | string[];
  ccEmails?: string | string[];
  isActive?: boolean;
  vendorKeyOverride?: string;
}): Promise<VendorRecord> {
  const displayName = params.displayName.trim();
  if (!displayName) {
    throw new Error("Vendor name is required.");
  }

  const vendorKey = params.vendorKeyOverride
    ? normalizeSupplierKey(params.vendorKeyOverride)
    : normalizeSupplierKey(displayName);
  if (vendorKey === "UNASSIGNED") {
    throw new Error("Invalid vendor name.");
  }

  const toEmails = parseEmailList(params.toEmails);
  const ccEmails = parseEmailList(params.ccEmails);
  const emailError = validateEmails(toEmails, ccEmails);
  if (emailError) throw new Error(emailError);

  const vendor = await prisma.vendor.create({
    data: {
      vendorKey,
      displayName,
      toEmails,
      ccEmails,
      isActive: params.isActive !== false,
    },
  });

  return toVendorRecord(vendor);
}

export async function updateVendor(
  id: string,
  params: {
    displayName?: string;
    toEmails?: string | string[];
    ccEmails?: string | string[];
    isActive?: boolean;
  },
): Promise<VendorRecord> {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new Error("Vendor not found.");

  const displayName = params.displayName !== undefined ? params.displayName.trim() : existing.displayName;
  if (!displayName) throw new Error("Vendor name is required.");

  const toEmails =
    params.toEmails !== undefined ? parseEmailList(params.toEmails) : parseStoredEmails(existing.toEmails);
  const ccEmails =
    params.ccEmails !== undefined ? parseEmailList(params.ccEmails) : parseStoredEmails(existing.ccEmails);
  const emailError = validateEmails(toEmails, ccEmails);
  if (emailError) throw new Error(emailError);

  const vendorKey = normalizeSupplierKey(displayName);

  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      vendorKey,
      displayName,
      toEmails,
      ccEmails,
      isActive: params.isActive ?? existing.isActive,
    },
  });

  return toVendorRecord(vendor);
}

export async function archiveVendor(id: string): Promise<VendorRecord> {
  const vendor = await prisma.vendor.update({
    where: { id },
    data: { isActive: false },
  });
  return toVendorRecord(vendor);
}

export function vendorHasPoEmailSetup(vendor: Pick<VendorRecord, "toEmails"> | null | undefined): boolean {
  return Boolean(vendor?.toEmails?.length);
}
