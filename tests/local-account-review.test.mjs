import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/local-account-review.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { localAccountReviewFromResponse, maskTypedAccount, exactSavedAccountCheckFromResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const safe = { selectionId: 'a'.repeat(32), candidates: [
  { index: 0, mask: 'DU••••56' }, { index: 1, mask: 'DU••••21' },
], paperIdentityVerified: false, reconciliationRequired: true, executionEnabled: false };

test('only a masked, locked local account review can reach Connect', () => {
  assert.deepEqual(localAccountReviewFromResponse(safe), {
    selectionId: safe.selectionId, candidates: safe.candidates,
  });
  for (const changed of [
    { ...safe, executionEnabled: true },
    { ...safe, paperIdentityVerified: true },
    { ...safe, reconciliationRequired: false },
    { ...safe, selectionId: 'short' },
    { ...safe, candidates: [] },
    { ...safe, candidates: [{ index: 1, mask: 'DU••••56' }] },
    { ...safe, candidates: [{ index: 0, mask: 'DU123456' }] },
  ]) assert.equal(localAccountReviewFromResponse(changed), null);
});

test('the typed value is compared to a mask without accepting malformed account IDs', () => {
  assert.equal(maskTypedAccount('DU123456'), 'DU••••56');
  assert.equal(maskTypedAccount('DU654321'), 'DU••••21');
  assert.equal(maskTypedAccount('DU 123456'), null);
  assert.equal(maskTypedAccount('du123456'), null);
});

test('uncertain confirmation readback requires exact account identity and continued submission lock', () => {
  const safe = { remembered: true, exactMatch: true, connectionVerified: false,
    reconciliationRequired: true, executionEnabled: false };
  assert.deepEqual(exactSavedAccountCheckFromResponse(safe), {
    remembered: true, exactMatch: true,
  });
  assert.deepEqual(exactSavedAccountCheckFromResponse({ ...safe, exactMatch: false }), {
    remembered: true, exactMatch: false,
  });
  for (const changed of [
    { ...safe, remembered: false },
    { ...safe, executionEnabled: true },
    { ...safe, connectionVerified: true },
    { ...safe, exactMatch: 'true' },
  ]) assert.equal(exactSavedAccountCheckFromResponse(changed), null);
});
