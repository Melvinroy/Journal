import type { MarketContext } from "./workspace-state";
export type Tranche = {id:string;percent:number;stop:number;target:number|null;progressAfter?:string;progressStop?:number};
export type Fill = {id:string;trancheId:string;action:"entry"|"exit";quantity:number;price:number;fee:number;at:string;reason:string;provenance:"manual"};
export type Plan = {id:string;name:string;symbol:string;side:"Long"|"Short";entry:number;equity:number;riskPercent:number;allocationPercent:number;tranches:Tranche[];fills:Fill[];notes:string;revision:number;context?:MarketContext;updatedAt:string};
export type PlanRevision = {revision:number;savedAt:string;plan:Plan};
export const PLANS_KEY="brontide-plans-v1";
const positive=(x:number)=>Number.isFinite(x)&&x>0;
export function allocate(total:number,weights:number[]):number[] {
  if(!Number.isSafeInteger(total)||total<0||!weights.length||weights.some(w=>!positive(w))||Math.abs(weights.reduce((a,b)=>a+b,0)-100)>1e-8)throw new Error("Positive allocations must total 100%.");
  const result=weights.map(w=>Math.floor(total*w/100));
  const order=weights.map((w,i)=>({i,remainder:total*w/100-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  for(let i=0,left=total-result.reduce((a,b)=>a+b,0);i<left;i++)result[order[i].i]++;
  return result;
}
export function sizePlan(plan:Plan) {
  if(!/^[A-Z][A-Z0-9./-]{0,31}$/.test(plan.symbol.trim().toUpperCase())||!plan.name.trim()||![plan.entry,plan.equity,plan.riskPercent,plan.allocationPercent].every(positive)||plan.riskPercent>100||plan.allocationPercent>100)throw new Error("Enter a name, ticker, positive prices and account limits up to 100%.");
  if(!["Long","Short"].includes(plan.side)||!plan.tranches.length||new Set(plan.tranches.map(t=>t.id)).size!==plan.tranches.length)throw new Error("Invalid direction or tranche IDs.");
  const direction=plan.side==="Long"?1:-1;
  for(const t of plan.tranches){
    if(!positive(t.stop)||direction*(plan.entry-t.stop)<=0)throw new Error("Every protective stop must be on the loss side of entry.");
    if(t.target!==null&&(!positive(t.target)||direction*(t.target-plan.entry)<=0))throw new Error("Targets must be on the profit side; leave blank for a runner.");
    if(t.progressAfter){
      const trigger=plan.tranches.find(x=>x.id===t.progressAfter);
      if(!trigger||trigger.id===t.id||trigger.target===null||!positive(t.progressStop??0)||direction*((t.progressStop??0)-t.stop)<0||direction*((trigger.target??0)-(t.progressStop??0))<=0)throw new Error("Progression needs another tranche's target and a tighter stop below that target for longs (above for shorts).");
    }
  }
  allocate(0,plan.tranches.map(t=>t.percent));
  const budget=plan.equity*plan.riskPercent/100;
  const weighted=plan.tranches.reduce((sum,t)=>sum+Math.abs(plan.entry-t.stop)*t.percent/100,0);
  const allocationCap=Math.floor(plan.equity*plan.allocationPercent/100/plan.entry);
  let shares=Math.min(Math.floor(budget/weighted),allocationCap);
  if(!Number.isSafeInteger(shares))throw new Error("Position size exceeds safe integer range.");
  let quantities=allocate(shares,plan.tranches.map(t=>t.percent));
  const risk=()=>quantities.reduce((sum,q,i)=>sum+q*Math.abs(plan.entry-plan.tranches[i].stop),0);
  // Rounding can increase risk; reduce until both hard caps are respected.
  let adjustments=0;
  while(shares>0&&risk()>budget+1e-8){if(++adjustments>1000)throw new Error("Extreme allocation rounding: simplify tranche percentages or reduce the position limits.");shares--;quantities=allocate(shares,plan.tranches.map(t=>t.percent));}
  if(shares<1)throw new Error("Limits do not permit one share.");
  return {shares,quantities,risk:risk(),budget,capital:shares*plan.entry};
}
export function position(plan:Plan){
  const sized=sizePlan(plan),direction=plan.side==="Long"?1:-1;
  const tranches=plan.tranches.map((t,i)=>({...t,planned:sized.quantities[i],entered:0,exited:0,remaining:0,average:0,realized:0,fees:0,targetExited:0,activeStop:t.stop}));
  const ids=new Set<string>();let previous="";
  for(const fill of plan.fills){
    if(ids.has(fill.id)||!Number.isSafeInteger(fill.quantity)||fill.quantity<=0||!positive(fill.price)||!Number.isFinite(fill.fee)||fill.fee<0||!Number.isFinite(Date.parse(fill.at))||fill.at<previous||fill.provenance!=="manual"||!fill.reason.trim())throw new Error("Invalid, duplicate or unordered fill.");
    ids.add(fill.id);previous=fill.at;
    const t=tranches.find(t=>t.id===fill.trancheId);if(!t)throw new Error("Unknown fill tranche.");
    if(fill.action==="entry"){
      if(t.entered+fill.quantity>t.planned)throw new Error("Entry exceeds planned tranche shares.");
      t.average=(t.average*t.remaining+fill.price*fill.quantity)/(t.remaining+fill.quantity);t.entered+=fill.quantity;t.remaining+=fill.quantity;
    }else if(fill.action==="exit"){
      if(fill.quantity>t.remaining)throw new Error("Exit exceeds open shares; protection and targets are alternatives.");
      t.realized+=direction*(fill.price-t.average)*fill.quantity;t.exited+=fill.quantity;t.remaining-=fill.quantity;
      if(fill.reason==="Target")t.targetExited+=fill.quantity;
    }else throw new Error("Unknown fill action.");
    t.fees+=fill.fee;
  }
  for(const t of tranches)if(t.progressAfter){const trigger=tranches.find(x=>x.id===t.progressAfter)!;if(trigger.planned>0&&trigger.targetExited>=trigger.planned)t.activeStop=t.progressStop!;}
  const entered=tranches.reduce((s,t)=>s+t.entered,0),remaining=tranches.reduce((s,t)=>s+t.remaining,0);
  return {...sized,tranches,entered,remaining,realized:tranches.reduce((s,t)=>s+t.realized-t.fees,0),status:entered===0?"Planned":remaining===0?"Closed":entered<sized.shares?"Partially filled":"Open"};
}
export function appendFill(plan:Plan,fill:Fill):Plan {const next={...plan,fills:[...plan.fills,fill],revision:plan.revision+1};position(next);return next;}
export function validatePlans(value:unknown):value is Plan[]{
  if(!Array.isArray(value))return false;
  try {for(const plan of value){if(!plan||typeof plan.id!=="string"||!Array.isArray(plan.fills)||!Array.isArray(plan.tranches))return false;position(plan);}return new Set(value.map(p=>p.id)).size===value.length;}catch{return false;}
}
