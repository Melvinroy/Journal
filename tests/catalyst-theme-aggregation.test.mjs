import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const reportsUrl=`data:text/javascript;base64,${Buffer.from(compile('../lib/catalyst-reports.ts')).toString('base64')}`;
const themeJs=compile('../lib/catalyst-theme-aggregation.ts').replace('"./catalyst-reports"',`"${reportsUrl}"`);
const {aggregateThemes,candidateThemeReports,themeWindow,usSessionWindow}=await import(`data:text/javascript;base64,${Buffer.from(themeJs).toString('base64')}`);

const report=(id,type,date,published,extra={})=>({id,report_type:type,trading_date_checked:date,generated_at_sgt:published,published_at:published,...extra});

test('range windows use US sessions and skip the Labor Day boundary',()=>{
  const selected=report('p','Premarket','2026-09-08','2026-09-08T12:00:00Z');
  assert.deepEqual(usSessionWindow('2026-09-08',3),['2026-09-03','2026-09-04','2026-09-08']);
  assert.deepEqual(themeWindow(selected,'3d').sessions,['2026-09-03','2026-09-04','2026-09-08']);
});

test('broader ranges stop at the selected report as-of and preserve all report types',()=>{
  const selected=report('pre-new','Premarket','2026-09-08','2026-09-08T12:00:00Z');
  const reports=[selected,report('post','Postmarket','2026-09-04','2026-09-05T00:30:00Z'),report('week','Weekend Summary','2026-09-08','2026-09-06T12:30:00Z',{coverage_start:'2026-09-03',coverage_end:'2026-09-06'}),report('future','Premarket','2026-09-08','2026-09-08T13:00:00Z')];
  assert.deepEqual(candidateThemeReports(reports,selected,'1w').reports.map(r=>r.id),['pre-new','week','post']);
});

test('dedupe uses the latest explicit direction, while neutral supersession removes a theme',()=>{
  const old=report('old','Premarket','2026-09-04','2026-09-04T12:00:00Z');
  const selected=report('new','Premarket','2026-09-08','2026-09-08T12:00:00Z');
  const rows=[
    {report_id:'old',ticker:'ABC',theme:'AI Buildout',catalyst_quality_direction:'A Bullish'},
    {report_id:'new',ticker:'ABC',theme:' ai   buildout ',catalyst_quality_direction:'Neutral / Watch'},
    {report_id:'new',ticker:'XYZ',theme:'AI Buildout',catalyst_quality_direction:'A Bearish'},
    {report_id:'new',ticker:'LONG',theme:'AI Buildout',catalyst_quality_direction:'A Bearish'},
  ];
  const result=aggregateThemes([old,selected],rows,selected,'1w');
  assert.deepEqual(result.bullish,[]);
  assert.deepEqual(result.bearish,[{theme:'AI Buildout',count:2}]);
  assert.equal(result.nonDirectionalTickerCount,1);
  assert.equal(result.sharedScale,2);
});

test('weekend rows use item dates and exclude undated items from broader ranges',()=>{
  const selected=report('selected','Premarket','2026-09-08','2026-09-08T12:00:00Z');
  const weekend=report('week','Weekend Summary','2026-09-08','2026-09-06T12:30:00Z',{coverage_start:'2026-09-03',coverage_end:'2026-09-06'});
  const rows=[
    {report_id:'week',ticker:'DATED',theme:'Policy',catalyst_quality_direction:'A Bullish',catalyst_event_date:'2026-09-04'},
    {report_id:'week',ticker:'UNDATED',theme:'Policy',catalyst_quality_direction:'A Bullish'},
  ];
  const result=aggregateThemes([selected,weekend],rows,selected,'1w');
  assert.deepEqual(result.bullish,[{theme:'Policy',count:1}]);
  assert.equal(result.undatedWeekendItemCount,1);
  assert.equal(result.ambiguousItemCount,1);
});

test('weekend broader ranges are unavailable when structured coverage is absent',()=>{
  const weekend=report('legacy-week','Weekend Summary','2026-09-08','2026-09-06T12:30:00Z');
  const window=themeWindow(weekend,'1w');
  assert.equal(window.anchor,null);
  assert.deepEqual(candidateThemeReports([weekend],weekend,'1w').reports,[]);
});
