"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./catalyst-reports.css";
import { supabase, supabaseConfig } from "../lib/supabase";
import { CATALYST_PROJECT_URL, OBSERVED_SCHEDULES, VERIFIED_REPORT_SOURCES } from "../lib/catalyst-schedule-evidence";
import type { MarketContext } from "../lib/workspace-state";
import { useModalAccessibility } from "./useModalAccessibility";

import { CatalystReports } from "./CatalystReports";
import { defaultType, reportHistory, type Report as CatalystReport, type Schedule, type Observation } from "../lib/catalyst-reports";
import { aggregateThemes, candidateThemeReports, THEME_RANGES, THEME_RANGE_LABELS, themeWindow, type ThemeRange } from "../lib/catalyst-theme-aggregation";
type Direction = "bullish" | "bearish" | "neutral";
type DirectionFilter = "all" | Direction;
type ReportView = "inventory" | "full";

type RawCatalystRow = {
  report_id: string;
  report_type: string;
  generated_at_sgt: string;
  row_order: number;
  ticker: string;
  catalyst_event_date: string | null;
  catalyst_quality_direction: string;
  primary_catalyst_category: string;
  catalyst_tags: string;
  catalyst_summary: string;
  sector: string;
  theme: string;
  direct_sympathy_sector_move: string;
  sympathy_related_tickers: string;
  catalyst_release_session: string;
  reaction_date: string | null;
  move_already_done: string;
  volume_liquidity_confirmation: string;
  freshness_catalyst_age: string;
  source_confidence: "High" | "Medium" | "Low" | string;
  primary_source_evidence: string;
  trade_read: string;
  risk_invalidator: string;
  action_priority: string;
  trading_date_checked: string;
};

type CatalystRow = RawCatalystRow & {
  appearances: number;
  direction: Direction;
};


type CatalystData = {
  asOfDate: string;
  rows: CatalystRow[];
  reports: CatalystReport[];
};


const ROW_COLUMNS = [
  "report_id", "report_type", "generated_at_sgt", "row_order", "ticker",
  "catalyst_event_date", "catalyst_quality_direction", "primary_catalyst_category",
  "catalyst_tags", "catalyst_summary", "sector", "theme",
  "direct_sympathy_sector_move", "sympathy_related_tickers",
  "catalyst_release_session", "reaction_date", "move_already_done",
  "volume_liquidity_confirmation", "freshness_catalyst_age", "source_confidence",
  "primary_source_evidence", "trade_read", "risk_invalidator", "action_priority",
  "trading_date_checked",
].join(",");

function directionFor(grade: string): Direction {
  if (grade.includes("Bullish")) return "bullish";
  if (grade.includes("Bearish")) return "bearish";
  return "neutral";
}

function gradeLabel(value: string) {
  if (value.startsWith("A+")) return "A+";
  if (value.startsWith("A ")) return "A";
  if (value.startsWith("B ")) return "B";
  if (value === "No Fresh Catalyst") return "NFC";
  if (value === "Sympathy / Continuation") return "CONT";
  return "N";
}

function classificationRank(value: string) {
  if (value.startsWith("A+")) return 0;
  if (value.startsWith("A ")) return 1;
  if (value.startsWith("B ")) return 2;
  return 3;
}

function SignalCard({ row }: { row: CatalystRow }) {
  return (
    <article tabIndex={0} aria-label={`${row.ticker} leadership catalyst`} className={`catalyst-signal-card signal-${row.direction}`}>
      <div className="catalyst-signal-main">
        <div className="catalyst-signal-line">
          <strong>{row.ticker}</strong>
          <span className={`catalyst-grade grade-${row.direction}`}>{row.catalyst_quality_direction}</span>
        </div>
        <p className="catalyst-signal-title">{row.primary_catalyst_category} · {row.theme}</p>
        <p className="catalyst-signal-summary">{row.catalyst_summary}</p>
        <p className="catalyst-trade-read">{row.trade_read}</p>
      </div>
    </article>
  );
}

