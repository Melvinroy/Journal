import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const encode = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = encode(compile('../lib/trading-domain.ts'));
const paper = encode(compile('../lib/paper-execution.ts').replaceAll('"./trading-domain"', JSON.stringify(domain)));
const { adaptSyntheticJournal, adaptRecordedJournal } = await import(encode(compile('../lib/local-journal.ts')
  .replaceAll('"./paper-execution"', JSON.stringify(paper))
  .replaceAll('"./trading-domain"', JSON.stringify(domain))));

const binding = 'fixture-paper-account-A';
const durableStoreContract = JSON.parse(readFileSync(
  new URL('./fixtures/synthetic-journal-v1.json', import.meta.url), 'utf8'));
const plan = { schemaVersion: 1, legs: [{ id: 'target-1', role: 'Target', allocationPercent: 100,
  target: { mode: 'R', multipleR: 1 } }],
  breakeven: { activationR: 1, favorableOffset: { unit: 'Dollar', value: 0 } } };
function payload() {
  const campaign = { id: 'campaign-1', symbol: 'TEST', direction: 'Long', state: 'Partially filled',
    accountBinding: binding, createdAt: '2026-09-24T10:00:00Z', contract: { conId: 42, currency: 'USD' },
    ticket: { planId: 'synthetic-plan-1', planningPrice: 100, quantity: 2, hardCap: 100,
      stopPrice: 98, exitPlan: structuredClone(plan) },
    summary: { entered: 2, exited: 1, openQuantity: 1, averageEntry: 100, grossRealized: 2,
      netRealized: null, fees: null, finalNetR: null, initialRisk: 4, costsComplete: false },
    executions: [
      { executionId: 'entry-1', orderId: 101, effect: 'entry', role: 'entry', quantity: 2,
        price: 100, occurredAt: '2026-09-24T10:01:00Z', commission: 0.2 },
      { executionId: 'exit-1', orderId: 102, effect: 'exit', role: 'target', quantity: 1,
        price: 102, occurredAt: '2026-09-24T10:02:00Z', commission: null },
    ], syntheticOnly: true };
  return { source: 'synthetic-ledger-fixture', environment: 'paper', executionEnabled: false,
    connectionStatus: 'not-connected', historyStatus: 'recorded', lastRecordedAt: '2026-09-24T10:02:00Z',
    lastBrokerReconciledAt: null, currentExposure: null, ordersCleared: null,
    uncertainCommandCount: 1, records: [{ id: 'fixture:campaign-1', campaignId: 'campaign-1',
      symbol: 'TEST', direction: 'Long', state: 'Partially filled', recordedAt: '2026-09-24T10:02:00Z',
      entered: 2, exited: 1, recordedOpenQuantity: 1, executionCount: 2,
      grossRealized: 2, fees: null, netRealized: null, finalNetR: null,
      costsCompleteRecorded: false }], journalCampaigns: [campaign] };
}

function recordedPayload() {
  const input = payload();
  input.source = 'recorded-local-ledger';
  input.scopeId = 'b'.repeat(64);
  input.journalCampaigns[0].syntheticOnly = false;
  input.journalCampaigns[0].accountBinding = 'a'.repeat(64);
  input.journalCampaigns[0].executions[1].role = 'cleanup';
  input.records[0].id = 'recorded:campaign-1';
  return input;
}

test('confirmed-account recorded history uses the shared Journal projection without claiming current exposure', () => {
  const result = adaptRecordedJournal(recordedPayload());
  assert.equal(result.source, 'recorded-local-ledger');
  assert.equal(result.scopeId, 'b'.repeat(64));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'recorded:campaign-1');
  assert.equal(result.rows[0].recordedOnly, true);
  assert.equal(result.rows[0].syntheticOnly, undefined);
  assert.equal(result.rows[0].currentExposure, null);
  assert.equal(result.ordersCleared, null);
  assert.equal(result.rows[0].executions[1].role, 'cleanup');
  assert.equal(result.rows[0].realizedAvailable, false);
  assert.equal(result.uncertainCommandCount, 1);
});

