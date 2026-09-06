"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import catalog from "../services/eod/src/brontide_eod/research_metrics.json";
import {ResearchDrawer} from "./ResearchDrawer";
import type {ResearchLayout} from "../lib/research-layout";

type Row=Record<string,unknown>&{symbol:string;setup_date:string;measurements?:Record<string,unknown>;conditions?:{condition:string;observed:unknown;operator:string;threshold:unknown;status:string;unit:string}[]};
type Analytics={scope:string;values:Record<string,number|null>;unavailable:Record<string,string>};
type Read=<T>(path:string,signal:AbortSignal)=>Promise<T>;
const columns=catalog.metrics.filter(m=>m.scope==="trade");
const metrics=Object.fromEntries(columns.map(m=>[m.id,m]));
export function researchColumnWidth(id:string){return id.includes("date")?100:id==="exit_reason"?120:id==="closed_trade_drawdown_r"?126:id==="profit_factor_r"?108:id==="status"?82:id.startsWith("setup.")?100:92;}
export function researchFormat(value:unknown,unit=""){
  if(value==null)return "—";
  if(typeof value==="boolean")return value?"Yes":"No";
  if(typeof value!=="number")return typeof value==="object"?JSON.stringify(value):String(value);
  if(unit==="fraction")return `${(value*100).toFixed(1)}%`;
  return `${unit==="USD"?"$":""}${value.toLocaleString(undefined,{maximumFractionDigits:unit==="count"||unit==="sessions"?0:2,minimumFractionDigits:unit==="USD"?2:0})}${unit==="R"?"R":unit==="percent"?"%":""}`;
}
function field(r:Row,id:string){return id.startsWith("setup.")?r.measurements?.[id.slice(6)]:r[id];}
function download(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

export function ResearchTrades({runId,strategy,layout,request,onClose,onColumns,onChart,onWatch,inWatchlist,onRefresh,watchReady,watchError}:{runId:string;strategy:string;layout:ResearchLayout;request:Read;onClose:()=>void;onColumns:()=>void;onChart:(r:Row)=>void;onWatch:(r:Row)=>void;inWatchlist:(r:Row)=>boolean;onRefresh:()=>void;watchReady:boolean;watchError:string}){
  const [symbol,setSymbol]=useState(""),[filter,setFilter]=useState(""),[offset,setOffset]=useState(0),[sort,setSort]=useState("setup_date"),[descending,setDescending]=useState(false);
  const [result,setResult]=useState<{rows:Row[];total:number;analytics:Analytics}|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [inspection,setInspection]=useState<Row|null>(null),[detail,setDetail]=useState<Row|null>(null),[detailError,setDetailError]=useState("");
  const tableRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLElement>(null),restore=useRef<{top:number;left:number;id:string}|null>(null);
  const visible=layout.trades.filter(id=>metrics[id]&&id!=="symbol");const fieldQuery=visible.join(",");
  useEffect(()=>{const timer=setTimeout(()=>{setFilter(symbol.trim().toUpperCase());setOffset(0);},200);return()=>clearTimeout(timer);},[symbol]);
  useEffect(()=>{const abort=new AbortController();setBusy(true);setError("");
    const query=new URLSearchParams({view:"trades",compact:"true",fields:fieldQuery,symbol:filter,sort,descending:String(descending),offset:String(offset),limit:"100"});
    Promise.all([request<{rows:Row[];total:number}>(`/v1/research/runs/${runId}/rows?${query}`,abort.signal),request<Analytics>(`/v1/research/runs/${runId}/analytics?symbol=${encodeURIComponent(filter)}`,abort.signal)]).then(([r,a])=>{setResult({...r,analytics:a});if(tableRef.current)tableRef.current.scrollTop=0;}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();
  },[runId,filter,sort,descending,offset,fieldQuery,retry,request]);
  useEffect(()=>{if(!inspection)return;const abort=new AbortController();setDetail(null);setDetailError("");
    request<{trade:Row}>(`/v1/research/runs/${runId}/trades/${inspection.trade_id??inspection.signal_id}`,abort.signal).then(r=>setDetail(r.trade)).catch(e=>{if(!abort.signal.aborted)setDetailError(e.message);});return()=>abort.abort();
  },[inspection,runId,request]);
  useLayoutEffect(()=>{if(inspection)detailRef.current?.focus();else if(restore.current&&tableRef.current){const saved=restore.current;tableRef.current.scrollTop=saved.top;tableRef.current.scrollLeft=saved.left;tableRef.current.querySelectorAll<HTMLButtonElement>("[data-inspect]").forEach(b=>{if(b.dataset.inspect===saved.id)b.focus({preventScroll:true});});}},[inspection]);
  const inspect=(row:Row)=>{restore.current={top:tableRef.current?.scrollTop??0,left:tableRef.current?.scrollLeft??0,id:String(row.trade_id??row.signal_id)};setInspection(row);};
  const changeSort=(id:string)=>{setSort(id);setDescending(sort===id?!descending:false);setOffset(0);};
  const a=result?.analytics;
  const group=(title:string,ids:string[])=>detail&&<section className="rb-detail-section"><h3>{title}</h3><dl>{ids.filter(id=>metrics[id]).map(id=><div key={id}><dt>{metrics[id].label}</dt><dd>{researchFormat(field(detail,id),metrics[id].unit)}</dd></div>)}</dl></section>;
  return <ResearchDrawer title={`Trades · ${strategy}`} onClose={onClose}>
    {inspection?<article className="rb-drawer-inspection" ref={detailRef} tabIndex={-1}>
      <div className="rb-inspection-nav"><button onClick={()=>setInspection(null)}>← Back to trades</button><strong>{inspection.symbol} · {inspection.setup_date}</strong></div>
      {!detail&&!detailError&&<p role="status">Loading selected trade evidence…</p>}{detailError&&<p role="alert">{detailError}<button onClick={()=>setInspection({...inspection})}>Retry inspection</button></p>}
      {detail&&<><div className="rb-toolbar"><button onClick={()=>onChart(detail)}>Chart at setup close</button><button disabled={!watchReady} onClick={()=>onWatch(detail)}>Add to watchlist</button><span role="status">{watchError||(inWatchlist(detail)?"In shared watchlist":"")}</span></div>
        {group("Trade summary",["status","entry_date","exit_date","outcome_r","outcome_percent","hold_sessions","exit_reason"])}
        {group("Execution",["entry","stop","target","exit","fees_per_share","mfe_r","mae_r","ambiguous"])}
        <details className="rb-evidence-group"><summary>Setup evidence</summary><p>{String(detail.setup_evidence??"No recorded setup evidence")}</p>{group("Recorded measurements",columns.filter(m=>m.id.startsWith("setup.")).map(m=>m.id))}{!!detail.conditions?.length&&<div className="rb-table-wrap"><table><thead><tr><th>Condition</th><th>Observed</th><th>Required</th><th>Result</th></tr></thead><tbody>{detail.conditions.map(c=><tr key={c.condition}><td>{c.condition}</td><td>{researchFormat(c.observed)} {c.unit}</td><td>{c.operator} {researchFormat(c.threshold)}</td><td>{c.status}</td></tr>)}</tbody></table></div>}</details>
        <details className="rb-evidence-group"><summary>Provenance & complete record</summary><p>Run {runId} · exact recorded source scan join</p><pre>{JSON.stringify(detail,null,2)}</pre></details>
      </>}
    </article>:<>
      <div className="rb-drawer-kpis" aria-busy={busy}>{["closed","winners","losers","open","expectancy_r"].map(id=><div key={id}><span>{catalog.metrics.find(m=>m.id===id)?.label}</span><strong>{researchFormat(a?.values[id],catalog.metrics.find(m=>m.id===id)?.unit)}</strong></div>)}</div>
      <div className="rb-drawer-toolbar"><label><span className="rb-sr">Ticker filter</span><input aria-label="Ticker filter" value={symbol} maxLength={32} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder="Search ticker"/></label><label><span className="rb-sr">Sort trades</span><select aria-label="Sort trades" value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}}>{columns.map(m=><option value={m.id} key={m.id}>{m.label}</option>)}</select></label><button aria-pressed={descending} onClick={()=>{setDescending(!descending);setOffset(0);}}>{descending?"Descending":"Ascending"}</button><button onClick={onColumns}>Columns</button><details className="rb-trade-actions"><summary>More actions</summary><div><button disabled={!result||busy} onClick={()=>download({run_id:runId,rows:result?.rows,columns:visible,filters:{symbol:filter,sort,descending},offset,total:result?.total,export_scope:"currently displayed page only"},"research-visible-page.json")}>Export visible page</button><a href={`/v1/research/runs/${runId}/export`} download>Download complete run</a><button onClick={()=>{onRefresh();setRetry(x=>x+1);}}>Refresh evidence</button></div></details></div>
      <p className="rb-cohort" role="status">{busy?"Updating trade evidence…":`${a?.scope??"Whole run"} · ${result?.total??0} records · summaries cover all matching trades`}</p>
      {error&&<p role="alert">{error}<button onClick={()=>setRetry(x=>x+1)}>Retry</button></p>}
      <div ref={tableRef} className="rb-ledger-scroll" tabIndex={0} role="region" aria-label="Trade ledger" aria-busy={busy}><table><thead><tr><th>Ticker</th>{visible.map(id=><th key={id} style={{minWidth:layout.widths[id]??researchColumnWidth(id),width:layout.widths[id]??researchColumnWidth(id)}} aria-sort={sort===id?(descending?"descending":"ascending"):"none"}><button title={metrics[id].definition} onClick={()=>changeSort(id)}>{metrics[id].label}</button></th>)}<th>Details</th></tr></thead><tbody>{result?.rows.map((r,i)=><tr key={String(r.trade_id??r.signal_id??i)}><th scope="row"><button className="rb-text-action" onClick={()=>onChart(r)}>{r.symbol}</button></th>{visible.map(id=><td key={id} className={id==="outcome_r"?(Number(r.outcome_r)>0?"rb-positive":"rb-negative"):undefined}>{researchFormat(field(r,id),metrics[id].unit)}</td>)}<td><button className="rb-text-action" data-inspect={String(r.trade_id??r.signal_id)} onClick={()=>inspect(r)}>Inspect {r.symbol}</button></td></tr>)}</tbody></table>{!busy&&!error&&!result?.rows.length&&<p className="rb-empty">No trades match this filter.</p>}</div>
      <footer className="rb-drawer-footer"><span>{result?.total?offset+1:0}–{Math.min(offset+100,result?.total??0)} of {result?.total??0}</span><button disabled={!offset||busy} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><button disabled={busy||offset+100>=(result?.total??0)} onClick={()=>setOffset(offset+100)}>Next</button></footer>
    </>}
  </ResearchDrawer>;
}
