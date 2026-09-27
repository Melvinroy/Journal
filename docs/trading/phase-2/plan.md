# Phase 2 — Complete and qualify all six remaining checklist items

**Target file:** `docs/trading/phase-2/plan.md`  
Reviewed plan supplied by the owner and saved on 26 September 2026. Updated after the owner reported successful one-time repair approval and this review independently confirmed that the original syntax error is gone. Qualification is still outstanding.

> **Current readiness — 26 September 2026, after approved repair:** A scoped Phase 2 implementation-and-qualification goal may now start. The owner reports that one-time repair approval was granted and used to remove only the six malformed trailing lines, with a backup retained. An independent focused TypeScript run confirms that the syntax error is gone; it now reports 3 generated-route mismatches and 24 application diagnostics. Repair those first, then complete the acceptance matrix below. Phase 2 remains 8/14 until its evidence passes. The consumed approval is not permission for additional protected actions or trading. This update supersedes the earlier no-start recommendation for Phase 2; it does not clear later-phase gates. See the [post-repair evidence](../../../output/phase-2-qualification/post-repair-readiness.md).

## 1. Goal and review findings

Bring **checklist Phase 2 from 8/14 to 14/14**, with evidence for each remaining item: **2.5, 2.7, 2.8, 2.10, 2.11 and 2.12**.

The [existing handoff](../PHASE_2_RECOVERY_HANDOFF.md) is insufficient for that outcome: it permits integration work to end with a design and leaves installed-app qualification unresolved. This plan replaces that completion contract.

Agreed boundaries:

- Qualify the **actual installed executable**, using a clearly labelled, isolated verification profile and artificial ledger records.
- Keep real IBKR identity, recording and execution acceptance explicitly open in checklist Phases 4 and 6.
- Amend items 2.5 and 2.10 transparently to reflect this boundary. Preserve their original intent and cross-reference the later broker acceptance gates.
- “14/14” will mean the agreed local application behavior is qualified. It will not mean broker integration or public release is complete.
- Review and fix defects affecting these six items; record unrelated cleanup separately.

**Original repair prerequisite addressed:** the owner reports the specific repair was approved and completed. Remaining TypeScript/build defects are implementation work, not evidence of another support-only block. Any new denied action must be handled separately through the supported approval process. The checklist’s “6 Codex, 0 external” counts task owners; it does not prove the absence of dependencies.

This review inspected source and independently ran a focused TypeScript check after the repair. It did not run a full qualification suite or inspect a newly installed candidate.

## 2. Execution sequence and implementation changes

### A. Establish the exact source and prerequisite

Work in `C:\Users\melvi\Projects\Journal-modular-trading`, on `codex/modular-trading-desktop`. Recheck the branch, HEAD, staged changes, unstaged changes and untracked files before editing. Preserve unrelated work.

Read the repository instructions, Phase 1 audit, verification guidance and applicable frontend-verification skill.

Record the completed one-time repair and its backup/approval evidence from the execution task. Do not repeat that repair or infer broader approval from it. Recheck the current source because the worktree is shared.

Restore the TypeScript baseline before broad verification:

- Reconcile generated route types through the framework's supported generation/build workflow under the permissions then in effect. Current development declarations list only `/`, while production declarations and the development validator include `/charts`, `/standalone` and `/verification`. Do not hand-edit validators, suppress their diagnostics or exclude types to manufacture a pass. If another protected action needs approval, request that specific action through the supported flow; do not label ordinary compiler failures as policy failures.
- Correct the cloud component contract to accept the dynamically loaded React components and legitimate null fallback, preserving each component's props and the type-only standalone/cloud boundary.
- Correct module-view literal typing and nullable connection/profile inputs with explicit guards, preserving unavailable/locked behavior.
- Give Journal rows an accurate shared projection or narrow their variants before reading optional simulation, history, amendment and fee fields. Preserve the distinction between artificial and recorded history; do not fabricate values or cast away errors.
- Preserve the non-null cloud-client guard inside the deferred read callback and explicitly narrow the validated Journal history-status union.
- Use focused type/parser/projection checks during repairs. No broad `any`, `@ts-ignore`, weakened strictness or automatic screenshot-baseline changes. Once the baseline passes, continue implementation and installed qualification; a passing compiler is not the end of the goal.

