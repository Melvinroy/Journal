import type { OverlayTemplate, OverlayFigure } from "klinecharts";
import { anchoredVWAPBands, contractionMetrics, regressionChannel, riskRewardDetails, drawingEvidence, type StudyBar } from "./drawing-workspace";

type SavedSettings = { text?: string; bands?: 0 | 1 | 2; deviation?: 1 | 2; showStatistics?: boolean; targets?: number[]; accountSize?: number; riskPercent?: number; ratios?: number[]; fillOpacity?: number; setupStart?: number; pivot?: number; alignment?: "left"|"center"|"right"; fontSize?:number; background?:boolean };
const settings = (overlay: { extendData?: unknown }): SavedSettings => {
  const data = overlay.extendData as { saved?: unknown } | undefined;
  const value = data && typeof data === "object" && "saved" in data ? data.saved : overlay.extendData;
  return value && typeof value === "object" ? value as SavedSettings : typeof value === "string" ? { text: value } : {};
};

const geometryOverlays: OverlayTemplate[] = ["box", "ellipse", "arrow", "measure"].map(kind => ({
  name: `brontide-${kind}`, totalStep: 3, needDefaultPointFigure: true,
  createPointFigures: ({coordinates, overlay}) => {
    if (coordinates.length < 2) return [];
    const [a,b] = coordinates;
    if (kind === "arrow") {
      const theta=Math.atan2(b.y-a.y,b.x-a.x), size=12;
      return [{type:"line",attrs:{coordinates:[a,b]}},{type:"line",attrs:{coordinates:[{x:b.x-size*Math.cos(theta-.45),y:b.y-size*Math.sin(theta-.45)},b,{x:b.x-size*Math.cos(theta+.45),y:b.y-size*Math.sin(theta+.45)}]}}];
    }
    const points = kind === "ellipse" ? Array.from({length:49},(_,i)=>({x:(a.x+b.x)/2+Math.abs(b.x-a.x)/2*Math.cos(i*Math.PI/24),y:(a.y+b.y)/2+Math.abs(b.y-a.y)/2*Math.sin(i*Math.PI/24)})) : [a,{x:b.x,y:a.y},b,{x:a.x,y:b.y},a];
    const figures: OverlayFigure[] = [{type:"line",attrs:{coordinates:points}}];
    if (kind === "measure") {
      const [p,q]=overlay.points, change=(q.value??0)-(p.value??0);
      figures.push({type:"text",attrs:{x:b.x,y:b.y,text:`${change.toFixed(2)} · ${p.value? (100*change/p.value).toFixed(2):"—"}%`,align:"left",baseline:"bottom"}});
    }
    return figures;
  },
}));

const infoOverlay = (name: "info" | "date-price"): OverlayTemplate => ({
  name: `brontide-${name}`, totalStep: 3, needDefaultPointFigure: true,
  createPointFigures: ({coordinates, overlay}) => coordinates.length < 2 ? [] : [
    { type:"line", attrs:{coordinates}},
    { type:"text", attrs:{x:coordinates[1].x,y:coordinates[1].y,text:drawingEvidence({name:overlay.name,points:overlay.points}, ((overlay.extendData as {history?:StudyBar[]})?.history ?? [])),align:"left",baseline:"bottom"} },
  ],
});

const flatChannel: OverlayTemplate = {
  name: "brontide-flat-channel", totalStep: 4, needDefaultPointFigure: true,
  createPointFigures: ({coordinates,overlay}) => {
    if (coordinates.length < 3) return [];
    const [a,b,c]=coordinates, left=Math.min(a.x,b.x), right=Math.max(a.x,b.x);
    const opacity=Math.max(0,Math.min(40,settings(overlay).fillOpacity??8))/100;
    return [{type:"rect",attrs:{x:left,y:Math.min(a.y,c.y),width:right-left,height:Math.abs(c.y-a.y)},styles:{style:"fill",color:`rgba(69,134,201,${opacity})`}},{type:"line",attrs:{coordinates:[{x:left,y:a.y},{x:right,y:a.y}]}},{type:"line",attrs:{coordinates:[{x:left,y:c.y},{x:right,y:c.y}]}},
      {type:"line",attrs:{coordinates:[{x:left,y:a.y},{x:left,y:c.y}]}},{type:"line",attrs:{coordinates:[{x:right,y:a.y},{x:right,y:c.y}]}}];
  },
};

