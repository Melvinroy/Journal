"use client";
import { useEffect, useRef, useState } from "react";
import { changeDrawings, decodeDrawings, drawingHistory, travelDrawings, type Drawing, type History } from "./drawing-workspace";
import { readDrawingDocument, writeDrawingDocument } from "./workspace-state";

type SaveStatus = "saved" | "saving" | "error";
type WorkspaceState = { key: string; history: History; persistedRaw: string | null; dirty: boolean };

// History belongs to canonical symbol + source + adjustment. A short debounce
// coalesces drag completions without delaying the in-memory editing response.
export function useDrawingWorkspace(key: string) {
  const cache = useRef(new Map<string, { history: History; raw: string | null }>());
  const current = useRef<WorkspaceState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => boolean>(() => false);
  const [revision, render] = useState(0);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const flush = () => {
    const state = current.current;
    if (!state || !state.dirty) return true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      if (localStorage.getItem(state.key) !== state.persistedRaw) {
        setError("Drawings changed in another view. Your unsaved changes remain in this session; refresh before editing further.");
        setSaveStatus("error"); return false;
      }
      decodeDrawings(state.history.present);
      const raw = writeDrawingDocument(localStorage, state.key, state.history.present);
      state.persistedRaw = raw; state.dirty = false;
      cache.current.set(state.key, { history: state.history, raw });
      setError(""); setSaveStatus("saved"); render(value => value + 1); return true;
    } catch {
      setError("Drawings could not be saved. Your changes remain in this session, but browser storage is full, blocked, or failed verification.");
      setSaveStatus("error"); render(value => value + 1); return false;
    }
  };
  flushRef.current = flush;
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 90);
  };

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const load = () => {
      try {
        const loaded = readDrawingDocument<unknown>(localStorage, key, []);
        const decoded = decodeDrawings(loaded.value), previous = cache.current.get(key);
        const history = previous?.raw === loaded.raw ? previous.history : drawingHistory(decoded);
        current.current = { key, history, persistedRaw: loaded.raw, dirty: loaded.migrated };
        cache.current.set(key, { history, raw: loaded.raw });
        setError(""); setSaveStatus(loaded.migrated ? "saving" : "saved");
        if (loaded.migrated) schedule();
      } catch {
        current.current = null; setSaveStatus("error");
        setError("Saved drawings could not be read. Existing storage has not been overwritten.");
      }
      render(value => value + 1);
    };
    load();
    const external = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      if (current.current?.dirty) {
        setError("Drawings changed in another view while this session has unsaved work. Refresh to reconcile them."); setSaveStatus("error");
      } else load();
    };
    const beforeUnload = () => flushRef.current();
    window.addEventListener("storage", external); window.addEventListener("beforeunload", beforeUnload);
    return () => {
      flushRef.current();
      window.removeEventListener("storage", external); window.removeEventListener("beforeunload", beforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const commit = (transform: (history: History) => History) => {
    const state = current.current;
    if (!state || state.key !== key || saveStatus === "error" && !state.dirty) return false;
    try {
      if (!state.dirty && localStorage.getItem(key) !== state.persistedRaw) {
        setError("Drawings changed in another view. Refresh before editing."); setSaveStatus("error"); return false;
      }
      const history = transform(state.history);
      if (history === state.history) return true;
      decodeDrawings(history.present);
      state.history = history; state.dirty = true;
      setError(""); setSaveStatus("saving"); render(value => value + 1); schedule(); return true;
    } catch {
      setError("Drawing changes could not be prepared for saving. Your previous saved work was retained."); setSaveStatus("error"); return false;
    }
  };
  const history = current.current?.key === key ? current.current.history : drawingHistory([]);
  return { ready: current.current?.key === key, revision, error, saveStatus, drawings: history.present,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    change: (next: Drawing[] | ((drawings: Drawing[]) => Drawing[])) => commit(h => changeDrawings(h, typeof next === "function" ? next(h.present) : next)),
    undo: () => commit(h => travelDrawings(h, "undo")), redo: () => commit(h => travelDrawings(h, "redo")), flush };
}
