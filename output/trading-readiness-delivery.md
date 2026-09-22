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

---

# Remaining Step 1 verification closure — September 20, 2026

## Scope and decision

**Still no-go for live trading.** This verification-only package started from `edefd2cd63457695a315c4c09a169bf2d41a3e9b` on `codex/local-first-security-closure`. It made no executable-code, dependency, authentication-policy, billing, ACL, service, broker or deployment change. GitHub Pages remains unpublished and its workflow remains disabled. The halted session, rejected automatic approval, target 200, two historical completions and F protection failure remain unchanged.

## Disposable identity and deployed ownership evidence

The test used Supabase project **trading-journal** (`fsccmouzyfgcpqlmcngu`) and unique marker `step1-20260920071738-e5b5l7`. Two auto-confirmed reserved-domain users were created through **Create new user**; no invitation, recovery, magic-link or confirmation email operation was used. Their disposable Auth UUIDs were `63e6a544-2cf1-4d73-959f-7c33af499786` (A) and `92f80aa4-f16a-447f-8aea-6b40d22edf81` (B). The existing owner UUID was different and was not selected, rebound, signed out or modified.

- A and B logins returned 200. Each inserted exactly one owned `public.trades` fixture (201). Each saw one own row and zero cross-user rows.
- Cross-user update and delete requests returned 200 with zero affected rows. Explicit cross-user insertion and ownership reassignment both returned 403. Each owner could update its own fixture, and both fixtures remained correctly owned after every negative case. No write was retried.
- Anonymous and malformed bearer requests returned 401. A and B refreshes returned 200, and refreshed tokens retained one own row / zero cross-user rows.
- B logout returned 204. The Auth user endpoint rejected the revoked session after 0.2 seconds and remained rejected through 30.3 seconds. PostgREST continued to accept the already-issued access JWT for its one owned row throughout the same 30.3 seconds. The token lifetime was one hour. This is an observed stateless-JWT revocation window, not immediate global invalidation; actual expiry was not awaited and remains unverified.
- Fixture cleanup was limited to the two recorded row UUIDs. Marker/owner pairs were checked, each fixture was deleted once in its owner context, and both owners then returned zero marker rows.
- After explicit action-time authorization, the two Auth UUID/address pairs were verified against the creation evidence and only those two accounts were selected. The dashboard reported **Successfully deleted the selected 2 users**. After refresh, exact searches for each UUID independently returned **No users found / Total: 0**. The unfiltered table showed only the pre-existing owner account. The dashboard heading/footer count was stale before filtering, so it is not used as deletion evidence.

## Authenticated local browser observations

The signed-in checks used `http://localhost:3000/` and preview `edefd2cd+d.dc895c42`; this identifier included the intended `edefd2cd` executable source plus the then-current eligible documentation/untracked-source contribution. The documented localhost origin was used because the 127.0.0.1 development origin did not complete the Next.js development connection. No broker validation, submission or execution was requested.

- A's Journal showed only A's fixture and B's showed only B's. A saved a local `QAADRAFT` plan through ordinary Plan controls with entry 100 and manual stop 95; TWS/account remained unavailable and submission controls remained locked. B opened with the default NVDA plan and no A plan. Returning to A restored A's saved plan.
- An unsaved A review was cleared after the A→B→A scope transition and did not appear for B. This is intentional review invalidation, while the saved A plan remained preserved.
- A delayed A history request was intercepted while switching to B. The browser canceled that prior-session request; continuing it reported that the interception no longer existed. B rendered one B record with no A marker. This is direct fail-closed cancellation evidence. The stronger case where a prior-session response actually resolves after the switch remains automated-only coverage.
- Failing B's history GET rendered **Sync issue / Cloud history unavailable / TypeError: Failed to fetch**. The ordinary **Retry cloud history** control restored **Cloud synced** and still showed only B's row.
- These legacy fixtures do not establish accounting agreement with broker executions, and the disposable cloud users could not be bound to the real owner's local paper account/environment. Same-user account/environment transition evidence and fresh broker accounting therefore remain open.

