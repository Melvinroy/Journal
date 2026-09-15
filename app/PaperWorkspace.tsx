"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PositionExitPlanControls } from "./PositionExitPlanControls";
import { useModalAccessibility } from "./useModalAccessibility";
import { freezeRiskReference, type ExitPlanDefinition } from "../lib/trading-domain";
import { PLANS_KEY, validatePlans, type Plan } from "../lib/trading-ledger";
import "./paper-workspace.css";

type Ticket = { symbol: string; direction: "Long" | "Short"; method: string; quantity: number; planningPrice: number;
  hardCap: number; stopPrice: number; cleanupFloor: number; sessionMode: string; duration: string;
  protectionOrderType: string; protectionLimitPrice?: number; triggerPrice?: number; exitPlan: ExitPlanDefinition };
type Batch = { id: string; digest: string; sourceIdentity: string; validUntil: string; tickets: Ticket[] };
type Summary = { entered: number; exited: number; openQuantity: number; averageEntry: number | null;
  grossRealized: number | null; netRealized: number | null; fees: number | null; finalNetR: number | null };
type Campaign = { id: string; batchId: string; revision: number; symbol: string; direction: "Long" | "Short";
  state: string; message: string | null; automation: string; ticket: Ticket; summary: Summary;
  draft: { exitPlan: ExitPlanDefinition; digest: string } | null;
  slots: { id: string; entryStatus: string; stopStatus: string; confirmedStop: number | null; exitStatus: string | null;
    leg: { id: string; role: string } | null }[];
  executions: { executionId: string; effect: string; role: string; quantity: number; price: number; occurredAt: string; commission: number | null }[] };
type Status = { connected: boolean; armedBatch: string | null; submissionsEnabled: boolean; account: string | null;
  connectionId: string | null; lastReconciled: string | null; error: string | null; campaigns: Campaign[]; batches: Batch[] };
const defaultExits: ExitPlanDefinition = { schemaVersion: 1,
  breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } }, legs: [
    { id: "T1", role: "Target", allocationPercent: 35, target: { mode: "R", multipleR: 1 } },
    { id: "Runner A", role: "Runner", allocationPercent: 35, activationR: 1, trailing: { mode: "Dollar", distance: .5 } },
    { id: "Runner B", role: "Runner", allocationPercent: 30, activationR: 2, trailing: { mode: "Percentage", percent: 5 } },
  ] };
const blank: Ticket = { symbol: "", direction: "Long", method: "Limit", quantity: 3, planningPrice: 0,
  hardCap: 0, stopPrice: 0, cleanupFloor: 0, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: defaultExits };
const number = (value: number | null | undefined, currency = true) => value == null ? "Unavailable" : value.toLocaleString(undefined,
  currency ? { style: "currency", currency: "USD", minimumFractionDigits: 2 } : { maximumFractionDigits: 3 });

