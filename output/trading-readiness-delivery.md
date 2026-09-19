# Trading readiness implementation — September 19, 2026

## Decision

**No-go for live trading.** These changes prepare the paper workflow and improve evidence retention. They do not finish broker acceptance or create an approved live execution mode.

Scope is Plan & Position and Journal. No broker orders, live enablement, push, merge or deployment were performed. Historical evidence remains two completed round trips; F remains a failed protection scenario despite its recovered completion. SOFI cancellation is not a round trip.

## Delivered behavior

- Load authenticated recorded campaigns before attempting a TWS connection. Retain complete private snapshots with user/account/paper scope and stale/As-of presentation. Failed refreshes do not replace the last complete view. Confirmed owned closure removes its retained position; unrelated absent exposure stays unresolved.
- Consolidate Save plan, Save exits and Review order in the normal planner. Keep the exact order dialog and Paper identity. Remove embedded execution/testing panels; add a read-only Verification link.
- Use broker USD equity for sizing and fresh server-side equity/available-funds validation for execution preparation. Preserve legacy planning equity and offer explicit planner-data import.
- Scope browser drafts, presets, positions and reviews; clear prior-scope state immediately. Legacy unscoped data is retained without automatic ownership assignment.
- Expose the server capability policy; retain existing bounded paper limits and exclusions. Reject non-paper execution configuration.
- Persist immutable reviewed execution-ticket content and digest. Reject different content under the same revision. This is execution-plan content; a complete archival representation of every UI planning field is still a follow-up.
- Provide operational pause without cancelling broker protection. Add audited, authenticated target reduction and block obsolete targets above 30. The user's historical session remains halted and unamended; no execution was enabled.
- Add security headers and versioned database initialization/consistent backups.

## Security and durability evidence

- Production JavaScript dependency audit: zero reported known vulnerabilities at audit time.
- Python pip, setuptools and pytest updated in the isolated environment. Dependency consistency check passes. Final audit retains one unique protobuf advisory (reported twice): PYSEC-2026-1805. Official IBKR API 10.50.2 pins the affected 5.29.5; upgrading alone breaks its dependency contract. The incompatible trial upgrade was reverted. Official SDK code itself is not covered by the package registry audit.
- Deployed Supabase ownership policies checked with a rolled-back fixture: owner can see one record; another user sees, updates and deletes zero; cross-user insert is rejected. No records or deployed policies were retained/changed by that check.
- Supabase advisor: leaked-password protection disabled. End-to-end revoked-session behavior remains unverified.
- Windows private-file ACLs inspected; platform sandbox grants remain. Production owner-only installation/backup access is not signed off.
- Tracked-file secret-pattern scan found no matching exposed private keys or secret assignments, and no tracked private configuration/database files. This is a limited heuristic scan, not a comprehensive secret audit.
- A readonly backup of the real private database and separate restored copy both passed integrity checks and preserved 22 objects, 27 commands and 26,387 events. This does not certify an active-service disaster recovery drill.

## Automated verification

Final source: `611b72e5fdbd8797d62d2dd24da18ae4d3020193`; visible, computed and served preview identifier `611b72e5`. The full `npm run verify` passed all five stages in 1264.5 seconds: 201 Node tests passed (2 skipped), 251 backend tests passed (2 deprecation warnings), TypeScript passed, 64 browser tests passed (3 skipped), and the production build passed. Earlier focused checks: 75 backend checks passed; 9 latest readiness tests passed; 7 projection/parity checks passed. The first full run exposed three expected-label regressions; those assertions and the demo equity label were corrected. No screenshot baselines were updated.

## Direct browser evidence

Directly inspected the final locked preview at `http://127.0.0.1:8766/` in the in-app browser at 1600 and 390 pixels, returning to 1600 on the same page. Viewed screenshots of the planner, corrected closed-position detail and Journal. Verified F position-to-Journal navigation, consistent quantity/fees/net result, Escape focus return, unchanged draft entry and no page overflow. Captured console warning/error list was empty. The earlier Verification-link and filtered-empty checks are detailed below. The normal viewport was restored. No broker orders or review submissions were sent.

