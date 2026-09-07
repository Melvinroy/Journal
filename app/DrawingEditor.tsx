"use client";
import { useState } from "react";
import { drawingEvidence, type Drawing, type StudyBar } from "../lib/drawing-workspace";

export function DrawingEditor({ drawing, bars, unavailable, update, remove }: {
  drawing: Drawing; bars: StudyBar[]; unavailable: boolean;
  update: (id: string, patch: Partial<Drawing>) => boolean; remove: (id: string) => boolean;
}) {
  const [message, setMessage] = useState("");
  const [anchors, setAnchors] = useState(drawing.points.map(p => ({
    date: p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : "", price: p.value?.toString() ?? "",
  })));
  const [note, setNote] = useState(typeof drawing.extendData === "string" ? drawing.extendData : "");
  const [displayName, setDisplayName] = useState(drawing.displayName ?? "");
  const lineKind = drawing.styles?.line?.style === "solid" ? "solid" : drawing.styles?.line?.dashedValue?.[0] === 2 ? "dotted" : "dashed";
  return <>
    <p role="status">{unavailable ? "Anchors are outside loaded history, or this tool is unavailable. The saved drawing is retained." : drawingEvidence(drawing, bars)}</p>
    <label>Name<input aria-label="Drawing name" maxLength={80} value={displayName} placeholder="Automatic name" onChange={event => setDisplayName(event.target.value)} onBlur={() => update(drawing.id, { displayName: displayName.trim() || undefined })}/></label>
    <label><input type="checkbox" checked={drawing.lock} onChange={e => update(drawing.id, { lock: e.target.checked })}/>Lock drawing</label>
    <label><input type="checkbox" checked={drawing.visible} onChange={e => update(drawing.id, { visible: e.target.checked })}/>Show drawing</label>
    <fieldset disabled={drawing.lock} className="drawing-editor-fields">
      <legend>Appearance</legend>
      <label>Color<input aria-label="Drawing color" type="color" value={drawing.styles?.line?.color ?? "#4586c9"} onChange={e => update(drawing.id, { styles: { ...drawing.styles, line: { ...drawing.styles?.line, color: e.target.value }, text: { ...drawing.styles?.text, color: e.target.value } } })}/></label>
      <label>Width<select aria-label="Drawing width" value={drawing.styles?.line?.size ?? 2} onChange={e => update(drawing.id, { styles: { ...drawing.styles, line: { ...drawing.styles?.line, size: Number(e.target.value) } } })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}px</option>)}</select></label>
      <label>Line<select aria-label="Drawing line style" value={lineKind} onChange={e => update(drawing.id, { styles: { ...drawing.styles, line: { ...drawing.styles?.line, style: e.target.value === "solid" ? "solid" : "dashed", dashedValue: e.target.value === "dotted" ? [2, 3] : [6, 4] } } })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
    </fieldset>
    <form onSubmit={event => {
      event.preventDefault();
      try {
        const fields = new FormData(event.currentTarget);
        const points = anchors.map((_, index) => {
          const date = String(fields.get(`date-${index}`) ?? ""), price = String(fields.get(`price-${index}`) ?? "");
          const bar = bars.find(b => new Date(b.timestamp).toISOString().slice(0, 10) === date);
          const value = Number(price);
          if (!bar || !price.trim() || !Number.isFinite(value) || value <= 0) throw new Error("Use loaded session dates and prices above zero.");
          return { timestamp: bar.timestamp, value };
        });
        if (update(drawing.id, { points, ...(drawing.name === "simpleAnnotation" ? { extendData: note } : {}) })) setMessage("Anchors saved.");
      } catch (error) { setMessage((error as Error).message); }
    }}>
      <fieldset disabled={drawing.lock || unavailable} className="drawing-editor-fields">
        <legend>Anchors</legend>
        {anchors.length > 12 ? <p>Freehand path: drag the drawing on the chart to edit its anchors.</p> : anchors.map((p, i) => <div className="drawing-anchor" key={i}>
          <span>{drawing.name === "brontide-position" ? ["Entry", "Stop", "Target"][i] : drawing.name === "brontide-contraction" ? `${i % 2 ? "Low" : "High"} ${Math.floor(i / 2) + 1}` : `Anchor ${i + 1}`}</span>
          <input name={`date-${i}`} aria-label={`Anchor ${i + 1} date`} type="date" value={p.date} onInput={e => { const value = e.currentTarget.value; setAnchors(rows => rows.map((r, n) => n === i ? { ...r, date: value } : r)); }} onChange={e => setAnchors(rows => rows.map((r, n) => n === i ? { ...r, date: e.target.value } : r))}/>
          <input name={`price-${i}`} aria-label={`Anchor ${i + 1} price`} type="number" step="any" min="0.000001" value={p.price} onChange={e => setAnchors(rows => rows.map((r, n) => n === i ? { ...r, price: e.target.value } : r))}/>
        </div>)}
        {drawing.name === "simpleAnnotation" && <label>Text<input aria-label="Selected drawing text" maxLength={120} value={note} onChange={e => setNote(e.target.value)}/></label>}
        {anchors.length <= 12 && <button type="submit">Apply anchors</button>}
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    {drawing.name === "brontide-position" && <p>Per-share price distances; fees and slippage excluded. This measurement does not submit an order.</p>}
    {drawing.name === "brontide-contraction" && <p>Three manual high/low pairs. Tightening alone does not establish a VCP setup.</p>}
    {drawing.name === "brontide-regression" && <p>Linear regression of closes by session, with ±2 population residual standard deviations. Lin/Log changes display only. Price anchors position the handles; session dates define the calculation.</p>}
    {drawing.name === "brontide-vwap" && <p>Daily (high + low + close) / 3 weighted by volume, from the anchor through the last loaded session. A daily-bar approximation, not intraday VWAP.</p>}
    <button disabled={drawing.lock} onClick={() => remove(drawing.id)}>Delete drawing</button>
  </>;
}
