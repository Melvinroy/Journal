from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from brontide_eod.chart_repository import ChartRepository, DuckDBChartRepository
from brontide_eod.config import Settings

app = FastAPI(title="Brontide EOD API", version="0.2.0")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_credentials=False, allow_methods=["GET"], allow_headers=["*"])


def repository():
    store = None
    try:
        store = DuckDBChartRepository(Settings.from_env().db_path)
        yield store
    except (FileNotFoundError, duckdb.Error):
        # Do not send local paths, SQL, or provider configuration to the browser.
        raise HTTPException(503, "EOD database unavailable. Check the database path and stop any ingestion writer before retrying.") from None
    finally:
        if store is not None:
            store.close()


Repository = Annotated[ChartRepository, Depends(repository)]
Adjustment = Literal["all", "raw", "split", "dividend", "spin-off"]
Source = Annotated[str, Query(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")]


def normalize_symbol(symbol: str) -> str:
    from brontide_eod.store import is_sip_symbol
    value = symbol.strip().upper()
    if len(value) > 32 or not is_sip_symbol(value):
        raise HTTPException(422, "Invalid symbol")
    return value


@app.get("/v1/runtime")
def runtime():
    return {"mode": "local", "api_version": 1}


@app.get("/health")
def health(store: Repository):
    store.search("", 1)
    return {"status": "ok", "service": "brontide-eod", "database": "read_only"}


@app.get("/v1/instruments")
def instruments(store: Repository, q: str = Query("", max_length=100), limit: int = Query(25, ge=1, le=100)):
    return store.search(q.strip(), limit)


@app.get("/v1/instruments/{symbol}")
def instrument(symbol: str, store: Repository):
    result = store.instrument(normalize_symbol(symbol))
    if result is None:
        raise HTTPException(404, "Instrument not found")
    return result


@app.get("/v1/bars/{symbol}")
def bars(symbol: str, store: Repository, limit: int = Query(300, ge=1, le=5000),
         adjustment: Adjustment = "all", source: Source = "alpaca_sip"):
    result = store.bars(normalize_symbol(symbol), limit, adjustment, source)
    if not result:
        raise HTTPException(404, "No ready daily bars for the selected series")
    return result


@app.get("/v1/chart/{symbol}")
def chart(symbol: str, store: Repository, limit: int = Query(1250, ge=1, le=5000),
          adjustment: Adjustment = "all", source: Source = "alpaca_sip"):
    symbol = normalize_symbol(symbol)
    metadata = store.instrument(symbol)
    if metadata is None:
        raise HTTPException(404, "Instrument not found")
    rows = store.bars(symbol, limit, adjustment, source)
    return {"schema_version": 1, "instrument": metadata, "bars": rows,
            "series": {"source": source, "adjustment": adjustment, "timeframe": "1Day",
                       "limit": limit, "returned": len(rows)},
            "status": store.freshness(rows[-1]["session_date"] if rows else None, datetime.now(timezone.utc))}


# Mount only the explicitly built public frontend, never the repository or data directory.
_frontend = Path(__file__).resolve().parents[4] / "out"
if (_frontend / "brontide-local.json").is_file():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")
