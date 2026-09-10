import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/trading-domain.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const now = '2026-09-09T14:00:00Z';
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

const plan = (overrides = {}) => ({
  schemaVersion: 1,
  breakeven: { activationR: 1, favorableOffset: { unit: 'Dollar', value: 0 } },
  legs: [
    { id: 'T1', role: 'Target', allocationPercent: 35, target: { mode: 'R', multipleR: 1 } },
    { id: 'Runner A', role: 'Runner', allocationPercent: 35, activationR: 1, trailing: { mode: 'SMA', period: 10 } },
    { id: 'Runner B', role: 'Runner', allocationPercent: 30, activationR: 2, trailing: { mode: 'Dollar', distance: 1 } },
  ],
  ...overrides,
});

const reference = (basis = 'Execution', direction = 'Long', entryPrice = 100, fixedStopPrice = direction === 'Long' ? 98 : 102) =>
  domain.freezeRiskReference({ basis, direction, entryPrice, fixedStopPrice, frozenAt: now });

const quote = (direction, price, overrides = {}) => ({
  source: 'IBKR', status: 'fresh', observedAt: now,
  ...(direction === 'Long' ? { bid: price, ask: price + .02 } : { bid: price - .02, ask: price }),
  ...overrides,
});

test('fixed Planned R and Execution R remain distinct and target input mode stays authoritative', () => {
  const planned = reference('Planned', 'Long', 100, 98);
  const execution = reference('Execution', 'Long', 100.06, 98);
  assert.equal(planned.riskPerShare, 2);
  close(execution.riskPerShare, 2.06);
  assert.deepEqual(domain.resolvedTarget({ mode: 'R', multipleR: 1 }, execution), { authoritativeMode: 'R', price: 102.12, multipleR: 1 });
  assert.deepEqual(domain.resolvedTarget({ mode: 'Price', price: 104.18 }, execution), { authoritativeMode: 'Price', price: 104.18, multipleR: 2 });
  assert.throws(() => domain.resolvedTarget({ mode: 'Price', price: 99 }, execution), /favorable side/);
});

test('one target and two runners allocate confirmed whole shares exactly and deterministically', () => {
  const definition = plan();
  assert.equal(domain.validateExitPlan(definition), definition);
  assert.deepEqual(domain.exitLegQuantities(37, definition), [
    { legId: 'T1', role: 'Target', quantity: 13 },
    { legId: 'Runner A', role: 'Runner', quantity: 13 },
    { legId: 'Runner B', role: 'Runner', quantity: 11 },
  ]);
  assert.throws(() => domain.exitLegQuantities(2, definition), /at least one share/);
  assert.throws(() => domain.validateExitPlan(plan({ legs: definition.legs.map((leg, index) => ({ ...leg, allocationPercent: index === 0 ? 34 : leg.allocationPercent })) })), /total 100/);
});

test('partial-entry threshold touches are recorded but never advance protection or survive a retrace', () => {
  const planned = reference('Planned');
  const touch = domain.observePartialEntryThreshold({ plannedReference: planned, quote: quote('Long', 102.25), thresholdR: 1, confirmedFilledQuantity: 40, confirmedProtectionQuantity: 40 });
  assert.equal(touch.state, 'Deferred touch');
  assert.equal(touch.touch.referenceBasis, 'Planned');
  assert.equal(touch.touch.observedPrice, 102.25);
  assert.equal(domain.observePartialEntryThreshold({ plannedReference: planned, quote: quote('Long', 102.25), thresholdR: 1, confirmedFilledQuantity: 40, confirmedProtectionQuantity: 35 }).state, 'Blocked');

  const execution = reference('Execution', 'Long', 100.06, 98);
  const retraced = domain.evaluateBreakevenAdvancement({ executionReference: execution, quote: quote('Long', 102.11), rule: plan().breakeven, currentStopPrice: 98, confirmedOpenQuantity: 100, confirmedProtectionQuantity: 100 });
  assert.deepEqual(retraced, { state: 'Not reached', thresholdPrice: 102.12 });
  const freshQualification = domain.evaluateBreakevenAdvancement({ executionReference: execution, quote: quote('Long', 102.12), rule: plan().breakeven, currentStopPrice: 98, confirmedOpenQuantity: 100, confirmedProtectionQuantity: 100 });
  assert.deepEqual(freshQualification, { state: 'Advance', stopPrice: 100.06, thresholdPrice: 102.12 });
});

