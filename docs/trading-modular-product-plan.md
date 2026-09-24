# Brontide Modular Desktop — execution handoff and product roadmap

Prepared: 24 September 2026. Status: execution in progress on `codex/modular-trading-desktop`; this document is the roadmap and progress record. The user's later execution instruction authorized independent engineering work, while the broker, publication and active-service boundaries below remain in force.

## 1. Read this first

Build an installable Windows application that opens a local browser interface. Reuse the existing Trading UI, calculations, execution safeguards and Journal. Introduce a small shared shell, local identity, guided connection setup and packaging so Trading can operate independently of the other workspaces. Do not redesign the planner or start over.

The public product is **Brontide**. Keep the existing `Melvinroy/Journal` GitHub repository, MIT license and history. A repository rename, new repository, cloud-hosted trading service or paid account change is not part of this plan.

Two outcomes must remain separate:

1. **Independent engineering completion:** working local installer candidate, reusable module shell, local-only identity, preserved Trading/Journal UI, guided setup implemented against fixtures, all feasible code and automated checks completed, GitHub landing/download materials prepared, and an exact operator/broker handoff. No real broker account is required to finish this engineering package.
2. **Trading release qualification:** required operator security checks, permitted real paper acceptance, supported dependency resolution and separately authorized live qualification. This cannot be certified by fixture tests or by the user's decision to test later.

The user wants the full planner eventually: not merely a narrow long-limit product. Preserve that requirement. The installable candidate may be delivered before broker qualification only if unverified capabilities remain disabled for real execution and are clearly labelled. Do not call the entire full-planner product complete while such gates remain.

## 2. Confirmed product decisions

| Topic | Decision |
| --- | --- |
| Initial user | The owner first, using the exact process intended for future users. |
| Distribution | Open source; GitHub README and Releases are the primary entry point. |
| First platform | Windows 11 x64. Windows ARM, macOS and Linux are deferred. |
| UI | Local browser application plus desktop launcher/shortcut. No Electron rewrite. |
| Sign-in | Local-only app session; no Brontide cloud registration, project keys or subscription. |
| IBKR login | In TWS, not inside Brontide. Never request/store IBKR passwords or automate 2FA. |
| Entries | Manual review and explicit confirmation. Connection never opens a trade. |
| Exits | Rules approved with a plan may run automatically when allowed, with clear broker-held versus application-managed status. |
| First selectable experiences | Trading and Journal. These are views over one Trading module and shared ledger, not separate accounting implementations. |
| Other modules | Disabled/unloaded by default; no scanner, chart or research dependency at startup. |
| Other account activity | Display separately; no automatic management, plan assignment or historical import of external trades. |
| Installation | One command installs/launches Brontide; guided official IBKR dependency acquisition and TWS setup may still require user action. |
| Full feature target | Every current visible planner option and meaningful permitted combination; broker-impossible combinations must remain explicitly blocked. |
| Release progression | Versioned candidate releases, paper qualification, personal live qualification, then supported public trading release. |

### What “reuse” means

- Preserve existing planner layout, labels where accurate, inputs, position drawer, Journal metrics, draft preservation, keyboard/focus behaviour and reviewed styles.
- Reuse domain calculations, immutable plan evidence, command identities, event replay, protection logic and shared accounting projections.
- Move responsibilities behind interfaces rather than copying files into a second engine.
- New UI is permitted for Home/module selection, Connect, installation status, local session lock, backups, updates and recovery. Add only what those journeys require and match existing visual patterns.
- Correct a demonstrated defect or inaccurate execution label; do not undertake aesthetic redesign of existing trading surfaces.
- Journal visibility is optional; Journal recording is mandatory whenever Brontide trades exist. Hiding Journal must not stop event capture.

## 3. Baseline and repository handling

Remote main was read back as `b7fd102d3c614c449fef15f5c143bdeb8d9b285c` on 24 September. PRs 11 and 12 are merged. The exact PR12 integration head `41550215d8a0bb34aa26d169ce12e26defa991d9` passed Windows verification in run `35968166760`. These are historical baseline facts; recheck before implementation.

The original checkout is `C:/Users/melvi/Projects/Journal`, currently on an older scoped branch, not necessarily main. It contains preserved unrelated `next-env.d.ts`, `CLAUDE.md` and generated/private outputs. Do not reset, stash, clean, move, commit or delete them. Do not alter protected recovery/proof checkouts.

