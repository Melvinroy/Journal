"use client";
import {useEffect,useState} from "react";
import catalog from "../services/eod/src/brontide_eod/research_metrics.json";

type Job={status:"Not run"|"Running"|"Completed"|"Failed"|"Unsupported";reason:string;report_id?:string;job_id?:string};
type Evidence=Record<string,unknown>;
type Difference={category:string;identity:string;field:string;current:unknown;lean:unknown;explanation:string};
type Analytics={values:Record<string,number|null>;unavailable:Record<string,string>};
type Report={run_id:string;source_run_id:string;lean_run_id:string;scope:string;signal_counts:{current:number;lean:number;matched:number};matched_trades:{identity:string;current:Evidence;lean:Evidence}[];differences:Difference[];unresolved_count:number;analytics:{current:Analytics;lean:Analytics};shared_inputs:{symbols:string[];warmup_start:string;data_fingerprint:string;manifest:{start:string;end:string}};execution:{current:Evidence;lean:Evidence};native_statistics_notes:string[];limitations:string[];timing:Evidence};

async function api<T>(path:string,signal:AbortSignal,post=false):Promise<T>{
  const response=await fetch(path,{signal,cache:"no-store",credentials:"omit",...(post?{method:"POST",headers:{"X-Brontide-Local":"1"}}:{})});
  const result=await response.json();
  if(!response.ok)throw new Error(typeof result.detail==="string"?result.detail:`Local service returned ${response.status}`);
  return result;
}
function value(v:unknown,unit=""){
  if(v==null)return "Unavailable";
  if(typeof v==="boolean")return v?"Yes":"No";
  if(typeof v!=="number")return String(v);
  if(unit==="fraction")return `${(v*100).toFixed(1)}%`;
  return `${v.toLocaleString(undefined,{maximumFractionDigits:6})}${unit==="R"?" R":unit==="USD"?" USD":""}`;
}

