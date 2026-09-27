# Brontide Modular Desktop — execution handoff and product roadmap

Prepared: 24 September 2026. Status: execution in progress on `codex/modular-trading-desktop`; this document is the roadmap, current evidence record and handoff for a later execution model. The user's later execution instruction authorized independent engineering work, while the broker, publication and active-service boundaries below remain in force. Read the current checkpoint before assuming any older result applies to the working tree.

## 1. Read this first

Build an installable Windows application that opens a local browser interface. Reuse the existing Trading UI, calculations, execution safeguards and Journal. Introduce a small shared shell, local identity, guided connection setup and packaging so Trading can operate independently of the other workspaces. Do not redesign the planner or start over.

The public product is **Brontide**. Keep the existing `Melvinroy/Journal` GitHub repository, MIT license and history. A repository rename, new repository, cloud-hosted trading service or paid account change is not part of this plan.

Two outcomes must remain separate:

1. **Independent engineering completion:** working local installer candidate, reusable module shell, local-only identity, preserved Trading/Journal UI, guided setup implemented against fixtures, all feasible code and automated checks completed, GitHub landing/download materials prepared, and an exact operator/broker handoff. No real broker account is required to finish this engineering package.
2. **Trading release qualification:** required operator security checks, permitted real paper acceptance, supported dependency resolution and separately authorized live qualification. This cannot be certified by fixture tests or by the user's decision to test later.

The user wants the full planner eventually: not merely a narrow long-limit product. Preserve that requirement. The installable candidate may be delivered before broker qualification only if unverified capabilities remain disabled for real execution and are clearly labelled. Do not call the entire full-planner product complete while such gates remain.

### What success looks like, in order

1. **Reusable local product:** one application shell lets a user select Trading and Journal. It reuses the present Plan, Positions, Journal, trading-domain and ledger code; it does not rewrite them into an unrelated second app. A sample mode is visibly separate from account records and never submits orders.
2. **Installable candidate:** a normal Windows user can install and reopen an exact, versioned, locally authenticated build without Git, Node or Python. Connect explains TWS and SDK prerequisites. This candidate may remain execution-locked; that status must be conspicuous in the UI and download instructions.
3. **Trusted public download:** an approved GitHub release and landing/README lead to the same immutable installer and verified install command. Publisher provenance, clean-machine proof, dependency/license decisions and required publication approvals must pass first. A prepared landing page or unsigned ZIP is not this milestone.
4. **Paper-capable personal release:** after the existing execution-policy block is legitimately resolved, the owner completes applicable desktop/security checks and demo-account broker acceptance through the ordinary controls. Account/environment confirmation, protection, recovery and Journal reconciliation must be broker-observed. The owner can test with the demo account later; that deferred test does not prevent unrelated engineering, but it prevents claiming this milestone now.
5. **Live and broad public trading release:** each enabled feature has a reviewed release decision, supported dependency and evidence at the appropriate account/environment. Live configuration, a supervised pilot and public broker-enabled distribution require separate approval. A working local web page or thirty paper round trips alone cannot qualify this milestone.

The desired end journey is: get Brontide from GitHub, install it, choose Trading and Journal, open local TWS, explicitly confirm the exact account and environment, review/confirm an order, and see broker-confirmed Position and Journal updates. The engineering agent may finish safe prerequisites autonomously. It cannot guarantee this entire journey without the external gates in milestones 3–5; it must stop with an exact handoff where those gates apply.

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
- Brontide release assets must exclude official IBKR SDK code unless version-specific redistribution rights are established. IBKR's [10.49+ GPL changelog](https://www.interactivebrokers.com/docs/tws-api/changelog/2026/8/3) and [current non-commercial download terms](https://interactivebrokers.github.io/) present a licensing conflict for the planned package; do not infer the answer from either page alone. Guided setup opens the official download/license route, accepts a user-provided supported SDK package, verifies compatibility, and installs it into Brontide's private dependency area only after user consent. No silent acceptance of third-party terms.
- A read-only check of the separately installed `ibapi 10.50.2` distribution used in the earlier paper checkout on 25 September found `License: GPL-3.0-or-later` and `Requires-Dist: protobuf==5.29.5`. This is package metadata, not independent provenance, a resolution of the conflicting official download terms or permission to redistribute it. The modular candidate environment itself has no `ibapi` installed.
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

