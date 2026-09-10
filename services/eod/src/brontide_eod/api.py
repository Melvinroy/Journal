from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from contextlib import asynccontextmanager

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from brontide_eod.chart_repository import ChartRepository, DuckDBChartRepository
from brontide_eod.config import Settings
from brontide_eod.ibkr_readonly import IbkrReadOnlyService
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.research_api import router as research_router, comparison_jobs, repository as research_repository

@asynccontextmanager
async def lifespan(app):
    research_repository().initialize_index()
    comparison_jobs()  # Recover persisted interrupted jobs before serving requests.
    yield


app = FastAPI(title="Brontide EOD API", version="0.2.0", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_credentials=False, allow_methods=["GET","POST"], allow_headers=["*"])
app.include_router(research_router)

_ibkr_read_only_service = IbkrReadOnlyService()


def ibkr_read_only_service() -> IbkrReadOnlyService:
    return _ibkr_read_only_service


def require_local_broker_request(request: Request) -> None:
    if request.headers.get("X-Brontide-Local") != "1":
        raise HTTPException(403, "Local read-only broker request required.")


class IbkrInstrumentRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9.-]+$")
    route: Literal["SMART", "OVERNIGHT"] = "SMART"


class PaperIntentRequest(BaseModel):
    intentId: str = Field(min_length=1, max_length=128)
    idempotencyKey: str = Field(min_length=1, max_length=192)
    planId: str = Field(min_length=1, max_length=128)
    campaignId: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9.-]+$")
    direction: Literal["Long", "Short"]
    method: Literal["Normal", "Limit", "Breakout", "Opening"] = "Normal"
    sessionMode: Literal["Regular", "RegularExtended", "Overnight", "OvernightDay"] = "Regular"
    duration: Literal["DAY", "GTC"] = "DAY"
    protectionOrderType: Literal["STP", "STP LMT"] = "STP"
    protectionLimitPrice: float | None = Field(default=None, gt=0)
    quantity: int = Field(gt=0)
    planningPrice: float = Field(gt=0)
    hardCap: float = Field(gt=0)
    stopPrice: float = Field(gt=0)
    triggerPrice: float | None = Field(default=None, gt=0)
    maximumPriceDriftPercent: float = Field(default=0.5, gt=0)
    exitPlan: dict


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


@app.get("/v1/ibkr/read-only")
def ibkr_read_only_status(
    service: Annotated[IbkrReadOnlyService, Depends(ibkr_read_only_service)],
):
    return service.status()


@app.post("/v1/ibkr/read-only/refresh", dependencies=[Depends(require_local_broker_request)])
def refresh_ibkr_read_only(
    service: Annotated[IbkrReadOnlyService, Depends(ibkr_read_only_service)],
):
    return service.refresh()


@app.post("/v1/ibkr/read-only/disconnect", dependencies=[Depends(require_local_broker_request)])
def disconnect_ibkr_read_only(
    service: Annotated[IbkrReadOnlyService, Depends(ibkr_read_only_service)],
):
    return service.disconnect()


@app.post("/v1/ibkr/read-only/instrument", dependencies=[Depends(require_local_broker_request)])
def ibkr_read_only_instrument(
    payload: IbkrInstrumentRequest,
    service: Annotated[IbkrReadOnlyService, Depends(ibkr_read_only_service)],
):
    try:
        return service.instrument(payload.symbol, payload.route)
    except (PaperSafetyError, RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from None


@app.post("/v1/ibkr/paper/intents", dependencies=[Depends(require_local_broker_request)])
def prepare_ibkr_paper_intent(
    payload: PaperIntentRequest,
    service: Annotated[IbkrReadOnlyService, Depends(ibkr_read_only_service)],
):
    try:
        return service.prepare_intent(payload.model_dump())
    except (PaperSafetyError, RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from None


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
