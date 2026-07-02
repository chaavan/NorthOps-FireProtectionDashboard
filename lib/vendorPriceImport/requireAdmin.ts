import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions, resolveSessionUserIdForAudit } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import type { PermissionKey } from '@/lib/permissionCatalog';

const PERMISSION_ERRORS: Record<
  'page' | 'review' | 'commit' | 'discard',
  { permission: PermissionKey; message: string }
> = {
  page: {
    permission: 'inventory.vendor_prices.import',
    message: 'Forbidden - Vendor price import access required',
  },
  review: {
    permission: 'inventory.vendor_prices.review',
    message: 'Forbidden - Review and import permission required',
  },
  commit: {
    permission: 'inventory.vendor_prices.commit',
    message: 'Forbidden - Commit vendor imports permission required',
  },
  discard: {
    permission: 'inventory.vendor_prices.discard',
    message: 'Forbidden - Discard vendor imports permission required',
  },
};

async function requireVendorPricePermission(kind: keyof typeof PERMISSION_ERRORS) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 }),
    };
  }
  const { permission, message } = PERMISSION_ERRORS[kind];
  if (!(await hasPermission(session, permission))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: message }, { status: 403 }),
    };
  }
  const userId = await resolveSessionUserIdForAudit(session);
  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'User account not found for session' }, { status: 403 }),
    };
  }
  return { ok: true as const, session, userId };
}

export function requireVendorPricePageAccess() {
  return requireVendorPricePermission('page');
}

export function requireVendorPriceReviewAccess() {
  return requireVendorPricePermission('review');
}

export function requireVendorPriceCommitAccess() {
  return requireVendorPricePermission('commit');
}

export function requireVendorPriceDiscardAccess() {
  return requireVendorPricePermission('discard');
}

export const requireVendorPriceAdmin = requireVendorPriceReviewAccess;