function ThemePanel({range,setRange,aggregation,loading,error,onRetry}:{range:ThemeRange;setRange:(range:ThemeRange)=>void;aggregation:ReturnType<typeof aggregateThemes>;loading:boolean;error:string;onRetry:()=>void}) {
  const [showAll,setShowAll]=useState(false);
  useEffect(()=>setShowAll(false),[range]);
  const render=(items:typeof aggregation.bullish,direction:"bullish"|"bearish")=><div className={`catalyst-theme-column theme-${direction}`}><h3>{direction==="bullish"?"Bullish themes":"Bearish themes"}</h3>
    {items.slice(0,showAll?items.length:5).map(item=><div className="catalyst-theme-row" key={`${direction}-${item.theme}`}><div><strong>{item.theme}</strong><span>{item.count} ticker{item.count===1?"":"s"}</span></div><div className="catalyst-theme-bar"><i style={{width:`${item.count/aggregation.sharedScale*100}%`}}/></div></div>)}
    {!loading&&!error&&!items.length&&<p className="catalyst-theme-empty">No explicit {direction} themes.</p>}
  </div>;
  const limitation=range!=="selected"&&(!aggregation.anchor||!aggregation.asOf);
  return <section className="catalyst-theme-panel" aria-label="Theme concentration"><div className="catalyst-theme-head"><div><p className="eyebrow">Theme concentration</p><h2>Directional themes</h2></div>{(aggregation.bullish.length>5||aggregation.bearish.length>5)&&<button type="button" className="catalyst-theme-toggle" onClick={()=>setShowAll(value=>!value)}>{showAll?"Top 5":"Show all"}</button>}</div>
    <div className="catalyst-theme-ranges" role="group" aria-label="Theme range">{THEME_RANGES.map(item=><button type="button" key={item} className={range===item?"active":""} aria-pressed={range===item} onClick={()=>setRange(item)}>{THEME_RANGE_LABELS[item]}</button>)}</div>
    {loading?<p role="status">Loading theme history…</p>:error?<div className="catalyst-theme-error" role="status"><span>Theme history unavailable.</span><button type="button" onClick={onRetry}>Retry</button></div>:limitation?<p className="catalyst-theme-limit" role="status">This range needs structured coverage dates and a publication or receipt timestamp. The selected legacy report does not provide enough evidence.</p>:<><div className="catalyst-theme-columns">{render(aggregation.bullish,"bullish")}{render(aggregation.bearish,"bearish")}</div>
      <p className="catalyst-theme-caption">{range==="selected"?"Selected report":`${aggregation.start} – ${aggregation.end}`} · {aggregation.contributingReportIds.length} contributing report{aggregation.contributingReportIds.length===1?"":"s"}{aggregation.contributingTypes.length?` · ${aggregation.contributingTypes.join(", ")}`:""}</p>
      {range!=="selected"&&<p className="catalyst-theme-caption">As of {aggregation.asOfBasis}{aggregation.asOfBasis==="receipt"?" (publication unavailable)":""} · {aggregation.missingSessions.length} of {aggregation.sessions.length} sessions lack report coverage.</p>}
      {(aggregation.nonDirectionalTickerCount>0||aggregation.ambiguousItemCount>0||aggregation.undatedWeekendItemCount>0)&&<p className="catalyst-theme-caption">Excluded: {aggregation.nonDirectionalTickerCount} neutral/unclassified ticker{aggregation.nonDirectionalTickerCount===1?"":"s"}, {aggregation.ambiguousItemCount} ambiguous item{aggregation.ambiguousItemCount===1?"":"s"}{aggregation.undatedWeekendItemCount?`, including ${aggregation.undatedWeekendItemCount} undated weekend item${aggregation.undatedWeekendItemCount===1?"":"s"}`:""}.</p>}
    </>}
  </section>;
}

