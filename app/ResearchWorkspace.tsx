"use client";
import { useEffect, useState } from "react";
import { getLocalJson } from "../lib/chart-data";
import { useBrowserStore } from "../lib/use-browser-store";
import { WATCH_KEY, updateWatchlist, validWatchlist, type WatchItem, type MarketContext } from "../lib/workspace-state";
import { ScansDashboard } from "./ScansDashboard";
import { BacktestDashboard } from "./BacktestDashboard";

type Row = {symbol:string;setup_date:string;ep_date:string;status:string;signal_id?:string;strategy_id?:string;intended_entry_date?:string;entry_date?:string;exit_date?:string;outcome_r?:number;measurements?:Record<string,unknown>;conditions?:{condition:string;observed:unknown;operator:string;threshold:unknown;status:string;unit:string}[];[key:string]:unknown};
type Run = {run_id:string;manifest:{strategy?:{id:string;version:string};end:string;start:string;adjustment:string;data_fingerprint:string;[key:string]:unknown};summary:Record<string,unknown>;sessions?:{session_date:string;candidates:number}[];execution?:Record<string,unknown>;freshness?:{freshness:string;expected_session?:string}};
const display=(v:unknown):string=>v==null?"—":typeof v==="number"?v.toLocaleString(undefined,{maximumFractionDigits:4}):typeof v==="object"?JSON.stringify(v):String(v);

