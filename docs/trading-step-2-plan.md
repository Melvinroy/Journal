# Step 2 — execution safety, recovery and accounting

Prepared September 22, 2026. Scope: ordinary Trading Plan/Positions/Journal controls, shared paper service, synthetic fixtures only. Phase 1's independent work is complete; its external gates remain open in [operator actions](trading/OPERATOR_ACTIONS.md). This package does not authorize real broker acceptance or live trading.

## Baseline and delivery

PR #9 published the approved Phase 1 source after required Windows verification passed. Its history-only update `888301233da04c1218bbc62b3e2996406526c509` has the exact same Git tree as verified `214f7662854a9d7167682adec89c76393ba06879`. Main merge commit: `f1a5830ad5e63a730a0ca67c8800f973398ea3c4`. Phase 2's branch fast-forwarded to that merge without overwriting its in-progress changes or unrelated files. Branch: `codex/phase2-execution-safety`. Phase 2's local commit requires separate exact-SHA publishing approval. Pages remained disabled; no deployment was performed.

## Bounded work packages

### A. Existing position-action reviews must obey current availability

Source inspection found an already-open confirmation only checked revision/connection ID. It could remain enabled when connection or submission permission changed without those identities changing. Backend authorization still applies, but the ordinary control must also fail safely.

- [x] Reproduce disconnect and submission-lock transitions in mocked browser tests with an open cancel-entry review.
- [x] Share eligibility checks across launching, confirming and handling the action. Keep the existing read-only reconciliation exception to submission locking, require connectivity, reject terminal campaigns and missing amendment drafts, and retain revision/connection freshness checks.
- [x] Show a clear reason when an open review is no longer usable; allow cancellation. Do not add trading controls or bypass backend verification.
- [x] Prove no action request on an invalid confirmation and preserve normal eligible confirmation behavior.

### B. Uncertain cleanup repricing retains protection and durable uncertainty

Existing tests cover F's repaired in-place target repricing, ordinary pending acknowledgments, cleanup bounds and restored uncertain entry commands. Add the missing combination for modification of an existing target.

- [x] Parameterize transport timeout before and after fake acceptance of the reprice.
- [x] Assert target identity/OCA association and protective stop remain intact; persist pending command and attempt count before transmission.
- [x] Assert repeated automation cannot retransmit while uncertain; restored service starts disarmed.
- [x] Stale pre-amendment echo must not confirm the new modification. Exact matching acknowledgment clears pending once; duplicate echoes cause no additional write.
- [x] Fix production code only if these checks demonstrate a defect. No real restart, broker race or order is induced.

### C. Shared accounting through the normal interface

No calculation defect was established in the independent review. Position and Journal already consume the same summary; synthetic restore tests cover replay and late fees.

- [x] Add a focused mocked status transition from missing fees to known late fees through the existing Position/Journal interface. Check quantities, net result and Execution R consistently, with no duplicate Journal row. Retain missing-as-unknown semantics.
- [x] Reuse existing account-isolation, stale-review, duplicate-command, bounded clock-retry and restore tests rather than duplicate them.

## Verification and completion

- [x] Independent review of backend uncertainty/protection and UI/accounting changes.
- [x] Focused regressions, full `npm run verify` and direct frontend verification at the exact current-source preview identifier. Include keyboard, invalid confirmation and wide/narrow/wide observations proportionate to the changed flow; preserve baselines.
- [x] Update the existing acceptance matrix with deterministic results; never promote them to broker-observed results. Keep F's historical failure separate from repaired synthetic evidence.
- [x] Deliver a scoped local commit and exact results, limitations and deferred prerequisites. No automatic Phase 2 push/merge/deployment.

No new public API, service configuration, live mode, cloud fixture, alert channel or alternate form is planned. Never restart/repoint the active service, connect to the broker, unlock submissions, amend the historical target or retry rejected cleanup. Preserve unrelated files and private records.

The later broker gate remains the [existing normal-control acceptance matrix](trading/IBKR_PAPER_ACCEPTANCE_QC.md), subject to legitimate resolution of the independent policy block and prerequisites. It retains the audited 30 ceiling, two historical completions, F failed protection, SOFI no-fill cancellation and all existing limits. This independent package may complete while operational Phase 1 and broker-backed Phase 2 remain incomplete.

## Independent package result

Completed the bounded packages above. Full verification passed in 985.6 seconds: 204 Node/2 skipped, 278 backend/4 skipped/2 known warnings, TypeScript, 70 browser/3 skipped and production build. Independent Chromium fixture inspection covered the changed flow at desktop/mobile/desktop, keyboard and invalid confirmations. See [delivery evidence](../output/trading-step-2-delivery.md) for exact source/URL and limitations. No real broker acceptance was performed; the live decision remains no-go.
