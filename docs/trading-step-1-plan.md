# Step 1 — Close trading security and data gaps

**Status: implementation resumed; local verification and external gates tracked below.**

Prepared: 19 September 2026.
Scope: Trading → Plan & Position and Journal only.

## 1. Outcome

Make identity, account boundaries, saved plans and accounting reliable enough to advance to the separate paper-execution acceptance stage.

Completing this step does **not** enable live trading. Protection/recovery evidence, normal-interface paper acceptance, operational readiness and the separately approved live pilot remain later gates.

### What the customer should experience

- Signing in, refreshing a session or changing accounts never displays someone else's records or reuses their draft.
- A temporary history-loading failure is recoverable and clearly distinguished from an empty Journal.
- Save plan, Save exits and Review order remain the normal workflow. No alternate testing form is introduced.
- An order review is traceable to the exact saved plan and account that produced it.
- Position and Journal agree on quantities and money. Missing information remains visibly unknown.
- Private records and credentials are accessible only to the intended operating identities.

## 2. Starting point and evidence limits

The last fully verified delivered commit is `611b72e5fdbd8797d62d2dd24da18ae4d3020193`. Its recorded verification was 201 Node tests, 251 backend tests, TypeScript, 64 browser tests and a production build. These are historical results for that commit, not approval of subsequent edits.

| Finding | Evidence available | What remains uncertain |
| --- | --- | --- |
| Cloud authentication | A signed-in browser intermittently displayed `JWT issued at future`; the error later disappeared. | The actual issuing/validating clock relationship and session path were not established. Matching one HTTP Date header to the computer clock is insufficient. |
| Session recovery | Source inspection shows Journal loading depended on user ID, without a token-refresh dependency. | End-to-end refreshed, expired and revoked session behavior needs direct testing. |
| Account isolation | Local stores are scoped; deployed SQL ownership checks previously rejected cross-user access. | Browser transitions, delayed responses, REST/JWT enforcement and same-user/different-account handling need a complete matrix. |
| Plan evidence | Reviewed execution-ticket content and its digest are persisted. | The delivered version did not archive every planner field. |
| Accounting | Position and Journal share the execution projection, with deterministic coverage and two historical broker round trips. | More failure/late-data coverage is needed; F's historical protection failure remains failed. |
| Dependencies | Current audit still flags protobuf; the official latest download points to API 10.50.2. That SDK pins protobuf 5.29.5. | A supported, patched SDK/runtime combination has not been verified. |
| Cloud security | A fresh Supabase advisor check still reports compromised-password protection disabled. | Available plan/configuration access and actual enforcement require verification. |
| File permissions | Private files inherit owner, SYSTEM, Administrators and Codex platform grants. | A production runtime and backup location with independently verified least-privilege access is not established. |

No claim of “100% secure” or “all functions work” follows from this evidence.

## 3. Work packages

### A. Authentication and reliable history — priority high

**Problem:** transient authentication errors can strand Journal loading; stale asynchronous results can outlive the session that requested them.

Proposed work:

1. Reproduce the cloud failure using read-only requests and sanitized diagnostics. Record request timing, server response code, token issue/expiry offsets and refresh events without recording tokens, passwords or full personal identifiers.
2. Distinguish client clock error, issuing-service/validator clock differences, stale access tokens and application lifecycle races. Do not assume a root cause from the message alone.
3. Bind history loading to the current authenticated session. Discard responses from older sessions; prevent initial session lookup from overwriting a newer sign-in/sign-out event.
4. Reload history on a legitimate token refresh. Add an explicit recovery path for persistent failures and settle loading indicators after network errors.
5. If evidence supports transient validator skew, permit at most one delayed retry of an idempotent history read. This is a mitigation, not proof that the clock defect is fixed. Never apply it to order submission or other writes; never relax signature or expiry validation.
6. Test expired, revoked, anonymous, malformed and unavailable authentication responses. Verify local trading authority expires/pauses without cancelling broker-held protection.
7. Decide the required revocation guarantee explicitly. If immediate revocation is required, implement server-side session-validity checking appropriate to the deployed Supabase project, rather than claiming JWT validation alone proves a session still exists.

**Pass condition:** no stale-session data or action authority survives a session change; recovery works without an unnecessary page reload; persistent errors remain visible; the root cause is resolved or explicitly retained as an open gate.

### B. User/account/environment isolation — priority high

Proposed work:

1. Inventory all drafts, presets, reviews, associations, cached snapshots, requests and approval records. Record their user/account/environment ownership keys.
2. Clear or hide previous-scope data synchronously during identity changes, before replacement requests complete.
3. Reject late load/save/import responses belonging to another session. Cancel pending reads where supported; retain evidence of uncertain writes without retrying them.
4. Test the same user switching accounts, different users on the same browser, demo versus authenticated use, and disconnected/reloaded states.
5. Retain unscoped legacy data. Provide explicit, previewable imports where needed; never silently assign it to the currently signed-in account or overwrite existing scoped records.
6. Repeat deployed ownership checks through the actual REST/authentication path with controlled test identities. Test select, insert, update, delete and ownership reassignment. SQL-only policy checks are supporting evidence.
7. Test every local broker endpoint for missing/expired authentication, wrong owner, wrong account and disallowed origin. Include concurrent requests and malformed bodies.