test('ambiguous recorded cost retains shares and fees but never invents realized result', () => {
  const input = recordedPayload();
  const campaign = input.journalCampaigns[0];
  campaign.state = 'Needs reconciliation';
  campaign.executions[0].quantity = 1;
  campaign.executions[1].commission = 0.1;
  campaign.executions.push({ executionId: 'uncertain-entry', orderId: 103,
    effect: 'entry', role: 'entry', quantity: 1, price: 110,
    occurredAt: campaign.executions[1].occurredAt, commission: 0 });
  Object.assign(campaign.summary, { averageEntry: null, grossRealized: null,
    netRealized: null, fees: 0.3, finalNetR: null, initialRisk: null, costsComplete: true });
  Object.assign(input.records[0], { state: 'Needs reconciliation', executionCount: 3,
    grossRealized: null, netRealized: null, fees: 0.3, finalNetR: null,
    costsCompleteRecorded: true });
  const row = adaptRecordedJournal(input).rows[0];
  assert.equal(row.status, 'Needs reconciliation');
  assert.equal(row.recordedOpenQuantity, 1);
  assert.equal(row.costs, 0.3);
  assert.equal(row.grossRealized, undefined);
  assert.equal(row.realizedAvailable, false);
  assert.equal(row.finalRAvailable, false);
  assert.equal(row.currentExposure, null);

  campaign.state = 'Open';
  input.records[0].state = 'Open';
  assert.throws(() => adaptRecordedJournal(input), /accounting agreement/);
});

test('late entry keeps earlier realized result and requires a reconciliation state', () => {
  const input = recordedPayload();
  const campaign = input.journalCampaigns[0];
  campaign.executions[0].quantity = 1;
  campaign.executions[1].commission = 0.1;
  campaign.executions.push({ executionId: 'late-entry', orderId: 103,
    effect: 'entry', role: 'entry', quantity: 1, price: 110,
    occurredAt: '2026-09-24T10:03:00Z', commission: 0 });
  Object.assign(campaign.summary, { averageEntry: 110, grossRealized: 2,
    netRealized: 1.7, fees: 0.3, initialRisk: 14, costsComplete: true });
  Object.assign(input.records[0], { executionCount: 3, fees: 0.3,
    netRealized: 1.7, costsCompleteRecorded: true,
    recordedAt: '2026-09-24T10:03:00Z' });
  input.lastRecordedAt = '2026-09-24T10:03:00Z';
  assert.throws(() => adaptRecordedJournal(input), /protection and allocations/);
  campaign.state = 'Needs reconciliation';
  input.records[0].state = 'Needs reconciliation';
  const row = adaptRecordedJournal(input).rows[0];
  assert.equal(row.status, 'Needs reconciliation');
  assert.equal(row.grossRealized, 2);
  assert.equal(row.pnl, 1.7);
  assert.equal(row.weightedEntry, 110);
  assert.equal(row.recordedOpenQuantity, 1);
});

test('recorded history rejects fixture rows, mixed account bindings and unexpected exits', () => {
  const input = recordedPayload();
  assert.throws(() => adaptRecordedJournal(payload()), /history scope/);
  const missingScope = recordedPayload();
  delete missingScope.scopeId;
  assert.throws(() => adaptRecordedJournal(missingScope), /private paper scope/);
  input.journalCampaigns.push(structuredClone(input.journalCampaigns[0]));
  input.records.push(structuredClone(input.records[0]));
  input.journalCampaigns[1].id = 'campaign-2';
  input.records[1].campaignId = 'campaign-2';
  input.records[1].id = 'recorded:campaign-2';
  input.journalCampaigns[1].accountBinding = 'b'.repeat(64);
  assert.throws(() => adaptRecordedJournal(input), /mixed account bindings/);
  input.journalCampaigns.pop(); input.records.pop();
  input.journalCampaigns[0].executions[1].role = 'manual';
  assert.throws(() => adaptRecordedJournal(input), /execution/);
});

test('Python durable-store contract sample reaches the shared Journal projection', () => {
  const view = adaptSyntheticJournal(durableStoreContract, binding);
  assert.equal(view.source, 'synthetic-ledger-fixture');
  assert.equal(view.uncertainCommandCount, 1);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].id, 'fixture:campaign-1');
  assert.equal(view.rows[0].recordedOpenQuantity, 1);
  assert.equal(view.rows[0].realizedAvailable, false);
  assert.equal(view.rows[0].currentExposure, null);
});

