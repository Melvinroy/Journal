import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../lib/drawing-workspace.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decodeDrawings, drawingHistory, changeDrawings, travelDrawings, duplicateDrawing, reorderDrawing, updateDrawings, riskReward, riskRewardDetails, dateMeasurement, priceDateMeasurement, contractions, contractionMetrics, anchoredVWAP, anchoredVWAPBands, regressionChannel, drawingEvidence } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const day = 86400000;
const bars = [0, 1, 4, 5, 6, 7].map((d, i) => ({ timestamp: Date.UTC(2026, 8, 3) + d * day, high: 10 + i * 2, low: 10 + i * 2, close: 10 + i * 2, volume: i ? 300 : 100 }));
const anchors = (first, last) => [{ timestamp: bars[first].timestamp, value: 10 }, { timestamp: bars[last].timestamp, value: 20 }];
const original = { id: 'old', name: 'segment', points: anchors(0, 2) };
test('version-1 migration preserves identifiers, notes, locks, hidden state, geometry and styles', () => {
  const data = decodeDrawings([{ ...original, extendData: 'note', lock: true, visible: false, styles: { line: { color: '#123456' } } }]);
  assert.equal(data[0].id, 'old'); assert.equal(data[0].extendData, 'note'); assert.equal(data[0].lock, true); assert.equal(data[0].visible, false);
  assert.deepEqual(data[0].points, original.points); assert.equal(data[0].styles.line.color, '#123456');
  assert.deepEqual(decodeDrawings([original])[0], { ...original, lock: false, visible: true });
  assert.equal(decodeDrawings([{ ...original, id: undefined }])[0].id, 'legacy-0-segment');
});
test('corrupt and duplicate saved records are rejected instead of overwritten', () => {
  for (const data of [{}, [null], [{name:'x', points:[]}], [{...original, points:[1]}], [{...original,points:[{}]}], [{...original, points:[{value:Infinity}]}], [original, original]]) assert.throws(() => decodeDrawings(data));
});
test('create, edit, lock, hide, delete and clear undo atomically; redo restores exact geometry and style', () => {
  const row = decodeDrawings([original])[0]; let h = drawingHistory([]);
  const states = [[row], [{ ...row, lock:true }], [{ ...row, lock:true, visible:false }], []];
  for (const rows of states) h = changeDrawings(h, rows);
  for (let i=states.length-2; i>=0; i--) { h=travelDrawings(h,'undo'); assert.deepEqual(h.present, states[i]); }
  h=travelDrawings(h,'undo'); assert.deepEqual(h.present, []);
  for (const rows of states) { h=travelDrawings(h,'redo'); assert.deepEqual(h.present, rows); }
  h=travelDrawings(h,'undo'); h=changeDrawings(h,[{...row,points:anchors(1,3)}]); assert.equal(h.future.length,0);
  assert.deepEqual(original.points,anchors(0,2));
});
test('no-op edits retain redo and history is bounded', () => {
  let h=drawingHistory([]); assert.equal(changeDrawings(h,[]),h);
  for(let i=0;i<70;i++) h=changeDrawings(h,[{...decodeDrawings([original])[0],id:String(i)}]);
  assert.equal(h.past.length,70); assert.equal(travelDrawings(drawingHistory([]),'undo').past.length,0);
});
test('history keeps 100 actions and shared object actions are exact and non-destructive', () => {
  let h=drawingHistory([]); for(let i=0;i<130;i++) h=changeDrawings(h,[{...decodeDrawings([original])[0],id:String(i)}]);
  assert.equal(h.past.length,100);
  const a={...decodeDrawings([original])[0],displayName:'Pivot'};
  const b={...a,id:'two',displayName:'Support'};
  const copied=duplicateDrawing([a,b],a.id,'copy');
  assert.deepEqual(copied.map(row=>row.id),['old','copy','two']); assert.equal(copied[1].displayName,'Pivot copy'); assert.equal(copied[1].lock,false);
  assert.deepEqual(reorderDrawing(copied,'copy',1).map(row=>row.id),['old','two','copy']);
  const updated=updateDrawings(copied,['old','two'],{visible:false,id:'unsafe',name:'unsafe'});
  assert.equal(updated[0].visible,false); assert.equal(updated[2].visible,false); assert.equal(updated[0].id,'old'); assert.equal(updated[0].name,'segment');
  assert.equal(duplicateDrawing([a],a.id,a.id)[0],a); assert.equal(reorderDrawing([a],a.id,-1)[0],a);
});
test('long position gives 2R for entry 100, stop 95, target 110', () => {
  assert.deepEqual(riskReward([100,95,110].map(value=>({value}))),{risk:5,reward:10,ratio:2});
  for (const values of [[100,100,110],[100,105,110],[100,95,90],[0,-5,10],[100,NaN,110]]) assert.throws(()=>riskReward(values.map(value=>({value}))));
});
test('long risk/reward reports percentages, three targets and optional position size',()=>{
  const r=riskRewardDetails([100,95,110].map(value=>({value})),{targets:[115,120,115],accountSize:10000,riskPercent:1});
  assert.equal(r.stopPercent,5); assert.equal(r.allowedRisk,100); assert.equal(r.shares,20);
  assert.deepEqual(r.targets,[110,115,120]); assert.deepEqual(r.rewards.map(row=>row.ratio),[2,3,4]);
  assert.equal(riskRewardDetails([100,95,110].map(value=>({value}))).shares,undefined);
});
test('date measurement counts loaded sessions inclusively and calendar weekends separately', () => {
  assert.deepEqual(dateMeasurement(anchors(0,2),bars),{sessions:3,intervals:2,days:4});
  assert.throws(()=>dateMeasurement(anchors(2,0),bars)); assert.throws(()=>dateMeasurement([{timestamp:1},anchors(0,2)[1]],bars));
});
test('combined price/date measurement reports exact price, percentage, bars and dates',()=>{
  assert.deepEqual(priceDateMeasurement(anchors(0,2),bars),{start:10,end:20,change:10,percent:100,sessions:3,intervals:2,days:4});
  assert.throws(()=>priceDateMeasurement([{...anchors(0,2)[0],value:0},anchors(0,2)[1]],bars));
});
test('manual contractions expose 20%, 10%, 5% without inventing a setup signal', () => {
  const points=[100,80,100,90,100,95].map((value,i)=>({timestamp:bars[i].timestamp,value}));
  assert.deepEqual(contractions(points,bars),{depths:[20,10,5],tightening:true});
  assert.equal(contractions(points.map((p,i)=>i===5?{...p,value:70}:p),bars).tightening,false);
  assert.throws(()=>contractions(points.slice(0,4),bars));
  assert.throws(()=>contractions(points.map((p,i)=>i===1?{...p,timestamp:bars[0].timestamp}:p),bars));
});
test('two-to-five manual contraction pairs report duration, relative depth and deterministic labels',()=>{
  const points=[100,80,100,90,100,95].map((value,i)=>({timestamp:bars[i].timestamp,value}));
  const r=contractionMetrics(points,bars); assert.deepEqual(r.pairs.map(row=>row.label),['C1','C2','C3']);
  assert.deepEqual(r.pairs.map(row=>row.sessions),[2,2,2]); assert.equal(r.pairs[1].relativeToPrevious,.5); assert.equal(r.pairs[2].relativeToPrevious,.5); assert.equal(r.tightening,true);
  assert.deepEqual(contractionMetrics(points.slice(0,4),bars).pairs.map(row=>row.label),['C1','C2']);
  const fivePairs=Array.from({length:5},(_,index)=>[
    {timestamp:Date.UTC(2026,8,14+index*2),value:100},
    {timestamp:Date.UTC(2026,8,15+index*2),value:80+index*4},
  ]).flat();
  const fiveBars=Array.from({length:10},(_,index)=>({timestamp:Date.UTC(2026,8,14+index),high:100,low:80,close:90,volume:100}));
  assert.deepEqual(contractionMetrics(fivePairs,fiveBars).pairs.map(row=>row.label),['C1','C2','C3','C4','C5']);
  assert.throws(()=>contractionMetrics(points.slice(0,2),bars)); assert.throws(()=>contractionMetrics([...points,...points],bars));
});
test('anchored daily VWAP weights typical price by volume, excluding earlier history', () => {
  const rows=[{timestamp:1,high:12,low:8,close:10,volume:100},{timestamp:2,high:14,low:10,close:12,volume:300}];
  assert.deepEqual(anchoredVWAP(1,rows),[{timestamp:1,value:10},{timestamp:2,value:11.5}]);
  assert.equal(anchoredVWAP(2,rows)[0].value,12);
  assert.throws(()=>anchoredVWAP(1,[{...rows[0],volume:undefined}]));
  assert.equal(anchoredVWAP(1,[{...rows[0],volume:0}])[0].value,undefined);
  assert.throws(()=>anchoredVWAP(3,rows));
});
test('anchored VWAP bands use cumulative volume-weighted population deviation',()=>{
  const rows=[{timestamp:1,high:12,low:8,close:10,volume:100},{timestamp:2,high:14,low:10,close:12,volume:300}];
  const last=anchoredVWAPBands(1,rows).at(-1); assert.equal(last.value,11.5); assert.ok(Math.abs(last.deviation-Math.sqrt(.75))<1e-12);
  assert.equal(last.upper1,last.value+last.deviation); assert.equal(last.lower2,last.value-2*last.deviation);
});
test('regression uses session indices, fixed sample range, and population residual deviation', () => {
  const exact=regressionChannel(anchors(0,5),bars); assert.equal(exact.slope,2); assert.equal(exact.sigma,0); assert.equal(exact.series.at(-1).value,20);
  const noisy=[2,1,4].map((close,i)=>({...bars[i],close}));
  const r=regressionChannel(anchors(0,2),noisy); assert.equal(r.slope,1); assert.ok(Math.abs(r.sigma-Math.sqrt(8/9))<1e-10);
  assert.equal(r.period,3); assert.ok(Math.abs(r.rSquared-3/7)<1e-12);
  assert.deepEqual(regressionChannel(anchors(0,2),bars),regressionChannel(anchors(0,2),bars.slice(0,3)));
  assert.throws(()=>regressionChannel(anchors(0,1),bars));
});
test('unavailable evidence is explicit for missing history, invalid risk and zero volume', () => {
  assert.match(drawingEvidence({name:'brontide-vwap',points:[{timestamp:0}]},bars),/^Unavailable:/);
  assert.match(drawingEvidence({name:'brontide-position',points:[{value:0}]},bars),/^Unavailable:/);
  assert.match(drawingEvidence({name:'brontide-measure',points:[{value:0},{value:2}]},bars),/^Unavailable:/);
});
