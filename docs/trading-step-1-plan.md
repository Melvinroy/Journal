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