test('shared Journal projection remains recorded-only and every exposed source is synthetic', () => {
  const input = payload();
  input.journalCampaigns[0].privateNote = 'SHOULD_NOT_LEAK';
  input.journalCampaigns[0].ticket.exitPlan.privateNote = 'SHOULD_NOT_LEAK';
  const result = adaptSyntheticJournal(input, binding);
  assert.equal(result.currentExposure, null);
  assert.equal(result.ordersCleared, null);
  assert.equal(result.lastBrokerReconciledAt, null);
  assert.equal(result.uncertainCommandCount, 1);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.id, 'fixture:campaign-1');
  assert.equal(row.syntheticOnly, true);
  assert.equal(row.recordedOnly, true);
  assert.equal(row.recordedOpenQuantity, 1);
  assert.equal(row.currentExposure, null);
  assert.equal(row.provenance, 'Synthetic fixture · recorded ledger');
  assert.equal(row.journalSnapshot.instrumentId, 'FIXTURE-STK:42');
  assert.equal(row.journalSnapshot.provenance, 'Synthetic fixture');
  assert.deepEqual(row.executions.map(e => e.provenance), ['Synthetic fixture', 'Synthetic fixture']);
  assert.equal(row.executions[1].feeAvailable, false);
  assert.equal(row.costsComplete, false);
  assert.equal(row.realizedAvailable, false);
  assert.equal(row.finalRAvailable, false);
  assert.equal(row.costs, undefined);
  assert.equal(row.plannedR, 1);
  assert.equal(JSON.stringify(result).includes('SHOULD_NOT_LEAK'), false);
  assert.equal(JSON.stringify(result).includes('IBKR'), false);
});

test('late fee uses the same projected row without duplicating the trade or erasing uncertainty', () => {
  const input = payload();
  const before = adaptSyntheticJournal(input, binding);
  input.journalCampaigns[0].executions[1].commission = 0.1;
  Object.assign(input.journalCampaigns[0].summary, { netRealized: 1.7, fees: 0.3, costsComplete: true });
  Object.assign(input.records[0], { netRealized: 1.7, fees: 0.3, costsCompleteRecorded: true });
  const after = adaptSyntheticJournal(input, binding);
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].id, before.rows[0].id);
  assert.equal(after.rows[0].pnl, 1.7);
  assert.equal(after.rows[0].costs, 0.3);
  assert.equal(after.rows[0].realizedAvailable, true);
  assert.equal(after.uncertainCommandCount, 1);
  assert.equal(after.currentExposure, null);
});

test('recorded history rejects internally contradictory fee and net results', () => {
  for (const field of ['fees', 'netRealized']) {
    const input = recordedPayload();
    input.journalCampaigns[0].executions[1].commission = 0.1;
    Object.assign(input.journalCampaigns[0].summary, {
      fees: 0.3, netRealized: 1.7, costsComplete: true,
    });
    Object.assign(input.records[0], {
      fees: 0.3, netRealized: 1.7, costsCompleteRecorded: true,
    });
    const correct = adaptRecordedJournal(input);
    assert.equal(correct.rows[0].pnl, 1.7);
    input.journalCampaigns[0].summary[field] = 100;
    input.records[0][field] = 100;
    assert.throws(() => adaptRecordedJournal(input), /accounting agreement/);
  }
});

