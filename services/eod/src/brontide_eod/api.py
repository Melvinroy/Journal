from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from contextlib import asynccontextmanager

import duckdb
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from brontide_eod.chart_repository import ChartRepository, DuckDBChartRepository
from brontide_eod.config import Settings
from brontide_eod.ibkr_readonly import IbkrReadOnlyService
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.research_api import router as research_router, comparison_jobs, repository as research_repository
from brontide_eod.providers.alpaca import AlpacaProvider
from brontide_eod.scanner import (
    BIGGEST_ONE_MONTH_FORMULA_VERSION,
    DEFAULT_MIN_ADR_PERCENT,
    DEFAULT_MIN_DOLLAR_VOLUME,
    DEFAULT_MIN_GROWTH_RANK,
    validate_scanner_thresholds,
)
from brontide_eod.updater import (
    LockClaim,
    UpdateLockedError,
    acquire_update_lock,
    lock_is_owned,
    read_update_status,
    run_update,
)

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
        settings = Settings.from_env()
        serving_path = settings.serving_db_path if settings.serving_db_path.is_file() else settings.db_path
        store = DuckDBChartRepository(serving_path)
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


def _background_eod_update(settings: Settings, run_id: str, lock_claim: LockClaim | None = None) -> None:
    try:
        with AlpacaProvider(
            settings.alpaca_api_key,
            settings.alpaca_api_secret,
            trading_base_url=settings.alpaca_trading_base_url,
        ) as provider:
            run_update(settings, provider, force=True, run_id=run_id, lock_claim=lock_claim)
    except BaseException:
        # The updater stores a sanitized failure state; request handlers and logs
        # must never receive credentials or raw provider response bodies.
        return
    finally:
        if lock_claim is not None:
            lock_claim.release()


def _shared_eod_status() -> dict:
    settings = Settings.from_env()
    lock_path = settings.db_path.with_suffix(settings.db_path.suffix + ".update.lock")
    if lock_is_owned(lock_path):
        status = read_update_status(settings.serving_db_path)
        return {**status, "state": "updating", "explanation": "A validated EOD update is in progress."}
    try:
        return read_update_status(settings.db_path)
    except duckdb.Error:
        return read_update_status(settings.serving_db_path)


@app.get("/v1/eod/status")
def eod_status():
    return _shared_eod_status()


@app.post("/v1/eod/refresh", status_code=202, dependencies=[Depends(require_local_broker_request)])
def refresh_eod(background_tasks: BackgroundTasks):
    import uuid
    settings = Settings.from_env(require_alpaca=True)
    lock_path = settings.db_path.with_suffix(settings.db_path.suffix + ".update.lock")
    try:
        claim = acquire_update_lock(lock_path)
    except UpdateLockedError:
        raise HTTPException(409, "Another EOD update is already running.") from None
    run_id = str(uuid.uuid4())
    background_tasks.add_task(_background_eod_update, settings, run_id, claim)
    return {"state": "queued", "run_id": run_id}


@app.get("/v1/scanners/biggest-one-month")
def biggest_one_month(
    store: Repository,
    min_dollar_volume: float = Query(DEFAULT_MIN_DOLLAR_VOLUME),
    min_adr_percent: float = Query(DEFAULT_MIN_ADR_PERCENT),
    min_growth_rank: float = Query(DEFAULT_MIN_GROWTH_RANK),
):
    try:
        validate_scanner_thresholds(min_dollar_volume, min_adr_percent, min_growth_rank)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    try:
        result = store.biggest_one_month(min_dollar_volume, min_adr_percent, min_growth_rank)
        status = _shared_eod_status()
        universe = result.get("comparison_universe") or {}
        if result.get("formula_version") != BIGGEST_ONE_MONTH_FORMULA_VERSION and status.get("state") == "current":
            status = {**status, "state": "stale",
                      "explanation": "Scanner measurements use a superseded formula; showing the last validated results until a TC2000 parity refresh succeeds."}
        elif universe.get("stale") and status.get("state") == "current":
            source = universe.get("source") or "unknown"
            status = {**status, "state": "stale",
                      "explanation": f"Scanner universe membership is stale ({source}); showing the last validated results."}
        result["status"] = status
        return result
    except duckdb.CatalogException:
        raise HTTPException(503, "Scanner publication is unavailable. Run the local EOD updater before retrying.") from None


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
