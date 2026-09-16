"use client";
import { useRef, useState } from "react";
import type { PaperExecution } from "./usePaperExecution";

export function PaperTestSessionPanel({paper}: {paper: PaperExecution}) {
  const session = paper.status?.testSession;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef("");
  async function action(kind: "start" | "pause" | "resume") {
    if (busy) return;
    setBusy(true); setError("");
    if (!command.current) command.current = crypto.randomUUID();
    try {
      await paper.request(`test-session/${kind}`, kind === "start" ? {commandId: command.current, target: 200} : {});
      await paper.refresh();
    } catch(e) { setError(e instanceof Error ? e.message : "Session outcome unknown; reconcile before retrying."); }
    finally { setBusy(false); }
  }
  return <details className="workspace-notice">
    <summary>Paper test session{session ? ` · ${session.completed}/${session.target} round trips · ${session.state}` : " · not started"}</summary>
    <p>Standing approval: up to 200 completed paper round trips. Maximum 3 shares per campaign, 2 campaigns, $500 entry notional, $10 risk per campaign and $20 total. PL, AMD and unrelated positions/orders are excluded.</p>
    <p>Fresh USD stock quotes determine each exact ticket: spread at most 0.1% (minimum $0.02 allowance), entry cap two ticks above ask (cancellation cases use a higher stop-limit trigger plus two ticks), initial stop at least 0.5% or ten ticks below bid. Unfilled entries receive a cancellation request after 20 seconds; bounded closure starts after 45 seconds. Unsupported cases stay blocked.</p>
    <p>Targets, runners, entry methods and amendments rotate. Submitted or cancelled entries do not count as round trips. Trigger-dependent behavior is reported separately from completed trades.</p>
    {session && <p role="status">{session.message} · Checkpoints: {session.checkpoints.join(", ") || "none"}</p>}
    {!session ? <button disabled={busy || !paper.status?.connected || !paper.status.submissionsEnabled} onClick={() => void action("start")}>Start approved 200-trade paper session</button> : <>
      <button disabled={busy || session.state !== "Running"} onClick={() => void action("pause")}>Pause new entries and finish cleanup</button>{" "}
      <button disabled={busy || !["Halted", "Paused"].includes(session.state)} onClick={() => void action("resume")}>Resume approved session</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
