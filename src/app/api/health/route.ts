import { NextResponse } from 'next/server';
import { ORDERS_SEED } from '@/lib/data';
import { getRecentViolations } from '@/lib/telemetry';
import { normalizeOrderFlow } from '@/lib/utils';
import type { Order } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sample = JSON.parse(JSON.stringify(ORDERS_SEED)) as Order[];
  sample.forEach(normalizeOrderFlow);

  const recentViolations = getRecentViolations();

  return NextResponse.json(
    {
      status: 'ok',
      service: 'rxflow-orders',
      timestamp: new Date().toISOString(),
      seedOrders: sample.length,
      recentViolationsCount: recentViolations.length,
    },
    { status: 200 },
  );
}