Before coding, read applicable AGENTS.md, `docs/EXECUTION_PLAN.md`, `docs/WINDOWS_CODEX_HANDOFF.md`, and local/CI verification guides. Create an isolated worktree from verified main on `codex/modular-trading-desktop`; if that branch already exists, inspect its purpose and resume only if it is this work. Do not change the active broker service. Copy this plan into that worktree as a planning artifact; verify identical contents. Never copy private databases, owner files or credentials just to provision development.

Inspect the source and tests before each extraction. Likely starting points: `app/page.tsx`, `app/TradingWorkspace.tsx`, `app/TradePlanner.tsx`, `app/usePaperExecution.ts`, the existing paper service/auth/policy modules, the execution ledger and `scripts/local.mjs`. The current launcher assumes developer dependencies and initiates unrelated EOD work; it is not the standalone product launcher.

Keep existing acceptance evidence and operator requirements in their current records:

- [Acceptance matrix](trading/IBKR_PAPER_ACCEPTANCE_QC.md)
- [Operator actions](trading/OPERATOR_ACTIONS.md)
- [Storage runbook](trading/PRIVATE_STORAGE.md)
- [Current completion plan](trading-completion-plan.md)

## 4. Target user journey

### 4.1 GitHub to local interface

1. The repository README states: local Windows application, manual entries, IBKR prerequisite, release maturity and limitations.
2. One prominent **Install Brontide for Windows** path points to a versioned official release. A copyable one-command alternative downloads/verifies that same release, not a mutable development branch.
3. Installation is per Windows user. It does not require installed Git, Node or Python, bypass Windows policy, or silently elevate.
4. On completion, the launcher starts the private local service, waits for verified readiness and opens the browser. A shortcut supports later launches.
5. Home offers Trading and Journal, selected by default. Trading opens Plan & Positions; Journal opens its existing view within the app. Choice persists per local profile. Do not create browser popups merely for normal module navigation.
6. The first-run Connect screen guides prerequisites. A separate, clearly labelled sample mode can demonstrate the interface without IBKR and must never call a broker adapter.
7. After the allowed setup/qualification gates pass, the user selects and confirms the account/environment, reviews a plan, explicitly submits it, and sees broker-backed state and Journal updates.

### 4.2 Returning user

- Shortcut opens the same profile and saved view. If an instance exists, authenticate the new browser session to that instance rather than start a duplicate engine.
- Connection may be re-established to a previously confirmed loopback TWS endpoint, but order reviews are invalidated across session/account changes and reconnect reconciliation precedes new entries.
- Never automatically resume application-managed exits after uncertain recovery. Require the documented recovery review; broker-held protection is not cancelled by locking or disconnecting.
- Browser closure leaves the background service running. Quitting the service explains affected rules and preserves the ledger. No silent force-close/cancel-all action.
- Missing broker connectivity leaves saved history available with timestamps, stale labels and unknown values where appropriate.

## 5. Architecture and ownership boundaries

Use a modular application in one repository, not independently deployed microservices.

```text
GitHub README / versioned release
             |
      Windows installer + launcher
             |
      local service (one instance per profile)
       /                      \
static browser shell        local authentication / storage
       |
Trading module: Plan, Positions, Journal
       |
execution commands -> durable ledger -> shared projections
       |
versioned broker adapter -> official SDK -> local TWS
```

### 5.1 Shell and modules

- The shell owns local session, profile, selected account, navigation, settings and installed module preferences.
- The Trading module owns its drafts, order reviews, position views and Journal presentation. It requests shared services through typed interfaces.
- A built-in module manifest has stable ID, version, available views, required services and activation/deactivation hooks. This is an internal contract, not an arbitrary-code plugin format.
- Only bundled/reviewed modules can load. Module selection does not confer broker permission.
- Disabling Trading is blocked while owned exposure, working orders, unresolved transmissions or managed rules remain. Hiding its Journal view does not disable reconciliation/accounting.
- Trading may use headless market-reference services for ATR/SMA/day extremes; it must not require the Charts/Scanners UI or unrelated EOD backfills. Reference timestamps, adjustment/session definitions and entitlements must remain explicit.

### 5.2 Public/local service contracts

Keep one versioned, same-origin local API. Reuse trading command schemas where sound; add only shell needs: session bootstrap/lock, profile preferences, connection discovery/status/selection, installed version/capabilities and backup/update status.

