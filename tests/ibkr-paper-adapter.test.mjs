import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/ibkr-paper-adapter.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const broker = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const baseConfig = Object.freeze({ host: '127.0.0.1', port: 12345, clientId: 17, accountId: 'EXACT-ACCOUNT-7', submissionsEnabled: true });
const verifiedAt = '2026-09-09T09:00:00Z';
const connectedAt = '2026-09-09T09:01:00Z';
const verification = () => broker.recordOperatorVerification(baseConfig, baseConfig.accountId, 'IB Gateway', verifiedAt);
const authorization = () => broker.authorizePaperConnection(baseConfig, verification(), { managedAccounts: [baseConfig.accountId], connectedAt });
const contract = Object.freeze({ conId: 265598, symbol: 'AAPL', secType: 'STK', exchange: 'SMART', currency: 'USD' });
const packageFor = (overrides = {}) => broker.constructEntryPackage({
  authorization: authorization(), contract, direction: 'Long', method: 'Normal', quantity: 100,
  hardCap: 101, stopPrice: 98, idempotencyKey: 'campaign-1:entry', ...overrides,
});

test('safety boundary defaults submission off and requires operator verification', () => {
  const readOnly = { ...baseConfig, submissionsEnabled: false };
  const readOnlyVerification = broker.recordOperatorVerification(readOnly, readOnly.accountId, 'TWS', verifiedAt);
  assert.equal(broker.verifyPaperConnection(readOnly, readOnlyVerification, { managedAccounts: [readOnly.accountId], connectedAt }).accountId, readOnly.accountId);
  assert.throws(() => broker.authorizePaperConnection({ ...baseConfig, submissionsEnabled: false }, undefined, { managedAccounts: [baseConfig.accountId], connectedAt }), error => error.code === 'SUBMISSION_DISABLED');
  assert.throws(() => broker.authorizePaperConnection(baseConfig, undefined, { managedAccounts: [baseConfig.accountId], connectedAt }), error => error.code === 'VERIFICATION_REQUIRED');
  assert.throws(() => broker.recordOperatorVerification(baseConfig, 'DIFFERENT', 'TWS', verifiedAt), error => error.code === 'ACCOUNT_MISMATCH');
});

test('safety boundary rejects missing, mismatched, additional and changed account configuration', () => {
  const checked = verification();
  assert.throws(() => broker.authorizePaperConnection(baseConfig, checked, { managedAccounts: [], connectedAt }), error => error.code === 'ACCOUNT_MISSING');
  assert.throws(() => broker.authorizePaperConnection(baseConfig, checked, { managedAccounts: ['OTHER'], connectedAt }), error => error.code === 'ACCOUNT_MISMATCH');
  assert.throws(() => broker.authorizePaperConnection(baseConfig, checked, { managedAccounts: [baseConfig.accountId, 'OTHER'], connectedAt }), error => error.code === 'UNEXPECTED_ACCOUNT');
  assert.throws(() => broker.authorizePaperConnection({ ...baseConfig, clientId: 18 }, checked, { managedAccounts: [baseConfig.accountId], connectedAt }), error => error.code === 'CONFIGURATION_CHANGED');
  assert.throws(() => broker.authorizePaperConnection({ ...baseConfig, port: 7497 }, checked, { managedAccounts: [baseConfig.accountId], connectedAt }), error => error.code === 'CONFIGURATION_CHANGED');
});

test('P01 simulated — normal long uses capped MIDPRICE and attached full-share stop', () => {
  const value = packageFor();
  assert.deepEqual({ action: value.entry.action, type: value.entry.orderType, cap: value.entry.lmtPrice, marketFallback: value.entry.orderType === 'MKT' }, { action: 'BUY', type: 'MIDPRICE', cap: 101, marketFallback: false });
  assert.deepEqual({ action: value.protection.action, quantity: value.protection.totalQuantity, stop: value.protection.auxPrice }, { action: 'SELL', quantity: 100, stop: 98 });
  broker.assertPackageMaySubmit(authorization(), value);
});

test('P02 simulated — normal short mirrors entry/protection and rejects invalid stop direction', () => {
  const value = packageFor({ direction: 'Short', hardCap: 99, stopPrice: 102 });
  assert.equal(value.entry.action, 'SELL');
  assert.equal(value.protection.action, 'BUY');
  assert.throws(() => packageFor({ direction: 'Short', hardCap: 99, stopPrice: 98 }), /wrong side/);
});