export function ResearchWorkspace({kind,onChart}:{kind:"scan"|"backtest";onChart:(context:MarketContext)=>void}) {
  const local=process.env.NEXT_PUBLIC_BRONTIDE_LOCAL==="1";
  const [runs,setRuns]=useState<Run[]>([]),[id,setId]=useState(""),[run,setRun]=useState<Run|null>(null);
  const [rows,setRows]=useState<Row[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
  const [date,setDate]=useState(""),[symbol,setSymbol]=useState(""),[diagnostic,setDiagnostic]=useState(false);
  const [detail,setDetail]=useState<Row|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  const [compare,setCompare]=useState<string[]>([]),[legacy,setLegacy]=useState(!local);
  const [allSessions,setAllSessions]=useState(false);
  const compatible=new Set(runs.filter(r=>compare.includes(r.run_id)).map(r=>JSON.stringify([r.manifest.data_fingerprint,r.manifest.universe_fingerprint,r.manifest.calendar_fingerprint,r.manifest.start,r.manifest.end,r.manifest.source,r.manifest.adjustment,r.manifest.execution_fingerprint]))).size<=1;
  const [sort,setSort]=useState("setup_date"),[descending,setDescending]=useState(false),[metric,setMetric]=useState("rvol");
  const preferences=useBrowserStore<{symbol:string;diagnostic:boolean;sort:string;descending:boolean;metric:string}>(`brontide-research-view-${kind}-v1`,{symbol:"",diagnostic:false,sort:"setup_date",descending:false,metric:"rvol"});
  useEffect(()=>{if(preferences.ready){setSymbol(preferences.value.symbol);setDiagnostic(preferences.value.diagnostic);setSort(preferences.value.sort);setDescending(preferences.value.descending);setMetric(preferences.value.metric);}},[preferences.ready]);
  const watch=useBrowserStore<WatchItem[]>(WATCH_KEY,[],validWatchlist);
  useEffect(()=>{
    if(!local)return;
    const abort=new AbortController();setLoading(true);setError("");
    getLocalJson<{runs:Run[]}>(`/v1/research/runs?kind=${kind}`,abort.signal).then(data=>{setRuns(data.runs);setId(old=>data.runs.some(r=>r.run_id===old)?old:data.runs[0]?.run_id??"");}).catch(e=>{if(!abort.signal.aborted)setError(String(e.message));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[kind,local,retry]);
  useEffect(()=>{
    if(!id)return;
    const abort=new AbortController();setRun(null);setDetail(null);setError("");setLoading(true);
    getLocalJson<Run>(`/v1/research/runs/${id}`,abort.signal).then(data=>{setRun(data);setDate(kind==="scan"?data.sessions?.at(-1)?.session_date??"":"");setOffset(0);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[id,kind,retry]);
  useEffect(()=>{
    if(!run)return;
    const abort=new AbortController();setLoading(true);setRows([]);setError("");
    const params=new URLSearchParams({view:kind==="backtest"?"trades":diagnostic?"evaluations":"signals",session:date,symbol,offset:String(offset),limit:"100",sort,descending:String(descending)});
    getLocalJson<{rows:Row[];total:number}>(`/v1/research/runs/${run.run_id}/rows?${params}`,abort.signal).then(data=>{setRows(data.rows);setTotal(data.total);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[run,date,symbol,diagnostic,offset,kind,retry,sort,descending]);
  const chart=(row:Row)=>onChart({symbol:row.symbol,mode:"local",adjustment:run?.manifest.adjustment??"all",asOf:row.setup_date,signalId:row.signal_id,strategyId:row.strategy_id});
  const download=()=>{
    if(!run)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify({manifest:run,view:diagnostic?"evaluations":kind,filters:{date,symbol},offset,total,rows,export_scope:"currently displayed page only"},null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`brontide-${kind}-${run.run_id.slice(0,12)}-page.json`;link.click();URL.revokeObjectURL(url);
  };
  return <section className="research-workspace">
    <header><div><p className="eyebrow">{kind==="scan"?"DISCOVER":"STRATEGIES"}</p><h1>{kind==="scan"?"Completed-session scans":"Reproducible research"}</h1></div><button onClick={()=>setLegacy(!legacy)}>{legacy?"Research runs":"Legacy reference"}</button></header>
    <p className="workspace-notice">{local?"Local EOD research · no live quotes or orders. Runs are immutable and strategy variants remain unvalidated until reviewed.":"Public demo · historical reference only. Local research runs and private market data are not published here."}</p>
    {legacy?(kind==="scan"?<ScansDashboard/>:<BacktestDashboard/>):<>
      <div className="research-controls"><label>Saved run<select value={id} onChange={e=>setId(e.target.value)}><option value="">Select a run</option>{runs.map(r=><option key={r.run_id} value={r.run_id}>{r.manifest.strategy?.id} · {r.manifest.end} · {r.run_id.slice(0,8)}</option>)}</select></label>
      {kind==="scan"&&<><label>Completed session<select value={date} onChange={e=>{setDate(e.target.value);setOffset(0);setDetail(null);}}>{(allSessions?run?.sessions?.slice():run?.sessions?.slice(-30))?.reverse().map(s=><option key={s.session_date} value={s.session_date}>{s.session_date} · {s.candidates} matches</option>)}</select></label><label><input type="checkbox" checked={allSessions} onChange={e=>setAllSessions(e.target.checked)}/> All sessions in this run</label></>}
      <label>Ticker filter<input value={symbol} maxLength={32} onChange={e=>{setSymbol(e.target.value.toUpperCase());setOffset(0);setDetail(null);}}/></label>
      {kind==="scan"&&<label><input type="checkbox" checked={diagnostic} onChange={e=>{setDiagnostic(e.target.checked);setOffset(0);}}/> Include failed/watching evaluations</label>}
      <label>Sort<select value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}}><option value="setup_date">Setup date</option><option value="symbol">Ticker</option>{kind==="backtest"&&<option value="outcome_r">Outcome R</option>}</select></label><label><input type="checkbox" checked={descending} onChange={e=>{setDescending(e.target.checked);setOffset(0);}}/> Descending</label>
      {kind==="scan"&&<label>Measurement column<select value={metric} onChange={e=>setMetric(e.target.value)}>{["rvol","body_atr","range_atr","atr14","adv20","sma10","sma20","sma50","ep_age","distribution_count"].map(key=><option key={key}>{key}</option>)}</select></label>}
      <button disabled={!preferences.ready} onClick={()=>preferences.save({symbol,diagnostic,sort,descending,metric})}>Save view preferences</button>
      <button onClick={()=>setRetry(retry+1)}>Refresh / retry</button><button disabled={!run} onClick={download}>Export visible page + provenance</button>{run&&<a href={`/v1/research/runs/${run.run_id}/export`} download>Download complete run / ledger</a>}</div>
      {preferences.error&&<p role="alert">{preferences.error}</p>}
      {loading&&<p role="status">Loading research…</p>}{error&&<p role="alert">{error}</p>}
      {diagnostic&&allSessions&&<p>Detailed failed/watching evaluations are retained for the latest 30 sessions only. Qualified signals remain available for the full run.</p>}
      {!loading&&!error&&!runs.length&&<p>No {kind} runs have been published. Run the documented offline research job against the existing local database; this screen does not start ingestion.</p>}
      {run&&<><p>Run through {run.manifest.end} · selected {date||"all setup sessions"} · expected completed session {run.freshness?.expected_session??"unknown"} · {run.freshness?.freshness??"unknown freshness"} · {run.manifest.adjustment} prices.</p>
      <details><summary>Exact definition, data fingerprints and execution assumptions</summary><pre>{JSON.stringify({manifest:run.manifest,execution:run.execution},null,2)}</pre></details>
      <div className="research-summary">{Object.entries(run.summary).map(([key,value])=><div key={key}><small>{key.replaceAll("_"," ")}</small><strong>{display(value)}</strong></div>)}</div>
      {!compatible&&<p role="alert">Selected runs have different data, periods or execution assumptions. Their results are not a controlled strategy comparison.</p>}
      {kind==="backtest"&&<details><summary>Compare saved runs (check matching assumptions before interpreting)</summary>{runs.map(r=><label className="research-check" key={r.run_id}><input type="checkbox" checked={compare.includes(r.run_id)} onChange={e=>setCompare(e.target.checked?[...compare,r.run_id]:compare.filter(x=>x!==r.run_id))}/>{r.manifest.strategy?.id} · {r.run_id.slice(0,8)}</label>)}<div className="research-table"><table><thead><tr><th>Strategy</th><th>Data</th><th>Closed</th><th>Expectancy R</th><th>Closed-trade DD R</th></tr></thead><tbody>{runs.filter(r=>compare.includes(r.run_id)).map(r=><tr key={r.run_id}><td>{r.manifest.strategy?.id}</td><td>{r.manifest.data_fingerprint?.slice(0,12)}</td><td>{display(r.summary.closed)}</td><td>{display(r.summary.expectancy_r)}</td><td>{display(r.summary.closed_trade_drawdown_r)}</td></tr>)}</tbody></table></div><p>Independent trades, not a capital-constrained portfolio. Legacy results are not included in these comparisons.</p></details>}
      {!loading&&!error&&!rows.length&&<p>No {diagnostic?"evaluations":"matches"} for these filters. A completed zero-match session is not a failed job.</p>}
      <div className="research-table"><table><thead><tr><th>Ticker</th><th>EP</th><th>Setup</th><th>{kind==="scan"?"Intended entry":"Entry"}</th><th>Status</th><th>{kind==="scan"?metric:"Net R"}</th><th>Details</th></tr></thead><tbody>{rows.map((row,i)=><tr key={`${row.signal_id}-${i}`}><td><button onClick={()=>chart(row)}>{row.symbol}</button></td><td>{row.ep_date}</td><td>{row.setup_date}</td><td>{display(kind==="scan"?row.intended_entry_date:row.entry_date)}</td><td>{row.status}</td><td>{display(kind==="scan"?row.measurements?.[metric]:row.outcome_r)}</td><td><button onClick={()=>setDetail(row)}>Inspect</button></td></tr>)}</tbody></table></div>
      <div className="research-controls"><button disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><span>{total?offset+1:0}–{Math.min(offset+100,total)} of {total}</span><button disabled={offset+100>=total||loading} onClick={()=>setOffset(offset+100)}>Next</button></div>
      {detail&&<aside className="research-detail"><h2>{detail.symbol} · {detail.setup_date}</h2><button onClick={()=>chart(detail)}>Chart at setup close</button> <button disabled={!watch.ready} onClick={()=>watch.save(updateWatchlist(watch.value,detail.symbol,"add"))}>Add to watchlist</button><p role="status">{watch.error|| (watch.value.some(x=>x.symbol===detail.symbol)?"In shared watchlist":"")}</p>
      {detail.conditions&&<div className="research-table"><table><thead><tr><th>Condition</th><th>Observed</th><th>Required</th><th>Result</th></tr></thead><tbody>{detail.conditions.map(c=><tr key={c.condition}><td>{c.condition}</td><td>{display(c.observed)} {c.unit}</td><td>{c.operator} {display(c.threshold)}</td><td>{c.status}</td></tr>)}</tbody></table></div>}
      <details open><summary>All measurements / complete trade record</summary><pre>{JSON.stringify(detail,null,2)}</pre></details></aside>}
      </>}
    </>}
  </section>;
}
