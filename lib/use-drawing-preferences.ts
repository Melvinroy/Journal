"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_DRAWING_PREFERENCES, migrateDrawingPreferences, validDrawingPreferences, type DrawingPreferences } from "./drawing-tools";
import { readStored, writeStored } from "./workspace-state";

export const DRAWING_PREFERENCES_KEY = "brontide-drawing-preferences-v2";
const LEGACY_FAVORITES_KEY = "brontide-drawing-favorites-v1";
const LEGACY_SNAP_KEY = "brontide-drawing-snap-v1";

export function useDrawingPreferences() {
  const [value, setValue] = useState<DrawingPreferences>(DEFAULT_DRAWING_PREFERENCES);
  const [raw, setRaw] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      try {
        const currentRaw = localStorage.getItem(DRAWING_PREFERENCES_KEY);
        let next: DrawingPreferences;
        if (currentRaw === null) {
          const legacyFavorites = readStored(localStorage, LEGACY_FAVORITES_KEY, undefined);
          const legacySnap = readStored(localStorage, LEGACY_SNAP_KEY, undefined);
          next = migrateDrawingPreferences(undefined, legacyFavorites, legacySnap);
          writeStored(localStorage, DRAWING_PREFERENCES_KEY, next);
        } else {
          next = readStored(localStorage, DRAWING_PREFERENCES_KEY, DEFAULT_DRAWING_PREFERENCES);
          if (!validDrawingPreferences(next)) throw new Error("Invalid drawing preferences");
        }
        setValue(next); setRaw(localStorage.getItem(DRAWING_PREFERENCES_KEY)); setReady(true); setError("");
      } catch {
        setReady(false); setError("Drawing preferences could not be read or migrated. Existing preferences were not overwritten.");
      }
    };
    load();
    const storage = (event: StorageEvent) => { if ([DRAWING_PREFERENCES_KEY, LEGACY_FAVORITES_KEY, LEGACY_SNAP_KEY].includes(event.key ?? "")) load(); };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);

  const save = useCallback((next: DrawingPreferences) => {
    if (!ready || !validDrawingPreferences(next)) { setError("Invalid drawing preferences; saved preferences were not changed."); return false; }
    try {
      if (localStorage.getItem(DRAWING_PREFERENCES_KEY) !== raw) { setError("Drawing preferences changed in another view. Reload before saving."); return false; }
      writeStored(localStorage, DRAWING_PREFERENCES_KEY, next);
      setValue(next); setRaw(localStorage.getItem(DRAWING_PREFERENCES_KEY)); setError(""); return true;
    } catch { setError("Drawing preferences could not be saved. Browser storage may be full or disabled."); return false; }
  }, [raw, ready]);

  return { value, save, ready, error };
}