**Pass condition:** wrong-scope requests are denied and wrong-scope records never render, including briefly during loading or after a delayed response. Original legacy records remain recoverable.

### C. Complete saved-plan evidence — priority high

Proposed work:

1. Define a versioned saved-plan schema covering symbol/direction, entry and stop inputs, stop method, sizing inputs and basis, market reference/provenance, session settings, targets, both runners, breakeven and save time.
2. Retain full calculation precision. Distinguish legacy planning equity, stale estimates and freshly verified broker funds.
3. Persist the complete reviewed revision in the private store, scoped to verified identity/account/environment. Use a server-computed canonical content digest; do not trust a client revision label as proof of content.
4. Check the execution ticket against the saved record. A price, quantity, direction, allocation, account or relevant setting change invalidates the previous review.
5. Make repeated identical requests idempotent. Reject reused revision/command identities with different content, including concurrent submissions.
6. Preserve historical records without inventing missing fields. Require a new complete save before reviewing an incomplete legacy draft.
7. Clearly distinguish machine-generated acceptance evidence from a customer-saved planner record. Both must use the same execution validation and approval safeguards.
8. Decide and document whether Save plan itself is durable on the server or remains explicitly local until review. In either design, reviewed/approved content must survive browser-storage loss and service restart.

**Pass condition:** every newly reviewed order resolves to an immutable, complete, correctly scoped plan; the original values remain auditable after restart; tampering or changed content is rejected before transmission.

### D. Position/Journal accounting integrity — priority high

Proposed work:

1. Confirm both views derive quantities, execution prices, commissions, net realized P&L and Execution R from the same economic-event projection.
2. Test duplicate/reordered callbacks, equivalent timestamp/number formatting, late commissions and conflicting quantities/prices/ownership.
3. Keep missing fees, missing risk, incomplete executions and unavailable timestamps distinct. Do not turn unknown values into zero.
4. Ensure one quarantined conflict cannot silently suppress unrelated account history. The affected campaign must remain visibly unresolved.
5. Test reload/restart and late-fee updates without duplicate Journal rows or changed campaign identity.
6. Verify flat quantity, cleared owned orders and complete accounting separately; no single label should imply all three without evidence.
7. Run a read-only comparison against preserved historical campaign evidence. Do not manufacture broker events or replay them into the live ledger merely to create a pass.

**Pass condition:** Position and Journal agree within documented currency/price precision for every fixture, and actual preserved broker records match their recorded executions and fees. Simulator evidence stays labelled deterministic.

### E. Dependencies and cloud security — priority high

Proposed work:

1. Inventory exact production and test dependencies, including the externally installed IBKR SDK. Record provenance and hashes where available.
2. Evaluate an official SDK/runtime combination containing the protobuf fix. Install trials only in an isolated environment and verify dependency consistency, protocol compatibility and relevant adapter regressions.
3. Do not force a conflicting protobuf upgrade, rewrite SDK metadata or hide an audit finding. If no supported fix exists, document the vendor dependency and retain the release gate. A reachability assessment may refine risk but is not a silent waiver.
4. Re-run JavaScript and Python audits and a scoped secret-exposure scan. Check generated client assets and logging, not only tracked source.
5. Enable and verify compromised-password protection through the supported Supabase configuration when access and subscription entitlement are established. Do not change plan/billing silently.
6. Validate enforced CSP, framing/content-type protection and no-store behavior on successful and failed authenticated responses. Confirm the policies do not break the normal trading workflow.

**Pass condition:** no unaddressed high-risk dependency/configuration finding affects the launch subset; results include exact versions, audit date, exclusions and compatibility evidence. Unavailable fixes remain explicit blockers.

### F. Private storage and permissions — priority high

Proposed work:

1. Inventory owner binding, runtime configuration, verification files, database/WAL files, backups and logs without printing their secrets.
2. Separate development-tool access from the intended production operating identity. Define a dedicated private runtime/backup location and its required principals.
3. Prepare a reversible ACL migration: preserve current permissions, validate exact target paths and identities, apply only to intended files, and verify access afterward.
4. Preserve necessary system/service access. Do not remove Codex/platform grants blindly from the active development environment.
5. Test that the intended runtime can read/write and restore its data while an unrelated user cannot read or modify it. Check inheritance for newly created databases, WAL files and backups.
6. Keep credentials out of browser responses, logs, repository commits and diagnostic exports. Recheck the deployed build and backup handling.

