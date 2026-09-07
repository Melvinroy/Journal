"use client";
import { Copy, DotsThree, Eye, EyeSlash, Lock, LockOpen, Trash, X } from "@phosphor-icons/react";
import { DrawingEditor } from "./DrawingEditor";
import type { Drawing, StudyBar } from "../lib/drawing-workspace";

export function DrawingContextToolbar({ drawings, bars, unavailable, position, propertiesOpen, close, more, updateMany, update, duplicate, removeMany, remove, sendToPlan }: {
  drawings: Drawing[]; bars: StudyBar[]; unavailable: string[]; position?: { left: number; top: number }; propertiesOpen: boolean; close: () => void; more: () => void;
  updateMany: (ids: string[], patch: Partial<Drawing>) => boolean; update: (id: string, patch: Partial<Drawing>) => boolean;
  duplicate: (id: string) => boolean; removeMany: (ids: string[]) => boolean; remove: (id: string) => boolean;
  sendToPlan?: (draft:{entry:number;stop:number;targets:number[]})=>void;
}) {
  if (!drawings.length) return null;
  const ids = drawings.map(row => row.id), primary = drawings.at(-1)!;
  const locked = drawings.some(row => row.lock), allLocked = drawings.every(row => row.lock), allVisible = drawings.every(row => row.visible);
  const line = primary.styles?.line;
  const lineKind = line?.style === "solid" ? "solid" : line?.dashedValue?.[0] === 2 ? "dotted" : "dashed";
  const stylePatch = (patch: Record<string, unknown>) => updateMany(ids, { styles: { ...primary.styles, line: { ...line, ...patch } } });
  return <div className="drawing-context" style={position} role="toolbar" aria-label={`${drawings.length} selected drawing${drawings.length === 1 ? "" : "s"}`}>
    <label className="drawing-color" title="Colour"><span className="sr-only">Drawing colour</span><input type="color" disabled={locked} value={line?.color ?? "#4586c9"} onChange={event => stylePatch({ color: event.target.value })}/></label>
    <select title="Width" aria-label="Drawing width" disabled={locked} value={line?.size ?? 2} onChange={event => stylePatch({ size: Number(event.target.value) })}>{[1,2,3,4].map(n => <option key={n}>{n}</option>)}</select>
    <select title="Line style" aria-label="Drawing line style" disabled={locked} value={lineKind} onChange={event => stylePatch(event.target.value === "solid" ? { style: "solid" } : { style: "dashed", dashedValue: event.target.value === "dotted" ? [2,3] : [6,4] })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
    <button title={allLocked ? "Unlock" : "Lock"} aria-label={allLocked ? "Unlock selected drawings" : "Lock selected drawings"} onClick={() => updateMany(ids, { lock: !allLocked })}>{allLocked ? <LockOpen size={16}/> : <Lock size={16}/>}</button>
    <button title={allVisible ? "Hide" : "Show"} aria-label={allVisible ? "Hide selected drawings" : "Show selected drawings"} onClick={() => updateMany(ids, { visible: !allVisible })}>{allVisible ? <EyeSlash size={16}/> : <Eye size={16}/>}</button>
    <button title="Duplicate" aria-label="Duplicate selected drawing" disabled={drawings.length !== 1} onClick={() => duplicate(primary.id)}><Copy size={16}/></button>
    <button title="Delete" aria-label="Delete selected unlocked drawings" disabled={locked} onClick={() => removeMany(ids)}><Trash size={16}/></button>
    <button title="More settings" aria-label="More drawing settings" aria-expanded={propertiesOpen} onClick={more}><DotsThree size={18}/></button>
    <button title="Close" aria-label="Close drawing toolbar" onClick={close}><X size={15}/></button>
    {propertiesOpen && drawings.length === 1 && <div className="drawing-context-properties" role="dialog" aria-label="Drawing properties">
      <strong>Drawing properties</strong>
      <DrawingEditor key={`${primary.id}:${JSON.stringify(primary.points)}:${JSON.stringify(primary.extendData)}`} drawing={primary} bars={bars} unavailable={unavailable.includes(primary.id)} update={update} remove={remove} sendToPlan={sendToPlan}/>
    </div>}
    {propertiesOpen && drawings.length > 1 && <div className="drawing-context-properties"><p>Common settings are available in the toolbar. Open one object for coordinates and tool-specific properties.</p></div>}
  </div>;
}