## Remaining iterations / release gates

1. Finish complete saved-plan archival and controlled import of legacy Journal reviews/position associations; add a broader account-switch matrix. Preserved legacy keys are not deleted or silently reassigned.
2. Resolve the official SDK/protobuf compatibility advisory; enable and verify deployed password protection; finish revocation, operational alerting, production file/backup access and threat review.
3. Under a legitimately permitted execution environment, amend the historical session to 30 with the authenticated endpoint. Verify repaired protection, cancellation, closure, concurrency, reconnect and normal-control acceptance. Do not bypass the current execution rejection.
4. Demonstrate accounting-complete, owned-flat and owned-orders-cleared separately with fresh broker evidence. Current work does not claim fresh final broker reconciliation or 30 completions.
5. Evaluate the narrow future live subset only after those gates pass: USD whole-share long limit, regular hours, DAY, broker-held stop, one target and verified breakeven. Implement/review a separate live configuration and supervised pilot; this change deliberately keeps live unavailable.

Automatic approval review previously rejected enabling paper submissions with “blocked by policy.” The action was not retried or routed around. No amount of automated coverage substitutes for the missing permitted broker evidence.

## Delivery source and interrupted verification

Local commit: `f94991f3e1087abaa513ae5f1207121087748c6a`, branch `codex/paper-pilot-recovery`, isolated UI-refinement checkout. The user requested a pause during the prior verification run. That run passed Node (201, two skipped), backend (251, two warnings) and TypeScript, then was deliberately stopped at browser startup. It is not an all-stages pass. A new full run was started after the user resumed work.

The final exploratory correction makes stale/failed reconciliation render protection as unconfirmed even when the TWS socket remains connected. This has a browser regression in the resumed suite.

## Direct observations during final review

The committed precursor `f94991f3` at `http://127.0.0.1:8766/` was directly inspected in the signed-in in-app browser at 1600 and 390 pixels, with an intermediate 1280-pixel check and return to 1600 on the same page. The live paper connection displayed account data; no execution was requested. Main Save plan / Save exits / Review order controls are together, restrictions expand by keyboard, and the separate Testing execution form is absent. Risk settings Escape restores focus to Change. Planner entry 222.27 survived resizing. Mobile Positions switching and F's recorded detail were inspected visually. Position-to-Journal navigation selected F, with matching remaining quantity 0, fees/net loss about $0.29 and Execution R -2.67. Verification opened in a separate tab and retained the draft tab.

The review found and corrected one remaining closed-position caption: Not confirmed became No remaining exposure. That correction is local commit `d060f1b`; final preview identity and reinspection are required below.

The browser also displayed a cloud error: JWT issued at future. The public auth endpoint's Date header matched the local UTC clock to the second during a read-only check, so a machine-wide clock mismatch was not established. The actual cloud REST/session failure remains unresolved. SQL ownership-policy tests do not establish that this browser authentication path is healthy. No token was printed and no session or credential was replaced.

Production HTML on the inspected precursor returned enforced CSP, DENY framing and nosniff. The signed-in page hydrated and console inspection returned no captured warnings/errors. This is not a full CSP or penetration audit.

## Final automated run — completed test stages

`npm run verify` resumed run: Node 201 passed / 2 skipped; backend 251 passed / 2 dependency deprecation warnings; TypeScript passed; browser 64 passed / 3 skipped. Browser duration 717.2 seconds. No baseline changes. The production build also passed; all five stages completed successfully. Logs and JUnit/HTML reports are in `output/readiness-verify-resumed.log` and `output/readiness-verification-resumed/`.

Fresh readonly ledger evidence at 2026-09-19 09:38:05 UTC: completed broker snapshot contained zero positions and zero open orders. NVDA and F remained Closed; SOFI remained Cancelled. Historical session remained Halted, target 200, session completed 1 (plus NVDA outside the session = two overall). No target amendment or broker submission occurred.


## Final-source recheck and limitations

Final local commit: `611b72e5fdbd8797d62d2dd24da18ae4d3020193`. Preview: `http://127.0.0.1:8766/`, identifier `611b72e5`; source identity reports zero eligible changed source files. The final source includes the caption correction and the documented cloud-authentication finding. Only generated/untracked output remains; no push, merge or deployment.

