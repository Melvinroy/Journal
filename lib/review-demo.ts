import type { Plan } from "./trading-ledger";

export function demoStorageKey(key: string, demo: boolean) {
  return demo ? `brontide-demo-review:${key}` : key;
}

export const SAMPLE_PLANS: Plan[] = [
  {
    id: "sample-nvda", name: "Sample breakout", symbol: "NVDA", side: "Long",
    entry: 120, equity: 30000, riskPercent: .5, allocationPercent: 10,
    tranches: [{id:"A",percent:50,stop:116,target:128},{id:"B",percent:50,stop:116,target:null}],
    fills: [], notes: "Synthetic example for layout review.", revision: 1,
    context: {symbol:"NVDA",mode:"sample",adjustment:"all",asOf:"2026-09-03"},
    updatedAt: "2026-09-03T18:00:00Z",
  },
  {
    id: "sample-mrna", name: "Sample partial exit", symbol: "MRNA", side: "Short",
    entry: 90, equity: 30000, riskPercent: .5, allocationPercent: 10,
    tranches: [{id:"A",percent:100,stop:94,target:82}],
    fills: [
      {id:"sample-entry",trancheId:"A",action:"entry",quantity:20,price:90,fee:1,at:"2026-09-02T14:00:00Z",reason:"Manual",provenance:"manual"},
      {id:"sample-exit",trancheId:"A",action:"exit",quantity:10,price:85,fee:1,at:"2026-09-03T14:00:00Z",reason:"Manual",provenance:"manual"},
    ],
    notes: "Synthetic fills; no orders were sent.", revision: 1,
    context: {symbol:"MRNA",mode:"sample",adjustment:"all",asOf:"2026-09-03"},
    updatedAt: "2026-09-03T18:00:00Z",
  },
];

const sampleRows = [
  {symbol:"NVDA",setup_date:"2026-09-03",ep_date:"2026-08-27",status:"qualified",signal_id:"sample-nvda",strategy_id:"sample-3x-075",intended_entry_date:"2026-09-04",measurements:{rvol:.62,body_atr:.3,range_atr:.8},conditions:[{condition:"Setup RVOL",observed:.62,operator:"<=",threshold:.75,status:"Pass",unit:"x"}]},
  {symbol:"MRNA",setup_date:"2026-09-02",ep_date:"2026-08-26",status:"qualified",signal_id:"sample-mrna",strategy_id:"sample-3x-075",intended_entry_date:"2026-09-03",measurements:{rvol:.71,body_atr:.4,range_atr:.9},conditions:[{condition:"Setup RVOL",observed:.71,operator:"<=",threshold:.75,status:"Pass",unit:"x"}]},
];
export function sampleResearchRun(kind: "scan" | "backtest") {
  const rows = kind === "scan" ? sampleRows : sampleRows.map((row,i)=>({...row,status:"closed",entry_date:row.setup_date,exit_date:"2026-09-03",outcome_r:i===0?2:-1}));
  return {
    run_id: `sample-${kind}-v1`,
    manifest: {strategy:{id:"Synthetic layout example",version:"demo-v1"},start:"2026-09-01",end:"2026-09-03",adjustment:"all",source:"synthetic",data_fingerprint:"sample-only",universe_fingerprint:"sample-only",calendar_fingerprint:"sample-only"},
    summary: kind==="scan"?{qualified:2}:{closed:2,expectancy_r:.5,closed_trade_drawdown_r:1},
    sessions:[{session_date:"2026-09-01",candidates:0},{session_date:"2026-09-02",candidates:1},{session_date:"2026-09-03",candidates:1}],
    execution:{provenance:"Synthetic layout examples, not computed strategy performance"},
    freshness:{freshness:"sample",expected_session:"2026-09-03"},
    rows,
  };
}

// Same read contract as the local research API; never contacts the local service.
export async function getSampleResearchJson<T>(path:string, signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();
  const url=new URL(path,"https://sample.invalid");
  const kind=url.searchParams.get("kind")==="scan"||url.pathname.includes("sample-scan")?"scan":"backtest";
  const run=sampleResearchRun(kind);
  if(url.pathname.endsWith("/runs"))return {runs:[run]} as T;
  if(!url.pathname.endsWith("/rows"))return run as T;
  const symbol=url.searchParams.get("symbol")?.toUpperCase()??"";
  const session=url.searchParams.get("session");
  const key=url.searchParams.get("sort")==="symbol"?"symbol":"setup_date";
  const rows=run.rows.filter(row=>(!session||row.setup_date===session)&&row.symbol.includes(symbol))
    .sort((a,b)=>{
      const comparison=url.searchParams.get("sort")==="outcome_r"
        ? Number("outcome_r" in a?a.outcome_r:0)-Number("outcome_r" in b?b.outcome_r:0)
        : a[key].localeCompare(b[key]);
      return comparison*(url.searchParams.get("descending")==="true"?-1:1);
    });
  const offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??100);
  return {rows:rows.slice(offset,offset+limit),total:rows.length} as T;
}
