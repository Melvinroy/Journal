# Brontide EOD service

Local-only market-data service for Brontide. It discovers active U.S. equities through Alpaca, downloads completed daily SIP bars, validates them, stores them in DuckDB and exposes bounded chart endpoints through FastAPI.

## Security boundary

Alpaca credentials belong only in `services/eod/.env` on the machine running the service. Never add credentials to Next.js variables, browser code, Supabase or the public GitHub Pages build.

## Setup

### Windows PowerShell

```powershell
cd services/eod
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

### macOS or Linux

```bash
cd services/eod
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
```

Add the two Alpaca values to `.env`; the service loads that local file automatically. Then run:

```bash
brontide-eod init-db
brontide-eod health
brontide-eod refresh-universe
brontide-eod ingest-session --session 2026-09-03
brontide-eod serve
```

The API listens on `127.0.0.1:8765` by default:

- `GET /health`
- `GET /v1/instruments?q=NVDA`
- `GET /v1/bars/NVDA?limit=300`

## EOD operating rule

Only request a completed session after Alpaca's 15-minute historical SIP delay has elapsed. The CLI requires an explicit `YYYY-MM-DD` session so a scheduler cannot silently ingest the wrong trading day. Market-calendar resolution and nightly scheduling are the next slice.

## Phase 1: open your existing EOD database in the chart

Use the existing `data/brontide.duckdb`; **do not run init-db or a backfill again** for this step. The chart service does not require Alpaca credentials to read an existing database. Stop an ingestion writer before starting the API: separate DuckDB writer and reader processes cannot share a write-locked database.

With the Python environment above installed, run from the repository root:

```powershell
cd C:\Users\melvi\Projects\Journal
services\eod\.venv\Scripts\python.exe -m pip install -e "./services/eod[dev]"
npm ci
npm run local
```

The launcher builds the current frontend for local use, then starts FastAPI with `services/eod` as its working directory. Open `http://127.0.0.1:8765/charts/`. This chart route needs no journal cloud-account setup. Existing journal authentication is unchanged. The API host/port still honor the local `.env`; keep the host on loopback. `BRONTIDE_DB_PATH` is relative to `services/eod` when using this launcher. Ctrl+C stops the service.

The local frontend offers **Local EOD** and **Sample demo**. Symbol search includes active and inactive instruments; unavailable series show an empty state. Failed API reads never silently replace real values with sample prices. Select an instrument, then choose **All adjusted** or **Raw**. The default is the stored `alpaca_sip` / `1Day` / `all` / `ready` series. `all` means the provider's all-adjustment policy as stored by ingestion; `raw` is unadjusted. No values are adjusted in the browser, and an absent raw series is not reconstructed from adjusted data. The metadata endpoint lists the available stored series.

The API exposes:

| Route | Response |
|---|---|
| `/health` | Database readiness; 503 if missing, locked, or incompatible |
| `/v1/runtime` | Local API identity, independent of database availability |
| `/v1/instruments?q=AAPL&limit=20` | Bounded symbol/name search |
| `/v1/instruments/AAPL` | Instrument metadata and available ready series |
| `/v1/bars/AAPL?limit=300&adjustment=all&source=alpaca_sip` | Chronological OHLCV array, preserving the existing endpoint shape |
| `/v1/chart/AAPL?limit=5000&adjustment=all&source=alpaca_sip` | Bars, instrument, series, and freshness envelope |

All requests use read-only connections through `ChartRepository`; they do not initialize or migrate the ingestion store. Bar reads are bounded at 5,000 sessions and never mix sources, adjustments, timeframes, or quality states. “Max” means the latest 5,000 stored sessions, enough to include this initial dataset. Date labels represent market session dates in UTC; chart indicators retain the loaded warm-up history when changing visible ranges.

Freshness uses stored authoritative session closes plus the 15-minute SIP delay. A symbol behind the latest known completed session is labeled stale. If the stored calendar does not cover today, the UI asks to check freshness instead of declaring the data current. This is a calendar-coverage signal, not a reason to rerun the historical backfill. Suspended/inactive symbols may legitimately lag the calendar.

`npm run build` retains the `/Journal` GitHub Pages sample build. `npm run local` uses the same UI at the root URL. Only the exported `out` frontend is served by FastAPI, and only after the local launcher creates its build marker; `.env`, the repository, and databases are never mounted. GitHub Pages has no local-data switch and makes no local API requests. Do not publish a local build; the normal Pages workflow rebuilds the sample bundle.

### Verify AAPL, MSFT, NVDA and SPY on your Windows database

Leave `npm run local` running. In another PowerShell terminal:

```powershell
cd C:\Users\melvi\Projects\Journal\services\eod
.venv\Scripts\python.exe -m brontide_eod.verify_chart
```

This compares every returned daily OHLCV record with the corresponding stored series for all four tickers and prints one compact result per ticker. It performs no downloads or writes. If the API port differs, supply `--url http://127.0.0.1:YOUR_PORT`; `--db` accepts an explicit database path. Stop if any comparison fails.

Validation commands:

```powershell
# From services/eod
.venv\Scripts\python.exe -m pytest -q
# From the repository root
npm run test:chart
npm run build
```

Before Phase 2, check the local chart at desktop and phone widths: search each required ticker, compare the latest candle, select Raw (empty is expected if absent), switch ranges, pan/zoom, open drawing groups, toggle dark mode, switch sample/local, and retry after stopping/restarting the service. Confirm roughly 20% future whitespace and no overlapping controls. Existing Auto Trend and drawing tools remain prototypes; their algorithms/lifecycle are not newly validated by Phase 1.
