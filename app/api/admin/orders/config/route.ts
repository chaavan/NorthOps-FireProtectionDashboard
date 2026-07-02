import { NextResponse } from 'next/server';
import { isPurchaseOrderEmailEnabled } from '@/lib/purchaseOrderWebhook';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    emailEnabled: isPurchaseOrderEmailEnabled(),
  });
}
