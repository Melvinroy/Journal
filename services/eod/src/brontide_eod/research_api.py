"""Bounded read-only research routes. Offline jobs are never started by GET requests."""
from __future__ import annotations
from datetime import date, datetime, timezone
import duckdb
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from brontide_eod.config import Settings
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.chart_repository import DuckDBChartRepository

router=APIRouter(prefix="/v1/research")


def repository():
    return FileResearchRepository(Settings.from_env().db_path.parent/"research")


def read(run_id):
    try: return repository().get(run_id)
    except FileNotFoundError: raise HTTPException(404,"Research run not found") from None
    except (ValueError,OSError,EOFError): raise HTTPException(503,"Research object unavailable or failed integrity verification") from None


@router.get("/runs")
def runs(kind: str=Query("scan",pattern="^(scan|backtest)$"),limit:int=Query(30,ge=1,le=100)):
    try: return {"runs":repository().list(kind,limit),"mode":"local","read_only":True}
    except (ValueError,OSError,EOFError): raise HTTPException(503,"Research manifests unavailable") from None


@router.get("/runs/{run_id}")
def metadata(run_id:str):
    run=read(run_id)
    result={key:run[key] for key in ("run_id","kind","manifest","summary","sessions","execution") if key in run}
    market=None
    try:
        market=DuckDBChartRepository(Settings.from_env().db_path)
        result["freshness"]=market.freshness(date.fromisoformat(run["manifest"]["end"]),datetime.now(timezone.utc))
    except (FileNotFoundError,ValueError,KeyError,duckdb.Error):
        result["freshness"]={"freshness":"unknown","expected_session":None,"calendar_covered":False}
    finally:
        if market is not None:market.close()
    return result


@router.get("/runs/{run_id}/export")
def export(run_id:str):
    return JSONResponse(read(run_id),headers={"Content-Disposition":f'attachment; filename="brontide-{run_id}.json"'})


@router.get("/runs/{run_id}/rows")
def rows(run_id:str,view:str=Query("signals",pattern="^(signals|evaluations|trades)$"),
         session:str=Query("",max_length=10),symbol:str=Query("",max_length=32),
         offset:int=Query(0,ge=0),limit:int=Query(100,ge=1,le=500),
         sort:str=Query("setup_date",pattern="^(setup_date|symbol|outcome_r)$"),descending:bool=False):
    run=read(run_id)
    values=run.get(view,[])
    filtered=[row for row in values if (not session or row.get("setup_date")==session)
              and (not symbol or symbol.strip().upper() in row["symbol"])]
    filtered.sort(key=lambda row:(row.get(sort) is not None,row.get(sort) if row.get(sort) is not None else 0,row.get("symbol",""),row.get("signal_id","")),reverse=descending)
    return {"run_id":run_id,"total":len(filtered),"offset":offset,"rows":filtered[offset:offset+limit]}
