"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Chart, Overlay, OverlayCreate } from "klinecharts";
import { duplicateDrawing, reorderDrawing, updateDrawings, type Drawing, type StudyBar } from "./drawing-workspace";
import { useDrawingWorkspace } from "./use-drawing-workspace";
import type { SnapPreference } from "./drawing-tools";
import { drawingToolLabelForOverlay } from "./drawing-tools";
import { displayIndexForTimestamp, type ChartTimeframe } from "./chart-timeframe";

const groupId = "brontide-drawings";
const modeFor = (snap: SnapPreference) => snap === "off" ? "normal" as const : `${snap}_magnet` as const;

export function useDrawingController({ chartRef, generation, storageKey, bars, displayBars, visibleCount, timeframe, snap, keepDrawing,
  eraserMode, onSelect, onFinish, onContextMenu, onProperties }: {
  chartRef: RefObject<Chart | null>; generation: number; storageKey: string; bars: StudyBar[]; displayBars: StudyBar[];
  visibleCount: number; timeframe: ChartTimeframe; snap: SnapPreference; keepDrawing: boolean;
  eraserMode: boolean;
  onSelect: (id: string | null) => void; onFinish: () => void;
  onContextMenu?: (id: string, point: { x: number; y: number }) => void; onProperties?: (id: string) => void;
}) {
  const store = useDrawingWorkspace(storageKey);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [snapBypassed, setSnapBypassed] = useState(false);
  const draft = useRef<string | null>(null);
  const restoring = useRef(false);
  const activeSpec = useRef<{ name: string; note: string } | null>(null);
  const repeat = useRef<{ name: string; note: string } | null>(null);
  const current = useRef({ store, bars, displayBars, visibleCount, timeframe, onSelect, onFinish, onContextMenu, onProperties, storageKey, keepDrawing, eraserMode, snap });
  current.current = { store, bars, displayBars, visibleCount, timeframe, onSelect, onFinish, onContextMenu, onProperties, storageKey, keepDrawing, eraserMode, snap };

  const cancel = () => {
    if (!draft.current) return false;
    chartRef.current?.removeOverlay({ id: draft.current }); draft.current = null; repeat.current = null; return true;
  };
  const callbacks = (chart: Chart, key: string): Partial<OverlayCreate> => {
    const valid = () => chartRef.current === chart && key === current.current.storageKey;
    const save = (overlay: Overlay) => {
      if (!valid()) return false;
      const { store: latest, displayBars: display, visibleCount: count } = current.current;
      try {
        if (overlay.paneId !== "candle_pane") throw new Error("Place price drawings in the candle pane, above volume. This drawing was not saved.");
        const points = overlay.points.map(p => {
          const timestamp = p.dataIndex === undefined ? p.timestamp : display[Math.round(p.dataIndex) + display.length - count]?.timestamp;
          if (timestamp === undefined || !Number.isFinite(p.value) || p.value! <= 0) throw new Error("Place drawing anchors inside loaded sessions and above zero.");
          return { timestamp, value: p.value };
        });
        const data = overlay.extendData as { history?: StudyBar[]; saved?: unknown } | undefined;
        const extendData = overlay.name.startsWith("brontide-") && data && typeof data === "object" && "history" in data ? data.saved : overlay.extendData;
        const existing = latest.drawings.find(row => row.id === overlay.id);
        const row: Drawing = { id: overlay.id, name: overlay.name, points, styles: overlay.styles,
          visible: overlay.visible, lock: overlay.lock, ...(existing?.displayName ? { displayName: existing.displayName } : {}),
          ...(extendData !== undefined ? { extendData } : {}) };
        if (latest.change(rows => rows.some(d => d.id === row.id) ? rows.map(d => d.id === row.id ? row : d) : [...rows, row])) { setError(""); current.current.onSelect(row.id); return true; }
      } catch (err) { setError((err as Error).message); }
      return false;
    };
    return {
      onSelected: ({ overlay }) => { if (valid() && !current.current.eraserMode) current.current.onSelect(overlay.id); },
      onClick: ({ overlay, preventDefault }) => { if (!valid() || !current.current.eraserMode) return; preventDefault?.(); current.current.store.change(rows => rows.filter(row => row.id !== overlay.id || row.lock)); current.current.onSelect(null); },
      onDeselected: () => { if (valid() && !draft.current && !restoring.current) current.current.onSelect(null); },
      onDrawEnd: ({ overlay }) => {
        draft.current = null;
        if (save(overlay) && current.current.keepDrawing && activeSpec.current) repeat.current = activeSpec.current;
        else current.current.onFinish();
      },
      onPressedMoveEnd: ({ overlay }) => save(overlay),
      onDoubleClick: ({ overlay, preventDefault }) => { preventDefault?.(); if (valid()) { current.current.onSelect(overlay.id); current.current.onProperties?.(overlay.id); } },
      onRightClick: ({ overlay, pageX, pageY, preventDefault }) => { preventDefault?.(); if (valid()) { current.current.onSelect(overlay.id); current.current.onContextMenu?.(overlay.id, { x: pageX ?? 0, y: pageY ?? 0 }); } },
    };
  };
  const begin = (chart: Chart, name: string, note: string) => {
    activeSpec.current = { name, note };
    const annotation = ["simpleAnnotation","simpleTag","brontide-text","brontide-callout"].includes(name);
    const created = chart.createOverlay({ id: `drawing-${crypto.randomUUID()}`, name, groupId, paneId: "candle_pane",
      mode: modeFor(current.current.snap), needDefaultPointFigure: true,
      styles: { line: { color: name === "brontide-highlighter" ? "rgba(245, 190, 40, .34)" : "#4586c9", size: name === "brontide-highlighter" ? 14 : 2, style: "solid" } },
      extendData: name.startsWith("brontide-") ? { history: current.current.bars, displayHistory: current.current.displayBars, ...(annotation ? { saved: { text: note } } : {}) } : annotation ? note : undefined,
      ...callbacks(chart, current.current.storageKey) });
    draft.current = typeof created === "string" ? created : null;
    return !!draft.current;
  };
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    draft.current = null; restoring.current = true; chart.removeOverlay({ groupId });
    if (!store.ready) { restoring.current = false; return; }
    const missing: string[] = [];
    for (const row of store.drawings) {
      const points = row.points.map(p => ({ ...p, dataIndex: p.timestamp === undefined ? undefined : displayIndexForTimestamp(p.timestamp, displayBars, timeframe) - (displayBars.length - visibleCount) }));
      if (row.timeframeVisibility !== undefined && row.timeframeVisibility !== "all" && !row.timeframeVisibility.includes(timeframe)) continue;
      if (row.points.some(p => p.timestamp !== undefined && (!bars.some(b => b.timestamp === p.timestamp) || displayIndexForTimestamp(p.timestamp, displayBars, timeframe) < 0))) { missing.push(row.id); continue; }
      const id = chart.createOverlay({ ...row, points, groupId, paneId: "candle_pane", mode: modeFor(snap), needDefaultPointFigure: true,
        extendData: row.name.startsWith("brontide-") ? { history: bars, displayHistory: displayBars, saved: row.extendData } : row.extendData,
        ...callbacks(chart, storageKey) });
      if (!id) missing.push(row.id);
    }
    setUnavailable(missing); restoring.current = false;
    const pending = repeat.current; repeat.current = null;
    if (pending && keepDrawing) queueMicrotask(() => { if (chartRef.current === chart) begin(chart, pending.name, pending.note); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, store.revision, store.ready, bars, displayBars, visibleCount, timeframe, snap, storageKey]);
  useEffect(() => { onSelect(null); setError(""); activeSpec.current = null; repeat.current = null; }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const setBypass = (value: boolean) => {
      setSnapBypassed(value); const chart = chartRef.current; if (!chart) return;
      for (const overlay of chart.getOverlays({ groupId })) chart.overrideOverlay({ id: overlay.id, mode: value ? "normal" : modeFor(current.current.snap) });
    };
    const down = (event: KeyboardEvent) => { if (event.key === "Alt") setBypass(true); };
    const up = (event: KeyboardEvent) => { if (event.key === "Alt") setBypass(false); };
    const blur = () => setBypass(false);
    document.addEventListener("keydown", down); document.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("keydown", down); document.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [chartRef]);
  const start = (name: string, note: string) => { cancel(); setError(""); const chart = chartRef.current; return !!chart && store.ready && begin(chart, name, note); };
  const updateMany = (ids: string[], patch: Partial<Drawing>) => { cancel(); return store.change(rows => updateDrawings(rows, ids, patch)); };
  const update = (id: string, patch: Partial<Drawing>) => updateMany([id], patch);
  const removeMany = (ids: string[]) => { cancel(); const selected = new Set(ids); const success = store.change(rows => rows.filter(d => !selected.has(d.id) || d.lock)); if (success) onSelect(null); return success; };
  const remove = (id: string) => removeMany([id]);
  const duplicate = (id: string) => { cancel(); const newId = `drawing-${crypto.randomUUID()}`, row = store.drawings.find(d => d.id === id); const success = store.change(rows => duplicateDrawing(rows, id, newId, row ? drawingToolLabelForOverlay(row.name) : undefined)); if (success) onSelect(newId); return success; };
  const reorder = (id: string, direction: -1 | 1) => { cancel(); return store.change(rows => reorderDrawing(rows, id, direction)); };
  const locate = (id: string) => { const row = store.drawings.find(d => d.id === id); if (!row) return; onSelect(id); if (row.points[0]?.timestamp) { const index = displayIndexForTimestamp(row.points[0].timestamp, displayBars, timeframe); if (index >= 0) chartRef.current?.scrollToTimestamp(displayBars[index].timestamp, 180); } };
  return { ...store, error: store.error || error, unavailable, snapBypassed, start, cancel, update, updateMany, remove, removeMany, duplicate, reorder, locate,
    clear: () => { cancel(); if (store.change(rows => rows.filter(d => d.lock))) onSelect(null); },
    undo: () => { cancel(); if (store.undo()) onSelect(null); }, redo: () => { cancel(); if (store.redo()) onSelect(null); } };
}
