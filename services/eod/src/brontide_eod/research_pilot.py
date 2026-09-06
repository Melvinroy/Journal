"""Prepare a bounded, reproducible offline LEAN comparison. No data downloads.

python -m brontide_eod.research_pilot --output ../../output/lean-pilot/evidence
All generated files, caches and comparison runs live below --output.
"""
import argparse
import csv
import json
import time
from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
import ctypes
import duckdb
from brontide_eod.config import Settings
from brontide_eod.features import features
from brontide_eod.feature_cache import FeatureCache
from brontide_eod.scan_engine import definitions, scan, fingerprint
from brontide_eod.backtest_engine import backtest
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.research_analytics import analytics

LEAN_REVISION="23b735d99a357807dc0df9f4c51d30f05fe0d277"


def peak_memory():
    class Memory(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)]+[(n,ctypes.c_size_t) for n in ('peak','working','quota_peak_paged','quota_paged','quota_peak_nonpaged','quota_nonpaged','pagefile','peak_pagefile')]
    m=Memory();m.cb=ctypes.sizeof(m)
    if hasattr(ctypes,'windll'):
        ctypes.windll.kernel32.GetCurrentProcess.restype=ctypes.c_void_p
        get_memory=ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes=[ctypes.c_void_p,ctypes.POINTER(Memory),ctypes.c_ulong]
        if get_memory(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(m),m.cb):return m.peak
    return None


def write_inputs(root,bars_by_symbol,sessions,start,end):
    root.mkdir(parents=True,exist_ok=True);ordinal={d:i for i,d in enumerate(sessions)}
    for symbol,bars in bars_by_symbol.items():
        with (root/f'{symbol}.csv').open('w',newline='') as f:
            writer=csv.writer(f)
            for b in bars:
                d=str(b['session_date']);o=b['open']
                # Open carries ONLY the observable opening price. Full OHLC is
                # delivered at close; the end-time boundary cannot leak the path.
                writer.writerow([d,'open',o,o,o,o,0,ordinal[d]])
                writer.writerow([d,'close',o,b['high'],b['low'],b['close'],b['volume'],ordinal[d]])
    settings={'start':start,'end':end,'warmup_start':sessions[0],'max_hold':'60','target_r':'10','symbols':','.join(sorted(bars_by_symbol))}
    (root/'settings.json').write_text(json.dumps(settings,indent=2))


def fixtures():
    days=[];day=date(2025,1,2)
    while len(days)<145:
        if day.weekday()<5:days.append(str(day))
        day+=timedelta(days=1)
    base=[dict(session_date=d,open=100+i*.1-.1,high=101+i*.1,low=99+i*.1,close=100+i*.1,volume=1000000) for i,d in enumerate(days)]
    ep=base[69]['close']*1.05
    base[70].update(open=base[69]['close'],close=ep,high=ep+.3,low=base[69]['close']-.5,volume=30000000)
    for b in base[71:]:b.update(open=ep+.01,close=ep+.02,high=ep+.1,low=ep-.1,volume=100000)
    result={}
    for case in ('stop','gap','target','ambiguous','missingentry','missingholding','incomplete','maxhold','futureperturbed'):
        bars=deepcopy(base);sessions=days[:]
        if case=='stop':bars[74]['low']=ep-6
        if case=='ambiguous':bars[74].update(low=ep-6,high=ep+50)
        if case=='target':bars[75]['high']=ep+50
        if case=='gap':bars[75].update(open=ep-6,high=ep-5,low=ep-7,close=ep-6)
        if case=='missingentry':del bars[74]
        if case=='missingholding':del bars[75]
        if case=='incomplete':bars=bars[:75];sessions=days[:75]
        if case=='futureperturbed':
            for b in bars[74:]:
                for key in ('open','high','low','close'):b[key]*=3
        result[case]=(sessions,bars)
    return result