test('two campaigns keep the first row and uncertainty when a later fee changes the second', () => {
  const input = payload();
  const second = structuredClone(input.journalCampaigns[0]);
  Object.assign(second, { id: 'campaign-2', symbol: 'NEXT', state: 'Closed',
    createdAt: '2026-09-24T10:03:00Z' });
  Object.assign(second.ticket, { planId: 'synthetic-plan-2' });
  second.contract.conId = 43;
  Object.assign(second.summary, { exited: 2, openQuantity: 0, grossRealized: 4,
    fees: 0.3, netRealized: 3.7, finalNetR: 0.925, costsComplete: true });
  Object.assign(second.executions[0], { executionId: 'entry-2', orderId: 201,
    occurredAt: '2026-09-24T10:04:00Z' });
  Object.assign(second.executions[1], { executionId: 'exit-2', orderId: 202,
    quantity: 2, commission: 0.1, occurredAt: '2026-09-24T10:05:00Z' });
  const secondRecord = { ...input.records[0], id: 'fixture:campaign-2',
    campaignId: 'campaign-2', symbol: 'NEXT', state: 'Closed',
    recordedAt: '2026-09-24T10:05:00Z', exited: 2, recordedOpenQuantity: 0,
    grossRealized: 4, fees: 0.3, netRealized: 3.7, finalNetR: 0.925,
    costsCompleteRecorded: true };
  input.journalCampaigns.push(second);
  input.records.push(secondRecord);
  input.lastRecordedAt = secondRecord.recordedAt;

  const before = adaptSyntheticJournal(input, binding);
  const firstRow = before.rows.find(row => row.id === 'fixture:campaign-1');
  const secondRow = before.rows.find(row => row.id === 'fixture:campaign-2');
  assert.equal(before.rows.length, 2);
  assert.equal(before.uncertainCommandCount, 1);
  assert.equal(firstRow.costsComplete, false);
  assert.equal(secondRow.costs, 0.3);
  assert.equal(secondRow.pnl, 3.7);
  assert.equal(secondRow.finalRAvailable, true);

  second.executions[1].commission = 0.4;
  Object.assign(second.summary, { fees: 0.6, netRealized: 3.4, finalNetR: 0.85 });
  Object.assign(secondRecord, { fees: 0.6, netRealized: 3.4, finalNetR: 0.85 });
  const after = adaptSyntheticJournal(input, binding);
  assert.deepEqual(after.rows.find(row => row.id === 'fixture:campaign-1'), firstRow);
  assert.equal(after.rows.find(row => row.id === 'fixture:campaign-2').pnl, 3.4);
  assert.equal(after.rows.find(row => row.id === 'fixture:campaign-2').costs, 0.6);
  assert.equal(after.uncertainCommandCount, 1);
});

test('empty fixture is explicitly no-records, not a flat broker account', () => {
  const input = payload();
  Object.assign(input, { historyStatus: 'no-records', lastRecordedAt: null, records: [], journalCampaigns: [] });
  const result = adaptSyntheticJournal(input, binding);
  assert.deepEqual(result.rows, []);
  assert.equal(result.currentExposure, null);
});

test('pending entry with no executions is recorded history with unknown fees and exposure', () => {
  const input = payload();
  const campaign = input.journalCampaigns[0];
  campaign.state = 'Pending entry';
  campaign.executions = [];
  Object.assign(campaign.summary, { entered: 0, exited: 0, openQuantity: 0,
    averageEntry: null, grossRealized: null, netRealized: null,
    fees: null, finalNetR: null, initialRisk: null, costsComplete: false });
  Object.assign(input.records[0], { state: 'Pending entry', recordedAt: campaign.createdAt,
    entered: 0, exited: 0, recordedOpenQuantity: 0, executionCount: 0,
    grossRealized: null, netRealized: null, fees: null, finalNetR: null,
    costsCompleteRecorded: false });
  input.lastRecordedAt = campaign.createdAt;
  const result = adaptSyntheticJournal(input, binding);
  assert.equal(result.rows.length, 1);
  assert.equal(result.historyStatus, 'recorded');
  assert.equal(result.rows[0].recordedOpenQuantity, 0);
  assert.equal(result.rows[0].currentExposure, null);
  assert.equal(result.rows[0].costsComplete, false);
  assert.equal(result.rows[0].realizedAvailable, false);
  assert.equal(result.rows[0].costs, undefined);
  assert.equal(result.rows[0].date, '');
  assert.equal(result.currentExposure, null);
  assert.equal(result.ordersCleared, null);
});

test('exit chronology rejects exits before inventory and ambiguous same-time entry/exit', () => {
  for (const exitAt of ['2026-09-24T10:00:30Z', '2026-09-24T10:01:00Z']) {
    const input = payload();
    input.journalCampaigns[0].executions[1].occurredAt = exitAt;
    assert.throws(() => adaptSyntheticJournal(input, binding), /exit precedes held inventory/);
  }
});

