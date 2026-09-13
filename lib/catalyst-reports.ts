export const REPORT_TYPES = ["Premarket", "Postmarket", "Weekend Summary"] as const;
export type ReportType = typeof REPORT_TYPES[number];
export type Report = {
  id: string; report_type: string; generated_at_sgt: string; created_at?: string;
  trading_date_checked: string; coverage_window?: string | null;
  coverage_start?: string | null; coverage_end?: string | null; published_at?: string | null;
  source?: string | null; report_key?: string | null; revision?: number;
  market_summary: string | null; themes_summary: string | null; best_focus: string | null;
  market_session_focus?: string | null; raw_report_text?: string | null;
  scheduled_for?: string | null; result_count?: number | null;
  last_received_at?: string | null;
};
// Exact producer labels verified in stored report headers, never inferred from dates.
export function reportType(value: string): ReportType | "Unknown" {
  const labels: Record<string, ReportType> = { "Premarket Catalyst Brief": "Premarket", "After-Market Catalyst Brief": "Postmarket", "Weekend Catalyst Summary": "Weekend Summary", Premarket: "Premarket", Postmarket: "Postmarket", "Weekend Summary": "Weekend Summary" };
  return labels[value] ?? "Unknown";
}
export function publication(report: Report) { return report.published_at || report.created_at || report.generated_at_sgt; }
export function reportHistory(reports: Report[], type: string) {
  return reports.filter(r => reportType(r.report_type) === type).sort((a,b) => Date.parse(publication(b))-Date.parse(publication(a)) || a.id.localeCompare(b.id));
}
export function defaultType(reports: Report[]): ReportType {
  const latest = [...reports].filter(r=>reportType(r.report_type)!=="Unknown").sort((a,b)=>Date.parse(publication(b))-Date.parse(publication(a)))[0];
  return latest ? reportType(latest.report_type) as ReportType : "Premarket";
}
export type Schedule = { report_type: ReportType; timezone: string; weekdays: number[]; local_time: string; grace_minutes: number | null; effective_from: string; evidence: string; last_observed_result?: string };
export type Observation = { report_type: ReportType; stage: "scheduler" | "generation" | "ingestion" | "publication"; status: "started" | "succeeded" | "failed"; observed_at: string; scheduled_for: string | null; summary: string | null };
// Enumerating UTC minutes makes DST skips and folds explicit; weekdays are ISO Mon=1.
export function scheduleRuns(schedule: Schedule | undefined, now: Date) {
  if (!schedule) return { previous: null, next: null };
  let fmt: Intl.DateTimeFormat;
  try {fmt = new Intl.DateTimeFormat("en-GB", { timeZone:schedule.timezone, weekday:"short", hour:"2-digit",minute:"2-digit",hourCycle:"h23" });}
  catch {return {previous:null,next:null};}
  if(!Array.isArray(schedule.weekdays)||!Number.isFinite(Date.parse(schedule.effective_from)))return {previous:null,next:null};
  const dayNames=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const start=Math.floor(now.getTime()/60000)*60000;
  let previous: string | null=null, next: string | null=null;
  for(let time=start-8*86400000;time<=start+8*86400000;time+=60000) {
    if(time<Date.parse(schedule.effective_from))continue;
    const p=Object.fromEntries(fmt.formatToParts(time).map(x=>[x.type,x.value]));
    if(!schedule.weekdays.includes(dayNames.indexOf(p.weekday)+1)||`${p.hour}:${p.minute}`!==schedule.local_time.slice(0,5))continue;
    if(time<=now.getTime())previous=new Date(time).toISOString();
    else {next=new Date(time).toISOString();break;}
  }
  return {previous,next};
}
export function deliveryStatus(schedule: Schedule | undefined, reports: Report[], observations: Observation[], now: Date) {
  const runs=scheduleRuns(schedule,now);
  const received=runs.previous && reports.some(r=>r.scheduled_for && Date.parse(r.scheduled_for)===Date.parse(runs.previous!));
  const receiptObservation=runs.previous && observations.some(o=>o.stage==="publication"&&o.status==="succeeded"&&o.scheduled_for&&Date.parse(o.scheduled_for)===Date.parse(runs.previous!));
  const unlinked=runs.previous && reports.some(r=>!r.scheduled_for&&Date.parse(publication(r))>=Date.parse(runs.previous!));
  const delivery=!runs.previous?(runs.next?"Awaiting next scheduled delivery":"Expected delivery unknown"):received||receiptObservation?"Received":unlinked?"Report received · scheduled run linkage unverified":schedule?.grace_minutes!=null&&now.getTime()>Date.parse(runs.previous)+schedule.grace_minutes*60000?"Late · expected report not yet received":"Expected report not yet received";
  const lastRun=[...observations].filter(o=>o.stage==="scheduler").sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0];
  return {...runs,delivery,lastRun};
}
export function timestamp(value?: string | null) {
  if(!value)return "Not available";
  const time=new Date(value);
  return Number.isNaN(time.getTime())?"Invalid timestamp":new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Singapore"}).format(time)+" SGT";
}
