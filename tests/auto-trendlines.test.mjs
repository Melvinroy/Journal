import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/auto-trendlines.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {findAutoTrends,confirmedPivots,trendATR,validTrendSettings,AUTO_TREND_VERSION,projectTrendPoints,restoreTrendPoints}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const bars=(length=160)=>Array.from({length},(_,i)=>{const wave=Math.cos(i*Math.PI/6);return {timestamp:1700000000000+i*86400000,open:100,close:100,high:102+wave,low:98+wave};});

test('hand-worked horizontal channel has confirmed support and resistance, no violations',()=>{
 const rows=bars(), lines=findAutoTrends(rows);
 assert.equal(lines.length,2);
 for(const line of lines){assert.ok(line.touches>=3);assert.equal(line.violations,0);assert.ok(line.fitATR<1e-12);assert.ok(line.evaluatedAt<=rows.at(-1).timestamp);}
 assert.equal(lines[0].points[0].value,103);assert.equal(lines[1].points[0].value,97);
 assert.equal(lines[0].touches,10);
 assert.deepEqual(lines[0].points.map(p=>p.timestamp),[rows[48].timestamp,rows[60].timestamp]);
 assert.equal(lines[0].evaluatedAt,rows[159].timestamp);
 assert.deepEqual(findAutoTrends(rows),lines);
});
test('as-of results cannot see later bars even when later history radically changes',()=>{
 const rows=bars(260), cutoff=rows[150].timestamp, expected=findAutoTrends(rows.slice(0,151));
 assert.deepEqual(findAutoTrends(rows,{asOf:cutoff}),expected);
 const changed=rows.map((r,i)=>i>150?{...r,open:500,close:500,high:600,low:400}:r);
 assert.deepEqual(findAutoTrends(changed,{asOf:cutoff}),expected);
});
test('pivot becomes available only after three following sessions; equal plateau selects first',()=>{
 const rows=bars(40), timestamp=rows[27].timestamp;
 assert.equal(confirmedPivots(rows.slice(0,27)).some(p=>p.index===24),false);
 assert.equal(confirmedPivots(rows.slice(0,28)).find(p=>p.index===24&&p.kind==='resistance').confirmedAt,timestamp);
 rows[25].high=rows[24].high;
 const pivots=confirmedPivots(rows);
 assert.ok(pivots.some(p=>p.index===24&&p.kind==='resistance'));
 assert.ok(!pivots.some(p=>p.index===25&&p.kind==='resistance'));
});
test('Wilder ATR seeds 14 ranges and carries full-history warmup',()=>{
 const rows=bars(180), atr=trendATR(rows);
 assert.ok(Number.isNaN(atr[12]));assert.equal(atr[13],4);assert.equal(atr[179],4);
 rows[0].high=130;
 const warmed=trendATR(rows);assert.ok(warmed[60]>4);
 assert.notEqual(warmed[60],trendATR(rows.slice(40))[20]);
 assert.equal(warmed[60],trendATR(rows.slice(0,61))[60]);
});
test('three closing breaks invalidate resistance, and short or flat input yields no line',()=>{
 const rows=bars();
 for(let i=157;i<160;i++)rows[i]={...rows[i],open:110,close:110,high:111,low:109};
 assert.ok(!findAutoTrends(rows).some(l=>l.kind==='resistance'));
 assert.deepEqual(findAutoTrends(bars(15)),[]);
 assert.deepEqual(findAutoTrends(bars(40)),[]); // Only two warmed, confirmed pivots per side.
 assert.deepEqual(findAutoTrends(bars().map(r=>({...r,high:101,low:99}))),[]);
});
test('log-price model is deterministic and causal; malformed chronological input fails',()=>{
 const rows=bars().map((r,i)=>Object.fromEntries(Object.entries(r).map(([key,value])=>[key,key==='timestamp'?value:value*Math.exp(i*.001)])));
 assert.equal(findAutoTrends(rows,{logarithmic:true}).length,2);
 const cutoff=rows[140].timestamp;
 assert.deepEqual(findAutoTrends(rows,{logarithmic:true,asOf:cutoff}),findAutoTrends(rows.slice(0,141),{logarithmic:true}));
 assert.throws(()=>findAutoTrends([...rows].reverse()));assert.throws(()=>findAutoTrends([...rows,rows.at(-1)]));
 assert.throws(()=>findAutoTrends(rows.map((r,i)=>i===4?{...r,low:-1}:r)));
});
test('saved edits and deletion tombstones roundtrip and invalid records cannot overwrite them',()=>{
 const id=`${AUTO_TREND_VERSION}:support:1:2`, state={enabled:true,edits:{[id]:[{timestamp:1,value:97},{timestamp:2,value:98}],[id+'0']:null}};
 assert.ok(validTrendSettings(JSON.parse(JSON.stringify(state))));
 for(const bad of [null,[],{enabled:true,edits:[]},{enabled:true,edits:{unknown:null}}, {...state,edits:{[id]:[{timestamp:2,value:97},{timestamp:1,value:98}]}}])assert.equal(validTrendSettings(bad),false);
});
test('range projection preserves trading-session slope across weekends and edit roundtrips',()=>{
 const rows=bars(160).map((r,i)=>({...r,timestamp:r.timestamp+Math.floor(i/5)*2*86400000}));
 const points=[{timestamp:rows[50].timestamp,value:100},{timestamp:rows[100].timestamp,value:105}];
 for(const size of [22,66,132,160]){
   const projected=projectTrendPoints(points,rows,size);
   assert.equal(projected[1].dataIndex-projected[0].dataIndex,50);
   assert.deepEqual(restoreTrendPoints(projected,rows,size),points);
 }
 assert.throws(()=>restoreTrendPoints([{dataIndex:999,value:100},{dataIndex:1000,value:101}],rows,22));
 assert.throws(()=>projectTrendPoints([{timestamp:0,value:100}],rows,22));
});
