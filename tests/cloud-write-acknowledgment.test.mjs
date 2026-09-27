import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/cloud-write-acknowledgment.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {cloudWritesAcknowledged, createCloudRequestScope} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const row = {symbol:'TEST', side:'Long', setup:'Manual', trade_date:'2026-09-26', pnl:6, realized_r:1.5, dollar_risk:4, planned_r:2, grade:'A'};

test('acknowledgment requires each submitted record with a distinct persisted ID', () => {
  const second = {...row, symbol:'OTHER'};
  const records = [{...row,id:'one'}, {...second,id:'two'}];
  assert.equal(cloudWritesAcknowledged([row,second], records), true);
  assert.equal(cloudWritesAcknowledged([row,second], records.toReversed()), true);
  assert.equal(cloudWritesAcknowledged([row], [{...row,id:'one',pnl:'6.00'}]), true);
  for (const bad of [null,[],[records[0]], [records[0],records[0]], [{...row,id:'one'}, {...row,id:'two'}],
    [{...row,id:'one'}, {...second,id:''}], [{...row,id:'one'}, {...second,id:'two',pnl:'garbage'}]]) {
    assert.equal(cloudWritesAcknowledged([row,second],bad), false);
  }
});

test('delayed results from an earlier account or a later session of the same account cannot apply', () => {
  const scope = createCloudRequestScope();
  const accountA = scope.capture();
  assert.equal(accountA(), true);
  scope.advance(); // A -> B
  const accountB = scope.capture();
  assert.equal(accountA(), false);
  scope.advance(); // B -> A
  const laterA = scope.capture();
  assert.equal(accountA(), false);
  assert.equal(accountB(), false);
  assert.equal(laterA(), true);
  scope.advance(); // new authentication generation for A
  assert.equal(laterA(), false);
});
