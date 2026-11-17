import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as getHealth } from '@/app/api/health/route';
import { POST as validateTransition } from '@/app/api/orders/validate/route';
import { ORDERS_SEED } from '@/lib/data';

async function postValidate(body: unknown) {
  const req = new Request('http://localhost/api/orders/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await validateTransition(req);
  const json = await res.json();
  return { status: res.status, json };
}

test('API-01: GET /api/health returns 200 with service status and seed count', async () => {
  const res = await getHealth();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'rxflow-orders');
  assert.equal(data.seedOrders, ORDERS_SEED.length);
  assert.equal(typeof data.timestamp, 'string');
});

test('API-02: POST /api/orders/validate rejects malformed JSON and unsupported actions with 400', async () => {
  const badJson = await postValidate('{invalid');
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.code, 'INVALID_JSON');

  const badAction = await postValidate({ orderId: 'RX-001', action: 'delete-all' });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.json.code, 'INVALID_ACTION');
});

test('API-03: POST /api/orders/validate returns 404 for unknown orderId', async () => {
  const res = await postValidate({ orderId: 'RX-9999', action: 'accept' });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'ORDER_NOT_FOUND');
});

test('API-04: POST /api/orders/validate enforces verify-pay lock window (409 when locked, 200 when unlocked)', async () => {
  const locked = await postValidate({
    orderId: 'RX-004',
    action: 'verify-pay',
    verifyPayUnlockAt: Date.now() + 10_000,
  });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.code, 'VERIFY_PAY_LOCKED');

  const unlocked = await postValidate({
    orderId: 'RX-004',
    action: 'verify-pay',
    verifyPayUnlockAt: Date.now() - 10,
  });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.json.allowed, true);
  assert.equal(unlocked.json.nextActionType, 'accept');
});

test('API-05: POST /api/orders/validate enforces item expiry gate before ready transition', async () => {
  const orderMissingExpiry = {
    ...JSON.parse(JSON.stringify(ORDERS_SEED.find(o => o.id === 'RX-002'))),
  };
  orderMissingExpiry.items[0].expiry = '';

  const blocked = await postValidate({ order: orderMissingExpiry, action: 'ready' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'EXPIRY_REQUIRED');

  const valid = await postValidate({ orderId: 'RX-002', action: 'ready' });
  assert.equal(valid.status, 200);
  assert.equal(valid.json.nextActionType, 'deliver');
});

test('API-06: POST /api/orders/validate rejects state-mismatched actions with 409', async () => {
  const res = await postValidate({ orderId: 'RX-001', action: 'deliver' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'STATE_CONFLICT');
});

test('API-07: POST /api/orders/validate enforces reject reason and blocks terminal orders', async () => {
  const noReason = await postValidate({ orderId: 'RX-001', action: 'reject', rejectReason: '   ' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, 'REJECT_REASON_REQUIRED');

  const terminal = await postValidate({
    orderId: 'RX-009',
    action: 'cancel',
    rejectReason: 'Customer requested',
  });
  assert.equal(terminal.status, 409);
  assert.equal(terminal.json.code, 'TERMINAL_ORDER');
});
