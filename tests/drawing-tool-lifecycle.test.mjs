import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const loadTs = async path => {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
};

const { DRAWING_TOOLS } = await loadTs('../lib/drawing-tools.ts');
const { changeDrawings, decodeDrawings, drawingHistory, duplicateDrawing, travelDrawings, updateDrawings } = await loadTs('../lib/drawing-workspace.ts');

test('Select and Eraser action tools have explicit non-object lifecycle contracts', () => {
  const select = DRAWING_TOOLS.find(tool => tool.id === 'select');
  const eraser = DRAWING_TOOLS.find(tool => tool.id === 'eraser');
  assert.equal(select.overlay, undefined);
  assert.equal(eraser.overlay, '__eraser__');
  assert.notEqual(select.icon, eraser.icon);
});

for (const tool of DRAWING_TOOLS.filter(tool => tool.overlay && tool.overlay !== '__eraser__')) {
  test(`${tool.label}: complete saved-object lifecycle`, () => {
    const row = { id: `fixture-${tool.id}`, name: tool.overlay, points: [{ timestamp: 1, value: 100 }, { timestamp: 2, value: 105 }], lock: false, visible: true };
    let history = drawingHistory([]);

    const cancelled = changeDrawings(history, history.present);
    assert.equal(cancelled, history, 'cancel leaves no object or history action');

    history = changeDrawings(history, [row]);
    assert.equal(history.present.find(drawing => drawing.id === row.id)?.name, tool.overlay, 'create and select');

    history = changeDrawings(history, updateDrawings(history.present, [row.id], { points: [{ timestamp: 1, value: 101 }, { timestamp: 3, value: 109 }] }));
    assert.deepEqual(history.present[0].points, [{ timestamp: 1, value: 101 }, { timestamp: 3, value: 109 }], 'move and resize anchors');

    history = changeDrawings(history, updateDrawings(history.present, [row.id], { styles: { line: { color: '#123456', size: 3 } }, extendData: { fixture: true } }));
    assert.equal(history.present[0].styles.line.color, '#123456', 'style');
    assert.deepEqual(history.present[0].extendData, { fixture: true }, 'properties');

    history = changeDrawings(history, updateDrawings(history.present, [row.id], { lock: true, visible: false }));
    assert.equal(history.present[0].lock, true, 'lock');
    assert.equal(history.present[0].visible, false, 'hide');
    history = changeDrawings(history, updateDrawings(history.present, [row.id], { lock: false, visible: true }));

    const copyId = `${row.id}-copy`;
    history = changeDrawings(history, duplicateDrawing(history.present, row.id, copyId, tool.label));
    assert.equal(history.present.find(drawing => drawing.id === copyId)?.name, tool.overlay, 'duplicate');

    const beforeDelete = history.present;
    history = changeDrawings(history, history.present.filter(drawing => drawing.id !== row.id));
    assert.equal(history.present.some(drawing => drawing.id === row.id), false, 'delete');
    history = travelDrawings(history, 'undo');
    assert.deepEqual(history.present, beforeDelete, 'undo exact deletion');
    history = travelDrawings(history, 'redo');
    assert.equal(history.present.some(drawing => drawing.id === row.id), false, 'redo deletion');

    const restored = decodeDrawings(JSON.parse(JSON.stringify(beforeDelete)));
    assert.deepEqual(restored, beforeDelete, 'save, refresh and restore exact object');
  });
}
