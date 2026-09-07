import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/drawing-tools.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const registry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('canonical registry has eight fixed groups and 29 unique tools, labels, and icons', () => {
  assert.equal(registry.assertDrawingRegistry(), true);
  assert.equal(registry.DRAWING_GROUPS.length, 8);
  assert.equal(registry.DRAWING_TOOLS.length, 29);
  for (const tool of registry.DRAWING_TOOLS) assert.equal(registry.DRAWING_TOOLS.filter(row => row.id === tool.id).length, 1);
});

test('every approved tool has one owner and favourites sort only inside that group', () => {
  for (const tool of registry.DRAWING_TOOLS) assert.equal(registry.toolsForGroup(tool.groupId, [], false).filter(row => row.id === tool.id).length, 1);
  const lines = registry.toolsForGroup('lines', ['horizontalRay']);
  assert.equal(lines[0].id, 'horizontalRay');
  assert.equal(lines.filter(row => row.id === 'horizontalRay').length, 1);
  assert.ok(lines.every(row => row.groupId === 'lines'));
});

test('legacy favourites and snap state migrate without changing old keys', () => {
  const migrated = registry.migrateDrawingPreferences(undefined, ['segment', 'horizontalRay', 'box', 'rangeMeasure'], true);
  assert.deepEqual(migrated.favorites, ['trendLine', 'horizontalRay', 'rectangle', 'priceRange']);
  assert.equal(migrated.snap, 'strong');
  assert.equal(migrated.lastUsed.lines, 'trendLine');
  assert.equal(registry.migrateDrawingPreferences(undefined, [], undefined).snap, 'weak');
  assert.equal(registry.migrateDrawingPreferences(undefined, [], false).snap, 'off');
});

test('unapproved legacy tools remain labelled for saved-object recovery but cannot be created', () => {
  const legacy = ['horizontalSegment', 'verticalRayLine', 'verticalSegment', 'priceLine'];
  for (const overlay of legacy) {
    assert.ok(registry.drawingToolLabelForOverlay(overlay) !== overlay);
    assert.equal(registry.DRAWING_TOOLS.some(tool => tool.overlay === overlay), false);
  }
});

test('incomplete approved tools belong to the registry but stay out of creation flyouts', () => {
  const planned = registry.DRAWING_TOOLS.filter(tool => tool.id !== 'select' && !tool.overlay);
  assert.deepEqual(planned.map(tool => tool.id), ['eraser', 'infoLine', 'flatChannel', 'fibExtension', 'datePriceRange', 'highlighter', 'text', 'callout']);
  for (const group of registry.DRAWING_GROUPS) assert.ok(registry.toolsForGroup(group.id, []).every(tool => tool.id === 'select' || tool.overlay));
});