## Dependency, skipped-test and configuration reconciliation

- Repository environment: `services/eod/.venv`, Python 3.11.9, no `ibapi` or protobuf installed, dependency consistency clean and repository Python audit clean for auditable packages. This result applies to the repository test environment, not the operator's full trading runtime.
- Active operator service environment: the protected `Journal-ui-refinement` checkout's venv with official `ibapi` 10.50.2 and exactly pinned protobuf 5.29.5. Dependency consistency passed, but the audit reported PYSEC-2026-1805 through two metadata aliases. Fixed protobuf versions 5.29.6 / 6.33.5 conflict with the SDK pin. IBKR's current stable 10.45 package has no Python API and its latest 10.50 package still supplies the affected combination, so no vendor-supported remediation is currently available and no pin or metadata was overridden.
- The four SDK-dependent backend cases that normally skip in the repository environment were explicitly run against the active operator environment with mocked transport: 4 passed with 2 known deprecation warnings. They cover cancel/OCA translation, monotonic concurrent order IDs, UTC seven-day execution filtering, and modern `lastNDays` plus errors/fees. The normal full-suite skips remain accurately classified as optional-SDK absence, not failed execution.
- Supabase **Prevent use of leaked passwords** is disabled on this Free project. Official configuration requires Pro or higher plus enabling the control in Auth Attack Protection. No subscription, billing or configuration change was made.
- Read-only clock investigation still has no new reproduction. Previous synchronized-clock, Date-header and log evidence rules out a persistent broad skew but does not explain the intermittent validator error. Authentication validation and the single idempotent read retry were not changed.

## Windows private-storage evidence

The interactive identity is `MELVIN\melvi` (`S-1-5-21-1386659274-518491314-1459396466-1001`) in a non-elevated shell. The prepared runtime and backup roots exist, are owned by that identity, inherit their ACLs and expose full-control entries only for `MELVIN\melvi`, `SYSTEM` and `Administrators`. This is inspection, not operational denial proof.

No suitable disposable non-owner identity or elevation was available. The prepared `MELVIN\BrontideAclProbe` procedure in `docs/trading/PRIVATE_STORAGE.md` gives literal paths and separate list/read/create-or-write/delete checks while preserving owner access. It was not run. Active-service cutover, TWS reconnection, reconciliation and rollback remain a separate reviewed operation.

## Automated results, carried-forward results and skipped cases

- Newly executed focused check: four operator-SDK backend tests passed; two known dependency deprecation warnings were emitted.
- Documentation checks for this package: `git diff --check` passed before commit. No executable, dependency or rendered frontend source changed, so a new full `npm run verify` and a new frontend-verification implementation run were not warranted. The last full result at the unchanged executable baseline remains: 204 Node passed / 2 skipped; 269 backend passed / 4 skipped / 2 warnings; TypeScript passed; 66 browser passed / 3 skipped; production build passed.
- Authenticated observations above are direct browser evidence. Earlier demo evidence remains demo/fixture evidence only. Physical monitor/DPI, non-Chromium browsers, a delivered delayed prior-session response, actual one-hour token expiry, same-user account/environment switching and fresh broker accounting were not directly tested in this package.

## Remaining gates

1. Create a suitable disposable Windows non-owner account with elevation, execute and review list/read/write/delete denial, then separately review active-service cutover and rollback. No ACL listing substitutes for this proof.
2. Obtain Supabase Pro-or-higher entitlement and separate approval before enabling leaked-password protection.
3. Obtain a vendor-supported IBKR SDK/protobuf combination without PYSEC-2026-1805; the current operator runtime must not be called vulnerability-free.
4. Resolve or reproduce the intermittent validator-clock error without weakening validation or retrying uncertain writes. Record real access-token expiry behavior if that evidence is still required.
5. Establish same-user paper account/environment transitions and fresh broker-based Plan/Position/Journal accounting, protection, reconnect, flat quantity and cleared-owned-order evidence in a separately authorized session. The 30-round-trip acceptance amendment also remains separately blocked. No broker action is authorized by this report.

