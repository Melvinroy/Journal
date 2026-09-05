"""Offline deterministic research runner. Reads existing bars; never downloads them.

python -m brontide_eod.research_job --help
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import duckdb

from brontide_eod.config import Settings
from brontide_eod.features import FEATURE_VERSION, features
from brontide_eod.scan_engine import definitions, fingerprint, scan
from brontide_eod.backtest_engine import backtest, summarize
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.feature_cache import FeatureCache


def code_fingerprint():
    return fingerprint({name:Path(__file__).with_name(name).read_text() for name in
                        ("features.py","feature_cache.py","scan_engine.py","backtest_engine.py","research_job.py")})


def run_job(db_path: Path, config_id: str, start: str, end: str, drop_percent: float, output: Path, include_backtests: bool=False):
    if start>end: raise ValueError("Start must be before end")
    if not db_path.is_file(): raise FileNotFoundError("Existing market database required")
    cache=FeatureCache(output/"features")
    with duckdb.connect(str(db_path),read_only=True) as db:
        cursor=db.execute("SELECT timeframe,adjustment,calendar_fingerprint,universe_fingerprint FROM ingestion_configs WHERE config_fingerprint=?",[config_id])
        row=cursor.fetchone()
        if row is None: raise ValueError("Select an existing ingestion configuration fingerprint")
        config=dict(zip([c[0] for c in cursor.description],row))
        if config["timeframe"]!="1Day": raise ValueError("Daily bars required")
        sessions=[str(row[0]) for row in db.execute("SELECT session_date FROM market_calendar_sessions WHERE calendar_fingerprint=? AND session_date<=? ORDER BY session_date",[config["calendar_fingerprint"],end]).fetchall()]
        if not sessions or start not in sessions or end not in sessions: raise ValueError("Start/end must be covered market sessions")
        symbols=[row[0] for row in db.execute("SELECT symbol FROM universe_memberships WHERE universe_fingerprint=? ORDER BY symbol",[config["universe_fingerprint"]]).fetchall()]
        if not symbols: raise ValueError("Frozen universe is empty")
        def load(symbol):
            return [dict(zip(("session_date","open","high","low","close","volume"),row)) for row in db.execute(
                "SELECT session_date,open,high,low,close,volume FROM daily_bars WHERE symbol=? AND source=? AND timeframe='1Day' AND adjustment=? AND quality_status='ready' AND session_date<=? ORDER BY session_date",
                [symbol,"alpaca_sip",config["adjustment"],end]).fetchall()]
        spy=load("SPY")
        spy_features=features(spy,sessions)
        benchmark={row["session_date"]:row.get("return20") for row in spy_features}
        variants=definitions(drop_percent)
        collected={definition.id:{"signals":[],"evaluations":[]} for definition in variants}
        bar_hashes,coverage={},[]
        simulations={definition.id:backtest([],{},sessions,definition) for definition in variants}
        history_sessions=[day for day in sessions if start<=day<=end]
        detail_from=history_sessions[-30:][0]
        for index,symbol in enumerate(symbols):
            bars=load(symbol)
            bar_hashes[symbol]=fingerprint(bars)
            if not bars: coverage.append({"symbol":symbol,"reason":"no ready bars"});continue
            core=cache.compute(symbol,bars,sessions,benchmark)
            for definition in variants:
                result=scan(symbol,core,definition,detail_from)
                selected=[record for record in result["signals"] if start<=record["setup_date"]<=end]
                collected[definition.id]["signals"].extend(selected)
                collected[definition.id]["evaluations"].extend(result["evaluations"])
                if include_backtests:
                    simulations[definition.id]["trades"].extend(backtest(selected,{symbol:bars},sessions,definition)["trades"])
            if index%100==0: print(json.dumps({"stage":"features_scans","processed":index+1,"universe":len(symbols)}),file=sys.stderr)
    base={"schema_version":1,"feature_version":FEATURE_VERSION,"code_fingerprint":code_fingerprint(),"config_fingerprint":config_id,
          "universe_fingerprint":config["universe_fingerprint"],"calendar_fingerprint":config["calendar_fingerprint"],
          "data_fingerprint":fingerprint(bar_hashes),"benchmark_fingerprint":fingerprint(spy),"source":"alpaca_sip","adjustment":config["adjustment"],
          "start":start,"end":end,"universe_count":len(symbols),"missing_symbols":len(coverage),
          "eligibility":"frozen SIP universe; historical common-stock/ADR/ETF classification is not reconstructed",
          "limitations":["Unvalidated hypotheses, not faithful reproductions of the old registry.","Corporate-action revisions and historical eligibility require separate audit.","No historical security-type filter: results may include ETFs."]}
    store=FileResearchRepository(output)
    published=[]
    for definition in variants:
        result=collected[definition.id]
        manifest={**base,"strategy":definition.manifest()}
        signals=sorted(result["signals"],key=lambda row:(row["setup_date"],row["symbol"],row["event_id"]))
        counts={day:0 for day in history_sessions}
        for signal in signals: counts[signal["setup_date"]]+=1
        payload={"kind":"scan","manifest":manifest,"sessions":[{"session_date":day,"status":"complete","candidates":count} for day,count in counts.items()],
                 "signals":signals,"evaluations":result["evaluations"],"coverage":coverage,
                 "summary":{"candidates":len(signals),"sessions":len(counts),"zero_signal_sessions":sum(count==0 for count in counts.values())}}
        scan_id=store.publish(payload);published.append(scan_id)
        if include_backtests:
            simulation=simulations[definition.id]
            simulation["summary"]=summarize(simulation["trades"])
            published.append(store.publish({"kind":"backtest","manifest":{**manifest,"scan_run_id":scan_id,"execution_fingerprint":fingerprint(simulation["execution"])},**simulation}))
    print(json.dumps({"stage":"complete","feature_cache_hits":cache.hits,"feature_cache_misses":cache.misses,"run_count":len(published)}),file=sys.stderr)
    return {"run_ids":published,"data_fingerprint":base["data_fingerprint"]}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-fingerprint")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--list-configs",action="store_true",help="Read existing configuration metadata; do not run research")
    parser.add_argument("--distribution-drop",type=float,default=3,help="Reserved percent-mode parameter; reconstructed variants use the documented 0.75 prior-ATR distribution rule")
    parser.add_argument("--backtests",action="store_true")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    path=Settings.from_env().db_path
    if args.list_configs:
        if not path.is_file():parser.error("Existing market database required")
        with duckdb.connect(str(path),read_only=True) as db:
            cursor=db.execute("SELECT c.config_fingerprint,c.timeframe,c.adjustment,c.universe_fingerprint,c.calendar_fingerprint,(SELECT count(*) FROM universe_memberships u WHERE u.universe_fingerprint=c.universe_fingerprint) AS universe_count FROM ingestion_configs c ORDER BY universe_count DESC,c.config_fingerprint")
            columns=[c[0] for c in cursor.description]
            print(json.dumps([dict(zip(columns,row)) for row in cursor.fetchall()]))
        return
    if not all((args.config_fingerprint,args.start,args.end)):parser.error("--config-fingerprint, --start and --end are required for a research run")
    print(json.dumps(run_job(path,args.config_fingerprint,args.start,args.end,args.distribution_drop,args.output or path.parent/"research",args.backtests)))


if __name__=="__main__": main()
