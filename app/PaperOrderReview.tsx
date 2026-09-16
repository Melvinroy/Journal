"use client";
import { useEffect, useRef, useState } from "react";
import { exitDescriptions, paperTicketBlockers } from "../lib/paper-execution";
import type { PaperBatch, PaperTicket } from "../lib/paper-execution";
import type { PaperExecution } from "./usePaperExecution";
import { useModalAccessibility } from "./useModalAccessibility";

export function PaperOrderReview({ paper, ticket, saved }: { paper: PaperExecution; ticket: PaperTicket; saved: boolean }) {
  const [batch, setBatch] = useState<PaperBatch | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ids, setIds] = useState({ approval: "", submit: "" });
  const inFlight = useRef(false);
  const drawer = useRef<HTMLElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const blockers = paperTicketBlockers(ticket);
  const fingerprint = JSON.stringify(ticket);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setBatch(null); setMessage(""); }, [fingerprint, saved, paper.status?.connectionId, paper.status?.connected, paper.status?.account, paper.signedIn]);
  useModalAccessibility(Boolean(batch), drawer, () => { if (!busy) setBatch(null); }, reviewButton);
  async function review() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const b = await paper.request<PaperBatch>("batches", { tickets: [ticket] });
      if (generation.current !== current) throw new Error("Plan or connection changed during preparation. Review the new revision.");
      setBatch(b); setIds({ approval: crypto.randomUUID(), submit: crypto.randomUUID() }); await paper.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Order review unavailable."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!batch || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await paper.request(`batches/${batch.id}/approve`, { digest: batch.digest, commandId: ids.approval });
      await paper.request("submit", { batchId: batch.id, ticketIndex: 0, commandId: ids.submit });
      setBatch(null); setMessage("Order request recorded. Watch Positions for broker acknowledgement and actual fills."); await paper.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Submission outcome unknown. Reconcile before retrying."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="paper-intent-readiness" aria-label="Paper order review">
    <div><p className="eyebrow">TWS paper execution</p><h2>Review and submit</h2>
      <p>Review the saved entry and exits before sending.</p>
      <p>Paper test limits: 3 shares per campaign · 2 campaigns · $500 entry notional · $10 risk per campaign / $20 total.</p>
      {blockers.length > 0 && <ul className="paper-preflight" aria-label="Paper order blockers">{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {!saved && <p role="status">Save the current plan and exit settings before review.</p>}
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</div>
    <button ref={reviewButton} type="button" disabled={!saved || blockers.length > 0 || !paper.status?.connected || busy} onClick={() => void review()}>{busy ? "Checking…" : "Review paper order"}</button>
    {batch && <div className="modal-backdrop"><section ref={drawer} tabIndex={-1} className="modal broker-order-review" role="dialog" aria-modal="true" aria-labelledby="paper-review-title">
      <h2 id="paper-review-title">Review {batch.tickets[0].symbol} paper order</h2>
      <p>{paper.status?.account} · {batch.tickets[0].direction} · {batch.tickets[0].quantity} shares · {batch.tickets[0].method} · {batch.tickets[0].sessionMode} / {batch.tickets[0].duration}</p>
      <p>Entry cap ${batch.tickets[0].hardCap.toFixed(2)}{batch.tickets[0].triggerPrice ? ` · trigger $${batch.tickets[0].triggerPrice.toFixed(2)}` : ""} · initial stop ${batch.tickets[0].stopPrice.toFixed(2)} · cleanup floor ${batch.tickets[0].cleanupFloor.toFixed(2)}.</p>
      <p>{batch.tickets[0].protectionOrderType}{batch.tickets[0].protectionLimitPrice ? ` · protection limit $${batch.tickets[0].protectionLimitPrice.toFixed(2)}` : ""}. Each share has its own broker-held protection.</p>
      <ul>{exitDescriptions(batch.tickets[0].exitPlan, batch.tickets[0].quantity).map(line => <li key={line}>{line}</li>)}</ul>
      <p>Breakeven {batch.tickets[0].exitPlan.breakeven.activationR}R · offset {batch.tickets[0].exitPlan.breakeven.favorableOffset.value} {batch.tickets[0].exitPlan.breakeven.favorableOffset.unit}.</p>
      <p>Expires {new Date(batch.validUntil).toLocaleString()} · source {batch.sourceIdentity}. Planned stop risk is not a guaranteed loss limit.</p>
      {!paper.status?.submissionsEnabled && <p role="status">Server submissions are locked. No order can be sent until the operator enables this reviewed paper test.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button disabled={busy} onClick={() => setBatch(null)}>Cancel</button><button disabled={busy || !paper.status?.connected || !paper.status.submissionsEnabled || Date.parse(batch.validUntil) <= Date.now()} onClick={() => void confirm()}>Confirm and submit paper order</button></div>
    </section></div>}
  </section>;
}
