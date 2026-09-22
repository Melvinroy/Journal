# Independent trading-readiness completion evidence

September 23, 2026 (Singapore). Independent package complete: focused checks, full verification and independent review passed. Branch: `codex/trading-independent-completion`, baseline `b27ff02e87a8a698d3ff1137c75c8424fb1c3959`.

## Publishing baseline

PR #11 remains open at the baseline. Required Windows verification [35779922260](https://github.com/Melvinroy/Journal/actions/runs/35779922260) passed: all five stages in 669.7 seconds, 207 Node / 278 backend / 77 browser passes; respective skips 2 / 4 / 3 and two backend deprecation warnings. These are prior-source CI results, not verification of this package. Main and deployment remain unchanged.

## Independent work

- Boundary tests for malformed review deadline and changed eligibility while approval is pending.
- Audit target-reduction history, external pilot count and repeated amendment behavior using an isolated ledger.
- Reconcile dependency and agent/desktop storage evidence without changing real configuration.
- Extend the existing acceptance matrix into ordered, gated execution instructions and consolidate user/external requirements under Phase 5.
- Record a narrow future live candidate without implementing live mode.

## Verification

Focused browser checks: five new cases passed in 38.9 seconds. After independent review tightened logout synchronization, all four held-approval cases passed again in 38.5 seconds. Two focused target-amendment backend tests passed in 2.92 seconds, with 24 deselected and two known warnings. Full `npm run verify` exited 0: all five stages passed in **1031.2 seconds**. Results: **207 Node passed / 2 skipped**, **279 backend passed / 4 skipped / 2 known deprecation warnings**, **82 browser passed / 3 skipped**, TypeScript and production build passed. Evidence: `output/trading-completion-verify.log` and `output/trading-completion-verify/`. Executable source remained unchanged afterward; final documentation and commit identity are separate from the pre-commit browser marker. No screenshot baselines changed.

### Demonstrated defect and repair

The initial logout-during-approval fixture failed before repair: the review component unmounted, but the old callback sent one mocked submit request after approval resolved. A one-line unmount cleanup now invalidates its generation; after repair no submission follows. Other approval, command identity and uncertainty behavior remains unchanged. Malformed-date and account/connection/permission boundary cases passed without additional production changes.

Independent review requested replacement of a fixed 100ms test delay. The revised test observes transport completion and actual client JSON consumption, then synchronizes browser processing before asserting zero submissions. This addresses a possible false pass; no extra retries or weaker assertions were introduced.

### Direct frontend evidence

September 23 independent Chromium inspection matched `b27ff02e+d.135063aa` at `http://127.0.0.1:3107/?paper=1`. The reviewer actually opened five screenshots under `output/trading-completion-browser/`; parent additionally viewed the signed-out mobile image. Wide/mobile views showed disabled malformed-date review with a clear expiry instruction, successful Escape/focus return, pending approval, and the signed-out state after response release. Malformed review: zero approval/submit; session-ending fixture: one mocked approval, zero submit and no restored stale dialog. No page exceptions. An earlier run whose marker changed during inspection was discarded.

The logout fixture invokes the existing Sign out DOM button programmatically behind the busy modal; it models a session ending and is not ordinary busy-modal interaction or real token-expiry evidence. Scanner/chart routes were deliberately mocked 503; no actual cloud identity or broker was contacted. Viewport emulation is not physical monitor/DPI proof. Preview was stopped to free the fixed test port; a final user preview will be restored after verification.

### Target ceiling and preparation

The new synthetic ledger regression includes an outside-session completed pilot, a session-owned campaign and another binding that must not count. Reducing 200 to 30 produces overall completed2/baseline1; reducing again to29 does not double-count. It rejects below completed count and increases, preserves original raw events/campaigns and avoids additional fake broker writes on replay. It is not a real target amendment.

The existing acceptance matrix now specifies prerequisites, ordinary controls, broker acknowledgements, retained evidence and stopping conditions. Its execution order explicitly proves repaired protection and bounded closure before expanding cases. Phase5 consolidates existing operator procedures, with a narrow Phase4 live candidate and honest pause/recovery limitations. No live configuration was added.

### Independent review and audits

A separate reviewer found no additional substantive defect in the final unmount safeguard, strengthened tests, target-counting regression or acceptance instructions. Current dependency findings are in [security evidence](trading-completion-security.md): audited repository packages have no reported vulnerabilities; the separate accessible operator SDK still pins vulnerable protobuf. Editable packages and the official SDK are skipped by the registry audit, not certified. No supported replacement was established and no dependency was installed or overridden.

Storage visibility remains unresolved: source defaults and agent-visible directories do not establish what the desktop or active service can access. No directory, ACL, active configuration or private ledger was changed. Password protection remains deferred under the no-upgrade choice; the intermittent clock cause remains unresolved.

## Completion classification

Independent completion is not full Phase 3 completion. Broker acceptance remains blocked by the existing independent policy rejection and operational/security prerequisites. Historical count stays 2/30, F protection remains failed, SOFI adds zero, persisted target200 remains halted. Exact-commit approval is required before publishing this package.

## Final four-way handoff

| Classification | Outcome |
| --- | --- |
| Completed independently | PR #11 CI verified; unmount defect repaired; five boundary cases and outside-session pilot regression; full verification and independent review; ordered broker run cards, narrow live-candidate mapping and Phase5 handoff. |
| Needs user | Paired desktop storage diagnostics, administrator denial proof and cleanup, separately approved cutover/rollback, real disposable-login expiry/cleanup, suitable account transition, exact-commit publishing and separate release approvals. No action requested during this package. |
| Vendor-policy blocked | Official SDK's vulnerable protobuf pin has no established supported repair; existing execution-policy block remains. No workaround attempted. |
| Unresolved / deferred | Storage visibility and active-runtime path provenance; intermittent validator-clock cause; password protection deferred under no-upgrade choice; fresh broker protection/reconnect/accounting and live readiness. |

Only the scoped application/test/document changes belong to this local delivery. The pre-existing next-env.d.ts bytes were restored after the build (Git content hash a419cbe4e3a5e8d4b481b851dbf4ac767de069e6); unrelated generated/private artifacts remain excluded. No push, merge or deployment was performed. Final user-preview identity and URL are reported in the handoff after the local commit, without rewriting historical inspection identities.
