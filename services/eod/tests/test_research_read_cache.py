import gzip
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from brontide_eod.api import app
from brontide_eod.research_repository import FileResearchRepository


def fixture(repo,count=125):
    signals=[{"signal_id":str(i),"strategy_id":"S","symbol":"X","setup_date":"2025-01-02","measurements":{"rvol":i/100},"conditions":[{"condition":"C","observed":i}]} for i in range(count)]
    source=repo.publish({"kind":"scan","manifest":{},"signals":signals})
    trades=[{"signal_id":str(i),"trade_id":str(i),"strategy_id":"S","symbol":"X","setup_date":"2025-01-02","entry_date":"2025-01-03","exit_date":"2025-01-06","status":"Closed","outcome_r":i,"ambiguous":False} for i in range(count)]
    run=repo.publish({"kind":"backtest","manifest":{"scan_run_id":source,"start":"2025-01-02","end":"2025-01-06"},"trades":trades})
    return source,run


def test_index_lists_without_reading_objects_and_discovers_new_runs(tmp_path,monkeypatch):
    repo=FileResearchRepository(tmp_path)
    source,run=fixture(repo)
    def unexpected(*args):raise AssertionError("Indexed list must not decompress objects")
    with monkeypatch.context() as m:
        m.setattr(repo,"get",unexpected)
        assert repo.list("backtest")[0]["run_id"]==run
        assert repo.list("scan")[0]["run_id"]==source
    another=repo.publish({"kind":"backtest","manifest":{},"trades":[]})
    assert {r["run_id"] for r in repo.list("backtest")}=={run,another}


def test_index_rebuild_and_verified_object_cache_isolation(tmp_path):
    repo=FileResearchRepository(tmp_path);_,run=fixture(repo,2)
    record=repo.get(run);record["trades"][0]["outcome_r"]=999
    assert repo.get(run)["trades"][0]["outcome_r"]==0
    sidecar=tmp_path/".registry"/f"{run}.json"
    sidecar.write_text("broken")
    assert repo.list("backtest")[0]["analytics"]["values"]["closed"]==2
    sidecar.unlink();repo.initialize_index();assert sidecar.exists()
    path=tmp_path/f"{run}.json.gz"
    with gzip.open(path,"rt") as f:payload=json.load(f)
    payload["trades"][0]["outcome_r"]=7
    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
    with pytest.raises(ValueError,match="fingerprint"):repo.get(run)
    with pytest.raises(ValueError,match="fingerprint"):repo.list("backtest")
    path.unlink()
    with pytest.raises(FileNotFoundError):repo.get(run)
    assert repo.list("backtest")==[]


def test_projected_pages_lazy_detail_sort_and_aggregate(tmp_path,monkeypatch):
    monkeypatch.setenv("BRONTIDE_DB_PATH",str(tmp_path/"market.duckdb"))
    repo=FileResearchRepository(tmp_path/"research");source,run=fixture(repo)
    original=(repo.root/f"{run}.json.gz").read_bytes()
    client=TestClient(app)
    base=f"/v1/research/runs/{run}"
    response=client.get(base+"/rows?view=trades&compact=true&fields=outcome_r,setup.rvol&sort=setup.rvol&descending=true&offset=100&limit=25")
    data=response.json();assert response.status_code==200 and data["total"]==125
    assert data["rows"][0]["outcome_r"]==24 and data["rows"][-1]["outcome_r"]==0
    assert data["rows"][0]["measurements"]["rvol"]==.24
    assert all("conditions" not in r and "setup_evidence" not in r for r in data["rows"])
    detail=client.get(base+"/trades/24").json()["trade"]
    assert detail["conditions"][0]["observed"]==24
    assert "Recorded source scan"==detail["setup_evidence"]
    assert client.get(base+"/trades/unknown").status_code==404
    assert client.get(base+"/rows?view=trades&compact=true&fields=unknown").status_code==422
    assert client.get(base+"/analytics").json()["values"]["expectancy_r"]==62
    assert client.get(base+"/analytics?symbol=missing").json()["values"]["closed"]==0
    # Missing source invalidates a previously cached enriched view.
    (repo.root/f"{source}.json.gz").unlink()
    missing=client.get(base+"/trades/24").json()["trade"]
    assert missing["measurements"]=={} and "unavailable" in missing["setup_evidence"]
    assert (repo.root/f"{run}.json.gz").read_bytes()==original
    assert client.get(base+"/export").json()==repo.get(run)