test('P03 simulated — unfilled midpoint remains a non-market working ticket', () => {
  const value = packageFor();
  assert.equal(value.entry.orderType, 'MIDPRICE');
  assert.equal('marketFallback' in value.entry, false);
  assert.equal(value.entry.tif, 'DAY');
});

test('P04/P05 simulated — cent changes stay silent within cap and cap crossings block', () => {
  assert.equal(broker.quoteWithinCap('Long', { bid: 100.97, ask: 100.99 }, 101), true);
  assert.equal(broker.quoteWithinCap('Long', { bid: 101, ask: 101.01 }, 101), false);
  assert.equal(broker.quoteWithinCap('Short', { bid: 99.01, ask: 99.03 }, 99), true);
  assert.equal(broker.quoteWithinCap('Short', { bid: 98.99, ask: 99.01 }, 99), false);
});

test('P06/P07 simulated — breakout is STP LMT and a gap beyond worst price cannot become market', () => {
  const long = packageFor({ method: 'Breakout', triggerPrice: 100, hardCap: 100.25 });
  assert.deepEqual({ type: long.entry.orderType, trigger: long.entry.auxPrice, worst: long.entry.lmtPrice }, { type: 'STP LMT', trigger: 100, worst: 100.25 });
  assert.equal(broker.quoteWithinCap('Long', { bid: 100.3, ask: 100.4 }, 100.25), false);
  assert.throws(() => packageFor({ method: 'Breakout', triggerPrice: 100, hardCap: 99.99 }), /cannot cross/);
});

test('P08 simulated — LOO is exactly LMT plus OPG, but auction submission is disabled', () => {
  const value = packageFor({ method: 'Opening' });
  assert.deepEqual({ type: value.entry.orderType, tif: value.entry.tif, limit: value.entry.lmtPrice, policy: value.submissionPolicy }, { type: 'LMT', tif: 'OPG', limit: 101, policy: 'construction-only-auction' });
  assert.throws(() => broker.assertPackageMaySubmit(authorization(), value), error => error.code === 'AUCTION_UNVALIDATED');
});

test('P09 simulated — all Gate 2 entry/protection combinations default to RTH', () => {
  for (const method of ['Normal', 'Breakout', 'Opening']) {
    const value = packageFor({ method, triggerPrice: method === 'Breakout' ? 100 : undefined });
    assert.equal(value.entry.outsideRth, false);
    assert.equal(value.protection.outsideRth, false);
  }
});

test('P10 simulated — partial fills require cumulative broker-confirmed stop coverage and keep targets staged', () => {
  let state = broker.initialManagedOrderState(100);
  state = broker.applyEntryFill(state, 25, 25);
  assert.deepEqual({ fill: state.filledQuantity, stop: state.protectionQuantity, targets: state.targetsActive, lifecycle: state.lifecycle }, { fill: 25, stop: 25, targets: false, lifecycle: 'Partially filled' });
  state = broker.applyEntryFill(state, 60, 60);
  assert.equal(state.targetsActive, false);
  assert.throws(() => broker.applyEntryFill(state, 80, 81), /cannot exceed/);
});

test('P11 simulated — cancelled remainder activates exits only for final protected fill', () => {
  const partial = broker.applyEntryFill(broker.initialManagedOrderState(100), 60, 60, true);
  const final = broker.activateFinalExits(partial, 60);
  assert.deepEqual({ fill: final.filledQuantity, protection: final.protectionQuantity, targets: final.targetsActive }, { fill: 60, protection: 60, targets: true });
});

test('P12/P13 simulated — target allocation prerequisites conserve final protected quantity', () => {
  const complete = broker.applyEntryFill(broker.initialManagedOrderState(100), 100, 100);
  assert.equal(complete.targetsActive, true);
  assert.deepEqual(broker.allocateTargetPlan(100), [35, 35, 30]);
  assert.deepEqual(broker.allocateTargetPlan(37), [13, 13, 11]);
  assert.deepEqual(broker.allocateTargetPlan(37, [70, 30]), [26, 11]);
  assert.equal(broker.allocateTargetPlan(37).reduce((sum, value) => sum + value, 0), 37);
});

