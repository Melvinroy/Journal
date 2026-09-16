"use client";
import { useState } from "react";
import type { PaperExecution } from "./usePaperExecution";
import "./broker-connection.css";

export function BrokerConnection({ paper, demo = false }: { paper?: PaperExecution; demo?: boolean }) {
  const [message, setMessage] = useState("");
  if (!paper || demo) return <section className="broker-account-summary" aria-label="IBKR account summary"><strong>{demo ? "Simulation · no broker connection" : "TWS disconnected"}</strong><dl><div><dt>Paper account</dt><dd>Unavailable</dd></div><div><dt>Account value</dt><dd>Unavailable</dd></div><div><dt>Last successful update</dt><dd>Not completed</dd></div></dl></section>;
  const stale = !paper.status?.connected || Boolean(paper.error) || paper.status?.broker?.dataStatus === "stale";
  const updatedAt = paper.status?.broker?.lastSuccessfulUpdate;
  const state = paper.connecting ? "connecting" : paper.error ? paper.errorState : paper.status?.readiness.state ?? "disconnected";
  const label = state === "ready" ? "Paper connected" : state === "connecting" ? "Connecting to TWS" :
    state === "error" ? "Paper needs attention" : state === "blocked" ? "Paper connection blocked" : "TWS disconnected";
  async function run(action: () => Promise<unknown>) { try { setMessage(""); await action(); } catch (e) { setMessage(e instanceof Error ? e.message : "Connection unavailable."); } }
  return <section className="broker-account-summary" aria-label="IBKR account summary">
    <div className="broker-account-status"><i className={`broker-dot ${state}`} aria-hidden="true" /><strong>{label}</strong></div>
    <dl><div><dt>Paper account</dt><dd>{paper.status?.account ?? "Unavailable"}</dd></div><div><dt>Account value</dt><dd>{paper.status?.broker?.account?.value == null ? "Unavailable" : `${paper.status.broker.account.value.toLocaleString()} ${paper.status.broker.account.currency ?? ""}${stale ? " · Stale" : ""}`}</dd></div><div><dt>Last successful update</dt><dd>{updatedAt ? `${new Date(updatedAt).toLocaleString()}${stale ? " · Stale" : ""}` : "Not completed"}</dd></div></dl>
    <details className="broker-connection"><summary aria-label={`Connection details. TWS connection: ${label}`}><i className={`broker-dot ${state}`} aria-hidden="true" />Connection details</summary>
    <div className="broker-connection-detail"><strong>{paper.status?.account ?? "No verified paper connection"}</strong>
      <p role="status">{paper.error || paper.status?.readiness.message || "Sign in and open your linked paper TWS on this computer."}</p>
      <p>Last reconciliation: {paper.status?.lastReconciled ? new Date(paper.status.lastReconciled).toLocaleString() : "Not completed"}</p>
      {paper.identity && !paper.identity.linked && <p>One-time local setup required. Verified user ID: <code>{paper.identity.userId}</code>. Confirm the configured paper account with the local operator; signing in alone never claims it.</p>}
      {paper.status?.broker?.account && <p>Account equity: {paper.status.broker.account.value == null ? "Unavailable" : `${paper.status.broker.account.value.toLocaleString()} ${paper.status.broker.account.currency ?? ""}`} · Planner equity is set separately.</p>}
      {paper.status?.broker && <details><summary>{paper.status.broker.openOrders.length} read-only broker orders</summary>{paper.status.broker.openOrders.map(o => <p key={o.id}>{o.symbol} · {o.action} {o.quantity} · {o.orderType} · {o.status}</p>)}</details>}
      <div className="editor-actions"><button type="button" disabled={!paper.signedIn || paper.connecting} onClick={() => void run(paper.reconnect)}>Retry connection</button>
        <button type="button" disabled={!paper.status?.connected} onClick={() => void run(async () => { await paper.request("reconcile", {}); await paper.refresh(); })}>Refresh broker state</button>
        <button type="button" disabled={!paper.status?.connected} onClick={() => void run(paper.disconnect)}>Disconnect</button></div>
      <p>Connection never submits an order. After reconnecting, review each position before resuming its managed exits. Disconnect pauses managed rules; broker-held stops remain at TWS.</p>
      {message && <p role="alert">{message}</p>}
    </div></details></section>;
}