export function CatalystDashboard({onChart,demo=false}:{demo?:boolean;onChart?:(context:MarketContext)=>void}) {
  const selectionKey=demo?"brontide-catalyst-demo-session-v2":"brontide-catalyst-session-v2";
  const [choice,setChoice]=useState<{type:string;id:string}>({type:"",id:""});
  const [selectionReady,setSelectionReady]=useState(false);
  const [reportView,setReportView]=useState<ReportView>("inventory");
  const [schedules,setSchedules]=useState<Schedule[]>([]);
  const [observations,setObservations]=useState<Observation[]>([]);
  const [diagnostic,setDiagnostic]=useState("");
  const [now,setNow]=useState(()=>new Date());
  const detailRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    try {
      const saved=JSON.parse(window.sessionStorage.getItem(selectionKey)||"null") as {type?:unknown;id?:unknown}|null;
      if(saved&&typeof saved.type==="string"&&typeof saved.id==="string")setChoice({type:saved.type,id:saved.id});
    } catch { /* A failed session preference read must not block latest report selection. */ }
    setSelectionReady(true);
  },[selectionKey]);
  useEffect(()=>{if(demo)return;const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[demo]);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CatalystData | null>(null);
  const [selected, setSelected] = useState<CatalystRow | null>(null);
  useModalAccessibility(Boolean(selected), detailRef, () => setSelected(null));
  const [loading, setLoading] = useState(true);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [resultsError, setResultsError] = useState("");
  const [retry,setRetry] = useState(0);
  const [themeRange,setThemeRange]=useState<ThemeRange>("selected");
  const [themeRows,setThemeRows]=useState<{key:string;rows:CatalystRow[]}|null>(null);
  const [themeLoading,setThemeLoading]=useState(false);
  const [themeError,setThemeError]=useState("");
  useEffect(()=>{const refresh=()=>setRetry(v=>v+1);window.addEventListener("focus",refresh);return()=>window.removeEventListener("focus",refresh);},[]);

  useEffect(() => {
    let current = true;
    async function loadCatalysts() {
      setCatalogLoading(true);
      if(demo) {
        const rows: CatalystRow[] = ["NVDA","CRCL","AAPL","KNTK","AVAV","LONGTICKER","MRNA","COO","AEO","NAVN","BHVN"].map((ticker,index)=>({
          report_id:"sample-report", report_type:"Synthetic example", generated_at_sgt:"2026-09-03T20:00:00+08:00",
          row_order:index, ticker, catalyst_event_date:"2026-09-03", catalyst_quality_direction:index>=6?"A Bearish":"A Bullish",
          primary_catalyst_category:"Sample event", catalyst_tags:"Synthetic", catalyst_summary:"Fictional catalyst for dashboard review; not a report of actual company news.",
          sector:index>=6?"Healthcare":"Technology",theme:"Sample theme",direct_sympathy_sector_move:"Direct",sympathy_related_tickers:"",
          catalyst_release_session:"Pre-market",reaction_date:"2026-09-03",move_already_done:"Sample",volume_liquidity_confirmation:"Not assessed",
          freshness_catalyst_age:"Sample",source_confidence:"Low",primary_source_evidence:"Synthetic example; no external source",
          trade_read:"Review example only",risk_invalidator:"Not assessed",action_priority:"Watch",trading_date_checked:"2026-09-03",
          appearances:1,direction:index>=6?"bearish":"bullish",
        }));
        const reports:CatalystReport[]=[
          {id:"sample-report",report_type:"Premarket",trading_date_checked:"2026-09-03",generated_at_sgt:"2026-09-03T12:00:00Z",published_at:"2026-09-03T12:05:00Z",created_at:"2026-09-03T12:06:00Z",coverage_start:"2026-09-02",coverage_end:"2026-09-03",source:"Synthetic fixture",market_summary:"Fictional premarket report",themes_summary:null,best_focus:null,raw_report_text:"SYNTHETIC PREMARKET REPORT\n\nThis is fixture content for interface review. It is not market news.\n\nNVDA — fictional bullish example.\nMRNA — fictional bearish example.\nCRCL — fictional bullish example.",result_count:11},
          {id:"sample-post",report_type:"Postmarket",trading_date_checked:"2026-09-03",generated_at_sgt:"2026-09-04T00:30:00Z",published_at:"2026-09-04T00:35:00Z",source:"Synthetic fixture",coverage_start:"2026-09-03",coverage_end:"2026-09-03",market_summary:"Fictional empty report",themes_summary:null,best_focus:null,result_count:0},
          {id:"sample-weekend",report_type:"Weekend Summary",trading_date_checked:"2026-09-08",generated_at_sgt:"2026-09-06T12:30:00Z",published_at:"2026-09-06T12:35:00Z",source:"Synthetic fixture",coverage_start:"2026-09-03",coverage_end:"2026-09-06",market_summary:"Fictional weekend report",themes_summary:null,best_focus:null,result_count:1},
          {id:"sample-old",report_type:"Premarket",trading_date_checked:"2026-09-02",generated_at_sgt:"2026-09-02T12:00:00Z",published_at:"2026-09-02T12:05:00Z",source:"Synthetic fixture",market_summary:"Fictional historical report",themes_summary:null,best_focus:null,result_count:0},
        ];
        const scenario=new URLSearchParams(window.location.search).get("catalystFixture");
        const fixtureNow=new Date("2026-09-10T13:00:00Z");
        setNow(fixtureNow);
        const fixtureSchedule:Schedule={report_type:"Premarket",timezone:"Asia/Singapore",weekdays:[1,2,3,4,5],local_time:"20:30",grace_minutes:15,effective_from:"2026-09-01T00:00:00Z",evidence:"Synthetic delivery test configuration; not an external task"};
        setSchedules(scenario==="late"||scenario==="failure"?[fixtureSchedule]:[]);
        setObservations(scenario==="failure"?[
          {report_type:"Premarket",stage:"scheduler",status:"succeeded",observed_at:"2026-09-10T12:30:00Z",scheduled_for:"2026-09-10T12:30:00Z",summary:"Scheduler run completed"},
          {report_type:"Premarket",stage:"ingestion",status:"failed",observed_at:"2026-09-10T12:40:00Z",scheduled_for:"2026-09-10T12:30:00Z",summary:"Invalid report payload"},
        ]:[]);
        setData({asOfDate:"2026-09-03",rows:[...rows,{...rows[0],report_id:"sample-weekend",report_type:"Weekend Summary",ticker:"WEEK",generated_at_sgt:"2026-09-06T12:30:00Z",trading_date_checked:"2026-09-08"}],reports:scenario==="missing"?reports.filter(r=>r.report_type!=="Weekend Summary"):reports});setCatalogError("");setResultsError("");setLoading(false);return;
      }
      if (!supabase) {setData(null);setCatalogError("Catalyst feed is not connected.");setLoading(false);return;}
      setLoading(true);
      setCatalogError("");

      const reports: CatalystReport[]=[];
      const legacyColumns="id,report_type,generated_at_sgt,created_at,trading_date_checked,coverage_window,market_summary,themes_summary,best_focus";
      let reportColumns=legacyColumns+",report_key,source,coverage_start,coverage_end,published_at,scheduled_for,revision,result_count,last_received_at";
      for(let offset=0;;offset+=500) {
        let result=await supabase.from("catalyst_reports").select(reportColumns).order("created_at",{ascending:false}).order("id").range(offset,offset+499);
        if(result.error?.code==="42703"||result.error?.code==="PGRST204"){
          reportColumns=legacyColumns;
          result=await supabase.from("catalyst_reports").select(reportColumns).order("created_at",{ascending:false}).order("id").range(offset,offset+499);
        }
        if(!current)return;
        if(result.error)throw new Error("Reports unavailable");
        reports.push(...result.data as unknown as CatalystReport[]);
        if(result.data.length<500)break;
      }
      const [scheduleResult,eventResult]=await Promise.all([
        supabase.from("catalyst_report_schedules").select("*"),
        supabase.from("catalyst_delivery_status").select("report_type,stage,status,observed_at,scheduled_for,summary").order("observed_at",{ascending:false}),
      ]);
      if(!current)return;
      setSchedules(scheduleResult.data?.length?scheduleResult.data as Schedule[]:supabaseConfig.url===CATALYST_PROJECT_URL?OBSERVED_SCHEDULES:[]);
      setObservations(eventResult.error?[]:eventResult.data as Observation[]);
      setDiagnostic(scheduleResult.error||eventResult.error?"Live delivery telemetry is unavailable. Any observed schedule is a dated configuration snapshot, not a live scheduler connection.":"");
      setData({asOfDate:"",rows:[],reports:reports.map(r=>({...r,source:r.source||(supabaseConfig.url===CATALYST_PROJECT_URL?VERIFIED_REPORT_SOURCES[r.id]:null)}))});
      setLoading(false);
    }
    void loadCatalysts().catch(()=>{
      if(current){setCatalogError("Catalyst feed could not be refreshed. Any displayed report is from the last successful receipt. Retry the connection.");setLoading(false);}
    }).finally(()=>{if(current)setCatalogLoading(false);});
    return () => { current = false; };
  }, [demo,retry]);

  const type=choice.type||defaultType(data?.reports??[]);
  const reportId=choice.id;
  const history=reportHistory(data?.reports??[],type);
  const activeReport=reportId?history.find(r=>r.id===reportId):history[0];
  function choose(next:{type:string;id:string}) {
    setChoice(next);setSelected(null);
    try {window.sessionStorage.setItem(selectionKey,JSON.stringify(next));} catch { /* Current view remains usable without session storage. */ }
  }
  const [reportRows,setReportRows]=useState<{id:string;rows:CatalystRow[]}|null>(null);
  const [reportDetail,setReportDetail]=useState<{id:string;report:CatalystReport}|null>(null);
  useEffect(()=>{
    let current=true;setReportRows(null);setReportDetail(null);setResultsError("");setSelected(null);
    if(demo){setLoading(false);return;}
    if(!activeReport||!supabase){setLoading(false);return;}
    const client=supabase, id=activeReport.id;
    setLoading(true);
    void (async()=>{
      const collected:RawCatalystRow[]=[];
      const detailLegacyColumns="id,report_type,generated_at_sgt,created_at,trading_date_checked,coverage_window,market_summary,themes_summary,best_focus,market_session_focus,raw_report_text";
      let detail=await client.from("catalyst_reports").select(detailLegacyColumns+",report_key,source,coverage_start,coverage_end,published_at,scheduled_for,revision,result_count,last_received_at").eq("id",id).maybeSingle();
      if(detail.error?.code==="42703"||detail.error?.code==="PGRST204")detail=await client.from("catalyst_reports").select(detailLegacyColumns).eq("id",id).maybeSingle();
      if(!current)return;
      if(detail.error)throw new Error("Report detail unavailable");
      setReportDetail({id,report:(detail.data as unknown as CatalystReport)||activeReport});
      for(let offset=0;;offset+=500){
        const result=await client.from("catalyst_dashboard_rows").select(ROW_COLUMNS).eq("report_id",id).order("row_order").range(offset,offset+499);
        if(!current)return;
        if(result.error)throw new Error("Report rows unavailable");
        collected.push(...result.data as unknown as RawCatalystRow[]);
        if(result.data.length<500)break;
      }
      if(current){setReportRows({id,rows:collected.map(row=>({...row,appearances:1,direction:directionFor(row.catalyst_quality_direction)}))});setLoading(false);}
    })().catch(()=>{if(current){setResultsError("Selected report results could not be loaded.");setLoading(false);}});
    return()=>{current=false;};
  },[activeReport?.id,activeReport?.revision,demo,retry]);
  const rows = useMemo(() => demo ? (data?.rows??[]).filter(r=>r.report_id===activeReport?.id) : reportRows?.id===activeReport?.id ? reportRows?.rows??[] : [], [demo,data,reportRows,activeReport?.id]);
  const ranked = useMemo(() => [...rows].sort((a, b) => classificationRank(a.catalyst_quality_direction)-classificationRank(b.catalyst_quality_direction)||a.row_order-b.row_order), [rows]);
  const bullish = ranked.filter((row) => row.direction === "bullish");
  const bearish = ranked.filter((row) => row.direction === "bearish");
  const highConviction = rows.filter((row) => row.catalyst_quality_direction.startsWith("A") && row.source_confidence === "High").length;
  const directCount = rows.filter((row) => row.direct_sympathy_sector_move === "Direct").length;
  const resultsReady = demo || reportRows?.id===activeReport?.id;
  const latestReport = reportDetail&&reportDetail.id===activeReport?.id?reportDetail.report:activeReport??null;
  const themeCandidates=useMemo(()=>candidateThemeReports(data?.reports??[],latestReport??undefined,themeRange),[data?.reports,latestReport,themeRange]);
  const themeKey=`${latestReport?.id??"none"}:${latestReport?.revision??"legacy"}:${themeRange}:${retry}`;
  useEffect(()=>{
    let current=true;setThemeError("");
    if(themeRange==="selected"){setThemeLoading(false);setThemeRows(null);return;}
    const window=themeWindow(latestReport??undefined,themeRange);
    if(!window.start||!window.end||!window.asOf||!themeCandidates.reports.length){setThemeLoading(false);setThemeRows({key:themeKey,rows:[]});return;}
    if(demo){const ids=new Set(themeCandidates.reports.map(report=>report.id));setThemeRows({key:themeKey,rows:(data?.rows??[]).filter(row=>ids.has(row.report_id))});setThemeLoading(false);return;}
    if(!supabase){setThemeRows({key:themeKey,rows:[]});setThemeLoading(false);return;}
    setThemeLoading(true);setThemeRows(null);
    const client=supabase;
    void (async()=>{const collected:RawCatalystRow[]=[];const ids=themeCandidates.reports.map(report=>report.id);
      for(let index=0;index<ids.length;index+=20){const chunk=ids.slice(index,index+20);for(let offset=0;;offset+=500){const result=await client.from("catalyst_dashboard_rows").select(ROW_COLUMNS).in("report_id",chunk).order("report_id").order("row_order").range(offset,offset+499);if(!current)return;if(result.error)throw new Error("Theme rows unavailable");collected.push(...result.data as unknown as RawCatalystRow[]);if(result.data.length<500)break;}}
      if(current)setThemeRows({key:themeKey,rows:collected.map(row=>({...row,appearances:1,direction:directionFor(row.catalyst_quality_direction)}))});
    })().catch(()=>{if(current)setThemeError("Theme history could not be loaded.");}).finally(()=>{if(current)setThemeLoading(false);});
    return()=>{current=false;};
  },[data?.rows,demo,latestReport,themeCandidates.reports,themeKey,themeRange]);
  const aggregatedThemes=useMemo(()=>aggregateThemes(themeCandidates.reports,themeRange==="selected"?rows:(themeRows?.key===themeKey?themeRows.rows:[]),latestReport??undefined,themeRange,themeCandidates.limited),[latestReport,rows,themeCandidates,themeKey,themeRange,themeRows]);

  const filtered = useMemo(() => {
    const query = search.trim().toUpperCase();
    return ranked.filter((row) => {
      if (direction !== "all" && row.direction !== direction) return false;
      return !query || [row.ticker, row.theme, row.sector, row.primary_catalyst_category, row.catalyst_tags]
        .some((value) => value.toUpperCase().includes(query));
    });
  }, [direction, ranked, search]);

  return (
    <div className="catalyst-dashboard">
      <header className="catalyst-commandbar">
        <div><p className="eyebrow">Catalyst intelligence</p><h1>Executive signal board</h1><p>{demo?"Synthetic events for review.":"Ranked, de-duplicated signals from the canonical Catalyst_Table_v2 workflow."}</p></div>
        <div className="catalyst-command-actions">
          <button className="secondary-button" type="button" onClick={()=>setRetry(v=>v+1)} disabled={loading||catalogLoading}>Refresh reports</button>

        </div>
      </header>

      {demo&&<p className="workspace-notice">Sample catalysts · fictional events, not market news.</p>}
      <CatalystReports loading={catalogLoading||!selectionReady} reports={data?.reports??[]} type={type} setType={value=>choose({type:value,id:""})} reportId={reportId} setReportId={id=>choose({type,id})} schedules={schedules} observations={observations} now={now} diagnostic={diagnostic} themePanel={<ThemePanel range={themeRange} setRange={setThemeRange} aggregation={aggregatedThemes} loading={themeLoading||(themeRange==="selected"&&loading)} error={themeRange==="selected"?resultsError:themeError} onRetry={()=>setRetry(value=>value+1)}/>}/>
      {catalogError && <div className="catalyst-banner" role="status">{catalogError} <button onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}

      <div className="catalyst-view-switch" aria-label="Report view">
        <button type="button" className={reportView==="inventory"?"active":""} aria-pressed={reportView==="inventory"} onClick={()=>setReportView("inventory")}>Ticker inventory</button>
        <button type="button" className={reportView==="full"?"active":""} aria-pressed={reportView==="full"} onClick={()=>setReportView("full")}>Full report</button>
      </div>

      {reportView==="inventory"?<>
      <section className="catalyst-kpi-grid" aria-label="Catalyst statistics">
        <article className="catalyst-kpi"><span>Active names</span><strong>{resultsReady?rows.length:"—"}</strong><small>{resultsReady?(activeReport?"Selected report":"No report selected"):"Results unavailable"}</small></article>
        <article className="catalyst-kpi positive-card"><span>Bullish</span><strong>{resultsReady?bullish.length:"—"}</strong><small>{resultsReady?`${bullish.filter((row) => row.catalyst_quality_direction.startsWith("A")).length} A-tier`:"Results unavailable"}</small></article>
        <article className="catalyst-kpi negative-card"><span>Bearish</span><strong>{resultsReady?bearish.length:"—"}</strong><small>{resultsReady?`${bearish.filter((row) => row.catalyst_quality_direction.startsWith("A")).length} A-tier`:"Results unavailable"}</small></article>
        <article className="catalyst-kpi"><span>High conviction</span><strong>{resultsReady?highConviction:"—"}</strong><small>{resultsReady?"High confidence · A-tier":"Results unavailable"}</small></article>
        <article className="catalyst-kpi"><span>Direct</span><strong>{resultsReady?directCount:"—"}</strong><small>{resultsReady?`${rows.length?Math.round((directCount/rows.length)*100):0}% of inventory`:"Results unavailable"}</small></article>
      </section>

      {resultsError?<section className="catalyst-panel catalyst-results-error" role="status"><div><p className="eyebrow">Ticker results unavailable</p><h2>Report commentary is still available</h2><p>The ticker inventory request failed. Retry without leaving this report.</p></div><button className="secondary-button" type="button" onClick={()=>setRetry(value=>value+1)}>Retry results</button></section>:<section className="catalyst-leadership-grid">
        <article className="catalyst-panel catalyst-leader-panel">
          <div className="catalyst-panel-head"><div><p className="eyebrow">Leadership</p><h2>Bullish priority</h2></div><span className="catalyst-count positive">{bullish.length}</span></div>
          <div className="catalyst-signal-stack" role="region" aria-label="All bullish leadership catalysts" tabIndex={0}>{bullish.map((row) => <SignalCard key={row.ticker} row={row}/>)}</div>
        </article>
        <article className="catalyst-panel catalyst-leader-panel">
          <div className="catalyst-panel-head"><div><p className="eyebrow">Risk board</p><h2>Bearish priority</h2></div><span className="catalyst-count negative">{bearish.length}</span></div>
          <div className="catalyst-signal-stack" role="region" aria-label="All bearish leadership catalysts" tabIndex={0}>{bearish.map((row) => <SignalCard key={row.ticker} row={row}/>)}</div>
        </article>
      </section>}

      <section className="catalyst-panel catalyst-table-panel">
        <div className="catalyst-table-toolbar">
          <div><p className="eyebrow">Canonical inventory</p><h2>Signal scanner</h2></div>
          <div className="catalyst-filterbar">
            {(["all", "bullish", "bearish", "neutral"] as DirectionFilter[]).map((item) => <button type="button" key={item} className={direction === item ? "active" : ""} onClick={() => setDirection(item)}>{item}</button>)}
            <input aria-label="Search catalyst inventory" placeholder="Ticker, theme or sector" value={search} onChange={(event) => setSearch(event.target.value)}/>
          </div>
        </div>
        <div className="catalyst-table-wrap">
          <table className="catalyst-table">
            <thead><tr><th>Classification</th><th>Ticker</th><th>Grade</th><th>Catalyst</th><th>Theme</th><th>Move</th><th>Freshness</th><th>Source confidence</th><th>Action</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={row.ticker} className={`row-${row.direction}`} tabIndex={0} aria-label={`Open ${row.ticker} catalyst detail`} onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }}>
              <td><b>{row.catalyst_quality_direction}</b></td>
              <td><button type="button" className="catalyst-ticker" onClick={()=>setSelected(row)} aria-label={`Open ${row.ticker} catalyst detail`}>{row.ticker}</button>{row.appearances > 1 && <small>{row.appearances}×</small>}</td>
              <td><span className={`catalyst-grade grade-${row.direction}`}>{gradeLabel(row.catalyst_quality_direction)}</span></td>
              <td><strong>{row.primary_catalyst_category}</strong><small>{row.direct_sympathy_sector_move}</small></td>
              <td>{row.theme}</td><td>{row.move_already_done}</td><td>{row.freshness_catalyst_age}</td><td>{row.source_confidence}</td><td>{row.action_priority}</td>
            </tr>)}</tbody>
          </table>
          {(loading||catalogLoading) && <div className="catalyst-empty">Loading catalyst intelligence…</div>}
          {!loading && !catalogLoading && !filtered.length && <div className="catalyst-empty">{resultsError?"Ticker results unavailable. Report text remains accessible in Full report.":!activeReport?`No ${type} report received.`:rows.length?"No catalysts match these filters.":activeReport.result_count===0?"Published report · zero qualifying results.":resultsReady?"No inventory rows received. Legacy report completeness is not recorded.":"Ticker results unavailable."}</div>}
        </div>
      </section>
      </>:<section className="catalyst-panel catalyst-full-report" aria-label="Full selected report">
        <div className="catalyst-panel-head"><div><p className="eyebrow">Full report</p><h2>{latestReport?`${type} · ${latestReport.trading_date_checked}`:"No report selected"}</h2></div></div>
        {loading||catalogLoading?<p role="status">Loading the full report…</p>:!latestReport?<p>No {type} report is available. No other report type is being shown.</p>:latestReport.raw_report_text?<pre>{latestReport.raw_report_text}</pre>:<div className="catalyst-full-unavailable"><strong>Full narrative unavailable for this report.</strong><p>This record does not contain the producer’s original report text. The dashboard will not reconstruct it from ticker rows.</p>{latestReport.market_summary&&<><h3>Stored market summary</h3><p>{latestReport.market_summary}</p></>}{latestReport.themes_summary&&<><h3>Stored themes</h3><p>{latestReport.themes_summary}</p></>}{latestReport.best_focus&&<><h3>Stored focus</h3><p>{latestReport.best_focus}</p></>}</div>}
      </section>}

      {selected && <div className="catalyst-detail-backdrop" role="presentation" onClick={() => setSelected(null)}><aside ref={detailRef} tabIndex={-1} className="catalyst-detail" role="dialog" aria-modal="true" aria-label={`${selected.ticker} catalyst detail`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="catalyst-detail-close" aria-label="Close catalyst detail" onClick={() => setSelected(null)}>×</button>
        <div className="catalyst-detail-top"><span className={`catalyst-grade grade-${selected.direction}`}>{selected.catalyst_quality_direction}</span><span>{selected.source_confidence} source confidence</span></div>
        <h2>{selected.ticker}</h2><h3>{selected.primary_catalyst_category} · {selected.theme}</h3>
        <p>Report generated {selected.generated_at_sgt} SGT · event date {selected.catalyst_event_date??"not supplied"}. Report generation is not the source publication time.</p>
        {onChart&&<button onClick={()=>onChart({symbol:selected.ticker,mode:!demo&&process.env.NEXT_PUBLIC_BRONTIDE_LOCAL==="1"?"local":"sample",adjustment:"all",asOf:selected.trading_date_checked})}>Open chart at report session</button>}
        {(selected.primary_source_evidence.match(/https?:\/\/[^\s<>"\)]+/g)??[]).map((url,i)=><p key={`${url}-${i}`}><a href={url} target="_blank" rel="noopener noreferrer">Source evidence {i+1}</a></p>)}
        <div className="catalyst-detail-section"><span>Catalyst</span><p>{selected.catalyst_summary}</p></div>
        <div className="catalyst-detail-section"><span>Trade read</span><p>{selected.trade_read}</p></div>
        <div className="catalyst-detail-section risk"><span>Risk / invalidator</span><p>{selected.risk_invalidator}</p></div>
        <dl className="catalyst-detail-grid"><div><dt>Move</dt><dd>{selected.move_already_done}</dd></div><div><dt>Liquidity</dt><dd>{selected.volume_liquidity_confirmation}</dd></div><div><dt>Freshness</dt><dd>{selected.freshness_catalyst_age}</dd></div><div><dt>Source</dt><dd>{selected.primary_source_evidence}</dd></div><div><dt>Session</dt><dd>{selected.catalyst_release_session}</dd></div><div><dt>Related</dt><dd>{selected.sympathy_related_tickers}</dd></div><div><dt>Sector</dt><dd>{selected.sector}</dd></div><div><dt>Tags</dt><dd>{selected.catalyst_tags}</dd></div><div><dt>Action</dt><dd>{selected.action_priority}</dd></div><div><dt>Reaction date</dt><dd>{selected.reaction_date||"Not supplied"}</dd></div></dl>
      </aside></div>}
    </div>
  );
}
