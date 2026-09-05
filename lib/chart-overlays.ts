import type { OverlayTemplate } from "klinecharts";

// Original geometric drawing tools, registered through the renderer's public API.
export const extraOverlays: OverlayTemplate[] = ["box", "ellipse", "arrow", "measure"].map(kind => ({
  name: `brontide-${kind}`, totalStep: 3, needDefaultPointFigure: true,
  createPointFigures: ({coordinates, overlay}) => {
    if (coordinates.length < 2) return [];
    const [a,b] = coordinates;
    if (kind === "arrow") {
      const theta=Math.atan2(b.y-a.y,b.x-a.x), size=12;
      return [{type:"line",attrs:{coordinates:[a,b]}},{type:"line",attrs:{coordinates:[{x:b.x-size*Math.cos(theta-.45),y:b.y-size*Math.sin(theta-.45)},b,{x:b.x-size*Math.cos(theta+.45),y:b.y-size*Math.sin(theta+.45)}]}}];
    }
    const points = kind === "ellipse" ? Array.from({length:49},(_,i)=>({x:(a.x+b.x)/2+Math.abs(b.x-a.x)/2*Math.cos(i*Math.PI/24),y:(a.y+b.y)/2+Math.abs(b.y-a.y)/2*Math.sin(i*Math.PI/24)})) : [a,{x:b.x,y:a.y},b,{x:a.x,y:b.y},a];
    const figures: ReturnType<NonNullable<OverlayTemplate["createPointFigures"]>> = [{type:"line",attrs:{coordinates:points}}];
    if (kind === "measure") {
      const [p,q]=overlay.points, change=(q.value??0)-(p.value??0);
      figures.push({type:"text",attrs:{x:b.x,y:b.y,text:`${change.toFixed(2)} · ${p.value? (100*change/p.value).toFixed(2):"—"}%`,align:"left",baseline:"bottom"}});
    }
    return figures;
  },
}));
