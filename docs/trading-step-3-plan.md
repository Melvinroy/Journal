# Phase 3 — Acceptance through the ordinary trading controls

Prepared September 23, 2026. Package A is independently complete on `codex/phase3-trading-acceptance`; focused checks, independent direct inspection and full verification passed. Package B remains blocked.

## Starting point

Phase 1's independent changes are merged in PR #9. Its operational gates remain open in [Operator actions](trading/OPERATOR_ACTIONS.md); merging code did not complete those gates.

Phase 2's original `2ce19c0a9b92c2b56bd5ed0b07db62f3f86e1548` encountered two CI failures. The diagnostic follow-up `99c0929188f8c3cb27bea916d4bddcfdec87bf4e` passed required Windows verification in [run 35771433023](https://github.com/Melvinroy/Journal/actions/runs/35771433023): 207 Node, 278 backend and 70 browser tests passed, with all five stages completing in 782.1 seconds (total CI 14m56s). [PR #10](https://github.com/Melvinroy/Journal/pull/10) merged as `edca6055961dd620e404378f74f801b1be9bd875`, package A's starting source. Existing Phase 2 results and their limitations are in the [Phase 2 report](../output/trading-step-2-delivery.md); they are not a pass for new Phase 3 edits. GitHub Pages remains disabled.

## Goal

Make the evidence for Plan, Positions and Journal easy to review, and establish exactly which ordinary user journeys are proven. Reuse the [acceptance matrix](trading/IBKR_PAPER_ACCEPTANCE_QC.md); do not create a second trading interface or duplicate scenario ledger.

## A. Independent preparation — approved bounded implementation package

1. Inspect the existing Verification page, server capabilities, normal controls and tests. Map each required scenario to its existing evidence, source version and remaining gap before adding anything.
2. Cover save versus submit, invalid input, duplicate clicks, stale reviews, account/source changes, supported entries and exits, amendments, cancellation, bounded closure, concurrency, recovery and Position/Journal accounting. Mark unsupported controls explicitly. Reuse passing tests; add only concrete missing cases using isolated fixtures and mocked services.
3. Check that the existing Verification link/page presents broker-observed, deterministic, blocked, failed and unobserved results separately. Correct demonstrated misleading labels or missing evidence references, without exposing private records or providing alternate execution controls.
4. Verify offline-history reload, unknown exposure, missing fees, stale protection labels, keyboard/dialog behavior, mobile layout and draft preservation where existing evidence does not already establish them. Never represent mocked authentication or service reconstruction as real account/restart evidence.
5. Obtain independent review. For executable/test changes run focused regressions and full `npm run verify`; for rendered changes use direct frontend verification of the exact source and URL. Preserve screenshot baselines. Documentation-only changes receive link, consistency and scoped-diff checks.

**Deliverable:** updated existing matrix and a scoped delivery report/local commit when warranted. This package can finish independently; it cannot finish broker acceptance. No redundant test expansion solely to increase counts.

### Eleven ordinary journeys and selected gaps

