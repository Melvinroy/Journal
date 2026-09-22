# Private paper-storage installation

**Current gate, September 22:** follow [deferred operator actions](OPERATOR_ACTIONS.md) before any procedure below. The administrator probe is suspended because the user's normal and elevated shells cannot see the private roots that the agent sees. Earlier copy/ACL/restore results below are historical agent-session observations, not proof of a protected desktop installation. A fresh agent process inventory found no Python/uvicorn process; the historical active-service description is not a current service-state claim.

Brontide's paper ledger, owner binding, operator verification, raw broker evidence and backups are private operational data. The development checkout is not the production security boundary. The default `%LOCALAPPDATA%\Brontide` directory currently inherits development-platform grants and is therefore not approved as a least-privilege production installation.

## Required layout

Choose one dedicated absolute directory for the local runtime and a second dedicated absolute directory for backups. Configure `BRONTIDE_PAPER_DATABASE`, `BRONTIDE_PAPER_OWNER_FILE`, `BRONTIDE_IBKR_VERIFICATION_FILE` and the backup procedure to use only those directories. The runtime identity must be named before any ACL change. Keep `SYSTEM` and `Administrators` access unless the actual service arrangement proves they are unnecessary.

Never place either directory in the repository, a cloud-synchronised folder, a browser-served directory or a location shared with unrelated users. Do not move or overwrite the only ledger or backup during migration.

## Reversible Windows ACL migration

Run these steps from an elevated PowerShell only after substituting reviewed, literal paths and the exact Windows runtime identity. Do not use environment-variable expansion, wildcards or a workspace root as an ACL target.

1. Stop the Brontide service. Confirm TWS-held protection separately; stopping Brontide must not be represented as cancelling or verifying broker orders.
2. Resolve and record the exact source, runtime and backup directories. Reject any target that is a reparse point or is outside the approved parent.
3. Save the current ACLs with `icacls <source-root> /save <rollback-file> /t /c`. Store the rollback file outside the directories being changed.
4. Copy—not move—the ledger, owner binding, verification file, raw evidence and a consistent SQLite backup into the new private directories. Keep the originals read-only until restoration is proven.
5. Disable inherited access on the new directories, then grant full control only to the named runtime identity, `SYSTEM` and `Administrators`. Apply inheritance to child files and directories. Do not remove development-platform grants from the active development directory.
6. Read back the effective ACL on both roots and every sensitive child. Create a new SQLite WAL and a new backup through the intended runtime and verify that each inherits the approved ACL.
7. From the runtime identity, verify ledger read/write, owner/verification reads, consistent backup creation, integrity checking and restore to a separate path. From a disposable unrelated Windows identity, verify that read, write, delete and directory listing are denied for runtime data and backups.
8. Point the runtime configuration at the new paths and repeat a read-only reconciliation with submissions disabled. Retain the original files until the reviewed rollback window closes.

Rollback uses `icacls <approved-parent> /restore <rollback-file> /c` while the service is stopped, followed by the same ACL and database-integrity checks. A saved ACL listing by itself is not proof that restore works.

## Current gate

The September 20 closure run made the candidate identity and paths concrete without cutting over the active service:

- runtime identity: `MELVIN\melvi` (`S-1-5-21-1386659274-518491314-1459396466-1001`)
- runtime directory: `C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime`
- backup directory: `C:\Users\melvi\AppData\Local\BrontidePrivate\Backups`
- source-ACL rollback file: `C:\Users\melvi\AppData\Local\BrontidePrivateAclRollback\source-acl.txt`

The new roots are not reparse points and grant inherited full control only to `MELVIN\melvi`, `SYSTEM` and `Administrators`. Online SQLite copies preserved the active source and produced a runtime ledger plus a separate backup. A restored database passed `integrity_check` and matched the backup at 23 objects, 27 commands, 55,395 events and schema version 1. A disposable SQLite write and its WAL/SHM files inherited the same restricted ACL.

This is partial operational proof, not production signoff. The active service continues to use the original `%LOCALAPPDATA%\Brontide` tree and was not stopped or repointed because it is running from a protected checkout alongside TWS. The current shell is not elevated and no disposable unrelated Windows identity is available, so genuine read/write/delete/list denial has not been demonstrated. Do not treat the ACL listing as denial evidence. Complete the distinct-identity test, service cutover, read-only reconciliation and reviewed rollback window before approving these paths for production.

### September 20 verification-only denial procedure

