import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domainCode = compile('../lib/trading-domain.ts');
const domainUrl = `data:text/javascript;base64,${Buffer.from(domainCode).toString('base64')}`;
const analyticsCode = compile('../lib/journal-analytics.ts').replace('from "./trading-domain"', `from "${domainUrl}"`);
const analytics = await import(`data:text/javascript;base64,${Buffer.from(analyticsCode).toString('base64')}`);

const execution = (overrides = {}) => ({
  schemaVersion: 1, accountId: 'SIMULATED-ONLY', sessionId: 's1', executionId: 'entry-1', orderId: 'order-1', campaignId: 'campaign-1',
  effect: 'entry', role: 'entry', quantity: 40, price: 100, fee: 0.5, occurredAt: '2026-09-01T14:00:00Z', protectionStopAtFill: 98, provenance: 'IBKR', ...overrides,
});
const campaign = (overrides = {}) => ({
  schemaVersion: 1, campaignId: 'campaign-1', journalTradeId: 'journal-1', accountId: 'SIMULATED-ONLY', symbol: 'TEST', direction: 'Long', lifecycle: { status: 'Open' }, executions: [],
  journalSnapshot: { instrumentId: 'US-STK-TEST', currency: 'USD', setup: 'EP breakout', provenance: 'Linked plan', plannedEntry: 100, plannedQuantity: 40, originalStop: 98, plannedInitialRisk: 80, plannedTargets: [{ label: 'T1', allocationPercent: 100, multipleR: 2 }], costsComplete: true, riskComplete: true }, ...overrides,
});

test('one campaign row progresses from partial entry through partial exit and closure with fixed accounting', () => {
  const entry = execution();
  let record = analytics.buildJournalRecord(campaign({ executions: [entry] }));
  assert.deepEqual({ id: record.journalTradeId, entered: record.enteredQuantity, open: record.remainingQuantity, status: record.status }, { id: 'journal-1', entered: 40, open: 40, status: 'Open' });
  const exit1 = execution({ executionId: 'exit-1', orderId: 'order-2', effect: 'exit', role: 'target', quantity: 10, price: 104, fee: 0.5, occurredAt: '2026-09-01T15:00:00Z', protectionStopAtFill: undefined });
  record = analytics.buildJournalRecord(campaign({ executions: [exit1, entry] }));
  assert.deepEqual({ id: record.journalTradeId, gross: record.grossRealized, open: record.remainingQuantity, finalR: record.finalNetR, status: record.status }, { id: 'journal-1', gross: 40, open: 30, finalR: null, status: 'Partially exited' });
  const exit2 = execution({ executionId: 'exit-2', orderId: 'order-3', effect: 'exit', role: 'stop', quantity: 30, price: 99, fee: 0.5, occurredAt: '2026-09-01T16:00:00Z', protectionStopAtFill: undefined });
  record = analytics.buildJournalRecord(campaign({ lifecycle: { status: 'Closed' }, executions: [exit2, entry, exit1], feeAdjustments: [{ adjustmentId: 'late', amount: 0.5, occurredAt: '2026-09-01T17:00:00Z', provenance: 'IBKR' }] }));
  assert.deepEqual({ id: record.journalTradeId, risk: record.initialRisk, gross: record.grossRealized, costs: record.costs, net: record.netResult, r: record.finalNetR, open: record.remainingQuantity }, { id: 'journal-1', risk: 80, gross: 10, costs: 2, net: 8, r: .1, open: 0 });
});

test('short-side accounting is symmetric and duplicate/reordered executions have one effect', () => {
  const entry = execution({ price: 100, protectionStopAtFill: 102 });
  const exit1 = execution({ executionId: 'exit-1', orderId: 'order-2', effect: 'exit', role: 'target', quantity: 10, price: 96, fee: .5, occurredAt: '2026-09-01T15:00:00Z', protectionStopAtFill: undefined });
  const exit2 = execution({ executionId: 'exit-2', orderId: 'order-3', effect: 'exit', role: 'stop', quantity: 30, price: 101, fee: .5, occurredAt: '2026-09-01T16:00:00Z', protectionStopAtFill: undefined });
  const record = analytics.buildJournalRecord(campaign({ direction: 'Short', lifecycle: { status: 'Closed' }, executions: [exit2, exit1, entry, exit1], feeAdjustments: [{ adjustmentId: 'late', amount: .5, occurredAt: '2026-09-01T17:00:00Z', provenance: 'IBKR' }] }));
  assert.deepEqual({ executions: record.executions.length, gross: record.grossRealized, net: record.netResult, r: record.finalNetR }, { executions: 3, gross: 10, net: 8, r: .1 });
});

