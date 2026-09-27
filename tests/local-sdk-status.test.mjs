import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/local-sdk-status.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { localSdkMetadataFromResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const known = {
  metadataStatus: 'metadata-present-unverified', reportedVersion: '10.50.2',
  reportedProtobufPin: '5.29.5', knownDependencyAdvisory: 'GHSA-7gcm-g887-7qv7',
  officialOriginVerified: false, dependencyCompatible: null, executionEnabled: false,
};

test('known advisory metadata remains diagnostic and execution locked', () => {
  assert.equal(localSdkMetadataFromResponse(known)?.knownDependencyAdvisory,
    'GHSA-7gcm-g887-7qv7');
  assert.equal(localSdkMetadataFromResponse({ ...known,
    reportedProtobufPin: '5.29.6', knownDependencyAdvisory: null,
  })?.knownDependencyAdvisory, null);
  for (const pin of ['5.29.3', '6.30.0', '6.33.4']) {
    assert.equal(localSdkMetadataFromResponse({ ...known,
      reportedProtobufPin: pin,
    })?.knownDependencyAdvisory, 'GHSA-7gcm-g887-7qv7');
  }
  for (const pin of ['5.29.6', '6.29.9', '6.33.5']) {
    assert.equal(localSdkMetadataFromResponse({ ...known,
      reportedProtobufPin: pin, knownDependencyAdvisory: null,
    })?.knownDependencyAdvisory, null);
  }
});

test('malformed or permissive dependency reports are unavailable', () => {
  for (const changed of [
    { ...known, knownDependencyAdvisory: null },
    { ...known, reportedProtobufPin: '5.29.6' },
    { ...known, knownDependencyAdvisory: 'operator/private' },
    { ...known, executionEnabled: true },
    { ...known, officialOriginVerified: true },
    { ...known, dependencyCompatible: true },
  ]) assert.equal(localSdkMetadataFromResponse(changed), null);
});