export function PaperWorkspace({ view }: { view: "positions" | "journal" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<Ticket>(blank);
  const [quote, setQuote] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [amendment, setAmendment] = useState(defaultExits);
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; path: string; body?: unknown } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  useModalAccessibility(!!confirmation, dialog, () => { if (!busy) setConfirmation(null); });

  const refresh = useCallback(async () => {
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      const response = await fetch("/v1/ibkr/paper/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Paper service is unavailable. Existing broker protection is not changed.");
      setStatus(await response.json() as Status);
    })();
    try { await refreshing.current; } finally { refreshing.current = null; }
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => { void refresh().catch(e => { if (active) setError(String(e.message)); }); };
    update();
    const timer = setInterval(update, 5000);
    try {
      const saved = localStorage.getItem(PLANS_KEY);
      if (saved) { const parsed: unknown = JSON.parse(saved); if (validatePlans(parsed)) setPlans(parsed as Plan[]); }
    } catch { /* Preserve unreadable local plans; do not replace them. */ }
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);

  async function request(path: string, body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/v1/ibkr/paper/${path}`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Brontide-Local": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "The paper request was rejected. Review its fields.");
      await refresh();
      setConfirmation(null);
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : "Outcome unknown. Reconcile before retrying."); }
    finally { setBusy(false); }
  }

  function confirmAction(c: Campaign, action: string, title: string) {
    setConfirmation({ title, description: `${c.symbol} · ${c.summary.openQuantity} confirmed open shares · revision ${c.revision}. Only this paper campaign's orders may change.`,
      path: `campaigns/${encodeURIComponent(c.id)}/actions`, body: { revision: c.revision, commandId: crypto.randomUUID(), action } });
  }
  let reference;
  try { reference = freezeRiskReference({ basis: "Planned", direction: ticket.direction, entryPrice: ticket.planningPrice,
    fixedStopPrice: ticket.stopPrice, frozenAt: new Date().toISOString() }); }
  catch { reference = undefined; }

  return <section className="paper-workspace" aria-label="TWS paper workspace">
    <header className="paper-header"><div><p className="eyebrow">Local paper trading</p><h1>{view === "journal" ? "Paper Journal" : "Paper Plan & Position"}</h1>
      <p>Broker-confirmed events · separate from demo records</p></div><a href="?demo=1">Open demo</a></header>
    <section className="paper-panel" aria-label="Paper connection">
      <div className="paper-row"><strong>{status?.connected ? `Connected · ${status.account}` : "Disconnected"}</strong>
        <span>{status?.armedBatch ? "Exact batch armed" : "Submissions locked"}</span></div>
      <p>Up to 3 shares per campaign · 2 campaigns · $500 entry notional · $10 planned stop risk per campaign.</p>
      <p>Last reconciliation: {status?.lastReconciled ? new Date(status.lastReconciled).toLocaleString() : "Not completed"}</p>
      <div className="paper-actions">
        <button disabled={busy || status?.connected} onClick={() => void request("connect")}>Connect paper TWS</button>
        <button disabled={busy || !status?.connected} onClick={() => void request("reconcile")}>Reconcile broker state</button>
        <button disabled={busy || !status?.armedBatch} onClick={() => void request("disarm")}>Lock submissions</button>
        <button disabled={busy || !status?.connected} onClick={() => setConfirmation({ title: "Disconnect Brontide?", description: "Broker-held stops remain at TWS. Application-managed trailing and breakeven pause.", path: "disconnect" })}>Disconnect</button>
      </div>
      <p>Short fill-bound testing, opening auction and overnight submission remain blocked.</p>
    </section>
    {(error || status?.error) && <p className="paper-error" role="alert">{error || status?.error}</p>}
    {view === "positions" && <div className="paper-columns"><form className="paper-panel" aria-label="Paper ticket" onSubmit={e => { e.preventDefault(); void request("batches", { tickets: [ticket] }); }}>
      <h2>Prepare an exact ticket</h2><p>Preparation saves a reviewable batch. It sends no order.</p>
      {!!plans.length && <label>Copy prices from a saved plan<select defaultValue="" onChange={e => {
        const p = plans.find(p => p.id === e.target.value); if (p) setTicket({ ...ticket, symbol: p.symbol, direction: p.side, planningPrice: p.entry,
          hardCap: p.entry, stopPrice: p.tranches[0]?.stop ?? 0, cleanupFloor: p.tranches[0]?.stop ?? 0 });
      }}><option value="">Choose a plan</option>{plans.map(p => <option value={p.id} key={p.id}>{p.symbol} · {p.name}</option>)}</select></label>}
      <div className="paper-fields">
        <label>Symbol<input required pattern="[A-Za-z0-9.-]+" maxLength={32} value={ticket.symbol} onChange={e => { setTicket({ ...ticket, symbol: e.target.value.toUpperCase() }); setQuote(""); }} /></label>
        <label>Direction<select value={ticket.direction} onChange={e => setTicket({ ...ticket, direction: e.target.value as Ticket["direction"] })}><option>Long</option><option>Short</option></select></label>
        <label>Entry<select value={ticket.method} onChange={e => setTicket({ ...ticket, method: e.target.value })}><option value="Limit">Limit</option><option value="Normal">Capped midpoint</option><option value="Breakout">Stop-limit breakout</option></select></label>
        <label>Shares<input type="number" min="1" max="3" required value={ticket.quantity} onChange={e => setTicket({ ...ticket, quantity: Number(e.target.value) })} /></label>
        <label>Session<select value={ticket.sessionMode} onChange={e => setTicket({ ...ticket, sessionMode: e.target.value,
          protectionOrderType: e.target.value === "RegularExtended" ? "STP LMT" : "STP" })}><option value="Regular">Regular hours</option><option value="RegularExtended">Regular + extended</option></select></label>
        {([ ["planningPrice", "Captured planning price"], ["hardCap", "Entry price cap"], ["stopPrice", "Initial protective stop"], ["cleanupFloor", "Fixed cleanup floor"] ] as const).map(([key, label]) =>
          <label key={key}>{label}<input required type="number" step="any" min="0.0001" value={ticket[key] || ""} onChange={e => setTicket({ ...ticket, [key]: Number(e.target.value) })} /></label>)}
        {ticket.method === "Breakout" && <label>Entry trigger<input required type="number" min="0.0001" step="any" value={ticket.triggerPrice || ""} onChange={e => setTicket({ ...ticket, triggerPrice: Number(e.target.value) })} /></label>}
        {ticket.protectionOrderType === "STP LMT" && <label>Protection limit<input required type="number" min="0.0001" step="any" value={ticket.protectionLimitPrice || ""} onChange={e => setTicket({ ...ticket, protectionLimitPrice: Number(e.target.value) })} /></label>}
      </div>
      <button type="button" disabled={busy || !status?.connected || !ticket.symbol} onClick={async () => {
        setBusy(true); setError("");
        try { const r = await fetch(`/v1/ibkr/paper/quote/${encodeURIComponent(ticket.symbol)}`); const q = await r.json();
          if (!r.ok) throw new Error(q.detail); setQuote(`${q.source} · bid ${number(q.quote.bid)} / ask ${number(q.quote.ask)} · ${new Date(q.observedAt).toLocaleTimeString()} · ${q.executable ? "Live" : "Not executable"}`);
        } catch(e) { setError(e instanceof Error ? e.message : "Quote unavailable."); } finally { setBusy(false); }
      }}>Read fresh quote</button><p role="status">{quote}</p>
      <details><summary>Targets, runners and breakeven</summary><PositionExitPlanControls definition={ticket.exitPlan} direction={ticket.direction}
        quantity={ticket.quantity} reference={reference} onChange={exitPlan => setTicket({ ...ticket, exitPlan })} /></details>
      <p>Entry notional: {number(ticket.quantity * ticket.hardCap)} · planned stop risk: {number(ticket.quantity * Math.abs(ticket.hardCap - ticket.stopPrice))}. Stop risk is not a guaranteed loss limit.</p>
      <button disabled={busy || !status?.connected}>Prepare batch for review</button>
    </form><section className="paper-panel" aria-label="Prepared paper batches"><h2>Prepared batches</h2>
      {!status?.batches.length && <p>No batch prepared. Old session tickets are not reused.</p>}
      {status?.batches.slice().reverse().map(b => <article className="paper-batch" key={b.id}>
        <h3>{b.tickets.map(t => t.symbol).join(" + ")}</h3><p>Source {b.sourceIdentity} · expires {new Date(b.validUntil).toLocaleString()}</p>
        {b.tickets.map((t, index) => <div key={index}><p>{t.direction} {t.quantity} × {t.symbol} · {t.method} · {t.sessionMode} · DAY</p>
          <p>Entry cap {number(t.hardCap)} · stop {number(t.stopPrice)} · cleanup floor {number(t.cleanupFloor)}
            {t.triggerPrice ? ` · entry trigger ${number(t.triggerPrice)}` : ""}{t.protectionLimitPrice ? ` · protection limit ${number(t.protectionLimitPrice)}` : ""}</p>
          <ul>{t.exitPlan.legs.map(leg => <li key={leg.id}>{leg.id}: {leg.allocationPercent}% · {leg.role === "Target"
            ? leg.target.mode === "R" ? `${leg.target.multipleR}R target` : `target ${number(leg.target.price)}`
            : `activate at ${leg.activationR}R; ${leg.trailing.mode === "Dollar" ? `${number(leg.trailing.distance)} trail` : leg.trailing.mode === "Percentage" ? `${leg.trailing.percent}% trail` : leg.trailing.mode === "SMA" ? `SMA${leg.trailing.period}` : leg.trailing.mode === "Manual" ? `manual stop ${number(leg.trailing.stopPrice)}` : "day extreme"}`}</li>)}</ul>
          <p>Breakeven: {t.exitPlan.breakeven.activationR}R with {t.exitPlan.breakeven.favorableOffset.value} {t.exitPlan.breakeven.favorableOffset.unit} favorable offset.</p>
          <button disabled={busy || status.armedBatch !== b.id || Date.parse(b.validUntil) <= Date.now()} onClick={() => setConfirmation({
            title: `Submit ${t.symbol} paper brackets?`, description: `${t.quantity} one-share brackets. Cap ${number(t.hardCap)}, stop ${number(t.stopPrice)}. Only the reviewed batch is eligible.`,
            path: "submit", body: { batchId: b.id, ticketIndex: index, commandId: crypto.randomUUID() } })}>Review paper submission</button></div>)}
        <details><summary>Batch approval identity</summary><p className="paper-code">{b.id}</p><p className="paper-code">{b.digest}</p>
          <p>An operator-approved receipt must match this batch, source, account binding and current connection. This screen cannot create that approval.</p></details>
        <button disabled={busy || !status.connected || !status.submissionsEnabled || Date.parse(b.validUntil) <= Date.now()} onClick={() => void request(`batches/${b.id}/arm`)}>Arm approved batch</button>
      </article>)}
    </section></div>}
    <section className="paper-panel" aria-label={view === "journal" ? "Broker-confirmed paper journal" : "Paper campaigns"}>
      <h2>{view === "journal" ? "One row per paper campaign" : "Campaigns and protection"}</h2>
      {!status?.campaigns.length && <p>No broker-confirmed paper campaigns. A saved plan or accepted order is not a fill.</p>}
      <div className="paper-scroll" tabIndex={0} aria-label="Paper campaign results"><table><thead><tr><th>Symbol</th><th>State</th><th>Filled / open</th><th>Average entry</th><th>Net realized</th><th>Final net R</th><th>Details</th></tr></thead>
        <tbody>{status?.campaigns.filter(c => view !== "journal" || c.summary.entered > 0).map(c => <tr key={c.id}><th scope="row">{c.symbol} · {c.direction}</th><td>{c.state}</td>
          <td>{c.summary.entered} / {c.summary.openQuantity}</td><td>{number(c.summary.averageEntry)}</td><td>{number(c.summary.netRealized)}</td><td>{number(c.summary.finalNetR, false)}</td>
          <td><button onClick={() => { setSelected(c); setAmendment(c.draft?.exitPlan ?? c.ticket.exitPlan); }}>Inspect {c.symbol}</button></td></tr>)}</tbody></table></div>
      {selected && (() => { const c = status?.campaigns.find(c => c.id === selected.id) ?? selected; return <article className="paper-detail" aria-label={`${c.symbol} campaign detail`}>
        <div className="paper-row"><h3>{c.symbol} · revision {c.revision}</h3><button onClick={() => setSelected(null)}>Close details</button></div>
        <p>{c.automation}</p>{c.message && <p role="status">{c.message}</p>}
        <ul>{c.slots.map(s => <li key={s.id}>Share {Number(s.id) + 1}: entry {s.entryStatus}; stop {s.stopStatus} at {number(s.confirmedStop)}; {s.leg?.id ?? "allocation pending"}{s.exitStatus ? `; exit ${s.exitStatus}` : ""}</li>)}</ul>
        <h4>Broker executions</h4>{!c.executions.length && <p>No executions reported.</p>}
        <ul>{c.executions.map(e => <li key={e.executionId}>{e.effect} · {e.quantity} @ {number(e.price)} · {e.occurredAt} · fee {number(e.commission)}</li>)}</ul>
        <p>Gross realized {number(c.summary.grossRealized)} · fees {number(c.summary.fees)}. Missing commissions keep net results unavailable.</p>
        {view === "positions" && <><div className="paper-actions">{([
          ["cancel-entry", "Cancel unfilled entry"], ["cancel-exits", "Pause and cancel working exits"], ["cleanup", "Request bounded cleanup"], ["resume", "Resume reviewed exit rules"],
        ] as const).map(([action, title]) => <button key={action} disabled={busy || status?.armedBatch !== c.batchId} onClick={() => confirmAction(c, action, title)}>{title}</button>)}</div>
          <details><summary>Draft an exit amendment</summary><PositionExitPlanControls definition={amendment} direction={c.direction} quantity={c.summary.openQuantity}
            onChange={setAmendment} /><div className="paper-actions"><button disabled={busy} onClick={() => void request(`campaigns/${encodeURIComponent(c.id)}/actions`,
              { revision: c.revision, commandId: crypto.randomUUID(), action: "save-amendment", payload: amendment })}>Save unapplied draft</button>
            <button disabled={busy || !c.draft || status?.armedBatch !== c.batchId} onClick={() => confirmAction(c, "apply-amendment", "Apply saved exit amendment?")}>Review and apply draft</button></div>
            {c.draft && <p className="paper-code">Saved amendment requires exact approval: {c.draft.digest}</p>}</details></>}
      </article>; })()}
    </section>
    {confirmation && <div className="paper-modal-backdrop"><section ref={dialog} className="paper-confirm" role="dialog" aria-modal="true" aria-labelledby="paper-confirm-title" tabIndex={-1}>
      <h2 id="paper-confirm-title">{confirmation.title}</h2><p>{confirmation.description}</p>
      {error && <p role="alert">{error}</p>}<div className="paper-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
        <button disabled={busy} onClick={() => void request(confirmation.path, confirmation.body)}>{busy ? "Awaiting result…" : "Confirm paper action"}</button></div>
    </section></div>}
  </section>;
}