All commands carry the local principal, account/environment binding, request identity and relevant saved revision. The server derives/validates these rather than trusting browser claims. Approvals are invalidated by binding, permission, source or plan changes. UI capability messages and backend enforcement come from one server-owned policy.

Connection status must distinguish service available, TWS reachable, account identified, data freshness, reconciliation complete, execution permitted and managed rules active. Do not compress these into one misleading green “Connected” indicator.

Retain command-before-transmission durability and no automatic retries of uncertain orders. A new local-auth adapter cannot weaken old cloud-mode verification or select a more permissive policy through a browser parameter.

### 5.3 Local identity/security

- Generate an installation/profile identity scoped to the Windows user; keep it separate from broker account IDs and prior cloud UUIDs.
- Use a random, short-lived, single-use launcher bootstrap capability. Exchange it for a server session; remove bootstrap material from the browser URL immediately. It must not appear in query strings, referrers, application logs, analytics or persistent browser storage. A fragment-based handoff is acceptable only with immediate removal, no third-party assets and a reviewed threat model.
- Use HttpOnly same-origin session cookies, restrictive SameSite behaviour, exact host/origin/port allowlists and CSRF protection for mutations. Test browser behaviour on supported loopback origins; do not assume a cookie attribute works without evidence.
- Bind to literal loopback only. Reject foreign-origin requests, DNS-rebinding hostnames, untrusted WebSockets and external-interface binding.
- Restrict private folders to the owning Windows identity and necessary system identities; protect stored secrets with Windows user-bound protection. Do not store tokens in plaintext configuration.
- A browser lock revokes reviews and new-entry access. It must not silently stop already approved healthy management; document that distinction from operational pause, which stops managed rules while retaining broker orders.
- No cloud login, telemetry, license server or developer-owned project is required. Update checks are explicit, not hidden startup dependencies.
- Local same-user malware and administrators are outside any promised isolation guarantee. Document this limitation plainly.

### 5.4 Data and migration

- Use versioned application binaries and separate per-user data. Preserve the current durable execution store and shared projection semantics; do not migrate to a new database engine for modularity alone.
- Resolve storage against the current Windows profile, not a hard-coded username. Show resolved paths in local diagnostics without publishing them.
- The existing agent/desktop visibility discrepancy remains unresolved. New isolated install tests do not prove the old desktop storage or its permissions.
- An existing user imports history explicitly with a validated source/target binding and a consistent backup. Never auto-claim discovered legacy data or infer owner/account from a folder name.
- Do not transfer unresolved orders into a second active service. Prove exclusive management ownership and reconcile before cutover. Actual active-service changes remain separately gated.
- Preserve original IDs, event order, plan evidence, uncertainty and fee corrections. Record migration provenance. No actual owner records are modified during the independent goal.

## 6. Runtime, installation and supply chain

### 6.1 Default packaging design

- Build the existing static frontend at release time; serve it from the local Python service. No Next dev server or Node runtime for end users.
- Package a private supported CPython runtime and exact, hash-locked dependencies. Do not modify system Python, PATH, global npm or another checkout's environment.
- Produce a Windows per-user setup package plus launcher/shortcut. Select the smallest maintained packaging tool that supports these requirements; record the selection before implementation and retain its license. Do not add an Electron wrapper just for installation.
- Keep source-install instructions for contributors separate from the single recommended end-user installation path.
- Brontide release assets must exclude official IBKR SDK code unless redistribution permission is established. Guided setup opens the official download/license route, accepts a user-provided supported SDK package, verifies compatibility, and installs it into Brontide's private dependency area only after user consent. No silent acceptance of third-party terms.
- Do not bypass the existing vendor dependency finding through forced protobuf versions, altered metadata or an unofficial PyPI substitute. A missing/blocked SDK allows planning and sample mode but leaves real execution unavailable.

### 6.2 Integrity and updates

