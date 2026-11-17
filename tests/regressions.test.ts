import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initialState, reducer } from '@/store/orderStore';
import { clearTelemetryBuffer, getRecentViolations, reportInvariantViolation } from '@/lib/telemetry';
import { normalizeOrderFlow } from '@/lib/utils';
import type { Order } from '@/lib/types';

const ROOT = process.cwd();

test('REG-001: legacy COD orders normalize cleanly to paid VNPay without crashing workflow', () => {
  const base = initialState();
  const codOrder: Order = {
    ...JSON.parse(JSON.stringify(base.orders[0])),
    payStatus: 'cod',
    payMethod: 'Cash on Delivery',
  };
  normalizeOrderFlow(codOrder);
  assert.equal(codOrder.payStatus, 'paid');
  assert.equal(codOrder.payMethod, 'VNPay');
  assert.equal(codOrder.actionType, 'accept');
});

test('REG-002: rejected prescription forces terminal completed/done state and clears deliveredAt', () => {
  const base = initialState();
  const order: Order = {
    ...JSON.parse(JSON.stringify(base.orders[0])),
    status: 'delivered',
    deliveredAt: Date.now(),
    rxStatus: 'rejected',
  };
  normalizeOrderFlow(order);
  assert.equal(order.status, 'completed');
  assert.equal(order.phase, 6);
  assert.equal(order.actionType, 'done');
  assert.equal(order.deliveredAt, undefined);
});

test('REG-003: Dashboard and IncomingPopup do not retain dead barcode timeout or unused orders prop', () => {
  const dashboardSrc = fs.readFileSync(path.join(ROOT, 'src/components/Dashboard.tsx'), 'utf8');
  const incomingSrc = fs.readFileSync(path.join(ROOT, 'src/components/modals/IncomingPopup.tsx'), 'utf8');
  assert.equal(dashboardSrc.includes("shouldStartBarcode && order?.actionType !== 'accept'"), false);
  assert.equal(/orders:\s*Order\[\]/.test(incomingSrc), false);
});

test('REG-004: whitespace-only pharmacy chat replies must not append empty message bubbles', () => {
  const state = initialState();
  const before = state.orders.find(o => o.id === 'RX-001')!.msgs.length;
  const next = reducer(state, { type: 'SEND_MSG', orderId: 'RX-001', text: '   ' });
  const after = next.orders.find(o => o.id === 'RX-001')!.msgs.length;
  assert.equal(after, before);
});

test('REG-005: production invariant telemetry records bounded events without customer PII fields', () => {
  clearTelemetryBuffer();
  for (let i = 0; i < 60; i++) {
    reportInvariantViolation(`TEST_CODE_${i}`, 'Synthetic invariant event', { orderId: `RX-${i}` });
  }
  const buffered = getRecentViolations();
  assert.equal(buffered.length, 50);
  assert.equal(buffered[0].code, 'TEST_CODE_10');
  assert.equal(buffered.at(-1)?.code, 'TEST_CODE_59');
});
