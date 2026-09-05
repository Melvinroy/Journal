# Brontide execution plan

Agreed product direction: 5 September 2026. This plan supersedes the earlier suggestion to place the full trade planner beside the chart or retain Journal as a primary tab.

## Ownership and delivery rules

The ChatGPT Work/Codex agent implements repository changes, runs available automated checks, reviews the result and creates a local commit. Windows Codex validates operations that require `C:\Users\melvi\Projects\Journal` and `services/eod/data/brontide.duckdb`. They are two execution environments for the same project, not competing implementations. Windows validation must use the same commit being reviewed.

No paid connector or new provider is needed for these six phases. Keep the completed ingestion engine. Never rerun the full historical backfill without necessity, commit private data, or expose credentials to the browser. Existing provider/storage interfaces remain portable.

Each phase has a bounded scope, working deliverable, tests, explicit outstanding gates and a local commit SHA. Do not push without the exact user approval sentence naming that commit. Approval of one SHA does not authorize another. Do not recreate a commit through a connector under a different SHA without explaining that change and obtaining approval for the actual commit.

Use a clean feature branch from fetched main; inspect AGENTS.md, status and history first. Preserve unrelated changes. Do not start a new workspace implementation until the current phase meets its gate. Necessary links between workspaces are included in that gate; unrelated redesigns are not.

The original EOD/Phase 1 chart project is completed according to the user's Windows validation report. The six phases below are named **E1–E6** to avoid confusing this roadmap with that historical Phase 1.

## Four primary workspaces

| Workspace | Responsibility | Secondary views/actions |
| --- | --- | --- |
| Discover | Find opportunities | Scans, Catalysts; add an instrument to a shared watchlist |
| Charts | Analyze instruments | Chart, indicators, drawings, persistent watchlists; Create/Open plan |
| Strategies | Evaluate evidence | Definitions, run history, comparisons, trade ledgers |
| Trading | Plan, manage and review | Plans, Positions, Journal; full-page plan editor |

Watchlist management belongs beside Charts. Discover can add to the same list; it must not maintain a second copy. On mobile, the watchlist opens as a drawer or full-screen view. The trade planner is a full workspace view, not a narrow chart panel or modal.

Create plan carries an instrument and explicitly chosen levels into Trading. Preserve originating signal/strategy IDs, as-of session, source/adjustment and a chart return context. Last close is not an intended or actual fill. Open chart returns to the correct instrument and view without losing the plan draft, drawings, watchlist selection or scan filters.

Migrate the navigation incrementally. E2 introduces the four-workspace shell while reusing existing components: Discover contains existing Scans/Catalyst, Strategies contains existing Backtest, Trading contains existing Trade/Journal. Clearly labeled legacy capabilities can remain until their phase. Keep old entry links and stored records working. Do not claim an entire workspace is complete merely because its navigation moved.

## E1 — Baseline, execution contract and truthful product states

**Outcome:** a reviewable starting point with accurate descriptions of what the existing software does.

1. Fetch main, verify required historical commits and preserve the chart range/whitespace patch.
2. Commit this roadmap and the Windows handoff. Record prior Windows validation as user-reported evidence.
3. Label the static scan CSV and earlier backtests as provisional; distinguish the 0.95 scan from the 0.75 research result. Preserve all historical rows and files.
4. Replace misleading local-planning action labels and outdated broker roadmap copy. Preserve button styling, calculation logic and storage behavior.
5. Run dependency audit and record the package-level findings; schedule a focused upgrade, not an unreviewed force fix.

**Gate:** build and existing chart contract tests pass; diff contains only the documented scope; no chart/data migrations, secrets or research recalculation. Record browser checks separately from compile/test results. Dependency findings may remain explicitly open for E2; E1 is not a customer-release sign-off.

## E2 — Charts v1 and workspace navigation

**Outcome:** a complete manual EOD analysis workflow, with watchlists and reliable saved work.

Implement in this order:

1. Resolve the focused dependency upgrade and verify both sample and local build modes.
2. Introduce the four-workspace shell using the existing components and design. Retain direct local `/charts/` access and public sample mode. Do not make local charts depend on Supabase login.
3. Audit each advertised drawing tool. A regression channel must perform regression; a Fibonacci time tool must not create a single vertical line. Implement supported behavior or remove misleading menu entries. Target 20–30 useful genuine tools; do not pad the count with aliases.
4. Preserve the ccec389 selected-range fix and roughly 20% right whitespace. Verify indicator warm-up independently: the same dated SMA/ATR value must not change merely because the user selects 1M versus 1Y. Do not restore the old range bug to solve warm-up.
5. Save/restore drawings and layouts through a versioned local persistence interface. Key drawings by instrument identity, timeframe and adjustment basis; do not silently move raw-price drawings onto adjusted prices.
6. Add persistent watchlists, selection, add/remove, basic ordering and instrument search. Show data source/as-of context; do not imply intraday quotes from EOD data.
7. Add Create/Open plan navigation into the existing full-page planner, transferring context without overwriting an existing saved plan. The advanced planner arrives in E5.
8. Remove inert controls or mark capabilities unavailable. The existing Auto Trend prototype is not a validated algorithm; its final behavior belongs to E6.

**Gate:** real AAPL/MSFT/NVDA/SPY comparison on Windows; all visible manual tools have verified behavior; persistence survives refresh/restart; range and warm-up invariance pass; keyboard/mobile controls work without overlap; white default/dark toggle preserved; local/sample/error/empty/stale states validated. Proposed responsiveness targets must be measured on the Windows machine before becoming claims.

## E3 — Discover v1 and deterministic feature engine

**Outcome:** a user can find, understand, save and chart an opportunity from a reproducible completed-session scan.

### Shared measurement catalog

Raw OHLCV, previous close/volume, identity, dates, source and adjustment metadata are base fields in addition to these 30 derived measurements. Store feature definitions and versions centrally. Strategies select their required features; do not make all 30 mandatory gates.

| Family | Measurements |
| --- | --- |
| Trend | SMA10, SMA20, SMA50, SMA200, five-session SMA20 slope |
| Momentum | 1/5/20/60-session returns, 20-session return minus SPY return |
| Volume/liquidity | Prior ADV20, prior average dollar volume20, current RVOL, volume/previous volume, three-session volume contraction |
| Volatility/compression | Wilder ATR14, ATR%, body/ATR, range/ATR, three-session price range/ATR |
| Price location | Distance to SMA20 in ATR, distance to 252-session high, close location in candle, post-EP high, distance to post-EP high in ATR |
| EP context | EP age in sessions, EP-day return, EP-day RVOL, setup/EP volume, post-EP distribution count |

Definitions to freeze before implementation:

- SMA includes the measured close. SMA20 slope = 100 × (SMA20[t]/SMA20[t−5] − 1).
- N-session return = 100 × (C[t]/C[t−N] − 1). Relative performance is a percentage-point difference, not a percentile rank.
- Canonical prior ADV20 averages volumes t−20 through t−1. Average dollar volume averages compatible C×V over the same window. RVOL = V[t]/prior ADV20[t]. Three-session contraction = mean(V[t−2:t])/prior ADV20[t].
- True range = max(H−L, abs(H−previous close), abs(L−previous close)). Wilder ATR14 starts from 14 valid true ranges, then (13×previous ATR + TR)/14. ATR% = 100×ATR/C; body = abs(C−O); range = H−L. Three-session price range is max(H)−min(L) across those sessions.
- Distance to SMA20 = (C−SMA20)/ATR. Distance to 252-session high = 100×(C/max(H252)−1). Close location = (C−L)/(H−L).
- Post-EP high includes EP through the as-of session; distance = (post-EP high−C)/ATR. EP age uses calendar ordinals, not elapsed days. Setup/EP volume = V[t]/V[e], displayed as percent.
- Distribution count requires the exact strategy-specific predicate and a list of flagged sessions. Recover the legacy definition before reproducing the strict benchmark; no invented default under the old strategy name.
- The existing EP research describes **inclusive ADV20**. Retain that definition for faithful legacy reproduction; a prior-only denominator is a separately versioned strategy change.
- Missing history, zero denominators and unavailable instruments produce explicit missing values. Required missing inputs cannot pass a rule. Do not treat 20 available bars across gaps as 20 contiguous market sessions.