- A release manifest records app/source version, platform, file hashes, schema version, supported runtime/SDK combinations and evidence links.
- Verify trusted publisher signature/provenance before executing downloaded code. A checksum delivered beside a compromised binary is not independent authentication.
- Prepare signing/provenance integration without purchasing credentials or changing organization settings. If signing infrastructure is unavailable, deliver an explicitly unsigned local candidate; do not represent it as a trusted public installer or bypass SmartScreen/PowerShell policy.
- One-command instructions must reference an actual versioned artifact and the same verified installation flow as the Download button. Until publication, show an honest unavailable/candidate state rather than a nonfunctional command.
- Updates are explicit, staged side-by-side, and prohibited during owned exposure/working orders/uncertainty. Take a consistent backup before migration. Do not overwrite the running binary or blindly roll a database back after new events.
- Uninstall stops only its own service and removes only its own binaries/shortcuts. Preserve financial data by default; deletion requires a separate exact-path confirmation.

## 7. Broker setup and feature contract

### 7.1 Connection behaviour

Initially support local TWS. Keep adapter separation suitable for a later verified IB Gateway profile; do not imply it is certified merely because the socket protocol is similar.

The Connect flow must handle: official SDK absent/incompatible, TWS absent/closed, API disabled/read-only, port mismatch, client-ID collision, multiple endpoints, missing account data, account/environment mismatch, missing market permissions and stale data. Use bounded probes only against allowed loopback endpoints when the user initiates Connect or has explicitly saved reconnect preferences. No LAN scan or hidden broker access on page load.

List discovered accounts but require explicit selection/confirmation even for one. Confirm masked display plus an intentional full-account confirmation view locally. Multiple accounts do not enable multi-account simultaneous trading in v1. Switching invalidates reviews, isolates history, and is blocked while the current account needs active management unless a separately specified safe transition exists.

Port numbers and naming conventions alone are not proof of paper/live identity. Require corroborated broker/session facts and explicit operator confirmation; unresolved environment keeps execution locked.

### 7.2 Full planner inventory

Before code changes, enumerate every visible planner/position action from the baseline. Extend the existing acceptance matrix with stable IDs, semantics, applicable combinations, server capability, data requirements, current tests, missing implementation, broker evidence and release status.

Mandatory families:

| Family | Required eventual scope |
| --- | --- |
| Entries | Long/short, Limit, capped midpoint, stop-limit breakout; preserve exact meanings rather than relabel Normal as market. |
| Sessions/duration | Regular, regular+extended, overnight, overnight+day; DAY/GTC and any auction option actually exposed by the inventoried UI. |
| Protection | STP/STP LMT, manual/ATR/day-extreme initial reference, tick-correct prices and explicit non-guaranteed fill behaviour. |
| Sizing | Verified broker funds, user risk/allocation settings, quantity rounding and server limits; no stale equity execution. |
| Exit allocation | One/two targets, one/two runners, four populated legs, partial-fill redistribution and amendments. |
| Rules | R/price targets; SMA10/20/50, day extreme, dollar, percentage/manual trailing; breakeven activation/offsets. |
| Management | Review/save separation, cancellation, acknowledgement, amendments, pause, bounded closure, uncertainty/recovery. |
| Journal | Partial entries/exits, fees, corrections, net results, Execution R, history/filter/empty/error states. |

Invalid combinations are not promised. A broker-impossible combination must have a documented prohibition and UI explanation. A feasible requested feature that remains unimplemented is a gap; it cannot be quietly removed from full-release acceptance.

Use the existing pure domain and command layers. Short execution needs direction-correct prices, permissions/availability rejection and buy-to-cover accounting. Overnight needs session-specific order/protection eligibility, calendar boundaries, gaps and recovery. Do not represent a regular-session stop as overnight protection.

Four whole-share populated legs require at least four shares. Current three-share acceptance permission cannot validate them. Existing acceptance limits remain three shares/campaign, two campaigns, $500 entry notional, $10 campaign/$20 total planned risk and PL/AMD exclusions until separately revised. Implement wider fixture coverage without changing active limits.

The one-share-tranche execution design needs explicit scaling review before ordinary larger positions. Choose and document broker-compatible order allocation, maximum children, OCA behaviour, rate limits and partial-fill handling before enabling larger quantities. Do not simply delete the old cap.

### 7.3 Accounting/recovery invariants