The [four-part order-scaling review](trading/ORDER_SCALING_REVIEW.md) records a **candidate** first expansion to four one-share slots, separate protected OCA groups, a conservative application message budget, and an explicit amendment when fewer than four shares fill. Shared fixtures cover four-leg arithmetic. An isolated fake-broker lifecycle test covers four protected slots, independent OCA targets, and one-, two- and three-fill paths that retain stops until a reviewed smaller-leg amendment. Pacing, four-slot real-broker behavior, installed controls and approval of any larger paper limit remain open. The enforced three-share limit and submission lock are unchanged.

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

The execution goal should implement packages A through H as far as prerequisites allow, then deliver candidate artifacts and the consolidated gate list. Packages I/J are separately authorized qualification/publication stages. A blocked dependency must not prevent unrelated safe packages from progressing. Use the [MD01–MD08 GitHub-to-Journal overlay](trading/IBKR_PAPER_ACCEPTANCE_QC.md#modular-github-to-journal-journey--release-acceptance-overlay) alongside M01–M16 to judge the complete installed-user journey; a shell or fixture pass alone does not pass that overlay.

### Progress checkpoint — 24–25 September 2026

This table reports the isolated `codex/modular-trading-desktop` worktree from baseline `b7fd102d3c614c449fef15f5c143bdeb8d9b285c`. The last locally committed source is `d488631eb4e8002091a665bfef7093df3acb1464`; later scoped edits are **uncommitted and not fully verified**. An extracted `d488631e` ZIP was installed and inspected locally. The [M01–M16 source inventory](trading/IBKR_PAPER_ACCEPTANCE_QC.md#modular-trading-baseline-inventory--24-september-2026) is a feature map, not broker qualification.

| Package | State | Owner | Commit / tests | Artifact or blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| A Inventory and contracts | Independently reviewed | Inventory agent + coordinator | M01–M16 mapping; domain fixtures passed | `MODULAR_CONTRACTS.md`; SDK redistribution/use clarification still external | Keep unsupported combinations blocked |
| B Shell and Trading extraction | Installed sample candidate; later route isolation edits unverified | Shell team + coordinator | `d488631e` installed; later profile-scope tests added but not browser-run. ZIP scan found cloud auth references; build-boundary fixture rejected the old package. Cloud screens, icon and cloud trade/session gateway were extracted on the later tree; syntax and a focused static-import boundary test passed | Existing Plan/Positions/Journal reused. The standalone entry has no static runtime path to cloud auth in the inspected source, but emitted chunk/archive isolation and cloud behavior have not been verified | Inspect a rebuilt archive and run exact-source cloud/standalone browser and network checks after the generated-file gate is legitimately resolved |
| C Local session, storage and migration | Candidate implemented; operator proof open | Local-auth team + coordinator | Local auth/profile/migration focused checks passed on earlier source; offline snapshot boundary fixtures passed | One-use launcher capability, session, profile, dry-run assessor, synthetic ledger backup; a later full-scope temporary restore retained profile, account choice, plan and recorded history. An unmounted offline helper copies the stopped profile and consistent ledger into one verified snapshot; Windows destination ACL, installed operator restore and active data cutover remain unverified | Complete actual desktop/ACL/restore gates later; do not expose the helper before those pass |
| D Packaging and GitHub onboarding | Unsigned `d488631e` lifecycle candidate locally installed; later interruption, concurrency, cloud-code and console-reopen guards uncommitted | Coordinator + lifecycle team | Earlier installed-user ZIP proof; isolated lifecycle and whole-stage asset-boundary fixtures pass. A one-use console reopen passed a focused token test but is unbuilt. A proposed route-asset selector was withdrawn after independent review found successive omission cases. A later full backend run exposed and a focused fix resolved a Windows first-launch lock race; the old ZIP still contains cloud auth code | README and manifest prepared; local static landing drafted. Candidate packager copies the complete static export and rejects known cloud-auth signatures anywhere in it; this may reject an orphan cloud chunk but cannot silently hide a required asset. No current-source build or package, trusted public asset, signing, clean-machine or smooth second-launch proof | Rebuild and inspect an actual candidate only after the verification gate is legitimately resolved; retain public release gate |
| E Connect and broker adapter | Synthetic walkthrough, read-only SDK metadata, private binding/read view, masked Connect display, account discovery, session-bound selection, owner-attested paper-reference guard and candidate ledger-scope bridge in later source; browser verification open | Coordinator | Focused account/reference/ledger tests passed 51; earlier guarded selection-route/account/standalone run passed 69, 2 skipped. Shared browser binding parser/Journal projection 37 passed. No real broker calls | Account confirmation, status, ledger preparation and offline backup now require a schema-2 binding linked to the exact private owner reference digest, but no owner account was actually attested. Connect can display a remembered, masked choice but cannot prove current TWS connection. Selection remains unavailable in the installed candidate because no paper-environment corroboration provider is installed. SDK support, account evidence and multi-account behavior remain mocked | Run current-source browser/package checks after legitimate verification-gate resolution; then complete supported SDK/environment verification and real read-only integration under existing policy gates |
| F Full planner gaps | Inventory/fixture partial | Inventory + parity team | Four-leg rejection fixture and whole-share runner protection regression passed earlier | Shorts, GTC, overnight and four populated legs still blocked for broker execution | Implement and separately qualify each feasible family later |
| G Journal and recovery | Protected recorded-history route and normal Journal read path drafted; later Plan & Position source reads the same history while keeping saved broker state explicitly stale | Coordinator | The recorded reader rejects mixed/legacy ownership, preserves uncertain commands and unknown fees, and never claims flat exposure. New ledger preparation checks the private paper reference and preserves existing bytes if it vanishes. A fresh test service process denied an unauthenticated read, then returned an artificial campaign through the protected route with unknown fee/exposure and unresolved command intact; 52 focused account/reference/ledger tests passed. A later 32-test isolated restore run proved that a SQLite copy plus its exact scope marker preserves artificial history, unknown fees/exposure, unresolved commands and immutable saved-plan revisions, while a changed copied revision is rejected. A later temporary full-private-scope restore reopened the copied profile, paper reference, account binding, saved plan and recorded campaign together with unknown fee/exposure and command uncertainty preserved; the related suite passed 136 tests, two skipped. The shared Journal/Position projection run passed 22 Node tests and changed TypeScript/Playwright source passed syntax parsing; browser cases are written but unrun. Full latest-source verification pending | The installed runtime does not provision a real ledger marker. The newer Position and Journal views share recorded rows and do not substitute sample positions when bound history fails, but the installed sample is older and no owner backup, real ledger, installed restart or broker reconnect has been inspected | Verify private ledger ownership and current-source TypeScript/browser/package evidence after the generated-file gate is legitimately resolved |
| H Candidate qualification | Earlier source verified; latest source not yet qualified | Coordinator + independent reviewers | On the current uncommitted tree, the latest `npm run verify` passed 242 Node tests (2 skipped) and 618 backend tests (7 skipped; one Starlette warning), then failed TypeScript parsing malformed `.next/dev/types/routes.d.ts` lines 58–63. Recorded Journal now also rejects unknown command actions and a batch approval attached to a campaign; 110 focused restore, recorded-store and Journal tests passed. The local recorded-history route also requires the unchanged private owner paper-account reference; its new deletion/race regressions pass, while exact broker identity remains unverified. Browser/build were not reached. An older binding fixture was corrected; recorded Journal rejects contradictory or missing economic evidence and unknown future event versions; audited recovery now replays the current versioned event format and refuses unsupported future formats; a shared temporary ledger test now agrees with the paper service's real order-write command shape; the paper store refuses a future schema before DDL; a first-launch profile-lock race was corrected; an unmounted offline snapshot helper passed isolated boundary checks; and both local view-write routes now hold the session through their writes after red-before-green concurrent-lock tests. The synthetic broker-hours fixture was made midnight-safe after a prior full run found ten time-dependent failures. A fake-broker four-slot lifecycle test passed for one through four fills with a test-only raised cap, and a three-share interruption fixture retained uncertainty when the protective-stop write lost its response; real protection and order pacing remain unverified. The private saved-plan route and Connect screens are not in an installed package. These two passing stages do not count as a five-stage pass | Automatic approval review rejected removal of that generated file (`blocked by policy`); do not retry, replace, regenerate or route around that action. Last installed `d488631e` preview is older than edits | Await a legitimate external resolution of the policy/file state, then run full verification and exact-source package/browser review |

Packages I/J remain future broker qualification and approved publication; neither is completed by this checkpoint.

**Recorded-data update boundary:** package D's locked sample manifest accepts store schema 0, whereas package G's prepared paper ledger uses SQLite schema 1. The newer, unpackaged source now makes the executable's read-only update preflight reject an existing recorded-ledger directory. It also refuses first-launch identity creation when a profile file is missing beside other private state; the fixed-label support report uses the same check. Fifty-two focused profile/launcher/standalone tests passed with two skips. The installed `d488631e` sample predates those guards. These refusals do not qualify a broker-backed update or rollback. Before a broker-enabled package is offered, add an explicit store-version transition with consistent owner-scoped backup/restore, downgrade refusal and active-exposure/uncertain-command checks. Existing sample lifecycle passes are evidence only for the locked sample.

The later unqualified Connect source now gives a locally authenticated owner a paper-account reference form and protected status/save route. It requires the same independently checked account ID twice and an explicit confirmation, stores only the existing masked/digested private reference, and leaves TWS, broker account selection, review and submissions locked. Focused local route/parser checks pass; authored browser flows, a rebuilt package and any real IBKR account observation remain unverified. This is owner setup for package E, not paper identity proof or broker acceptance.

The current unqualified Connect source also exposes the existing masked account-review route through the ordinary setup screen, but only when the authenticated binding status reports a server-owned evidence provider, a private owner paper reference and no existing binding. The backend refuses to call that provider before the reference exists or after a binding already exists, and rechecks after discovery so a changed reference or binding cannot create a new review. The installed sample reports the provider unavailable and shows no review action. The owner selects a visible mask and types the exact full account ID; the service resolves that ID against the fresh observed list and independently recorded owner reference, so two accounts with the same mask remain distinguishable without exposing full IDs in the page. An unobserved or wrong-owner ID fails. The service still corroborates paper identity and preserves the submission lock. A lost confirmation result leads to a read-only, authenticated exact-account check against the saved binding and owner reference, never an automatic repeat or a mask-only success claim. The latest focused checks passed 54 backend tests with one skip and one dependency warning, five Node parser tests and syntax parsing of affected TSX/test source; the changed rendered wording and browser regression remain unrun. Full current-source verification, a rebuilt app, supported SDK verification and real paper-account evidence remain open.

An unmounted server-owned evidence bridge now has an isolated two-read contract: it requires explicit SDK approval and the owner's unchanged private paper reference, validates a fresh bounded account list twice from the same loopback source with distinct observation generations, and refuses changed accounts or an already-bound profile. Nine direct bridge tests passed, and the broader focused account group passed 102 with one skip. It returns account-selection evidence only; the paper identity is an owner attestation matched to a broker list, **not** an independent API proof of paper mode or current broker reconciliation. The installed launcher has no provider and no real TWS call was made. The latest full verification passed 242 Node tests (two skipped) and 589 backend tests (seven skipped), then stopped at the previously policy-blocked generated TypeScript file before browser and build checks.

The bridge was also exercised through the ordinary protected local account-review and confirmation routes, still with fake account lists. An isolated test proved the masked review, exact saved account choice, no duplicate corroboration read, disconnected submission lock and refusal when the local session is locked. Twenty-two focused route/bridge tests passed. The latest full run passed 242 Node tests (two skipped) and 591 backend tests (seven skipped), then stopped at the same generated TypeScript file. This is route integration evidence, not an installed Connect screen, real paper-account observation or broker permission.

The read-only SDK metadata warning previously recognized only protobuf 5.29.5 even though [the reviewed advisory](https://github.com/advisories/GHSA-7gcm-g887-7qv7) lists affected versions below 5.29.6 and 6.30.0rc1 through 6.33.4. The diagnostic and browser-side report validator now recognize the advisory's exact **numeric** pin ranges; prerelease pins still remain unclassified and execution locked. A regression first reproduced the missed affected pins. Focused SDK/standalone checks passed 31 with one skip, and two Node parser tests passed. The latest full run passed 242 Node tests (two skipped) and 592 backend tests (seven skipped), then stopped at the same generated TypeScript file. No SDK was installed, overridden or approved, and the updated Connect warning lacks exact-source browser inspection.

The recorded Journal reader now refuses unfamiliar future execution-event versions instead of ignoring them. Two temporary-ledger regressions first proved that an `exec-v2` event could otherwise leave the screen saying **No records** or show a projected trade as complete. The reader reserves the entire `exec` event-key namespace and fails closed on an unsupported version without modifying saved evidence. The focused Journal/recorded-ledger/saved-plan group passed 102 tests. The latest full run passed 242 Node and 594 backend tests, then stopped at the unchanged generated TypeScript file. This is a source-level integrity repair, not installed-app or broker reconciliation evidence.

An isolated fake-broker lifecycle fixture temporarily raises the share cap to four for one test only. It proves that the existing service emits four separate entry/stop pairs with distinct OCA groups, assigns two targets and two runners after four confirmed fills, and cancels only the first slot's stop when its target fills. With three fills, it retains the filled slots' stops, leaves allocation pending and refuses to apply a three-leg exit amendment without recorded approval. Both parametrized cases passed. The latest full run passed 242 Node and 596 backend tests, then stopped at the unchanged generated TypeScript file. The production three-share cap, submission lock, pacing gap and broker-observation gate are unchanged.

A separate three-share fake-broker interruption fixture now pauses between the untransmitted entry parent and protective stop. It covers a stop rejected before the fake broker accepts it and a stop accepted with a lost response. Both cases retain the durable command and reconciliation state; repeating the command, attempting a different entry and running managed rules send no additional order. Reopening the isolated ledger retains the pending state. A complete fake snapshot can acknowledge the accepted first stop, but the unsent remaining brackets keep the campaign in reconciliation; the unaccepted stop remains uncertain. The complete paper lifecycle file passed 52 tests with four skipped; the latest full run passed 242 Node and 598 backend tests, then stopped at the unchanged generated TypeScript file. This is not connected TWS protection evidence and does not clear the submission lock.

Recorded Journal now requires every projected fill in a new private ledger to have a matching durable execution event. Two artificial-ledger cases first showed that a missing event could still make partial or complete history look credible; both fail closed after the repair. The fixture source remains separate. A related audited-recovery case first showed that the current `exec-v1` format was not replayed when the fake broker had no historical execution to return; recovery now reads the supported legacy and versioned formats and refuses an unfamiliar future format. The affected focused group passed 186 tests with four skips. The latest full run passed 242 Node tests (two skipped) and 602 backend tests (seven skipped; one Starlette warning), then failed TypeScript on the same unchanged malformed generated file. These are isolated ledger and fake-broker results, not connected recovery, installed Journal evidence or current-source five-stage qualification.

A new service-to-Journal fixture now uses one prepared private temporary ledger instead of hand-constructing only the projected campaign. The fake paper service writes its approval, one-share bracket, entry and target exit; the recorded Journal reader then reads that same database. The first run failed because actual order-write commands use a top-level `role`, while the reader accepted only top-level `action`. The reader now recognizes only the known order-write roles with a bounded order ID and required order fields, and new negative tests reject an unknown role or invalid ID. The position-facing service summary and Journal agree on entered/exited/open shares, gross result, fees, net result and R for the open and closed trade. With the exit fee absent, both retain unknown net P&L; a late fee updates the same record without a duplicate trade. After writer shutdown, a fresh authenticated local session reads the closed result through the protected Journal route. Current exposure and order clearance remain unknown. The affected group passed 161 tests with four skips; the extended case passed directly. Full verification passed 242 Node tests (two skipped) and 605 backend tests (seven skipped; one Starlette warning), then stopped at the same blocked generated TypeScript file. This is a deterministic integration check, not broker evidence or an installed ordinary-control journey.


The isolated four-slot lifecycle fixture now also covers one and two confirmed fills before the unfilled entries are cancelled. In all one-, two- and three-fill paths, confirmed shares retain their stops, managed targets remain paused while the original four-leg allocation is impossible, and applying the smaller exit plan requires its recorded approval. All four parametrized cases passed; the complete lifecycle file passed 56 tests with four skips. The current full verification passed 242 Node tests (two skipped) and 607 backend tests (seven skipped; one Starlette warning), then stopped at the same policy-blocked generated TypeScript file. The production three-share cap remains unchanged. This is fake-broker evidence only, not a real partial-fill race, installed app or submission permission.


A further fake-callback fixture now covers an exact owned entry fill arriving after all entry-cancellation acknowledgements. The campaign is first Closing because broker-style stops remain outstanding; after the delayed execution it shows one open, stopped share. The original three-leg allocation remains pending, automation sends no new target, and replay does not duplicate the fill. The complete lifecycle file passed 57 tests with four skips. Full verification passed 242 Node tests (two skipped) and 608 backend tests (seven skipped; one Starlette warning), then stopped at the same blocked generated TypeScript file. This is deterministic callback-order evidence only; actual broker fill/cancel timing and the rebuilt Position/Journal view remain unverified.

**Normal Save plan remains a qualification gate.** The installed `d488631e` candidate retains sample-scoped browser drafts and has no confirmed paper binding or prepared ledger. In later unqualified source, `WorkspaceApp` first checks recorded paper history and an opaque profile/account/ledger scope; only then does the ordinary `TradePlanner` Save plan or Save exits button use protected private draft routes. Missing evidence hides plan fields and disables those saves; scope changes remount the planner, while a successful same-scope recheck may restore an in-memory unsaved draft. Interrupted writes require a read-only reopen, and the account-backed mode has no simulated intent or order-review control. Sample drafts stay in the browser-only mode and cannot be copied into the paper ledger by relabelling their pricing. Focused service and client tests pass, but the changed UI regression has not run and the generated-file block prevents current-source TypeScript, browser and package qualification. No installed account or broker behavior has been demonstrated; review and submission remain locked.

A further source-only saved-plan check now prevents stale account-wide plan switches as well as stale updates within one plan. Every fresh revision, including a distinct plan ID, requires the latest active revision observed by the ordinary client; a changed or missing version is rejected inside the private ledger transaction. An identical saved revision can still be acknowledged safely after an uncertain response. Older revisions cannot be replayed to reactivate a plan, and missing active pointers or unidentifiable orphan heads stop later saves. This passed focused service/client fixtures and an independent source review with its identified gap corrected, but not current-source full verification, an installed multi-tab flow or broker evidence.

The later unqualified accounting source now computes each exit from shares held at that fill, so a later entry cannot reprice an earlier realized result. Ambiguous broker fill ordering stops managed rules and the acceptance count; an entry/exit sharing a timestamp after shares were held also requires protection review. The local recorded-history reader keeps an explicitly reconciliatory campaign's shares and known fees visible while withholding an unprovable cost basis or profit. It rejects an ordinary open-state label for a later entry after an exit, and the browser adapter enforces the same state boundary. Focused Python and Node regressions pass, but current-source full verification, exact-source browser review, installed-app behavior and broker evidence remain open. No paper submission was enabled by this work.

The later unpackaged desktop source adds a second-shortcut **reopen request**. The first process creates a same-session Windows event only after owning the profile mutex; a second launcher can signal that event but cannot obtain the port or one-use browser authorization. The owner opens any new browser session and remains the only service. Isolated Windows tests pass, but the current-source installer and direct user flow have not been qualified, so package D remains incomplete.

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

The installed `d488631e` package exposed a concrete build-boundary gap: `app/standalone/page.tsx` imports the same `WorkspaceApp.tsx` as the cloud route. That shared file directly imports `lib/supabase.ts`, contains the cloud sign-in/setup screens, and performs cloud session and trade loading. Disabling those paths at runtime did not remove their compiled code from the standalone archive. The later asset checker intentionally refuses the old package. Close this in the following order, without copying the planner or creating a second accounting engine:

1. Extract shared Trading/Journal presentation and state into cloud-independent components. Keep the existing `TradingWorkspace`, domain calculations, Journal presentation, draft scope and accessibility behavior as the single implementations. Preserve existing cloud behavior behind a cloud-specific wrapper. The unverified source slice moved the cloud sign-in/setup screens into `CloudAccess.tsx` and the shared icon into `WorkspaceIcon.tsx`.
2. Put Supabase initialization, cloud session/recovery and cloud trade I/O behind the cloud route's entry point. The standalone route must not import them transitively. The later source slice now has a type-only cloud contract, a cloud-only gateway and `CloudHome.tsx`; the shared `WorkspaceApp.tsx` receives the gateway instead of importing `lib/supabase.ts` at runtime. `app/page.tsx` conditionally loads `CloudHome` outside the standalone build. This is a source-level separation, not yet a verified emitted-asset boundary or cloud-login regression pass.
3. Deliver only standalone and Verification route assets in the eventual Windows release. The present candidate packager copies all `_next` assets and rejects known cloud-auth signatures across that complete set; it must fail rather than hide an orphan cloud chunk. A proposed literal-reference selector was withdrawn because independent review found valid CSS/runtime assets it could silently omit. Inspect the actual emitted graph and choose a proven route-only build or complete dependency manifest before narrowing the copied set. The asset-boundary checker must pass without weakening its signatures.
4. Prove both modes independently: cloud sign-in/setup/Journal regressions continue to pass, while standalone cold start and Trading/Journal navigation make no cloud requests and include no known cloud-auth code in the packaged assets. Verify the exact source identity and draft/focus behavior in a browser at desktop and mobile widths.

This is cross-cutting executable/frontend work. The current generated-file policy rejection prevents its required full verification and exact-source preview; do not bypass that rejection to claim the split complete. Keep the previously installed candidate labelled as locked sample evidence only.

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
3. Implement explicit account/environment confirmation and persisted binding. IBKR states its TWS API cannot distinguish live from paper logins and the default paper port is configurable; require an independently owner-verified paper-account reference matched to a fresh TWS account observation. An account prefix, port, remembered label or browser claim cannot set `paper_identity_verified` or unlock orders. If the reference is unavailable, keep the provider absent and the candidate locked.
4. Handle all connection failures and invalidation paths; retain approved order service and existing policy locks.
5. Implement production adapter code only through isolated contract tests until actual connection is permitted.

Gate: first-run and returning-user journeys pass fixtures, including multiple accounts, missing SDK, wrong environment and stale response. No real broker connection is used for independent completion.

### F — Full planner implementation gaps

Order: existing long lifecycle parity; complete allocation/runners/amendments; shorts; GTC; session/overnight support; permitted combinations.

For each feature: establish broker semantics from current official documentation; implement pure calculations and adapter validation; reproduce failure/race cases with isolated fixtures; independently review execution/accounting; leave real capability disabled until qualified. If broker semantics cannot support a requested combination, document the concrete incompatibility and continue other features. Do not invent an unsafe substitute or fake successful support.

Gate: every inventory row has a truthful status, implementation/test references or supported blocker; ordinary UI invokes the same command path. Full-planner completion remains open for unimplemented requested features and unobserved broker behaviour.

### G — Journal, recovery and operational polish

1. Connect local Journal storage to the existing durable projection.
   - First prove a private mapping between the confirmed local account digest and the older paper ledger's configuration digest. They are computed from different inputs; never infer ownership from a matching label or folder. Require local profile, exact account and paper environment, and fail the entire read on missing or mixed scope.
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

- [x] Plan/feature inventory and interface decisions recorded.
- [x] Existing UI/logics reused; deviations justified with defect or setup need.
- [x] Shell offers Trading and Journal views over the reused accounting components; the installed build remains sample-only.
- [x] Local session and standalone preference storage work without cloud credentials; Windows ACL proof remains external.
- [x] Brontide installer/launcher candidate opens the browser without developer tools in the tested installed-user context; clean-machine proof and authenticated second-launch handoff remain open.
- [x] Guided TWS setup and account-choice walkthrough fixture-tested; it neither binds an account nor contacts TWS.
- [x] Full-planner engineering coverage status recorded; unverified real execution remains locked.
- [ ] Journal/recovery/backup/update behaviour fully tested with isolated durable fixtures; a new synthetic adapter is still unmounted.
- [x] GitHub README and versioned candidate install instructions prepared honestly; optional static landing is drafted locally and not published.
- [ ] Full required verification, direct UI checks and independent reviews pass for the latest source. Earlier `d488631e` installation proof does not cover current uncommitted edits.
- [x] Local commit/artifact/source identities and preview URL reported for `d488631e`; unrelated files preserved.
- [x] Remaining user/vendor/policy/signing/publication gates consolidated in `docs/trading/OPERATOR_ACTIONS.md`; external proof remains open.

### Current source and evidence checkpoint

| Source | Directly supported result | Limit |
| --- | --- | --- |
| `d488631eb4e8002091a665bfef7093df3acb1464` | A locked unsigned Windows ZIP was installed in a separate proof root; exact preview `http://127.0.0.1:52939/standalone/` shows `d488631e`. Prior full verification and desktop inspection applied to this committed source. | It is sample-only and older than the later edits; it cannot place orders. |
| Current uncommitted modular worktree | The newest full verification passed 242 Node tests (2 skipped) and 631 backend tests (7 skipped, one dependency warning), then stopped at TypeScript. Three recorded-command fixture cases now reject malformed submit or approval bodies and a submit referencing another batch; two failed before the fix. The focused Journal, recorded-store, saved-plan and lifecycle group passed 173 tests (4 skipped). An authenticated failed account rediscovery now retires the previous review before its broker read; 37 focused account-selection and route tests passed after the failing regression. Recorded Journal rejects unknown command actions and batch approvals misattached to campaigns; missing or changed owner paper references make its protected history unavailable. Private saved-plan reads and writes now require the same exact reference link; two temporary-ledger cases failed before repair, and 139 related tests passed with one skip. The locked-candidate preflight refuses unfamiliar private files and now validates known setup files and the exact binding-to-reference link; four temporary-profile cases failed before that repair, and 90 related tests passed with three skips. A red-to-green account-status check first refused visibly different owner-reference masks (42 related tests, one skipped). A second failing same-mask case led to binding schema 2, which links the saved choice to the exact original owner reference digest; Connect, recorded Journal and offline backup now reject a changed reference despite an identical mask. The related group passed 214 tests with three skips; unlinked schema-1 records remain preserved and unavailable pending audited migration. Malformed commands, orphan economic events, conflicting versioned fill details and mismatched fee reports also make recorded history unavailable; isolated restore, first-launch locking, future-schema rejection, offline backup and view-write session checks have passed at their stated fixture scope. | TypeScript stopped on the malformed generated `.next` type file. Current Connect, Position and corrected Journal notices have not passed exact-source browser or packaged-product checks. Schema-2 stored identity is linked to the original owner reference, but the actual broker account and current exposure still require fresh reconciliation; destination ACL, operator restore and broker evidence remain open. A rejected cleanup must not be retried or bypassed. |
| Historical paper evidence | Two broker-confirmed round trips total (NVDA and F). | F protection remains a failed scenario; SOFI cancellation contributes zero. The 200-target session remains halted and cannot be resumed under the 30-total goal. |

Next handoff order: review the current scoped diff; resolve verification only through a legitimate path that leaves the rejected generated file untouched; run full required checks and exact-source frontend inspection; commit/package only verified source; update the candidate and operator records. Then continue independent broker-contract, Journal-binding and installer work where safe. Preserve all unverified and external gates as open. No exact-source current build may be called passed based on `d488631e` results.

Do not mark a whole-roadmap goal complete when only this candidate exists. Name the goal **independent modular Trading candidate**, and report the remaining release qualification separately. Do not promise the candidate can execute real trades until broker prerequisites and policy gates actually pass.

## 12. Model recommendation and execution prompt

Recommendation: **GPT-6 Sol with high reasoning** for the coordinating execution task. It suits sustained coding and verification; use a stronger independent review for a difficult security or broker-boundary decision if available. This is a workload recommendation, not a guarantee of autonomous success. Sub-agents should inherit the selected model unless the user explicitly chooses otherwise. Tool access, runtime availability, usage limits, approval boundaries and real broker evidence still constrain completion.

Copyable next-task instruction:

> Continue the Brontide modular desktop execution from `C:/Users/melvi/Projects/Journal-modular-trading` on `codex/modular-trading-desktop`. First read `docs/trading-modular-product-plan.md`, repository `AGENTS.md`, `docs/EXECUTION_PLAN.md`, `docs/WINDOWS_CODEX_HANDOFF.md`, verification guides and the latest `output/modular-candidate/delivery.md`. Inspect the current dirty worktree and preserve every unrelated/private file. The last committed installed candidate is `d488631eb4e8002091a665bfef7093df3acb1464`; later Connect/sample-isolation and Journal-adapter edits are not fully verified. The prior full verification stopped on a malformed generated `.next/dev/types/routes.d.ts`; automatic approval review rejected removing it with “blocked by policy.” Do not retry, split or route around that rejected action, and do not claim latest-source verification passed. Make only legitimate, scoped progress and report a blocked check honestly. Use bounded sub-agents with disjoint files and independent security/execution review. Reuse the current Plan, Positions, Journal and shared trading/ledger logic. Finish safe independent work toward packages A–H, maintaining source-specific tests, preview identity, locked installer candidate, README/static landing and operator handoff. The intended user journey is GitHub download → local install → select Trading/Journal → confirm TWS account/environment → explicitly review/submit → broker-backed Position/Journal, but the current candidate is sample-only. Never connect or submit to the broker, amend the halted target, unlock submissions, cut over active data, push, merge or deploy under this instruction. Keep the September 17 execution-policy rejection and exact-commit publication requirements. Stop at actual operator/vendor/policy gates, record their prerequisites and evidence in `docs/trading/OPERATOR_ACTIONS.md`, and do not mark live/public trading ready from fixtures or the historical 2/30 count. Deliver a scoped local commit only when the current source passes the repository's applicable checks; otherwise preserve edits and report the precise blocker.

## 13. Sources and interpretation

- [IBKR TWS requirements](https://www.interactivebrokers.com/docs/tws-api/doc/download-tws-or-ib-gateway/download-tws-or-ib-gateway): TWS or IB Gateway prerequisite; not evidence of automatic login or qualification.
- [IBKR API configuration](https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/): API settings, read-only setting and configurable socket ports.
- [Official SDK download/terms](https://interactivebrokers.github.io/) and [IBKR's 10.49+ GPL changelog](https://www.interactivebrokers.com/docs/tws-api/changelog/2026/8/3): current official pages differ on license framing; resolve exact version-specific rights before SDK bundling or public broker enablement. Do not assume our MIT license covers vendor code.
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol): coding/agentic model and reasoning support.
- [Codex sub-agents](https://learn.chatgpt.com/docs/agent-configuration/subagents): bounded delegation and model configuration.

Repository facts were inspected while planning. Product architecture, work-package sequencing and model reasoning level are recommendations. No estimate, benchmark or source guarantees this product is safe for live money; release decisions depend on the defined evidence.
