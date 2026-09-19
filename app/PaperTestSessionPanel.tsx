"use client";
import type { PaperExecution } from "./usePaperExecution";

export function PaperTestSessionPanel({paper}: {paper: PaperExecution}) {
  const session = paper.status?.testSession;
  return <details className="workspace-notice paper-test-progress">
    <summary>Testing{session ? ` · ${session.completed} session round trips · ${session.state}` : " · no session record"}</summary>
    <p>Use this planner to prepare and review paper orders, Positions to manage them, and Journal to verify results. This section reports the existing test-session ledger; it does not start or resume automated trading.</p>
    {session && <>
      <p>Recorded session target: {session.target}. Completed: {session.completed}. Checkpoints: {session.checkpoints.join(", ") || "none"}.</p>
      <p role="status">{session.message}</p>
    </>}
    <p>Cancelled entries do not count as round trips. Completed trades do not prove every scenario passed.</p>
  </details>;
}
