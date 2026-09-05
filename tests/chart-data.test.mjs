import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/chart-data.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { toChartBars, getLocalJson } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const bar = { session_date: '2026-09-03', open: 100, high: 105, low: 99, close: 103, volume: 1000 };
const payload = (bars) => ({ schema_version: 1, series: { timeframe: '1Day' }, bars });

test('maps a session without changing OHLCV or its date', () => {
  assert.deepEqual(toChartBars(payload([bar])), [{ timestamp: Date.UTC(2026, 8, 3, 12), open: 100, high: 105, low: 99, close: 103, volume: 1000 }]);
});
test('handles an unavailable adjustment as an empty series', () => assert.deepEqual(toChartBars(payload([])), []));
test('rejects duplicates, reversed dates and invalid price or volume', () => {
  for (const bars of [[bar, bar], [bar, { ...bar, session_date: '2026-09-02' }], [{ ...bar, high: 90 }], [{ ...bar, volume: -1 }], [{ ...bar, close: NaN }]]) {
    assert.throws(() => toChartBars(payload(bars)), /Invalid or unordered/);
  }
});
test('rejects incompatible contracts', () => assert.throws(() => toChartBars({ ...payload([bar]), schema_version: 2 }), /Unsupported/));
test('API errors do not become synthetic chart values', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  await assert.rejects(getLocalJson('/v1/chart/AAPL', new AbortController().signal), /Database unavailable/);
});