**Pass condition:** access rules and actual access tests demonstrate least privilege for the intended installation; backups inherit appropriate protection; an ACL rollback is available. An ACL listing alone does not pass this gate.

## 4. Recommended sequence

| Iteration | Deliverable | Exit evidence |
| --- | --- | --- |
| 1A — establish the boundary | Sanitized auth reproduction, storage/ownership inventory, dependency compatibility decision and permissions design | Named root causes or explicit external blockers; agreed data ownership and revocation requirements |
| 1B — identity and history | Session-safe loading, recovery and account isolation | Negative authentication/ownership tests, stale-response tests and direct browser checks |
| 1C — records and accounting | Complete immutable plan revisions and unified accounting checks | Tamper/idempotency/concurrency tests, restart evidence and Position/Journal comparison |
| 1D — security closure | Supported dependency/configuration changes and private-storage hardening | Clean consistency checks, scoped audits, actual access-denial tests and rollback evidence |
| 1E — acceptance review | Exact-source verification report and remaining-gate decision | Focused regressions, full repository verification and direct frontend review; all findings explicitly dispositioned |

Investigations in 1A may expose external dependencies before code work starts. Do not promise a completion date until SDK support, cloud configuration access and the intended production identity are known.

## 5. Minimum acceptance matrix

| Area | Required cases |
| --- | --- |
| Authentication | Valid; expired; revoked; anonymous; malformed; validator-clock error transient/persistent; unavailable identity service; refresh during loading |
| Isolation | User A → B; A → signed out; account A → B; demo → authenticated; delayed prior-user read/write response; storage restored on another account |
| Plan evidence | Complete save; missing legacy fields; changed price/quantity/exit settings; reused revision; concurrent identical/different requests; restart after approval |
| Accounting | Open/partial/closed; negative result; unknown/late fees; duplicate/reordered execution; conflicting event; missing timestamp/risk; no duplicate Journal row |
| Permissions/security | Wrong-user file access; backup/WAL inheritance; malformed/cross-origin endpoints; response headers; credential exposure; dependency compatibility |
| User interface | Normal controls only; loading/empty/error/stale distinction; desktop/mobile; keyboard and focus; draft preservation; account-switch state |

Use disposable fixtures/accounts for destructive and revocation tests. Never sign the user's active session out merely to obtain evidence without making that disruption concrete first.

## 6. Release and delivery rules

- Preserve the active ledger, raw callbacks, unrelated orders/positions and protected checkouts.
- No broker orders, submission unlock, live-mode changes, push, merge or deployment belong to this step.
- The previous automatic approval rejection for enabling submissions remains in force. Nothing in this plan bypasses it.
- Verify locally with the repository's selected runtime. Run focused regressions while iterating and `npm run verify` before a code handoff. Use frontend-verification for changed flows and report the exact served source identifier.
- Do not accept screenshot baselines automatically.
- Report automated checks, direct observations and untested/external gates separately.
- Deliver a scoped local commit only after implementation is requested again, plus a finding-by-finding evidence report. Passing step one permits consideration of the next stage; it does not authorize live trading.

## 7. Decisions to settle before implementation resumes

1. **Saved-plan durability:** recommended: preserve explicit local draft saving and make the complete reviewed plan durable server-side before approval; label these two states clearly.
2. **Revocation:** recommended for future live execution: require current server-confirmed session validity on sensitive actions and fail closed when it cannot be established. Document the authority lease for managed rules separately.
3. **Private installation:** recommended: a dedicated production runtime/data identity and location, separate from development-tool grants. Determine the actual Windows account/service arrangement before ACL changes.
4. **Unpatched SDK:** recommended: retain a no-go finding until a supported fix or independently reviewed, explicit risk decision exists. Do not let the trade count substitute for this decision.
5. **Cloud settings:** establish dashboard/configuration access and entitlement for password protection; surface any cost or account-level change before performing it.

These are decision points in the plan, not requests to change configuration now.

## 8. Work already started before the planning correction

Implementation was started before the user clarified that this should be a plan document first. The September 20 implementation resumption reviewed and completed those candidates within the Step 1 scope. They have not been pushed, merged, deployed or used to place broker orders.

Candidate changes are in:

- `app/TradePlanner.tsx`, `app/page.tsx`, `app/usePaperExecution.ts` — planner snapshot capture and session-scoped state/recovery.
- `lib/auth-ready.ts`, `lib/paper-execution.ts` — bounded history-read recovery and saved-plan typing.
- `services/eod/src/brontide_eod/paper_auth.py`, `paper_service.py`, `paper_test_session.py`, new `paper_plan.py` — identity input handling and saved-plan checks/evidence.
- `services/eod/tests/test_paper_auth.py`, `test_paper_lifecycle.py`, `test_paper_readiness.py`, `tests/auth-ready.test.mjs`, `tests/ui/paper-ui.spec.ts` — focused regression candidates.
- `next-env.d.ts` — generated by the test server; not an intended product change.

