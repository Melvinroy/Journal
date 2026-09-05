"use client";
import { useCallback, useEffect, useState } from "react";
import { readStored, writeStored } from "./workspace-state";

// Explicit writes only: a failed read never silently replaces saved user data.
export function useBrowserStore<T>(key: string, fallback: T, validate?: (value:unknown)=>boolean) {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const read = () => {
      try { const next=readStored(window.localStorage, key, fallback);if(validate&&!validate(next))throw new Error("Invalid saved data");setValue(next); setError(""); setReady(true); }
      catch { setError("Browser storage unavailable or unreadable. Existing data has not been overwritten."); setReady(false); }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("brontide-store", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("brontide-store", read); };
    // fallback is an initial constant, not an instruction to replace stored work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useCallback((next: T) => {
    if (!ready) return false;
    if(validate&&!validate(next)){setError("Invalid data; existing saved records were not changed.");return false;}
    try {
      if(JSON.stringify(readStored(window.localStorage,key,fallback))!==JSON.stringify(value)){setError("Saved data changed in another view. Reload before saving to avoid overwriting it.");return false;}
      writeStored(window.localStorage, key, next); setValue(next); setError(""); window.dispatchEvent(new Event("brontide-store")); return true;
    }
    catch { setError("Could not save. Browser storage may be full or disabled."); return false; }
  }, [key, ready, value]);
  return { value, save, ready, error };
}
