# Research UI and bounded LEAN pilot

Date: September 7, 2026. Local implementation and usability evaluation; not strategy validation.

## Recommendation

**Retain the current daily independent-trade engine; use LEAN for independent validation. Do not migrate in this pass.** LEAN independently reproduced the synthetic setup decisions and exposed meaningful order-model differences. More metric coverage does not require engine migration: a versioned ledger-based catalog now serves the UI and read-only analytics API. A portfolio migration would need funded position sizing, overlapping-position treatment, point-in-time corporate actions/universe data, and execution policies that are not established here.

LEAN provides event-time delivery and configurable execution models, but cannot repair information leakage already embedded in adjusted prices, universe selection or strategy rules. This pilot tests our timestamp adapter and causal rules on frozen data, not all lookahead or survivorship bias. [LEAN reality modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts), [LEAN time modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/time-modeling/periods).

## Delivered interface

Research Runs now uses the original green summary banner, four headline metrics, bordered registry and conditions panels, and a structured trade dialog. Layout and column management supports search, show/hide, reorder, numeric width adjustment, reset, Overview/Outcomes/Setup quality/Execution presets, named save/rename/duplicate/delete, and four configurable headlines. Preferences remain on this device, with separate demo/local keys. Identity and actions stay pinned within horizontally scrollable tables. Raw inspection evidence is collapsed. Original Backtest and Research Scans rendering remains unchanged.

Aggregates use complete applicable ledgers. Sorting and filtering occur before pagination; the UI labels whole-run versus filtered-cohort scope. Trade rows join only the saved source scan by recorded run reference and matching signal/strategy/symbol/setup identity. Original run objects and complete exports are unchanged. Portfolio metrics display unavailable reasons. See [98-entry metric catalog](RESEARCH_METRICS.md).

## Frozen sample and scope

Window: **August 5–September 3, 2026**, 30 calendar days. Warm-up starts January 2, 2024. The SHA256-selected 20-symbol sample contains 11,119 bars across 19 symbols; FCB has no ready bars and is retained as missing coverage. Symbols: APH, BRIE, DXR, EVGN, FCB, GMED, HYLB, IWX, KOF, NRUC, NYXH, PFIG, SDOT, SLMT, SPXS, URI, USMV, VNIE, XLKI, YDEC.

Both engines found **zero qualifying real setups**. No symbol was replaced and no outcome-based resampling occurred. Therefore this real sample verifies data delivery and empty-signal agreement, not real-trade execution or strategy effectiveness. The eight synthetic execution fixtures each produced one qualifying signal; a ninth future-perturbation fixture checks causality. Every fixture uses an independent engine process, avoiding LEAN netting assumptions.

Pinned LEAN revision: `23b735d99a357807dc0df9f4c51d30f05fe0d277`; .NET SDK 10.0.400. Direct source build, local file provider, no paid CLI subscription, purchased data, or brokerage connection. LEAN processed 11,119 opening events and 11,119 completed-bar events in the real sample. Earlier features warm up the algorithm; setup scoring is restricted to the window.

Data fingerprint: `993be7e7aa28f1b4abf89c641db747f46a6da2e5e630dd56b7497bfd86a25938`. The production DuckDB file size and modification time remained unchanged. Inputs and pilot publications are isolated under ignored `output/lean-pilot/verified/`, not inserted into saved production runs.

## Signal, execution and statistical checks

All 10 comparison cases pass the declared assertions. Synthetic signal dates, EP dates and ATR match the independent streaming implementation within 1e-10 tolerance. The future-only OHLC perturbation preserves the earlier feature checkpoint and signal; existing backend tests also perturb future data for all four research variants.

