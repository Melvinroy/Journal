# Private paper-storage installation

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

The runtime Windows identity and dedicated production/backup directories have not been selected. No ACL mutation is authorized until they are concrete. The September 20 read-only inventory found the owner account, `SYSTEM`, `Administrators` and Codex development-platform grants on the current `%LOCALAPPDATA%\Brontide` tree. That inventory is evidence for the open gate, not a least-privilege pass.
