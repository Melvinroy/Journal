"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Chart, Overlay, OverlayCreate } from "klinecharts";
import { type Drawing, type StudyBar } from "./drawing-workspace";
import { useDrawingWorkspace } from "./use-drawing-workspace";
import type { SnapPreference } from "./drawing-tools";

const groupId = "brontide-drawings";
export function useDrawingController({ chartRef, generation, storageKey, bars, visibleCount, snap, onSelect, onFinish }: {
  chartRef: RefObject<Chart | null>; generation: number; storageKey: string; bars: StudyBar[];
  visibleCount: number; snap: SnapPreference; onSelect: (id: string | null) => void; onFinish: () => void;
}) {
  const store = useDrawingWorkspace(storageKey);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [repaint, setRepaint] = useState(0);
  const draft = useRef<string | null>(null);
  const current = useRef({ store, bars, visibleCount, onSelect, onFinish, storageKey });
  current.current = { store, bars, visibleCount, onSelect, onFinish, storageKey };
  const cancel = () => {
    if (draft.current) chartRef.current?.removeOverlay({ id: draft.current });
    draft.current = null; current.current.onFinish();
  };
  const callbacks = (chart: Chart, key: string): Partial<OverlayCreate> => {
    const valid = () => chartRef.current === chart && key === current.current.storageKey;
    const save = (overlay: Overlay) => {
      if (!valid()) return;
      const { store: latest, bars: history, visibleCount: count } = current.current;
      try {
        if (overlay.paneId !== "candle_pane") throw new Error("Place price drawings in the candle pane, above volume. This drawing was not saved.");
        const points = overlay.points.map(p => {
          const timestamp = p.dataIndex === undefined ? p.timestamp : history[Math.round(p.dataIndex) + history.length - count]?.timestamp;
          if (timestamp === undefined || !Number.isFinite(p.value) || p.value! <= 0) throw new Error("Place drawing anchors inside loaded sessions and above zero.");
          return { timestamp, value: p.value };
        });
        const data = overlay.extendData as { history?: StudyBar[]; saved?: unknown } | undefined;
        const extendData = overlay.name.startsWith("brontide-") && data && typeof data === "object" && "history" in data ? data.saved : overlay.extendData;
        const row: Drawing = { id: overlay.id, name: overlay.name, points, styles: overlay.styles,
          visible: overlay.visible, lock: overlay.lock, ...(extendData !== undefined ? { extendData } : {}) };
        if (latest.change(rows => [...rows.filter(d => d.id !== row.id), row])) { setError(""); current.current.onSelect(row.id); }
      } catch (err) { setError((err as Error).message); }
      // Reconcile even failed writes, so visible geometry never implies a successful save.
      setRepaint(v => v + 1);
    };
    return {
      onSelected: ({ overlay }) => { if (valid()) current.current.onSelect(overlay.id); },
      onDrawEnd: ({ overlay }) => { draft.current = null; save(overlay); current.current.onFinish(); },
      onPressedMoveEnd: ({ overlay }) => save(overlay),
      // Right-click must not invoke the renderer's destructive default removal.
      onRightClick: ({ overlay, preventDefault }) => { preventDefault?.(); if (valid()) current.current.onSelect(overlay.id); },
    };
  };
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    draft.current = null; current.current.onFinish();
    chart.removeOverlay({ groupId });
    if (!store.ready) return;
    const missing: string[] = [];
    for (const row of store.drawings) {
      const points = row.points.map(p => ({ ...p, dataIndex: p.timestamp === undefined ? undefined : bars.findIndex(b => b.timestamp === p.timestamp) - (bars.length - visibleCount) }));
      if (row.points.some(p => p.timestamp !== undefined && !bars.some(b => b.timestamp === p.timestamp))) { missing.push(row.id); continue; }
      const id = chart.createOverlay({ ...row, points, groupId, paneId: "candle_pane", mode: snap === "off" ? "normal" : `${snap}_magnet`,
        needDefaultPointFigure: true,
        extendData: row.name.startsWith("brontide-") ? { history: bars, saved: row.extendData } : row.extendData,
        ...callbacks(chart, storageKey) });
      if (!id) missing.push(row.id);
    }
    setUnavailable(missing);
    // Callbacks read current store refs; renderer is rebuilt only for geometry/state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, store.revision, store.ready, repaint, bars, visibleCount, snap, storageKey]);
  useEffect(() => { onSelect(null); setError(""); }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = (name: string, note: string) => {
    cancel(); setError("");
    const chart = chartRef.current;
    if (!chart || !store.ready) return false;
    const created = chart.createOverlay({ id: `drawing-${crypto.randomUUID()}`, name, groupId, paneId: "candle_pane",
      mode: snap === "off" ? "normal" : `${snap}_magnet`, needDefaultPointFigure: true,
      styles: { line: { color: "#4586c9", size: 2, style: "solid" } },
      extendData: name.startsWith("brontide-") ? { history: bars } : name === "simpleAnnotation" ? note : undefined,
      ...callbacks(chart, storageKey) });
    draft.current = typeof created === "string" ? created : null;
    return !!draft.current;
  };
  const update = (id: string, patch: Partial<Drawing>) => {
    cancel(); return store.change(rows => rows.map(d => d.id === id ? { ...d, ...patch, id: d.id, name: d.name } : d));
  };
  const remove = (id: string) => {
    cancel(); const success = store.change(rows => rows.filter(d => d.id !== id || d.lock));
    if (success) onSelect(null); return success;
  };
  return { ...store, error: store.error || error, unavailable, start, cancel, update, remove,
    clear: () => { cancel(); if (store.change(rows => rows.filter(d => d.lock))) onSelect(null); },
    undo: () => { cancel(); if (store.undo()) onSelect(null); },
    redo: () => { cancel(); if (store.redo()) onSelect(null); } };
}
