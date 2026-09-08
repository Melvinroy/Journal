import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domainCode = compile('../lib/trading-domain.ts');
const domainUrl = `data:text/javascript;base64,${Buffer.from(domainCode).toString('base64')}`;
const demoCode = compile('../lib/trading-demo.ts').replace('from "./trading-domain"', `from "${domainUrl}"`);
const demo = await import(`data:text/javascript;base64,${Buffer.from(demoCode).toString('base64')}`);

test('simulated campaigns produce exactly one Journal row each and replayed fills have one economic effect', () => {
  const rows = demo.demoJournalRows();
  assert.equal(rows.length, demo.DEMO_CAMPAIGNS.length);
  assert.equal(new Set(rows.map(row => row.campaignId)).size, rows.length);
  const mrna = rows.find(row => row.symbol === 'MRNA');
  assert.equal(mrna.executions.length, 3);
  assert.equal(mrna.openQuantity, 12);
  assert.equal(mrna.pnl, 17);
});

test('position preview covers partial entry, partial profit/loss, closure, manual broker change and unprotected state', () => {
  const aapl = demo.DEMO_POSITIONS.find(row => row.symbol === 'AAPL');
  const mrna = demo.DEMO_POSITIONS.find(row => row.symbol === 'MRNA');
  const amd = demo.DEMO_POSITIONS.find(row => row.symbol === 'AMD');
  const tsla = demo.DEMO_POSITIONS.find(row => row.symbol === 'TSLA');
  assert.deepEqual({ status:aapl.status, filled:aapl.filledQuantity, open:aapl.openQuantity, protected:aapl.protection.quantity, changed:aapl.changedInIbkr }, { status:'Partially filled', filled:40, open:35, protected:35, changed:true });
  assert.equal(mrna.targets.some(target => target.state === 'Filled'), true);
  assert.equal(demo.demoJournalRows().find(row => row.symbol === 'MRNA').executions.some(item => item.price > 90), true);
  assert.deepEqual({ status:amd.status, open:amd.openQuantity }, { status:'Closed', open:0 });
  assert.deepEqual({ status:tsla.status, protected:tsla.protection.quantity }, { status:'Unprotected', protected:0 });
});

test('stale plans and unlinked holdings remain explicit and simulated fixtures cannot resemble a broker account', () => {
  assert.equal(demo.DEMO_SAVED_PLANS.some(plan => plan.stale && /Local EOD/.test(plan.priceSource)), true);
  assert.equal(demo.DEMO_UNLINKED_POSITIONS.length, 1);
  assert.ok(demo.DEMO_CAMPAIGNS.every(campaign => campaign.accountId === 'SIMULATED-ONLY'));
  assert.ok(demo.DEMO_POSITIONS.every(position => position.simulated));
});

test('rendered navigation has four workspaces, two Trading tabs and no recovery/planner switches', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const workspaceLabels = [...page.matchAll(/\["(Discover|Charts|Strategies|Trading)",/g)].map(match => match[1]);
  assert.deepEqual(workspaceLabels, ['Discover','Charts','Strategies','Trading']);
  assert.match(page, /Plan &amp; Position/);
  assert.match(page, />Journal<\/button>/);
  for (const forbidden of ['Original Planner','Current Planner','Review old tabs','Recovered views','Review: ','Local journal / review']) assert.equal(page.includes(forbidden), false, forbidden);
  assert.equal((page.match(/aria-label="Trading views"/g) ?? []).length, 1);
});

test('consolidated UI exposes persistence failure without overwriting and labels every demo execution surface', () => {
  const workspace = readFileSync(new URL('../app/TradingWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /Persistence blocked/);
  assert.match(workspace, /Existing records were not overwritten/);
  assert.match(workspace, /SIMULATED PREVIEW/);
  assert.match(workspace, /not broker confirmation/i);
  assert.match(workspace, /Unlinked IBKR Positions/);
});
