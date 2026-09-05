import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/auth-ready.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { withAuthTimeout } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('auth readiness falls back when session lookup rejects', async () => {
  const fallback = { data: { session: null }, error: null };
  const result = await withAuthTimeout(Promise.reject(new Error('network unavailable')), 1000, fallback);
  assert.equal(result, fallback);
});

test('auth readiness falls back when session lookup stalls', async () => {
  const fallback = { data: { session: null }, error: null };
  const result = await withAuthTimeout(new Promise(() => {}), 5, fallback);
  assert.equal(result, fallback);
});

test('auth readiness preserves successful session lookup', async () => {
  const success = { data: { session: { user: { id: 'u1' } } }, error: null };
  const fallback = { data: { session: null }, error: null };
  const result = await withAuthTimeout(Promise.resolve(success), 1000, fallback);
  assert.equal(result, success);
});
