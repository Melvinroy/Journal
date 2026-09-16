"use client";
import { useRef, useState } from "react";
import type { PaperExecution } from "./usePaperExecution";
type Quote = { contract: { symbol: string }; observedAt: string; executable: boolean; error: string | null; quote: { bid: number | null; ask: number | null } };

export function PaperQuote({paper, symbol, onApply}: {paper: PaperExecution; symbol: string; onApply: (price: number, observedAt: string) => void}) {
  const currentSymbol = useRef(symbol);
  currentSymbol.current = symbol;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh(apply: boolean) {
    setBusy(true); setError("");
    try {
      const next = await paper.request<Quote>(`quote/${encodeURIComponent(symbol)}`);
      if (currentSymbol.current !== symbol) throw new Error("Symbol changed; refresh its quote again.");
      setQuote(next);
      if (!next.executable || next.contract.symbol !== symbol || !next.quote.ask || Date.now() - Date.parse(next.observedAt) > 15000) throw new Error(next.error ?? "Fresh executable quote unavailable.");
      if (apply) onApply(next.quote.ask, next.observedAt);
    } catch(e) { setError(e instanceof Error ? e.message : "Quote unavailable."); }
    finally { setBusy(false); }
  }
  const shown = quote?.contract.symbol === symbol ? quote : null;
  return <section className="workspace-notice" aria-label="Executable broker quote">
    <strong>IBKR bid {shown?.quote.bid ?? "—"} · ask {shown?.quote.ask ?? "—"}</strong>
    <p>{shown ? `Snapshot ${new Date(shown.observedAt).toLocaleTimeString()}` : "No quote loaded for this symbol."} Prices are snapshots; each order is revalidated.</p>
    <button disabled={busy || !paper.status?.connected} onClick={() => void refresh(false)}>Refresh bid / ask</button>{" "}
    <button disabled={busy || !paper.status?.connected} onClick={() => void refresh(true)}>Use fresh ask in draft</button>
    <p>Updating the draft changes its entry and cap. Save and review again before submission.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
