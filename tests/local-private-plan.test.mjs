import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/local-private-plan.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} });
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

const scopeId = 'a'.repeat(64);
const otherScope = 'b'.repeat(64);
const planId = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const scope = { scopeId, hasSavedPlan: false, environment: 'paper',
  executionEnabled: false, reviewEligible: false };
const receipt = { scopeId, planId, planRevision: revision,
  contentDigest: 'c'.repeat(64), executionEnabled: false, reviewEligible: false };
const savedPlan = { schemaVersion: 2, planId, planRevision: revision,
  capturedEntrySource: { source: 'Manual', observedAt: '2026-09-25T12:00:00Z' } };

test('private draft parser refuses an old scope, sample plan or execution permission', () => {
  assert.deepEqual(client.localPlanScopeFromResponse(scope), scope);
  assert.equal(client.localPlanScopeFromResponse({ ...scope, executionEnabled: true }), null);
  assert.equal(client.localPlanReceiptFromResponse(receipt, otherScope, planId, revision), null);
  assert.equal(client.localPlanReceiptFromResponse({ ...receipt, reviewEligible: true },
    scopeId, planId, revision), null);
  assert.deepEqual(client.localSavedPlanFromResponse({ ...receipt, savedPlan }, scopeId),
    { ...receipt, savedPlan });
  assert.equal(client.localSavedPlanFromResponse({ ...receipt,
    savedPlan: { ...savedPlan, origin: 'acceptance generator' } }, scopeId), null);
  assert.equal(client.localSavedPlanFromResponse({ ...receipt,
    savedPlan: { ...savedPlan, capturedEntrySource: { source: 'Simulated fixture' } } }, scopeId), null);
  assert.equal(client.localSavedPlanFromResponse({ ...receipt,
    savedPlan: { ...savedPlan, marketSnapshot: { status: 'sample', source: 'Simulated fixture' } } }, scopeId), null);
});

test('private draft calls stay same-origin and reject a changed save acknowledgement', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/status')) return Response.json(scope);
    if (url.endsWith('/current')) return Response.json({ ...receipt, savedPlan });
    return Response.json({ ...receipt, scopeId: otherScope });
  };
  try {
    assert.deepEqual(await client.readLocalPlanScope('csrf'), scope);
    assert.deepEqual(await client.readLatestLocalPlan('csrf', scopeId),
      { ...receipt, savedPlan });
    await assert.rejects(() => client.saveLocalPlan('csrf', scopeId, savedPlan, null, revision),
      /acknowledgement is invalid/);
    assert.deepEqual(requests.map(item => item.url), [
      '/v1/local/plans/status', '/v1/local/plans/current', '/v1/local/plans',
    ]);
    assert(requests.every(item => item.options.credentials === 'same-origin' &&
      item.options.headers['X-Brontide-CSRF'] === 'csrf'));
    const posted = JSON.parse(requests[2].options.body);
    assert.equal(posted.expectedScopeId, scopeId);
    assert.equal(posted.expectedRevision, null);
    assert.equal(posted.expectedActiveRevision, revision);
    assert.equal(posted.savedPlan.planId, planId);
    assert.equal('submit' in posted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('missing latest draft rechecks scope and sample drafts never reach the service', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(url);
    return url.endsWith('/current') ? new Response(null, { status: 404 })
      : Response.json({ ...scope, scopeId: otherScope });
  };
  try {
    await assert.rejects(() => client.readLatestLocalPlan('csrf', scopeId),
      /scope changed/);
    await assert.rejects(() => client.saveLocalPlan('csrf', scopeId,
      { ...savedPlan, origin: 'acceptance generator' }, null, null), /invalid/);
    await assert.rejects(() => client.saveLocalPlan('csrf', scopeId,
      { ...savedPlan, marketSnapshot: { status: 'sample' } }, null, null), /invalid/);
    await assert.rejects(() => client.saveLocalPlan('csrf', scopeId,
      savedPlan, null, 'not-a-revision'), /invalid/);
    assert.deepEqual(requests, ['/v1/local/plans/current', '/v1/local/plans/status']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
