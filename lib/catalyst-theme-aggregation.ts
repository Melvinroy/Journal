import { publication, reportType, type Report, type ReportType } from "./catalyst-reports";

export const THEME_RANGES = ["selected", "1d", "3d", "1w", "2w"] as const;
export type ThemeRange = typeof THEME_RANGES[number];
export const THEME_RANGE_LABELS: Record<ThemeRange, string> = {
  selected: "Selected report", "1d": "1D", "3d": "3D", "1w": "1W", "2w": "2W",
};

export type ThemeRow = {
  report_id: string; ticker: string; theme: string; catalyst_quality_direction: string;
  catalyst_event_date?: string | null; reaction_date?: string | null;
};
export type ThemeCount = { theme: string; count: number };
export type ThemeWindow = {
  mode: ThemeRange; anchor: string | null; start: string | null; end: string | null;
  sessions: string[]; asOf: string | null; asOfBasis: "publication" | "receipt" | "unavailable";
};
export type ThemeAggregation = ThemeWindow & {
  bullish: ThemeCount[]; bearish: ThemeCount[]; sharedScale: number;
  contributingReportIds: string[]; contributingTypes: ReportType[];
  nonDirectionalTickerCount: number; ambiguousItemCount: number; undatedWeekendItemCount: number;
  missingSessions: string[]; coverageLimited: boolean; candidateLimitReached: boolean;
};

