import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const fixture = JSON.parse(readFileSync(new URL('../services/eod/fixtures/paper-domain-parity.json', import.meta.url)));
const source = readFileSync(new URL('../lib/trading-domain.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('server and browser use the same frozen whole-share allocation examples', () => {
  for (const item of fixture.allocations) assert.deepEqual(domain.allocateExitShares(item.quantity, item.percentages), item.expected);
});
test('server and browser freeze the same direction-aware risk reference', () => {
  for (const item of fixture.risk) assert.equal(domain.freezeRiskReference({ basis: 'Execution', direction: item.direction,
    entryPrice: item.entry, fixedStopPrice: item.stop, frozenAt: '2026-09-16T12:00:00Z' }).riskPerShare, item.expected);
});