The exact scoped local commit SHA and the post-commit preview identifier are reported in the review handoff because a commit cannot contain its own SHA. No push, merge, deployment, service cutover or broker execution occurred.

---

# COORD-02 identity-boundary review — September 20, 2026

## Decision and scope

**No production defect was demonstrated and live trading remains a no-go.** This package started from `746b25ec8b999520cbaecd990f4a7ea86e2cd194`. It added deterministic isolation/expiry regressions and documentation only; application behavior, cloud configuration, installed owner binding, broker state and submission policy were not changed. No TWS connection, broker endpoint, service cutover, cloud user, paid change, ACL operation, push, merge or deployment was used.

## Boundary matrix

| Boundary | Validation and ownership | Revocation / expiry guarantee | Deterministic evidence and residual limit |
| --- | --- | --- | --- |
| Journal cloud reads | The Supabase browser client sends the current access JWT to PostgREST; deployed RLS limits rows by `auth.uid()`. The load effect is keyed by user ID and access token, hides the previous owner's bucket immediately, and accepts a result only while its request is current. The one retry applies only to `JWT issued at future` and only while the same request remains current. | Supabase logout/revocation prevents refresh and Auth-user lookup when the Auth service observes it, but an already-issued PostgREST JWT can remain valid until its JWT expiry. The observed revoked token still read its own row through 30.3 seconds of a one-hour token. Brontide does not claim immediate PostgREST revocation. | A new browser regression holds A's actual REST response, signs out, signs in as B, renders B, then resolves A; B remains visible and A never appears. Existing Node tests cover token refresh dependencies and cancellation during the clock-retry delay. Real one-hour expiry remains unobserved. |
| Local paper HTTP endpoints | Requests must be loopback, any supplied Origin must match, and mutations require the local-request header. Every endpoint dependency calls Supabase `/auth/v1/user`; operational endpoints then compare the verified user with the immutable installed owner and current `PaperGatewayConfig.binding()`. | Once Auth rejects a revoked/expired token, the next local HTTP request returns 401 and cannot renew authority. An already-admitted identity refreshes an in-memory operator lease for 60 seconds. Normal sign-out calls local `/signout` before cloud logout; if that call is unreachable, the lease is allowed to expire rather than retrying a write. | Existing authentication tests cover absent, expired, malformed, anonymous, wrong-user and wrong-binding requests. New same-user fixtures prove records follow the exact paper account binding and reject a non-paper environment. A real installed-account switch was not performed. |
| Exact order review / entry | Approval requires the verified local owner plus the exact batch digest, source identifier, account binding, connection ID and review window. Entry authority also checks the current source, connection, submission lock, prior rejection and batch expiry. New entries occur only through an authenticated explicit submit request. | A stale review cannot be approved, and entry authority rejects an expired operator lease or expired batch window. Disarming clears the armed batch, reviewed campaigns and authorized-batch set and changes the authenticated connection identity. | A new regression expires `validUntil` before approval and proves rejection with no approval receipt or transport write. Existing source/account/connection/rejection tests remain in force. Submission is still locked, and no real eligible quote/order evidence was produced. |
| Managed campaign authority | A position action is reauthenticated and scoped to user, paper account, environment, connection, current campaign revision and reviewed source. Successful review stores only in-memory campaign/batch authority; broker-held protective orders remain independent at TWS. | Managed authority has the same 60-second local lease. The worker disarms before further automation when the deadline expires; authenticated actions also fail the lease check. If normal sign-out cannot reach the service, managed rules can retain local authority only until that deadline, while existing broker-held protection remains in place. | A new regression establishes reviewed managed authority, expires the lease, then proves the next authority check disarms and clears all reviewed/authorized sets. This is deterministic mock evidence, not a real broker or process-timing observation. |

