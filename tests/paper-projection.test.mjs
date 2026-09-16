import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const encode = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = encode(compile('../lib/trading-domain.ts'));
const paper = await import(encode(compile('../lib/paper-execution.ts').replaceAll('"./trading-domain"', JSON.stringify(domain))));
const exitPlan = { schemaVersion: 1, legs: [{id:'T1',role:'Target',allocationPercent:100,target:{mode:'R',multipleR:2}}], breakeven:{activationR:1,favorableOffset:{unit:'Dollar',value:0}} };
const campaign = () => ({ id:'campaign',batchId:'batch',revision:1,symbol:'TEST',direction:'Long',state:'Open',createdAt:'2026-09-16T14:00:00Z',accountBinding:'opaque',contract:{conId:42,currency:'USD'},
 ticket:{planId:'plan',planRevision:'saved',quantity:1,planningPrice:100,hardCap:100,stopPrice:98,exitPlan},activeExitPlan:exitPlan,
 summary:{entered:1,exited:0,openQuantity:1,averageEntry:100,grossRealized:0,netRealized:null,fees:null,finalNetR:null,initialRisk:2,costsComplete:false},
 executions:[{executionId:'fill',orderId:1,effect:'entry',role:'entry',quantity:1,price:100,occurredAt:'',commission:null}],
 slots:[{id:'0',open:1,entryStatus:'Filled',stopStatus:'Submitted',confirmedStop:98,whyHeld:'',exitStatus:null,exitPrice:null,leg:null}] });
test('Position and Journal preserve broker quantities and unavailable fees without simulation or clock invention', () => {
 const c=campaign(), position=paper.paperPosition(c,true), row=paper.paperJournalRow(c);
 assert.equal(row.plannedR,2);assert.equal(row.fixedTargetCoverage,100);assert.equal(position.openQuantity,row.openQuantity);assert.equal(position.paperSummary.initialRisk,row.risk);
 assert.equal(row.costs,undefined);assert.equal(row.realizedAvailable,false);assert.equal(row.finalRAvailable,false);
 assert.equal(row.simulated,undefined);assert.equal(position.simulated,false);
 assert.equal(row.executions[0].feeAvailable,false);assert.equal(row.executions[0].occurredAt,'');assert.equal(row.date,'');
 assert.equal(paper.paperJournalRow(c).id,row.id);
});
test('Final net result and execution R are copied from the shared ledger only after fees', () => {
 const c=campaign();Object.assign(c.summary,{openQuantity:0,exited:1,grossRealized:4,fees:1,netRealized:3,finalNetR:1.5,costsComplete:true});c.state='Closed';
 const row=paper.paperJournalRow(c);assert.equal(row.pnl,3);assert.equal(row.r,1.5);assert.equal(row.costs,1);assert.equal(row.finalRAvailable,true);
});


test('Paper Journal uses confirmed closure time and keeps missing exit timestamps unknown', () => {
 const c=campaign(); c.state='Closed';
 c.executions[0].occurredAt='2026-09-14T14:00:00Z';
 c.executions.push({...c.executions[0],executionId:'exit',effect:'exit',occurredAt:'2026-09-16T15:00:00Z'});
 let row=paper.paperJournalRow(c);
 assert.equal(row.firstFillAt,'2026-09-14T14:00:00Z'); assert.equal(row.closedAt,'2026-09-16T15:00:00Z');
 c.executions[1].occurredAt=''; assert.equal(paper.paperJournalRow(c).closedAt,undefined);
});

test('Paper planner explains unsupported cases and nonzero exit allocation before review', () => {
 const t={...campaign().ticket,direction:'Long',quantity:1,method:'Limit',sessionMode:'Regular',duration:'DAY',protectionOrderType:'STP'};
 assert.deepEqual(paper.paperTicketBlockers(t),[]);
 assert.ok(paper.paperTicketBlockers({...t,direction:'Short'}).some(x=>x.includes('Short')));
 assert.ok(paper.paperTicketBlockers({...t,duration:'GTC'}).some(x=>x.includes('DAY')));
 assert.ok(paper.paperTicketBlockers({...t,quantity:4}).some(x=>x.includes('1–3')));
 assert.ok(paper.paperTicketBlockers({...t,exitPlan:{...t.exitPlan,legs:[{...t.exitPlan.legs[0],allocationPercent:50},{...t.exitPlan.legs[0],id:'T2',allocationPercent:50}]}}).some(x=>x.includes('at least one share')));
});


test('Trigger-held protection remains confirmed while reconciliation and unknown protection remain distinct', () => {
 const c=campaign(); c.slots[0].stopStatus='PreSubmitted'; c.slots[0].whyHeld='trigger'; c.state='Needs reconciliation';
 assert.equal(paper.paperPosition(c,true).protection.state,'Working');
 c.slots[0].confirmedStop=null;
 assert.equal(paper.paperPosition(c,true).protection.state,'Unknown');
 c.state='Open'; c.slots[0].confirmedStop=98; c.slots[0].whyHeld='child,trigger';
 assert.equal(paper.paperPosition(c,true).protection.state,'Unprotected');
});