test('breakeven thresholds, dollar/R offsets and no-loosening behavior are long/short symmetric', () => {
  const long = reference('Execution', 'Long');
  const short = reference('Execution', 'Short');
  const dollars = { activationR: 2, favorableOffset: { unit: 'Dollar', value: .25 } };
  assert.deepEqual(domain.evaluateBreakevenAdvancement({ executionReference: long, quote: quote('Long', 104), rule: dollars, currentStopPrice: 98, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }), { state: 'Advance', stopPrice: 100.25, thresholdPrice: 104 });
  assert.deepEqual(domain.evaluateBreakevenAdvancement({ executionReference: short, quote: quote('Short', 96), rule: dollars, currentStopPrice: 102, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }), { state: 'Advance', stopPrice: 99.75, thresholdPrice: 96 });
  const inR = { activationR: 3, favorableOffset: { unit: 'R', value: .5 } };
  assert.equal(domain.evaluateBreakevenAdvancement({ executionReference: long, quote: quote('Long', 106.5), rule: inR, currentStopPrice: 98, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }).stopPrice, 101);
  assert.equal(domain.evaluateBreakevenAdvancement({ executionReference: short, quote: quote('Short', 93.5), rule: inR, currentStopPrice: 102, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }).stopPrice, 99);
  assert.deepEqual(domain.evaluateBreakevenAdvancement({ executionReference: long, quote: quote('Long', 104), rule: dollars, currentStopPrice: 100.5, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }), { state: 'Already tighter', stopPrice: 100.5, thresholdPrice: 104 });
  assert.deepEqual(domain.evaluateBreakevenAdvancement({ executionReference: short, quote: quote('Short', 96), rule: dollars, currentStopPrice: 99.5, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 }), { state: 'Already tighter', stopPrice: 99.5, thresholdPrice: 96 });
});

test('stale, absent and non-broker quotes block, and invalid market-relative stops are rejected without substitution', () => {
  const execution = reference();
  const base = { executionReference: execution, rule: plan().breakeven, currentStopPrice: 98, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 };
  assert.match(domain.evaluateBreakevenAdvancement({ ...base, quote: quote('Long', 103, { status: 'stale' }) }).reason, /fresh/);
  assert.match(domain.evaluateBreakevenAdvancement({ ...base, quote: { source: 'Local EOD', status: 'fresh', observedAt: now, bid: 103 } }).reason, /non-executable/);
  assert.match(domain.evaluateBreakevenAdvancement({ ...base, quote: { source: 'IBKR', status: 'missing', observedAt: now } }).reason, /fresh/);
  const invalidDestination = domain.evaluateBreakevenAdvancement({ ...base, quote: quote('Long', 102), rule: { activationR: 1, favorableOffset: { unit: 'Dollar', value: 2.5 } } });
  assert.equal(invalidDestination.state, 'Blocked');
  assert.match(invalidDestination.reason, /invalid relative/);

  const short = reference('Execution', 'Short');
  const missingAsk = domain.evaluateBreakevenAdvancement({ executionReference: short, quote: { source: 'IBKR', status: 'fresh', observedAt: now, bid: 96 }, rule: plan().breakeven, currentStopPrice: 102, confirmedOpenQuantity: 10, confirmedProtectionQuantity: 10 });
  assert.equal(missingAsk.state, 'Blocked');
  assert.match(missingAsk.reason, /ask/);
});

test('each runner has an independent activation threshold and trailing configuration', () => {
  const execution = reference();
  const [runnerA, runnerB] = plan().legs.filter(leg => leg.role === 'Runner');
  const base = { executionReference: execution, quote: quote('Long', 104.25), currentStopPrice: 98, confirmedOpenQuantity: 37, confirmedProtectionQuantity: 37 };
  assert.deepEqual(domain.evaluateRunnerAdvancement({ ...base, runner: runnerA, sma10: 101.5 }), { state: 'Advance', stopPrice: 101.5, thresholdPrice: 102 });
  assert.deepEqual(domain.evaluateRunnerAdvancement({ ...base, runner: runnerB }), { state: 'Advance', stopPrice: 103.25, thresholdPrice: 104 });
  assert.equal(domain.evaluateRunnerAdvancement({ ...base, runner: runnerA }).state, 'Blocked');
  assert.equal(domain.evaluateRunnerAdvancement({ ...base, runner: runnerB, quote: quote('Long', 103.5) }).state, 'Not reached');
});

