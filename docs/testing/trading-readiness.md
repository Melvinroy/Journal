# Trading readiness and release gates

Scope: Plan & Position and Journal. No live trading, deployment or broker acceptance is authorized by this document.

## Implemented preparation

- Recorded campaigns are installed in the UI before attempting TWS connection. A connection failure does not hide successfully loaded history.
- Complete broker snapshots are saved in SQLite under verified user, account binding and paper environment. Restarted/disconnected views are stale; missing historical snapshots are not invented. Partial refresh failure retains the last complete view.
- The main planner action area contains Save plan, Save exits and Review order. The separate execution heading and embedded test-session disclosure are removed. Verification is a read-only page, not another trading form.
- Connected sizing uses available USD broker equity; last-known equity is labelled as an estimate. Review and submission validate freshly retrieved USD equity and available funds server-side.
- Planner and position browser stores, presets and Journal reviews are scoped by user/account/environment. Unscoped legacy data is preserved; the planner offers explicit import without overwriting scoped data. Existing legacy broker associations are not automatically assigned to another account.
- Reviewed execution-plan content is persisted with a digest. A revision identity cannot be reused with different content. Existing command-before-transmission, account ownership, stale-source checks and uncertain-submission locks remain.
- Status exposes server capabilities. Paper limits remain enforced. A non-paper execution environment is rejected; there is no live enablement switch.
- An authenticated, idempotent target-reduction endpoint preserves original approval evidence and leaves the session halted. Old targets above 30 block resume and execution. Historical completed campaigns outside that session count toward the ceiling after amendment. This endpoint has **not** been invoked on the user's halted session.
- Pause trading clears entry/management authority and halts active test sessions without cancelling broker-held protection.
- Local served HTML has hash-based script CSP, frame denial and content-type protection; broker API responses use no-store. Exact confirmation prices preserve up to eight decimal places.
- Database schema version 1 retains existing tables/evidence. A consistent SQLite backup precedes an existing version-zero database upgrade. Explicit backup uses SQLite backup and integrity checking, and refuses to overwrite an existing backup.

## Evidence classes

| Scenario | Class | Release implication |
|---|---|---|
| NVDA historical pilot | Broker-observed completion | One round trip; not evidence for the current repaired source |
| F historical lifecycle | Failed protection; recovered completion | Counts as a round trip, never as a protection pass |
| SOFI entry cancellation | Broker-observed cancellation | No fill, no round-trip count |
| Replay, fees, OCA identity, lifecycle, simulated 200-campaign sequence | Deterministic | Does not establish broker fills or race coverage |
| New offline snapshot, content identity, target amendment, funds and backup tests | Deterministic | See the exact-source verification report for run results |
| Repaired protected lifecycle, concurrency, reconnect and normal-control paper acceptance | Unobserved / blocked | Must pass before a live candidate |
| Shorts, auctions, overnight, four-leg allocations | Blocked | Remain planning-only/unsupported |

## Security review, September 19, 2026

Deployed `public.trades` has RLS enabled. A rolled-back fixture test under the authenticated role returned owner-visible=1, other-user-visible=0, other-user-updated=0 and other-user-deleted=0. Inserting another user's record returned SQLSTATE 42501. This tests deployed SQL policy behavior, not the entire external JWT/REST lifecycle. No production records or policies were changed.

Outstanding security gates:

1. Supabase advisor reports leaked-password protection disabled. Change and verify the deployed Auth configuration separately.
2. Official IBKR API 10.50.2 pins protobuf 5.29.5. Dependency audit reports PYSEC-2026-1805, with a fix in 5.29.6. The standalone upgrade violates the SDK pin and was reverted. Verify an official compatible SDK/runtime before release. The SDK itself is absent from the audit registry; no clean SDK audit is claimed.
3. Windows ACL inspection found owner/SYSTEM/Administrators plus Codex sandbox grants on private execution files. An owner-only production installation and backup ACL verification remain required; these platform access grants were not silently changed.
4. Revoked-session behavior must be verified end-to-end. Server getUser validation and a short local lease are not a proof of immediate revocation of every existing JWT.
5. A broader penetration test, operational alert delivery and complete cloud/private-backup threat review remain outstanding.
6. Direct signed-in browser inspection reported `JWT issued at future` for cloud Journal loading while local paper history remained available. The public auth endpoint's Date header matched the local UTC clock to the second. The cause is not established; investigate the actual session and REST validation path without weakening token checks. Repeat browser cloud-read and expired/revoked-session tests before release. The SQL ownership checks above do not resolve this error.

## Recovery procedure

1. Pause trading. Do not cancel stops merely to restart the app. On unknown submission outcome, never resend the economic command.
2. Retain database, raw callbacks and consistent backup. Do not edit broker confirmations or fabricate closure.
3. Restore a backup to a separate private path while the service is stopped. Run integrity checking and compare campaigns, events and commands. Keep submissions disabled during restore/reconciliation. Never overwrite the only surviving ledger.
4. Reconnect to the exact approved paper account/client, obtain complete positions, orders, executions and fees, and reconcile. Last-known UI data is not current broker confirmation.
5. Resolve conflicts using exact owned identities. Leave unrelated positions/orders untouched. Review each campaign before re-enabling application-managed exits.
6. Separately prove flat quantity, cleared owned orders and complete accounting. A zero position alone is insufficient.

## Go / no-go

**No-go for live trading.** The future candidate is USD whole-share long limit entries, regular hours, DAY duration, broker-held stop, one target and verified breakeven. It requires repaired broker evidence, closed critical/high findings, restorable private backups, alerts, an exact reviewed release and explicit live configuration/approval. A supervised one-share, one-campaign live pilot is a separate gate.

Automatic approval review previously rejected enabling paper submissions with “blocked by policy.” No source repair, test result, standing paper approval or target amendment bypasses that boundary. Final automated, direct-browser and untested evidence must be reported separately for the delivered source.
