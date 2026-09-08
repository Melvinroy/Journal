import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const domainSource = readFileSync(new URL('../lib/trading-domain.ts', import.meta.url), 'utf8');
const domainJs = ts.transpileModule(domainSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domainUrl = `data:text/javascript;base64,${Buffer.from(domainJs).toString('base64')}`;
const migrationSource = readFileSync(new URL('../lib/trading-migrations.ts', import.meta.url), 'utf8').replace('./trading-domain', domainUrl);
const migrationJs = ts.transpileModule(migrationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dryRunTradingMigration } = await import(`data:text/javascript;base64,${Buffer.from(migrationJs).toString('base64')}`);

const cleanPlan = { id: 'p1', name: 'Breakout', symbol: 'nvda', side: 'Long', entry: 100, equity: 30000, riskPercent: .5, allocationPercent: 10, tranches: [{ id: 'A', percent: 70, stop: 98, target: 102 }, { id: 'B', percent: 30, stop: 98, target: null }], fills: [], notes: '', revision: 2, updatedAt: '2026-09-09T00:00:00Z' };
const ambiguousPlan = { ...cleanPlan, id: 'p2', fills: [{ id: 'legacy-fill' }] };
const journalRaw = '[\n  {"id":"journal-1","symbol":"NVDA","pnl":30}\n]';

test('dry run migrates only unambiguous plans and preserves Journal bytes exactly', () => {
  const input = { legacyPlansRaw: JSON.stringify([cleanPlan, ambiguousPlan]), legacyJournalRaw: journalRaw };
  const result = dryRunTradingMigration(input);
  assert.deepEqual(result.counts, { migrated: 1, unchanged: 1, needsReview: 1, failed: 0 });
  assert.equal(result.backup.legacyPlansRaw, input.legacyPlansRaw);
  assert.equal(result.backup.legacyJournalRaw, journalRaw);
  assert.equal(result.unchangedJournalRaw, journalRaw);
  assert.equal(result.migratedPlans[0].planId, 'p1');
  assert.equal(result.migratedPlans[0].sizing.plannedQuantity, 30);
  assert.equal(result.issues[0].category, 'Needs Review');
});

test('corrupt sources fail without overwriting their backup bytes', () => {
  const result = dryRunTradingMigration({ legacyPlansRaw: '{bad', legacyJournalRaw: '{}' });
  assert.deepEqual(result.counts, { migrated: 0, unchanged: 0, needsReview: 0, failed: 2 });
  assert.equal(result.backup.legacyPlansRaw, '{bad'); assert.equal(result.backup.legacyJournalRaw, '{}');
});

test('original planner draft migrates while settings and exit records remain byte-preserved', () => {
  const draft = { symbol: 'AAPL', side: 'Long', entryPrice: 100, stopPrice: 98, stopSource: 'LoD', accountEquity: 30000, riskPercent: .5, maxAllocationPercent: 10, targetPrices: [102, 104], exitPlan: { targetShares: [10, 10], runnerShares: 10 }, savedAt: '2026-09-09T01:00:00Z' };
  const input = { legacyPlannerDraftRaw: JSON.stringify(draft), legacyPlannerSettingsRaw: '{"riskPercent":0.5}', legacyExitSettingsRaw: '{"targetCount":2}', legacyAfterFillRaw: '{"savedAt":"2026-09-09"}' };
  const result = dryRunTradingMigration(input);
  assert.deepEqual(result.counts, { migrated: 1, unchanged: 3, needsReview: 0, failed: 0 });
  assert.deepEqual(result.backup, input); assert.equal(result.migratedPlans[0].planId, 'legacy-original:AAPL:2026-09-09T01:00:00Z');
  assert.ok(result.migratedPlans[0].targets.every(target => Math.abs(target.percent - 100 / 3) < 1e-12));
  const short = dryRunTradingMigration({ legacyPlannerDraftRaw: JSON.stringify({ ...draft, side: 'Short' }) });
  assert.equal(short.counts.needsReview, 1); assert.match(short.issues[0].reason, /direction-aware/);
});

test('CLI writes a byte-preserving fixture backup and report, and refuses apply mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brontide-gate1-'));
  try {
    const inputPath = join(directory, 'input.json'); const backupPath = join(directory, 'backup.json'); const reportPath = join(directory, 'report.json');
    const input = { legacyPlansRaw: JSON.stringify([cleanPlan, ambiguousPlan]), legacyJournalRaw: journalRaw };
    await writeFile(inputPath, JSON.stringify(input));
    const run = spawnSync(process.execPath, ['scripts/trading-migration-dry-run.mjs', '--input', inputPath, '--backup', backupPath, '--report', reportPath], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr); assert.deepEqual(JSON.parse(run.stdout), { migrated: 1, unchanged: 1, needsReview: 1, failed: 0 });
    assert.deepEqual(JSON.parse(await readFile(backupPath, 'utf8')), input);
    assert.deepEqual(JSON.parse(await readFile(reportPath, 'utf8')).counts, { migrated: 1, unchanged: 1, needsReview: 1, failed: 0 });
    const apply = spawnSync(process.execPath, ['scripts/trading-migration-dry-run.mjs', '--apply'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.notEqual(apply.status, 0); assert.match(apply.stderr, /dry-run only/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Supabase migration is additive, versioned, scoped, and retains legacy trades', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260909000000_trading_domain_v1.sql', import.meta.url), 'utf8');
  for (const table of ['trade_plans', 'trade_campaigns', 'broker_order_intents', 'trade_executions', 'exit_allocations', 'journal_reviews', 'reconciliation_checkpoints']) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.doesNotMatch(sql, /drop table[^;]*public\.trades/i); assert.doesNotMatch(sql, /alter table public\.trades/i);
  assert.match(sql, /unique \(user_id, account_scope, session_scope, broker_execution_id\)/);
  assert.match(sql, /enable row level security/); assert.match(sql, /schema_version/);
});
