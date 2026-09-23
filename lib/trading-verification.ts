// Bundled sanitized evidence only; never used as an execution capability policy.
export type EvidenceState = "Broker-observed" | "Deterministic" | "Blocked" | "Failed" | "Unobserved";
export type EvidenceGroup = "planning" | "execution" | "protection" | "accounting";
export type EvidenceReference = { label: string; href: string };
export type TradingEvidence = { id: string; group: EvidenceGroup; title: string; state: EvidenceState; summary: string; limitation: string; verifiedDate: string | null; source: string | null; references: readonly EvidenceReference[] };
export const recordedVerificationSource = "99c0929188f8c3cb27bea916d4bddcfdec87bf4e";
const snapshot = (path: string) => `https://github.com/Melvinroy/Journal/blob/${recordedVerificationSource}/${path}`;
export const acceptanceMatrix: EvidenceReference = { label: "Recorded acceptance matrix", href: snapshot("docs/trading/IBKR_PAPER_ACCEPTANCE_QC.md") };
export const evidenceGroups: readonly { id: EvidenceGroup; title: string; description: string }[] = [
  { id: "planning", title: "Planning", description: "Saving, reviewing and separating planning from supported execution." },
  { id: "execution", title: "Execution", description: "Historical paper outcomes and the work still blocked." },
  { id: "protection", title: "Protection and recovery", description: "Stops, reviewed actions and uncertain outcomes." },
  { id: "accounting", title: "Accounting", description: "Keeping Positions and Journal consistent without inventing missing costs." },
];
const verified = { verifiedDate: "September 23, 2026 (Singapore)", source: recordedVerificationSource };
const unrecorded = { verifiedDate: null, source: null };
const ui: EvidenceReference = { label: "Ordinary-control browser tests", href: snapshot("tests/ui/paper-ui.spec.ts") };
const lifecycle: EvidenceReference = { label: "Lifecycle and fee tests", href: snapshot("services/eod/tests/test_paper_lifecycle.py") };
export const tradingEvidence: readonly TradingEvidence[] = [
  { id: "planner-review", group: "planning", title: "Save, review and confirm", state: "Deterministic", ...verified,
    summary: "Fixtures check saving without submission, one request for duplicate confirmation, and review invalidation after connection changes.", limitation: "Automated interface evidence. New Phase 3 journeys are not yet verified by this recorded baseline.", references: [ui, { label: "Approval and expiry tests", href: snapshot("services/eod/tests/test_paper_auth.py") }] },
  { id: "unsupported", group: "planning", title: "Unsupported execution choices", state: "Blocked", ...unrecorded,
    summary: "Shorts, auctions, overnight cases and four nonzero exit legs remain outside bounded paper acceptance.", limitation: "Planning calculations do not prove connected support. Current controls and server validation govern availability.", references: [acceptanceMatrix] },
  { id: "nvda-pilot", group: "execution", title: "NVDA pilot", state: "Broker-observed", ...unrecorded,
    summary: "One historical completed paper round trip.", limitation: "Historical summary through September 17, 2026. Exact observation date and execution source are not recorded here.", references: [acceptanceMatrix] },
  { id: "sofi-cancel", group: "execution", title: "SOFI cancellation", state: "Broker-observed", ...unrecorded,
    summary: "Cancelled without a fill. Adds zero completed round trips.", limitation: "Historical summary through September 17, 2026; not a filled-entry or protection test. Exact observation date and execution source are not recorded here.", references: [acceptanceMatrix] },
  { id: "broker-acceptance", group: "execution", title: "Remaining paper acceptance", state: "Blocked", ...unrecorded,
    summary: "The submission-policy block remains. The historical session is halted at 200; the requested overall ceiling is 30.", limitation: "Before any permitted execution, an authenticated, audited reduction must retain approval history and count both historical completions. This page cannot unlock or resume anything.", references: [acceptanceMatrix] },
  { id: "live-release", group: "execution", title: "Live release", state: "Blocked", ...unrecorded,
    summary: "Not approved for live trading. This evidence establishes no approved live release mode.", limitation: "Security, operator, account, fresh-data and broker gates need their own evidence, followed by a separately reviewed limited release.", references: [{ label: "Deferred operator gates", href: snapshot("docs/trading/OPERATOR_ACTIONS.md") }] },
  { id: "f-protection", group: "protection", title: "F protection failure and recovery", state: "Failed", ...unrecorded,
    summary: "One round trip completed after recovery, but cleanup cancelled protection. The protection scenario remains failed.", limitation: "Historical summary through September 17, 2026. Recovery does not erase failure; a future repaired-path pass must be recorded separately. Exact observation date and execution source are not recorded here.", references: [acceptanceMatrix] },
  { id: "position-actions", group: "protection", title: "Reviewed position actions", state: "Deterministic", ...verified,
    summary: "Mocked connection or submission-permission loss disables an open confirmation. Connected reconciliation retains its existing submission-lock exception.", limitation: "Fixture-only evidence; no real connection loss, recovery or order is demonstrated.", references: [ui, { label: "Step 2 evidence report", href: snapshot("output/trading-step-2-delivery.md") }] },
  { id: "cleanup-recovery", group: "protection", title: "Uncertain cleanup and replay", state: "Deterministic", ...verified,
    summary: "Synthetic cleanup repricing retains protection and order identities, preserves uncertainty and avoids retransmission during reconstruction.", limitation: "In-process reconstruction is not a real service restart or broker reconnect. F's historical failure is unchanged.", references: [lifecycle, { label: "Restore and isolation tests", href: snapshot("services/eod/tests/test_paper_readiness.py") }] },
  { id: "repaired-protection", group: "protection", title: "Repaired protection, concurrency and reconnect", state: "Unobserved", ...unrecorded,
    summary: "Fresh broker evidence for these repaired paths is not available.", limitation: "Connected execution is separately blocked. Fixtures, old orders and completed-trade counts cannot establish this broker pass.", references: [acceptanceMatrix] },
  { id: "accounting", group: "accounting", title: "Positions and Journal agreement", state: "Deterministic", ...verified,
    summary: "Mock late fees update one closed campaign in Positions and Journal, preserving quantities and one Journal row while updating net result and Execution R.", limitation: "Supplied summaries test display agreement. Fresh broker evidence must separately prove flat quantity, cleared orders and complete fees. Missing costs remain unknown.", references: [ui, lifecycle] },
];