const fibonacciExtension: OverlayTemplate = {
  name:"brontide-fib-extension", totalStep:4, needDefaultPointFigure:true,
  createPointFigures:({chart,coordinates,bounding,overlay})=>{
    if(coordinates.length<3)return [];
    const [a,b,c]=coordinates, config=settings(overlay), ratios=config.ratios?.filter(value=>Number.isFinite(value)&&value>=0&&value<=5) ?? [0,.618,1,1.618,2.618];
    const [p,q,r]=overlay.points, delta=(q.value??0)-(p.value??0);
    const figures:OverlayFigure[]=[{type:"line",attrs:{coordinates:[a,b,c]}}];
    for(const ratio of ratios){const value=(r.value??0)+delta*ratio;const pixel=chart.convertToPixel({dataIndex:r.dataIndex,timestamp:r.timestamp,value},{paneId:overlay.paneId}) as {y:number};
      figures.push({type:"line",attrs:{coordinates:[{x:c.x,y:pixel.y},{x:bounding.width,y:pixel.y}]}},{type:"text",attrs:{x:c.x+4,y:pixel.y,text:`${ratio} · ${value.toFixed(2)}`,align:"left",baseline:"bottom"}});}
    return figures;
  },
};

const highlighter: OverlayTemplate = {
  name:"brontide-highlighter", totalStep:2, drawingMode:"continuous", needDefaultPointFigure:false,
  createPointFigures:({coordinates})=>coordinates.length<2?[]:[{type:"line",attrs:{coordinates},styles:{color:"rgba(245, 190, 40, .34)",size:14,style:"solid"}}],
};
const textOverlay: OverlayTemplate = {
  name:"brontide-text", totalStep:2, needDefaultPointFigure:true,
  createPointFigures:({coordinates,overlay})=>{const config=settings(overlay);return coordinates[0]?[{type:"text",attrs:{x:coordinates[0].x,y:coordinates[0].y,text:config.text??"Text",align:config.alignment??"left",baseline:"bottom"},styles:{size:config.fontSize??12,backgroundColor:config.background?"rgba(69,134,201,.12)":"transparent"}}]:[];},
};
const callout: OverlayTemplate = {
  name:"brontide-callout", totalStep:3, needDefaultPointFigure:true,
  createPointFigures:({coordinates,overlay})=>{const config=settings(overlay);return coordinates.length<2?[]:[{type:"line",attrs:{coordinates}},{type:"text",attrs:{x:coordinates[1].x,y:coordinates[1].y,text:config.text??"Callout",align:config.alignment??"left",baseline:"bottom"},styles:{size:config.fontSize??12,backgroundColor:config.background===false?"transparent":"rgba(69,134,201,.12)",paddingLeft:7,paddingRight:7,paddingTop:5,paddingBottom:5}}];},
};

export const extraOverlays: OverlayTemplate[] = [...geometryOverlays, infoOverlay("info"), infoOverlay("date-price"), flatChannel, fibonacciExtension, highlighter, textOverlay, callout];