test('P14/P15/P16 simulated — target fills have no breakeven trigger and the stop candidate never loosens protection', () => {
  assert.equal(broker.applyOneRTargetFill, undefined);
  assert.equal(broker.breakevenProtection('Long', 100, 101), 101);
  assert.equal(broker.breakevenProtection('Short', 100, 102), 100);
  assert.equal(broker.breakevenProtection('Short', 100, 99), 99);
});

test('P17 simulated — every runner mode is direction aware for long and short', () => {
  const values = { SMA10: 99, SMA20: 98, SMA50: 97, 'Day extreme': 96, Dollar: 98, Percentage: 98, Manual: 95 };
  for (const [mode, expected] of Object.entries(values)) {
    const result = broker.runnerStop({ direction: 'Long', mode, lastPrice: 100, sma10: 99, sma20: 98, sma50: 97, dayLow: 96, dollarTrail: 2, percentageTrail: 2, manualStop: 95 });
    assert.equal(result, expected);
  }
  assert.equal(broker.runnerStop({ direction: 'Short', mode: 'Day extreme', lastPrice: 100, dayHigh: 104 }), 104);
  assert.equal(broker.runnerStop({ direction: 'Short', mode: 'Dollar', lastPrice: 100, dollarTrail: 2 }), 102);
  assert.equal(broker.runnerStop({ direction: 'Short', mode: 'Percentage', lastPrice: 100, percentageTrail: 2 }), 102);
});

test('P18/P19 simulated — protection retries exactly once, then persists Unprotected without auto-close', () => {
  const filled = broker.applyEntryFill(broker.initialManagedOrderState(10), 10, 0);
  const first = broker.rejectProtection(filled);
  assert.deepEqual({ action: first.action, attempts: first.state.protectionAttempts }, { action: 'retry-stop', attempts: 1 });
  const second = broker.rejectProtection(first.state);
  assert.deepEqual({ action: second.action, lifecycle: second.state.lifecycle, targets: second.state.targetsActive }, { action: 'show-unprotected', lifecycle: 'Unprotected', targets: false });
  assert.equal(second.state.audit.includes('auto-market-close'), false);
});

test('P20 simulated — duplicate Trade clicks have one economic submission identity', () => {
  const records = new Map();
  const first = broker.beginSubmission(records, 'same-key');
  records.set('same-key', first.record);
  const duplicate = broker.beginSubmission(records, 'same-key');
  assert.equal(first.shouldSubmit, true);
  assert.equal(duplicate.shouldSubmit, false);
});

test('P21 simulated — timeout reconciles an accepted order before allowing retry', () => {
  const timedOut = broker.markSubmissionTimeout({ idempotencyKey: 'key', state: 'prepared' });
  const found = broker.reconcileSubmission(timedOut, 'broker-42');
  assert.equal(found.mayRetry, false);
  assert.equal(found.record.brokerOrderId, 'broker-42');
  assert.equal(broker.reconcileSubmission(timedOut, undefined).mayRetry, true);
});

test('P22 simulated — reconnect reconstruction starts from broker cumulative truth', () => {
  const reconstructed = broker.applyEntryFill(broker.initialManagedOrderState(100), 40, 40);
  assert.deepEqual({ fill: reconstructed.filledQuantity, stop: reconstructed.protectionQuantity, lifecycle: reconstructed.lifecycle }, { fill: 40, stop: 40, lifecycle: 'Partially filled' });
});

test('P23 simulated — broker final quantity wins cancel/replace races without over-close', () => {
  const result = broker.reconcileBrokerPosition({ authorization: authorization(), localQuantity: 50, broker: { accountId: baseConfig.accountId, symbol: 'AAPL', quantity: 35, observedAt: connectedAt } });
  assert.deepEqual({ quantity: result.quantity, effect: result.externalEffect, delta: result.externalQuantity }, { quantity: 35, effect: 'exit', delta: 15 });
});

test('P24/P25 simulated — manual broker liquidation/change is imported and audited', () => {
  const liquidation = broker.reconcileBrokerPosition({ authorization: authorization(), localQuantity: 100, broker: { accountId: baseConfig.accountId, symbol: 'AAPL', quantity: 0, observedAt: connectedAt } });
  assert.deepEqual({ closed: liquidation.campaignClosed, changed: liquidation.changedInIbkr, effect: liquidation.externalEffect, quantity: liquidation.externalQuantity }, { closed: true, changed: true, effect: 'exit', quantity: 100 });
  const addition = broker.reconcileBrokerPosition({ authorization: authorization(), localQuantity: 20, broker: { accountId: baseConfig.accountId, symbol: 'AAPL', quantity: 25, observedAt: connectedAt } });
  assert.deepEqual({ changed: addition.changedInIbkr, effect: addition.externalEffect, quantity: addition.externalQuantity }, { changed: true, effect: 'entry', quantity: 5 });
});

