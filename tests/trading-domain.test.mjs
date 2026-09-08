import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/trading-domain.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const execution = (overrides = {}) => ({
  schemaVersion: 1, accountId: 'paper', sessionId: 's1', executionId: 'e1', orderId: 'o1', campaignId: 'c1',
  effect: 'entry', role: 'entry', quantity: 100, price: 10, fee: 0, occurredAt: '2026-09-09T10:00:00Z',
  protectionStopAtFill: 9, provenance: 'IBKR', ...overrides,
});
const campaign = (direction = 'Long', executions = []) => ({
  schemaVersion: 1, campaignId: 'c1', accountId: 'paper', symbol: 'TEST', direction,
  lifecycle: { status: 'Open' }, executions,
});

test('F1 allocation-limited and F2 risk-limited sizing are exact for long and short', () => {
  for (const direction of ['Long', 'Short']) {
    const stop = direction === 'Long' ? 98 : 102;
    const f1 = domain.calculatePositionSize({ accountBase: 30000, riskPercent: .5, allocationPercent: 10, entryPrice: 100, stopPrice: stop, direction });
    assert.deepEqual({ shares: f1.shares, riskShares: f1.sharesByRisk, allocationShares: f1.sharesByAllocation, position: f1.positionValue, risk: f1.plannedRisk, constraint: f1.limitingConstraint },
      { shares: 30, riskShares: 75, allocationShares: 30, position: 3000, risk: 60, constraint: 'Allocation' });
    const f2 = domain.calculatePositionSize({ accountBase: 30000, riskPercent: .5, allocationPercent: 10, entryPrice: 100, stopPrice: direction === 'Long' ? 94 : 106, direction });
    assert.equal(f2.shares, 25); assert.equal(f2.positionValue, 2500); assert.equal(f2.plannedRisk, 150); close(f2.accountUsePercent, 100 / 12);
  }
});

test('account base, existing risk, holdings and pending entries constrain available size', () => {
  assert.deepEqual(domain.sizingAccountBase(32000, 30000), { accountBase: 30000, source: 'Manual planning balance' });
  assert.deepEqual(domain.sizingAccountBase(28000, 30000), { accountBase: 28000, source: 'IBKR equity' });
  const sized = domain.calculatePositionSize({ accountBase: 30000, riskPercent: .5, allocationPercent: 10, entryPrice: 100, stopPrice: 98, direction: 'Long', existingPositionRisk: 90, existingHoldingValue: 2000, pendingEntryValue: 500 });
  assert.equal(sized.availableRisk, 60); assert.equal(sized.remainingAllocationValue, 500); assert.equal(sized.shares, 5);
});

test('daily Wilder ATR14 and ATR, day-extreme and manual stops validate direction', () => {
  const bars = Array.from({ length: 20 }, (_, index) => ({ high: 101 + index, low: 99 + index, close: 100 + index }));
  close(domain.calculateWilderAtr14(bars), 2);
  assert.throws(() => domain.calculateWilderAtr14(bars.slice(0, 14)), /prior close/);
  close(domain.calculateWilderAtr14(bars.slice(0, 15)), 2);
  assert.equal(domain.deriveStop({ method: 'ATR', direction: 'Long', capturedEntry: 100, atr14: 2, atrMultiplier: 1 }), 98);
  assert.equal(domain.deriveStop({ method: 'ATR', direction: 'Short', capturedEntry: 100, atr14: 2, atrMultiplier: 1 }), 102);
  assert.equal(domain.deriveStop({ method: 'LoD', direction: 'Long', capturedEntry: 100, dayLow: 97 }), 97);
  assert.equal(domain.deriveStop({ method: 'HoD', direction: 'Short', capturedEntry: 100, dayHigh: 103 }), 103);
  assert.throws(() => domain.deriveStop({ method: 'Manual', direction: 'Long', capturedEntry: 100, manualStop: 100 }), /below/);
  assert.throws(() => domain.deriveStop({ method: 'LoD', direction: 'Short', capturedEntry: 100, dayLow: 97 }), /longs/);
});

test('F3 partial entry, actual risk, targets, allocation and breakeven protection are exact', () => {
  close(domain.weightedAverageEntry([{ quantity: 40, price: 100 }, { quantity: 60, price: 100.10 }]), 100.06);
  close(domain.initialRisk([{ quantity: 40, entryPrice: 100, protectionStop: 98 }, { quantity: 60, entryPrice: 100.10, protectionStop: 98 }], 'Long'), 206);
  close(domain.targetPrice(100.06, 98, 1, 'Long'), 102.12);
  close(domain.targetPrice(100.06, 98, 2, 'Long'), 104.18);
  assert.deepEqual(domain.allocateExitShares(100, [35, 35, 30]), [35, 35, 30]);
  assert.deepEqual(domain.remainingRisk({ direction: 'Long', openQuantity: 65, averageEntry: 100.06, protectionStop: 100.06, brokerConfirmed: true }), { protected: true, risk: 0 });
  assert.deepEqual(domain.remainingRisk({ direction: 'Long', openQuantity: 65, averageEntry: 100.06, brokerConfirmed: false }), { protected: false, risk: null });
});