The frontend paper storage key includes user and account binding. The server record scope also requires environment=`paper`. There is no second enabled execution environment: `BRONTIDE_EXECUTION_ENVIRONMENT=live` is rejected. Before any future multi-environment release, the frontend identity/storage scope must explicitly add environment rather than relying on the current single-environment invariant.

## Verification

- Focused repository Python: `test_paper_auth.py` plus `test_paper_readiness.py` — 43 passed, with the two known dependency deprecation warnings.
- Focused ordinary paper UI: 20 passed, including the new response-that-resolves-after-switch regression. The first local iteration selected A for both mocked token responses; the fixture was corrected to parse B's request payload, after which the new case and the complete paper UI file passed.
- Full `npm run verify` passed all five stages in 813.4 seconds: 204 Node passed / 2 skipped; 272 backend passed / 4 SDK-dependent skipped / 2 known warnings; TypeScript passed; 67 browser passed / 3 skipped; production build passed. Reports are in `output/coord-02-verify/`.
- No rendered application behavior changed. A separate frontend-verification implementation review was therefore not applicable; final source identity is checked against a served post-commit preview in the review handoff.

## Remaining evidence and external gates

- Actual one-hour PostgREST token expiry and a real local installed-account transition remain unobserved. Deterministic tests do not replace them.
- The 60-second managed-authority bound is proven by controlled time/state tests, not by allowing a real broker-managed session to expire. No broker interaction was authorized.
- Validator-clock root cause, elevated Windows denial/cutover proof, Supabase Pro leaked-password protection and the official IBKR SDK/protobuf advisory remain open.
- Fresh broker accounting, protection, reconnect, flat-quantity and cleared-order evidence, the separately audited 30-round-trip target and all live-trading gates remain open. The previous submission-policy rejection remains independently binding.

The exact scoped commit SHA and post-commit preview identifier are reported in the review handoff. This report does not authorize a push, merge, deployment, service restart, broker execution or submission unlock.

## Independent review follow-up — September 21, 2026

Read-only review of `7e2a8dcad5109258d83e839a569d2130e1a73fc5` found a gap in the new late-Journal-response regression: releasing A's route and immediately checking the already-visible B did not establish that A's response had been processed. No application defect was demonstrated; the production code retains both a cancelled-request check and a current-owner setter guard.

The test now waits for A's specific network response to finish, observes the Supabase client's `Response.text()` body consumption, and uses a queued browser task plus two animation frames before asserting A is absent and B remains visible. It adds no fixed delay or application behavior change.

- Focused paper UI: **20 passed** (2.6 minutes).
- Negative sensitivity: a detached disposable checkout at the same baseline removed the stale-request and owner guards only in its local application copy. The body/render marker passed, but the final `USERB` visibility assertion failed after its full 10-second assertion timeout. Its owner-tagged bucket still hid A; loss of B is the demonstrated failure. The proof does not claim every possible asynchronous race is covered.
- Positive control: restoring the disposable application's original source made the same test pass (**1 passed**, 43.6 seconds).
- The disposable server used webpack on isolated port 3117 with fixture-only Supabase endpoints. An initial cold-server startup timeout and a cold-run global timeout were infrastructure iterations, not the final sensitivity evidence. The final negative run used a 90-second test budget in the disposable configuration, leaving the actual assertion timeout at 10 seconds.
- Negative trace and browser error context are retained under `output/coord-02-response-proof/sensitivity/`. These are automated artifacts, not separately inspected manual screenshots.
- Full `npm run verify`: **all five stages passed in 854.2 seconds** — 204 Node passed / 2 skipped; 272 backend passed / 4 SDK-dependent skipped / 2 known warnings; TypeScript passed; 67 browser passed / 3 skipped; production build passed. Reports are under `output/coord-02-response-proof/`; the runner log is `output/coord-02-response-proof-verify.log`. No screenshot baselines were changed.
- No active application source, cloud/broker state, submission lock, service configuration or installed account binding was changed. Existing `next-env.d.ts` and unrelated untracked files remain preserved.