test('P26 simulated — EOD fallback is labelled non-executable and absence is never fabricated', () => {
  const eod = broker.planningPrice({ eod: { close: 100, observedAt: connectedAt, sessionDate: '2026-09-08' } });
  assert.deepEqual({ source: eod.source, executable: eod.executable, date: eod.sessionDate }, { source: 'Local EOD close', executable: false, date: '2026-09-08' });
  assert.throws(() => broker.planningPrice({}), /do not fabricate/);
});

test('P27 simulated — equity snapshots are accepted only for the exact active connection', () => {
  const auth = authorization();
  const value = broker.acceptEquitySnapshot(auth, { accountId: auth.accountId, connectionId: auth.connectionId, netLiquidation: 32000, currency: 'USD', observedAt: connectedAt });
  assert.equal(value.netLiquidation, 32000);
  assert.throws(() => broker.acceptEquitySnapshot(auth, { ...value, connectionId: 'stale' }), error => error.code === 'ACCOUNT_MISMATCH');
});

test('P28 simulated — precautionary warnings always await an explicit operator decision', () => {
  const warning = broker.receivePrecautionaryWarning({ idempotencyKey: 'key', state: 'prepared' }, 'Price precaution');
  assert.equal(warning.state, 'warning');
  assert.equal(broker.resolvePrecautionaryWarning(warning, 'confirm').state, 'prepared');
  assert.equal(broker.resolvePrecautionaryWarning(warning, 'cancel').state, 'rejected');
});

test('adapter reconnect invalidates prior authorization and every transport order has the exact account', async () => {
  const placed = [];
  const transport = {
    async connect() { return { managedAccounts: [baseConfig.accountId], connectedAt }; },
    async placeBracket(value) { placed.push(value.entry, value.protection); return { entryOrderId: '1', protectionOrderId: '2', status: 'Submitted' }; },
    async findOrderByReference() { return undefined; },
  };
  const adapter = new broker.IbkrPaperAdapter(baseConfig, verification(), transport);
  const auth = await adapter.connect();
  const result = await adapter.submit(broker.constructEntryPackage({ authorization: auth, contract, direction: 'Long', method: 'Normal', quantity: 2, hardCap: 101, stopPrice: 98, idempotencyKey: 'adapter-key' }));
  assert.equal(result.state, 'accepted');
  assert.equal(placed.length, 2);
  assert.ok(placed.every(order => order.account === baseConfig.accountId));
  await adapter.submit(broker.constructEntryPackage({ authorization: auth, contract, direction: 'Long', method: 'Normal', quantity: 2, hardCap: 101, stopPrice: 98, idempotencyKey: 'adapter-key' }));
  assert.equal(placed.length, 2);
  adapter.disconnect();
  await assert.rejects(() => adapter.submit(packageFor({ idempotencyKey: 'disconnected' })), error => error.code === 'VERIFICATION_REQUIRED');
});

test('adapter can connect for read-only checks while default submission remains disabled', async () => {
  const config = { ...baseConfig, submissionsEnabled: false };
  const checked = broker.recordOperatorVerification(config, config.accountId, 'TWS', verifiedAt);
  const transport = {
    async connect() { return { managedAccounts: [config.accountId], connectedAt }; },
    async placeBracket() { throw new Error('must not reach transport'); },
    async findOrderByReference() { return undefined; },
  };
  const adapter = new broker.IbkrPaperAdapter(config, checked, transport);
  const auth = await adapter.connect();
  const value = broker.constructEntryPackage({ authorization: auth, contract, direction: 'Long', method: 'Normal', quantity: 2, hardCap: 101, stopPrice: 98, idempotencyKey: 'read-only-key' });
  await assert.rejects(() => adapter.submit(value), error => error.code === 'SUBMISSION_DISABLED');
});

