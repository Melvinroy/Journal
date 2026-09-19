import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/auth-ready.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { withAuthTimeout, readWithClockRetry } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

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

test('clock rejection retries a read once and preserves persistent rejection', async () => {
  let reads = 0, waits = 0;
  const rejected = { error: { message: 'JWT issued at future' } };
  const result = await readWithClockRetry(async () => { reads++; return rejected; }, () => true, async () => { waits++; });
  assert.equal(result, rejected); assert.equal(reads, 2); assert.equal(waits, 1);
});

test('clock recovery accepts only a successful server response and never retries expiry', async () => {
  let reads = 0;
  const result = await readWithClockRetry(async () => ++reads === 1 ? { error: { message: 'JWT issued at future' } } : { error: null, data: ['owned'] }, () => true, async () => {});
  assert.deepEqual(result.data, ['owned']);
  await readWithClockRetry(async () => { reads++; return { error: { message: 'JWT expired' } }; }, () => true, async () => assert.fail('Expiry is not clock skew'));
  assert.equal(reads, 3);
});

test('identity change during the delay cancels the second cloud read', async () => {
  let current = true, reads = 0;
  await readWithClockRetry(async () => { reads++; return { error: { message: 'JWT issued at future' } }; }, () => current, async () => { current = false; });
  assert.equal(reads, 1);
});
