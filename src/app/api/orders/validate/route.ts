import { NextResponse } from 'next/server';
import { ORDERS_SEED } from '@/lib/data';
import { reportInvariantViolation } from '@/lib/telemetry';
import type { ActionType, Order } from '@/lib/types';
import { isExpiryFulfilledForReady, normalizeOrderFlow } from '@/lib/utils';

interface ValidateTransitionBody {
  orderId?: unknown;
  action?: unknown;
  verifyPayUnlockAt?: unknown;
  rejectReason?: unknown;
  order?: unknown;
}

const VALID_ACTIONS = new Set<string>([
  'verify-pay',
  'accept',
  'ready',
  'deliver',
  'handoff',
  'reject',
  'cancel',
]);

export async function POST(request: Request) {
  let body: ValidateTransitionBody;
  try {
    body = (await request.json()) as ValidateTransitionBody;
  } catch {
    return NextResponse.json(
      { allowed: false, code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { allowed: false, code: 'INVALID_ACTION', message: 'Unsupported workflow action' },
      { status: 400 },
    );
  }

  let order: Order | null = null;
  if (body.order && typeof body.order === 'object') {
    const candidate = body.order as Partial<Order>;
    if (typeof candidate.id === 'string' && typeof candidate.status === 'string' && Array.isArray(candidate.items)) {
      order = JSON.parse(JSON.stringify(candidate)) as Order;
    } else {
      return NextResponse.json(
        { allowed: false, code: 'INVALID_ORDER_PAYLOAD', message: 'Order payload is missing required fields' },
        { status: 400 },
      );
    }
  } else if (typeof body.orderId === 'string' && body.orderId.trim()) {
    const found = ORDERS_SEED.find(item => item.id === body.orderId);
    if (!found) {
      return NextResponse.json(
        { allowed: false, code: 'ORDER_NOT_FOUND', message: `Order ${body.orderId} was not found` },
        { status: 404 },
      );
    }
    order = JSON.parse(JSON.stringify(found)) as Order;
  } else {
    return NextResponse.json(
      { allowed: false, code: 'MISSING_ORDER_REF', message: 'Provide either orderId or order' },
      { status: 400 },
    );
  }

  normalizeOrderFlow(order);

  if (action === 'reject' || action === 'cancel') {
    const reason = typeof body.rejectReason === 'string' ? body.rejectReason.trim() : '';
    if (!reason) {
      return NextResponse.json(
        { allowed: false, code: 'REJECT_REASON_REQUIRED', message: 'A reason is required to reject or cancel an order' },
        { status: 400 },
      );
    }
    if (order.actionType === 'done') {
      return NextResponse.json(
        { allowed: false, code: 'TERMINAL_ORDER', message: 'Terminal orders cannot be modified' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        allowed: true,
        code: 'OK',
        orderId: order.id,
        nextStatus: action === 'cancel' ? 'cancelled' : 'rejected',
        nextActionType: 'done' as ActionType,
      },
      { status: 200 },
    );
  }

  if (order.actionType !== action) {
    reportInvariantViolation('API_ACTION_MISMATCH', 'API validation rejected out-of-state action', {
      orderId: order.id,
      expected: order.actionType,
      received: action,
    });
    return NextResponse.json(
      {
        allowed: false,
        code: 'STATE_CONFLICT',
        message: `Order ${order.id} expects action "${order.actionType}", not "${action}"`,
      },
      { status: 409 },
    );
  }

  if (action === 'verify-pay') {
    const unlockAt = typeof body.verifyPayUnlockAt === 'number' ? body.verifyPayUnlockAt : 0;
    if (unlockAt > Date.now()) {
      return NextResponse.json(
        {
          allowed: false,
          code: 'VERIFY_PAY_LOCKED',
          message: 'Payment verification is still within the mandatory lock window',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        allowed: true,
        code: 'OK',
        orderId: order.id,
        nextStatus: 'new',
        nextActionType: 'accept' as ActionType,
      },
      { status: 200 },
    );
  }

  if (action === 'ready' && !isExpiryFulfilledForReady(order)) {
    reportInvariantViolation('API_EXPIRY_MISSING', 'API validation blocked ready transition with missing expiry', {
      orderId: order.id,
    });
    return NextResponse.json(
      {
        allowed: false,
        code: 'EXPIRY_REQUIRED',
        message: 'All items must have an expiry date before marking ready',
      },
      { status: 409 },
    );
  }

  const nextActionMap: Partial<Record<ActionType, { status: Order['status']; actionType: ActionType }>> = {
    accept: { status: 'preparing', actionType: 'ready' },
    ready: { status: 'ready', actionType: order.deliveryType === 'courier' ? 'deliver' : 'handoff' },
    deliver: { status: 'delivering', actionType: 'transit' },
    handoff: { status: 'delivered', actionType: 'delivered-hold' },
  };

  const transition = nextActionMap[action as ActionType];
  if (!transition) {
    return NextResponse.json(
      { allowed: false, code: 'UNSUPPORTED_TRANSITION', message: `Cannot transition from ${action}` },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      allowed: true,
      code: 'OK',
      orderId: order.id,
      nextStatus: transition.status,
      nextActionType: transition.actionType,
    },
    { status: 200 },
  );
}
