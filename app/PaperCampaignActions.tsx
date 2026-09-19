"use client";
import { useRef, useState } from "react";
import { exitDescriptions } from "../lib/paper-execution";
import type { PaperCampaign } from "../lib/paper-execution";
import type { PaperExecution } from "./usePaperExecution";

export function PaperCampaignActions({ campaign: c, paper }: { campaign: PaperCampaign; paper: PaperExecution }) {
  const [review, setReview] = useState<{ action: string; label: string; revision: number; commandId: string; connectionId: string | null; digest?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function apply() {
    if (!review || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await paper.request(`campaigns/${encodeURIComponent(c.id)}/actions`, { revision: review.revision, commandId: review.commandId,
        action: review.action, connectionId: review.connectionId, payload: review.digest ? { digest: review.digest } : null });
      setReview(null); await paper.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Outcome unknown. Reconcile before retrying."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="broker-campaign-actions" aria-label="Paper position actions">
    <p role="status">{c.automation}{c.message ? ` · ${c.message}` : ""}</p>
    <ul>{c.slots.map(s => <li key={s.id}>Share {Number(s.id)+1}: entry {s.entryStatus} · stop {s.stopStatus}{s.confirmedStop != null ? ` at $${s.confirmedStop.toFixed(2)}` : ""} · {s.leg?.id ?? "allocation pending"}{s.exitStatus ? ` · exit ${s.exitStatus}` : ""}</li>)}</ul>
    <div className="editor-actions">{([
      ["cancel-entry", "Cancel unfilled entry"], ["cancel-exits", "Pause managed rules"], ["cleanup", "Close with bounded limit"],
      ["resume", "Review and resume exits"], ["apply-amendment", "Review saved amendment"], ["recover", "Reconcile owned campaign"],
    ] as const).map(([action,label]) => <button key={action} disabled={busy || !paper.status?.connected || (action !== "recover" && !paper.status.submissionsEnabled) ||
      ["Closed", "Cancelled"].includes(c.state) || (action === "apply-amendment" && !c.draft)} onClick={() => {
        setError(""); setReview({ action, label, connectionId: paper.status?.connectionId ?? null, revision: c.revision, commandId: crypto.randomUUID(), digest: action === "apply-amendment" ? c.draft?.digest : undefined });
      }}>{label}</button>)}</div>
    {review && <div className="workspace-notice" role="group" aria-label="Confirm paper position action">
      <strong>{review.label} · {c.symbol} · {c.summary.openQuantity} open shares</strong>
      <p>Revision {review.revision}. {review.action === "cancel-entry" ? "Cancel only this campaign's unfilled entries. Any fills received during cancellation must be reconciled and remain protected." : review.action === "cancel-exits" ? "Pause application-managed rules without cancelling broker orders." : review.action === "recover" ? "Rebuild from fresh broker evidence. This sends no orders and keeps managed exits paused." : `Existing broker orders are retained until execution. Bounded closure cannot go below $${c.ticket.cleanupFloor.toFixed(2)} or a tighter confirmed stop.`}</p>
      {c.state === "Unprotected" && <p role="alert">No active stop is confirmed. Recovery and bounded closure are required before further trading.</p>}
      {review.action === "apply-amendment" && c.draft && <><p>Exact saved exit rules:</p><ul>{exitDescriptions(c.draft.exitPlan, c.draft.quantity).map(line => <li key={line}>{line}</li>)}</ul><p>Breakeven {c.draft.exitPlan.breakeven.activationR}R · {c.draft.exitPlan.breakeven.favorableOffset.value} {c.draft.exitPlan.breakeven.favorableOffset.unit}</p></>}
      {(review.revision !== c.revision || review.connectionId !== paper.status?.connectionId) && <p role="alert">Position changed. Cancel this review and inspect the latest state.</p>}
      <button disabled={busy} onClick={() => setReview(null)}>Cancel action review</button>
      <button disabled={busy || (review.revision !== c.revision || review.connectionId !== paper.status?.connectionId)} onClick={() => void apply()}>Confirm {review.label.toLowerCase()}</button>
    </div>}
    {error && <p className="persistence-alert" role="alert">{error}</p>}
  </section>;
}