const DAY = 86400000;
const rangeSessions: Record<Exclude<ThemeRange,"selected">,number> = {"1d":1,"3d":3,"1w":5,"2w":10};
function iso(date: Date) { return date.toISOString().slice(0,10); }
function utcDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null; }
function addDays(value:string,days:number) { const date=utcDate(value); return date ? iso(new Date(date.getTime()+days*DAY)) : null; }
function observed(value:string) { const date=utcDate(value)!;const day=date.getUTCDay();return addDays(value,day===6?-1:day===0?1:0)!; }
function nthWeekday(year:number,month:number,weekday:number,n:number) { const first=new Date(Date.UTC(year,month-1,1));const offset=(weekday-first.getUTCDay()+7)%7;return iso(new Date(Date.UTC(year,month-1,1+offset+7*(n-1)))); }
function lastWeekday(year:number,month:number,weekday:number) { const last=new Date(Date.UTC(year,month,0));const offset=(last.getUTCDay()-weekday+7)%7;return iso(new Date(last.getTime()-offset*DAY)); }
function goodFriday(year:number) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return iso(new Date(Date.UTC(year,month-1,day-2)));
}
export function usMarketHolidays(year:number) {
  return new Set([
    observed(`${year}-01-01`), nthWeekday(year,1,1,3), nthWeekday(year,2,1,3), goodFriday(year),
    lastWeekday(year,5,1), observed(`${year}-06-19`), observed(`${year}-07-04`),
    nthWeekday(year,9,1,1), nthWeekday(year,11,4,4), observed(`${year}-12-25`),
  ]);
}
export function isUsMarketSession(value:string) {
  const date=utcDate(value);if(!date)return false;const day=date.getUTCDay();
  return day!==0&&day!==6&&!usMarketHolidays(date.getUTCFullYear()).has(value);
}
export function previousUsMarketSession(value:string) {
  let cursor=value;
  for(let i=0;i<10;i++){if(isUsMarketSession(cursor))return cursor;cursor=addDays(cursor,-1)??"";}
  return null;
}
export function usSessionWindow(anchor:string,count:number) {
  const sessions:string[]=[];let cursor=previousUsMarketSession(anchor);
  for(let i=0;cursor&&i<40&&sessions.length<count;i++){if(isUsMarketSession(cursor))sessions.push(cursor);cursor=addDays(cursor,-1);}
  return sessions.reverse();
}
export function reliableAsOf(report:Report) {
  if(report.published_at&&Number.isFinite(Date.parse(report.published_at)))return {value:report.published_at,basis:"publication" as const};
  const receipt=report.last_received_at||report.created_at;
  if(receipt&&Number.isFinite(Date.parse(receipt)))return {value:receipt,basis:"receipt" as const};
  return {value:null,basis:"unavailable" as const};
}
export function themeWindow(report:Report|undefined,mode:ThemeRange):ThemeWindow {
  if(!report)return {mode,anchor:null,start:null,end:null,sessions:[],asOf:null,asOfBasis:"unavailable"};
  const type=reportType(report.report_type), rawAnchor=type==="Weekend Summary"?report.coverage_end:report.trading_date_checked;
  const anchor=previousUsMarketSession(rawAnchor||"");const asOf=reliableAsOf(report);
  if(mode==="selected")return {mode,anchor,start:anchor,end:anchor,sessions:anchor?[anchor]:[],asOf:asOf.value,asOfBasis:asOf.basis};
  const sessions=anchor?usSessionWindow(anchor,rangeSessions[mode]):[];
  return {mode,anchor,start:sessions[0]??null,end:sessions.at(-1)??null,sessions,asOf:asOf.value,asOfBasis:asOf.basis};
}
function overlaps(report:Report,start:string,end:string) {
  if(report.coverage_start&&report.coverage_end)return report.coverage_start<=end&&report.coverage_end>=start;
  return reportType(report.report_type)!=="Weekend Summary"&&report.trading_date_checked>=start&&report.trading_date_checked<=end;
}
export function candidateThemeReports(reports:Report[],selected:Report|undefined,mode:ThemeRange,limit=100) {
  if(!selected)return {reports:[],limited:false};
  if(mode==="selected")return {reports:[selected],limited:false};
  const window=themeWindow(selected,mode);if(!window.start||!window.end||!window.asOf)return {reports:[],limited:false};
  const startLookback=addDays(window.start,-7)!;
  const eligible=reports.filter(report=>{
    if(reportType(report.report_type)==="Unknown")return false;
    const asOf=reliableAsOf(report).value;if(!asOf||Date.parse(asOf)>Date.parse(window.asOf!))return false;
    if(overlaps(report,window.start!,window.end!))return true;
    return reportType(report.report_type)==="Weekend Summary"&&report.id!==selected.id&&Date.parse(publication(report))>=Date.parse(`${startLookback}T00:00:00Z`);
  });
  if(reportType(selected.report_type)==="Weekend Summary"&&!eligible.some(r=>r.id===selected.id))eligible.push(selected);
  eligible.sort((a,b)=>Date.parse(publication(b))-Date.parse(publication(a))||a.id.localeCompare(b.id));
  return {reports:eligible.slice(0,limit),limited:eligible.length>limit};
}
function normalizeTheme(value:string) { return value.trim().replace(/\s+/g," ").toLocaleLowerCase("en-US"); }
function explicitDirection(value:string):"bullish"|"bearish"|"neutral" { return value.includes("Bullish")?"bullish":value.includes("Bearish")?"bearish":"neutral"; }
function rowDate(row:ThemeRow,report:Report,type:ReportType|"Unknown") {
  if(type!=="Weekend Summary")return isUsMarketSession(report.trading_date_checked)?report.trading_date_checked:null;
  const dates=[row.reaction_date,row.catalyst_event_date].filter((value):value is string=>!!value&&isUsMarketSession(value));
  return dates.sort().at(-1)??null;
}
export function aggregateThemes(reports:Report[],rows:ThemeRow[],selected:Report|undefined,mode:ThemeRange,candidateLimitReached=false):ThemeAggregation {
  const window=themeWindow(selected,mode), byReport=new Map(reports.map(report=>[report.id,report]));
  const eligible:Report[]=mode==="selected"?(selected?[selected]:[]):Array.from(byReport.values());
  const eligibleIds=new Set(eligible.map(report=>report.id));
  type Latest={theme:string;ticker:string;direction:"bullish"|"bearish"|"neutral";date:string;asOf:string;reportId:string;conflict:boolean};
  const latest=new Map<string,Latest>(), ambiguousTickers=new Set<string>(), undatedWeekendTickers=new Set<string>();
  for(const row of rows){
    const report=byReport.get(row.report_id);if(!report||!eligibleIds.has(row.report_id))continue;
    const theme=row.theme.trim().replace(/\s+/g," "),ticker=row.ticker.trim().toUpperCase();if(!theme||!ticker)continue;
    const type=reportType(report.report_type), date=mode==="selected"?(rowDate(row,report,type)||window.anchor||report.trading_date_checked):rowDate(row,report,type);
    if(!date){ambiguousTickers.add(ticker);if(type==="Weekend Summary")undatedWeekendTickers.add(ticker);continue;}
    if(mode!=="selected"&&(!window.start||!window.end||date<window.start||date>window.end))continue;
    const asOf=reliableAsOf(report).value;if(mode!=="selected"&&(!asOf||!window.asOf||Date.parse(asOf)>Date.parse(window.asOf))){ambiguousTickers.add(ticker);continue;}
    const direction=explicitDirection(row.catalyst_quality_direction),key=`${ticker}\u0000${normalizeTheme(theme)}`,next:Latest={theme,ticker,direction,date,asOf:asOf||"",reportId:report.id,conflict:false};
    const prior=latest.get(key);if(!prior){latest.set(key,next);continue;}
    const priorOrder=`${prior.date}\u0000${prior.asOf}`,nextOrder=`${next.date}\u0000${next.asOf}`;
    if(nextOrder>priorOrder)latest.set(key,next);
    else if(nextOrder===priorOrder&&next.direction!==prior.direction)latest.set(key,{...next,conflict:true});
  }
  const bullish=new Map<string,{label:string,tickers:Set<string>}>(),bearish=new Map<string,{label:string,tickers:Set<string>}>(),neutral=new Set<string>();
  for(const item of latest.values()){
    if(item.conflict){ambiguousTickers.add(item.ticker);continue;}
    if(item.direction==="neutral"){neutral.add(item.ticker);continue;}
    const target=item.direction==="bullish"?bullish:bearish,key=normalizeTheme(item.theme),entry=target.get(key)??{label:item.theme,tickers:new Set<string>()};entry.tickers.add(item.ticker);target.set(key,entry);
  }
  const list=(source:Map<string,{label:string,tickers:Set<string>}>)=>[...source.values()].map(item=>({theme:item.label,count:item.tickers.size})).sort((a,b)=>b.count-a.count||a.theme.localeCompare(b.theme));
  const bullishList=list(bullish),bearishList=list(bearish),covered=new Set<string>();
  if(mode!=="selected"&&window.start&&window.end)for(const report of eligible){
    if(report.coverage_start&&report.coverage_end)window.sessions.filter(day=>day>=report.coverage_start!&&day<=report.coverage_end!).forEach(day=>covered.add(day));
    else if(reportType(report.report_type)!=="Weekend Summary"&&window.sessions.includes(report.trading_date_checked))covered.add(report.trading_date_checked);
  }
  const contributingIds=new Set([...latest.values()].filter(item=>!item.conflict).map(item=>item.reportId));
  const contributingTypes=[...new Set([...contributingIds].map(id=>reportType(byReport.get(id)!.report_type)).filter((type):type is ReportType=>type!=="Unknown"))].sort((a,b)=>REPORT_ORDER.indexOf(a)-REPORT_ORDER.indexOf(b));
  return {...window,bullish:bullishList,bearish:bearishList,sharedScale:Math.max(1,...bullishList.map(x=>x.count),...bearishList.map(x=>x.count)),
    contributingReportIds:[...contributingIds],contributingTypes,nonDirectionalTickerCount:neutral.size,ambiguousItemCount:ambiguousTickers.size,
    undatedWeekendItemCount:undatedWeekendTickers.size,missingSessions:mode==="selected"?[]:window.sessions.filter(day=>!covered.has(day)),
    coverageLimited:mode!=="selected"&&(!window.anchor||!window.asOf),candidateLimitReached};
}
const REPORT_ORDER:ReportType[]=["Premarket","Postmarket","Weekend Summary"];