The previously observed cloud JWT error was absent after the final reload. Treat it as intermittent and unexplained, not a verified repair. No authentication safeguard was relaxed. Final direct inspection repeated desktop/mobile/desktop navigation, the corrected F caption, Position/Journal agreement, settings Escape/focus return, and draft retention. No warning/error entries were captured in the browser console.

Untested in this delivery: authenticated order-review success against fresh eligible-session quotes, any broker execution of the repaired lifecycle, completed 30-trade acceptance, live trading, physical monitor/DPI transitions, other browser engines and devices, complete revoked-token REST behavior, operational alerts, production ACL signoff and an active-service disaster recovery drill. Offline/wrong-scope/unknown-value cases and exact-order confirmation are deterministic automated evidence. Three skipped browser checks and two skipped Node checks remain skips, not passes.

The normal signed-in tab is available on port 8766; the original tab was preserved to avoid discarding its draft. Paper submissions remain disabled.

---

# Step 1 security and data implementation — September 20, 2026

## Decision

**Still no-go for live trading.** Step 1 now has local implementation for bounded authentication recovery, account-isolated state, complete immutable saved-plan evidence and server validation, plus expanded accounting and ownership regressions. Submission locks, TWS Read-Only guidance and the previous automatic approval rejection remain unchanged. No broker order, submission unlock, live-mode change, push, merge or deployment occurred.

## Completed implementation

- Journal session loading can no longer overwrite a newer authentication event. Reads and writes are scoped to the current user and access token, superseded responses are discarded, prior-user records are hidden immediately, and only the specific `JWT issued at future` history-read failure receives one automatic retry. Persistent failure remains visible with an explicit retry action.
- Planner/paper state resets on token changes. New batches, campaigns and immutable plan revisions carry user, account and paper-environment ownership; status and action routes enforce that scope. Preserved legacy account-bound evidence is not rewritten and remains available only through the installed owner boundary.
- A version-2 saved plan captures the execution quantity and hard cap, entry and stop inputs, sizing basis and observations, price provenance, market snapshot, account context, calculated risk/allocation, full targets/runners/breakeven rules, session/duration/protection policy and timezone-qualified save time. The server validates it against the ticket, archives it before acceptance, computes plan and complete-ticket digests, and rejects missing fields, tampering and same-revision/different-content races while retaining identical-request idempotency.
- Existing shared Position/Journal accounting remains the authoritative projection. Focused regressions now cover duplicate/reordered and conflicting executions, late/missing fees, missing risk/timestamps, restart identity, isolation and unrelated-record survival.
- `docs/trading/PRIVATE_STORAGE.md` defines dedicated runtime/backup paths, reversible Windows ACL migration and concrete runtime-versus-unrelated-user denial, WAL inheritance, backup and restore tests. No ACL was changed because the production runtime identity and paths are not selected.

## Automated evidence

- Focused: 16 Node authentication/accounting tests passed; 86 backend authentication/readiness/lifecycle tests passed with 2 known dependency deprecation warnings; 19 normal-flow paper UI tests passed; TypeScript passed.
- Full `npm run verify` passed all five stages in 889.6 seconds using Node 22.22.2, repository Python 3.11.9, pytest 9.1.1 and Chromium 153.0.8010.12: 204 Node tests passed with 2 skipped, 273 backend tests passed with 2 deprecation warnings, TypeScript passed, 66 browser tests passed with 3 skipped, and the production build passed. No screenshot baseline was updated. Reports are under `output/trading-step-1-verify/` and remain generated evidence rather than committed source.
- Installed dependency consistency passed. Official `ibapi` 10.50.2 pins protobuf 5.29.5. Package RECORD SHA-256 values were `F3432B7416EBEC13C91D12F2BB1F70F8023C6BDF181CA7C46E187D70CEA0467D` for ibapi and `F6FAA674DA609CE3B34180E3FFB413B104BDD37FAEFFFCF1AFF0CA0F09682420` for protobuf.
- Python audit reported one unique affected protobuf advisory, PYSEC-2026-1805/CVE-2026-0994/GHSA-7gcm-g887-7qv7, twice through metadata aliases. Fixed versions conflict with the official SDK's exact pin, so no unsupported dependency override was applied. Two JavaScript audit attempts returned HTTP 503 from the npm advisory endpoint and are not represented as a clean audit.
- The scoped tracked/generated-client secret-pattern scan found no generated-client matches. Tracked matches were limited to the verification dummy value, the example placeholder and configuration identifier names; no secret value was exposed.

