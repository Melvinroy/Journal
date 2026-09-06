# UI Recovery Review

Observed on September 6, 2026, on `codex/ui-recovery-review`, based on
`ee2af0befb6e7b41cbbf70bce2a22b78aa112c18`. This is a comparison workspace,
not a redesign or a strategy-validation release. Hosting configuration is retained;
this review does not publish the build or push commits.

## Recovered inventory

| Location | Views and provenance | Scope |
| --- | --- | --- |
| Discover / Scans | Original Scans; Research Scans | Original static reference plus current saved-run interface. Original is the default. |
| Discover / Catalysts | Existing signal board | Filters, details and chart handoff retained. Disconnected, loading, empty and error states are distinct. |
| Charts | Current chart, watchlist, manual drawings | Existing local OHLCV contract and E6 editing remain intact. |
| Charts / Recent Trend (Original) | Recent-pivot algorithm recovered from `177b033` (introduced in `1e1e898`) | Independent, read-only generated overlay; may coexist with editable E6 Auto Trendline. Both calculate through the as-of cutoff, not just the visible range. |
| Strategies | Original Backtest; Research Runs | Original provisional registry and current immutable-run interface. Neither is presented as validated performance. |
| Trading / Plans & Positions | Original Planner; Current Planner | Original calculator defaults first; current plans, revisions, fills, positions and local review remain available. |
| Trading / Journal | Pre-integration dashboard proportions from `177b033` | Restored wrapper, spacing, analytics and trade table; existing authentication and cloud-record code retained. |
| Review old tabs | Overview, Trades, Daily journal, Playbook, Insights | Faithful shared-dashboard prototype recovered from `bc92026`. These were heading variants, not five independent tools. Explicit synthetic/prototype notice; unimplemented filter disabled. |
| Review old tabs / shortcuts | Original Trade, Backtest, Journal | Links to recovered functional views above. |

Primary navigation, original/current choices and current planner subview persist.
Prototype trades and demo planner/research settings use separate storage namespaces.
Existing non-demo calculator and ledger storage keys are unchanged. Watchlist and
manual-drawing storage remain unchanged. Demo Journal uses the existing isolated
sample state; it does not read or write authenticated cloud trades.

## Changes

- Removed dashboard-grid and research-wrapper CSS interference with original views.
- Added visible comparison tabs instead of hidden original-view toggles.
- Added separate original/E6 overlay identities and independent contextual toggles.
- Fixed Catalyst's indefinite loading without a configured client and caught rejected loads.
- Added explicitly synthetic catalysts, research runs, plans and partial positions.
  Public sample research uses an in-memory API adapter, never a private local endpoint.
- Preserved the existing backend, database, ingestion, research calculations and API contracts.
- Added regression coverage for original trend anchors, causal cutoffs, log projection,
  range-invariant slopes, demo storage isolation, ledger reconciliation and sample filters.

## Automated results

| Check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | PASS: 31 tests |
| `services/eod/.venv/Scripts/python.exe -m pytest services/eod/tests -q` | PASS: 68 tests, 12.41 seconds; two existing dependency deprecation warnings |
| TypeScript | PASS |
| Public build | PASS |
| Sites build (`BRONTIDE_SITES_BUILD=1`) | PASS |
| Local build / `npm run local` | PASS |
| `git diff --check` | PASS |

No backfill, research recalculation, schema change or real trade mutation was run.
Database size and last-write timestamp remained 766,259,200 bytes and
2026-09-05 05:37:43 UTC before/after checks. Database and browser evidence files
are not part of this commit.

## Actual database comparison

`python -m brontide_eod.verify_chart --url http://127.0.0.1:8772` compared every
returned session and OHLCV field directly with DuckDB. Each series contains 671
bars, from 2024-01-02 through 2026-09-03. Browser search and displayed closing
prices were also checked separately for all four symbols.

| Symbol | Rows | Final close | API comparison time | Result |
| --- | ---: | ---: | ---: | --- |
| AAPL | 671 | 328.21 | 549 ms | Exact dates and OHLCV |
| MSFT | 671 | 510.12 | 282 ms | Exact dates and OHLCV |
| NVDA | 671 | 228.45 | 231 ms | Exact dates and OHLCV |
| SPY | 671 | 773.17 | 203 ms | Exact dates and OHLCV |

SPY raw data is absent in this database: the chart correctly shows an empty
series rather than substituting adjusted data. The actual freshness state says
calendar coverage needs updating, not that September 3 prices are live quotes.

## Observed browser checks

Chromium at 1440x1000 and 390x844, plus a short desktop viewport:

- All four primary views opened in both production Sites-export viewport sizes;
  no horizontal document overflow, opening-screen stall or console errors.
  Public sample navigation made zero local `/v1/` requests.
- All five recovered prototype headings opened on mobile and displayed the
  same historical dashboard. Journal and original planner compared with the
  historical source and `docs/images/dashboard.jpg` on desktop/mobile.
- Original planner entry edit survived save/reload. Current sample plan notes
  survived revision save/reload. Research filters and version choice survived
  reload. Watchlist additions survived reload.
- Synthetic research includes a zero-match session, populated signals, details
  and a complete downloadable sample ledger. The two example outcomes reconcile
  to 0.5R expectancy; these are fixtures, not recalculated research.
- Local Research Scans also displayed the four existing EP/RVOL run variants
  and their 30-session selectors, including zero-match sessions. This was a
  read-only UI check, not a new execution or ledger export.
- Synthetic Catalyst filters produced both populated and empty results; detail
  and historical chart handoff worked. Local disconnected feed displayed an
  explicit unavailable message rather than an indefinite spinner; Retry returned
  cleanly to that unavailable state.
- Both original and E6 lines displayed on NVDA. Switching 1M to 1Y preserved
  original touch evidence; off-screen slope invariance is also unit tested.
  Linear/log models and chart light/dark modes were inspected.
- Actual mouse selection and dragging marked an E6 support line edited.
  Reload retained the edit; selecting/deleting it survived reload. A manually
  drawn horizontal line survived E6 reset and reload while generated lines returned.
  No overlay/storage writes were used as a substitute for mouse interaction.
- Mobile clipping found during review was fixed; the chart, volume and controls
  are now reachable by scrolling. Distinct trendline labels wrap without overlap.
- A controlled intercepted chart request exercised loading, HTTP 503 error and
  Retry recovery to the actual database. That expected 503 console entry is a
  test fixture, not an unexplained application error.

Ignored local screenshots are under `output/playwright/`, including
`chart-edited-desktop.png`, `chart-reset-manual.png`, `chart-mobile-bottom.png`,
`sites-*-1440.png`, `sites-*-390.png` and `local-{AAPL,MSFT,NVDA,SPY}.png`.

## Limits and review gate

- Physical phones, Safari and authenticated cloud Journal mutations were not tested.
  Existing cloud-record handling was preserved; no private account records were edited.
- Live populated Catalyst backend service was not available for validation; sample
  populated/empty and local unavailable states were checked instead.
- Chart dark/light modes were checked. Other restored baseline screens retain their
  original light styling; a new application-wide dark redesign is out of scope.
- This pass does not revalidate old strategy results or rerun the EOD pipeline.
- The public hosted demo remains on its previous deployment until publication approval.

The comparison workspace is ready for tab-by-tab review, with the limitations above.
Further visual redesign and hosting publication remain separate decisions.
