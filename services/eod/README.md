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
