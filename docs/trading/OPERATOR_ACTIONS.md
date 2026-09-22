# Phase 1 operator actions — do later

Prepared September 22, 2026. This is a checklist, not authorization to execute it. No action is requested from the user during the independent closure package. Phase 1 and live readiness remain incomplete.

Use the [Phase 1 plan](../trading-step-1-plan.md), [private-storage runbook](PRIVATE_STORAGE.md) and [delivery evidence](../../output/trading-readiness-delivery.md) together. Each future result must identify UTC time, checkout/commit, execution context and pass/fail/blocked outcome. Never retain passwords, bearer tokens, private configuration contents or raw financial records in this public repository.

## A. Resolve storage visibility first — blocked

**Why:** the agent reported private folders that the user's normal and elevated PowerShell both cannot see. Matching account/hostname does not prove identical filesystem views. The existing ACL probe is suspended; do not recreate a missing directory just to make it pass.

**Prerequisite:** access to the normal desktop shell and agent shell at the same time. No elevation or service change is needed for this diagnosis.

**Procedure, once resumed:** run the following read-only block in each context and label each output with its origin. It prints only identity, runtime, path existence and a source-file hash.

```powershell
[DateTime]::UtcNow.ToString('o')
whoami /user
hostname
$PSVersionTable.PSVersion.ToString()
[Environment]::Is64BitProcess
$env:LOCALAPPDATA
Get-PSDrive C | Select-Object Name,Root,DisplayRoot
Get-Volume -DriveLetter C | Select-Object DriveLetter,FileSystem,UniqueId
foreach ($scope in @('Process','User','Machine')) {
  foreach ($name in @('BRONTIDE_PAPER_DATABASE','BRONTIDE_PAPER_OWNER_FILE','BRONTIDE_IBKR_VERIFICATION_FILE')) {
    [pscustomobject]@{Scope=$scope; Name=$name; Path=[Environment]::GetEnvironmentVariable($name,$scope)}
  }
}
foreach ($candidate in @(
  'C:\Users\melvi\Projects\Journal',
  'C:\Users\melvi\AppData\Local\Brontide',
  'C:\Users\melvi\AppData\Local\BrontidePrivate',
  'C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime',
  'C:\Users\melvi\AppData\Local\BrontidePrivate\Backups'
)) {
  try {
    Get-Item -LiteralPath $candidate -Force -ErrorAction Stop | Select-Object FullName,Attributes,LinkType,Target
  } catch {
    [pscustomobject]@{Path=$candidate; Category=$_.CategoryInfo.Category; ErrorType=$_.Exception.GetType().FullName}
  }
}
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Users\melvi\Projects\Journal\services\eod\src\brontide_eod\paper_store.py'
```

Then inspect the identified service launch configuration locally for **only** `BRONTIDE_PAPER_DATABASE`, `BRONTIDE_PAPER_OWNER_FILE`, `BRONTIDE_IBKR_VERIFICATION_FILE` and its runtime identity/checkout. Do not print whole environment files or process command lines. Record whether each value is explicitly configured or derived from a default. An agent-shell variable is not proof of a running service's setting. If process configuration cannot be established read-only, stop and record it as unknown.

**Expected:** a supported explanation and an operator-visible source/destination map. Identical source hashes alone do not prove shared private storage. If views still differ, keep this gate blocked; do not choose an alternative directory by guesswork.

**Retain:** sanitized paired outputs, relevant configuration path provenance, and the original contradictory screenshots. These do not establish that records are lost.

## B. Windows file protection — waits for A

**Why:** demonstrate that the intended owner can use private files and a genuine unrelated standard user cannot.

**Prerequisites:** A resolved, exact roots/SID reviewed, narrow administrator session available, and no pre-existing `BrontideAclProbe` account. Inspect the local helper against the resolved paths before execution. Do not substitute the repository folder for private storage.

