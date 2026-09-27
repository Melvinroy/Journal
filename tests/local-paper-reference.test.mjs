import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/local-paper-reference.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { localPaperReferenceFromResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('a private paper reference displays only a mask and remains unverified', () => {
  assert.deepEqual(localPaperReferenceFromResponse({ recorded: true,
    accountMask: 'DU••••21', environment: 'paper', paperIdentityVerified: false,
    executionEnabled: false }), { kind: 'recorded', accountMask: 'DU••••21' });
});

test('missing, malformed or permissive references never look ready', () => {
  const missing = { recorded: false, accountMask: null, environment: null,
    paperIdentityVerified: false, executionEnabled: false };
  assert.deepEqual(localPaperReferenceFromResponse(missing), { kind: 'missing', accountMask: null });
  for (const changed of [
    { ...missing, recorded: true },
    { ...missing, accountMask: 'DU654321', environment: 'paper', recorded: true },
    { ...missing, accountMask: 'DU••••21', environment: 'live', recorded: true },
    { ...missing, paperIdentityVerified: true },
    { ...missing, executionEnabled: true },
  ]) assert.equal(localPaperReferenceFromResponse(changed), null);
});
