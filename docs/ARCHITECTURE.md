# Brontide architecture

## Decision

Brontide is local-first for one swing trader and cloud-ready for a future multi-user service. The public GitHub Pages build remains a read-only demo. The working product runs the same web UI against a configurable API URL, so moving from a desktop service to a hosted API does not require rebuilding the chart or strategy logic.

## System boundaries

```text
Brontide Web / PWA
        |
        v
Versioned REST API + WebSocket events
        |
        +-- Market data provider port
        +-- Bar repository port
        +-- Analysis engine
        +-- Scan and backtest engine
        +-- Workspace repository port
        +-- Broker execution port
```

Provider, repository, and broker implementations are adapters. Domain code accepts canonical bars and does not import Alpaca, Yahoo, DuckDB, Supabase, or Interactive Brokers packages directly.

## Local deployment: 1 user

| Layer | Choice | Responsibility |
|---|---|---|
| Web | Existing Next.js chart UI | Charts, scans, backtests, journal, trade planning |
| API | Python FastAPI process | Stable chart/scan/backtest endpoints and future WebSocket events |
| Jobs | APScheduler initially | End-of-day ingest, validation, features, scans and snapshots |
| Historical seed | Alpaca historical SIP plus existing licensed archive | Alpaca supplies the reproducible baseline; reuse the archive only after its coverage, adjustments and licence pass audit |
| Primary EOD | Alpaca free historical SIP adapter | Full-exchange US stock/ETF daily OHLCV after the 15-minute restriction |
| Broker-linked source | IBKR adapter | Optional entitled-history and reconciliation source; not the only ingestion path |
| Fallback | yfinance adapter | Personal research/bootstrap only; never the sole trusted production source |
| Validation | Alpha Vantage adapter | Small-symbol reconciliation because the free plan is request-limited |
| Analytics store | DuckDB | Fast local SQL for bars, features, signals and backtests |
| Durable files | Partitioned Parquet | Portable raw and normalized market-data history |
| App metadata | PostgreSQL 16 | Fresh Brontide schema; selectively adapt proven Traders Cockpit patterns |
| Packaging | Docker Compose | One-command desktop installation with explicit volumes and backups |

Alpaca free historical SIP is the primary Brontide source because it covers consolidated US-exchange stock and ETF activity and completed daily data is older than the free plan's 15-minute restriction. Real-time or historical IEX-only bars must not be used for volume-sensitive EP scans because they represent only one exchange.

The active security master merges Alpaca assets with Nasdaq Trader's `nasdaqlisted.txt` and `otherlisted.txt`, then maps IBKR contract IDs where available. This prevents any single provider's tradability flags from defining the research universe. Historical delisted coverage remains a separate audit requirement because a current active-symbol list cannot remove survivorship bias from backtests.

IBKR is an optional adapter, not a presumed free feed. Its API requires the relevant market-data entitlement for most securities, an authenticated TWS/IB Gateway or Web API brokerage session, and rate-aware batching. It is valuable for broker reconciliation and a future execution path, but a local nightly universe scan must continue when IBKR is unavailable.

## Reference assessment: CatalystIQ and Traders Cockpit

Both earlier repositories are reference material, not Brontide foundations. Their code and product decisions must pass independent review before reuse. Traders Cockpit is the richer reference because it contains a working local stack and trade-management workflow; CatalystIQ contributes earlier provider-normalization experiments.

Good candidates to adapt:

- FastAPI, SQLAlchemy 2 and Alembic structure;
- PostgreSQL 16 Docker/Alembic workflow, into a new Brontide-owned schema;
- Redis/WebSocket fanout and normalized event contracts;
- authentication, account settings, positions, orders, audit log and safety guardrails;
- Alpaca credential/config conventions and paper/live execution gating.

Build cleanly behind Brontide interfaces:

- replace the current single-symbol setup adapter with `MarketDataProvider` capabilities for symbol discovery, daily bars and provider health;
- add canonical `instruments`, `daily_bars`, `data_ingest_runs`, `data_quality_issues`, `scan_runs`, `scan_candidates`, `backtest_runs` and `backtest_trades` schemas;
- keep raw/normalized OHLCV as partitioned Parquet and expose it through a `BarRepository`; use DuckDB for cross-sectional scans and backtests;
- export or read any existing premium-vendor bar tables through a one-time audit adapter before migration.

Traders Cockpit's GitHub repository contains a real PostgreSQL trading schema, but it does **not** contain the premium-vendor historical database or an OHLCV table. Its current market-data adapter requests per-symbol Alpaca IEX daily bars with `adjustment=raw`, derives ATR, and still uses fallback values for several technical fields. This confirms that its execution and safety ideas are the useful reference; its market-data layer is not suitable as Brontide's research truth without replacement. The uncommitted local premium-vendor database must be inspected separately on the user's desktop.