Before the correction, focused checks reported 11 Node and 45 backend passes. A previously launched three-case browser run finished with three passes while the stop was being handled. These checks do not establish final-source readiness: additional edits occurred during the work, the full suite was not run, and the changed interface was not directly reviewed against a matching served preview. No further implementation or validation run is authorized by this planning document.

On a later implementation request, inspect these candidates against the accepted plan first; do not assume they should be retained unchanged. No edits have been discarded automatically.

## References

- [Current readiness gates](testing/trading-readiness.md)
- [Local verification requirements](testing/local-verification.md)
- [Supabase session and revocation guidance](https://supabase.com/docs/guides/auth/sessions)
- [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Official IBKR API downloads](https://interactivebrokers.github.io/)
- [Python advisory PYSEC-2026-1805](https://github.com/pypa/advisory-database/blob/main/vulns/protobuf/PYSEC-2026-1805.yaml)

## 9. Implementation checklist — September 20, 2026

This checklist distinguishes implemented local controls from evidence that is blocked or still pending. A checked implementation item is not a live-readiness approval.

### Authentication and isolation

- [x] Prevent initial session lookup from overwriting a later authentication event.
- [x] Reload Journal history when the access token refreshes; discard superseded reads and writes.
- [x] Retry only an idempotent Journal read, once, after the specific `JWT issued at future` response. Persistent rejection stays visible and has an explicit retry control.
- [x] Hide prior-user Journal records synchronously and scope planner, presets, positions, reviews and paper snapshots by the available user/account/environment identity.
- [x] Require server validation of the Supabase user on every local paper endpoint, enforce the installed owner/account binding and expire application-managed authority after its short lease without cancelling broker-held protection.
- [x] Add user/account/environment ownership keys to newly created paper batches, campaigns and immutable plan revisions. Existing account-bound legacy ledger evidence remains preserved and readable only through the installed local owner boundary; it is not silently rewritten.
- [ ] Reproduce and identify the intermittent cloud validator-clock root cause. The bounded retry is only a read mitigation.
- [ ] Repeat deployed REST ownership and revoked-session tests with disposable identities. The prior rolled-back SQL policy result remains supporting evidence only.

### Immutable plan evidence and accounting

- [x] Capture a version-2 saved plan containing entry/stop inputs, stop method, requested quantity/cap, sizing inputs and explicit fresh/stale/legacy basis, price provenance, market snapshot, session policy, all target/runner rules, breakeven and timezone-qualified save time.
- [x] Validate the saved plan again on the local server, bind every execution-relevant value to the reviewed ticket and persist server-computed plan/ticket digests under the verified user/account/paper scope.
- [x] Reject incomplete legacy plans, tampering, changed revisions and concurrent reuse of one revision for different content. Identical repeats remain idempotent.
- [x] Keep machine-generated acceptance evidence explicitly labelled while routing it through the same ticket validation and approval locks.
- [x] Retain the shared Position/Journal economic projection and focused coverage for duplicate/reordered executions, late and missing fees, missing risk/timestamps, conflicting evidence, restart identity and unrelated-campaign survival.
- [ ] Obtain fresh broker observations for repaired protection/reconnect/concurrency and separately prove flat quantity, cleared owned orders and complete accounting. No broker action is authorized in Step 1.

### Dependencies, cloud configuration and private storage

- [x] Record the installed official `ibapi` 10.50.2 metadata, its exact protobuf 5.29.5 pin, installed-package record hashes, dependency-consistency result and current Python audit result.
- [x] Re-run a scoped tracked/generated-client secret-pattern scan; the only tracked matches are a dummy verification value, the empty example and configuration identifiers.
- [x] Inventory the current private runtime tree and ACLs read-only, and document an exact, reversible Windows ACL migration and access-test procedure in [Private paper-storage installation](trading/PRIVATE_STORAGE.md).
- [ ] Resolve PYSEC-2026-1805 with an official supported IBKR SDK/runtime. The current official latest remains API 10.50 and pins the affected protobuf; no conflicting upgrade or metadata rewrite was applied.
- [ ] Re-run the JavaScript audit when the npm advisory endpoint recovers. The September 20 request returned HTTP 503 maintenance rather than a vulnerability result.
- [ ] Enable and verify Supabase compromised-password protection after dashboard entitlement and account-level approval are established.
- [ ] Select the production Windows runtime identity and dedicated runtime/backup paths, then perform the documented ACL apply/deny/restore tests. Development-platform grants were intentionally not removed from the active environment.

### Verification and delivery

- [x] Focused checks: 16 Node accounting/auth checks, 86 backend paper/auth/readiness checks and 19 normal-flow paper UI checks passed; TypeScript passed.
- [x] Complete `npm run verify` on the final candidate source: 204 Node tests passed with 2 skipped, 273 backend tests passed with 2 deprecation warnings, TypeScript passed, 66 browser tests passed with 3 skipped, and the production build passed. No screenshot baselines changed.
- [x] Complete direct frontend verification of the available normal demo controls against served preview `611b72e5+d.3c34d6a8` at `http://127.0.0.1:3000/?demo=1`: desktop/mobile/desktop, draft invalidation and retention, Journal expansion, dialog keyboard dismissal/focus return, responsive overflow and console checks passed.
- [ ] Directly repeat the cloud error/retry and real user/account-switch paths with disposable authenticated identities. Automated browser regressions cover the visible recovery and stale-response behavior, but no suitable credentials were used for direct inspection.
- [x] Create the scoped local commit and record its exact SHA in the review handoff. Do not push, merge or deploy without a later exact-SHA approval.

## 10. Local-first closure continuation — September 20, 2026

This section supersedes earlier delivery-state wording without erasing the historical evidence above. Work resumes from merged baseline `f21e8a7ef2eb490d25036356eb66dad3a38fe871` on branch `codex/local-first-security-closure`. The public Pages application is now explicitly out of scope and authorized for removal. Future publishing remains a separate approval.

### Already implemented and retained

- [x] Session-safe Journal reads, one bounded retry for the specific validator-clock read failure, explicit persistent-error recovery, and stale read/write suppression.
- [x] User/account/environment scoping for browser state and new paper records, plus preservation of unscoped legacy evidence without silent reassignment.
- [x] Complete version-2 saved-plan evidence, server-side validation and digests, tamper/concurrency rejection, and shared Position/Journal accounting regressions.
- [x] Submission approval remains locked. The rejected automatic approval, halted session, historical target of 200, two recorded completions and F protection failure remain unchanged.

### Ordered closure work and evidence standard

1. **Remove public hosting first.** Inspect the currently published Pages artifact for private data and privileged credentials; a browser Supabase publishable key is expected public configuration, not by itself a secret leak. Disable the deployment workflow before any other implementation, cancel queued/running deployments, delete the Pages site through the supported GitHub API, and verify both the Pages API and public URL report that hosting is unavailable. Replace automatic `main` deployment and automatic Pages enablement with a manual-only workflow that fails closed unless a later explicit enablement variable and separate approval are present.
2. **Close cloud identity evidence where access permits.** Use only disposable users and disposable rows for authenticated REST select/insert/update/delete/reassignment, user A/B isolation, revocation and browser transition testing. Preserve real records. Record sanitized token timing and request outcomes without tokens, passwords, emails or full identifiers. Never retry a write and do not relax signature, issuer, expiry or ownership validation. Treat missing dashboard/API entitlement as an external blocker.
3. **Repeat supported dependency/configuration checks.** Re-run npm and Python audits, dependency consistency, official SDK compatibility evidence and generated-asset secret scans. Apply only vendor-supported changes. Inspect compromised-password protection and surface any paid/account-level change before applying it.
4. **Perform the private-storage migration operationally.** Use the current interactive Windows identity only after recording it explicitly. Select dedicated literal runtime and backup paths outside the repository and cloud-synchronised locations; preserve the original tree and ACL rollback file. Prove runtime read/write, WAL inheritance, backup integrity/restore and access denial from a genuinely distinct disposable Windows identity. If elevation or a disposable identity is unavailable, stop with that gate open rather than treating an ACL listing as proof.
5. **Verify the authenticated local application.** Serve the exact intended source and exercise ordinary Plan, Positions and Journal controls with disposable authenticated sessions: user/account transitions, stale responses, disconnected history, draft preservation, review invalidation and accounting agreement. Demo-only evidence is supporting evidence, not an authenticated pass.

### Current checklist

- [x] Published artifact inspected without exposing secret values: the final Pages artifact contained the expected browser publishable key and public research/demo data, but no privileged credentials, JWTs, private-key material, private runtime paths or broker execution records.
- [x] Pages workflow made manual and fail-closed; automatic `main` deployment and automatic enablement removed. The remote workflow is also `disabled_manually`; future publication requires a separate workflow re-enable, repository enablement variable and approval reference.
- [x] No queued or running Pages deployment remained to cancel. The GitHub Pages site was deleted through the supported API; the Pages API and a cache-bypassed public request both return 404.
- [ ] Disposable deployed ownership, account-isolation and revocation matrix completed through the real authentication/REST path.
- [x] Validator-clock failure retained explicitly as unresolved with sanitized evidence and the bounded read-only mitigation unchanged. Windows reports a successful `time.windows.com` synchronization; five Supabase Date-header samples were within 0.75 seconds of the local midpoint, and two-day Auth, PostgREST and gateway log searches contained no matching error. This rules out a persistent machine-wide offset but does not identify the intermittent cause.
- [x] JavaScript/Python audits, consistency checks and generated-output secret scan repeated. npm and the repository Python environment are clean; the active official IBKR environment still has the protobuf advisory that cannot be fixed without violating the current SDK pin, so it remains a blocker.
- [x] Compromised-password protection inspected without mutation. It is disabled and available only on Supabase Pro while this project is on Free; an account upgrade requires separate approval.
- [ ] Dedicated Windows runtime/backup paths and operating identity recorded; backup/WAL inheritance and restore are proven, but distinct-user access denial and active-service cutover remain open. See the private-storage runbook for the exact partial evidence.
- [ ] Exact-source authenticated Plan/Positions/Journal browser matrix completed; automated, direct and skipped evidence reported separately.
- [x] Focused checks and final `npm run verify` passed without baseline updates: 204 Node tests passed with 2 skipped; 269 backend tests passed with 4 skipped and 2 deprecation warnings; TypeScript passed; 66 browser tests passed with 3 skipped; production build passed.
- [x] Scoped local commit contains this checklist; its exact SHA is reported in the out-of-band review handoff because a commit cannot contain its own identity. Do not push, merge or deploy without later, separate approval.

## 11. Remaining verification work package — September 20, 2026

This work package is verification-first and does not reopen deployment, broker submission, acceptance-target or live-mode work. It starts from local commit `edefd2cd63457695a315c4c09a169bf2d41a3e9b` on `codex/local-first-security-closure`. Existing owner records, the halted session, its approval history, private data, generated evidence and unrelated working-tree files remain out of scope for mutation.

### Disposable cloud identity procedure — completed within authorization

The target was the hosted Supabase project **trading-journal** (`fsccmouzyfgcpqlmcngu`). After explicit creation authorization, two disposable users were created through the dashboard's **Create new user** operation with auto-confirmation, not **Send invitation**, using non-deliverable reserved-domain addresses. The dashboard stated that no confirmation email would be sent. Random passwords and bearer tokens remained ephemeral and were not written to the repository or evidence report. After testing and fixture cleanup, the operator separately authorized deletion of exactly the two recorded UUIDs. Their UUID/address pairs were checked against the creation evidence before deletion, only those two rows were selected, the dashboard reported successful deletion of two users, and exact-UUID searches returned **No users found / Total: 0** for each. The real owner remained the sole visible unfiltered row.

After authorization, the procedure is:

1. Record the two returned user UUIDs in transient test notes and use a unique `step1-<UTC timestamp>-<random suffix>` fixture marker. Do not inspect, rebind, sign out or otherwise change the real owner's session.
2. Authenticate each disposable user through the deployed Auth endpoint with the browser publishable key. Record only sanitized status, token issue/expiry times and session identifiers or hashes.
3. Through the deployed REST endpoint, insert exactly one `public.trades` row for each user using the normal schema: unique marker in `symbol`/`setup`, valid Long/Short side, disposable date and numeric accounting fields. Record the returned row UUIDs. No real trade, broker or paper-session row is used.
4. For A and B independently, verify own-row select/update/delete visibility; cross-user UUID selects return no row; cross-user update/delete affect no row; and explicit insert or ownership reassignment to the other user's UUID is rejected by RLS. Re-read both owned rows after every negative case. Writes are issued once only—an uncertain write is never retried.
5. Exercise the ordinary signed-in local Journal controls with A and B: sign-in/sign-out/sign-in transitions, per-user empty/owned history, draft/review separation and a delayed A response arriving after the interface has moved to B. Use the existing Plan, Positions and Journal controls only. REST probes remain test evidence, not an alternate trading interface. Same-user account/environment separation is checked only in the local paper state where those boundaries exist; the legacy `public.trades` table has a user boundary but no account/environment columns.
6. Refresh a disposable session through the supported Auth refresh flow and verify the refreshed token retains only its owner's access. Revoke one disposable session without changing the real owner. Probe Auth and read-only REST at recorded intervals until rejection or JWT expiry, reporting the observed window rather than assuming immediate invalidation. Do not retry any write. An expired token and a malformed token must fail closed.
7. Cleanup is limited to the two recorded fixture row UUIDs and the two recorded disposable Auth UUIDs. First verify the fixture marker/owner pair, delete each fixture once with its owner context, and confirm both UUIDs are absent. Then revoke disposable sessions. Account deletion is a separate destructive action and will receive an action-time confirmation before deleting exactly those two UUIDs. Confirm no fixture rows remain. No invitation or other email operation is part of cleanup.

The procedure above is retained as the audit trail. The executed outcomes and limitations are recorded in `output/trading-readiness-delivery.md`; the missing real-expiry observation and unsupported same-user account/environment transition remain open rather than being inferred from the completed disposable-user cleanup.

### Windows access, dependency and external-gate procedure

- Inspect the prepared literal runtime and backup paths and their current ACLs without changing them. Identify a real enabled non-owner local Windows account before any denial test. The elevated operator procedure must preserve the ACL export, remove inheritance only on the two intended Brontide private directories, retain the owner and required SYSTEM/Administrators access, and validate owner read/write/delete/list plus non-owner read/write/delete/list denial. The active service, broker connection and source tree are not cut over in this package.
- Verify backup restoration only into a new literal scratch path under the protected backup root, compare integrity/counts with the preserved source, and remove only that disposable restore after evidence is recorded. Cutover and rollback remain a separate reviewed operation.
- Distinguish the clean repository Python audit environment from the operator-installed official IBKR SDK environment. Inspect the latter's exact interpreter, `ibapi`/protobuf versions, metadata constraints, consistency and audit outcome. Review every skipped backend test so optional SDK absence is not presented as executed adapter coverage. Check current official remediation only; do not alter pins or metadata.
- Record the exact Supabase plan/configuration requirement for compromised-password protection without purchasing or changing it. Continue only read-only validator-clock investigation; absence of a reproduction is not resolution and neither token validation nor write behavior may be weakened.

### Delivery evidence checklist

- [x] Two disposable cloud users explicitly authorized, created without email, tested and deleted with action-time confirmation; both exact UUID searches returned no users afterward and the real owner was not selected or changed.
- [ ] Deployed REST ownership/reassignment and refreshed/revoked-session outcomes are recorded without secrets. Anonymous and malformed tokens failed closed. Auth revocation was immediate, but the already-issued one-hour access JWT continued to authorize its own read for the full 30.3-second observation; actual expiry was not awaited and remains unverified.
- [ ] Signed-in local A/B transitions were observed through ordinary controls against preview `edefd2cd+d.dc895c42`: history stayed isolated, an A plan restored after A→B→A, review state invalidated on the scope change, a delayed A request was canceled fail-closed, and disconnected history recovered through Retry. A delivered late response after the switch is automated-only evidence, and same-user account/environment switching is unavailable to these cloud-only fixtures.
- [x] Runtime/backup ACLs were directly inspected. The shell is non-elevated and no suitable disposable Windows identity exists, so distinct-user denial was not executed; the exact literal-path elevated procedure and missing `MELVIN\BrontideAclProbe` identity remain open in the private-storage runbook.
- [x] Repository and operator IBKR dependency environments were reconciled; the four normally skipped SDK-dependent backend cases passed when run against the active operator environment with mocked transport.
- [x] Compromised-password subscription/configuration and validator-clock status are reported without mutation or overclaim. The Pro-or-higher protection gate and unexplained intermittent clock error remain open.
- [x] Focused SDK checks and authenticated direct browser verification were completed and reported separately. No executable or rendered source changed in this package, so the already-current full `npm run verify` result was carried forward and the frontend-verification implementation workflow was not rerun.
- [x] Scoped documentation is committed locally; the exact SHA and clean post-commit preview identifier are reported in the review handoff. No push, merge or deployment.

## 12. COORD-02 identity-boundary review — September 20, 2026

This bounded package starts from `746b25ec8b999520cbaecd990f4a7ea86e2cd194` on `codex/local-first-security-closure`. It reviews existing authentication and isolation guarantees without creating cloud users, changing cloud configuration, touching the installed owner binding, connecting to TWS, restarting services or exercising broker actions. Existing unrelated and generated working-tree files remain outside the scoped commit.

### Questions and evidence standard

1. Map Journal cloud reads, local paper endpoints, exact-order review state and managed paper authority to the identity check they perform, their revocation/expiry behavior, and their residual exposure. The observed Supabase behavior is the starting fact: Auth rejected the revoked session after 0.2 seconds, while PostgREST continued to accept its already-issued one-hour JWT through the 30.3-second observation window.
2. Inspect deterministic coverage for same-user paper account/environment changes, a prior-session response that actually resolves after a transition, review expiry and managed-authority expiry. Add only missing isolated fixture/mock regressions, and distinguish those tests from real token-expiry, real account-transition and broker evidence.
3. Fix only demonstrated defects within the existing authentication/isolation design. Do not add a parallel cloud authorization architecture, weaken token validation, retry uncertain writes or alter the submission-policy block.

### COORD-02 checklist

- [x] Boundary matrix records validation, revocation/expiry guarantee, tests and residual limits for Journal reads, local paper endpoints, order reviews and managed authority.
- [x] Same-user account/environment coverage now proves account-binding selection and rejection of non-paper records with isolated service fixtures. The only enabled execution environment remains paper; live configuration fails closed.
- [x] A prior-user Journal response is held until after sign-out and sign-in as a second user, then allowed to resolve; the regression proves it cannot replace the second user's row.
- [x] Expired order review and expired 60-second managed-authority lease both fail closed, clear in-memory authority and perform no real broker action.
- [x] Focused checks passed: 43 authentication/readiness backend tests and 20 paper UI tests. Because test-harness source changed, full `npm run verify` passed all five stages. No rendered behavior changed, so a separate frontend-verification implementation review was not triggered.
- [x] The evidence report separates deterministic coverage from real token-expiry, account-transition and broker evidence; external gates remain open.
- [x] Scoped tests and documentation are committed locally; the exact SHA/source identifier is reported in the review handoff. No push, merge or deployment.

### Independent review follow-up — September 21, 2026

- [x] Correct the late-response browser proof: wait for A's response to finish, observe its body consumption in the browser, then yield through the consuming promise continuations and render frames before checking B remains visible. Immediate already-true assertions were insufficient evidence.
- [x] Prove sensitivity in a disposable checkout: removing stale-response guards makes the final B-visibility assertion fail after response processing; restoring the original source makes the same test pass. Active application source is unchanged.
- [x] Focused ordinary paper UI checks: 20 passed. No screenshot baseline changed.
- [x] Required full verification passed all five stages in 854.2 seconds: 204 Node passed / 2 skipped; 272 backend passed / 4 skipped / 2 known warnings; TypeScript passed; 67 browser passed / 3 skipped; production build passed. The reviewed local commit is reported separately in the handoff.
- [ ] Disposable proof-checkout cleanup: automatic approval review rejected cleanup as `blocked by policy`; preserve the restored-source temporary checkout and do not retry or route around the rejection.

These checks strengthen deterministic evidence only. The existing external, real-session, broker and live-release gates remain open.

## 13. COORD-03 restore rehearsal and acceptance preparation — September 21, 2026

This package uses isolated synthetic databases and the existing fake transport only. It does not touch private runtime data, services, cloud identities, ACLs, broker connections, submissions, the historical session target or deployment. It strengthens recovery evidence without closing operational or broker gates.

- [x] Restore a synthetic ledger to a new path and compare complete objects, commands, events and schema; preserve immutable saved-plan evidence and the original database.
- [x] Prove restored authority is not automatically rearmed, uncertain commands are not retransmitted, duplicate/reordered callbacks are idempotent and late fees update accounting once while unrelated campaigns survive.
- [x] Add a dated normal-control acceptance overlay to the existing historical matrix and supersede legacy enablement instructions with the independent policy block.
- [x] Reconcile historical readiness wording with the completed disposable identity and COORD-02 evidence; retain exact external gates.
- [x] Focused readiness/lifecycle checks: 67 passed, 4 optional-SDK skips and 2 known warnings. Final full verification passed all five stages in 752.5 seconds: 204 Node passed/2 skipped; 274 backend passed/4 skipped/2 known warnings; TypeScript passed; 67 browser passed/3 skipped; production build passed. No baseline updates. Real broker, Windows denial/cutover and signed-in expiry evidence remain separate open gates.

No new public API, recovery endpoint or alternate order form is planned. Distinct-user Windows denial, active cutover/rollback, vendor SDK remediation, paid password protection, real token-expiry/account-transition observations, intermittent clock diagnosis and fresh broker acceptance remain external or separately gated work.

## 14. Phase 1 final security checks — September 21, 2026

The user approved this bounded execution package from `8611ff4d48cca94f7846423112f5c139db1caacb`. Work is on `codex/phase1-final-security-checks`. The user is available for narrow elevated Windows operator steps and explicitly chose **no paid upgrade**. Existing unrelated changes and private records remain preserved.

| Item | Work and acceptance | Current status |
| --- | --- | --- |
| Windows protection | Exact private roots, harmless sentinels, owner success and genuine standard-user list/read/write/delete denial; account cleanup separately confirmed | Owner-positive check passed unelevated at 11:26:54 UTC; distinct-user proof awaits the user's elevated operator run and separate cleanup |
| Protected storage | Exact cutover/configuration/backup/rollback operator checklist; do not enact cutover or restart | Preparation passed: runbook updated; actual cutover and rollback remain blocked/separately gated |
| Compromised-password protection | Preserve no-upgrade decision; no billing or authentication setting change | Deferred, not passed |
| Broker dependency | Official package metadata and separate repository/operator audits; no unsupported pin override | Blocked: official 10.50.2 still pins affected protobuf 5.29.5; repository audits passed, operator audit failed |
| Real login expiry | One bounded disposable session, empty own-scope read, observed JWT expiry without automatic refresh or project lifetime change, recovery and verified cleanup | Blocked before creation: dashboard blank and no connector Auth-admin create operation; no user/session created, observation not started |
| Validator clock | Sanitized session timing and bounded reproduction investigation; no reproduced failure is not resolution | Unresolved: three public Auth-health timing samples are not JWT-validator clock proof |

No application behavior change is assumed. Fix only demonstrated in-scope defects. Documentation-only evidence updates need targeted checks; executable/test-harness changes require full verification, with frontend verification for visible behavior changes. No push, merge, deployment, broker connection/action, submission unlock, target amendment, active-service restart/cutover or retry of rejected cleanup is authorized. Any unresolved gate remains explicit in the final readiness decision.
