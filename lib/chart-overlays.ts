import type { OverlayTemplate, OverlayFigure } from "klinecharts";
import { anchoredVWAP, regressionChannel, drawingEvidence, type StudyBar } from "./drawing-workspace";

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

export const workflowOverlays: OverlayTemplate[] = [
  ["position", 4], ["date", 3], ["contraction", 7], ["vwap", 2], ["regression", 3],
].map(([kind, steps]) => ({
  name: `brontide-${kind}`, totalStep: steps as number, needDefaultPointFigure: true,
  createPointFigures: ({ chart, coordinates, overlay }) => {
    const bars = (overlay.extendData as { history?: StudyBar[] } | undefined)?.history ?? [];
    const indexByTime = new Map(bars.map((bar, index) => [bar.timestamp, index]));
    const offset = indexByTime.get(chart.getDataList()[0]?.timestamp) ?? -1;
    const points = overlay.points.map(p => ({ value: p.value,
      timestamp: p.dataIndex !== undefined && offset >= 0 ? bars[Math.round(p.dataIndex) + offset]?.timestamp : p.timestamp }));
    const figures: OverlayFigure[] = [];
    const line = (coords: { x: number; y: number }[], color?: string) => figures.push({ type: "line", attrs: { coordinates: coords }, ...(color ? { styles: { color } } : {}) });
    if (!coordinates.length) return figures;
    const [a, b, c] = coordinates;
    if (kind === "position" && b) {
      const right = Math.max(a.x + 48, b.x, c?.x ?? a.x);
      for (const [point, color] of [[a, "#538be2"], [b, "#d94b55"], [c, "#15945b"]] as const) if (point) line([{x: a.x, y: point.y}, {x: right, y: point.y}], color);
      line([a, b, ...(c ? [c] : [])]);
      if (c) for (const [end, color] of [[b, "#d94b5520"], [c, "#15945b20"]] as const)
        figures.push({ type: "rect", attrs: { x: a.x, y: Math.min(a.y, end.y), width: right - a.x, height: Math.abs(end.y - a.y) }, styles: { style: "fill", color } });
    } else if (kind === "date" && b) {
      line([a, { x: b.x, y: a.y }, b]);
    } else if (kind === "contraction") line(coordinates);
    else if (kind === "vwap" || kind === "regression") {
      try {
        const result = kind === "vwap" ? { series: anchoredVWAP(points[0]?.timestamp, bars), sigma: 0 } : regressionChannel(points, bars);
        for (const shift of kind === "vwap" ? [0] : [-2 * result.sigma, 0, 2 * result.sigma]) {
          const coords = result.series.filter(p => p.value !== undefined && p.value + shift > 0).map(p => chart.convertToPixel({
            dataIndex: indexByTime.get(p.timestamp)! - offset, value: p.value! + shift,
          }, { paneId: "candle_pane" }) as { x: number; y: number });
          if (coords.length > 1) line(coords);
        }
      } catch { /* Unavailable state is rendered below and in the editor. */ }
    }
    if (points.length >= (steps as number) - 1) {
      const text = drawingEvidence({ name: overlay.name, points }, bars);
      figures.push({ type: "text", attrs: { x: Math.max(6, a.x), y: Math.max(55, a.y - 12), text, align: "left", baseline: "bottom" },
        styles: { color: overlay.styles?.line?.color ?? "#477ba6", size: 12, family: "Inter, ui-sans-serif, system-ui", backgroundColor: "transparent" } });
    }
    return figures;
  },
}));
