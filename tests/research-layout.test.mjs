import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/research-layout.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {initialResearchLayouts,validResearchLayouts,moveColumn,researchPresets}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('layout survives JSON persistence and retains unavailable catalog identifiers',()=>{
 const saved=JSON.parse(JSON.stringify(initialResearchLayouts));saved.layouts[0].registry.push('future_metric');
 assert.equal(validResearchLayouts(saved),true);assert.equal(saved.layouts[0].registry.at(-1),'future_metric');
});
test('invalid saved layouts cannot overwrite valid preferences',()=>{
 for(const bad of [null,{}, {...initialResearchLayouts,active:'missing'}, {...initialResearchLayouts,layouts:[]}])assert.equal(validResearchLayouts(bad),false);
 const broken=structuredClone(initialResearchLayouts);broken.layouts[0].widths.net=NaN;assert.equal(validResearchLayouts(broken),false);
});
test('reordering is bounded and leaves original layout intact',()=>{
 const a=['one','two','three'];assert.deepEqual(moveColumn(a,1,-1),['two','one','three']);assert.deepEqual(a,['one','two','three']);assert.deepEqual(moveColumn(a,0,-1),a);
 assert.equal(Object.keys(researchPresets).length,4);
});
