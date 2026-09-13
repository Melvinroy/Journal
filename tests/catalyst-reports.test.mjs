import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../lib/catalyst-reports.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {reportType,reportHistory,defaultType,scheduleRuns,deliveryStatus,timestamp}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const evidenceJs=ts.transpileModule(fs.readFileSync(new URL('../lib/catalyst-schedule-evidence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {OBSERVED_SCHEDULES}=await import(`data:text/javascript;base64,${Buffer.from(evidenceJs).toString('base64')}`);
const reports=[{id:'pre',report_type:'Premarket Catalyst Brief',published_at:'2026-09-03T12:00:00Z'},{id:'post',report_type:'After-Market Catalyst Brief',published_at:'2026-09-04T00:30:00Z'},{id:'week',report_type:'Weekend Catalyst Summary',published_at:'2026-09-06T12:30:00Z'},{id:'old',report_type:'Premarket Catalyst Brief',published_at:'2026-09-02T12:00:00Z'}];
test('exact header mapping; unknown cannot be inferred from time',()=>{assert.equal(reportType('Weekend Catalyst Summary'),'Weekend Summary');assert.equal(reportType('Sunday report'),'Unknown');});
test('latest publication defaults to its type and history never crosses types',()=>{assert.equal(defaultType(reports),'Weekend Summary');assert.deepEqual(reportHistory(reports,'Premarket').map(r=>r.id),['pre','old']);assert.deepEqual(reportHistory(reports.filter(r=>r.id!=='week'),'Weekend Summary'),[]);});
const schedule={report_type:'Postmarket',timezone:'Asia/Singapore',weekdays:[2,3,4,5,6],local_time:'08:30:00',grace_minutes:60,effective_from:'2026-09-01T00:00:00Z',evidence:'test'};
test('Singapore date boundary and inclusive scheduled run',()=>{const r=scheduleRuns(schedule,new Date('2026-09-09T00:30:00Z'));assert.equal(r.previous,'2026-09-09T00:30:00.000Z');assert.equal(r.next,'2026-09-10T00:30:00.000Z');assert.match(timestamp(r.previous),/08:30/);});
test('missing, grace, late, received are independent from scheduler execution',()=>{
 assert.equal(deliveryStatus(undefined,[],[],new Date()).lastRun,undefined);
 assert.equal(deliveryStatus(undefined,[],[],new Date()).delivery,'Expected delivery unknown');
 assert.equal(deliveryStatus(schedule,[],[],new Date('2026-09-09T01:00:00Z')).delivery,'Expected report not yet received');
 const now=new Date('2026-09-09T02:00:00Z');
 assert.match(deliveryStatus(schedule,[],[],now).delivery,/Late/);
 const observed=[{stage:'scheduler',status:'succeeded',observed_at:'2026-09-09T00:31:00Z'}];
 const late=deliveryStatus(schedule,[],observed,now);assert.equal(late.lastRun.status,'succeeded');assert.match(late.delivery,/Late/);
 assert.equal(deliveryStatus(schedule,[{scheduled_for:'2026-09-09T08:30:00+08:00'}],[],now).delivery,'Received');
 assert.match(deliveryStatus(schedule,[{published_at:'2026-09-09T00:40:00Z'}],[],now).delivery,/linkage unverified/);
});
test('DST spring gap skips absent wall time; fall fold returns both instants',()=>{
 const s={...schedule,timezone:'America/New_York',weekdays:[7],local_time:'02:30',effective_from:'2026-01-01T00:00:00Z'};
 const spring=scheduleRuns(s,new Date('2026-03-08T08:00:00Z'));assert.equal(spring.next,'2026-03-15T06:30:00.000Z');
 const fold=scheduleRuns({...s,local_time:'01:30'},new Date('2026-11-01T06:00:00Z'));assert.equal(fold.previous,'2026-11-01T05:30:00.000Z');assert.equal(fold.next,'2026-11-01T06:30:00.000Z');
});
test('observed configuration preserves all three schedules and does not invent delivery deadlines',()=>{
 const now=new Date('2026-09-10T10:00:00Z');
 assert.deepEqual(OBSERVED_SCHEDULES.map(s=>scheduleRuns(s,now).next),['2026-09-10T12:30:00.000Z','2026-09-11T00:30:00.000Z','2026-09-13T12:45:00.000Z']);
 assert.ok(OBSERVED_SCHEDULES.every(s=>s.timezone==='Asia/Singapore'&&s.grace_minutes===null));
 assert.equal(scheduleRuns({...schedule,timezone:'Invalid/Zone'},now).next,null);
});