## Direct browser evidence

The final candidate source was served at `http://127.0.0.1:3000/?demo=1` with identifier `611b72e5+d.3c34d6a8`. The same page was inspected at 1440x900, 390x844 and again at 1440x900. The planner and Positions remained usable without page-level horizontal overflow. Save plan and Save exits remained local-only; changing entry from 100 to 101 immediately invalidated the saved revision and disabled intent validation while preserving the draft through the responsive transition. Journal filters and cards stacked on mobile, the NVDA detail expanded, and its internal trade scroller remained contained. The risk dialog was inspected on mobile; Escape closed it and returned focus to Change. The final desktop viewport measured 1440 CSS pixels with 1440 document scroll width, and the browser warning/error log was empty.

The unauthenticated paper route was also opened and showed the sign-in boundary and matching preview identifier. No credentials or session were changed. The cloud error/retry and real account-switch flow were not directly exercised because no disposable authenticated identities were available; those cases remain automated-only evidence. Physical monitor/DPI behavior and non-Chromium browsers were not tested.

## Explicit blockers and unverified gates

- The intermittent cloud validator-clock root cause is still unknown. The new retry is deliberately limited to one idempotent read and is not a readiness claim.
- Disposable deployed REST ownership/revocation evidence and Supabase compromised-password protection remain external cloud gates.
- The official SDK/protobuf advisory remains unresolved; an unsupported override was not accepted. The JavaScript advisory service was unavailable during this run.
- Production Windows identity/path selection, ACL apply/deny/restore testing, active-service disaster recovery and operational alerting remain open.
- Fresh broker protection, reconnect, concurrency, flat-quantity, cleared-owned-order and complete-accounting observations remain blocked from this step. No broker action was authorized or performed.
- The existing skipped tests remain skips, not passes. Passing Step 1 does not authorize paper submission or live trading.

This report is part of the reviewed source. The exact local commit SHA and the clean post-commit preview identifier are recorded in the delivery handoff because a commit cannot contain its own SHA.

---

# Local-first security/data closure — September 20, 2026

## Decision and source

**Still no-go for live trading.** Work started from `f21e8a7ef2eb490d25036356eb66dad3a38fe871` on `codex/local-first-security-closure`. No broker order, paper-submission unlock, historical target amendment, service restart, merge or push occurred. The halted session, rejected automatic approval, target 200, two historical completions and F protection failure remain preserved.

## Public hosting removal

- The remote `Deploy Brontide to GitHub Pages` workflow was disabled before other implementation. No queued or running deployment existed to cancel.
- The last published artifact (run `35464051997`, artifact `10590742044`) was inspected after extraction: 50 files / 2,820,618 bytes. It contained one expected Supabase publishable-key reference and public research/demo data, but no privileged key, JWT, database credential, private-key material, private runtime path or broker execution record.
- The Pages site was deleted with the supported GitHub API. The Pages API returns 404 and a cache-bypassed request to `https://melvinroy.github.io/Journal/` returns 404 with no Brontide content.
- The source workflow no longer runs on `main`, no longer enables Pages, has no embedded project fallback, and is fail-closed behind manual dispatch, `BRONTIDE_PAGES_PUBLISH_ENABLED == 'true'` and a required approval reference. The remote workflow remains disabled.

## Cloud security and clock evidence

- The Supabase project is on Free. Dashboard inspection showed leaked-password protection disabled and explicitly limited to Pro and above. No setting or subscription was changed.
- The deployed user inventory contains only the real owner account, so the disposable A/B ownership and revocation matrix has not yet run. No real record was used for destructive testing.
- Windows Time reports a successful `time.windows.com` synchronization. Five read-only Supabase Date-header samples differed from the local request midpoint by -0.75 to +0.07 seconds. Two-day Auth, PostgREST and gateway log searches found no `future` / `JWT issued` match. A persistent local clock offset was not reproduced, but the intermittent validator-clock cause remains unknown; the existing one-read retry and all authentication checks remain unchanged.

