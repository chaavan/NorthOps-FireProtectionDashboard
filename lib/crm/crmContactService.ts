import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CrmContactRecord } from "@/lib/crm/crmTypes";

function toContactRecord(row: {
  id: string;
  accountId: string;
  locationId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  account?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
}): CrmContactRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    locationId: row.locationId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.isPrimary,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    account: row.account ? { id: row.account.id, name: row.account.name } : null,
    location: row.location ? { id: row.location.id, name: row.location.name } : null,
  };
}

export async function listCrmContacts(filters?: {
  accountId?: string | null;
  search?: string | null;
}): Promise<CrmContactRecord[]> {
  const search = filters?.search?.trim();
  const where: Prisma.CrmContactWhereInput = {
    ...(filters?.accountId ? { accountId: filters.accountId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.crmContact.findMany({
    where,
    include: { account: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map(toContactRecord);
}

export async function getCrmContact(id: string): Promise<CrmContactRecord | null> {
  const row = await prisma.crmContact.findUnique({
    where: { id },
    include: { account: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  });
  return row ? toContactRecord(row) : null;
}

export async function createCrmContact(input: {
  accountId: string;
  locationId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  isPrimary?: boolean;
  notes?: string | null;
}): Promise<CrmContactRecord> {
  const row = await prisma.crmContact.create({
    data: {
      accountId: input.accountId,
      locationId: input.locationId || null,
      name: input.name.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      role: input.role?.trim() || "OTHER",
      isPrimary: input.isPrimary ?? false,
      notes: input.notes?.trim() || null,
    },
    include: { account: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  });
  return toContactRecord(row);
}

export async function updateCrmContact(
  id: string,
  input: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    role?: string;
    isPrimary?: boolean;
    notes?: string | null;
    locationId?: string | null;
  },
): Promise<CrmContactRecord> {
  const row = await prisma.crmContact.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() || "OTHER" } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId || null } : {}),
    },
    include: { account: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  });
  return toContactRecord(row);
}

export async function deleteCrmContact(id: string): Promise<void> {
  await prisma.crmContact.delete({ where: { id } });
}
