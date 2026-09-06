"""Bounded derived views of verified immutable research objects."""
from collections import OrderedDict
import json
from threading import RLock
from brontide_eod.research_analytics import VERSION, analytics, enrich_trades, filter_sort

_cache=OrderedDict()
_lock=RLock()


def memo(key,compute):
    with _lock:
        if key in _cache:
            _cache.move_to_end(key);return _cache[key][0]
        result=compute();size=len(json.dumps(result,default=str))
        if size<=32*1024*1024:
            _cache[key]=(result,size)
            while len(_cache)>32 or sum(v[1] for v in _cache.values())>32*1024*1024:_cache.popitem(last=False)
        return result


def joined(repo,run):
    source_id=run.get("manifest",{}).get("scan_run_id")
    try:source_stamp=repo.stamp(source_id) if source_id else None
    except (OSError,ValueError,TypeError):source_stamp=None
    def compute():
        try:source=repo.get(source_id) if source_stamp else None
        except (FileNotFoundError,ValueError,OSError,EOFError):source=None
        return enrich_trades(run,source)
    return memo(("join",repo.stamp(run["run_id"]),source_stamp),compute)


def aggregate(repo,run,symbol="",session=""):
    symbol=symbol.strip().upper()
    scope="whole run" if not symbol and not session else "Filtered cohort: "+", ".join(x for x in [symbol,session] if x)
    return memo(("analytics",VERSION,repo.stamp(run["run_id"]),symbol,session),
                lambda:analytics(run,filter_sort(run.get("trades",[]),symbol,session),scope))