test('F4 realized-only Journal rollup stays unavailable until closure', () => {
  const entry = execution();
  const exit1 = execution({ executionId: 'e2', orderId: 'o2', effect: 'exit', role: 'target', quantity: 30, price: 11, fee: 3, occurredAt: '2026-09-09T11:00:00Z', protectionStopAtFill: undefined });
  const exit2 = execution({ executionId: 'e3', orderId: 'o3', effect: 'exit', role: 'stop', quantity: 20, price: 9, fee: 0, occurredAt: '2026-09-09T12:00:00Z', protectionStopAtFill: undefined });
  const open = domain.rollupCampaign(campaign('Long', [entry, exit1, exit2]));
  assert.equal(open.openQuantity, 50); assert.equal(open.grossRealizedPnl, 10); assert.equal(open.realizedNetPnl, 7); assert.equal(open.finalNetPnl, null); assert.equal(open.finalNetR, null);
  const exit3 = execution({ executionId: 'e4', orderId: 'o4', effect: 'exit', role: 'manual', quantity: 50, price: 10.5, fee: 2, occurredAt: '2026-09-09T13:00:00Z', protectionStopAtFill: undefined });
  const closed = domain.rollupCampaign(campaign('Long', [entry, exit1, exit2, exit3]));
  assert.equal(closed.executions.length, 4); assert.equal(closed.openQuantity, 0); assert.equal(closed.grossRealizedPnl, 35); assert.equal(closed.fees, 5); assert.equal(closed.finalNetPnl, 30); close(closed.finalNetR, .3);
});

test('F5 scale-in retains risk snapshots and creates a later campaign after closure', () => {
  const fills = [
    execution({ quantity: 50, price: 100, protectionStopAtFill: 98 }),
    execution({ executionId: 'e2', orderId: 'o2', quantity: 25, price: 101, protectionStopAtFill: 100, occurredAt: '2026-09-09T11:00:00Z' }),
  ];
  const rollup = domain.rollupCampaign(campaign('Long', fills));
  assert.equal(rollup.enteredQuantity, 75); close(rollup.actualAverageEntry, 100.33333333333333); assert.equal(rollup.actualInitialRisk, 125);
  const existing = [{ campaignId: 'paper:p1:NVDA:1', planId: 'p1', symbol: 'NVDA', openQuantity: 75 }];
  assert.equal(domain.nextCampaignIdentity({ accountId: 'paper', planId: 'p1', symbol: 'NVDA', existing }), 'paper:p1:NVDA:1');
  existing[0].openQuantity = 0;
  assert.equal(domain.nextCampaignIdentity({ accountId: 'paper', planId: 'p1', symbol: 'NVDA', existing }), 'paper:p1:NVDA:2');
  existing.push({ campaignId: 'paper:p1:NVDA:4', planId: 'p1', symbol: 'NVDA', openQuantity: 0 });
  assert.equal(domain.nextCampaignIdentity({ accountId: 'paper', planId: 'p1', symbol: 'NVDA', existing }), 'paper:p1:NVDA:5');
});

test('lifecycle covers every required state and rejects impossible transitions', () => {
  let state = { status: 'Draft' };
  state = domain.transitionLifecycle(state, 'save'); assert.equal(state.status, 'Saved');
  state = domain.transitionLifecycle(state, 'submit'); assert.equal(state.status, 'Pending entry');
  state = domain.transitionLifecycle(state, 'partial-fill'); assert.equal(state.status, 'Partially filled');
  state = domain.transitionLifecycle(state, 'filled'); assert.equal(state.status, 'Open');
  state = domain.transitionLifecycle(state, 'protection-missing'); assert.equal(state.status, 'Unprotected');
  state = domain.transitionLifecycle(state, 'begin-close'); assert.equal(state.status, 'Closing');
  state = domain.transitionLifecycle(state, 'closed'); assert.equal(state.status, 'Closed');
  const sync = domain.transitionLifecycle({ status: 'Open' }, 'sync-start'); assert.equal(domain.transitionLifecycle(sync, 'sync-resolved').status, 'Open');
  assert.equal(domain.transitionLifecycle({ status: 'Open' }, 'review-required').status, 'Needs Review');
  for (const [event, expected] of [['cancel', 'Cancelled'], ['expire', 'Expired'], ['reject', 'Rejected']]) {
    const start = event === 'cancel' ? { status: 'Saved' } : { status: 'Pending entry' };
    assert.equal(domain.transitionLifecycle(start, event).status, expected);
  }
  assert.throws(() => domain.transitionLifecycle({ status: 'Closed' }, 'submit'));
});

test('reconciliation is idempotent, broker-authoritative, and flags unsafe quantities', () => {
  const state = { openQuantity: 10, lifecycle: { status: 'Sync pending', resumeStatus: 'Open' }, discrepancies: [] };
  const checkpoint = { schemaVersion: 1, checkpointId: 'cp1', accountId: 'paper', sessionId: 's1', reconciledAt: '2026-09-09T15:00:00Z', brokerOpenQuantity: 10, brokerProtectionQuantity: 5, brokerWorkingExitQuantity: 12 };
  const next = domain.reconcileCheckpoint(state, checkpoint);
  assert.equal(next.lifecycle.status, 'Unprotected'); assert.equal(next.openQuantity, 10); assert.equal(next.discrepancies.length, 2);
  assert.strictEqual(domain.reconcileCheckpoint(next, checkpoint), next);
  const conflict = domain.reconcileCheckpoint(next, { ...checkpoint, brokerOpenQuantity: 9 });
  assert.equal(conflict.lifecycle.status, 'Needs Review'); assert.match(conflict.discrepancies.at(-1), /Conflicting/);
});
