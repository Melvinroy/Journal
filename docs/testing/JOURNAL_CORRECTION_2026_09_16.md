# Journal correction — 16 September 2026

## Scope

Continues `codex/workspace-ui-refinement` from `3a1a22b530d1ccffe6b423f5b6536f0ca8814a8c` in `C:\Users\melvi\Projects\Journal-ui-refinement`.

- Restores the equity curve and original R histogram side by side at 960px of Journal content width, followed by visible Setup performance and Recent trades.
- Measures chart containers and redraws at their actual dimensions (260px desktop, 220px mobile), keeping axis text and marks undistorted.
- Separates labelled View and Unit controls. Default is the dollar equity curve; optional drawdown and risk-unit views have brief explanations.
- Uses compact desktop records, separate one-line setup/source metadata, aligned financial columns, horizontal mobile scrolling and sticky symbols. Expanded details use the table's usable width and retain reviews.
- Retains filters, primary metrics, More statistics, accounting calculations and existing empty-state distinctions.

Production changes are limited to Journal sections of `app/page.tsx` and `app/trading-refinement.css`. Tests are in `tests/ui/journal-correction.spec.ts`, the adjusted `tests/ui/workspace-quality.spec.ts`, and the Playwright suite configuration. No other product screens or backend interfaces changed.

## Automated evidence

Final `npm run verify` passed all five stages in 527.8 seconds: 200 Node tests passed / 2 skipped; 217 backend tests passed; TypeScript passed; 57 browser tests passed / 3 optional private Catalyst fixtures skipped; production build passed. Two backend dependency deprecation warnings were reported. Evidence: `output/journal-verify-final.log` and `output/journal-correction/verify-final/`. The initial full run found one obsolete scrolling-cue text assertion (56 browser passes); updating that assertion resolved it.

Focused checks passed: 11 relevant regressions during iteration, followed by all four Journal correction tests after the final edge-case addition. The tests cover actual plot bounds, five window widths, content widths 959/960/961, same-page resizing, panel order, compact rows and column gaps, sticky symbols, expanded details, both chart views/units, incomplete/filtered-empty records, large negative values, a long symbol, and 200% CSS zoom. Existing regressions cover review persistence and incomplete execution details.

No screenshot baselines were changed. Internal horizontal scrolling of the trades and setup tables is intentional; it is distinct from page overflow.

## Direct browser observations

Inspected `http://127.0.0.1:8766/?demo=1` with exact dirty source identifier `3a1a22b5+d.3866c482`, verified against the checkout and served manifest.

- Viewed rendered charts at 1600, 1280, 1024, 768 and 390px; charts fill their measured panels, with two columns at wide sizes and stacking below the content threshold.
- Viewed dollar equity, optional dollar drawdown and R equity, their labels/explanations and the original distribution histogram, mean/median and individual-trade markers.
- Observed unchanged demo results: net P&L +$6,099, maximum drawdown -$310, R curve +31.08R, 26 eligible closed trades.
- Viewed compact desktop trade rows, setup/source metadata and positive/negative values. Setup performance appears before Recent trades.
- Opened NVDA and incomplete MSFT details; missing financial values remain dashes, and incomplete records remain accessible. Checked a filter with no matches and Clear filters.
- Viewed mobile details and review fields without right-edge clipping. Used keyboard navigation with a visible focus ring, and horizontally scrolled the mobile table while symbols stayed visible.
- Resized the same loaded page wide → narrow → wide. Expanded state remained available and chart controls continued to work.
- Independent review checked clipping, excess chart margins, misleading missing values and numeric alignment. It caught and corrected a details-width issue during iteration before the final run.

## Limits

The browser review used viewport emulation, not physical monitor/DPI testing. The 200% check is automated CSS zoom, not native browser/OS zoom certification (the in-app browser did not apply zoom shortcuts). Long-symbol/large-loss fixtures and review saving were exercised in isolated automated contexts; the final preview's stored records were not edited. A genuinely new authenticated account with zero records was not created; empty charts, filtered-empty results and incomplete records were checked. No authenticated broker session, live orders, upload, push, merge or deployment was performed. This is UI verification, not trading-lifecycle acceptance. Extremely long custom setup descriptions beyond the existing demo names were not directly inspected; their complete text remains in expanded details.

## Final preview

The delivery response records the local commit and matching served identifier after rebuilding from the committed checkout. Port 8766 serves this isolated checkout; port 8765 was not changed. Generated evidence remains outside the commit.
