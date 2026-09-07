"use client";
import { ArrowDown, ArrowUp, Copy, Eye, EyeSlash, Lock, LockOpen, PencilSimple, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { Drawing } from "../lib/drawing-workspace";

export function DrawingObjectsPanel({ symbol, adjustment, drawings, selected, unavailable, label, select, locate, update, updateMany, duplicate, reorder, remove, removeMany }: {
  symbol: string; adjustment: string; drawings: Drawing[]; selected: string[]; unavailable: string[]; label: (name: string) => string;
  select: (ids: string[]) => void; locate: (id: string) => void; update: (id: string, patch: Partial<Drawing>) => boolean; updateMany: (ids: string[], patch: Partial<Drawing>) => boolean;
  duplicate: (id: string) => boolean; reorder: (id: string, direction: -1 | 1) => boolean; remove: (id: string) => boolean; removeMany: (ids: string[]) => boolean;
}) {
  const [filter, setFilter] = useState("all"), [renaming, setRenaming] = useState<string | null>(null), [manualOpen, setManualOpen] = useState(true);
  const rows = useMemo(() => drawings.filter(row => filter === "all" || row.name === filter), [drawings, filter]);
  const types = [...new Set(drawings.map(row => row.name))];
  const allVisible = drawings.every(row => row.visible), allLocked = drawings.every(row => row.lock);
  const automaticName = (drawing: Drawing, index: number) => `${label(drawing.name)}${Number.isFinite(drawing.points[0]?.value) ? ` · ${drawing.points[0].value!.toFixed(2)}` : ` ${index + 1}`}`;
  const toggleSelection = (id: string, checked: boolean) => select(checked ? [...selected.filter(value => value !== id), id] : selected.filter(value => value !== id));
  return <div className="drawing-objects-panel">
    <strong>Objects · {symbol} · {adjustment === "raw" ? "raw" : "adjusted"}</strong>
    <p>{drawings.length} manual drawing{drawings.length === 1 ? "" : "s"} · saved automatically</p>
    <div className="drawing-objects-bulk">
      <select aria-label="Filter drawings by type" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All types</option>{types.map(type => <option key={type} value={type}>{label(type)}</option>)}</select>
      <button disabled={!drawings.length} onClick={() => updateMany(drawings.map(row => row.id), { visible: !allVisible })}>{allVisible ? <EyeSlash size={14}/> : <Eye size={14}/>} {allVisible ? "Hide all" : "Show all"}</button>
      <button disabled={!drawings.length} onClick={() => updateMany(drawings.map(row => row.id), { lock: !allLocked })}>{allLocked ? <LockOpen size={14}/> : <Lock size={14}/>} {allLocked ? "Unlock all" : "Lock all"}</button>
      <button disabled={!selected.length || selected.some(id => drawings.find(row => row.id === id)?.lock)} onClick={() => { if (window.confirm(`Delete ${selected.length} selected drawing${selected.length === 1 ? "" : "s"}? You can undo this action.`)) removeMany(selected); }}><Trash size={14}/> Delete selected</button>
    </div>
    <button className="drawing-objects-section" aria-expanded={manualOpen} onClick={() => setManualOpen(value => !value)}>Manual Drawings <span>{drawings.length}</span></button>
    {manualOpen && <div className="drawing-object-list">{rows.map((drawing, index) => <div className={`drawing-object ${selected.includes(drawing.id) ? "selected" : ""}`} key={drawing.id}>
      <input type="checkbox" aria-label={`Select ${drawing.displayName ?? automaticName(drawing,index)}`} checked={selected.includes(drawing.id)} onChange={event => toggleSelection(drawing.id, event.target.checked)}/>
      <button className="drawing-object-name" onClick={() => { select([drawing.id]); locate(drawing.id); }}>{renaming === drawing.id ? <input autoFocus aria-label="Drawing name" defaultValue={drawing.displayName ?? automaticName(drawing,index)} onClick={event => event.stopPropagation()} onBlur={event => { update(drawing.id, { displayName: event.target.value.trim() || undefined }); setRenaming(null); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }}/> : <><span>{drawing.displayName ?? automaticName(drawing,index)}</span><small>{drawing.lock ? "Locked · " : ""}{drawing.visible ? "Visible" : "Hidden"}{unavailable.includes(drawing.id) ? " · Outside loaded history" : ""}</small></>}</button>
      <div className="drawing-object-actions">
        <button title="Rename" aria-label="Rename drawing" onClick={() => setRenaming(drawing.id)}><PencilSimple size={13}/></button>
        <button title="Duplicate" aria-label="Duplicate drawing" onClick={() => duplicate(drawing.id)}><Copy size={13}/></button>
        <button title="Move up" aria-label="Move drawing up" disabled={index === 0} onClick={() => reorder(drawing.id,-1)}><ArrowUp size={13}/></button>
        <button title="Move down" aria-label="Move drawing down" disabled={index === drawings.length - 1} onClick={() => reorder(drawing.id,1)}><ArrowDown size={13}/></button>
        <button title={drawing.visible ? "Hide" : "Show"} aria-label={drawing.visible ? "Hide drawing" : "Show drawing"} onClick={() => update(drawing.id,{visible:!drawing.visible})}>{drawing.visible ? <EyeSlash size={13}/> : <Eye size={13}/>}</button>
        <button title={drawing.lock ? "Unlock" : "Lock"} aria-label={drawing.lock ? "Unlock drawing" : "Lock drawing"} onClick={() => update(drawing.id,{lock:!drawing.lock})}>{drawing.lock ? <LockOpen size={13}/> : <Lock size={13}/>}</button>
        <button title="Delete" aria-label="Delete drawing" disabled={drawing.lock} onClick={() => remove(drawing.id)}><Trash size={13}/></button>
      </div>
    </div>)}{!rows.length && <p>No manual drawings match this filter.</p>}</div>}
    <details><summary>Indicators <span>3</span></summary><p>20 SMA · 50 SMA · 200 SMA. Manage visibility from Studies.</p></details>
  </div>;
}
