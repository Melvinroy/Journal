import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/workspace-state.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {updateWatchlist,readStored,writeStored,chartStorageKey,movingAverageByTime}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('watchlists normalize, deduplicate, reorder and remove',()=>{
 let rows=updateWatchlist([], 'nvda','add'); rows=updateWatchlist(rows,'NVDA','add'); assert.equal(rows.length,1);
 rows=updateWatchlist(rows,'MSFT','add'); rows=updateWatchlist(rows,'MSFT','up'); assert.equal(rows[0].symbol,'MSFT');
 assert.equal(updateWatchlist(rows,'NVDA','remove').length,1); assert.throws(()=>updateWatchlist(rows,'bad ticker','add'));
});
test('storage is versioned and rejects corrupt or future data',()=>{
 let data=null;const storage={getItem:()=>data,setItem:(_key,value)=>{data=value;}};
 assert.deepEqual(readStored(storage,'x',[]),[]); writeStored(storage,'x',[1]);assert.deepEqual(readStored(storage,'x',[]),[1]);
 data='{"version":2,"value":[]}';assert.throws(()=>readStored(storage,'x',[]));data='bad';assert.throws(()=>readStored(storage,'x',[]));
});
test('drawing storage separates instruments, modes and price bases',()=>{
 const c={symbol:'NVDA',mode:'local',adjustment:'all'};
 for(const patch of [{symbol:'MSFT'},{mode:'sample'},{adjustment:'raw'}])assert.notEqual(chartStorageKey(c),chartStorageKey({...c,...patch}));
});
test('moving average warmup remains invariant when rendering a selected range',()=>{
 const rows=Array.from({length:300},(_,i)=>({timestamp:i,close:i+1}));const values=movingAverageByTime(rows,[20,50,200]);
 assert.deepEqual(values.get(18),{});assert.equal(values.get(199).ma3,100.5);
 for(const size of [21,63,126,252])assert.equal(rows.slice(-size).map(r=>values.get(r.timestamp)).at(-1).ma3,200.5);
 assert.deepEqual(movingAverageByTime(rows.slice(0,250),[20,50,200]).get(249),values.get(249));
});