**Procedure:** follow the September 21 harmless-file procedure in the private-storage runbook. Run the reviewed helper once as the named owner in elevated Windows PowerShell. Capture list/read/create/modify/delete results for both roots under the standard test identity. Recheck normal non-elevated owner access afterward. Missing paths, inability to launch the child, or other errors are inconclusive, not denial passes.

After review and exact-account deletion confirmation, remove only the recorded test SID/account and exact run-ID sentinel/probe files. Check for any remaining test process before cleanup. Never remove platform-managed users or recursively delete a private root. Confirm account and fixture absence and owner access afterward.

**Expected:** ten explicit access denials, genuine normal-owner success, unchanged sentinels/ACLs and verified cleanup. **Retain:** sanitized JSON, identity/SID, run ID, timestamps and cleanup proof. The earlier failed root lookup created no account or fixture.

## C. Protected-storage cutover and rollback — separate operation

**Why:** put the real service on verified storage without losing ledger history.

**Prerequisites:** A and B pass; exact active runtime/configuration identified; explicit cutover approval and safe maintenance window; independent broker restrictions resolved where reconciliation requires broker access.

**Procedure:** use the runbook's separately gated checklist. Take a fresh pre-maintenance consistent backup and prove an independent restore. Preserve original database, bindings and configuration. Stop only the authorized service and confirm no writers; then take a **final SQLite-consistent snapshot** from the authoritative source and restore it to the candidate destination. Verify integrity, schema, complete objects/commands/events and unchanged owner/verification identities against that final snapshot before setting the three reviewed private paths. Do not copy a bare live database or use the earlier prepared ledger. Preserve submission locks and verify inherited permissions on new database/WAL/SHM/backup files. Verify authenticated saved history before any separately permitted broker reconciliation.

Rehearse rollback without discarding new events: stop the authorized writer, preserve both copies, reconcile any post-cutover delta, select a consistent recovery copy and restore the prior configuration. Do not blindly switch to an old ledger.

**Expected:** demonstrated active cutover and rollback with identities/history preserved; preparation or synthetic tests alone do not pass. **Retain:** private backup hashes/counts, configuration provenance, permission checks and operational timestamps outside the public repository; commit only a sanitized summary.

## D. Actual login expiry and clock observation — deferred access requirement

**Why:** distinguish real expired-token rejection from deterministic mocks, and collect useful evidence if the intermittent clock error recurs.

**Prerequisites:** normal authenticated Supabase dashboard access restored, project identity verified, bounded approval for exactly one auto-confirmed disposable identity with no email or trade fixtures. Do not disturb the owner's session or change project token lifetime.

**Procedure:** in an isolated ephemeral client, sign in the disposable user with persistence and automatic refresh disabled. Keep credentials/JWTs only in memory. Record sanitized issue/expiry UTC times and successful own-scope empty-trades read. Observe the original token through its actual expiry; check Auth user lookup and the same read immediately before and after expiry, and once after 60 seconds if an expiry tolerance is encountered. Record each endpoint separately. Any continued acceptance remains a finding; do not repeatedly poll until a desired result appears.

Verify fresh sign-in recovery in that isolated client, without replaying orders or writes. Collect request/response times and sanitized error codes; never log headers or token bodies. If a future-issued-token error occurs, preserve timing and refresh sequence and reproduce locally before proposing a fix. Absence of the error does not resolve it.

Revoke the disposable session, obtain exact-UUID deletion confirmation, delete only that account, verify absence and confirm no fixtures remain. Deleting a user is not itself proof that its previously issued access token was invalidated.

