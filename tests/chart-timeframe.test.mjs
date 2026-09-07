import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/chart-timeframe.ts',import.meta.url),'utf8').replace('import type { StudyBar } from "./drawing-workspace";','');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {aggregateWeeklyBars,rangeSizeForTimeframe,displayIndexForTimestamp}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const day=n=>Date.UTC(2026,0,n,12);
test('weekly aggregation uses first open, extremes, last close and summed volume',()=>{
 const rows=[
  {timestamp:day(5),open:10,high:12,low:9,close:11,volume:100},
  {timestamp:day(6),open:11,high:13,low:10,close:12,volume:150},
  {timestamp:day(9),open:12,high:14,low:8,close:13,volume:200},
  {timestamp:day(12),open:14,high:16,low:13,close:15,volume:300},
 ];
 const weeks=aggregateWeeklyBars(rows);assert.equal(weeks.length,2);assert.deepEqual(weeks[0],{timestamp:day(9),open:10,high:14,low:8,close:13,volume:450});
});
test('daily and weekly ranges and canonical timestamp mapping stay stable',()=>{
 assert.equal(rangeSizeForTimeframe('6M','1Day'),132);assert.equal(rangeSizeForTimeframe('6M','1Week'),27);
 const weeks=aggregateWeeklyBars([{timestamp:day(5),open:1,high:1,low:1,close:1,volume:1},{timestamp:day(9),open:1,high:1,low:1,close:1,volume:1},{timestamp:day(12),open:1,high:1,low:1,close:1,volume:1}]);
 assert.equal(displayIndexForTimestamp(day(6),weeks,'1Week'),0);assert.equal(displayIndexForTimestamp(day(12),weeks,'1Week'),1);
 assert.equal(displayIndexForTimestamp(day(6),weeks,'1Day'),-1);
});
