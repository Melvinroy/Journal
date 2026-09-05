"use client";
import { useEffect, useRef, useState } from "react";
import { TradePlanner } from "./TradePlanner";
import { useBrowserStore } from "../lib/use-browser-store";
import type { MarketContext } from "../lib/workspace-state";
import { PLANS_KEY,appendFill,position,validatePlans,type Plan,type Tranche,type PlanRevision } from "../lib/trading-ledger";

const money=(v:number)=>v.toLocaleString(undefined,{style:"currency",currency:"USD"});
function fresh(context?:MarketContext):Plan{return {id:crypto.randomUUID(),name:"New trade plan",symbol:context?.symbol??"",side:"Long",entry:0,equity:30000,riskPercent:.5,allocationPercent:10,tranches:[{id:"A",percent:50,stop:0,target:null},{id:"B",percent:50,stop:0,target:null}],fills:[],notes:"",revision:0,context,updatedAt:new Date().toISOString()};}

export function TradingWorkspace({context,onChart}:{context?:MarketContext;onChart:(c:MarketContext)=>void}){
  const store=useBrowserStore<Plan[]>(PLANS_KEY,[],validatePlans);
  const revisions=useBrowserStore<PlanRevision[]>("brontide-plan-revisions-v1",[],value=>Array.isArray(value)&&value.every(r=>r&&Number.isInteger(r.revision)&&typeof r.savedAt==="string"&&validatePlans([r.plan])));
  const [draft,setDraft]=useState<Plan|null>(null),[dirty,setDirty]=useState(false),[message,setMessage]=useState("");
  const recovery=useBrowserStore<{draft:Plan|null;dirty:boolean}>("brontide-plan-editor-v1",{draft:null,dirty:false},value=>{
    const v=value as {draft?:Plan|null;dirty?:boolean};return !!v&&typeof v.dirty==="boolean"&&(v.draft===null|| (!!v.draft&&typeof v.draft.id==="string"&&typeof v.draft.symbol==="string"&&Array.isArray(v.draft.tranches)&&Array.isArray(v.draft.fills)));
  });
  const restored=useRef(false);
  useEffect(()=>{if(recovery.ready&&!restored.current){setDraft(recovery.value.draft);setDirty(recovery.value.dirty);restored.current=true;}},[recovery.ready]);
  useEffect(()=>{if(restored.current&&recovery.ready)recovery.save({draft,dirty});},[draft,dirty]);
  const [view,setView]=useState<"plans"|"positions"|"review"|"calculator">("plans");
  const [fill,setFill]=useState({trancheId:"A",action:"entry" as "entry"|"exit",quantity:0,price:0,fee:0,at:"",reason:"Manual"});
  let metrics:ReturnType<typeof position>|null=null,validation="";
  if(draft)try{metrics=position(draft);}catch(e){validation=(e as Error).message;}
  const edit=(patch:Partial<Plan>)=>{if(draft){setDraft({...draft,...patch});setDirty(true);setMessage("");}};
  const open=(plan:Plan)=>{if(dirty&&!window.confirm("Discard unsaved editor changes? Saved plans remain unchanged."))return;setDraft(structuredClone(plan));setDirty(false);setMessage("");setView("plans");};
  const persist=(next:Plan)=>{try{position(next);const prior=store.value.find(p=>p.id===next.id);if(prior&&prior.revision!==next.revision-1)throw new Error("This plan changed in another view. Reopen its latest saved revision before editing.");if(prior&&!revisions.save([...revisions.value,{revision:prior.revision,savedAt:prior.updatedAt,plan:prior}])){setMessage("Could not preserve the prior revision; save stopped.");return;}if(store.save([...store.value.filter(p=>p.id!==next.id),next])){setDraft(next);setDirty(false);setMessage("Saved locally. No broker order was sent.");}}catch(e){setMessage((e as Error).message);}};
  const save=()=>{if(draft)persist({...draft,symbol:draft.symbol.trim().toUpperCase(),revision:draft.revision+1,updatedAt:new Date().toISOString()});};
  const patchTranche=(index:number,patch:Partial<Tranche>)=>draft&&edit({tranches:draft.tranches.map((t,i)=>i===index?{...t,...patch}:t)});
  const record=()=>{if(!draft||dirty){setMessage("Save the plan before recording a fill.");return;}try{if(!fill.at)throw new Error("Enter the actual fill time.");persist({...appendFill(draft,{...fill,id:crypto.randomUUID(),at:new Date(fill.at).toISOString(),provenance:"manual"}),updatedAt:new Date().toISOString()});}catch(e){setMessage((e as Error).message);}};
  const exportPlans=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,value:store.value},null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="brontide-local-plans.json";a.click();URL.revokeObjectURL(url);};
  const filled=!!draft?.fills.length;
  return <section className="research-workspace trading-workspace"><header><div><p className="eyebrow">TRADING</p><h1>Plans, positions & review</h1></div><button disabled={!store.ready} onClick={()=>open(fresh(context))}>New plan{context?` · ${context.symbol}`:""}</button></header>
    <p className="workspace-notice">Manual local planning and fill records only. No broker connection or automatic execution. Cloud Journal and the original calculator records are unchanged.</p>
    <nav className="research-controls" aria-label="Trading views">{(["plans","positions","review","calculator"] as const).map(v=><button aria-pressed={view===v} key={v} onClick={()=>setView(v)}>{v==="review"?"Local journal / review":v==="calculator"?"Original risk calculator":v}</button>)}<button disabled={!store.ready} onClick={exportPlans}>Export local records</button></nav>
    {(store.error||recovery.error||revisions.error||message)&&<p role="status">{store.error||recovery.error||revisions.error||message}</p>}
    {view==="calculator"?<TradePlanner context={context} onChart={onChart}/>:<>
    <div className="research-table"><table><thead><tr><th>Plan</th><th>Ticker</th><th>Revision</th><th>Status</th><th>Open shares</th><th>Realized net P&L</th><th>Action</th></tr></thead><tbody>{store.value.filter(p=>view==="plans"||p.fills.length>0).map(p=>{const s=position(p);return <tr key={p.id}><td>{p.name}</td><td>{p.symbol}</td><td>{p.revision}</td><td>{s.status}</td><td>{s.remaining}</td><td>{p.fills.length?money(s.realized):"—"}</td><td><button onClick={()=>open(p)}>Open</button> <button onClick={()=>open({...structuredClone(p),id:crypto.randomUUID(),name:`${p.name} copy`,fills:[],revision:0,updatedAt:new Date().toISOString()})}>Use as template</button></td></tr>;})}</tbody></table></div>
    {!store.value.length&&<p>No saved advanced plans. Create one, or open the original calculator to access your existing settings and draft.</p>}
    {draft&&<article className="plan-editor"><h2>{draft.name} {dirty?"· Unsaved":""}</h2>
    <div className="research-controls"><button onClick={()=>onChart(draft.context?{...draft.context,symbol:draft.symbol}:{symbol:draft.symbol,mode:process.env.NEXT_PUBLIC_BRONTIDE_LOCAL==="1"?"local":"sample",adjustment:"all"})} disabled={!draft.symbol}>Open chart · draft retained</button><button disabled={!store.ready||!!validation} onClick={save}>Review & save revision</button></div>
    <fieldset disabled={filled}><legend>1 · Entry and hard account limits</legend><div className="plan-fields">
      <label>Name<input value={draft.name} onChange={e=>edit({name:e.target.value})}/></label><label>Ticker<input value={draft.symbol} maxLength={32} onChange={e=>edit({symbol:e.target.value.toUpperCase()})}/></label>
      <label>Direction<select value={draft.side} onChange={e=>edit({side:e.target.value as Plan["side"]})}><option>Long</option><option>Short</option></select></label>
      {([ ["entry","Intended entry"],["equity","Account equity"],["riskPercent","Risk cap %"],["allocationPercent","Capital cap %"]] as const).map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="any" value={draft[key]} onChange={e=>edit({[key]:Number(e.target.value)})}/></label>)}
    </div></fieldset>
    <fieldset disabled={filled}><legend>2 · Split protection and profit-taking alternatives</legend><p>Each tranche has one protective stop and an optional target for the same shares. Blank target means runner. Allocations must total 100%.</p>
    {draft.tranches.map((t,i)=><div className="tranche-editor" key={t.id}><h3>Tranche {t.id}</h3><div className="plan-fields"><label>Allocation %<input type="number" min="0" max="100" value={t.percent} onChange={e=>patchTranche(i,{percent:Number(e.target.value)})}/></label><label>Initial stop<input type="number" min="0" step="any" value={t.stop} onChange={e=>patchTranche(i,{stop:Number(e.target.value)})}/></label><label>Profit target / runner<input type="number" min="0" step="any" value={t.target??""} onChange={e=>patchTranche(i,{target:e.target.value===""?null:Number(e.target.value)})}/></label>
    <label>Progress stop after target completed<select value={t.progressAfter??""} onChange={e=>patchTranche(i,{progressAfter:e.target.value||undefined})}><option value="">No progression</option>{draft.tranches.filter(x=>x.id!==t.id).map(x=><option key={x.id}>{x.id}</option>)}</select></label>{t.progressAfter&&<label>New protective stop<input type="number" min="0" step="any" value={t.progressStop??0} onChange={e=>patchTranche(i,{progressStop:Number(e.target.value)})}/></label>}</div><button disabled={draft.tranches.length===1} onClick={()=>edit({tranches:draft.tranches.filter(x=>x.id!==t.id)})}>Remove tranche</button></div>)}
    <button disabled={draft.tranches.length>=8} onClick={()=>edit({tranches:[...draft.tranches,{id:crypto.randomUUID().slice(0,6),percent:0,stop:0,target:null}]})}>Add tranche</button></fieldset>
    {filled&&<p>Entry, sizing and management rules are locked after the first actual fill. Copy as a template to create another plan.</p>}
    <label>Plan notes / execution review<textarea value={draft.notes} onChange={e=>edit({notes:e.target.value})}/></label>
    {validation&&<p role="alert">{validation}</p>}{metrics&&<><h3>3 · Final review</h3><p>{metrics.shares} planned shares · {money(metrics.capital)} capital · {money(metrics.risk)} initial stop risk / {money(metrics.budget)} cap. Gap losses can exceed planned risk.</p>
    <div className="research-table"><table><thead><tr><th>Tranche</th><th>Planned</th><th>Entered</th><th>Remaining</th><th>Average fill</th><th>Active stop</th><th>Net realized</th></tr></thead><tbody>{metrics.tranches.map(t=><tr key={t.id}><td>{t.id}</td><td>{t.planned}</td><td>{t.entered}</td><td>{t.remaining}</td><td>{money(t.average)}</td><td>{money(t.activeStop)}</td><td>{money(t.realized-t.fees)}</td></tr>)}</tbody></table></div>
    <h3>4 · Record an actual fill</h3><p>Record only a fill that occurred. Progression activates after the trigger tranche’s full planned quantity exits with reason Target; it does not send a stop order.</p>
    <div className="plan-fields"><label>Tranche<select value={fill.trancheId} onChange={e=>setFill({...fill,trancheId:e.target.value})}>{draft.tranches.map(t=><option key={t.id}>{t.id}</option>)}</select></label><label>Action<select value={fill.action} onChange={e=>setFill({...fill,action:e.target.value as "entry"|"exit"})}><option value="entry">Entry</option><option value="exit">Exit</option></select></label>
    {(["quantity","price","fee"] as const).map(key=><label key={key}>{key}<input type="number" min="0" step={key==="quantity"?"1":"any"} value={fill[key]} onChange={e=>setFill({...fill,[key]:Number(e.target.value)})}/></label>)}<label>Actual fill time (device timezone)<input type="datetime-local" value={fill.at} onChange={e=>setFill({...fill,at:e.target.value})}/></label><label>Reason<select value={fill.reason} onChange={e=>setFill({...fill,reason:e.target.value})}><option>Manual</option><option>Target</option><option>Stop</option><option>Time exit</option></select></label></div>
    <button disabled={dirty||!store.ready||draft.revision===0} onClick={record}>Record manual fill · no order sent</button><details><summary>Actual fill ledger and originating chart context</summary><pre>{JSON.stringify({context:draft.context,fills:draft.fills},null,2)}</pre></details></>}
    <details><summary>Saved revision history</summary><pre>{JSON.stringify(revisions.value.filter(r=>r.plan.id===draft.id),null,2)}</pre></details>
    </article>}
    </>}
  </section>;
}
