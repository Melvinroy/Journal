"use client";
import type { ReactNode } from "react";
import { REPORT_TYPES, deliveryStatus, publication, reportHistory, timestamp, type Observation, type Report, type Schedule } from "../lib/catalyst-reports";

export function CatalystReports({reports,type,setType,reportId,setReportId,schedules,observations,now,diagnostic,themePanel,loading=false}: {
  reports:Report[];type:string;setType:(v:string)=>void;reportId:string;setReportId:(v:string)=>void;
  schedules:Schedule[];observations:Observation[];now:Date;diagnostic:string;themePanel:ReactNode;loading?:boolean;
}) {
  const history=reportHistory(reports,type);
  const active=reportId?history.find(r=>r.id===reportId):history[0];
  const unknown=reportHistory(reports,"Unknown");
  return <section className="catalyst-panel catalyst-report-controls" aria-label="Reports and delivery">
    <div className="catalyst-report-selectors">
      <div className="catalyst-window-switch" aria-label="Report type">{[...REPORT_TYPES,...(unknown.length?["Unknown"]:[])].map(t=><button type="button" key={t} aria-pressed={type===t} className={type===t?"active":""} onClick={()=>setType(t)}>{t}</button>)}</div>
      <label>Report history <select value={reportId} onChange={e=>setReportId(e.target.value)}><option value="">Latest available</option>{history.map(r=><option key={r.id} value={r.id}>{r.trading_date_checked} · {timestamp(publication(r))}{r.revision?` · revision ${r.revision}`:""}</option>)}</select></label>
    </div>
    <div className="catalyst-report-overview"><div>{active?<div className="catalyst-report-metadata" role="status">
      <strong>{type} · {active.trading_date_checked}</strong>
      <span>{active.id!==history[0]?.id?"Older report being shown":"Latest available report"} · {Math.max(0,Math.floor((now.getTime()-Date.parse(publication(active)))/3600000))}h since {active.published_at?"publication":"receipt"}</span>
      <span>Coverage: {active.coverage_start&&active.coverage_end?`${active.coverage_start} – ${active.coverage_end}`:active.coverage_window||"Not supplied"}</span>
      <span>Published: {active.published_at?timestamp(active.published_at):"Not recorded for this legacy report"} · Received: {timestamp(active.last_received_at||active.created_at)}</span>
      <span>Source: {active.source||"Not attributed in legacy metadata"}</span>
      <div className="catalyst-selected-brief"><span>Selected brief · generated {timestamp(active.generated_at_sgt)}</span><strong>{active.report_type}</strong><p>{active.best_focus||active.market_summary||"No focus note recorded."}</p></div>
    </div>:loading?<p role="status">Loading report history…</p>:<p role="status">No {type} report received{reportId?" for this selection":""}. No other report type is being shown.</p>}</div>{themePanel}</div>
    <details><summary>Delivery details and diagnostics</summary>
      <div className="catalyst-delivery-grid">{REPORT_TYPES.map(t=>{
        const schedule=schedules.find(s=>s.report_type===t), items=reportHistory(reports,t), events=observations.filter(o=>o.report_type===t);
        const state=deliveryStatus(schedule,items,events,now);
        const failures=events.filter(o=>o.status==="failed").sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));
        return <article key={t}><strong>{t}</strong>
          <span>{schedule?`${schedule.weekdays.map(d=>["","Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d]).join(", ")} ${schedule.local_time.slice(0,5)} · ${schedule.timezone}`:"Schedule / timezone: Not observable"}</span>
          <span>Next expected run: {timestamp(state.next)}</span>
          <span>Scheduler: {state.lastRun?`${state.lastRun.status} · ${timestamp(state.lastRun.observed_at)}`:"Not observable"}</span>
          {schedule?.last_observed_result&&<span>{schedule.last_observed_result}</span>}
          <span>{items[0]?.published_at?`Last published: ${timestamp(items[0].published_at)}`:items[0]?`Last received: ${timestamp(items[0].last_received_at||items[0].created_at)}`:"Last received: None"}</span>
          <span>{state.delivery}</span>
          {failures[0]&&<span className="negative">Recorded {failures[0].stage} failure · {timestamp(failures[0].observed_at)}</span>}
        </article>;
      })}</div>
      <p>A missing report does not establish a scheduler failure. Legacy receipts are not matched to scheduled runs without an explicit run identity.</p>{diagnostic&&<p>{diagnostic}</p>}
      {schedules.map(s=><p key={s.report_type}>{s.report_type}: {s.evidence} · tracked since {timestamp(s.effective_from)} · {s.grace_minutes==null?"Delivery deadline not configured":`delivery allowance ${s.grace_minutes} minutes`}.</p>)}
      {observations.length>0&&<p>Most recent observation for each delivery stage:</p>}
      {observations.map((o,i)=><p key={i}>{o.report_type} · {o.stage} · {o.status} · {timestamp(o.observed_at)}{o.summary?` · ${o.summary}`:""}</p>)}
      {active&&<p>Report ID: {active.id} · revision {active.revision??"legacy"} · generated {timestamp(active.generated_at_sgt)}</p>}
    </details>
  </section>;
}
