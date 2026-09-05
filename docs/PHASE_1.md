# Phase 1 — Local EOD chart connection

## Follow-up status — 5 September 2026

The user supplied a Windows validation report: local launcher, real AAPL/MSFT/NVDA/SPY database comparisons, 56 backend tests, five chart data tests, build and desktop/mobile chart checks passed. These are user-reported checks, not a second database audit by the cloud agent. The report identified 671 bars per symbol through 2026-09-03 and a 766,259,200-byte database.

Fetched public main now includes `ccec3890e272d83c6f7abad12980f7f4bafd31bd`, the selected-range/right-whitespace correction. The patch was inspected and preserved. Indicator warm-up across visible ranges remains an explicit numeric check for Charts v1; the earlier manual moving-average pass does not establish range invariance.

The original pending gates below describe the initial cloud handoff. The new development sequence is [Execution E1–E6](EXECUTION_PLAN.md), with scope-specific validation rather than repeating the historical backfill.

## Audit baseline

`main` was pulled fast-forward-only and verified at `bac8d38df4f1efb714208d8d4701b2d43c036050`. No pre-existing working-tree changes were present in this isolated checkout. The user's Windows checkout and production DuckDB file are not mounted in this environment.

The existing chart generated three sample series and already contained light/dark themes, grouped drawing tools, and a prototype Auto Trend implementation. Existing FastAPI endpoints were `/health`, `/v1/instruments`, and `/v1/bars/{symbol}`. They opened the mutable ingestion store, and the bars query did not isolate source/adjustment/timeframe. The Next.js `.mjs` configuration exported `/Journal` assets; a second pre-existing `.ts` config was left untouched.

## Implemented scope

- Read-only `ChartRepository` adapter and bounded HTTP contract; no ingestion migrations or downloads.
- Database readiness, literal bounded symbol/name search, instrument/series metadata, chronological daily bars, and chart envelope.
- Explicit source, adjustment, timeframe and ready-quality filtering.
- Calendar-aware freshness with early-close and SIP-delay handling; expired-calendar status is unknown.
- Existing chart connected to same-origin API with cancellation, timeout, search, refresh, loading/empty/error/stale states and explicit local/sample mode.
- Existing UI retained; separate chart route avoids requiring a journal cloud account for local market research.
- Full loaded history retained for moving-average warm-up, with selected-range viewport and approximately 20% right whitespace.
- Windows timezone-data dependency and clean export build to prevent stale local files entering a Pages export.
- Local production launcher; default GitHub Pages export remains sample-only.
- Read-only Windows verification command for AAPL, MSFT, NVDA and SPY.

## Validation and outstanding gates

- Backend: 56 tests passing (46 existing ingestion tests plus 10 new chart/API cases).
- Frontend: five data-contract tests passing; TypeScript, local production build and GitHub Pages sample build pass.
- Synthetic end-to-end HTTP check: 699 daily records per ticker compared exactly against a temporary database for AAPL, MSFT, NVDA and SPY. Local synthetic request times were 28–53 ms; these are not production-database performance measurements.
- Static frontend served successfully through FastAPI; database and environment-file URL probes returned 404.
- Actual Windows dataset comparison: **pending**, because `services/eod/data/brontide.duckdb` is unavailable here. Supplied dataset counts remain user-reported, not re-audited in this phase.
- Browser desktop/mobile visual and interaction validation: **pending**. The browser blocked the loopback preview (`ERR_BLOCKED_BY_CLIENT`); no visual sign-off is claimed.

Phase 1 implementation is ready for local validation; Phase 2 must wait for the two outstanding gates. No full historical backfill was run. No strategy metrics were reproduced or promoted. The article is outside this change. Nothing is pushed without the user's exact approval sentence naming a specific commit.

See `services/eod/README.md` for launcher, verification commands and the remaining UI checklist.