export const workflowOverlays: OverlayTemplate[] = [
  ["position", 4], ["date", 3], ["contraction", 7], ["vwap", 2], ["regression", 3],
].map(([kind, steps]) => ({
  name: `brontide-${kind}`, totalStep: steps as number, needDefaultPointFigure: true,
  createPointFigures: ({ chart, coordinates, overlay }) => {
    const bars = (overlay.extendData as { history?: StudyBar[] } | undefined)?.history ?? [], config=settings(overlay);
    const indexByTime = new Map(bars.map((bar, index) => [bar.timestamp, index]));
    const offset = indexByTime.get(chart.getDataList()[0]?.timestamp) ?? -1;
    const points = overlay.points.map(p => ({ value: p.value, timestamp: p.dataIndex !== undefined && offset >= 0 ? bars[Math.round(p.dataIndex) + offset]?.timestamp : p.timestamp }));
    const figures: OverlayFigure[] = [];
    const line = (coords: { x: number; y: number }[], color?: string) => figures.push({ type: "line", attrs: { coordinates: coords }, ...(color ? { styles: { color } } : {}) });
    if (!coordinates.length) return figures;
    const [a, b, c] = coordinates;
    if (kind === "position" && b) {
      const right = Math.max(a.x + 48, b.x, c?.x ?? a.x);
      for (const [point, color] of [[a, "#538be2"], [b, "#d94b55"], [c, "#15945b"]] as const) if (point) line([{x: a.x, y: point.y}, {x: right, y: point.y}], color);
      line([a, b, ...(c ? [c] : [])]);
      if (c) for (const [end, color] of [[b, "#d94b5520"], [c, "#15945b20"]] as const) figures.push({ type: "rect", attrs: { x: a.x, y: Math.min(a.y, end.y), width: right - a.x, height: Math.abs(end.y - a.y) }, styles: { style: "fill", color } });
      if(c)try{for(const target of riskRewardDetails(points,{targets:config.targets}).targets.slice(1)){const y=(chart.convertToPixel({dataIndex:overlay.points[0].dataIndex,value:target},{paneId:overlay.paneId}) as {y:number}).y;line([{x:a.x,y},{x:right,y}],"#15945b");}}catch{}
    } else if (kind === "date" && b) line([a, { x: b.x, y: a.y }, b]);
    else if (kind === "contraction") {
      line(coordinates);
      try { for(const pair of contractionMetrics(points,bars).pairs){const point=coordinates[(Number(pair.label.slice(1))-1)*2];figures.push({type:"text",attrs:{x:point.x,y:point.y-8,text:`${pair.label} · ${pair.depth.toFixed(1)}% · ${pair.sessions} bars`,align:"left",baseline:"bottom"}});}} catch {}
    } else if (kind === "vwap") {
      try { const rows=anchoredVWAPBands(points[0]?.timestamp,bars), band=config.bands??0;
        const keys:("value"|"upper1"|"lower1"|"upper2"|"lower2")[]=["value",...(band>=1?["upper1","lower1"] as const:[]),...(band>=2?["upper2","lower2"] as const:[])];
        for(const key of keys){const coords=rows.filter(p=>p[key]!==undefined&&p[key]!>0).map(p=>chart.convertToPixel({dataIndex:indexByTime.get(p.timestamp)!-offset,value:p[key]!},{paneId:"candle_pane"}) as {x:number;y:number});if(coords.length>1)line(coords,key==="value"?undefined:"#7a8fa8");}
      } catch {}
    } else if (kind === "regression") {
      try { const result=regressionChannel(points,bars), deviation=config.deviation??1;
        for (const shift of [-deviation * result.sigma, 0, deviation * result.sigma]) { const coords=result.series.map(p=>chart.convertToPixel({dataIndex:indexByTime.get(p.timestamp)!-offset,value:p.value+shift},{paneId:"candle_pane"}) as {x:number;y:number}); if(coords.length>1)line(coords); }
      } catch {}
    }
    if (points.length >= (steps as number) - 1 && !(kind==="regression"&&config.showStatistics===false)) figures.push({ type:"text", attrs:{x:Math.max(6,a.x),y:Math.max(55,a.y-12),text:drawingEvidence({name:overlay.name,points},bars),align:"left",baseline:"bottom"}, styles:{color:overlay.styles?.line?.color??"#477ba6",size:12,family:"Inter, ui-sans-serif, system-ui",backgroundColor:"transparent"} });
    return figures;
  },
}));
