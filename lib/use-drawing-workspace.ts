"use client";
import { useEffect, useRef, useState } from "react";
import { changeDrawings, decodeDrawings, drawingHistory, travelDrawings, type Drawing, type History } from "./drawing-workspace";
import { readStored, writeStored } from "./workspace-state";

// History belongs to a symbol + source + adjustment, not a renderer instance.
// Compare the exact stored value before each mutation to protect other open tabs.
export function useDrawingWorkspace(key: string) {
  const cache = useRef(new Map<string, { history: History; raw: string | null }>());
  const current = useRef<{ key: string; history: History; raw: string | null } | null>(null);
  const [revision, render] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(key), previous = cache.current.get(key);
        const history = previous?.raw === raw ? previous.history : drawingHistory(decodeDrawings(readStored(localStorage, key, [])));
        current.current = { key, history, raw }; cache.current.set(key, { history, raw }); setError("");
      } catch { current.current = null; setError("Saved drawings could not be read. Existing storage has not been overwritten."); }
      render(v => v + 1);
    };
    load();
    const external = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
    window.addEventListener("storage", external);
    return () => window.removeEventListener("storage", external);
  }, [key]);
  const commit = (transform: (history: History) => History) => {
    const state = current.current;
    if (!state || state.key !== key) return false;
    try {
      if (localStorage.getItem(key) !== state.raw) { setError("Drawings changed in another view. Refresh before editing."); return false; }
      const history = transform(state.history);
      if (history === state.history) return true;
      decodeDrawings(history.present);
      writeStored(localStorage, key, history.present);
      const raw = localStorage.getItem(key);
      current.current = { key, history, raw }; cache.current.set(key, { history, raw });
      setError(""); render(v => v + 1); return true;
    } catch { setError("Drawings could not be saved. Storage may be full or disabled; your saved work was retained."); return false; }
  };
  const history = current.current?.key === key ? current.current.history : drawingHistory([]);
  return { ready: current.current?.key === key, revision, error, drawings: history.present,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    change: (next: Drawing[] | ((drawings: Drawing[]) => Drawing[])) => commit(h => changeDrawings(h, typeof next === "function" ? next(h.present) : next)),
    undo: () => commit(h => travelDrawings(h, "undo")), redo: () => commit(h => travelDrawings(h, "redo")) };
}
