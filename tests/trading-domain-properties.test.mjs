import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/trading-domain.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = { schemaVersion: 1, accountId: 'paper', sessionId: 's1', orderId: 'order', campaignId: 'campaign', provenance: 'IBKR' };
const campaign = (direction, executions) => ({ schemaVersion: 1, campaignId: 'campaign', accountId: 'paper', symbol: 'TEST', direction, lifecycle: { status: 'Open' }, executions });

test('fragmented entry fills conserve quantity, notional and initial risk', () => {
  for (let parts = 1; parts <= 50; parts += 1) {
    const executions = Array.from({ length: parts }, (_, index) => ({ ...base, executionId: `entry-${index}`, effect: 'entry', role: 'entry', quantity: 2, price: 100 + index / 100, fee: 0, protectionStopAtFill: 98, occurredAt: new Date(Date.UTC(2026, 8, 9, 10, index)).toISOString() }));
    const rollup = domain.rollupCampaign(campaign('Long', executions));
    assert.equal(rollup.openQuantity, parts * 2);
    assert.equal(rollup.actualInitialRisk, executions.reduce((sum, item) => sum + item.quantity * (item.price - 98), 0));
    assert.equal(rollup.actualAverageEntry, executions.reduce((sum, item) => sum + item.quantity * item.price, 0) / (parts * 2));
  }
});

test('replayed executions have one economic effect and conflicting identities require review', () => {
  const entry = { ...base, executionId: 'same', effect: 'entry', role: 'entry', quantity: 10, price: 100, fee: 1, protectionStopAtFill: 98, occurredAt: '2026-09-09T10:00:00Z' };
  const initial = campaign('Long', []);
  const first = domain.ingestExecutions(initial, [entry, entry]);
  assert.equal(first.rollup.openQuantity, 10); assert.equal(first.ignoredDuplicateCount, 1);
  const replay = domain.ingestExecutions(first.campaign, [entry]);
  assert.equal(replay.rollup.openQuantity, 10); assert.equal(replay.ignoredDuplicateCount, 1);
  const conflict = domain.ingestExecutions(first.campaign, [{ ...entry, price: 101 }]);
  assert.equal(conflict.rollup.openQuantity, 10); assert.equal(conflict.conflicts.length, 1); assert.equal(conflict.campaign.lifecycle.status, 'Needs Review');
});

test('arbitrary partial-exit order conserves shares, fees and realized P&L', () => {
  const entry = { ...base, executionId: 'entry', effect: 'entry', role: 'entry', quantity: 100, price: 50, fee: 1, protectionStopAtFill: 48, occurredAt: '2026-09-09T10:00:00Z' };
  const exits = [10, 7, 23, 1, 29, 30].map((quantity, index) => ({ ...base, executionId: `exit-${index}`, orderId: `exit-order-${index}`, effect: 'exit', role: 'manual', quantity, price: 51 + index / 10, fee: .25, protectionStopAtFill: undefined, occurredAt: new Date(Date.UTC(2026, 8, 9, 11, index)).toISOString() }));
  for (let rotation = 0; rotation < exits.length; rotation += 1) {
    const reordered = [...exits.slice(rotation), ...exits.slice(0, rotation)];
    const rollup = domain.rollupCampaign(campaign('Long', [entry, ...reordered]));
    assert.equal(rollup.openQuantity, 0); assert.equal(rollup.exitedQuantity, 100); assert.equal(rollup.fees, 2.5);
    assert.equal(rollup.grossRealizedPnl, exits.reduce((sum, item) => sum + (item.price - 50) * item.quantity, 0));
  }
});

test('long and short calculations are symmetric across deterministic boundaries', () => {
  for (let distance = 1; distance <= 25; distance += 1) {
    const long = domain.calculatePositionSize({ accountBase: 30000, riskPercent: .7, allocationPercent: 25, entryPrice: 100, stopPrice: 100 - distance, direction: 'Long' });
    const short = domain.calculatePositionSize({ accountBase: 30000, riskPercent: .7, allocationPercent: 25, entryPrice: 100, stopPrice: 100 + distance, direction: 'Short' });
    assert.deepEqual(long, short);
    assert.equal(domain.targetPrice(100, 100 - distance, 2, 'Long') - 100, 100 - domain.targetPrice(100, 100 + distance, 2, 'Short'));
  }
  for (let shares = 0; shares < 500; shares += 1) assert.equal(domain.allocateExitShares(shares, [35, 35, 30]).reduce((a, b) => a + b, 0), shares);
});
