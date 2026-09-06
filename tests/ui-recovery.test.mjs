import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function load(name) {
  const source=readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const {findRecentTrends}=await load('recent-trendlines');
const {projectTrendPoints}=await load('auto-trendlines');
const {demoStorageKey,SAMPLE_PLANS,getSampleResearchJson,sampleResearchRun}=await load('review-demo');
const {position,validatePlans}=await load('trading-ledger');
const history=Array.from({length:160},(_,i)=>{
  const center=100+i*.12+Math.sin(i*Math.PI/10)*3;
  return {timestamp:Date.UTC(2026,0,1+i),open:center,high:center+1,low:center-1,close:center+.2};
});

test('original trend algorithm retains qualifying, confirmed historical anchors',()=>{
  const lines=findRecentTrends(history);
  assert.ok(lines.length>0);
  for(const line of lines) {
    assert.ok(line.touches>=2);
    assert.ok(line.points[0].timestamp<line.points[1].timestamp);
    assert.ok(line.points[1].timestamp<=history.at(-6).timestamp);
  }
});
test('original trend slopes survive offscreen anchor projection for each range',()=>{
  for(const line of findRecentTrends(history)) {
    const slopes=[22,66,132,160].map(count=>{
      const [a,b]=projectTrendPoints(line.points,history,count);
      return (b.value-a.value)/(b.dataIndex-a.dataIndex);
    });
    assert.ok(slopes.every(s=>s===slopes[0]));
  }
});
test('original trend uses only supplied as-of history, supports log, rejects bad data',()=>{
  const cutoff=history[119].timestamp;
  const truncated=history.filter(bar=>bar.timestamp<=cutoff);
  assert.deepEqual(findRecentTrends(truncated),findRecentTrends([...truncated,...history.slice(120)].filter(bar=>bar.timestamp<=cutoff)));
  assert.ok(findRecentTrends(history,true).every(line=>line.points.every(point=>point.value>0)));
  assert.deepEqual(findRecentTrends(history.slice(0,10)),[]);
  assert.throws(()=>findRecentTrends([...history,history[0]]),/Invalid/);
  assert.throws(()=>findRecentTrends([{...history[0],close:NaN}]),/Invalid/);
});
test('sample plans reconcile and all demo writes have separate keys',()=>{
  assert.equal(validatePlans(SAMPLE_PLANS),true);
  assert.equal(position(SAMPLE_PLANS[0]).remaining,0);
  assert.equal(position(SAMPLE_PLANS[1]).remaining,10);
  assert.equal(position(SAMPLE_PLANS[1]).realized,48);
  for(const key of ['brontide-plans-v1','brontide-plan-editor-v1','journal.trade-planner.draft.v1']) {
    assert.equal(demoStorageKey(key,false),key);
    assert.notEqual(demoStorageKey(key,true),key);
  }
});
test('sample research never fetches private data and preserves zero-match sessions',async(t)=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('No network allowed');});
  const signal=new AbortController().signal;
  const {runs}=await getSampleResearchJson('/v1/research/runs?kind=scan',signal);
  assert.equal(runs[0].manifest.source,'synthetic');
  assert.equal(runs[0].sessions[0].candidates,0);
  assert.equal((await getSampleResearchJson('/v1/research/runs/sample-scan-v1/rows?session=2026-09-01',signal)).total,0);
  assert.equal((await getSampleResearchJson('/v1/research/runs/sample-scan-v1/rows?symbol=NVDA',signal)).total,1);
  const run=sampleResearchRun('backtest');
  assert.equal(run.summary.expectancy_r,run.rows.reduce((sum,row)=>sum+row.outcome_r,0)/run.rows.length);
  const sorted=await getSampleResearchJson('/v1/research/runs/sample-backtest-v1/rows?sort=outcome_r&descending=true',signal);
  assert.deepEqual(sorted.rows.map(row=>row.outcome_r),[2,-1]);
  const controller=new AbortController();controller.abort();
  await assert.rejects(getSampleResearchJson('/v1/research/runs',controller.signal));
});
