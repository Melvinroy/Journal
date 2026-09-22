# Step 2 independent execution-safety delivery

September 22, 2026. Scope: Plan/Positions/Journal, fixture-only execution evidence and one ordinary-control safety fix. This does not close Phase 1 operator gates or the policy-blocked broker acceptance stage. See [plan](../docs/trading-step-2-plan.md) and [operator actions](../docs/trading/OPERATOR_ACTIONS.md).

## Changes and evidence

- Position action review now shares current eligibility across launch, confirmation and handler. Loss of connection or submission permission prevents confirmation even if revision/connection ID is unchanged. Terminal state, missing amendment draft and changed amendment digest also reject the review; connected reconciliation retains its prior submission-lock exception. Server authorization is unchanged.
- Two new browser regressions failed against the old component specifically because Confirm remained enabled after the launch control disabled. This establishes the reproduced UI defect, not a server-side authorization bypass.
- Synthetic cleanup repricing times out before/after fake acceptance. Existing target ID/OCA/stop and three-share exposure survive; pending command and attempt count persist; repeated cleanup and stale echo never resend. In-process reconstruction starts disarmed; matching snapshot acknowledges only the accepted variant, idempotently. This is not a real process restart or broker reconnect. No backend production defect was demonstrated.
- Mock late fees update the existing closed Position/Journal campaign from unknown costs to $1 fees, $4 gross, $3 net and 1.50R at $2 initial risk; entered/exited/remaining stay 1/1/0 and the Journal row stays unique. This tests UI projection of supplied summaries, complemented by prior backend arithmetic/replay tests.

The historical two broker round trips remain unchanged; F's protection failure is not promoted to a pass. No cloud user, broker connection/order, submission unlock, target amendment, active-service change or deployment occurred. Approval of Phase 1 publishing does not authorize publishing this Phase 2 commit.

## Validation

Focused evidence: cleanup cases 2 passed; full lifecycle module 44 passed/4 optional-SDK skipped/2 known warnings, followed by 2 passed after explicit fixture shutdown cleanup was added. The two UI loss-of-eligibility cases failed against the original component and passed after repair. The late-fee case passed after correcting test navigation through the collapsed Recently closed section. One intermediate preview startup timed out; a subsequent focused run passed. No screenshot baseline changes.

Full `npm run verify` passed all five stages in **985.6 seconds**: Node 204 passed/2 skipped (12.8s); backend 278 passed/4 skipped/2 known warnings (478.4s); TypeScript passed (36.3s); browser 70 passed/3 skipped (419.5s); production build passed (37.5s). Repository Python 3.11.9 was used. Local logs/reports: `output/phase2-verify.log` and `output/phase2-verify/`. The unrelated `next-env.d.ts` bytes were restored exactly after the build (Git blob `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`).

Independent code review checked shared eligibility, the reconciliation exception, revision/connection/digest freshness and the handler guard. The parent reviewed durable pending-state protection and required `try/finally` shutdown of the reconstructed fixture service. Existing skips, dependency warnings, actual account/session tests, native monitor/DPI, storage-view mismatch and vendor remediation remain limitations.

### Direct rendered review

Fixture-only URL `http://127.0.0.1:3107/?paper=1`, exact integrated-source preview `f1a5830a+d.a8ce56c7`. The reviewer opened and viewed desktop-review, desktop-locked, mobile-recover, mobile-disconnected, mobile-recovery-focus, desktop-return and mobile-lock-confirm PNGs under `output/phase2-browser-evidence/`. The parent independently opened desktop-locked, mobile-locked and mobile-disconnected. The initial mobile-locked capture was above the action region; subsequent captures included the changed controls.

At 1280x900 -> 390x844 -> desktop, action text/alerts remained readable without action-region clipping or page-level horizontal overflow. Keyboard Enter launched the review; Tab reached cancellation/reconciliation; Escape closed the drawer and restored the position-row focus; reopening worked. Connection/submission-lock loss disabled confirmation and showed the reason. Connected/locked reconciliation generated exactly one mocked `recover` action; invalid confirmations generated none. No page errors or unhandled external requests were reported. All auth/service requests were intercepted; no real login or broker was used. The reviewer stopped the owned fixture server afterward.

This is Chromium viewport emulation and fixture interaction, not native monitor/DPI or real signed-in account evidence. No blocking visual issue was found in this bounded review. A post-commit identifier recheck is retained as local follow-up evidence; the source behavior covered here is unchanged by the final documentation updates.

## Phase 1 publication completed separately

User approved exact Phase 1 commit `214f7662854a9d7167682adec89c76393ba06879`, then the history-only updated commit `888301233da04c1218bbc62b3e2996406526c509`. Their Git trees are identical. [PR #9](https://github.com/Melvinroy/Journal/pull/9) merged after required Windows verification passed in 11m47s ([run](https://github.com/Melvinroy/Journal/actions/runs/35745707821)). Main merge commit is `f1a5830ad5e63a730a0ca67c8800f973398ea3c4`; Phase 2 fast-forwarded onto that source. Pages remained `disabled_manually`; latest recorded deployment remained the historical September 19 run. No deployment was triggered by this publication. Phase 2 changes were not included in PR #9 and remain a separately reviewed local delivery.
