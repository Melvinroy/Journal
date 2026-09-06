# Research UI and loading repair

Verified locally on September 7, 2026, using the frozen saved research dataset. Engine behavior, strategy definitions, metric definitions, and the LEAN pilot scope are unchanged.

## Delivered

- Compact strategy/four-metric summary strip; 45px registry rows; content-sized numeric columns; small View trades action. Dates are available as columns, with provenance and LEAN controls in the selected-run panel.
- Right-side native dialog matching Original Backtest's 1180px maximum/96vw desktop geometry and full width on mobile. The ledger has 42px rows, sticky headers, and independent scrolling between fixed controls and pagination.
- Inspection replaces the ledger inside the drawer. Back restores page, filters, scroll, and the originating Inspect button. Evidence and raw records are collapsed. Escape restores focus to View trades.
- Existing layout choices and explicit widths remain supported. Width persistence was verified across reload (110px), then restored to 92px. Customization opens above the drawer.
- Hidden parent request chains are disabled when Research Backtest or Original Backtest owns the active view.
- A rebuildable sidecar manifest/summary index lists runs without decompressing unrelated scans. Verified immutable objects and derived analytics/source joins have bounded caches. File signatures invalidate changed/deleted sources. Source gzip records and complete export contracts remain unchanged.
- Trade pages project visible fields; a separate single-trade endpoint loads full evidence on inspection. Filtering, sorting, and cohort analytics still operate on the complete applicable ledger before pagination.

## Measurements

| Request | Earlier measurement | Repaired measurements |
|---|---:|---:|
| Registry | 2,225ms | 30.9 / 12.2 / 13.8ms |
| 100-trade page | 710ms | 30.6 / 34.1 / 29.5ms |
| Trade-page payload | 367,131 bytes enriched | 37,275 bytes default projection |
| Selected-run metadata | — | 56.4 / 24.4 / 22.9ms |
| Cohort analytics | — | 51.0 / 36.5 / 34.5ms |

First registry visible after navigating from Original Backtest: 307ms, measured around the browser click and visible-row wait with warmed server/client resources. This is not a cold browser startup benchmark.

One-time index initialization: 9.385 seconds during a concurrent build; subsequent index verification: 0.277 seconds. Initialization is performed before accepting requests and is separate from warmed response latency. Cache byte limits estimate serialized size rather than total Python heap size.

## Validation

- 92 backend tests passed, including new-run index discovery, missing/corrupt index recovery, verified object corruption/deletion, cache mutation isolation, missing-source invalidation, lazy evidence, compact projection, complete-ledger sorting and aggregates across pages, and immutable source/export checks.
- 34 frontend tests passed. TypeScript and local production build passed. Git whitespace checks passed.
- Browser inspected the 1,193-record full-history EP-2x-rvol95 run and the one-trade pilot. First and second pages, individual inspection/back, keyboard PageDown, Escape/focus restoration, empty ticker results, and AAPL's two-trade filtered cohort were checked. AAPL's cohort expectancy remained 4.42R.
- Registry row height measured 45px; ledger row height 42px. At 1110px desktop width the drawer measured 1065.59px, full height, matching the original's geometry. All five default registry metric columns fit.
- Mobile checked at 390×844; reduced-width reflow checked at 720×500. Footer remained within the viewport with a 214px independently scrolling ledger at the latter size. Native browser 200% zoom was not exercised; reduced viewport reflow is the available approximation.
- Original registry and trade drawer were reopened and captured at the same desktop width. Original view markup/styles were not changed by this repair. Research Scans retains its existing fetch path; a separate full scan workflow was not rerun.

## Visual evidence

Screenshots under `output/playwright/research/`:

- `fixed-original-registry-reference.png`
- `fixed-original-trades-reference.png`
- `fixed-research-registry.png`
- `fixed-research-trades.png`
- `fixed-research-trades-mobile.png`
- `fixed-research-trades-reflow.png`

The earlier `audit-*` captures document the oversized registry rows and modal before this repair. No deployment was performed.