test('general and symbol presets preserve isolation and authoritative target modes', () => {
  const definition = plan();
  const general = { schemaVersion: 1, presetId: 'p1', name: 'One plus two runners', scope: 'General', definition, createdAt: now, updatedAt: now };
  const saved = domain.saveExitPlanPreset([], general);
  const loaded = domain.loadExitPlanPreset(saved[0]);
  loaded.legs[0].allocationPercent = 10;
  assert.equal(saved[0].definition.legs[0].allocationPercent, 35);
  const renamed = domain.renameExitPlanPreset(saved, 'p1', 'Trend pair', '2026-09-09T15:00:00Z');
  assert.equal(saved[0].name, 'One plus two runners');
  assert.equal(renamed[0].name, 'Trend pair');
  assert.deepEqual(domain.deleteExitPlanPreset(renamed, 'p1'), []);

  const priceDefinition = plan({ legs: [{ id: 'T1', role: 'Target', allocationPercent: 35, target: { mode: 'Price', price: 105 } }, ...definition.legs.slice(1)] });
  assert.throws(() => domain.saveExitPlanPreset([], { ...general, definition: priceDefinition }), /R-based/);
  const symbol = domain.saveExitPlanPreset([], { ...general, presetId: 'p2', name: 'AAPL levels', scope: 'Symbol', symbol: 'AAPL', definition: priceDefinition });
  assert.equal(symbol[0].definition.legs[0].target.mode, 'Price');
  assert.equal(symbol[0].definition.legs[0].target.price, 105);
});

test('preset persistence fails closed on invalid data, concurrent changes and write failures', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const empty = domain.readExitPlanPresetStore(storage, 'presets');
  assert.equal(empty.ok, true);
  const preset = { schemaVersion: 1, presetId: 'p1', name: 'Default', scope: 'General', definition: plan(), createdAt: now, updatedAt: now };
  const write = domain.writeExitPlanPresetStore(storage, 'presets', empty.raw, { schemaVersion: 1, presets: [preset] });
  assert.equal(write.ok, true);
  assert.equal(domain.readExitPlanPresetStore(storage, 'presets').store.presets.length, 1);
  values.set('presets', 'changed elsewhere');
  assert.match(domain.writeExitPlanPresetStore(storage, 'presets', write.raw, { schemaVersion: 1, presets: [] }).error, /another view/);
  assert.equal(values.get('presets'), 'changed elsewhere');
  assert.equal(domain.readExitPlanPresetStore(storage, 'presets').ok, false);
  const failing = { getItem: () => 'unchanged', setItem: () => { throw new Error('quota'); } };
  assert.match(domain.writeExitPlanPresetStore(failing, 'presets', 'unchanged', { schemaVersion: 1, presets: [preset] }).error, /not replaced/);
  assert.equal(failing.getItem(), 'unchanged');
});

test('actual-position changes create an explicit immutable draft amendment for remaining shares', () => {
  const definition = plan();
  const filled = Object.freeze({ T1: 13 });
  const amendment = domain.createExitPlanAmendment({ amendmentId: 'a1', campaignId: 'c1', sourcePlanRevisionId: 'p1:r2', confirmedOpenQuantity: 24, requestedDefinition: definition, filledQuantitySnapshot: filled, createdAt: now });
  assert.equal(amendment.state, 'Draft');
  assert.equal(amendment.requestedQuantities.reduce((sum, item) => sum + item.quantity, 0), 24);
  assert.deepEqual(amendment.filledQuantitySnapshot, { T1: 13 });
  assert.notEqual(amendment.requestedDefinition, definition);
  assert.equal(definition.legs[0].allocationPercent, 35);
});

test('legacy plan payloads remain unchanged when the additive exit-plan model is absent', () => {
  const legacy = { schemaVersion: 1, kind: 'trade-plan', planId: 'legacy', targets: [{ multipleR: 1, percent: 70 }], runner: { percent: 30, rule: 'Legacy saved runner' } };
  const reopened = JSON.parse(JSON.stringify(legacy));
  assert.deepEqual(reopened, legacy);
  assert.equal(reopened.exitPlan, undefined);
});
