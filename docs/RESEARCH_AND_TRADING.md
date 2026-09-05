# E2–E5 implementation and validation handoff

## Status

The four-workspace implementation is available for local review. This is an
integrated engineering checkpoint, **not a completed customer-release gate**.
No production market database was available in the cloud environment. The
browser preview remained on its opening screen; desktop/mobile interaction
validation is therefore outstanding, not passed. Do not push or deploy this
checkpoint until those checks succeed and the exact commit is approved.

## What changed

| Phase | Implementation |
| --- | --- |
| E2 Charts | Four-workspace navigation; standalone chart retained; light default/dark toggle; range/right whitespace preserved; full-history SMA warm-up; 20 genuine drawing tools; versioned instrument/mode/adjustment drawing storage; shared persistent watchlist; chart-to-plan context; focused Next.js security upgrade. |
| E3 Discover | Thirty derived measurements plus base OHLCV; separate immutable instrument feature snapshots; four explicit EP variants; first setup per episode; latest 30 completed-session selector with zero-match sessions and full-run history; condition diagnostics; column choice, sorting, saved view preferences; watchlist/chart handoff; existing Catalyst feed retained with report-time/source-link context. |
| E4 Strategies | Offline daily-bar backtests; immutable content-addressed runs; versioned manifests and complete trade ledgers; saved-run comparison with incompatible-input warning; per-trade review; full-run and page exports; original registry retained as provisional. |
| E5 Trading | Named plans, copy-as-template, saved revisions and editor recovery; split protective stops, targets/runners and distinct stop progression; risk/capital limits; manual fill ledger; partial/open/closed positions and local journal review; legacy calculator and cloud Journal preserved. |

### Research definitions

Read `LEGACY_RESEARCH_RECOVERY.md` before interpreting these variants. The
default grid is 3x/0.75, 2x/0.75, 3x/0.95, 2x/0.95. EP RVOL uses an inclusive
20-session volume average; setup RVOL uses the prior 20 sessions. Distribution
uses the recovered decline >=0.75 prior ATR plus increased volume rule. New EPs
supersede an older episode. These are named `reconstructed-episode-1.0`, not
faithful legacy reproductions: the original strict-composite cooldown and ATR
initialization code remain unresolved.

The initial ATR seed is 14 valid true ranges with known previous closes. Gaps
invalidate rolling windows and restart ATR warm-up. Missing measurements cannot
pass a rule. Raw and adjusted series are never mixed. All formula/code/input
versions participate in research provenance. Unchanged instrument inputs reuse
feature snapshots; changed bars, calendar, benchmark or formulas recompute that
instrument's history. Incrementality is at instrument/revision granularity,
not constant-time streaming ATR updates. Old cache snapshots are retained and
consume additional local disk space.

Backtests use actual next-session open, a frozen setup-day ATR stop, 10R target,
60-session maximum holding period and 10 bps costs per side (zero additional
slippage by default). Gap-through stops exit at the open. Same-bar stop/target
ambiguity is stop-first and flagged. Missing holding bars are unresolved;
incomplete trades are not counted as winners. Excursions use complete pre-exit
bars plus known opening/exit prices, not the unknown full exit-bar path.
Drawdown is closed-trade cumulative R, not portfolio mark-to-market drawdown.
There are no capital/overlap constraints in the backtest engine.

The selected frozen SIP universe is recorded exactly. Historical common-stock,
ADR and ETF classification is **not reconstructed**. Consequently these runs
may contain ETFs and cannot yet claim to reproduce the original common/ADR-only
study or perfectly point-in-time investability. No winner/primary-strategy
claim is justified before the Windows data and eligibility audit.

## Local workflow (Windows Codex)

Use the reviewed commit on a clean feature branch. Preserve all laptop changes.
Do not run ingestion/backfill or push main. Do not commit generated outputs.

1. Install the project's existing Python development extra if needed:
   `python -m pip install -e "services/eod[dev]"` in the configured virtualenv.