**Expected:** timestamped old-token rejection and fresh-login recovery, with cleanup proven. **Retain:** sanitized endpoint outcomes and timestamps, account UUID only for bounded cleanup, and explicit clock finding. [Supabase session guidance](https://supabase.com/docs/guides/auth/sessions).

## E. Real account/environment transition — separately authorized fixture

**Why:** prove actual cached state and pending reviews cannot cross account boundaries; existing mock evidence is useful but insufficient for this operational claim.

**Prerequisites:** suitable separately authorized paper account/binding, operator-visible storage resolved, and a reviewed transition window. Never repurpose unrelated accounts or enable live mode to manufacture a second environment.

**Procedure:** use ordinary Plan/Position/Journal controls with submissions locked. Record current account/environment, prepare a draft/review only where already permitted, transition through the approved binding procedure, and verify previous-account positions/history/reviews are not presented as belonging to the new account. Return to the original binding through the reviewed procedure; confirm its history is preserved. If a connection or binding change is not authorized, stop that scenario. Retain deterministic rejection of unsupported environments separately.

**Expected:** no cross-account state, invalidated prior reviews, preserved original records and no orders. **Retain:** exact source identifier and sanitized before/after observations. No suitable second account means blocked.

## F. External decisions and later release

| Gate | Procedure and expected evidence |
| --- | --- |
| Password protection | No upgrade is authorized or requested. Keep **deferred, not passed**. If the user later changes this decision, review entitlement and approve the setting separately; retain configuration verification without secrets. [Official password guidance](https://supabase.com/docs/guides/auth/password-security). |
| Broker dependency | Vendor must provide a supported compatible repair. Inspect official metadata, test in isolation, run dependency/advisory and adapter/recovery checks before a separately approved operator-runtime update. No forced protobuf override. Prior operator audit finding remains open; a clean repository audit does not clear it. |
| Publishing | Review the exact local commit and current CI/protection settings. Obtain approval of that exact SHA before push; merge and deployment need their own explicit authorization. Do not enable Pages automatically. |
| Paper acceptance | Existing policy rejection remains binding. Neither this checklist nor user agreement between tasks removes it. After a legitimate external change permits execution, first apply the authenticated audited 30-round-trip ceiling retaining approval history; never resume the historical 200 target. Preserve two historical completions, F's failed protection and SOFI's no-fill cancellation. Use ordinary controls and existing limits: 3 shares, 2 concurrent campaigns, $500 entry notional, $10 campaign/$20 total risk, excluding PL/AMD. |
| Live release | Requires separately implemented/reviewed live configuration, closed applicable security and operational gates, fresh protection/recovery/accounting evidence and explicit supervised pilot approval. Paper counts or Phase 1 completion alone are insufficient. |
| Rejected proof-checkout cleanup | Remains blocked by policy; preserve it. Do not retry, split or route around the rejected action. |

## Completion record

For each gate record: status (passed/failed/deferred/blocked), exact source, observation time/context, evidence location, limitations and next prerequisite. A failed prerequisite stops dependent steps. No deadline overrides a gate. There are no operator actions to perform now.

## September 23 Phase 3 preparation update

Phase 2 PR #10 merged as `edca6055961dd620e404378f74f801b1be9bd875` after its required Windows gate passed on diagnostic follow-up `99c0929188f8c3cb27bea916d4bddcfdec87bf4e` ([run 35771433023](https://github.com/Melvinroy/Journal/actions/runs/35771433023)). The original `2ce19c0` was not that passing CI source. The approved [Phase 3 package A](../trading-step-3-plan.md) now maps eleven ordinary trading journeys and fills selected browser-fixture gaps. Seven new focused browser checks and independent direct inspection passed; full verification passed. A four-second mocked order-review deadline is not actual cloud-token expiry. This does not close or request any operator action above: no elevated probe, cloud identity, paid change, active cutover, broker connection or submission is part of package A.

Historical broker completion remains **2/30**; F retains its failed protection scenario, SOFI had no fill, and the persisted session remains halted at **200** pending a separately permitted authenticated audited amendment. Fresh operational/account/broker evidence remains blocked. Continue to retain each outstanding gate until its own observation passes; a Phase 3 fixture or merged commit cannot substitute for it.

Phase 3A independent preparation is complete: full verification passed all five stages in 823.4 seconds (207 Node, 278 backend, 77 browser passed; 2/4/3 respective skips and 2 known backend warnings). This does not request or complete any deferred operator action. Phase 3B remains blocked; the historical count, target and submission restrictions above are unchanged.
