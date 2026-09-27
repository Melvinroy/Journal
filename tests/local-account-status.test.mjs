import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/local-account-status.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { rememberedChoiceFromResponse } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('a remembered paper choice displays only its mask and never implies connection', () => {
  assert.deepEqual(rememberedChoiceFromResponse({ remembered: true, environment: 'paper',
    accountMask: 'U1••••56', connectionVerified: false, reconciliationRequired: true,
    executionEnabled: false }), { kind: 'remembered', accountMask: 'U1••••56' });
});

test('an unbound profile is distinguishable from malformed or permissive status', () => {
  const unbound = { remembered: false, environment: null, accountMask: null,
    connectionVerified: false, reconciliationRequired: true, executionEnabled: false };
  assert.deepEqual(rememberedChoiceFromResponse(unbound), { kind: 'unbound', accountMask: null });
  for (const changed of [
    { ...unbound, environment: 'paper' },
    { ...unbound, connectionVerified: true },
    { ...unbound, executionEnabled: true },
    { ...unbound, remembered: true, environment: 'live', accountMask: 'U1••••56' },
    { ...unbound, remembered: true, environment: 'paper', accountMask: 'U123456' },
    { ...unbound, remembered: true, environment: 'paper', accountMask: '****1234' },
  ]) assert.equal(rememberedChoiceFromResponse(changed), null);
});
