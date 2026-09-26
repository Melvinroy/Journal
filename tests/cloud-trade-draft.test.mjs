import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const acknowledgment = moduleUrl(readFileSync(new URL('../lib/cloud-write-acknowledgment.ts', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../lib/cloud-trade-draft.ts', import.meta.url), 'utf8').replace('"./cloud-write-acknowledgment"', JSON.stringify(acknowledgment));
const { readCloudDraft, saveCloudDraft, clearCloudDraft } = await import(moduleUrl(source));
const draft = {symbol:'TEST',side:'Long',setup:'Manual',trade_date:'2026-09-26',pnl:6,realized_r:1.5,dollar_risk:4,planned_r:2,grade:'A'};
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};

test('unconfirmed drafts survive another reader and remain scoped to their account', () => {
  const storage = memory();
  assert.deepEqual(readCloudDraft(storage, 'A'), {raw:null,draft:null});
  const receipt = saveCloudDraft(storage, 'A', draft, null);
  assert.deepEqual(readCloudDraft(storage, 'A'), {raw:receipt,draft});
  assert.equal(readCloudDraft(storage, 'B').draft, null);
  assert.equal(clearCloudDraft(storage, 'A', receipt), true);
  assert.equal(readCloudDraft(storage, 'A').draft, null);
});

test('old results cannot remove newer drafts, and stale readers cannot overwrite them', () => {
  const storage = memory();
  const old = saveCloudDraft(storage, 'A', draft, null);
  const latest = saveCloudDraft(storage, 'A', {...draft,symbol:'NEWER'}, old);
  assert.equal(clearCloudDraft(storage, 'A', old), false);
  assert.throws(() => saveCloudDraft(storage, 'A', draft, old), /changed/);
  assert.equal(readCloudDraft(storage, 'A').raw, latest);
});

test('unreadable and unavailable storage cannot silently discard recovery information', () => {
  const storage = memory();
  storage.setItem('brontide-cloud-trade-draft-v1:A', '{broken');
  assert.throws(() => readCloudDraft(storage, 'A'));
  assert.throws(() => saveCloudDraft(storage, 'A', draft, undefined));
  assert.equal(storage.getItem('brontide-cloud-trade-draft-v1:A'), '{broken');
  const denied = {getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
  assert.throws(() => readCloudDraft(denied, 'A'));
  assert.throws(() => saveCloudDraft(denied, 'A', draft, null));
  assert.equal(clearCloudDraft(denied, 'A', 'anything'), false);
});