The [September 23 overlay](trading/IBKR_PAPER_ACCEPTANCE_QC.md#september-23-phase-3-independent-overlay--independent-preparation-complete) maps eleven stable journeys to actual existing test names. It is a coverage index, not eleven broker passes. The package adds only the following missing fixture evidence:

- Review expiry and ordinary saved-plan edit invalidation: dismiss the modal, edit/resave through normal controls, and require fresh review before approval. Draft values remain available; this is not an edit-while-modal-open scenario.
- Nonempty recorded history across a page reload while connection fails: retain last-known values and timestamps, never imply current protection or fabricate an empty/zero account.
- Two-campaign UI action attribution: cancellation and bounded closure target only the selected fixture campaign; preserve the other campaign's row/state and use no real broker.
- Verification navigation/content: the ordinary planner link opens evidence only, separates deterministic/broker/failed/blocked/unobserved classifications, preserves the historical count and limitations, and offers no second order form.

Reuse existing runner/allocation/session/amendment/accounting tests rather than claiming these new UI fixtures independently prove broker behavior. Keep full test names and observed source identifiers in the matrix/report. No actual cloud identity, service restart or account/environment switch is added here.

## B. Connected paper acceptance — blocked, not part of A

Prerequisites must be evidenced before execution: legitimate resolution of the September 17 submission-policy block, applicable operator/security gates, verified paper account and ownership, valid authentication, fresh funds/quotes, eligible session, and an authenticated audited ceiling of 30 retaining historical approval history. Do not resume the halted 200-target session or modify its database directly. The two historical completions must count toward the overall ceiling, including the pilot outside that session.

After those gates and a separately permitted execution package, use only ordinary Plan/Position/Journal controls and the shared authenticated service. Prioritize repaired protection and safe closure before expanding coverage. Retain F's historical protection failure even if a new repaired-path scenario passes; SOFI cancellation without fills does not count.

Keep checkpoints 1, 10, 20 and 30 and limits of 3 shares per campaign, 2 concurrent campaigns, $500 entry notional, $10 campaign risk and $20 aggregate risk; exclude PL and AMD. Unsupported shorts, auctions, overnight cases and four-leg allocations stay blocked. Never retry uncertain submissions, induce unsafe failures or touch unrelated positions/orders.

Stop on protection failure, stale data, conflicting events or missing accounting. Final reconciliation separately proves owned positions flat, owned orders cleared and accounting complete, with submission locks restored. Retain raw evidence privately and publish sanitized references only. Thirty trades do not prove every supported combination or live readiness.

## Completion and next decision

- Independent preparation passes only when actual gaps are resolved or explicitly classified, required verification passes and the evidence maps to the reviewed source.
- Full Phase 3 remains blocked until connected acceptance and its prerequisites pass.
- Keep deferred user actions in the existing operator checklist; do not request them during package A.
- No broker connection, service restart/cutover, cloud fixture, target amendment, submission unlock, paid change, push, merge or deployment is authorized by this plan.
- Phase 4 is a separate live-release assessment for a named narrow feature subset and exact source. It requires operational/security closure and broker evidence; live configuration and any supervised pilot require explicit later authorization.

## Checklist

- [x] Publish the approved Phase 2 commit and open PR #10.
- [x] Required Windows verification on PR #10 passes.
- [x] Separate Phase 2 merge approval and protected merge (`edca6055961dd620e404378f74f801b1be9bd875`).
- [x] Review/authorize bounded Phase 3 package A against the selected source.
- [x] Execute selected fixture gaps and Verification evidence improvements; seven focused new browser cases passed.
- [x] Independent review and exact-source frontend observations at `edca6055+d.7bf7cdbb` pass.
- [x] Full `npm run verify` passes all five stages.
- [x] Record independent acceptance results and remaining gates.
- [ ] Resolve prerequisites before any future package B; currently blocked.

## Package A evidence checkpoint — September 23

Seven focused browser cases cover review deadline, ordinary dismiss/edit/resave, expiry during pending approval, nonempty offline reload, two-campaign action attribution and two Verification-link/content journeys. The implementation agent reproduced the original deadline defect after flushing pending draft timers: advancing a 1,000ms review by 1,001ms, before the five-second status poll, left confirmation enabled. An initial fixture attempt had hidden that defect through an incidental rerender; the tightened test failed before repair and passed after it. This is reported negative-test evidence, distinct from the independent direct observation below.

Independent direct Chromium inspection used `http://127.0.0.1:3107/verification/` and `http://127.0.0.1:3107/?paper=1`, preview **`edca6055+d.7bf7cdbb`**, with 1280×900 → 390×844 → wide transitions and nine screenshots actually opened. An actual four-second fixture deadline produced the expiry message and disabled confirmation. Escape restored Review order focus and retained the draft. Verification opened through the ordinary link without losing the original draft. Authentication and services remained mocked; no actual token-expiry, native monitor/DPI or broker result is claimed. Full verification passed.

### Full verification result

`npm run verify` exited 0 after **823.4 seconds**: **207 Node passed / 2 skipped**, **278 backend passed / 4 skipped / 2 known deprecation warnings**, **77 browser passed / 3 skipped**, TypeScript and production build passed. Log: `output/phase3-verify.log`; structured reports: `output/phase3-verify/`. Skips remain unverified cases, not passes. The direct marker above records the pre-commit inspected source; it is not a claimed final commit identifier. Package A's independent preparation is complete; package B and all operator/security/broker gates remain blocked or deferred as documented.
