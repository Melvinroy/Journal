"""Read-only research evidence and explicit bounded local comparison jobs."""
from __future__ import annotations
from datetime import date, datetime, timezone
import duckdb
from fastapi import APIRouter, HTTPException, Query, Request
import threading
from fastapi.responses import JSONResponse
from brontide_eod.config import Settings
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.chart_repository import DuckDBChartRepository
from brontide_eod.research_analytics import CATALOG, METRICS, analytics, enrich_trades, filter_sort
from brontide_eod.research_read_cache import joined, aggregate

router=APIRouter(prefix="/v1/research")
_job_services={}
_job_service_lock=threading.Lock()


def comparison_jobs():
    from brontide_eod.research_comparison_jobs import ComparisonJobs
    db=Settings.from_env().db_path.resolve()
    with _job_service_lock:
        if db not in _job_services: _job_services[db]=ComparisonJobs(repository(),db)
        return _job_services[db]


@router.get("/runs/{run_id}/lean-comparison")
def comparison_status(run_id:str):
    run=read(run_id)
    return comparison_jobs().status(run)


@router.post("/runs/{run_id}/lean-comparison",status_code=202)
def start_comparison(run_id:str,request:Request):
    origin=request.headers.get("origin")
    allowed={str(request.base_url).rstrip("/"),"http://localhost:3000","http://127.0.0.1:3000"}
    if request.headers.get("x-brontide-local")!="1" or (origin and origin not in allowed):
        raise HTTPException(403,"Comparison jobs must be requested explicitly from the local app")
    if request.client and request.client.host not in ("127.0.0.1","::1","testclient"):
        raise HTTPException(403,"Comparison jobs are local only")
    try:return comparison_jobs().start(read(run_id))
    except ValueError as e:raise HTTPException(422,str(e)) from None
    except RuntimeError as e:raise HTTPException(409,str(e)) from None


@router.get("/comparisons/{report_id}")
def comparison_report(report_id:str):
    result=read(report_id)
    if result.get("kind")!="engine_comparison":raise HTTPException(404,"Comparison report not found")
    return result


@router.get("/metrics")
def metrics():
    return CATALOG


def repository():
    return FileResearchRepository(Settings.from_env().db_path.parent/"research")


def read(run_id):
    try: return repository().get(run_id)
    except FileNotFoundError: raise HTTPException(404,"Research run not found") from None
    except (ValueError,OSError,EOFError): raise HTTPException(503,"Research object unavailable or failed integrity verification") from None


@router.get("/runs")
def runs(kind: str=Query("scan",pattern="^(scan|backtest)$"),limit:int=Query(30,ge=1,le=100),include_analytics:bool=False):
    try:
        result=repository().list(kind,limit)
        if include_analytics and kind=="backtest":
            result=[{**r,"engine":r["manifest"].get("engine",{"id":"current","label":"Current engine"})} for r in result]
        else:result=[{k:v for k,v in r.items() if k!="analytics"} for r in result]
        return {"runs":result,"mode":"local","read_only":True}
    except (ValueError,OSError,EOFError): raise HTTPException(503,"Research manifests unavailable") from None


@router.get("/runs/{run_id}")
def metadata(run_id:str,include_freshness:bool=True):
    run=read(run_id)
    result={key:run[key] for key in ("run_id","kind","manifest","summary","sessions","execution") if key in run}
    result["engine"]=run["manifest"].get("engine",{"id":"current","label":"Current engine"})
    if not include_freshness:return result
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
         sort:str=Query("setup_date",max_length=80),descending:bool=False,enriched:bool=False,
         compact:bool=False,fields:str=Query("",max_length=4000)):
    run=read(run_id)
    values=run.get(view,[])
    if sort not in {"setup_date","symbol","outcome_r"} and (view!="trades" or sort not in METRICS or METRICS[sort]["scope"]!="trade"):
        raise HTTPException(422,"Unsupported sort field")
    requested=[f for f in fields.split(",") if f]
    if requested and (view!="trades" or any(f not in METRICS or METRICS[f]["scope"]!="trade" for f in requested)):
        raise HTTPException(422,"Unsupported projected trade field")
    if view=="trades" and (enriched or sort.startswith("setup.") or any(f.startswith("setup.") for f in requested)):
        values=joined(repository(),run)
    if view=="trades":
        filtered=filter_sort(values,symbol,session,sort,descending)
    else:
        # Preserve Research Scans' original ordering and null placement.
        filtered=[row for row in values if (not session or row.get("setup_date")==session)
                  and (not symbol or symbol.strip().upper() in row["symbol"])]
        filtered.sort(key=lambda row:(row.get(sort) is not None,row.get(sort) if row.get(sort) is not None else 0,row.get("symbol",""),row.get("signal_id","")),reverse=descending)
    page=filtered[offset:offset+limit]
    if compact and view=="trades":
        identity={"symbol","setup_date","signal_id","trade_id","strategy_id","status"}
        names=identity|{f for f in requested if not f.startswith("setup.")}
        page=[{**{k:v for k,v in r.items() if k in names},"measurements":{f[6:]:r.get("measurements",{}).get(f[6:]) for f in requested if f.startswith("setup.")}} for r in page]
    return {"run_id":run_id,"total":len(filtered),"offset":offset,"rows":page}


@router.get("/runs/{run_id}/trades/{trade_id}")
def trade_detail(run_id:str,trade_id:str):
    run=read(run_id)
    trade=next((r for r in joined(repository(),run) if r.get("trade_id")==trade_id),None)
    if trade is None:raise HTTPException(404,"Trade not found in selected run")
    return {"run_id":run_id,"trade":trade}


@router.get("/runs/{run_id}/analytics")
def run_analytics(run_id:str,symbol:str=Query("",max_length=32),session:str=Query("",max_length=10)):
    run=read(run_id)
    if run.get("kind") not in ("backtest","engine_result"): raise HTTPException(422,"Trade analytics require a backtest run")
    return {"run_id":run_id,**aggregate(repository(),run,symbol,session)}
