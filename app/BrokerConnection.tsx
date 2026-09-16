"use client";
import { useState } from "react";
import type { PaperExecution } from "./usePaperExecution";
import "./broker-connection.css";

export function BrokerConnection({ paper }: { paper: PaperExecution }) {
  const [message, setMessage] = useState("");
  const state = paper.connecting ? "connecting" : paper.error ? paper.errorState : paper.status?.readiness.state ?? "disconnected";
  const label = state === "ready" ? "Paper connected" : state === "connecting" ? "Connecting to TWS" :
    state === "error" ? "Paper needs attention" : state === "blocked" ? "Paper connection blocked" : "TWS disconnected";
  async function run(action: () => Promise<unknown>) { try { setMessage(""); await action(); } catch (e) { setMessage(e instanceof Error ? e.message : "Connection unavailable."); } }
  return <details className="broker-connection"><summary aria-label={`TWS connection: ${label}`}><i className={`broker-dot ${state}`} aria-hidden="true" />{label}</summary>
    <div className="broker-connection-detail"><strong>{paper.status?.account ?? "No verified paper connection"}</strong>
      <p role="status">{paper.error || paper.status?.readiness.message || "Sign in and open your linked paper TWS on this computer."}</p>
      <p>Last reconciliation: {paper.status?.lastReconciled ? new Date(paper.status.lastReconciled).toLocaleString() : "Not completed"}</p>
      {paper.identity && !paper.identity.linked && <p>One-time local setup required. Verified user ID: <code>{paper.identity.userId}</code>. Confirm the configured paper account with the local operator; signing in alone never claims it.</p>}
      {paper.status?.broker?.account && <p>Account equity: {paper.status.broker.account.value == null ? "Unavailable" : `${paper.status.broker.account.value.toLocaleString()} ${paper.status.broker.account.currency ?? ""}`}. Manual sizing settings stay unchanged.</p>}
      {paper.status?.broker && <details><summary>{paper.status.broker.openOrders.length} read-only broker orders</summary>{paper.status.broker.openOrders.map(o => <p key={o.id}>{o.symbol} · {o.action} {o.quantity} · {o.orderType} · {o.status}</p>)}</details>}
      <div className="editor-actions"><button type="button" disabled={!paper.signedIn || paper.connecting} onClick={() => void run(paper.reconnect)}>Retry connection</button>
        <button type="button" disabled={!paper.status?.connected} onClick={() => void run(async () => { await paper.request("reconcile", {}); await paper.refresh(); })}>Refresh broker state</button>
        <button type="button" disabled={!paper.status?.connected} onClick={() => void run(paper.disconnect)}>Disconnect</button></div>
      <p>Connection never submits an order. After reconnecting, review each position before resuming its managed exits. Disconnect pauses managed rules; broker-held stops remain at TWS.</p>
      {message && <p role="alert">{message}</p>}
    </div></details>;
}
