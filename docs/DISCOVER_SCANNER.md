# Discover Scanner and shared EOD updater

## Delivered scope

Discover now contains `Scans | Scanner | Catalysts`. Existing Scans and Catalyst flows are unchanged. Scanner ships one uncapped, configurable `Biggest One Month` result set with exactly Symbol, Dollar volume, and 1M gain % columns. Settings, sorting, and list position use the versioned browser store. Opening a row uses the local chart with all-adjusted prices and returns to Scanner without unmounting the list.

No sample rows are substituted when the local service or a validated publication is unavailable. Loading, unavailable, empty, stale, updating, and failed-update states are distinct. A failed update retains the dated last valid results.

## Data and publication flow

Alpaca SIP is the source for all three daily series in the existing `daily_bars` keyspace:

- `all`: chart default.
- `raw`: Scanner session dollar volume (`raw close × raw actual-share volume`).
- `split`: Scanner growth and ADR inputs.

The updater fetches outside the canonical write transaction, validates uniqueness, authoritative sessions, OHLCV, all/raw/split target coverage, and the configured minimum coverage, then atomically upserts bars, the publication manifest, and Scanner measurements. Default expected coverage is active supported non-OTC instruments that traded in at least three of the prior five sessions, plus newly returned target-session symbols; unexplained missing names are recorded and are not filled with zero.

`brontide.duckdb` remains the single canonical ingestion database. After checkpointing, the updater copies it to a temporary serving snapshot, verifies the publication ID and Scanner table, then replaces `brontide.published.duckdb` atomically with bounded Windows-lock retries. Charts and Scanner read this snapshot. A failed fetch, validation, transaction, or replacement preserves the previous serving file.

The publication manifest records run/publication identity, expected and published session, feed/adjustment coverage, universe/calendar fingerprints, formula version, excluded symbols, coverage, and sanitized failure/retry state. The API contracts are:

- `GET /v1/eod/status`
- `POST /v1/eod/refresh` with `X-Brontide-Local: 1`
- `GET /v1/scanners/biggest-one-month?min_dollar_volume=9000000&min_adr_percent=5&min_growth_rank=93.77`

Chart schema version 1 and existing routes remain compatible; chart status includes publication metadata when present.

## Biggest One Month v1

Every condition is measured at the same authoritative completed session `t`:

- Dollar volume: raw close[t] × raw actual-share volume[t]. Default is strictly greater than $9,000,000.
- Growth: 100 × (split close[t] / split close[t−21 trading sessions] − 1). All 22 authoritative sessions must be present.
- ADR20%: 100 × mean(split high/low − 1) over the 20 sessions ending at t. Default is strictly greater than 5.
- Rank: 100 × (average ascending tie rank − 1)/(N − 1), calculated before liquidity/ADR filtering. N < 2 has no percentile. Default cutoff is inclusive at 93.77.
- Default ordering: growth descending, then symbol ascending. There is no result cap or additional product filter.

The rank comparison universe is active, supported, SIP-queryable, US-listed, non-OTC instruments with valid authoritative lookbacks. It deliberately does not require common-stock classification or Alpaca `tradable`, retaining supported ADRs, ETFs, ETNs, leveraged, and inverse products.

These definitions are provisional where TC2000 evidence is absent. TC2000's exact `Rank Against` universe is unknown; its screenshot does not establish this ADR-percent normalization; and its dividend treatment may differ from split-only growth. Do not claim parity from count agreement.

## Schedule and recovery

The `Brontide EOD Update` Scheduled Task invokes the Scanner checkout's `services/eod/scripts/run-scheduled-update.ps1` every five minutes. The runner calls the same `due-update` command used by service startup and manual refresh. It no-ops before the close+30-minute due time, on non-session days, during a future retry window, or when already current. Full-attempt retries persist at 15, 30, 60, and 120 minutes; short timeout/429/5xx retries remain inside an attempt. An atomic PID/token/timestamp lock ignores overlap and is recovered only when its owner is gone and it is at least six hours old.

The task uses the current interactive Windows account with limited run level, `StartWhenAvailable`, and `IgnoreNew`. No password or secret appears in the action. A powered-off PC cannot update; `StartWhenAvailable` and the explicit service startup check recover missed sessions after Windows returns.

Inspect:

```powershell
Get-ScheduledTask -TaskName 'Brontide EOD Update'
Get-ScheduledTaskInfo -TaskName 'Brontide EOD Update'
Get-Content 'C:\Users\melvi\Projects\Journal\services\eod\data\brontide-eod-update.log' -Tail 20
```

Remove only when explicitly intended:

```powershell
Unregister-ScheduledTask -TaskName 'Brontide EOD Update' -Confirm:$true
```

## Dated reconciliation

The supplied 90-symbol reference is checked in at `services/eod/fixtures/tc2000-biggest-one-month-2026-09-11.json`. Reproduce either interpretation without changing the fixed session:

```powershell
.venv\Scripts\python.exe -m brontide_eod.cli reconcile --env-file C:\path\to\.env --session 2026-09-11 --dollar-volume 9000000 --output report-9m.json
.venv\Scripts\python.exe -m brontide_eod.cli reconcile --env-file C:\path\to\.env --session 2026-09-11 --dollar-volume 89000000 --output report-89m.json
```

Reports contain counts, overlap, missing/additional/unresolved symbols, every reference symbol's metrics, rule failures, and explicit missing-data, universe, formula, adjustment, or unknown limitations.