## Dependencies and generated output

- `npm audit --omit=dev --audit-level=low`: zero vulnerabilities.
- Repository Python `pip-audit`: no known vulnerability in auditable packages; the local project is not on PyPI. `pip check`: no broken requirements.
- Active operator environment: official `ibapi` 10.50.2 still pins protobuf 5.29.5 and reports PYSEC-2026-1805 / CVE-2026-0994. IBKR's current official download remains 10.50. The fixed protobuf versions conflict with the SDK pin, so no unsupported override was applied.
- Final `out` scan: zero privileged-secret match files, zero private-runtime-path match files and zero broker-evidence match files; one generated file contains the expected browser publishable key.

## Private storage operational evidence

Candidate runtime identity `MELVIN\melvi` and literal paths are recorded in `docs/trading/PRIVATE_STORAGE.md`. The new runtime/backup roots exclude inherited development-platform grants. Online SQLite backup, separate restoration and integrity checks passed with matching 23 objects, 27 commands, 55,395 events and schema version 1. A new database, WAL and SHM inherited only the owner, `SYSTEM` and `Administrators` grants. Original files remain in place.

The active service was not stopped or repointed. A genuinely distinct Windows identity could not be created from the non-elevated shell, so read/write/delete/list denial and the final cutover/reconciliation remain open gates.

## Automated verification

- Focused: 31 Node tests passed; 94 backend tests passed with 4 SDK-dependent skips and 2 deprecation warnings; 19 paper UI tests passed. The long 200-campaign test was left to the full gate.
- Workflow YAML parsed, required fail-closed job condition was present, the `push` trigger was absent, and `git diff --check` passed.
- Full `npm run verify` passed all five stages in 1084.1 seconds: 204 Node tests passed / 2 skipped; 269 backend tests passed / 4 skipped / 2 deprecation warnings; TypeScript passed; 66 browser tests passed / 3 skipped; production build passed. No screenshot baseline was updated. Evidence is under `output/trading-local-first-closure/` and `output/trading-local-first-closure-verify.log`.

## Direct browser observations

- Supabase dashboard: project Free plan; one real user; leaked-password control disabled with a Pro-only notice. No cloud setting changed.
- Supabase logs: two-day Auth, PostgREST and gateway searches showed no matching validator-clock error.
- The final source candidate was served from the intended checkout on `http://127.0.0.1:3000/`. Through ordinary demo controls, a plan was saved at entry 101 and changing the entry to 102 visibly invalidated the review, retained the draft, and kept validation/submission disabled. The NVDA open-position detail disclosed stale pricing and seven unprotected shares. The AMD closed-position detail and its linked expanded Journal row agreed on 20 entered, 20 exited, zero remaining, weighted exit 168, gross +80, costs +2 and net +79 (rounding from the underlying 78.70). Exiting demo returned to the sign-in boundary. This is direct UI evidence for ordinary controls, not authenticated-flow evidence.
- The exact-source authenticated Plan/Positions/Journal matrix is still pending disposable identity creation. The automated normal-control flow passed, but it is not substituted for signed-in direct evidence.

## Remaining external or unverified gates

- Disposable cloud identities, deployed A/B ownership/reassignment and revoked-session behavior; authenticated ordinary-control browser transitions and cleanup.
- Supabase Pro entitlement and separate account-level approval for leaked-password protection.
- Official IBKR SDK/protobuf compatibility fix.
- Distinct Windows identity denial, active-service path cutover, read-only reconciliation and rollback-window completion.
- Fresh broker protection/reconnect/concurrency, owned-flat, owned-orders-cleared and complete-accounting evidence; 30 authenticated audited round trips; live trading. None was attempted or inferred.

The exact local commit SHA and matching post-commit preview identifier are reported in the final handoff; no push, merge or deployment is authorized by this report.
