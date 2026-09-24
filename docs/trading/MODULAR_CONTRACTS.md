# Modular Trading candidate: contracts and feasibility

Source review: 24 September 2026, baseline `b7fd102d3c614c449fef15f5c143bdeb8d9b285c`. This document defines the **target** boundaries for packages A–H of the [modular product plan](../trading-modular-product-plan.md). It is not evidence that the standalone candidate or any newly described endpoint already works. The [M01–M16 inventory](IBKR_PAPER_ACCEPTANCE_QC.md#modular-trading-baseline-inventory--24-september-2026) records the actual visible controls and current paper support.

## Product and module contract

Keep one local service and one built-in browser shell. Trading and Journal are **two selectable views over one Trading module and one ledger**. A module preference controls navigation and loading; it never grants broker access or interrupts background accounting.

| Owner | Contract | Failure behaviour |
| --- | --- | --- |
| Shell | Owns local profile/session, selected account/environment, navigation, view preferences, connection banner, version and recovery entry points. Built-in manifest has stable module ID/version, view IDs, required services and activation/deactivation hooks. | Missing/unavailable Trading service shows a locked, actionable state; do not fall back to sample data as executable data. |
| Trading module | Reuses `TradePlanner`, `TradingWorkspace`, `PaperOrderReview`, `PaperCampaignActions` and Journal presentation. Owns drafts, reviews and position UI; consumes the shell's verified identity, binding, status and server capabilities. | A hidden Journal view still records events. Trading cannot be disabled while owned exposure, working orders, uncertain commands or managed rules need attention. |
| Shared domain/service | Owns immutable plan revisions, command identity, broker adapter, durable events and one Position/Journal projection. Pure market-reference calculations may run headlessly without Charts/Scanners UI or EOD backfill startup. | Missing market references are unavailable; a chart/sample import is never an execution source. |

The standalone build must demonstrate that opening Trading/Journal imports no unrelated module UI and sends no scanner, chart or cloud-report requests. The existing all-workspace mode retains its behaviour until separately migrated. These are internal interfaces; no third-party plugin ABI or arbitrary module loading is offered.

## Identity and local service contract

Current baseline: `app/usePaperExecution.ts` sends a Supabase bearer token; `paper_auth.py` verifies the user against Supabase and an explicit owner/account binding. The standalone mode requires a **separate server-selected local principal**, not a browser-supplied switch that weakens the existing cloud mode. Cloud mode keeps its current authentication and ownership checks. No Supabase project, cloud login, telemetry or network call may be required at standalone startup.

| Interface | Required fields and invariant | Rejection/invalidation |
| --- | --- | --- |
| Local profile | Random installation/profile ID, owning Windows user identity and versioned preferences. Keep separate from legacy cloud UUID and IBKR account ID. | Wrong Windows user, unreadable owner state or missing private storage fails locked; never auto-adopt a nearby legacy database. |
| Launcher bootstrap | Random, short-lived, single-use capability issued by the local service to its own launcher. Exchange for a browser session; never persist it in a URL query, log or browser storage. | Expired/replayed or unrelated-process handoff rejected. An occupied port is not proof of Brontide ownership. |
| Browser session | HttpOnly same-origin cookie, CSRF protection for mutations, exact loopback Host/Origin checks and session generation. | Lock/logout, profile change and account/environment change revoke pending order/action reviews. Browser closure alone does not terminate healthy broker-held protection or the service. |
| Command authority | Server derives principal, account binding, environment, current policy and permissions; request contains command identity and relevant saved revision/digest. | Stale binding, absent fresh evidence, policy lock, unknown prior transmission or conflicting session blocks an economic command. No automatic retry of uncertain transmission. |

Bind the service to literal loopback only. Validate browser cookie/CSRF/Origin behaviour on the selected browser and loopback host. An operational pause is a separate command: it stops new entries and managed rules while retaining broker-held orders. Local same-user malware and administrators are outside the promised isolation boundary.

## Broker connection and capability contract

The Connect view must show separate facts: local service ready; official SDK present/compatible; TWS reachable; API usable; account discovered; environment corroborated; data fresh; reconciliation complete; execution permitted; managed rules active. Do not compress them into one “Connected” flag. `paper_service.py` currently exposes server-owned capabilities and separate locked/readiness states; retain that ownership.

1. Probe only allowed local TWS endpoints after an intentional Connect action or a saved reconnect preference. Use bounded attempts, no LAN scan and no login/2FA automation.
2. Discover all reported accounts, then require explicit account/environment confirmation even when only one appears. Port number or label alone is insufficient evidence of paper/live identity. The first candidate supports one selected account at a time.
3. Persist a scoped binding only after confirmation. On a changed account, environment, SDK, connection generation, freshness or source revision, invalidate reviews and require full broker snapshot/execution reconciliation before any new entry or managed-rule resume.
4. Keep the existing approved command route and server policy. A new adapter must not expose an alternate submit path, raise the three-share paper limit, resume the halted 200-target session or bypass the submission-policy rejection.
5. TWS absent, API read-only, SDK missing/incompatible, stale market data, client-ID collision and ambiguous accounts must display a specific block and leave saved history available with age/unknown values.

The current server `CAPABILITIES` allows paper Long, Limit/capped midpoint/stop-limit breakout, Regular or RegularExtended, DAY only, excluding PL/AMD; RegularExtended additionally requires Limit + STP LMT. Shorts, GTC, overnight and four populated legs are visible/plannable gaps, **not executable standalone promises**. Actual paper order submission is globally locked. Full planner remains the eventual product target; each expansion needs separate semantics, deterministic checks and broker qualification.

## Ledger, storage and migration contract

The ledger is the source of truth for owned campaigns. Position and Journal views consume the same projection. An approved immutable plan revision and command intent are durable before transmission. Exact broker order/execution identities and event order determine ownership; duplicate or reordered callbacks must not duplicate a trade. Unknown transmission remains unknown until reconciliation, never automatically resent.

Private data are scoped by local principal, exact broker account binding and environment. Keep binaries and data in separate versioned locations under the owning Windows profile, with restricted ACLs and protected local secrets. Record snapshot capture/reconciliation times. On failed refresh, retain the last complete snapshot labelled stale; unknown exposure, fees and historical fills must not become zero. External TWS positions remain visible separately and are not silently assigned to a Brontide plan or controlled by owned-order actions.

Legacy import is an explicit, reversible operation: read a consistent source backup; verify owner/account/environment and schema; show dry-run counts, conflicts and unresolved commands; preserve original IDs, revisions, event ordering, fees and provenance; then import into a private target only when no second active service manages those broker identities. Never copy the owner's current records into build fixtures. A fresh install must not claim an existing folder by name. The earlier agent-versus-desktop private-folder discrepancy remains an operator gate, not resolved by a new candidate profile.

## Packaging and version contract

The current package experiment uses `scripts/package-windows-candidate.ps1` and PyInstaller 6.22.3 to produce a one-folder ZIP; `docs/trading/CANDIDATE_INSTALL.md` correctly labels it a **locked candidate/contributor path**, not a public one-command installer. It needs clean-machine installation, launcher, shortcut, update and rollback proof before changing that claim.

The eventual manifest records product and source version, Windows architecture, supported Python/SDK/TWS combination, frontend asset hashes, dependency inventory/license notices, schema version and verification evidence. A released installer and its one-command alternative must refer to the **same immutable artifact** and independent publisher provenance; a checksum next to an attacker-controlled binary is insufficient. Build/install never modify global Python, Node, PATH or another Brontide installation. Stage updates side by side, require an explicit update, consistent backup and schema compatibility check, and block update with owned exposure, working orders or uncertainty. Uninstall preserves financial data by default.

## Vendor/dependency feasibility and release gates

| Dependency | Directly checked fact | Consequence |
| --- | --- | --- |
| Repository | Project `LICENSE` is MIT; `services/eod/pyproject.toml` requires Python >=3.11 and has no `ibapi` dependency. | Source and a locked planning/demo candidate can be built independently of a broker SDK. A private runtime and complete third-party license inventory still need verification. |
| Packaging tool | [PyInstaller 6.22.3 licensing](https://pyinstaller.org/en/stable/license.html) permits distributing generated bundles under the application's chosen license, subject to dependency licenses. | This supports the current packaging experiment; it does not clear every bundled dependency or establish a signed public installer. |
| Official IBKR API | [IBKR's current download/license page](https://interactivebrokers.github.io/) lists Windows latest 10.50 with Python and stable 10.45 without Python. Its license restricts redistribution of API code and distinguishes personal internal use from some third-party/commercial uses. | Exclude API code from repo/release assets. Guide each user to the official license/download and inspect their provided installation. Public open-source trading distribution should obtain IBKR/legal clarification on intended use; Brontide's MIT license grants no rights to IBKR code. |
| Operator dependency | [September 23 audit](../../output/trading-completion-security.md) found installed `ibapi` 10.50.2 pinning protobuf 5.29.5, with a reported advisory and no vendor-supported repaired combination established. The inspected operator environment is not proof of the active service. | No forced protobuf override, unofficial substitute or security waiver. Missing/incompatible SDK leaves Connect blocked and sample/planning available. Recheck official metadata and validate a supported fix in isolation before any real execution. |
| Existing cloud mode | The standalone target makes no cloud request and does not migrate the old application's auth configuration automatically. The [Supabase changelog](https://supabase.com/changelog?types=breaking-change) was checked on 24 September; no change to this contract was inferred from it. | Cloud-specific gates remain attached to the legacy mode. They become not applicable to a verified cloud-free standalone build, not retrospectively “fixed.” |

### Package A exit criteria

- Review M01–M16 against actual controls and source policy; retain the historical broker evidence separately.
- Review these contracts against shell, security, execution and packaging implementations as they land; update interfaces when implementation evidence establishes a better safe contract.
- Record official SDK compatibility/licensing uncertainty and the dependency advisory as blockers, with no public broker-trading promise until resolved.
- Use isolated tests for new interfaces, full repository verification for executable changes, and packaged clean-machine checks before an installation claim.
