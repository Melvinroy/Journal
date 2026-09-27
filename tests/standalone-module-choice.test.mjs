import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/standalone-module.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { localModuleStatusFromResponse, standaloneViewEnabled } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('the local module status remains a view preference and never enables execution', () => {
  const both = { enabledViews: ['trading', 'journal'], canHideTrading: true,
    executionEnabled: false };
  assert.deepEqual(localModuleStatusFromResponse(both), {
    enabledViews: ['trading', 'journal'], canHideTrading: true,
  });
  assert.equal(standaloneViewEnabled('Connect', ['journal']), true);
  assert.equal(standaloneViewEnabled('Trade', ['journal']), false);
  assert.equal(standaloneViewEnabled('Journal', ['journal']), true);
  assert.equal(standaloneViewEnabled('Trade', ['trading']), true);
  assert.equal(standaloneViewEnabled('Journal', ['trading']), false);
});

test('malformed or permissive module status exposes no saved choice', () => {
  const status = { enabledViews: ['trading', 'journal'], canHideTrading: true,
    executionEnabled: false };
  for (const changed of [
    { ...status, executionEnabled: true },
    { ...status, enabledViews: [] },
    { ...status, enabledViews: ['trading', 'trading'] },
    { ...status, enabledViews: ['journal', 'trading'] },
    { ...status, enabledViews: ['charts'] },
    { ...status, enabledViews: ['journal'], canHideTrading: false },
    { ...status, canHideTrading: 'yes' },
  ]) assert.equal(localModuleStatusFromResponse(changed), null);
});
