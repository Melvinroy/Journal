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