### Workflow and data contract

Latest shows the latest successfully processed completed session. History defaults to the previous 30 authoritative market sessions, including zero-match sessions; users can select another date/range. Chart range and indicator warm-up are independent. Track expected completed session, available dataset session and selected as-of session separately.

Each candidate has instrument ID, EP event ID, strategy version, setup date, trigger policy, intended entry session and run identity. An OHLCV EP is a price/volume candidate, not proof of a news catalyst. Next-open entry remains unknown at the setup close. Breakout-trigger rules can later use a separate trigger date.

Detail view shows each condition's observed value, threshold, operator, units and Pass/Fail/Missing/Not applicable. Latest matches are the default; a watching/diagnostic view explains incomplete and failed EP setups. Define event overlap/supersession explicitly. Retain the first qualifying setup per EP per strategy version; prevent repeated daily duplicates.

Implement latest/history, presets, filters, saved columns, stable sorting, run status/progress, candidate details, provenance export, watchlist actions and chart handoff. Show about eight columns by default and all metrics in details. Historical chart handoff ends at the selected session; future bars require an explicit review action.

Preserve and complete the Catalyst subview with source links, publication times, instrument association and honest missing/error states. Reuse its existing feed; building a new news or AI engine is outside E3.

### Engine and storage

Use pure deterministic calculations and repository interfaces. Store instrument/session features separately from event-context features. Jobs run outside interactive HTTP requests. Publish immutable run manifests containing data/universe/calendar fingerprints, code/feature/strategy versions, source, adjustment and as-of session. Corrections create a new revision.

No historical bar backfill is required. Compute features from existing bars, then update incrementally. Agree on missing-bar, listing-date and eligibility policies; a frozen active-plus-inactive snapshot is not proof of perfect historical investability.

Use one DuckDB writer. Start with a coordinated local write window and clear updating state if necessary; choose a separate validated read-only serving snapshot only if uninterrupted reads are required. Measure Windows locking before promising concurrent processes. PostgreSQL, object storage and workers are future adapters, not E3 prerequisites.

**Gate:** numeric fixtures, boundary cases, full/incremental equivalence, future-bar truncation invariance, repeat-run deduplication, first-setup behavior, zero/missing/failed distinctions, refresh persistence and scan→chart→return workflow pass. Validate real scans on Windows. Do not publish strategy performance in this phase.

## E4 — Strategies v1 and reproducible backtests

**Outcome:** every presented result can be traced to its exact rules, data and trade ledger.

Preserve the original registry and label its results provisional. Recover legacy formulas before naming a run a reproduction. Store versioned definitions, immutable manifests, execution assumptions and complete ledgers. UI supports definitions, runs, comparison and per-trade drilldown.

Strict reference: EP gain ≥4%, volume ≥8.9M, volume above previous day and ≥3× declared ADV20, price >$3; setup 3–15 sessions after EP; Close>SMA10>SMA20; body<0.25 ATR14; range<0.75 ATR14; volume<0.75 prior ADV20 and <0.5 EP volume; no major distribution; close within one ATR of post-EP high. Next-open entry; stop = entry−setup-day ATR14; 10R target; max hold 60 sessions. Recover distribution, ATR, equality and ADV20 conventions explicitly.

Broader candidate uses ≥2× EP volume and setup RVOL<0.95 with every other condition explicitly recorded. The older 2×/0.75 run does not validate it. Compare 3×/0.75, 2×/0.75, 3×/0.95 and 2×/0.95 on identical inputs to isolate the changes; do not silently mix variants.

Ledger: instrument, EP/setup/trigger/intended and actual simulated entry dates, entry, frozen setup-day ATR, stop, exits, R/percentage outcome, MFE/MAE, reason and limitations. Define gap behavior, costs, missing entry bars, delistings, incomplete holds and simultaneous stop/target daily bars. Use a documented conservative ambiguity policy or mark unresolved trades; daily bars do not establish intraday event order.