test('adapter times out safely and reconciles before retry', async () => {
  let attempts = 0;
  const transport = {
    async connect() { return { managedAccounts: [baseConfig.accountId], connectedAt }; },
    async placeBracket() { attempts += 1; throw new broker.BrokerSubmissionUncertainError('socket timeout'); },
    async findOrderByReference() { return { orderId: 'existing-7', status: 'Submitted' }; },
  };
  const adapter = new broker.IbkrPaperAdapter(baseConfig, verification(), transport);
  const auth = await adapter.connect();
  const value = broker.constructEntryPackage({ authorization: auth, contract, direction: 'Long', method: 'Normal', quantity: 2, hardCap: 101, stopPrice: 98, idempotencyKey: 'timeout-key' });
  await assert.rejects(() => adapter.submit(value), /socket timeout/);
  assert.equal(attempts, 1);
  const reconciled = await adapter.reconcileTimedOut('timeout-key');
  assert.equal(reconciled.mayRetry, false);
  assert.equal(reconciled.record.brokerOrderId, 'existing-7');
});

test('definitive broker rejection is not treated as an uncertain timeout', async () => {
  const transport = {
    async connect() { return { managedAccounts: [baseConfig.accountId], connectedAt }; },
    async placeBracket() { throw new broker.BrokerSubmissionRejectedError('short sale unavailable'); },
    async findOrderByReference() { throw new Error('must not reconcile a definite rejection'); },
  };
  const adapter = new broker.IbkrPaperAdapter(baseConfig, verification(), transport);
  const auth = await adapter.connect();
  const value = broker.constructEntryPackage({ authorization: auth, contract, direction: 'Short', method: 'Normal', quantity: 2, hardCap: 99, stopPrice: 102, idempotencyKey: 'rejected-key' });
  await assert.rejects(() => adapter.submit(value), /short sale unavailable/);
  assert.equal(adapter.submissions.get('rejected-key').state, 'rejected');
});

test('orders with omitted or unexpected accounts are locally rejected', () => {
  const auth = authorization();
  assert.throws(() => broker.assertOrderAccount(auth, {}), error => error.code === 'ORDER_ACCOUNT_MISMATCH');
  assert.throws(() => broker.assertOrderAccount(auth, { account: 'OTHER' }), error => error.code === 'ORDER_ACCOUNT_MISMATCH');
});

const lifecycleIntent = (overrides = {}) => broker.validatePaperIntent({
  intentId: 'intent-1', idempotencyKey: 'campaign-1:entry:v1', planId: 'plan-1', campaignId: 'campaign-1',
  accountBinding: 'private-binding-digest', instrumentIdentity: String(contract.conId), symbol: 'AAPL', direction: 'Long',
  planningPrice: 100, quote: { bid: 99.99, ask: 100.01, observedAt: '2026-09-10T13:59:55Z' }, now: '2026-09-10T14:00:00Z',
  maximumQuoteAgeMs: 10_000, maximumPriceDriftPercent: 0.5, minTick: 0.01,
  package: packageFor({ quantity: 40, hardCap: 100.25, stopPrice: 98, idempotencyKey: 'campaign-1:entry:v1' }),
  exitPlanSnapshot: { targets: [{ quantity: 10 }], runners: [{ quantity: 30 }] }, ...overrides,
});

const lifecycleFill = (executionId, overrides = {}) => ({
  executionId, orderId: 'entry-101', effect: 'entry', role: 'entry', quantity: 10, price: 100,
  fee: .5, occurredAt: '2026-09-10T14:01:00Z', ...overrides,
});

