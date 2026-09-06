from copy import deepcopy
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from brontide_eod.api import app
from brontide_eod.scan_engine import definitions
from brontide_eod.research_engines import SYMBOLS, eligibility, normalize_trade
from brontide_eod.research_comparison import compare_results
from brontide_eod.research_comparison_jobs import ComparisonJobs, write_state, exclusive
from brontide_eod.research_repository import FileResearchRepository
import brontide_eod.research_comparison_jobs as jobs_module


def saved_run(repo):
    scan_id=repo.publish({"kind":"scan","signals":[]})
    payload={"kind":"backtest","manifest":{"strategy":next(d for d in definitions(3) if d.id=="EP-2x-rvol95").manifest(),
        "symbols":SYMBOLS,"universe_count":20,"start":"2025-11-12","end":"2025-12-11","source":"alpaca_sip","adjustment":"all","scan_run_id":scan_id},"trades":[]}
    return repo.get(repo.publish(payload))


def test_bounded_eligibility_and_legacy_identity(tmp_path):
    r=saved_run(FileResearchRepository(tmp_path))
    assert eligibility(r) is None
    for field,value in [("end","2026-09-03"),("symbols",["GMED"]),("universe_count",100),("source","other")]:
        changed=deepcopy(r);changed["manifest"][field]=value
        assert eligibility(changed)
    r["manifest"]["strategy"]["target_r"]=20
    assert "definition" in eligibility(r)


def test_known_gmed_discrepancies_and_unknowns():
    evidence=json.loads((Path(__file__).resolve().parents[3]/"docs/research-entry-window-evidence.json").read_text())
    a=evidence["ours"];n=evidence["lean"]
    b=normalize_trade(n,["2025-11-12","2025-11-13","2025-11-14"])
    signal={"symbol":"GMED","strategy_id":"EP-2x-rvol95","setup_date":"2025-11-12","ep_date":"2025-11-07"}
    current={"signals":[{**signal,"measurements":{"atr14":a["setup_atr"]}}],"trades":[a]}
    lean={"signals":[{**signal,"atr":n["atr"]}],"trades":[b]}
    report=compare_results(current,lean)
    assert report["signal_counts"]["matched"]==1 and report["unresolved_count"]==0
    assert {d["category"] for d in report["differences"]}=={"execution","costs","trade accounting"}
    assert report["analytics"]["lean"]["values"]["ambiguous_count"] is None
    lean["trades"][0]["entry_date"]="2025-11-14"
    assert compare_results(current,lean)["unresolved_count"]==1
    lean["signals"]=[]
    assert any(d["field"]=="signal" for d in compare_results(current,lean)["differences"])


@pytest.mark.parametrize("status",["Open","Unresolved","Not entered"])
def test_native_open_missing_fields_never_become_completed(status):
    n={"symbol":"X","setup_date":"2025-11-12","status":status,"entry_date":None if status=="Not entered" else "2025-11-13",
       "exit_date":None,"entry":100,"exit":0,"atr":2,"stop":98,"target":120,"fees":.1,"net_r":None,"reason":None}
    t=normalize_trade(n,["2025-11-12","2025-11-13"])
    assert t["exit"] is None and t["outcome_r"] is None and t["fees_per_share"] is None
    assert t["recorded_fees_per_share"]==.1
    if status=="Not entered": assert t["entry"] is None


def test_empty_metrics_do_not_claim_execution_parity():
    report=compare_results({"signals":[],"trades":[]},{"signals":[],"trades":[]})
    assert report["matched_trades"]==[]
    assert report["analytics"]["lean"]["values"]["expectancy_r"] is None