The separate paper-submission restriction is outside this phase.

### B. Repair the known test defects

The mask correction and recursive dynamic-import regression work below were already completed during preparation; an independent five-test rerun passed on 26 September. Inspect and retain those changes rather than recreating them.

- Replace the three invalid account-mask fixtures in the standalone browser tests with valid, clearly synthetic masks.
- Preserve negative coverage proving malformed masks are rejected.
- Extend the standalone import-boundary test to recursively traverse permitted dynamic imports, using the existing visited-file protection.
- Add a small regression fixture proving that an indirect dynamic import of a cloud-only module is detected.

Keep these changes focused; do not reorganize unrelated components or configuration files.

### C. Add an isolated installed-app verification profile

Introduce `--verification-profile <id>` in the same packaged executable used for qualification.

Its contract:

- Accept a canonical UUID and resolve storage beneath a dedicated verification directory in the current Windows user’s OS-resolved LocalAppData.
- Reject arbitrary paths, traversal, linked directories and attempts to select the normal profile.
- Use the existing profile, session, single-instance, account-scope and Journal storage implementations.
- Display **“Verification profile — artificial records — execution locked”** persistently.
- Include verification mode in sanitized diagnostics.
- Keep the paper execution router absent and submission disabled.
- Leave ordinary launches on their existing normal-profile path.

Provide a repository test harness that prepares artificial records through the existing storage interfaces. Any synthetic account-evidence adapter must be available only in verification mode and must never imply broker authentication.

Installed tests must use real local endpoints and persistence. Do not intercept those endpoints with browser fixtures to manufacture a pass. Do not add public fixture-writing endpoints.

Test normal-profile separation, invalid profile IDs, scope mismatch, relaunch and verification-profile ownership.

### D. Qualify standalone isolation and cloud uncertainty separately

For standalone:

- Build through the existing standalone build flags.
- Inspect the fresh exported assets and the final packaged assets.
- If cloud code remains, trace and fix the build/import boundary that emitted it.
- Retain complete asset validation; do not weaken scanners or delete inconvenient chunks after the build.
- Observe actual browser requests throughout the installed journey.

For cloud Journal:

- Use the existing cloud test harness with artificial accounts and controlled service responses.
- Exercise save/import success, rejection, connection loss, absent acknowledgment, partial acknowledgment and delayed responses.
- Exercise account A → B and A → B → A while requests remain pending.
- Fix reproduced defects in stale-response handling, busy states, draft retention or backup retention.
- Prevent automatic resubmission after an uncertain outcome. Reloading history must not itself submit another save/import.
- Use a session/request generation guard if account identity alone cannot reject stale responses.

No live cloud account or real trade data is required for this acceptance.

## 3. Acceptance matrix: every row must pass

| Item | Required proof before marking complete |
|---|---|
| **2.5 — Preferences and hidden Journal** | In the installed verification profile, change module/view choices, close and relaunch the executable, and confirm persistence. Hidden views remain inaccessible through navigation, stale links and browser history. While Journal is hidden, append artificial events through the existing recording/storage path; reveal Journal and confirm records survived. Exercise desktop and mobile layouts. Explicitly retain real broker recording acceptance in later phases. |
| **2.7 — Standalone isolation** | Source-boundary checks pass. The installed journey makes no cloud authentication, cloud trade or unrelated workspace requests. Confirm normal launch, navigation, reload and restart. Network evidence identifies the exact candidate and URL. |
| **2.8 — Packaged assets** | Scan the fresh export and packaged payload, including unreferenced text assets. Confirm forbidden cloud markers/configuration are absent and all required assets exist. Record archive/executable hashes and successful asset diagnostics. Keep this distinct from 2.7’s runtime proof. |
| **2.10 — Installed local Journal** | The installed app reads the isolated ledger through its real local service. Verify empty history, open and closed records, fees/late fees, reload/restart persistence, unavailable or malformed history, and changed account scope. Compare displayed quantities and results against known fixture expectations. Never substitute sample history for unavailable recorded history. |
| **2.11 — Current UI** | Inspect the affected Connect, Trading, Positions and Journal screens at the exact current preview identity. Cover desktop/mobile, wide → narrow → wide resizing, keyboard navigation, dialogs, validation, loading/error/empty states, overflow and inaccessible controls. Include an independent review pass for additional defects. |
| **2.12 — Cloud save/import** | Successful acknowledgment behaves correctly. Rejection, lost response, missing acknowledgment and partial import preserve recoverable local information and show truthful status. Delayed responses cannot alter another account’s state or a later session. History retry does not duplicate writes. Verify persisted backup behavior across reload. |