test('execution lifecycle persists intent before submit and distinguishes acknowledgement, fill, cancel request and confirmation', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let record = lifecycleIntent();
  let stored = broker.writePaperExecutionStore(storage, 'paper', null, broker.upsertPaperExecutionRecord({ schemaVersion: 1, records: [] }, record));
  assert.equal(stored.ok, true);
  record = broker.markIntentSubmitting(record, '2026-09-10T14:00:01Z');
  stored = broker.writePaperExecutionStore(storage, 'paper', stored.raw, broker.upsertPaperExecutionRecord(broker.readPaperExecutionStore(storage, 'paper').store, record));
  assert.equal(stored.ok, true);
  record = broker.acknowledgePaperBracket(record, { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  assert.equal(record.status, 'Broker acknowledged');
  record = broker.ingestPaperExecution(record, lifecycleFill('e1')).record;
  assert.equal(record.status, 'Partially filled');
  record = broker.confirmProtection(record, 10, '2026-09-10T14:01:01Z');
  assert.equal(record.advancedExitsActive, false);
  record = broker.requestPaperCancellation(record, '2026-09-10T14:02:00Z');
  assert.equal(record.status, 'Cancellation pending');
  record = broker.confirmPaperCancellation(record, '2026-09-10T14:02:05Z');
  assert.equal(record.status, 'Filled');
  assert.equal(record.entryFinal, true);
  assert.equal(record.advancedExitsActive, true);
});

test('unknown submission is never retryable until reconciliation proves no economic action', () => {
  let record = broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z');
  record = broker.markPaperSubmissionUnknown(record, 'Transport timeout after write.', '2026-09-10T14:00:11Z');
  assert.equal(record.status, 'Unknown submission');
  assert.throws(() => broker.markIntentSubmitting(record, '2026-09-10T14:00:12Z'));
  const found = broker.reconcilePaperExecution(record, { observedAt: '2026-09-10T14:01:00Z', foundEntryOrder: true, entryOrderId: 'entry-101', protectionOrderId: 'stop-102', brokerOpenQuantity: 0, brokerProtectionQuantity: 0, brokerWorkingExitQuantity: 0 });
  assert.equal(found.mayRetry, false);
  assert.equal(found.record.status, 'Broker acknowledged');
  const absent = broker.reconcilePaperExecution(record, { observedAt: '2026-09-10T14:01:00Z', foundEntryOrder: false, brokerOpenQuantity: 0, brokerProtectionQuantity: 0, brokerWorkingExitQuantity: 0 });
  assert.equal(absent.mayRetry, true);
  assert.equal(absent.record.status, 'Validated intent');
});

test('partial-entry touches defer rules; finalization requires fresh evaluation and full confirmed protection', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('e1', { quantity: 20 })).record;
  record = broker.confirmProtection(record, 20, '2026-09-10T14:01:01Z');
  record = broker.recordDeferredThresholdTouch(record, { ruleId: 'breakeven', quote: 102, observedAt: '2026-09-10T14:01:02Z' });
  assert.equal(record.thresholdTouches[0].deferred, true);
  assert.equal(record.advancedExitsActive, false);
  record = broker.ingestPaperExecution(record, lifecycleFill('e2', { quantity: 20, price: 100.5, occurredAt: '2026-09-10T14:02:00Z' })).record;
  assert.equal(record.entryFinal, true);
  assert.equal(record.advancedExitsActive, false);
  record = broker.confirmProtection(record, 40, '2026-09-10T14:02:01Z');
  assert.equal(record.advancedExitsActive, true);
  assert.throws(() => broker.recordDeferredThresholdTouch(record, { ruleId: 'breakeven', quote: 102, observedAt: '2026-09-10T14:02:02Z' }), /fresh quote/);
});

test('exit fills conserve quantity, reject over-close, deduplicate and reach partial/closed states', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('entry', { quantity: 40 })).record;
  record = broker.confirmProtection(record, 40, '2026-09-10T14:01:01Z');
  const firstExit = lifecycleFill('target-1', { orderId: 'target-103', effect: 'exit', role: 'target', quantity: 10, price: 104, occurredAt: '2026-09-10T15:00:00Z' });
  record = broker.ingestPaperExecution(record, firstExit).record;
  assert.equal(record.status, 'Partially exited');
  assert.deepEqual([record.enteredQuantity, record.exitedQuantity, record.openQuantity], [40, 10, 30]);
  assert.equal(broker.ingestPaperExecution(record, firstExit).duplicate, true);
  assert.throws(() => broker.ingestPaperExecution(record, lifecycleFill('too-many', { effect: 'exit', role: 'stop', quantity: 31, price: 99 })), /over-close/);
  record = broker.ingestPaperExecution(record, lifecycleFill('stop', { orderId: 'stop-102', effect: 'exit', role: 'stop', quantity: 30, price: 99, fee: 1, occurredAt: '2026-09-10T16:00:00Z' })).record;
  assert.equal(record.status, 'Closed');
  assert.equal(record.openQuantity, 0);
});