| Case | Brontide net R | LEAN net R | Classification |
|---|---:|---:|---|
| real | — | — | No real qualifying setups; signal parity is empty and gives no execution validation. |
| stop | -1.118533 | -1.117817 | Native cent tick rounding and security-price-based fee versus unrounded stop and fill-price fee. |
| gap | -3.316150 | -3.316150 | Same gap price and net R within floating-point tolerance. Reason text differs: generic native stop versus explicit gap-through-stop. |
| target | 9.870467 | 9.881888 | Native cent tick rounding and security-price-based fee versus unrounded target and fill-price fee. |
| ambiguous | -1.118533 | -1.117817 | Both choose stop in this run; Brontide explicitly guarantees conservative stop-first and records ambiguity. Native ticket processing plus OCO cancellation is not evidence of intrabar order. |
| missingentry | — | — | Both decline delayed entry. Missing prices are null in Brontide and zero-valued unused fields in the pilot adapter. |
| missingholding | — | — | Both label unresolved. Brontide leaves final cost/outcome unavailable; native ledger retains its entry fee and funded holding. No liquidation is synthesized. |
| incomplete | — | — | Both keep trade open and exclude it from closed statistics. Brontide final cost is unavailable; native ledger records the entry fee. No forced exit. |
| maxhold | -0.114214 | -0.119533 | Brontide defines exit at session 60 close. A native market order submitted after observing that close executes next session open; fee and holding date change. This is an execution-time convention, not a signal disagreement. |
| futureperturbed | -0.342641 | -0.358598 | Future-only OHLC perturbation preserves the preceding checkpoint and setup. Subsequent native maximum-hold exit executes next open, with security-price fee and close/open price differences, as in maxhold. |

The 60-session case closes on July 8 in Brontide and July 9 at the opening price in LEAN. Our existing policy assumes session-60 close execution; a native market order submitted after observing that close cannot necessarily obtain the same close. The pilot keeps this difference. A migration must choose a defensible pre-close order schedule or next-open policy and version any resulting change.

Hand ledger `[2, -1, 0, 4, -2, -1]`: 6 closed, 2 winners, 3 losers, 1 breakeven, total 2R, expectancy 1/3R, median -0.5R, average winner 3R, average loser -4/3R, payoff 2.25, profit factor 1.5, closed-trade drawdown 3R. LEAN groups breakeven with losses (4 losing observations), changing average loss to -1 and payoff to 3. Its drawdown is signed -3 and decimal results round to four places. These convention differences are documented, not normalized away. LEAN trade Sharpe/Sortino are not portfolio Sharpe/Sortino.

Open and unresolved trades retain their status and never count as completed winners. Brontide lacks final costs for unfinished trades; the native adapter records the incurred entry fee. Daily OHLC cannot establish the path of a same-bar stop/target event. Native stop-first results in this fixture do not establish universal equivalence with Brontide’s explicitly conservative ambiguity policy.

## Performance

This is a bounded diagnostic on the existing Intel i5-1335U (10 cores / 12 logical CPUs), approximately 15.68 GiB RAM. Other local work was active; timings are observations, not controlled hardware benchmarks. Cache and recomputation outputs were identical. OS/process CPU granularity can report 0 for very short phases; zero is not a claim of no work. Memory values are cumulative process high-water marks observed after each phase, not exclusive per-phase allocations.

| Phase | Wall seconds | Process CPU seconds | Process high-water MiB |
|---|---:|---:|---:|
| database read | 0.2124 | 0.9688 | 211.2 |
| feature recompute | 0.2305 | 0.2031 | 211.2 |
| cold cache compute hash compress write | 1.9571 | 1.7812 | 211.2 |
| warm cache hash read validate | 1.0335 | 0.6094 | 211.2 |
| scan | 0.0674 | 0.0625 | 211.2 |
| simulation | 0.0048 | 0.0000 | 211.2 |
| publication | 0.0030 | 0.0000 | 211.2 |

Preparation including both cache paths, exports and fixtures: 3.858s wall, 3.969s process CPU, 211.2 MiB peak. 19 cold misses and 19 warm hits. Native real-data launcher: 8.560s wall, 17.719s process CPU at algorithm completion, 260.8 MiB peak. Native CPU includes startup/warm-up; it is not directly comparable to our simulation-only phase. The first upstream source build took about 2m43s, excluded from replay times.

