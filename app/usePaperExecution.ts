"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Identity = { userId: string; email: string; linked: boolean; linkState?: string; message?: string };
import type { PaperStatus } from "../lib/paper-execution";

export function usePaperExecution(token: string | undefined, enabled: boolean) {
  const [status, setStatus] = useState<PaperStatus | null>(null);
  const [error, setError] = useState("");
  const [errorState, setErrorState] = useState<"blocked" | "error" | "disconnected">("blocked");
  const [connecting, setConnecting] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const paused = useRef(false);
  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    if (!enabled || !token) throw new Error("Sign into Brontide to use paper execution.");
    const r = await fetch(`/v1/ibkr/paper/${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Brontide-Local": "1" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await r.json();
    if (!r.ok) throw Object.assign(new Error(value.detail ?? "Local paper service unavailable."), { status: r.status });
    return value as T;
  }, [token, enabled]);
  const refresh = useCallback(async () => {
    const next = await request<PaperStatus>("status"); setStatus(next); setError(""); return next;
  }, [request]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>, retry = 1000;
    paused.current = false; setStatus(null); setIdentity(null); setError("");
    if (!enabled || !token) return;
    async function poll() {
      try {
        const who = await request<Identity>("identity");
        if (!active) return;
        setIdentity(who);
        if (!who.linked) throw Object.assign(new Error(who.message ?? "One-time local account link required. See connection details."), { status: who.linkState === "mismatch" ? 403 : 400 });
        let next = await request<PaperStatus>("status");
        if (!active) return;
        if (!next.connected && !paused.current) {
          setConnecting(true);
          next = await request<PaperStatus>("connect", {});
        }
        if (!active) return;
        setStatus(next); setError(""); retry = 5000;
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Local paper service unavailable.";
        const code = (e as { status?: number }).status;
        setErrorState(code === 400 ? "blocked" : code === 401 || code === 403 || /account.*mismatch|verification|unexpected.*account/i.test(message) ? "error" : "disconnected");
        setError(message);
        setStatus(s => s ? { ...s, connected: false, armedBatch: null } : null);
        retry = Math.min(retry * 2, 30000);
      } finally {
        if (active) { setConnecting(false); timer = setTimeout(() => { void poll(); }, retry); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [request, token, enabled]);
  const disconnect = async () => { paused.current = true; await request("disconnect", {}); await refresh(); };
  const reconnect = async () => { paused.current = false; setConnecting(true); try { await request("connect", {}); await refresh(); } finally { setConnecting(false); } };
  return { status, error, errorState, identity, connecting, request, refresh, disconnect, reconnect, enabled, signedIn: Boolean(token) };
}
export type PaperExecution = ReturnType<typeof usePaperExecution>;
