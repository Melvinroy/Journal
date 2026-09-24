# Complete the remaining independent trading-readiness work

Approved package, September 23, 2026. Implementation status: independent package complete; Phase 3B and live readiness remain blocked.

## Goal and boundaries

Finish the checks available without operator participation and consolidate the remaining requirements under **Phase 5 — User validation and external gates**. That label does not remove prerequisites for paper acceptance or live release. Reuse the existing acceptance matrix and operator checklist.

Baseline: `b27ff02e87a8a698d3ff1137c75c8424fb1c3959`. PR #11 remains open; Windows verification [35779922260](https://github.com/Melvinroy/Journal/actions/runs/35779922260) passed on that exact head. Work on `codex/trading-independent-completion`; leave main unchanged. No push, merge, deployment, active-service change, cloud fixture, target amendment, broker connection or submission unlock is included.

## Independent work packages

### A. Publishing evidence

Confirm the required Windows check against the exact PR head. Investigate failures before repairs; do not weaken assertions, add blanket retries or change screenshot baselines. Any replacement commit requires separate exact-SHA publishing approval. Keep PR #11 open even after passing checks.

### B. Concrete local review gaps

Use ordinary planner controls and intercepted services to verify malformed review deadlines fail closed with no approval/submission. Hold an approval response, then separately change logout, account, connection and submission permission; releasing the old response must not submit or restore stale usable review. Reuse existing expiry, duplicates, accounting and recovery coverage. Change application code only for a demonstrated defect; no alternate API or interface.

### C. Security and operational evidence

Inspect non-secret storage path selection and available runtime metadata read-only. Compare agent observations with the operator's missing-folder evidence; do not create directories, change permissions, move records or infer a shared filesystem from matching names. Keep visibility unresolved unless supported evidence resolves it.

Recheck repository audits separately from accessible operator SDK metadata. Use official vendor information for supported compatibility. Validate a supported fix in isolation if available, without updating an active runtime or forcing dependencies. Preserve no-paid-upgrade and unresolved intermittent-clock decisions. Report environment/version/date and limits for every finding.

### D. Broker-acceptance preparation

Extend the existing matrix with ordinary controls, prerequisites, expected broker acknowledgement, evidence and stop conditions. Sequence: prerequisites and audited total ceiling; repaired protection and bounded closure; supported entries/allocations/runners/breakeven/amendments; cancellation/concurrency/reconnect; accounting and final reconciliation.

Review target-reduction coverage for preserved approval history, rejected increases and the pilot outside the halted session. Add only missing isolated cases. Never invoke the actual endpoint or edit the persisted session. Preserve historical 2/30 count, F failed protection, SOFI zero fills and halted 200 target. Retain three shares, two concurrent campaigns, $500 entry notional, $10 campaign/$20 total risk and PL/AMD exclusions. No uncertain retry. Final flat positions, cleared orders, complete accounting and restored submission locks are separate requirements.

### E. Later live-release decision

Document the candidate subset: USD whole shares, long limit, regular hours, DAY, broker-held stop, one target and verified breakeven. Map release conditions to evidence or blockers. Describe existing pause/disconnect/uncertainty behavior accurately. Add no live configuration and claim no live readiness.

## Phase 5 handoff

The [operator checklist](trading/OPERATOR_ACTIONS.md) contains procedures, prerequisites, expected evidence and cleanup for desktop storage visibility, Windows denial proof, cutover/rollback, actual token expiry, authorized account transition, vendor/password gates, policy-block resolution and exact-commit publication/live approvals. Do not request those actions during this package or retry rejected operations. Password protection remains deferred under the no-upgrade decision.

## Verification and delivery

Independent sub-agent review covers evidence, execution safeguards and acceptance instructions. Run focused checks, then full `npm run verify` for executable/test changes. Inspect exact-source rendered changes where applicable, preserve baselines and unrelated/private files, and deliver a scoped local commit plus evidence report. Restore the safe user preview after tests, reporting exact URL/identity.

Completion means independent work and usable handoff, not completed Phase 3B or live readiness.

## Follow-up — PR #12 verification and operational gates (September 23)

PR #12 published head `01f56de287b1bcc1cfea74326fc4e696a4702e48` failed Windows run `35809523185`: 81 browser passes, three skips and one failure. The earlier local pass remains historical evidence, not a passing remote gate. PR #11 remains open with a successful required check at `b27ff02e87a8a698d3ff1137c75c8424fb1c3959`; PR #12 is stacked on that branch. Main remains unchanged.

Approved follow-up: inspect the failed trace, correct request attribution between Verification and its destination workspace, retain strict intercepted-service isolation and a negative control, run focused and full verification, obtain independent review, and deliver a local commit. Any replacement push needs approval of that exact SHA; merges and deployment remain separately gated.

Operational order remains: paired desktop/agent storage diagnostics; distinct-user denial proof; separately approved cutover/rollback; authorized real login expiry/account transitions; external security decisions. Do not manufacture missing evidence with repeated fixture tests. Stop when only unavailable prerequisites or external decisions remain. Phase 1 is incomplete, Phase 2 implementation is merged but broker evidence remains open, Phase 3A is implemented but publication gates remain, Phase 3B is blocked, and Phase 4 live release is not enabled. Phase 5 is the consolidated operator/external checklist, not a waiver.

No API, database, application interface, broker connection, service cutover or permission change is needed for the demonstrated test defect. Update the delivery report with separate local and remote outcomes; leave earlier results intact.

Follow-up outcome: trace timing confirmed destination-workspace attribution; the shared fixture now permits only exact intercepted GET reads from that workspace, with a negative Verification request control. Three focused tests passed; full verification passed all five stages (207 Node, 279 backend, 83 browser passes; skips 2/4/3, two backend warnings) in 774.3 seconds. Independent review completed. This closes the local repair package only; replacement publishing/CI and operational prerequisites remain open.

## Historical independent-package outcome checklist (before PR #12 repair)

- [x] PR #11 Windows check passed at exact baseline; PR remains open.
- [x] Five new review-boundary cases pass; repair only proven defects.
- [x] Security/storage evidence reconciled with unresolved gates retained.
- [x] Target-ceiling coverage inspected and concrete gaps resolved.
- [x] Acceptance sequence and Phase 5 operator handoff reviewed.
- [x] Full verification and independent review complete; scoped local delivery contains this checklist.