Feature-cache validation/read cost exceeded direct recomputation on this small sample. Retain existing defaults: the full workload, persistent cache reuse and larger rolling-feature set could change that tradeoff. The earlier approximately 58-minute run was a historical ingestion/backfill with 1,619 HTTP requests, not a measurement of pure simulation. Nothing here establishes that a CPU upgrade or engine replacement will solve the original delay.

LEAN phase-level internals are not instrumented; its launcher timing is reported separately. Brontide database reads, features/cache, scan, simulation and publication are instrumented individually. This real simulation had zero trades, so it cannot establish trade-throughput scaling.

## Acceptance and limits

- Backend: 79 tests passed, including empty/no-loss/breakeven/missing fields, same-day ordering, full-ledger aggregates, source joins, sort-before-page, unchanged exports, future data and 60-session/open cutoffs. Frontend: 34 tests passed. Final local Next build and TypeScript passed.
- Browser: saved layout reload/rename/duplicate/delete, column search/order/resize/reset, full-cohort sorting/filtering, desktop and 390-pixel mobile trade inspection, native dialog Escape and focus return were exercised. Raw records remain collapsed. Layout controls were consolidated following a separate UX review. The final interaction check confirmed Close inspection returns focus to Inspect ETSY. At 390 pixels, keyboard horizontal scrolling moved the ledger by 366 pixels while identity and action cells stayed pinned at the viewport edges.
- Responsive layout was checked at desktop and mobile dimensions. Native browser zoom shortcuts are not exposed by the in-app browser; a 720×500 reflow check (equivalent layout space to 1440×1000 at 200%) passed with the editor contained in the viewport. Actual native 200% zoom remains unverified. This is not a claim of full accessibility compliance.
- The real sample contains no signals. No full-universe benchmark, longer backtest, funded portfolio, deployment, engine migration, or long-term strategy reliability claim is included.
- Pre-adjusted data does not validate corporate-action point-in-time behavior. Synthetic weekdays do not validate holiday/half-day calendars. Native precision, fees, missing-bar state and close-order timing still need an explicit policy decision before any migration.
- The pinned upstream LEAN build emitted warnings for legacy vulnerable NuGet dependencies (including DotNetZip and System.Drawing.Common). The custom pilot builds cleanly. Any production adoption needs dependency remediation and brokerage/data-model review.

## Next decision gate

Keep this harness as a regression/validation tool. Before proposing migration: independently reconcile an approved sample containing real signals and overlapping positions; explicitly choose tick, fee, gap, maximum-hold and missing-data policies; establish point-in-time data eligibility; then add a funded account model with quantities, cash, mark-to-market equity and benchmark series. Benchmark those comparable workloads before changing cache defaults or hardware. A full migration plan is premature until those decisions are resolved.

## Reproduction and evidence

[Runner instructions](../scripts/lean-pilot/README.md), [compact machine-readable evidence](research-pilot-evidence.json), [metric catalog](RESEARCH_METRICS.md). Full frozen CSV inputs, native order events, engine logs and assertions are local under `output/lean-pilot/verified`.

Local QA captures: [overview](../output/playwright/research/research-desktop.png), [original reference](../output/playwright/research/original-reference.png), [trade inspection](../output/playwright/research/trade-inspection.png), [mobile inspection](../output/playwright/research/trade-mobile.png), [mobile ledger](../output/playwright/research/ledger-mobile.png), [zoom-equivalent reflow](../output/playwright/research/zoom-reflow-720.png).

## Entry-containing follow-up

At the user's request, the same 20 symbols were retested over November 12–December 11, 2025, anchored to a recorded GMED entry. Both engines found one signal and agreed on its entry/stop-exit dates. See [follow-up results](RESEARCH_ENTRY_WINDOW.md). This does not replace the original outcome-independent window or its zero-signal finding.
## Integrated dual-engine UI

The optional local comparison is now available in Research Runs for the entry-containing November 12–December 11, 2025 pilot. See [RESEARCH_DUAL_ENGINE.md](RESEARCH_DUAL_ENGINE.md) for the integrated result, persisted job behavior, isolated overlap replay, UI checks and current acceptance results. The current engine remains the default; LEAN-only migration is deferred.