Cleanup of the disposable worktree and its dependency junction was rejected by automatic approval review with `blocked by policy`. No cleanup retry was made. The temporary checkout remains at `C:\Users\melvi\AppData\Local\Temp\brontide-coord02-proof-c4e70a8f0a1b48279a2f39034b46a32b`; its application source was restored before the successful positive control. This cleanup limitation does not change the trading-policy block or any release gate above.

## COORD-03 synthetic restore and acceptance preparation — September 21, 2026

Scope is fixture-only recovery verification and documentation. No application or rendered behavior changed, and no private runtime database, cloud identity/configuration, ACL, service, broker connection, order, target amendment or deployment was touched. This is not operational or broker recovery evidence.

### Added deterministic proof

- A fake-transport campaign is closed with missing exit commissions, alongside an immutable saved-plan revision and an unrelated synthetic campaign with distinct order/execution identities. SQLite backup is restored to a new temporary path. Complete objects/commands/events, schema and integrity agree; the original remains unchanged.
- A fresh service object uses the restored store and the existing fake transport. Duplicate/reversed execution callbacks do not change economic executions; duplicated late fees yield exactly $0.60 fees, -$6 gross and -$6.60 net. The unrelated campaign and plan evidence survive unchanged. No transport writes occur during restored replay. This is an in-process mock rehearsal, not a process/service restart or real broker reconnection.
- A synthetic transmission timeout leaves durable uncertainty. The restored service starts unarmed and rejects replay with the exact authority error. An isolated matching approval receipt/connection then reaches the actual arming/reconciliation path: the fake callback confirms the transmitted parent command but the incomplete campaign still blocks arming with an outstanding-reconciliation error. Command identities/requests remain intact and no second economic action is sent. No real user approval or expired-session guarantee is inferred.

The existing P01–P38 matrix is preserved with a prominent historical notice and dated normal-control overlay. Legacy tooling enablement instructions are explicitly superseded by the independent policy block. The readiness summary separates completed disposable cloud/COORD-02 evidence from remaining external decisions. Two historical round trips, F failed protection, SOFI cancellation, 30 ceiling and existing limits remain unchanged.

### Verification

Focused readiness/lifecycle tests: **67 passed, 4 skipped, 2 known dependency deprecation warnings** using repository Python 3.11.9. The skipped adapter cases still require the optional official SDK; they are not newly executed evidence. A preliminary full run was deliberately interrupted to incorporate independent test review; it is not a verification pass. Final full verification results are recorded below after completion. Logs/reports are under `output/coord-03-verify/` and contain no private broker evidence.

No frontend implementation review or fresh signed-in/manual browser observation is claimed because rendered behavior did not change. The pre-existing `next-env.d.ts` bytes, `CLAUDE.md` and unrelated generated files are preserved. Previously policy-blocked temporary proof-checkout cleanup was not retried.


Final `npm run verify` completed successfully in **752.5 seconds** on the final executable/test source: 204 Node passed/2 skipped (6.3s); 274 backend passed/4 skipped/2 known warnings (324.9s); TypeScript passed (17.2s); 67 browser passed/3 skipped (374.0s); production build passed (29.2s). No screenshot baselines changed. Only checklist/results text was finalized afterward. Original `next-env.d.ts` bytes were restored and compared exactly; its pre-existing unrelated diff remains preserved. Exact local commit/source identity is reported separately by the delivery coordinator; no commit, push or merge is implied by this test result.

## Phase 1 final security checks — September 21, 2026

**Historical section:** its next-action recommendations and unexecuted-helper description are superseded by the September 22 section below. The desktop attempt failed before fixtures; the probe is now suspended and no operator action is requested.

This bounded package starts from local commit `8611ff4d48cca94f7846423112f5c139db1caacb` on `codex/phase1-final-security-checks`. Sub-agents performed independent Windows preparation, dependency inspection and session-access checks; the coordinator reviewed their reports and the operator script. Application and regression source were not changed. The unrelated `next-env.d.ts` diff and untracked files remain preserved.