def test_persistent_job_states_reuse_and_source_changes(tmp_path,monkeypatch):
    repo=FileResearchRepository(tmp_path/"research");r=saved_run(repo)
    manager=ComparisonJobs(repo,tmp_path/"db")
    assert manager.status(r)["status"]=="Not run"
    runtime=tmp_path/"runtime"
    for path in (runtime/"dotnet/dotnet.exe",runtime/"Lean/Launcher/bin/Release/QuantConnect.Lean.Launcher.dll"):
        path.parent.mkdir(parents=True,exist_ok=True);path.touch()
    monkeypatch.setattr(jobs_module,"PILOT",runtime)
    calls=[]
    monkeypatch.setattr(jobs_module.subprocess,"Popen",lambda *a,**kw:calls.append(a) or object())
    class NoThread:
        def __init__(self,**kwargs): pass
        def start(self): pass
    monkeypatch.setattr(jobs_module.threading,"Thread",NoThread)
    first=manager.start(r)
    assert first["status"]=="Running" and len(calls)==1
    assert manager.start(r)["job_id"]==first["job_id"] and len(calls)==1
    state_path=manager.root/first["job_id"]/"state.json"
    write_state(state_path,{**first,"status":"Completed","report_id":"saved"})
    assert manager.start(r)["status"]=="Completed" and len(calls)==1
    monkeypatch.setattr(jobs_module,"implementation_identity",lambda:{"source_fingerprint":"changed"})
    assert manager.status(r)["status"]=="Not run"
    next_job=manager.start(r)
    assert next_job["job_id"]!=first["job_id"]
    restarted=ComparisonJobs(repo,tmp_path/"db")
    assert restarted.status(r)["status"]=="Failed"
    assert "restart" in restarted.status(r)["reason"]


def test_os_lock_prevents_overlapping_native_processes(tmp_path):
    with exclusive(tmp_path/"engine.lock"):
        with pytest.raises(OSError):
            with exclusive(tmp_path/"engine.lock"): pass
    with exclusive(tmp_path/"engine.lock"): pass


def test_comparison_api_read_only_get_local_post_and_exports(tmp_path,monkeypatch):
    monkeypatch.setenv("BRONTIDE_DB_PATH",str(tmp_path/"market.duckdb"))
    repo=FileResearchRepository(tmp_path/"research");r=saved_run(repo)
    before=(repo.root/f'{r["run_id"]}.json.gz').read_bytes()
    client=TestClient(app);path=f'/v1/research/runs/{r["run_id"]}/lean-comparison'
    assert client.get(path).json()["status"]=="Not run"
    assert list((repo.root/"comparison-jobs").glob("*/state.json"))==[]
    assert client.post(path).status_code==403
    assert client.post(path,headers={"X-Brontide-Local":"1","Origin":"https://untrusted.example"}).status_code==403
    import brontide_eod.research_api as api
    calls=[]
    monkeypatch.setattr(api.comparison_jobs(),"start",lambda run:calls.append(run["run_id"]) or {"status":"Running"})
    assert client.post(path,headers={"X-Brontide-Local":"1"}).status_code==202
    assert calls==[r["run_id"]]
    assert client.get(f'/v1/research/runs/{r["run_id"]}').json()["engine"]["id"]=="current"
    assert client.get(f'/v1/research/runs/{r["run_id"]}/export').json()==r
    assert (repo.root/f'{r["run_id"]}.json.gz').read_bytes()==before
    assert client.get(f'/v1/research/comparisons/{r["run_id"]}').status_code==404


def test_worker_failure_is_persisted_without_publishing_results(tmp_path,monkeypatch):
    repo=FileResearchRepository(tmp_path/"research");r=saved_run(repo)
    folder=repo.root/"comparison-jobs"/("a"*32);folder.mkdir(parents=True)
    state={"status":"Running","source_run_id":r["run_id"],"implementation":jobs_module.implementation_identity()}
    write_state(folder/"state.json",state)
    before=set(repo.root.glob("*.json.gz"))
    def changed(*args):raise ValueError("Saved input fingerprint changed")
    monkeypatch.setattr(jobs_module,"load_frozen",changed)
    jobs_module.work(repo.root,tmp_path/"db","a"*32)
    failure=json.loads((folder/"state.json").read_text())
    assert failure["status"]=="Failed" and "fingerprint" in failure["reason"]
    assert set(repo.root.glob("*.json.gz"))==before