test('fixed statistics use closure order, currency precision and exact populations', () => {
  const records = [
    { campaignId: 'a', currency: 'USD', closedAt: '2026-09-01T10:00:00Z', dollarEligible: true, rEligible: true, isClosed: true, netResult: 100, finalNetR: 1, plannedRewardRisk: 2 },
    { campaignId: 'b', currency: 'USD', closedAt: '2026-09-02T10:00:00Z', dollarEligible: true, rEligible: true, isClosed: true, netResult: -50, finalNetR: -.5, plannedRewardRisk: 2 },
    { campaignId: 'c', currency: 'USD', closedAt: '2026-09-03T10:00:00Z', dollarEligible: true, rEligible: true, isClosed: true, netResult: 0, finalNetR: 0, plannedRewardRisk: 2 },
  ];
  const result = analytics.calculateJournalStatistics(records);
  const usd = result.currencies[0];
  assert.deepEqual({ net: usd.netPnl, counts: [usd.wins, usd.losses, usd.breakevens], pf: usd.profitFactor, avg: usd.averageResult, payoff: usd.payoffRatio, dd: usd.maxDrawdown, streak: usd.longestLosingStreak }, { net: 50, counts: [1, 1, 1], pf: 2, avg: 50 / 3, payoff: 2, dd: 50, streak: 1 });
  assert.ok(Math.abs(usd.winRate - 100 / 3) < 1e-12);
  assert.equal(result.expectancyR, 1 / 6);
});

test('empty/all-win/all-loss populations and currencies are explicit', () => {
  assert.deepEqual(analytics.calculateJournalStatistics([]).currencies, []);
  const base = { closedAt: '2026-09-01', dollarEligible: true, rEligible: true, isClosed: true, finalNetR: 1, plannedRewardRisk: null };
  const allWin = analytics.calculateJournalStatistics([{ ...base, campaignId: 'w', currency: 'USD', netResult: 5 }]).currencies[0];
  assert.equal(allWin.profitFactor, 'No losses'); assert.equal(allWin.averageLoss, null); assert.equal(allWin.payoffRatio, null);
  const allLoss = analytics.calculateJournalStatistics([{ ...base, campaignId: 'l', currency: 'USD', netResult: -5 }]).currencies[0];
  assert.equal(allLoss.profitFactor, 0); assert.equal(allLoss.averageWin, null); assert.equal(allLoss.payoffRatio, null);
  const split = analytics.calculateJournalStatistics([{ ...base, campaignId: 'u', currency: 'USD', netResult: 5 }, { ...base, campaignId: 'c', currency: 'CAD', netResult: 7 }]);
  assert.deepEqual(split.currencies.map(item => item.currency).sort(), ['CAD', 'USD']);
});

test('missing risk excludes only R metrics while missing fees excludes final dollar metrics', () => {
  const fills = [execution(), execution({ executionId: 'exit', orderId: 'order-2', effect: 'exit', role: 'target', quantity: 40, price: 101, occurredAt: '2026-09-01T15:00:00Z', protectionStopAtFill: undefined })];
  const riskMissing = analytics.buildJournalRecord(campaign({ executions: fills, journalSnapshot: { ...campaign().journalSnapshot, riskComplete: false } }));
  assert.equal(riskMissing.dollarEligible, true); assert.equal(riskMissing.rEligible, false); assert.equal(riskMissing.finalNetR, null);
  const feesMissing = analytics.buildJournalRecord(campaign({ executions: fills, journalSnapshot: { ...campaign().journalSnapshot, costsComplete: false } }));
  assert.equal(feesMissing.dollarEligible, false); assert.equal(feesMissing.netResult, null); assert.match(feesMissing.exclusions.join(' '), /costs/i);
  const snapshot = analytics.buildJournalRecord(campaign({ executions: [], positionSnapshot: { accountId: 'SIMULATED-ONLY', instrumentId: 'US-STK-TEST', brokerPositionId: 'p1', positionRevision: 'r1', confirmedOpenQuantity: 10, observedAt: '2026-09-01T15:00:00Z' } }));
  assert.equal(snapshot.status, 'Incomplete'); assert.equal(snapshot.netResult, null); assert.match(snapshot.exclusions[0], /unavailable/);
});
