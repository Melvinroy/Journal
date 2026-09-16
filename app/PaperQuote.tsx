"use client";
import { useEffect, useRef, useState } from "react";
import type { PaperExecution } from "./usePaperExecution";
type Quote = { contract: { symbol: string }; observedAt: string; executable: boolean; error: string | null; quote: { bid: number | null; ask: number | null } };

export function PaperQuote({paper, symbol, side, onApply}: {paper: PaperExecution; symbol: string; side: "Long" | "Short"; onApply: (price: number, observedAt: string) => void}) {
  const selection = `${symbol}:${side}`;
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const inFlight = useRef(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setError(""); }, [selection]);
  async function refresh(apply: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const next = await paper.request<Quote>(`quote/${encodeURIComponent(symbol)}`);
      if (currentSelection.current !== selection) throw new Error("Symbol or side changed; refresh its quote again.");
      setQuote(next);
      const value = side === "Long" ? next.quote.ask : next.quote.bid;
      const age = Date.now() - Date.parse(next.observedAt);
      if (!next.executable || next.contract.symbol !== symbol || !Number.isFinite(value) || value! <= 0 || !Number.isFinite(age) || age < -5000 || age > 15000) throw new Error(next.error ?? "Fresh executable quote unavailable.");
      if (apply) onApply(value!, next.observedAt);
    } catch(e) { setError(e instanceof Error ? e.message : "Quote unavailable."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const shown = quote?.contract.symbol === symbol ? quote : null;
  const observed = shown ? Date.parse(shown.observedAt) : NaN;
  const stale = shown && (!Number.isFinite(observed) || now - observed > 15000 || observed - now > 5000);
  const format = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "—";
  return <section className="paper-quote" aria-label="Executable broker quote" aria-busy={busy}>
    <div className="paper-quote-prices"><span>IBKR <b>{symbol}</b></span><span>Bid <strong>{format(shown?.quote.bid)}</strong></span><span>Ask <strong>{format(shown?.quote.ask)}</strong></span></div>
    <div className="paper-quote-actions">
      <button type="button" disabled={busy || !symbol || !paper.status?.connected} onClick={() => void refresh(false)}>{busy ? "Refreshing…" : "Refresh bid / ask"}</button>
      <button type="button" disabled={busy || !symbol || !paper.status?.connected} onClick={() => void refresh(true)}>Use {side === "Long" ? "ask" : "bid"} in draft</button>
    </div>
    <p className="paper-quote-caption" role="status">{busy ? "Requesting broker quote…" : !paper.status?.connected ? "Connect TWS to load quotes." : shown ? `${Number.isFinite(observed) ? `Snapshot ${new Date(observed).toLocaleTimeString()}` : "Quote time unavailable"}${stale ? " · Stale — refresh before use." : !shown.executable ? " · Not executable." : ""}` : "No quote loaded."} Apply fetches a fresh quote and updates entry and cap; save and review again.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