def prepare(output, end_override=None):
    output=output.resolve();output.mkdir(parents=True,exist_ok=True)
    db_path=Settings.from_env().db_path;before=(db_path.stat().st_size,db_path.stat().st_mtime_ns)
    phases=defaultdict(float);phase_cpu=defaultdict(float);phase_memory={};wall=time.perf_counter();cpu=time.process_time()
    def timed(name,call):
        t=time.perf_counter();c=time.process_time();v=call();phases[name]+=time.perf_counter()-t
        phase_cpu[name]+=time.process_time()-c;phase_memory[name]=peak_memory();return v
    with duckdb.connect(str(db_path),read_only=True) as db:
        cfg=db.execute("SELECT config_fingerprint,calendar_fingerprint,universe_fingerprint FROM ingestion_configs WHERE timeframe='1Day' AND adjustment='all' AND calendar_fingerprint<>'-' ORDER BY config_fingerprint").fetchone()
        if not cfg:raise ValueError('Frozen daily/all-adjusted calendar configuration required')
        end=str(db.execute("SELECT max(session_date) FROM market_calendar_sessions WHERE calendar_fingerprint=?",[cfg[1]]).fetchone()[0])
        end=min(end,'2026-09-03')
        if end_override:
            requested=date.fromisoformat(end_override).isoformat()
            if requested>end:raise ValueError('Requested end exceeds the frozen dataset')
            end=requested
        start=str(date.fromisoformat(end)-timedelta(days=29))
        sessions=[str(r[0]) for r in db.execute('SELECT session_date FROM market_calendar_sessions WHERE calendar_fingerprint=? AND session_date<=? ORDER BY session_date',[cfg[1],end]).fetchall()]
        universe=[r[0] for r in db.execute('SELECT symbol FROM universe_memberships WHERE universe_fingerprint=?',[cfg[2]]).fetchall()]
        symbols=sorted(sorted(universe,key=lambda s:fingerprint(['lean-pilot-1',s]))[:20])
        def load(s):return [dict(zip(('session_date','open','high','low','close','volume'),r)) for r in db.execute("SELECT session_date,open,high,low,close,volume FROM daily_bars WHERE symbol=? AND source='alpaca_sip' AND timeframe='1Day' AND adjustment='all' AND quality_status='ready' AND session_date<=? ORDER BY session_date",[s,end]).fetchall()]
        bars={s:timed('database_read',lambda:load(s)) for s in symbols}
        spy=timed('database_read',lambda:load('SPY'))
    benchmark={r['session_date']:r.get('return20') for r in features(spy,sessions)}
    # Refuse reused timing directories: otherwise a reported cold miss is a hit.
    if (output/'features').exists():raise ValueError('Use a fresh output directory for cold-cache measurements')
    cache=FeatureCache(output/'features');core={}
    for s,b in bars.items():
        if not b:continue
        fresh=timed('feature_recompute',lambda:features(b,sessions,benchmark))
        cold=timed('cold_cache_compute_hash_compress_write',lambda:cache.compute(s,b,sessions,benchmark))
        warm=timed('warm_cache_hash_read_validate',lambda:cache.compute(s,b,sessions,benchmark))
        assert fresh==cold==warm;core[s]=fresh
    definition=next(d for d in definitions(3) if d.id=='EP-2x-rvol95')
    signals=[]
    for s,f in core.items():signals.extend(r for r in timed('scan',lambda:scan(s,f,definition))['signals'] if start<=r['setup_date']<=end)
    simulation=timed('simulation',lambda:backtest(signals,bars,sessions,definition))
    manifest={'start':start,'end':end,'strategy':definition.manifest(),'config_fingerprint':cfg[0],'universe_fingerprint':cfg[2],
              'data_fingerprint':fingerprint(bars),'selection':'20 smallest SHA256(lean-pilot-1,symbol); no outcome selection','symbols':symbols,
              'window_selection':'User-requested entry-containing window; selected using saved entry dates, not outcomes' if end_override else 'Latest frozen 30 calendar days',
              'empty_symbols':[s for s,b in bars.items() if not b],'warmup_start':sessions[0],'lean_revision':LEAN_REVISION,
              'limitations':['30 calendar days are an engineering check, not strategy validation.','Pre-adjusted custom OHLC parity does not validate corporate actions or point-in-time eligibility.']}
    payload={'kind':'backtest','manifest':manifest,**simulation}
    run_id=timed('publication',lambda:FileResearchRepository(output/'runs').publish(payload))
    write_inputs(output/'real',bars,sessions,start,end)
    expected={'real':{'signals':signals,**simulation,'analytics':analytics(payload)}}
    for case,(days,bs) in fixtures().items():
        symbol='FIXTURE';score_start=days[73];score_end=days[-1]
        ss=[r for r in scan(symbol,features(bs,days),definition)['signals'] if score_start<=r['setup_date']<=score_end]
        simulation=backtest(ss,{symbol:bs},days,definition)
        expected[case]={'signals':ss,**simulation}
        write_inputs(output/case,{symbol:bs},days,score_start,score_end)
    (output/'expected.json').write_text(json.dumps(expected,indent=2,default=str))
    metrics={'phases_seconds':dict(phases),'phase_cpu_seconds':dict(phase_cpu),'phase_process_high_water_bytes':phase_memory,'wall_seconds':time.perf_counter()-wall,'cpu_seconds':time.process_time()-cpu,'peak_working_set_bytes':peak_memory(),
             'cache_hits':cache.hits,'cache_misses':cache.misses,'symbol_count':len(symbols),'warmup_inclusive_bars':sum(map(len,bars.values())),
             'scored_signals':len(signals),'source_db_unchanged_size_mtime':before==(db_path.stat().st_size,db_path.stat().st_mtime_ns),
             'run_id':run_id,'manifest':manifest}
    (output/'preparation.json').write_text(json.dumps(metrics,indent=2));print(json.dumps(metrics,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    p.add_argument('--end',help='Optional ISO end date for a 30-calendar-day window within the frozen dataset')
    args=p.parse_args();prepare(args.output,args.end)