## Canonical data contract

Every provider maps into the same versioned bar schema:

```text
symbol, session_date, timeframe, open, high, low, close, volume,
trade_count, vwap, adjustment, source, source_timestamp,
ingested_at, quality_status, schema_version
```

Store both raw provider values and normalized values. Corporate actions, symbol changes, exchange calendars and adjustment policy are separate versioned datasets. Backtest runs record the exact dataset version and strategy version used.

## Data layers

1. `raw` — immutable provider responses and ingest manifests.
2. `normalized` — canonical split/dividend policy, sessions, symbols and OHLCV.
3. `features` — SMA, ATR, relative volume, pivots, trendlines and pattern inputs.
4. `signals` — scans, candidates, explanations and confidence data.
5. `research` — trades, outcomes, backtest runs, parameters and metrics.

The daily pipeline is idempotent and incremental:

```text
discover symbols -> fetch completed session -> validate -> normalize ->
compute features -> run scans -> snapshot candidates -> publish API cache
```

Validation blocks a session from becoming `ready` when duplicate keys, missing bars, impossible OHLC relationships, negative volume, stale timestamps, or material provider disagreement is found.

## Auto Trend contract

Auto Trend consumes only canonical bars. Version 1 uses a deterministic recent-window algorithm:

- confirmed 5-left/5-right pivot highs and lows;
- same-side anchor pairs: highs for resistance, lows for support;
- ATR-adjusted touch tolerance;
- scoring for touches, line integrity, recency, length and current relevance;
- three completed closes for breakout invalidation;
- at most one active resistance and one active support line;
- analysis timestamp and algorithm version stored with results.

This keeps the feature explainable, testable and identical in local or cloud deployments.

## Cloud migration: 5–100 users

| Local component | Cloud replacement | Migration method |
|---|---|---|
| Local Next.js | CDN-hosted web app | Change deployment only |
| FastAPI process | Stateless API containers | Same API contract and domain packages |
| APScheduler | Managed cron/queue workers | Same idempotent job handlers |
| DuckDB analytics | Postgres for serving plus object-storage Parquet | Repository adapter and bulk copy |
| Local PostgreSQL metadata | Managed PostgreSQL or Supabase Postgres | Run the same Alembic migrations and add ownership-based RLS where supported |
| Local files | S3-compatible object storage | Copy immutable partitions and manifests |
| Local secrets | Managed secret store | Environment-based adapter configuration |

Supabase remains an optional managed-PostgreSQL/auth destination, not a Phase 2 dependency. Large immutable OHLCV history stays in Parquet/object storage; it should not be duplicated into every user's database.

## Real-time migration

Real-time is a new ingestion adapter, not a redesign:

```text
paid SIP/WebSocket -> stream consumer -> minute-bar builder -> event bus ->
hot time-series store -> existing canonical bars/features/API
```

At that stage, add a durable queue and a time-series/columnar service only when measured load requires it. Daily research continues to use finalized bars so live corrections cannot silently rewrite a backtest.

## Scale and security rules

- API keys remain server-side and never enter the public GitHub Pages bundle.
- Every cloud row carrying private user state has `user_id` or `workspace_id` ownership and RLS.
- Strategies, schemas, indicators and provider mappings are explicitly versioned.
- Ingest jobs use checkpoints, retry budgets and provider rate-limit controls.
- Raw data and manifests are append-only; normalized partitions can be rebuilt.
- Charts request bounded windows; scans and backtests execute server-side.
- Repository and provider contract tests run against fixtures before deployment.

## Delivery phases

1. Auto Trend on current sample bars, with deterministic scoring and chart toggle.
2. Local EOD engine: run a fresh Brontide FastAPI service, ingest Alpaca SIP into DuckDB/Parquet, audit the premium archive, add the Nasdaq symbol master plus optional IBKR validation, then schedule scans.
3. Drawing lifecycle: undo/redo, locks, persistence, layouts and hotkeys.
4. Multi-timeframe structure: daily/weekly lines, aligned features, scans and backtests.
5. Trade planning: line-based entry/stop/targets, risk sizing and broker adapter; alerts and real-time execution follow only after audit and paper trading.

## Explicit non-goals for the first release

- No real-time market-data subscription.
- No browser-exposed provider or broker secrets.
- No automatic live order submission.
- No dependence on one data vendor, database, broker, or cloud host.
- No claim that free data is licensed for redistribution to future external users.