test('protection failure permits one reconciled retry then persists unprotected; offline automation is explicit', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('entry', { quantity: 40 })).record;
  record = broker.rejectProtectionWithSingleRetry(record, '2026-09-10T14:01:01Z');
  assert.equal(record.protection.state, 'retry-required');
  record = broker.rejectProtectionWithSingleRetry(record, '2026-09-10T14:01:02Z');
  assert.equal(record.protection.state, 'unprotected');
  assert.equal(record.status, 'Unprotected');
  record = broker.confirmProtection(record, 40, '2026-09-10T14:01:03Z');
  record = broker.setAutomationConnection(record, false, '2026-09-10T14:01:04Z');
  assert.equal(record.automationAvailability, 'offline');
});

test('Execution R freezes from final average entry and amendment application rejects stale broker state', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('entry-a', { quantity: 20, price: 100 })).record;
  assert.throws(() => broker.freezePaperExecutionRisk(record, 98, '2026-09-10T14:01:01Z'), /entry quantity is final/);
  record = broker.ingestPaperExecution(record, lifecycleFill('entry-b', { quantity: 20, price: 101 })).record;
  record = broker.freezePaperExecutionRisk(record, 98, '2026-09-10T14:02:01Z');
  assert.equal(record.actualAverageEntry, 100.5);
  assert.equal(record.executionRiskPerShare, 2.5);
  const draft = broker.createPaperAmendmentDraft(record, { amendmentId: 'amend-1', requestedExitPlan: { target: '3R' }, createdAt: '2026-09-10T14:03:00Z' });
  assert.equal(draft.state, 'unapplied');
  assert.deepEqual(draft.requestedExitPlan, { target: '3R' });
  const applying = broker.beginPaperAmendment(record, draft, '2026-09-10T14:03:01Z');
  assert.equal(applying.state, 'applying');
  assert.equal(broker.confirmPaperAmendment(applying, 'broker-rev-2', '2026-09-10T14:03:02Z').state, 'broker-confirmed');
  const changed = broker.confirmProtection(record, 40, '2026-09-10T14:03:03Z');
  const stale = broker.beginPaperAmendment(changed, draft, '2026-09-10T14:03:04Z');
  assert.equal(stale.state, 'rejected-stale');
  assert.match(stale.error, /changed/);
});

test('intent validation rejects stale/crossed quotes, drift, tick mismatch and contract changes', () => {
  assert.throws(() => lifecycleIntent({ quote: { bid: 99, ask: 100, observedAt: '2026-09-10T13:00:00Z' } }), /stale/);
  assert.throws(() => lifecycleIntent({ quote: { bid: 101, ask: 100, observedAt: '2026-09-10T13:59:55Z' } }), /crossed/);
  assert.throws(() => lifecycleIntent({ quote: { bid: 101, ask: 101.01, observedAt: '2026-09-10T13:59:55Z' } }), /drift/);
  assert.throws(() => lifecycleIntent({ minTick: .03 }), /minimum tick/);
  assert.throws(() => lifecycleIntent({ instrumentIdentity: '999' }), /identity changed/);
});

test('store compare-and-set prevents stale overwrite, failed round-trip blocks, and idempotency survives restart', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const record = lifecycleIntent();
  const first = broker.writePaperExecutionStore(storage, 'paper', null, broker.upsertPaperExecutionRecord({ schemaVersion: 1, records: [] }, record));
  assert.equal(first.ok, true);
  assert.equal(broker.writePaperExecutionStore(storage, 'paper', null, { schemaVersion: 1, records: [] }).ok, false);
  const reloaded = broker.readPaperExecutionStore(storage, 'paper').store;
  assert.throws(() => broker.upsertPaperExecutionRecord(reloaded, { ...record, intent: { ...record.intent, intentId: 'different' } }), /idempotency/);
  const broken = { getItem: () => null, setItem() {} };
  assert.equal(broker.writePaperExecutionStore(broken, 'paper', null, reloaded).ok, false);
});

test('session policy keeps RTH default and separates duration from eligibility', () => {
  const regular = broker.resolveExecutionSession({ mode: 'Regular', duration: 'GTC', protectionOrderType: 'STP', protectionStopPrice: 98 });
  assert.deepEqual({ route: regular.route, entry: regular.entryOrderType, outside: regular.outsideRth, duration: regular.duration, eligible: regular.submissionEligible }, { route: 'SMART', entry: 'MIDPRICE', outside: false, duration: 'GTC', eligible: true });
  assert.deepEqual(broker.sessionDurationOptions('Overnight'), ['DAY']);
  assert.throws(() => broker.resolveExecutionSession({ mode: 'Overnight', duration: 'GTC', protectionOrderType: 'STP', protectionStopPrice: 98 }), /duration/);
});