A fresh read-only inspection confirmed that the interactive identity remains `MELVIN\melvi` (`S-1-5-21-1386659274-518491314-1459396466-1001`) and the shell is not elevated. Both prepared roots exist, are owned by `MELVIN\melvi`, still inherit their ACL, and currently show full-control entries only for `MELVIN\melvi`, `SYSTEM` and `Administrators`. This ACL inspection is not an operational denial test.

The enabled `MELVIN\CodexSandboxOffline` and `MELVIN\CodexSandboxOnline` accounts are platform-managed identities, not disposable operator fixtures, and must not be repurposed. Use a newly created standard local account named **`MELVIN\BrontideAclProbe`** for the denial proof. The following is a separate elevated operator procedure; it was prepared but not run in this package:

1. Open an elevated PowerShell. Confirm `MELVIN\BrontideAclProbe` does not already exist. Prompt interactively for a temporary random password and create that exact local account with `New-LocalUser`; do not add it to `Administrators`, `Backup Operators`, the owner group or any Brontide-specific allow group. Record its SID, not its password.
2. Reconfirm these literal test roots and reject either if it is missing, a reparse point or resolves elsewhere:
   - `C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime`
   - `C:\Users\melvi\AppData\Local\BrontidePrivate\Backups`
3. As `MELVIN\melvi`, create one uniquely named, non-secret sentinel file beneath each root and verify list, create, read, update and delete against separate owner-only scratch files. Do not use a ledger, owner binding, verification file, backup or broker-evidence file as a permission probe.
4. Start a non-elevated PowerShell process with `Get-Credential 'MELVIN\BrontideAclProbe'` and `Start-Process -Credential`. In that process, attempt each operation separately against both roots: list the root; read the exact sentinel; create a new exact probe file; modify that probe file if creation unexpectedly succeeds; and delete only the sentinel. Capture success/failure and the Windows error for each operation. The expected result is access denied for all list/read/create-or-write/delete attempts.
5. Back in the owner session, verify both sentinels still exist and are unchanged, no probe file was created, and owner list/read/write/delete still succeeds. Read back the ACL on both roots and representative children. If any non-owner operation succeeded, leave the gate failed, preserve evidence and review the effective ACL before making any change.
6. After the evidence is reviewed, delete only the temporary sentinels and remove exactly `MELVIN\BrontideAclProbe`. Account removal is destructive and requires an action-time confirmation. Re-read the roots to confirm owner access remains.

This procedure deliberately does not stop or restart the active service, reconnect TWS, repoint configuration, reconcile the broker, apply a production cutover or exercise rollback. Those actions remain a separate reviewed operation after denial evidence passes.

### September 21 owner proof and prepared operator probe

**Subsequent operator discrepancy — gate blocked:** the user's elevated Windows PowerShell reported both `BrontidePrivate` and `BrontidePrivate\Runtime` absent, while `whoami` and `hostname` matched `melvin\melvi` and `Melvin`. The agent shell still resolves both prepared roots under the same reported identity and hostname. The cause of these conflicting filesystem observations is not established. Prior agent-session ACL/owner/backup results must not be treated as proof that the operator-visible installation exists or is protected. The probe stopped at its initial root lookup, before fixture/account creation. Do not recreate, move or replace private data to conceal this discrepancy; establish the actual filesystem view and paths first.

At `2026-09-21T11:26:54Z`, the **non-elevated** `MELVIN\melvi` session successfully listed, created, read, updated and deleted unique harmless scratch files in both literal roots above. The scratch files were verified absent afterward. No private data, directory ACLs, accounts or service settings were modified. Fresh inspection found the same owner and three allowed principals on both roots; neither root nor its ancestors was a reparse point. These are owner-positive results, not distinct-user denial evidence.

An inspectable operator helper is prepared locally at `C:\Users\melvi\Projects\Journal\output\phase1-final-checks\Invoke-BrontideAclProbe.ps1`. Its PowerShell syntax was checked. The user's administrator attempt stopped at the first root lookup, before any fixture/account creation; no denial proof was obtained. **Do not rerun until the storage discrepancy is resolved.** It is an operational artifact, not a service launcher. Only after that prerequisite and script/path review, the operator would run this in an elevated **Windows PowerShell** as `MELVIN\melvi`:

```powershell
& 'C:\Users\melvi\Projects\Journal\output\phase1-final-checks\Invoke-BrontideAclProbe.ps1'
```