| Item | Result and remaining requirement |
| --- | --- |
| Windows protection | **Partial pass / blocked:** non-elevated `MELVIN\melvi` list/create/read/update/delete succeeded on harmless unique files in both private roots at 11:26:54 UTC; files removed and absence verified. ACL/reparse inspection and helper syntax/static review passed. The user must run the narrowly scoped elevated helper for genuine distinct-user denial. No test account was created by the agents. Recheck normal-owner access afterward and separately confirm exact-account cleanup. |
| Protected storage | **Preparation passed; operation blocked:** runbook now records exact destination settings, fresh-backup requirements and rollback without losing post-cutover events. No active service was stopped, repointed or restarted. Actual cutover/reconciliation/rollback remain unperformed. |
| Password protection | **Deferred, not passed:** explicit no-paid-upgrade choice retained. No billing/authentication configuration change. |
| Broker dependency | **Blocked:** repository npm and Python advisory audits and dependency consistency passed. Protected operator dependency consistency passed, but its audit found protobuf 5.29.5 affected by CVE-2026-0994 (alias GHSA-7gcm-g887-7qv7). Fresh official 10.50.2 archive inspection still shows the exact affected pin. No supported patched candidate or forced override installed. Non-PyPI editable/SDK packages skipped by the auditor are not security passes. |
| Real token expiry | **Blocked before creation:** healthy project connector access exists, but the normal Auth dashboard remained blank after navigation/reload, and no Auth-admin create operation is exposed. No disposable user, JWT, session, trade row or email was created; the one-hour test never started. Restore authenticated dashboard access before this check. |
| Validator clock | **Unresolved:** three public Auth-health requests returned 200 with sanitized local/HTTP timing. These are not JWT-validation-clock measurements and do not close the intermittent failure. |

Detailed local artifacts: `output/phase1-final-checks/dependencies.md`, `session.md`, and `Invoke-BrontideAclProbe.ps1`. The helper is a prepared, unexecuted operator artifact; parser/static review is not administrator-execution evidence. Its independent review identified and corrected misleading elevated-owner labeling; genuine non-elevated owner evidence is recorded separately in the private-storage runbook. Local output artifacts remain available separately from the scoped documentation commit.

Documentation checks include whitespace/diff review. No fresh full suite or frontend behavior inspection is claimed for this documentation-only delivery; the earlier full suite above is historical executable-source evidence. No broker connection, order, target amendment, submission unlock, cloud identity mutation, ACL change, cutover, push, merge or deployment occurred. Previously rejected cleanup was not retried.

**Historical September 21 readiness:** Phase 1 remained incomplete; live trading remained no-go. The subsequent desktop discrepancy below supersedes the suggestion to run the Windows denial probe immediately.

## Independent Phase 1 package — September 22, 2026

Baseline `277e8bf10f6b60419ea1a608aeab7dbb74b546cd`, branch `codex/phase1-final-security-checks`. The user deferred all approval/operator-dependent actions. `docs/trading/OPERATOR_ACTIONS.md` now holds prerequisites, procedures, expected results and evidence requirements for those later actions. No user action is requested during this package.

### Corrected storage evidence

The user's supplied screenshots show that normal and elevated desktop PowerShell cannot find `BrontidePrivate`; normal `LOCALAPPDATA` is `C:\Users\melvi\AppData\Local`, and its direct child-name listing returned no Brontide/Journal folders. Identity and hostname match the agent reports, but that does not establish identical filesystem views. The administrator probe stopped at its first root lookup, before account or fixture creation. The helper is suspended until paths agree. Prior agent-only ACL, owner access and backup/restore observations are preserved as history, not proof of a protected desktop installation.

Fresh read-only agent inspection at approximately 13:23 UTC found the original data paths and candidate private roots visible. Database/owner overrides are unset in process/user/machine scopes; the verification path is explicitly set in process/user scope. Windows PowerShell 5.1 x64 launched within the agent session sees the same roots as PowerShell 7, so shell version alone is not an explanation. No Python process or listener on inspected ports 8765/8766/8787/3000/8000 was observed. This does not prove desktop service state. No restart or connection was attempted.