**Completion rule:** no row may remain “implemented but not rebuilt,” “fixture only,” “browser check later,” or “installed behavior unverified.”

## 4. Verification, checklist and delivery

Use focused checks during implementation. The original repair has completed; once the new TypeScript baseline and implementation changes are ready:

1. Run `npm run verify` through all five documented stages, using the repository’s EOD environment and version checks.
2. Fix new failures with focused checks before repeating the broad suite.
3. Build and install the restricted candidate. Record source identity, package hashes and sanitized diagnostics.
4. Perform the installed acceptance matrix and direct browser review.
5. Separate automated results, direct observations, historical evidence and untested cases. Viewport emulation is not physical monitor/DPI evidence.

Never update screenshot baselines automatically.

Update the checklist and its audit data:

- Preserve existing task IDs and the tick/cross/exclamation presentation.
- Keep **ownership** separate from **blocking dependencies**.
- Show the unresolved qualification dependency prominently until resolved.
- Retain per-item evidence after an item becomes complete; do not replace it with a generic “source implemented” label.
- Record the agreed scope amendment for 2.5/2.10 and explicit links to the retained broker gates.
- Check that counts, symbols, detail text and evidence agree.

Store qualification reports under `output/phase-2-qualification/`, outside the preview source digest. Final evidence must match the final reviewed source and installed artifact. If a commit or subsequent source change changes the identity, refresh the required evidence rather than carrying forward an old identifier.

Prepare a scoped local commit without including unrelated work. Report any remaining dirty changes and their relationship to the tested candidate. Do not push, merge or deploy without the required separate approvals. Prepare the updated progress page locally; publishing it remains subject to the repository’s deployment approval rule.

The return report must contain:

- The six acceptance results and resulting Phase 2 count.
- Exact source identity, installed artifact hashes and inspected URLs.
- Tests and direct observations, with material limitations.
- Changed files and scoped commit SHA.
- Remaining later-phase gates.
- A concise defect/redundancy review limited to this phase.

## 5. Prompt for the separate GPT SOL task

Copy this plan into the new task together with the following prompt:

> Save the accompanying reviewed plan as `docs/trading/phase-2/plan.md` in `C:\Users\melvi\Projects\Journal-modular-trading`.
>
> Execute that plan for **checklist Phase 2**, not roadmap E2 or the earlier recovery preparation phase.
>
> First verify the source state and read the post-repair evidence. The one-time generated-file repair was approved and completed; do not stop on the superseded support-wait recommendation or repeat that repair. Fix the remaining generated-route inconsistencies and application type errors with focused checks. Handle any new protected action separately through the supported approval mechanism.
>
> Create a goal to complete and qualify items **2.5, 2.7, 2.8, 2.10, 2.11 and 2.12**, bringing Phase 2 to **14/14** under the agreed acceptance criteria. This authorizes the scoped implementation and qualification work, not reuse of the consumed one-time approval or a guarantee that all checks already pass.
>
> Implement, test, rebuild, install and directly inspect the candidate. Use the same executable with the isolated, labelled verification profile. Keep real IBKR acceptance explicitly open in Phases 4 and 6.
>
> Do not stop at source changes or a test pass while installed proof remains missing. Do not mark the goal complete unless all six acceptance rows pass and the checklist accurately reflects their evidence. Preserve unrelated work, follow goal-tool status rules, and return the complete qualification report. Do not push, merge or deploy without the required approvals.

