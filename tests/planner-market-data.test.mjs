import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function dataModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}

const domainUrl = dataModule('../lib/trading-domain.ts');
const chartUrl = dataModule('../lib/chart-data.ts');
const plannerSource = readFileSync(new URL('../lib/planner-market-data.ts', import.meta.url), 'utf8')
  .replace('./trading-domain', domainUrl)
  .replace('./chart-data', chartUrl);
const plannerJs = ts.transpileModule(plannerSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { planningSnapshotFromChart, demoPlanningMarketSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(plannerJs).toString('base64')}`);

const dates = ['2026-08-14','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
const bars = dates.map(session_date => ({ session_date, open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
const response = {
  schema_version: 1,
  instrument: { symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ', status: 'active' },
  bars,
  series: { source: 'alpaca_sip', adjustment: 'all', timeframe: '1Day', returned: bars.length, limit: 260 },
  status: { freshness: 'stale', last_session: '2026-09-03', expected_session: '2026-09-04', calendar_covered: true, checked_at: '2026-09-04T20:15:00Z' },
};

test('planner snapshot derives ATR and day extremes from the identified completed session', () => {
  assert.deepEqual(planningSnapshotFromChart(response), {
    atr14: 2,
    close: 100,
    dayHigh: 101,
    dayLow: 99,
    expectedSession: '2026-09-04',
    observedAt: '2026-09-04T20:15:00Z',
    sessionDate: '2026-09-03',
    source: 'Local EOD · alpaca_sip',
    status: 'stale',
  });
});

test('planner snapshot rejects missing ATR history and sample data stays explicitly synthetic', () => {
  assert.throws(() => planningSnapshotFromChart({ ...response, bars: bars.slice(1), status: { ...response.status, last_session: '2026-09-03' } }), /prior close/);
  assert.equal(demoPlanningMarketSnapshot('NVDA').source, 'Simulated fixture');
  assert.equal(demoPlanningMarketSnapshot('NVDA').status, 'sample');
  assert.equal(demoPlanningMarketSnapshot('AAPL'), null);
});