export function LeanComparison({runId,sample,renderDialog}:{runId:string;sample:boolean;renderDialog:(children:React.ReactNode,onClose:()=>void)=>React.ReactNode}){
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false);
  const [open,setOpen]=useState(false),[report,setReport]=useState<Report|null>(null),[refresh,setRefresh]=useState(0);
  const [tab,setTab]=useState<"overview"|"trades"|"metrics"|"details">("overview");
  useEffect(()=>{
    setJob(null);setReport(null);setError("");setOpen(false);
    if(sample){setJob({status:"Unsupported",reason:"Synthetic demo: local LEAN execution is available only with saved local research."});return;}
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const next=await api<Job>(`/v1/research/runs/${runId}/lean-comparison`,abort.signal);setJob(next);setError("");
        if(next.status==="Running")timer=setTimeout(poll,2000);
      }catch(e){if(!abort.signal.aborted)setError((e as Error).message);}
    }
    void poll();return()=>{abort.abort();clearTimeout(timer);};
  },[runId,sample,refresh]);
  useEffect(()=>{
    if(!open||!job?.report_id)return;
    const abort=new AbortController();setError("");
    api<Report>(`/v1/research/comparisons/${job.report_id}`,abort.signal).then(setReport).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[open,job?.report_id]);
  async function start(){
    setPending(true);setError("");
    try{const next=await api<Job>(`/v1/research/runs/${runId}/lean-comparison`,new AbortController().signal,true);setJob(next);setRefresh(x=>x+1);}
    catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  const fields=["status","entry_date","exit_date","entry","exit","setup_atr","fees_per_share","hold_sessions","outcome_r"];
  const headline=["closed","expectancy_r","win_rate","closed_trade_drawdown_r"];
  return <section className="rb-panel rb-engine-panel" aria-label="Engine comparison">
    <div className="rb-panel-heading"><div><p className="rb-eyebrow">CURRENT ENGINE · DEFAULT</p><h3>Independent LEAN comparison</h3><p>Check the same setups with a second engine.</p></div>
      <div className="rb-engine-actions"><span className={`rb-engine-status rb-status-${job?.status.replaceAll(" ","-").toLowerCase()??"loading"}`} role="status">{job?.status??"Checking availability…"}</span>
        {job?.status==="Completed"?<button className="rb-primary" onClick={()=>{setTab("overview");setOpen(true);}}>View LEAN comparison</button>:<button disabled={!job||job.status==="Unsupported"||job.status==="Running"||pending} onClick={start}>{pending?"Starting…":job?.status==="Failed"?"Retry LEAN comparison":"Compare with LEAN"}</button>}
      </div></div>
    <p className="rb-engine-reason">{job?.reason}</p>
    {error&&<p role="alert">{error} <button onClick={()=>setRefresh(x=>x+1)}>Refresh status</button></p>}
    {open&&renderDialog(<div className="rb-editor">
      <nav className="rb-comparison-nav" aria-label="Comparison sections">{(["overview","trades","metrics","details"] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==="overview"?"Overview":t==="trades"?"Signals & trades":t==="metrics"?"Metrics":"Assumptions & provenance"}</button>)}</nav>
      {!report&&!error&&<p role="status">Loading comparison evidence…</p>}{error&&<p role="alert">{error}</p>}
      {report&&<>
        <p>{report.shared_inputs.manifest.start} – {report.shared_inputs.manifest.end} · {report.shared_inputs.symbols.length} symbols · {report.scope}</p>
        {tab==="overview"&&<>
          <div className="rb-comparison-verdict"><p className="rb-eyebrow">{report.unresolved_count?"REQUIRES INVESTIGATION":"COMPARISON COMPLETE"}</p><h3>{report.signal_counts.matched} matched {report.signal_counts.matched===1?"signal":"signals"} · {report.matched_trades.length} matched {report.matched_trades.length===1?"trade":"trades"}</h3><p>{report.differences.length} classified field differences · {report.unresolved_count} unresolved. Matching signals do not mean identical execution.</p></div>
          <MetricTable report={report} ids={headline}/>
          <h3>What differs</h3><Differences rows={report.differences}/>
          <p className="rb-footnote">This small sample verifies implementation, not long-term strategy performance.</p>
        </>}
        {tab==="trades"&&<>
          <h3>Independent signal detection</h3><p>Current engine: {report.signal_counts.current} · LEAN: {report.signal_counts.lean} · Matched: {report.signal_counts.matched}</p>
          <Differences rows={report.differences.filter(d=>d.category==="signal logic"||d.field==="trade")}/>
          {report.matched_trades.map(t=><article className="rb-panel rb-comparison-trade" key={t.identity}><h3>{t.identity}</h3><div className="rb-table-wrap" tabIndex={0} role="region" aria-label={`Trade comparison ${t.identity}`}><table><thead><tr><th>Recorded field</th><th>Current engine</th><th>LEAN</th></tr></thead><tbody>{fields.map(f=><tr key={f}><th>{catalog.metrics.find(m=>m.id===f)?.label??f.replaceAll("_"," ")}</th><td>{value(t.current[f],catalog.metrics.find(m=>m.id===f)?.unit)}</td><td>{value(t.lean[f],catalog.metrics.find(m=>m.id===f)?.unit)}</td></tr>)}</tbody></table></div><details><summary>Complete matched records</summary><pre>{JSON.stringify(t,null,2)}</pre></details></article>)}
        </>}
        {tab==="metrics"&&<><h3>Shared metric definitions</h3><p>All applicable trades in each ledger. Missing portfolio inputs remain unavailable.</p><MetricTable report={report} ids={catalog.metrics.filter(m=>m.scope==="run").map(m=>m.id)}/><h3>How native LEAN statistics differ</h3><ul>{report.native_statistics_notes.map(n=><li key={n}>{n}</li>)}</ul></>}
        {tab==="details"&&<>
          <h3>Shared inputs</h3><p>Warm-up begins {report.shared_inputs.warmup_start}. Only setups within the displayed window are scored.</p><p>{report.shared_inputs.symbols.join(", ")}</p>
          <div className="rb-comparison-policies">{(["current","lean"] as const).map(e=><article className="rb-panel" key={e}><h3>{e==="current"?"Current engine":"LEAN"}</h3><dl>{Object.entries(report.execution[e]).map(([k,v])=><div key={k}><dt>{k.replaceAll("_"," ")}</dt><dd>{value(v)}</dd></div>)}</dl></article>)}</div>
          <h3>Limits of this comparison</h3><ul>{report.limitations.map(n=><li key={n}>{n}</li>)}</ul><details><summary>Timing and resource measurements</summary><pre>{JSON.stringify(report.timing,null,2)}</pre></details><details><summary>Frozen input fingerprints</summary><pre>{JSON.stringify(report.shared_inputs,null,2)}</pre></details>
          <div className="rb-toolbar"><a href={`/v1/research/runs/${report.run_id}/export`} download>Download comparison report</a><a href={`/v1/research/runs/${report.lean_run_id}/export`} download>Download LEAN ledger & native records</a></div>
        </>}
      </>}
    </div>,()=>setOpen(false))}
  </section>;
}

function MetricTable({report,ids}:{report:Report;ids:string[]}){
  return <div className="rb-table-wrap rb-comparison-metrics" tabIndex={0} role="region" aria-label="Engine metric comparison"><table><thead><tr><th>Metric / unit</th><th>Current engine</th><th>LEAN</th></tr></thead><tbody>{ids.map(id=>{const m=catalog.metrics.find(x=>x.id===id);return <tr key={id}><th><span title={m?.definition}>{m?.label??id}</span><small>{m?.unit==="fraction"?"%":m?.unit}</small></th>{(["current","lean"] as const).map(e=><td key={e}>{value(report.analytics[e].values[id],m?.unit)}{report.analytics[e].unavailable[id]&&<small className="rb-unavailable-reason">{report.analytics[e].unavailable[id]}</small>}</td>)}</tr>;})}</tbody></table></div>;
}
function Differences({rows}:{rows:Difference[]}){
  if(!rows.length)return <p>No recorded differences in this section.</p>;
  return <div className="rb-differences">{rows.map((d,i)=><article key={i}><div><strong>{catalog.metrics.find(m=>m.id===d.field)?.label??d.field.replaceAll("_"," ")}</strong><span className="rb-engine-status">{d.category}</span></div><small>{d.identity}</small><p>{d.explanation}</p><small>Current: {value(d.current,catalog.metrics.find(m=>m.id===d.field)?.unit)} · LEAN: {value(d.lean,catalog.metrics.find(m=>m.id===d.field)?.unit)}</small></article>)}</div>;
}