Source trace: `paper_store.py:18` selects an explicit constructor path, then `BRONTIDE_PAPER_DATABASE`, then local AppData/home `Brontide/paper-lifecycle.sqlite3`; `paper_auth.py:15` selects owner override/default; `ibkr_tws.py:247` requires a configured verification path. `scripts/local.mjs` loads root dotenv and passes the environment to the service; `config.py:37` supports `BRONTIDE_ENV_FILE` or dotenv discovery. Agent-side allowlisted configuration inspection is not observation of a running service's environment. Renaming the code folder does not rename private storage. **Cause remains unresolved.** No folders, databases or configuration were changed to make observations agree.

### Independent coverage review and narrow addition

Existing deterministic tests cover clock retry bounds and cancellation (`tests/auth-ready.test.mjs`), stale Journal responses after identity changes (`tests/ui/paper-ui.spec.ts`), missing owner and review/lease expiry (`test_paper_auth.py`), account isolation and restored uncertain commands/late-fee idempotency (`test_paper_readiness.py`), and persistence failure before transmission (`test_paper_lifecycle.py`). These tests do not replace actual expiry, desktop ACL, account-transition or broker evidence. Missing database paths may create a new ledger by design; this review does not claim every missing-path case rejects startup.

The only new regression parametrizes Auth `TimeoutException` and `ConnectError`. Valid status and submit requests must each perform one lookup and return the exact sanitized 503 response, without reaching owner lookup, authority refresh or endpoint service dispatch. Failure sentinels prevent a false pass if those request paths are reached. Existing TestClient shutdown still runs; no claim of zero application lifecycle activity is made. No production implementation changed.

Focused verification reported by the implementation sub-agent: repository Python 3.11.9, **22 passed, 2 known deprecation warnings** in 3.19 seconds. A separate reviewer inspected endpoint dependency wiring, valid payloads, failure sentinels and response assertions and found no blocking issue. Full verification results are recorded below when complete. No rendered behavior changed; no new manual frontend observation is claimed.

Supabase session/password guidance and the changelog were rechecked for the deferred procedure. The Markdown changelog required a direct read after the browser fetch rejected its content type. No cloud fixture, settings, token or real login action occurred. Revocation and expiry are treated separately; deleting a user is not proof of invalidating an issued JWT.

### Final verification and review

`npm run verify` passed all five stages in **879.9 seconds**: Node **204 passed / 2 skipped** (16.2s); backend **276 passed / 4 skipped / 2 known warnings** (370.3s); TypeScript passed (31.6s); browser **67 passed / 3 skipped** (412.0s); production build passed (44.5s). Runtime: Node 22.22.2, repository Python 3.11.9, pytest 9.1.1, Chromium 153.0.8010.12. Logs/reports remain local under `output/phase1-independent-verify.log` and `output/phase1-independent-verify/`. Skips remain limitations. No screenshot baselines changed; no manual signed-in or physical-display proof is claimed.

Independent documentation review corrected historical operator-availability wording and required a final consistent SQLite snapshot after writer quiescence in both cutover procedures. Reviewer confirmed corrections and zero syntax errors in the deferred diagnostic block without executing it. Local document links and scoped whitespace checks passed. Only checklist/evidence text was finalized after verification. Unrelated `next-env.d.ts` bytes are preserved (Git blob `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`), along with other unrelated/untracked artifacts.

**Readiness:** this independent package is complete; Phase 1 is not. Operator paths/ACL/cutover and actual session/account evidence remain deferred or blocked; password protection remains deferred without upgrade; vendor SDK remediation and broker acceptance remain blocked; storage visibility and intermittent validator-clock cause remain unresolved. No push, merge, deployment, broker request, target amendment, submission unlock or previously rejected cleanup occurred. No operator action is requested now.