test('sub-millisecond entry and exit ordering retains full six-digit UTC precision', () => {
  const input = payload();
  input.journalCampaigns[0].executions[0].occurredAt = '2026-09-24T10:01:00.123100Z';
  input.journalCampaigns[0].executions[1].occurredAt = '2026-09-24T10:01:00.123200Z';
  input.records[0].recordedAt = input.lastRecordedAt = '2026-09-24T10:01:00.123200Z';
  const row = adaptSyntheticJournal(input, binding).rows[0];
  assert.equal(row.firstFillAt, '2026-09-24T10:01:00.123100Z');
  assert.equal(row.recordedOpenQuantity, 1);
  input.journalCampaigns[0].executions[1].occurredAt = '2026-09-24T10:01:00.123100Z';
  assert.throws(() => adaptSyntheticJournal(input, binding), /exit precedes held inventory/);
  input.journalCampaigns[0].executions[1].occurredAt = '2026-09-24T10:01:00.123200Z';
  input.lastRecordedAt = '2026-09-24T10:01:00.123201Z';
  assert.throws(() => adaptSyntheticJournal(input, binding), /last recorded agreement/);
  input.lastRecordedAt = '2026-09-24T10:01:00.123200Z';
  input.records[0].recordedAt = '2026-09-24T10:01:00.123201Z';
  assert.throws(() => adaptSyntheticJournal(input, binding), /record agreement/);
});

test('an open state cannot report zero recorded entry', () => {
  const input = payload();
  const campaign = input.journalCampaigns[0];
  campaign.state = 'Open';
  campaign.executions = [];
  Object.assign(campaign.summary, { entered: 0, exited: 0, openQuantity: 0,
    averageEntry: null, grossRealized: null, netRealized: null,
    fees: null, finalNetR: null, initialRisk: null, costsComplete: false });
  Object.assign(input.records[0], { state: 'Open', recordedAt: campaign.createdAt,
    entered: 0, exited: 0, recordedOpenQuantity: 0, executionCount: 0,
    grossRealized: null, netRealized: null, fees: null, finalNetR: null,
    costsCompleteRecorded: false });
  input.lastRecordedAt = campaign.createdAt;
  assert.throws(() => adaptSyntheticJournal(input, binding), /open quantity/);
});

test('malformed, cross-account and broker-shaped DTOs fail closed', () => {
  const variants = [
    x => { x.source = 'IBKR'; },
    x => { x.executionEnabled = true; },
    x => { x.currentExposure = 0; },
    x => { x.ordersCleared = true; },
    x => { x.journalCampaigns[0].accountBinding = 'fixture-other'; },
    x => { x.journalCampaigns[0].syntheticOnly = 1; },
    x => { x.journalCampaigns[0].ticket.exitPlan.schemaVersion = true; },
    x => { x.journalCampaigns[0].executions[1].commission = 'unknown'; },
    x => { x.journalCampaigns[0].summary.costsComplete = true; },
    x => { x.journalCampaigns[0].executions[0].price = 2 ** 53; },
    x => { x.journalCampaigns[0].executions[0].commission = 2 ** 53; },
    x => { x.journalCampaigns[0].ticket.planningPrice = 2 ** 53; },
    x => { x.journalCampaigns[0].ticket.exitPlan.legs[0].target.multipleR = 2 ** 53; },
    x => { x.journalCampaigns[0].executions[1].occurredAt = 'yesterday'; },
    x => { x.journalCampaigns[0].executions[1].occurredAt = '2026-02-31T10:02:00Z'; },
    x => { x.journalCampaigns[0].createdAt = '2400-01-01T00:00:00Z'; },
    x => { x.journalCampaigns[0].summary.openQuantity = 0; },
    x => { x.journalCampaigns[0].state = 'Closed'; x.records[0].state = 'Closed'; },
    x => { x.journalCampaigns[0].state = 'Pending entry'; x.records[0].state = 'Pending entry'; },
    x => { x.records[0].grossRealized = 3; },
    x => { x.records[0].fees = 0; },
    x => { x.records[0].netRealized = 0; },
    x => { x.records[0].finalNetR = 2; },
    x => { x.records[0].costsCompleteRecorded = true; },
    x => { x.records[0].recordedAt = '2026-09-24T10:03:00Z'; },
    x => { x.lastRecordedAt = '2026-09-24T10:03:00Z'; },
    x => { x.records[0].campaignId = 'different'; },
    x => { x.journalCampaigns.push(structuredClone(x.journalCampaigns[0])); x.records.push(structuredClone(x.records[0])); },
  ];
  for (const mutate of variants) {
    const input = payload(); mutate(input);
    assert.throws(() => adaptSyntheticJournal(input, binding));
  }
  assert.throws(() => adaptSyntheticJournal(payload(), 'real-paper-account'));
});