- One immutable approved plan reference per approved revision; persist before transmission.
- One shared event projection drives Positions and Journal; no independent browser P&L calculator for broker facts.
- Duplicate/reordered callbacks and restarts must not duplicate trades or retransmit uncertain commands.
- Missing fees/timestamps/history remain unknown, not zero or fabricated.
- Late fees and execution corrections update the same record with an audit trail.
- Reconnect gathers complete snapshots and executions before publishing reconciled state; incomplete refresh retains last-known data with age/status.
- Account-wide external exposure is visible for risk context but not controllable through owned-order actions.
- Broker history availability is bounded. Show gaps beyond the retrieval window; do not promise automatic reconstruction of all past account activity.
- Sleep, TWS logout and service termination have explicit consequences for managed rules. Broker-held orders persist according to broker behaviour, not an app guarantee.
- Flat positions, cleared orders, complete accounting and restored locks are separate conditions.

## 8. Ordered work packages and acceptance gates

The execution goal should implement packages A through H as far as prerequisites allow, then deliver candidate artifacts and the consolidated gate list. Packages I/J are separately authorized qualification/publication stages. A blocked dependency must not prevent unrelated safe packages from progressing.

### Progress checkpoint — 24 September 2026

This table reports the isolated `codex/modular-trading-desktop` worktree from baseline `b7fd102d3c614c449fef15f5c143bdeb8d9b285c`. Results are for uncommitted candidate source until the final checks and scoped commit. The [M01–M16 source inventory](trading/IBKR_PAPER_ACCEPTANCE_QC.md#modular-trading-baseline-inventory--24-september-2026) is a feature map, not broker qualification.

| Package | State | Owner | Commit / tests | Artifact or blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| A Inventory and contracts | Independently reviewed | Inventory agent + coordinator | M01–M16 mapping; 13 Node domain fixtures passed | `MODULAR_CONTRACTS.md`; SDK redistribution/use clarification still external | Keep unsupported combinations blocked |
| B Shell and Trading extraction | Candidate implemented | Shell agent + coordinator | 13 focused standalone browser checks passed | Existing Plan/Positions/Journal reused; Connect/Trading/Journal only. Unused cloud auth code remains in compiled bundle, although startup needs no cloud project | Narrow static bundle further before public release |
| C Local session, storage and migration | Candidate implemented; operator proof open | Local-auth agent + coordinator | Local auth/profile/migration focused checks passed | One-use launcher capability, session, profile, dry-run assessor, synthetic ledger backup; Windows ACL and active data cutover unverified | Complete actual desktop/ACL/restore gates later |
| D Packaging and GitHub onboarding | Unsigned candidate in progress | Coordinator | PyInstaller package and isolated installer positive test; revised package retest pending | README and manifest prepared; no trusted public asset, signing, hash-locked dependency build, smooth second-launch handoff or update/rollback flow | Finish final package checks; retain public release gate |
| E Connect and broker adapter | Fixture walkthrough only | Shell agent | 13 focused browser tests; no broker calls | Missing SDK/TWS, environment, multiple-account and stale-response states are synthetic. No production adapter/account binding | Implement broker contract only when policy and vendor gates allow; keep locked |
| F Full planner gaps | Inventory/fixture partial | Inventory agent | Deterministic four-leg rejection/parity fixture passed | Shorts, GTC, overnight and four populated legs still blocked for broker execution | Implement and separately qualify each feasible family later |
| G Journal and recovery | Synthetic store proof partial | Inventory/local-auth agents | Ledger backup/replay and uncertainty fixture tests passed | Standalone Journal currently shows labeled sample records; no imported owner ledger or broker reconnect | Keep actual migration and reconciliation separate |
| H Candidate qualification | Source verified; final package check pending | Coordinator + independent reviewer | Final `npm run verify` passed: 208 Node, 327 backend, 96 browser; 2/5/3 skipped respectively | Direct source and first package browser pass; package revealed and repaired profile virtualization and missing Verification route | Rebuild and inspect the final exact-source package |

Packages I/J remain future broker qualification and approved publication; neither is completed by this checkpoint.

### A — Inventory and contracts

1. Recheck baseline/instructions/worktree state and establish the isolated branch.
2. Inventory actual controls and current backend support; update the acceptance matrix without replacing historical evidence.
3. Document module, identity, connection, ledger and packaging contracts; map legacy callers.
4. Record dependency/licensing feasibility and unresolved broker combinations before claiming an install promise.

Gate: reviewed inventory, dependencies, implementation boundaries and tests. Deliver a small documentation/contracts commit.

### B — Shell and Trading extraction

1. Extract Trading lifecycle/state from the all-workspace page without redesign.
2. Add Home, saved view choices, navigation and module manifest.
3. Route Trading and Journal to existing components over shared state.
4. Make unrelated module imports/background requests absent in standalone mode.
5. Add safe deactivation rules and draft-preserving navigation.

Gate: isolated ordinary controls work with other services unavailable; no unrelated network requests; original workspace still passes regressions. Direct frontend review at exact source.

### C — Local session, storage and migration tooling

1. Implement the local session provider as a separate deployment mode with server-selected policy.
2. Add launcher bootstrap, lock/relaunch, origin/host/CSRF checks and account-scoped state.
3. Implement private profile paths and versioned preferences without touching existing private installations.
4. Implement backup/import/restore tooling against isolated fixtures; create an explicit dry-run migration report.
5. Preserve cloud-backed mode and its existing authentication requirements; prove standalone startup makes no cloud auth request.

Gate: wrong-session/user/account tests fail closed; restored uncertainty/accounting preserved; no security gate is reclassified as passed merely because cloud code is not used.

### D — Packaging and GitHub onboarding materials

1. Build static assets and a private runtime package from pinned inputs.
2. Build per-user install/start/stop/shortcut/uninstall flows with single-instance checks.
3. Add explicit versioned update and rollback mechanics with schema compatibility checks.
4. Prepare the README landing experience and release manifest/notes/install command.
5. Prepare the optional static landing-page artifact locally, using existing branding, real sanitized screenshots, accessibility and one primary installation path. It must contain no authenticated trading UI, credentials or localhost control requests.

Gate: local candidate installs and opens without developer tools in an available isolated supported environment; missing clean-machine/signing evidence is documented, not invented. Install path and manual alternative point to the same package/version.

### E — Connect and broker-adapter separation

1. Implement setup screens and state transitions with fake local services.
2. Add SDK acquisition/compatibility guidance and allowlist checks.
3. Implement explicit account/environment confirmation and persisted binding.
4. Handle all connection failures and invalidation paths; retain approved order service and existing policy locks.
5. Implement production adapter code only through isolated contract tests until actual connection is permitted.

Gate: first-run and returning-user journeys pass fixtures, including multiple accounts, missing SDK, wrong environment and stale response. No real broker connection is used for independent completion.

### F — Full planner implementation gaps

Order: existing long lifecycle parity; complete allocation/runners/amendments; shorts; GTC; session/overnight support; permitted combinations.

For each feature: establish broker semantics from current official documentation; implement pure calculations and adapter validation; reproduce failure/race cases with isolated fixtures; independently review execution/accounting; leave real capability disabled until qualified. If broker semantics cannot support a requested combination, document the concrete incompatibility and continue other features. Do not invent an unsafe substitute or fake successful support.

Gate: every inventory row has a truthful status, implementation/test references or supported blocker; ordinary UI invokes the same command path. Full-planner completion remains open for unimplemented requested features and unobserved broker behaviour.

### G — Journal, recovery and operational polish

1. Connect local Journal storage to the existing durable projection.
2. Verify late fees, corrections, partial fills and deduplication across reconstruction.
3. Add recovery instructions for unknown commands, stale snapshots and incomplete history.
4. Complete safe shutdown/lock/pause explanations and backup/update status.
5. Add sanitized, user-reviewed diagnostics export with no credentials/private callbacks by default.

Gate: local restart and fixture recovery preserve accounting and command uncertainty. Do not call service reconstruction an OS restart or real broker reconnect.

### H — Independent candidate qualification and handoff

1. Run focused checks during work, full `npm run verify` for executable/release-ready changes, then packaged-product checks.
2. Perform exact-source direct frontend inspection and independent review of auth, execution, accounting and packaging changes.
3. Exercise installer on a clean Windows environment if available without new privileged operations; otherwise prepare the exact remaining operator test.
4. Verify release package contents and dependency/secret scans; preserve screenshot baselines.
5. Deliver local installer artifact, working preview, version/source identity, release materials and four-way evidence table.
6. Update the operator checklist with exact steps, expected outcomes, cleanup and evidence, including all unresolved signing/broker/manual gates.

Gate: all feasible independent checks pass; package limitations visible; no unresolved critical/high defect in enabled candidate functionality. This is the stop point for the unattended engineering goal when only external prerequisites remain.

### I — User-assisted paper and live qualification (future gated work)

1. Resolve the existing execution-policy rejection legitimately; no alternate adapter/profile is a workaround.
2. Complete applicable actual-desktop storage/access/backup/cutover checks and vendor fixes.
3. Confirm real paper identity/data/permissions and safely reconcile any existing owned state.
4. Use authenticated audited target amendment; retain the historical 2/30, original approvals and failed F scenario. SOFI remains zero.
5. Run ordinary-control paper acceptance, protection/closure first, then expanded features, concurrency and recovery.
6. Obtain separate revisions to acceptance quantity/coverage where needed; thirty trades alone cannot qualify every expanded combination.
7. Require flat/cleared/accounted/locked final proof.
8. Plan and obtain explicit authorization for live-mode configuration and supervised pilots only after prerequisites. No personal or public live trading is authorized by the engineering goal.

Gate: actual broker evidence and release decision for each feature. Testing later is acceptable, but untested functionality remains gated until then.

### J — Public release and future modules (future publication approval)

1. Obtain exact-commit push approvals, required Windows checks, separate merge/release/deployment approval and signing prerequisites.
2. Publish verified release assets and README links. Keep public hosting disabled until separately approved; do not re-enable the existing Pages workflow automatically.
3. Optionally publish the prepared static landing page only; it downloads the local application and never executes trades from github.io.
4. Have a second supported Windows installation follow public instructions without developer intervention.
5. Publish compatibility matrix, recovery guide, security reporting policy, contribution guide, dependency notices and changelog.
6. Add future modules through the same contracts only when each has its own completed acceptance; no placeholder module sales or arbitrary plugins.

Gate: actual download and installation path works for another user; documentation accurately matches the qualified release.

## 9. Test and evidence matrix

| Area | Required checks |
| --- | --- |
| Preservation | Existing planner/positions/Journal behaviour, saved values and keyboard interactions; no baseline updates without review. |
| Module isolation | Trading-only, Journal-only view choice, hidden Journal still records, inactive module sends zero requests, deactivation blocked during exposure. |
| Local security | Expired/replayed bootstrap; forged cookie/CSRF; cross-origin/host; different Windows user; wrong account/environment; port occupied by unrelated service; no cloud dependency. |
| Installer | Clean machine/no developer tools, spaces/non-ASCII paths, duplicate install/launch, offline startup, interrupted install, missing SDK, unchanged system runtimes. |
| Connection | TWS absent, API disabled/read-only, wrong port, duplicate client ID, multiple accounts, account change, stale response, data entitlement/freshness. |
| Execution | Every inventory family, invalid combinations, partial fills, duplicate clicks, stale reviews, cancellation races, acknowledgements, uncertainty and no retransmission. |
| Accounting | Duplicate/out-of-order execution events, late/unknown fees, corrected fills, shared Position/Journal results, history gaps and replay. |
| Durability | Consistent backup/restore, disk full, permission failure, interrupted migration, crash/restart, schema mismatch and rollback without losing new events. |
| Frontend | Desktop/mobile/desktop, keyboard/Escape/focus, invalid/disabled states, readable limits, no horizontal overflow, exact preview identity. |
| Packaging | Artifact source identity, dependencies/licenses, forbidden SDK redistribution, secret/path/record scan, actual manifest/hash/installer parity. |

Evidence classifications: deterministic, directly observed local/package, broker-observed, failed, blocked, unobserved. Include source version, time, environment, exact action and limitations. Historical test results are not verification of a refactored build. Do not conflate a demo fixture with the user's IBKR paper account.

## 10. Autonomy, agents and stop conditions

This document began as a handoff. The user subsequently authorized an execution goal. The coordinator should make routine implementation decisions within these contracts, persist through recoverable failures and advance to the next available package without asking per file/test.

Suggested independent agent boundaries after package A freezes contracts:

- Shell/UI agent: module registry, navigation, UI extraction; no execution/auth changes.
- Local-runtime agent: session/storage/packaging; coordinate common server contracts before edits.
- Trading agent: adapter/domain/accounting gaps using isolated fixtures; no real broker calls.
- Coordinator: integration, dependency decisions, documentation, whole-product checks and final review. Use an independent reviewer for each security/execution boundary; do not have authors certify their own work alone.

Respect available agent slots. Assign disjoint files or isolated worktrees; serialize edits to shared contracts and the same runtime/test ports. Do not delegate the same package to two execution chats. Every package returns changed paths, source/commit, tests, known gaps and integration instructions. Sub-agents inherit all broker and publication boundaries.

Maintain a progress table in this plan: package, state, owner, commit, tests, artifacts, blocker, next action. Use states not started / in progress / independently verified / needs operator / external blocker. Update at checkpoints, not after every command. Produce a durable handoff before context or usage limits interrupt work.

Continue independent work when an operator test is unavailable. Request a decision only for genuine scope conflicts, paid purchases, unavailable privileged actions, exact-commit publication/release approvals or changed trading limits. Record them together in OPERATOR_ACTIONS. Never treat a timeout, another agent's opinion or prior unrelated approval as consent.

Current independent restrictions: no real broker connection/submission, target amendment, live config enablement, active-service cutover, cloud fixture/account creation, paid upgrade, push, merge or deployment without the applicable later authorization. Keep the previously rejected service/submission action and rejected cleanup blocked. Do not build a parallel service to evade that boundary.

## 11. Definition of independent completion

- [ ] Plan/feature inventory and interface decisions recorded.
- [ ] Existing UI/logics reused; deviations justified with defect or setup need.
- [ ] Shell offers Trading and Journal views over shared accounting.
- [ ] Local session and storage work without cloud credentials.
- [ ] Brontide installer/launcher candidate opens the browser without developer tools in tested conditions.
- [ ] Guided TWS setup and account confirmation implemented and fixture-tested.
- [ ] Full-planner engineering coverage status recorded; unverified real execution remains locked.
- [ ] Journal/recovery/backup/update behaviour tested with isolated durable fixtures.
- [ ] GitHub README, versioned install instructions and optional static landing preview prepared honestly.
- [ ] Full required verification, direct UI checks and independent reviews complete.
- [ ] Local commit/artifact/source identities and preview URL reported; unrelated files preserved.
- [ ] Remaining user/vendor/policy/signing/publication gates consolidated with executable procedures.

Do not mark a whole-roadmap goal complete when only this candidate exists. Name the goal **independent modular Trading candidate**, and report the remaining release qualification separately. Do not promise the candidate can execute real trades until broker prerequisites and policy gates actually pass.

## 12. Model recommendation and execution prompt

Recommendation: GPT-6 Sol with high reasoning for the coordinating execution task; use xhigh/max selectively for difficult security or execution findings rather than for every UI change. This is a workload recommendation, not a guarantee of autonomous success. Sub-agents should inherit the selected model by default unless the user explicitly chooses otherwise. Current official guidance describes Sol as built for complex coding/agentic work and supports high reasoning. Tool access, runtime availability, usage limits and approvals still constrain execution.

Copyable next-task instruction:

> Read `C:/Users/melvi/Projects/Journal/docs/trading-modular-product-plan.md` and applicable repository instructions. Create a goal for the independent modular Trading candidate described there, not for unqualified live trading. Implement packages A-H, progressing autonomously through all work that has prerequisites. Use sub-agents for bounded independent tasks and independent reviews. Reuse the existing Trading/Positions/Journal UI and domain logic; add only the shell/setup/packaging/recovery UI required by the plan. Begin from verified merged main in an isolated codex worktree; preserve all unrelated work and private records. Deliver a working local preview, installer candidate, GitHub README/download materials, scoped local commits and exact verification evidence. Keep real broker access, submission locks, active-service cutover and external publication behind their existing gates. Do not claim user/broker tests passed; consolidate them in OPERATOR_ACTIONS and continue unrelated work. Follow the plan's explicit completion criteria, record blockers and checkpoint progress. No push, merge or deployment without their applicable approvals.

## 13. Sources and interpretation

- [IBKR TWS requirements](https://www.interactivebrokers.com/docs/tws-api/doc/download-tws-or-ib-gateway/download-tws-or-ib-gateway): TWS or IB Gateway prerequisite; not evidence of automatic login or qualification.
- [IBKR API configuration](https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/): API settings, read-only setting and configurable socket ports.
- [Official SDK license/download](https://interactivebrokers.github.io/): user acceptance and redistribution restriction; do not assume our MIT license covers vendor code.
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol): coding/agentic model and reasoning support.
- [Codex sub-agents](https://learn.chatgpt.com/docs/agent-configuration/subagents): bounded delegation and model configuration.

Repository facts were inspected while planning. Product architecture, work-package sequencing and model reasoning level are recommendations. No estimate, benchmark or source guarantees this product is safe for live money; release decisions depend on the defined evidence.
