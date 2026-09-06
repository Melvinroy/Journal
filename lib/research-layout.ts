export type ResearchLayout = {id:string;name:string;registry:string[];trades:string[];kpis:string[];widths:Record<string,number>};
export type ResearchLayouts = {version:1;active:string;layouts:ResearchLayout[]};
export const headlineDefaults = ["closed","expectancy_r","win_rate","closed_trade_drawdown_r"];
const registry = ["closed","win_rate","expectancy_r","profit_factor_r","closed_trade_drawdown_r"];
export const researchPresets: Record<string, {registry:string[];trades:string[]}> = {
  Overview:{registry,trades:["status","setup_date","entry_date","exit_date","outcome_r","exit_reason"]},
  Outcomes:{registry:["closed","expectancy_r","median_r","win_rate","average_win_r","average_loss_r","profit_factor_r"],trades:["status","outcome_r","outcome_percent","hold_sessions","mfe_r","mae_r"]},
  "Setup quality":{registry:["signals","closed","win_rate","expectancy_r"],trades:["setup_date","setup.rvol","setup.ep_rvol","setup.body_atr","setup.range_atr","setup.ep_age","setup.distance_post_ep_high_atr"]},
  Execution:{registry:["entered","closed","open","unresolved","ambiguous_count","average_hold_sessions"],trades:["entry_date","entry","stop","target","exit_date","exit","fees_per_share","hold_sessions","exit_reason","ambiguous"]},
};
export const initialResearchLayouts: ResearchLayouts = {version:1,active:"default",layouts:[{id:"default",name:"My overview",...researchPresets.Overview,kpis:headlineDefaults,widths:{}}]};
export function validResearchLayouts(value:unknown):value is ResearchLayouts {
  if(!value||typeof value!=="object")return false;
  const v=value as ResearchLayouts;
  return v.version===1&&Array.isArray(v.layouts)&&v.layouts.length>0&&v.layouts.length<=100&&new Set(v.layouts.map(x=>x.id)).size===v.layouts.length&&v.layouts.some(x=>x.id===v.active)&&v.layouts.every(x=>
    typeof x.id==="string"&&typeof x.name==="string"&&x.name.trim().length>0&&x.name.length<=80&&[x.registry,x.trades,x.kpis].every(a=>Array.isArray(a)&&a.every(k=>typeof k==="string")&&new Set(a).size===a.length)&&x.kpis.length===4&&!!x.widths&&typeof x.widths==="object"&&Object.values(x.widths).every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=90&&n<=400));
}
export function moveColumn(columns:string[],index:number,direction:number) {
  const next=[...columns],to=index+direction;
  if(index<0||index>=next.length||to<0||to>=next.length)return next;
  [next[index],next[to]]=[next[to],next[index]];return next;
}