test('extended-hours entries require an explicit limit and independent stop-limit protection', () => {
  const missing = broker.resolveExecutionSession({ mode: 'RegularExtended', duration: 'DAY', protectionOrderType: 'STP', protectionStopPrice: 98 });
  assert.equal(missing.submissionEligible, false);
  assert.match(missing.blockedReason, /stop-limit protection/);
  const policy = broker.resolveExecutionSession({ mode: 'RegularExtended', duration: 'GTC', protectionOrderType: 'STP LMT', protectionStopPrice: 98, protectionLimitPrice: 97.5 });
  const value = packageFor({ method: 'Limit', sessionPolicy: policy });
  assert.deepEqual({ entry: value.entry.orderType, entryOutside: value.entry.outsideRth, entryTif: value.entry.tif, protection: value.protection.orderType, protectionOutside: value.protection.outsideRth, trigger: value.protection.auxPrice, limit: value.protection.lmtPrice }, { entry: 'LMT', entryOutside: true, entryTif: 'GTC', protection: 'STP LMT', protectionOutside: true, trigger: 98, limit: 97.5 });
  assert.throws(() => packageFor({ method: 'Normal', sessionPolicy: policy }), /incompatible/);
  assert.throws(() => broker.validateStopLimitProtection('Long', 98, 98.01, .01), /at or below/);
  assert.throws(() => broker.validateStopLimitProtection('Short', 102, 101.99, .01), /at or above/);
});

test('overnight modes remain planning-only without verified broker-held initial protection', () => {
  const overnight = broker.resolveExecutionSession({ mode: 'Overnight', duration: 'DAY', protectionOrderType: 'STP LMT', protectionStopPrice: 98, protectionLimitPrice: 97.5 });
  const combined = broker.resolveExecutionSession({ mode: 'OvernightDay', duration: 'DAY', protectionOrderType: 'STP LMT', protectionStopPrice: 98, protectionLimitPrice: 97.5 });
  assert.equal(overnight.route, 'OVERNIGHT');
  assert.equal(combined.route, 'OVERNIGHT+SMART');
  assert.equal(overnight.submissionEligible, false);
  assert.match(overnight.blockedReason, /broker-held initial stop/);
  assert.match(combined.blockedReason, /OVT\/OND/);
});

test('session expiry finalizes only confirmed fills and never recreates the order', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('partial', { quantity: 20 })).record;
  record = broker.confirmProtection(record, 20, '2026-09-10T14:01:01Z');
  record = broker.expirePaperEntry(record, '2026-09-10T20:00:00Z');
  assert.deepEqual({ status: record.status, final: record.entryFinal, open: record.openQuantity, exits: record.advancedExitsActive }, { status: 'Filled', final: true, open: 20, exits: true });
  assert.match(record.audit.at(-1), /no-recreate/);
  assert.throws(() => broker.expirePaperEntry(record, '2026-09-10T20:00:01Z'), /already final/);
});

test('protection presentation separates acknowledgement, eligibility, stop-limit fill risk and offline automation', () => {
  let record = broker.acknowledgePaperBracket(broker.markIntentSubmitting(lifecycleIntent(), '2026-09-10T14:00:01Z'), { entryOrderId: 'entry-101', protectionOrderId: 'stop-102', acknowledgedAt: '2026-09-10T14:00:02Z' });
  record = broker.ingestPaperExecution(record, lifecycleFill('entry', { quantity: 40 })).record;
  record = broker.confirmProtection(record, 40, '2026-09-10T14:01:01Z');
  assert.equal(broker.paperProtectionDisplay(record, { sessionEligible: true, connected: true }).state, 'eligible');
  assert.equal(broker.paperProtectionDisplay(record, { sessionEligible: false, connected: true }).state, 'inactive');
  assert.equal(broker.paperProtectionDisplay(record, { sessionEligible: true, connected: false }).state, 'broker-held');
  assert.equal(broker.paperProtectionDisplay(record, { sessionEligible: true, connected: true, triggeredUnfilled: true }).state, 'triggered-unfilled');
  const amendment = broker.createPaperAmendmentDraft(record, { amendmentId: 'session-amendment', requestedExitPlan: {}, createdAt: '2026-09-10T14:02:00Z' });
  assert.equal(amendment.sessionPolicy.mode, 'Regular');
});