The helper refuses an existing `BrontideAclProbe` account, a different operator SID, unexpected root ownership/ACL entries or a reparse ancestor. It prompts for a temporary password without printing or saving it, creates the standard probe account with a one-day expiry, and uses a hidden credentialed process to test list/read/create/modify/delete separately in each root. Only uniquely named harmless sentinels are read, changed or deleted by these probes; no ledger or backup is used. The child confirms its exact new SID and non-administrator token. Only `UnauthorizedAccessException` counts as denial; launch failures, missing files and other errors do not pass. Copy the resulting sanitized JSON evidence back for review.

The account and sentinels deliberately remain for separately confirmed cleanup. Record the returned account SID and run ID. After action-time approval, remove only that same account and the exact `brontide-acl-sentinel-<runId>.txt` files (and `brontide-acl-write-<runId>.txt` only if a failed probe created it). Revalidate each literal path and reject reparse points before deletion. Do not recursively delete either root, remove a Windows profile automatically, or repeat an interrupted run against an existing account. An expiry date is not account cleanup. If the operator run is unavailable, distinct-user denial remains **blocked**, not passed.

### Separately gated cutover and rollback checklist

No cutover is authorized by the preparation or denial probe. The active service and its protected checkout must stay untouched until a separate reviewed operation is permitted. Do not start another instance pointed at the active ledger as a workaround. A service launch must never be used to route around the existing paper-submission policy block.

Before any future permitted change:

- [ ] Capture the exact active process, checkout/version, launch mechanism, runtime identity and current private configuration **without printing credentials**. Confirm there are no other writers. Do not assume the repository's current interpreter is the active service interpreter.
- [ ] Resolve the active source filenames from the actual configuration. The paper-store and owner defaults are `C:\Users\melvi\AppData\Local\Brontide\paper-lifecycle.sqlite3` and `C:\Users\melvi\AppData\Local\Brontide\paper-owner.json`; the verification path has no safe assumed default. Preserve account/client/endpoint values and owner binding unchanged.
- [ ] Establish separately authorized broker reconciliation and a safe maintenance window. No cached snapshot proves current protection or flatness. Preserve the halted session, submission locks and managed-rule pause; do not invoke connect/resume/order endpoints as a storage test.
- [ ] Record a consistent SQLite online backup, timestamp, hash, integrity result, schema version and object/command/event counts. The September 20 prepared copy is historical and must not replace a newer ledger. Copy owner/verification files without regenerating their identities; preserve original files and configuration for rollback.
- [ ] After the authorized service stop and confirmed writer quiescence, take a **final SQLite-consistent snapshot** from the authoritative source. Preserve the earlier backup as the pre-maintenance fallback. Restore this final snapshot at the candidate destination, compare complete objects/commands/events, schema and integrity, and verify unchanged owner/verification identities. Do not use a bare live database copy or the stale prepared ledger. Only then update **the private process configuration** to the following destinations; do not put these values or private configuration in browser assets or a public deployment.

| Setting | Reviewed candidate destination |
| --- | --- |
| `BRONTIDE_PAPER_DATABASE` | `C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime\paper-lifecycle.sqlite3` |
| `BRONTIDE_PAPER_OWNER_FILE` | `C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime\paper-owner.json` |
| `BRONTIDE_IBKR_VERIFICATION_FILE` | `C:\Users\melvi\AppData\Local\BrontidePrivate\Runtime\operator-verification.json` |
| Backup root | `C:\Users\melvi\AppData\Local\BrontidePrivate\Backups` |
| `BRONTIDE_IBKR_SUBMISSIONS_ENABLED` | `false` (must remain locked) |

- [ ] Read back ACLs on the freshly copied files and new WAL/SHM/backup artifacts. Verify identity, private-path isolation, authenticated saved history and database integrity before any separately approved broker connection. Require complete broker reconciliation before any later execution review; storage success alone cannot authorize orders.
- [ ] For rollback, stop the authorized runtime and capture any post-cutover events before restoring configuration. Never point to the old database blindly if the new database acquired commands/events: preserve both, reconcile the delta and select a consistent recovery copy under review. Avoid duplicating or losing durable command identities.
- [ ] Restore original process configuration only after that reconciliation, validate restored ACLs and integrity, and repeat locked history checks. Keep both copies until the retention/rollback window is explicitly closed. Record actual results; a checklist or simulated restore is not active-service rollback evidence.