Show expectancy, wins/losses, sample size, drawdown, exposure and trade counts including zero-signal sessions. Separate arithmetic trade-return sums from portfolio returns. Capital and overlapping-position simulation is a later release; label unconstrained assumptions. Version benchmark/holdout decisions rather than retroactively calling an inspected period out-of-sample.

**Gate:** reproducible reruns and complete ledgers reconcile to aggregates; no look-ahead tests pass; comparisons share assumptions; limitations visible in the same view as performance; all primary/winner claims supported or absent.

## E5 — Trading v1: advanced planning, Positions and Journal

**Outcome:** plan a trade in a dedicated editor, record actual fills and review it without confusing intentions with execution.

Reuse the existing risk calculator, exit defaults and Journal integration. Audit and migrate existing localStorage and Supabase records deliberately. No silent replacement of journal storage or authentication.

Plans supports multiple named drafts, templates, revisions and linked chart/scan context. Editor sections: entry/sizing, protective stops, profit targets, management rules and final review. Persist changes safely, show unsaved state and recover interrupted edits.

Support two distinct stop concepts:

1. Split protection: different portions of a position have different simultaneous stop levels.
2. Stop progression: update protection after a target fill or another explicit condition.

Profit targets allocate shares/percentages; runners retain the remainder. Model protection and profit exits as linked alternatives for the same shares, not independent quantities that both consume the full position. After a partial exit, reduce remaining protection and prevent over-closing. Allocate rounding remainders deterministically. Calculate aggregate planned stop risk across tranches, cap capital allocation and validate long/short direction, nonzero sizes, invalid prices and conflicting rules.

Record fills manually/import them under explicit provenance initially. Positions distinguishes planned, partially filled, open and closed states. Journal presents actual outcomes, notes and plan-versus-execution review. Unfilled plans never contribute realized P&L. No order is sent merely by saving or recording a plan.

Desktop uses a full editor; mobile uses sequential sections with a persistent review/save action and no overflowing tables. Open chart preserves the draft; returning preserves chart/watchlist context.

**Gate:** risk/quantity conservation tests, partial-fill and partial-exit scenarios, split-stop/progression distinction, rounding and long/short tests; persistence and migration validation; plan→chart→plan→record fill→journal workflow. Broker connection is deliberately outside this phase.

## E6 — Charts v2: validated Auto Trendlines

**Outcome:** deterministic recent support/resistance lines with explainable evidence and manual control.

Research and propose the algorithm before replacing the existing prototype. Define ATR-based pivot prominence, causal confirmation delay, touch tolerance/count, candidate construction, violations, ranking and pruning. Rank by touches, recency, violations and fit; avoid calling an arbitrary score a calibrated confidence probability.

Use only information available at the as-of session. A pivot can be plotted at its earlier location but becomes available only after its required confirmation. Keep results deterministic; separate algorithm calculation window from zoom display policy and document any change in scope.

Place Auto Trendline immediately left of the data-status indicator. Support toggle, edit, delete, save/restore and clear ownership of generated versus edited lines. Validate across zoom, historical as-of selection, desktop/mobile and adjustment changes.

**Gate:** hand-worked examples, no-future-data invariance, deterministic ranking and pivot availability, visual behavior across ranges, persistence and edit/delete pass. Trendline alerts and automated execution are later releases.

## Beyond these six phases

Broker integration (likely IBKR), live feeds, alerts, portfolio capital/overlap simulation, scheduling/monitoring and hosted multi-user operations have separate release gates. Trading order management requires fill reconciliation, idempotency and cancel/replace behavior; hosted operation requires authenticated access and tenant isolation. Public GitHub Pages remains a safe static demo. A phone does not gain access to the Windows database through Pages; private connectivity requires an explicit deployment choice.

## Progress record

See `EXECUTION_E1_VALIDATION.md` for the first implementation and checks. E2–E6 are planned, not implemented. The local implementation agent can continue here; use `WINDOWS_CODEX_HANDOFF.md` whenever laptop-only validation is needed.
