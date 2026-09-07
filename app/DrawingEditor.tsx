"use client";
import { useState } from "react";
import { anchoredVWAPBands, contractionMetrics, drawingEvidence, regressionChannel, riskRewardDetails, type Drawing, type StudyBar } from "../lib/drawing-workspace";

type ToolSettings = { text?:string; label?:string; extendLeft?:boolean; extendRight?:boolean; fillOpacity?:number; ratios?:number[]; targets?:number[]; accountSize?:number; riskPercent?:number; bands?:0|1|2; deviation?:1|2; showStatistics?:boolean; fontSize?:number; alignment?:"left"|"center"|"right"; background?:boolean; setupStart?:number; pivot?:number };
const asSettings = (value:unknown):ToolSettings => value && typeof value === "object" && !Array.isArray(value) ? value as ToolSettings : typeof value === "string" ? {text:value} : {};
const annotationNames = new Set(["simpleAnnotation","simpleTag","brontide-text","brontide-callout"]);

export function DrawingEditor({ drawing, bars, unavailable, update, remove, sendToPlan }: {
  drawing: Drawing; bars: StudyBar[]; unavailable: boolean;
  update: (id: string, patch: Partial<Drawing>) => boolean; remove: (id: string) => boolean; sendToPlan?: (draft:{entry:number;stop:number;targets:number[]})=>void;
}) {
  const initial=asSettings(drawing.extendData), [message,setMessage]=useState(""), [config,setConfig]=useState(initial);
  const [anchors,setAnchors]=useState(drawing.points.map(p=>({date:p.timestamp?new Date(p.timestamp).toISOString().slice(0,10):"",price:p.value?.toString()??""})));
  const [displayName,setDisplayName]=useState(drawing.displayName??"");
  const lineKind=drawing.styles?.line?.style==="solid"?"solid":drawing.styles?.line?.dashedValue?.[0]===2?"dotted":"dashed";
  const saveConfig=(patch:Partial<ToolSettings>)=>{const next={...config,...patch};setConfig(next);return update(drawing.id,{extendData:drawing.name.startsWith("brontide-")?next:next.text??""});};
  const evidence=()=>{
    if(unavailable)return "Anchors are outside loaded history, or this tool is unavailable. The saved drawing is retained.";
    try {
      if(drawing.name==="brontide-position"){const r=riskRewardDetails(drawing.points,config);return `${drawingEvidence(drawing,bars)}${r.shares===undefined?"":` · ${r.shares} shares at ${r.allowedRisk!.toFixed(2)} risk`}`;}
      if(drawing.name==="brontide-vwap"){const latest=anchoredVWAPBands(drawing.points[0]?.timestamp,bars).at(-1);return latest?.value===undefined?"Unavailable: complete positive volume is required.":`Anchor ${new Date(drawing.points[0].timestamp!).toISOString().slice(0,10)} · VWAP ${latest.value.toFixed(2)} · σ ${latest.deviation!.toFixed(2)}`;}
      if(drawing.name==="brontide-regression"){const r=regressionChannel(drawing.points,bars);return `${r.period} bars · slope ${r.slope.toFixed(3)} · R² ${r.rSquared.toFixed(3)} · σ ${r.sigma.toFixed(2)}`;}
      return drawingEvidence(drawing,bars);
    } catch(error){return `Unavailable: ${(error as Error).message}`;}
  };
  const annotation=annotationNames.has(drawing.name), customAnnotation=["brontide-text","brontide-callout"].includes(drawing.name);
  return <>
    <p role="status">{evidence()}</p>
    <label>Name<input aria-label="Drawing name" maxLength={80} value={displayName} placeholder="Automatic name" onChange={event=>setDisplayName(event.target.value)} onBlur={()=>update(drawing.id,{displayName:displayName.trim()||undefined})}/></label>
    <label><input type="checkbox" checked={drawing.lock} onChange={e=>update(drawing.id,{lock:e.target.checked})}/>Lock drawing</label>
    <label><input type="checkbox" checked={drawing.visible} onChange={e=>update(drawing.id,{visible:e.target.checked})}/>Show drawing</label>
    <fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Appearance</legend>
      <label>Color<input aria-label="Drawing color" type="color" value={drawing.styles?.line?.color?.startsWith("#")?drawing.styles.line.color:"#4586c9"} onChange={e=>update(drawing.id,{styles:{...drawing.styles,line:{...drawing.styles?.line,color:e.target.value},text:{...drawing.styles?.text,color:e.target.value}}})}/></label>
      <label>Width<select aria-label="Drawing width" value={drawing.styles?.line?.size??2} onChange={e=>update(drawing.id,{styles:{...drawing.styles,line:{...drawing.styles?.line,size:Number(e.target.value)}}})}>{[1,2,3,4,8,14].map(n=><option key={n} value={n}>{n}px</option>)}</select></label>
      <label>Line<select aria-label="Drawing line style" value={lineKind} onChange={e=>update(drawing.id,{styles:{...drawing.styles,line:{...drawing.styles?.line,style:e.target.value==="solid"?"solid":"dashed",dashedValue:e.target.value==="dotted"?[2,3]:[6,4]}}})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
    </fieldset>
    {drawing.name==="brontide-info"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Line</legend><label>Label<input value={config.label??""} onChange={e=>setConfig(v=>({...v,label:e.target.value}))} onBlur={()=>saveConfig({label:config.label})}/></label></fieldset>}
    {drawing.name==="brontide-flat-channel"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Channel</legend><label>Fill opacity<input type="range" min="0" max="40" value={config.fillOpacity??8} onChange={e=>saveConfig({fillOpacity:Number(e.target.value)})}/></label></fieldset>}
    {drawing.name==="brontide-regression"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Regression channel</legend><label>Deviation<select value={config.deviation??1} onChange={e=>saveConfig({deviation:Number(e.target.value) as 1|2})}><option value="1">±1σ</option><option value="2">±2σ</option></select></label><label><input type="checkbox" checked={config.showStatistics!==false} onChange={e=>saveConfig({showStatistics:e.target.checked})}/>Show slope, period, R² and deviation</label></fieldset>}
    {drawing.name==="brontide-fib-extension"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Fibonacci extension</legend><label>Ratios<input aria-label="Fibonacci ratios" value={(config.ratios??[0,.618,1,1.618,2.618]).join(", ")} onChange={e=>setConfig(v=>({...v,ratios:e.target.value.split(",").map(Number).filter(Number.isFinite)}))} onBlur={()=>saveConfig({ratios:config.ratios})}/></label><p>Comma-separated ratios. Labels remain visible on the chart.</p></fieldset>}
    {drawing.name==="brontide-position"&&<RiskSettings drawing={drawing} config={config} save={saveConfig} sendToPlan={sendToPlan}/>}
    {drawing.name==="brontide-vwap"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Anchored VWAP</legend><label>Bands<select value={config.bands??0} onChange={e=>saveConfig({bands:Number(e.target.value) as 0|1|2})}><option value="0">VWAP only</option><option value="1">±1 weighted σ</option><option value="2">±1 and ±2 weighted σ</option></select></label><p>HLC3 weighted by volume. Moving the anchor recalculates forward.</p></fieldset>}
    {drawing.name==="brontide-contraction"&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Setup context</legend><label>Setup start<input type="date" value={config.setupStart?new Date(config.setupStart).toISOString().slice(0,10):""} onChange={e=>saveConfig({setupStart:bars.find(bar=>new Date(bar.timestamp).toISOString().slice(0,10)===e.target.value)?.timestamp})}/></label><label>Pivot / breakout<input type="date" value={config.pivot?new Date(config.pivot).toISOString().slice(0,10):""} onChange={e=>saveConfig({pivot:bars.find(bar=>new Date(bar.timestamp).toISOString().slice(0,10)===e.target.value)?.timestamp})}/></label><p>Optional context anchors; every contraction high and low remains manually selected.</p></fieldset>}
    {annotation&&<fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Annotation</legend><label>Text<input aria-label="Selected drawing text" maxLength={120} value={config.text??""} onChange={e=>setConfig(v=>({...v,text:e.target.value}))} onBlur={()=>saveConfig({text:config.text})}/></label>{customAnnotation&&<><label>Size<select value={config.fontSize??12} onChange={e=>saveConfig({fontSize:Number(e.target.value)})}>{[11,12,14,16,20].map(n=><option key={n}>{n}</option>)}</select></label><label>Align<select value={config.alignment??"left"} onChange={e=>saveConfig({alignment:e.target.value as ToolSettings["alignment"]})}><option>left</option><option>center</option><option>right</option></select></label><label><input type="checkbox" checked={config.background??drawing.name==="brontide-callout"} onChange={e=>saveConfig({background:e.target.checked})}/>Background</label></>}</fieldset>}
    <form onSubmit={event=>{event.preventDefault();try{const fields=new FormData(event.currentTarget);const points=anchors.map((_,index)=>{const date=String(fields.get(`date-${index}`)??""),price=String(fields.get(`price-${index}`)??"");const bar=bars.find(b=>new Date(b.timestamp).toISOString().slice(0,10)===date),value=Number(price);if(!bar||!price.trim()||!Number.isFinite(value)||value<=0)throw new Error("Use loaded session dates and prices above zero.");return{timestamp:bar.timestamp,value};});if(update(drawing.id,{points}))setMessage("Anchors saved.");}catch(error){setMessage((error as Error).message);}}}>
      <fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Anchors</legend>
        {anchors.length>12?<p>Freehand path: drag the drawing on the chart to edit its anchors.</p>:anchors.map((p,i)=><div className="drawing-anchor" key={i}><span>{drawing.name==="brontide-position"?["Entry","Stop","Target 1"][i]:drawing.name==="brontide-contraction"?`C${Math.floor(i/2)+1} ${i%2?"low":"high"}`:`Anchor ${i+1}`}</span><input name={`date-${i}`} aria-label={`Anchor ${i+1} date`} type="date" value={p.date} onChange={e=>setAnchors(rows=>rows.map((r,n)=>n===i?{...r,date:e.target.value}:r))}/><input name={`price-${i}`} aria-label={`Anchor ${i+1} price`} type="number" step="any" min="0.000001" value={p.price} onChange={e=>setAnchors(rows=>rows.map((r,n)=>n===i?{...r,price:e.target.value}:r))}/></div>)}
        {drawing.name==="brontide-contraction"&&<div className="drawing-pair-actions"><button type="button" disabled={anchors.length>=10} onClick={()=>setAnchors(rows=>[...rows,{date:"",price:""},{date:"",price:""}])}>Add contraction</button><button type="button" disabled={anchors.length<=4} onClick={()=>setAnchors(rows=>rows.slice(0,-2))}>Remove last</button></div>}
        {anchors.length<=12&&<button type="submit">Apply anchors</button>}
      </fieldset>
    </form>
    {drawing.name==="brontide-contraction"&&<ContractionSummary drawing={drawing} bars={bars}/>} {message&&<p role="status">{message}</p>}
    <button disabled={drawing.lock} onClick={()=>remove(drawing.id)}>Delete drawing</button>
  </>;
}

function RiskSettings({drawing,config,save,sendToPlan}:{drawing:Drawing;config:ToolSettings;save:(patch:Partial<ToolSettings>)=>boolean;sendToPlan?: (draft:{entry:number;stop:number;targets:number[]})=>void}){
  let result:ReturnType<typeof riskRewardDetails>|undefined;try{result=riskRewardDetails(drawing.points,config);}catch{}
  const targets=config.targets??[];
  return <fieldset disabled={drawing.lock} className="drawing-editor-fields"><legend>Long risk/reward</legend>
    {[0,1].map(i=><label key={i}>Optional target {i+2}<input type="number" step="any" min="0" value={targets[i]??""} onChange={e=>{const next=[...targets];const value=Number(e.target.value);if(value>0)next[i]=value;else next.splice(i,1);save({targets:next});}}/></label>)}
    <label>Account size<input type="number" min="0" step="100" value={config.accountSize??""} onChange={e=>save({accountSize:Number(e.target.value)||undefined})}/></label><label>Allowed risk %<input type="number" min="0" max="100" step=".25" value={config.riskPercent??""} onChange={e=>save({riskPercent:Number(e.target.value)||undefined})}/></label>
    {result&&<p>Risk/share {result.risk.toFixed(2)} · Stop {result.stopPercent.toFixed(2)}% · {result.rewards.map((row,i)=>`T${i+1} ${row.target.toFixed(2)} / ${row.ratio.toFixed(2)}R`).join(" · ")}{result.shares===undefined?"":` · ${result.shares} shares`}</p>}
    {sendToPlan&&<button type="button" disabled={!result} onClick={()=>result&&sendToPlan({entry:result.entry,stop:result.stop,targets:result.targets})}>Send to Trade Plan</button>}
  </fieldset>;
}
function ContractionSummary({drawing,bars}:{drawing:Drawing;bars:StudyBar[]}){try{const r=contractionMetrics(drawing.points,bars);return <p>{r.pairs.map(pair=>`${pair.label}: ${pair.high.toFixed(2)}→${pair.low.toFixed(2)}, ${pair.depth.toFixed(1)}%, ${pair.sessions} bars${pair.relativeToPrevious===undefined?"":`, ${(pair.relativeToPrevious*100).toFixed(0)}% of prior`}`).join(" · ")} · {r.tightening?"Tightening":"Not tightening"}. Manual evidence only.</p>;}catch(error){return <p>Unavailable: {(error as Error).message}</p>;}}