2. Run `python -m brontide_eod.research_job --list-configs`. Choose the existing
   daily/all-adjusted configuration whose frozen historical membership matches
   the verified 15,342-symbol universe. Stop if that identity cannot be verified.
3. Run the read-only research job, substituting that exact fingerprint:

   ```text
   python -m brontide_eod.research_job --config-fingerprint FINGERPRINT --start 2024-01-02 --end 2026-09-03 --backtests
   ```

   This reads existing bars, emits progress to stderr and writes compressed
   research objects beneath the database's `research/` sibling directory.
   It never downloads bars or opens a DuckDB writer. Keep ingestion stopped if
   Windows locking requires it. Failed jobs do not publish partial completed
   runs; completed feature snapshots may remain for safe reuse. Repeat the same
   run and verify identical run IDs with feature-cache hits.
4. `npm run local` builds the local frontend and serves it through FastAPI.
   Open the root workspace, not only `/charts/`, to access all four workspaces.
5. Check Discover: saved runs, zero-match dates, diagnostics, sorting, shared
   watchlist, historical chart cutoff, explicit later-bar review and return.
   Failed/watching diagnostics are retained only for the latest 30 sessions.
6. Check Strategies: all four variants share data/universe/calendar/execution
   fingerprints; complete ledger exports reconcile to every aggregate. Audit
   actual gap, ambiguous, missing and incomplete trade examples.
7. Verify AAPL/MSFT/NVDA/SPY against DuckDB again. Check all advertised drawing
   tools, selected-range whitespace, raw/adjusted isolation, indicator warm-up,
   restart persistence, light/dark and keyboard/touch layouts.
8. Use synthetic manual fills in a test browser profile for Trading: split
   protection, runner, target progression, partial fills/exits, long/short,
   rounding, no over-close, unsaved recovery, revision history and chart return.
   Confirm the original calculator settings/draft and cloud Journal survive.

## Trading storage and execution boundary

Advanced records use new versioned browser-storage keys. Old calculator and
Supabase records are not migrated, deleted or overwritten. This deliberate
coexistence preserves existing user work. Cloud Journal is still its existing
authenticated view; local fills have a distinct local review view. Automatic
cloud synchronization, imports and broker execution are not implemented.

Each tranche's stop and target protect/exit the same shares as alternatives.
After an exit the remaining quantity reduces both. Stop progression activates
only after all planned shares of the trigger tranche are recorded as target
exits; it is a planning state, not an order. Entry/sizing/management rules lock
after the first fill. Fees are recognized as recorded, including entry fees
before a position closes. Actual fill prices may exceed planned capital/risk
assumptions; a recorded fill is an historical fact, not a rejected broker order.

Records and drafts are device-local and can be lost if browser data is cleared.
Export important records. Unreadable storage disables writes. Saved-plan
revision conflicts stop rather than silently replacing newer plans. Saved
revision history is retained before updating the current record; a failed
current-record write may leave an extra history snapshot but does not delete
the prior plan.

## Validation evidence and remaining gates

- Backend: 68 tests passed, including synthetic DuckDB end-to-end reruns,
  byte-identical market database preservation, immutable exports, formula
  fixtures, gaps, episode supersession, cache reuse/corrections and backtests.
- JavaScript: 15 tests passed for chart contract, storage, watchlists, warm-up,
  risk/quantity conservation, fills, progression, short P&L and malformed plans.
- Public and local production builds passed during implementation; rerun after
  applying any follow-up changes. npm audit reported zero vulnerabilities.
- Two upstream test-client deprecation warnings remain; not test failures.
- Real database execution, eligibility audit, measured throughput/disk use,
  all-tools visual QA, mobile watchlist ergonomics, and complete cross-workspace
  browser workflows remain release gates. Preview reached HTML but stayed on
  “Opening your journal…”; root cause was not established here.
- Auto Trendlines (E6), live feeds, broker orders, alerts and portfolio simulation
  remain outside this checkpoint. The Auto Trend control stays unavailable.
