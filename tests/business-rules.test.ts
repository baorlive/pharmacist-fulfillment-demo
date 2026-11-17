import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from '@/store/orderStore';
import { clearTelemetryBuffer, getRecentViolations } from '@/lib/telemetry';
import {
  COMPLETE_AUTO_MS,
  DELIVERING_ETA_MS,
  MAIN_ACTION_LOCK_MS,
  getOrderStageKey,
  isExpiryFulfilledForReady,
  normalizeOrderFlow,
  shippingMeta,
  sortOrders,
  workflowStatusMeta,
} from '@/lib/utils';
import type { Order } from '@/lib/types';

test('BR-01: verify-pay enforces payment lock window before unlocking accept', () => {
  clearTelemetryBuffer();
  const base = initialState();
  const unpaid = base.orders.find(o => o.id === 'RX-004');
  assert.ok(unpaid, 'Seed order RX-004 must exist');
  assert.equal(unpaid.actionType, 'verify-pay');

  // Locked while verifyPayUnlockAt is in the future
  const lockedState = { ...base, verifyPayUnlockAt: Date.now() + 5000 };
  const blocked = reducer(lockedState, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-004' });
  assert.equal(blocked.orders.find(o => o.id === 'RX-004')?.actionType, 'verify-pay');
  assert.equal(getRecentViolations().at(-1)?.code, 'VERIFY_PAY_LOCK_BLOCKED');

  // Allowed once verifyPayUnlockAt has elapsed
  const unlockedState = { ...base, verifyPayUnlockAt: Date.now() - 1 };
  const verified = reducer(unlockedState, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-004' });
  const updated = verified.orders.find(o => o.id === 'RX-004')!;
  assert.equal(updated.payStatus, 'paid');
  assert.equal(updated.actionType, 'accept');
  assert.equal(updated.seenByPharmacist, true);
});

test('BR-02: accept opens barcode packing for unpacked items and force-close resets to preparing', () => {
  let state = initialState();
  state = reducer(state, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-001' });

  const orderAfterAccept = state.orders.find(o => o.id === 'RX-001')!;
  assert.equal(orderAfterAccept.actionType, 'review');
  assert.equal(orderAfterAccept.rxStatus, 'approved');
  assert.equal(state.barcode.isOpen, true);
  assert.equal(state.barcode.activeOrderId, 'RX-001');
  assert.equal(state.barcode.total, orderAfterAccept.items.length);

  // Main CTA is blocked while in review
  const reviewBlocked = reducer(
    { ...state, mainActionLockedUntil: 0 },
    { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-001' },
  );
  assert.equal(reviewBlocked.orders.find(o => o.id === 'RX-001')?.actionType, 'review');

  // Force-closing before completion resets packed flags and sets preparing/ready
  const paused = reducer(state, { type: 'CLOSE_BARCODE', force: true });
  const pausedOrder = paused.orders.find(o => o.id === 'RX-001')!;
  assert.equal(paused.barcode.isOpen, false);
  assert.equal(pausedOrder.status, 'preparing');
  assert.equal(pausedOrder.actionType, 'ready');
  assert.equal(pausedOrder.items.every(item => !item.packed), true);
});

test('BR-03: ready transition is blocked if any item is missing an expiry date', () => {
  clearTelemetryBuffer();
  const base = initialState();
  const orders = base.orders.map(o =>
    o.id === 'RX-002'
      ? {
          ...o,
          status: 'preparing' as const,
          actionType: 'ready' as const,
          items: o.items.map((item, idx) => (idx === 0 ? { ...item, expiry: '' } : item)),
        }
      : o,
  );
  const state = { ...base, orders, mainActionLockedUntil: 0 };
  const target = state.orders.find(o => o.id === 'RX-002')!;
  assert.equal(isExpiryFulfilledForReady(target), false);

  const next = reducer(state, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-002' });
  assert.equal(next.orders.find(o => o.id === 'RX-002')?.status, 'preparing');
  assert.equal(next.toast.icon, 'error');
  assert.equal(getRecentViolations().at(-1)?.code, 'EXPIRY_GATE_BLOCKED');
});

test('BR-04: completing all barcode scans enables confirmation into deliver (courier) or handoff (pickup)', () => {
  // Courier order RX-001 -> deliver
  let courierState = initialState();
  courierState = reducer(courierState, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-001' });
  while (courierState.barcode.done < courierState.barcode.total) {
    courierState = reducer(courierState, { type: 'START_BARCODE_SCAN' });
    courierState = reducer(courierState, { type: 'COMPLETE_BARCODE_SCAN' });
  }
  // Cannot close normally until confirmed; confirm moves to ready + deliver
  courierState = reducer(courierState, { type: 'CONFIRM_BARCODE_PACKED' });
  const packedCourier = courierState.orders.find(o => o.id === 'RX-001')!;
  assert.equal(packedCourier.status, 'ready');
  assert.equal(packedCourier.actionType, 'deliver');
  assert.equal(packedCourier.items.every(i => i.packed), true);

  // Pickup order RX-008 -> handoff
  let pickupState = initialState();
  pickupState = reducer(pickupState, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-008' });
  while (pickupState.barcode.done < pickupState.barcode.total) {
    pickupState = reducer(pickupState, { type: 'START_BARCODE_SCAN' });
    pickupState = reducer(pickupState, { type: 'COMPLETE_BARCODE_SCAN' });
  }
  pickupState = reducer(pickupState, { type: 'CONFIRM_BARCODE_PACKED' });
  const packedPickup = pickupState.orders.find(o => o.id === 'RX-008')!;
  assert.equal(packedPickup.status, 'ready');
  assert.equal(packedPickup.actionType, 'handoff');
});

test('BR-05: delivering auto-transitions to delivered-hold and then completed after hold timer', () => {
  const base = initialState();
  const now = Date.now();
  const orders = base.orders.map(o =>
    o.id === 'RX-006'
      ? {
          ...o,
          status: 'delivering' as const,
          actionType: 'transit' as const,
          deliveringStartedAt: now - DELIVERING_ETA_MS - 100,
        }
      : o,
  );
  let state = reducer({ ...base, orders }, { type: 'TICK_TIMERS' });
  let order = state.orders.find(o => o.id === 'RX-006')!;
  assert.equal(order.status, 'delivered');
  assert.equal(order.actionType, 'delivered-hold');

  // Simulate elapsed hold duration
  state = {
    ...state,
    orders: state.orders.map(o =>
      o.id === 'RX-006' ? { ...o, deliveredAt: Date.now() - COMPLETE_AUTO_MS - 100 } : o,
    ),
  };
  state = reducer(state, { type: 'TICK_TIMERS' });
  order = state.orders.find(o => o.id === 'RX-006')!;
  assert.equal(order.status, 'completed');
  assert.equal(order.actionType, 'done');
});

test('BR-06: reject/cancel requires a reason and moves order to terminal phase 6', () => {
  let state = initialState();
  state = reducer(state, { type: 'OPEN_REJECT_POPUP', orderId: 'RX-001', mode: 'reject' });
  // Empty reason must not confirm
  const unchanged = reducer(state, { type: 'CONFIRM_REJECT' });
  assert.equal(unchanged.rejectPopup.isOpen, true);

  state = reducer(state, { type: 'SET_REJECT_REASON', reason: 'Prescription invalid' });
  state = reducer(state, { type: 'CONFIRM_REJECT' });
  const rejected = state.orders.find(o => o.id === 'RX-001')!;
  assert.equal(state.rejectPopup.isOpen, false);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.phase, 6);
  assert.equal(rejected.actionType, 'done');
  assert.equal(rejected.rejectReason, 'Prescription invalid');
});

test('BR-07: rapid duplicate main actions within MAIN_ACTION_LOCK_MS are suppressed', () => {
  const base = initialState();
  const locked = { ...base, mainActionLockedUntil: Date.now() + MAIN_ACTION_LOCK_MS };
  const next = reducer(locked, { type: 'HANDLE_MAIN_ACTION', orderId: 'RX-001' });
  assert.equal(next, locked);
});

test('BR-08: messaging ignores whitespace and clears unread when messages tab opens', () => {
  let state = initialState();
  state = reducer(state, { type: 'SELECT_ORDER', id: 'RX-001' });
  const initialCount = state.orders.find(o => o.id === 'RX-001')!.msgs.length;

  state = reducer(state, { type: 'SEND_MSG', orderId: 'RX-001', text: '   \n\t  ' });
  assert.equal(state.orders.find(o => o.id === 'RX-001')!.msgs.length, initialCount);

  state = reducer(state, { type: 'SEND_MSG', orderId: 'RX-001', text: 'Confirmed, packing now.' });
  assert.equal(state.orders.find(o => o.id === 'RX-001')!.msgs.length, initialCount + 1);

  state = reducer(state, { type: 'SET_DETAIL_TAB', tab: 'messages' });
  assert.equal(
    state.orders.find(o => o.id === 'RX-001')!.msgs.every(m => !m.unread),
    true,
  );
});

test('BR-09: normalizeOrderFlow, stage keys, shippingMeta, and sortOrders maintain order invariants', () => {
  const base = initialState();
  const sorted = sortOrders(base.orders);
  assert.equal(sorted.length, base.orders.length);

  const terminal: Order = {
    ...JSON.parse(JSON.stringify(base.orders[0])),
    id: 'RX-999',
    status: 'rejected',
  };
  normalizeOrderFlow(terminal);
  assert.equal(getOrderStageKey(terminal), 'rejected');
  assert.equal(workflowStatusMeta(terminal).label, 'Rejected');

  const sortedWithRejected = sortOrders([terminal, ...base.orders]);
  assert.equal(sortedWithRejected.at(-1)?.id, 'RX-999');

  const pickup = base.orders.find(o => o.deliveryType === 'pickup')!;
  assert.equal(shippingMeta(pickup).value, 'Pickup at Store');
});
