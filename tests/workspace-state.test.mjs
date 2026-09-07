import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/workspace-state.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {updateWatchlist,readStored,writeStored,chartStorageKey,legacyChartStorageKey,readDrawingDocument,writeDrawingDocument,drawingStorageContext,movingAverageByTime}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
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
 assert.equal(chartStorageKey({...c,symbol:'nvda'}),chartStorageKey(c));
 assert.equal(drawingStorageContext(chartStorageKey(c)).adjustmentBasis,'split-dividend-adjusted');
});
test('drawing v2 migrates v1 without deleting it and verifies writes',()=>{
 const context={symbol:'NVDA',mode:'local',adjustment:'all'}, key=chartStorageKey(context), legacy=legacyChartStorageKey(context);
 const values=new Map([[legacy,JSON.stringify({version:1,value:[{id:'a',name:'segment',points:[{timestamp:1,value:50}],lock:false,visible:true}]})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const loaded=readDrawingDocument(storage,key,[]);assert.equal(loaded.migrated,true);assert.equal(loaded.raw,null);assert.equal(loaded.value[0].points[0].value,50);
 const raw=writeDrawingDocument(storage,key,loaded.value,123);assert.equal(storage.getItem(key),raw);assert.ok(storage.getItem(legacy));
 const restored=readDrawingDocument(storage,key,[]);assert.equal(restored.migrated,false);assert.equal(restored.value[0].id,'a');
});
test('drawing v2 rejects context mismatch, future schema, and unverifiable storage',()=>{
 const key=chartStorageKey({symbol:'NVDA',mode:'local',adjustment:'raw'}), values=new Map();
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 writeDrawingDocument(storage,key,[],123);
 const document=JSON.parse(values.get(key));document.context.symbol='MSFT';values.set(key,JSON.stringify(document));assert.throws(()=>readDrawingDocument(storage,key,[]));
 document.context.symbol='NVDA';document.version=3;values.set(key,JSON.stringify(document));assert.throws(()=>readDrawingDocument(storage,key,[]));
 const failed={getItem:()=>null,setItem:()=>{}};assert.throws(()=>writeDrawingDocument(failed,key,[1],123));
});
test('corporate-action coordinate fixture keeps raw and adjusted bases isolated',()=>{
 const rawKey=chartStorageKey({symbol:'SPLT',mode:'local',adjustment:'raw'}), adjustedKey=chartStorageKey({symbol:'SPLT',mode:'local',adjustment:'all'}), values=new Map();
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}, timestamp=Date.UTC(2026,0,2);
 writeDrawingDocument(storage,rawKey,[{id:'raw',name:'segment',points:[{timestamp,value:100}],lock:false,visible:true}],1);
 writeDrawingDocument(storage,adjustedKey,[{id:'adjusted',name:'segment',points:[{timestamp,value:50}],lock:false,visible:true}],1);
 assert.equal(readDrawingDocument(storage,rawKey,[]).value[0].points[0].value,100);
 assert.equal(readDrawingDocument(storage,adjustedKey,[]).value[0].points[0].value,50);
 assert.equal(drawingStorageContext(rawKey).adjustmentBasis,'raw');assert.equal(drawingStorageContext(adjustedKey).adjustmentBasis,'split-dividend-adjusted');
});
test('moving average warmup remains invariant when rendering a selected range',()=>{
 const rows=Array.from({length:300},(_,i)=>({timestamp:i,close:i+1}));const values=movingAverageByTime(rows,[20,50,200]);
 assert.deepEqual(values.get(18),{});assert.equal(values.get(199).ma3,100.5);
 for(const size of [21,63,126,252])assert.equal(rows.slice(-size).map(r=>values.get(r.timestamp)).at(-1).ma3,200.5);
 assert.deepEqual(movingAverageByTime(rows.slice(0,250),[20,50,200]).get(249),values.get(249));
});
