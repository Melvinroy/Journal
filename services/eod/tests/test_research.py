from dataclasses import replace
from datetime import date,timedelta
import pytest
from fastapi.testclient import TestClient
from brontide_eod.features import features
from brontide_eod.scan_engine import Definition,scan,fingerprint
from brontide_eod.backtest_engine import backtest
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.api import app


def fixture(count=300):
    # Synthetic authoritative sessions, deliberately not an exchange-calendar fixture.
    days=[str(date(2024,1,1)+timedelta(days=i)) for i in range(count)]
    bars=[dict(session_date=day,open=100+i*.1-.1,high=101+i*.1,low=99+i*.1,close=100+i*.1,volume=1_000_000) for i,day in enumerate(days)]
    return days,bars


def event_fixture():
    days,bars=fixture(100)
    ep=bars[69]["close"]*1.05
    bars[70].update(open=bars[69]["close"],close=ep,high=ep+.3,low=bars[69]["close"]-.5,volume=30_000_000)
    for row in bars[71:]: row.update(open=ep+.01,close=ep+.02,high=ep+.1,low=ep-.1,volume=100_000)
    return days,bars


def test_feature_formula_and_prefix_invariance():
    days,bars=fixture();full=features(bars,days)
    assert full[19]["sma20"]==pytest.approx(100.95)
    assert full[19]["adv20"] is None
    assert full[20]["adv20"]==1_000_000
    assert full[14]["atr14"]==pytest.approx(2)
    assert full[13]["atr14"] is None
    assert features(bars[:150],days[:150])==full[:150]
    assert full[-1]["distance_high252_percent"]==pytest.approx(100*(129.9/130.9-1))


def test_missing_session_does_not_become_zero_or_shorten_window():
    days,bars=fixture();del bars[100]
    rows=features(bars,days)
    assert rows[100]=={"session_date":days[100],"available":False}
    assert rows[110]["sma20"] is None and rows[110]["atr14"] is None
    assert rows[121]["sma20"] is not None and rows[115]["atr14"] is not None


def test_bad_bars_and_duplicate_sessions_rejected():
    days,bars=fixture(3)
    with pytest.raises(ValueError): features(bars+bars,days)
    with pytest.raises(ValueError): features(bars,days+days)
    bars[0]["volume"]=-1
    with pytest.raises(ValueError): features(bars,days)


def test_first_setup_per_event_and_rule_evidence():
    days,bars=event_fixture();definition=Definition("strict",3,.75,3)
    result=scan("TEST",features(bars,days),definition)
    assert len(result["signals"])==1
    signal=result["signals"][0]
    assert signal["setup_date"]==days[73] and signal["ep_date"]==days[70]
    assert all(c["status"]=="Pass" for c in signal["conditions"])
    assert signal["intended_entry_date"]==days[74]
    assert scan("TEST",features(bars[:80],days[:80]),definition)["signals"]==result["signals"]


def test_distribution_is_explicit_and_fingerprinted():
    definition=Definition("strict",3,.75,3)
    assert definition.manifest()["legacy_reproduction"] is False
    assert definition.manifest()["fingerprint"]!=replace(definition,distribution_drop_percent=4).manifest()["fingerprint"]
    assert definition.manifest()["fingerprint"]!=replace(definition,ep_average="prior").manifest()["fingerprint"]


def trade_fixture():
    days,bars=fixture(5)
    signal={"signal_id":"signal","event_id":"event","symbol":"TEST","ep_date":days[0],"setup_date":days[1],"trigger_date":days[1],"strategy_id":"strict","measurements":{"atr14":2}}
    definition=Definition("strict",3,.75,3,max_hold=3)
    return days,bars,signal,definition


def test_same_bar_stop_target_is_stop_first():
    days,bars,signal,definition=trade_fixture()
    bars[2].update(open=100,low=97,high=125,close=110)
    result=backtest([signal],{"TEST":bars},days,definition,0,0)
    trade=result["trades"][0]
    assert trade["outcome_r"]==-1 and trade["ambiguous"]
    assert trade["exit_reason"]=="Stop" and trade["setup_atr"]==2
    assert result["summary"]["closed_trade_drawdown_r"]==1


def test_gap_stop_and_missing_entry_are_not_optimistic():
    days,bars,signal,definition=trade_fixture()
    bars[2].update(open=100,high=101,low=99,close=100)
    bars[3].update(open=95,high=96,low=94,close=95)
    result=backtest([signal],{"TEST":bars},days,definition,0,0)
    assert result["trades"][0]["outcome_r"]==-2.5
    del bars[2]
    assert backtest([signal],{"TEST":bars},days,definition)["summary"]["not_entered"]==1


def test_incomplete_holds_not_counted_as_winners():
    days,bars,signal,definition=trade_fixture()
    result=backtest([signal],{"TEST":bars[:3]},days[:3],definition)
    assert result["summary"]["closed"]==0
    assert result["summary"]["expectancy_r"] is None
    assert result["trades"][0]["status"]=="Open"


def test_immutable_repository_and_read_only_api(tmp_path,monkeypatch):
    root=tmp_path/"research";store=FileResearchRepository(root)
    payload={"kind":"scan","manifest":{"end":"2026-09-03"},"summary":{},"sessions":[],"signals":[{"symbol":"TEST","setup_date":"2026-09-03"}]}
    key=store.publish(payload)
    assert key==store.publish(payload)==fingerprint(payload)
    assert len(list(root.glob("*.json.gz")))==1
    with pytest.raises(ValueError):store.get("../private")
    monkeypatch.setenv("BRONTIDE_DB_PATH",str(tmp_path/"market.duckdb"))
    client=TestClient(app)
    assert client.get("/v1/research/runs").json()["runs"][0]["run_id"]==key
    assert client.get(f"/v1/research/runs/{key}/rows?symbol=TEST").json()["total"]==1
    assert client.get(f"/v1/research/runs/{key}/rows?limit=501").status_code==422
    assert client.post("/v1/research/runs").status_code==405
    assert client.get(f"/v1/research/runs/{'0'*64}").status_code==404
    exported=client.get(f"/v1/research/runs/{key}/export")
    assert exported.json()["signals"]==payload["signals"]
    assert "attachment" in exported.headers["content-disposition"]


def test_reconstructed_episode_supersession_and_atr_distribution():
    from brontide_eod.scan_engine import definitions
    days,bars=event_fixture()
    definition=definitions(3)[0]
    assert definition.distribution_atr==.75 and definition.supersede_on_new_ep
    core=features(bars,days)
    core[72].update(return1=5,volume=40_000_000,inclusive_adv20=2_000_000,volume_previous_ratio=400)
    result=scan("TEST",core,definition)
    assert not any(s["ep_date"]==days[70] for s in result["signals"])
    core=features(bars,days)
    core[72].update(close=core[71]["close"]-core[71]["atr14"],volume=200_000)
    result=scan("TEST",core,definition)
    assert not result["signals"]
    assert days[72] in result["evaluations"][0]["distribution_sessions"]


def test_offline_job_reproducible_and_does_not_mutate_market_database(tmp_path):
    import duckdb
    from brontide_eod.store import DuckDBStore
    from brontide_eod.research_job import run_job
    days,bars=event_fixture()
    path=tmp_path/"market.duckdb"
    with DuckDBStore(path):pass
    with duckdb.connect(str(path)) as db:
        db.execute("INSERT INTO ingestion_configs(config_fingerprint,provider,feed,timeframe,adjustment,asof_value,symbol_validation_rules,universe_fingerprint,calendar_fingerprint,pipeline_version) VALUES ('cfg','alpaca','sip','1Day','all','-','test','universe','calendar','test')")
        db.execute("INSERT INTO universe_memberships(universe_fingerprint,symbol,ordinal) VALUES ('universe','TEST',0),('universe','EMPTY',1)")
        db.executemany("INSERT INTO market_calendar_sessions(calendar_fingerprint,session_date,open_time,close_time,ordinal) VALUES ('calendar',?,'09:30','16:00',?)",[(day,i) for i,day in enumerate(days)])
        db.executemany("INSERT INTO daily_bars(symbol,session_date,open,high,low,close,volume,source,timeframe,adjustment,quality_status,source_timestamp,schema_version) VALUES ('TEST',?,?,?,?,?,?,'alpaca_sip','1Day','all','ready','2024-01-01T20:00:00Z',1)",[(b['session_date'],b['open'],b['high'],b['low'],b['close'],b['volume']) for b in bars])
    before=path.read_bytes()
    args=(path,'cfg',days[60],days[-1],3,tmp_path/'research',True)
    first=run_job(*args);second=run_job(*args)
    assert first==second and len(first['run_ids'])==8
    assert path.read_bytes()==before
    store=FileResearchRepository(tmp_path/'research')
    for key in first['run_ids']:
        run=store.get(key)
        assert run['manifest']['missing_symbols']==1
        if run['kind']=='scan':
            assert len(run['sessions'])==40
            assert sum(s['candidates'] for s in run['sessions'])==len(run['signals'])
        else:
            assert run['summary']['signals']==len(run['trades'])


def test_feature_materialization_reuse_append_and_correction(tmp_path):
    from brontide_eod.feature_cache import FeatureCache
    days,bars=fixture()
    cache=FeatureCache(tmp_path/'features')
    initial=cache.compute('TEST',bars[:150],days[:150])
    assert cache.compute('TEST',bars[:150],days[:150])==initial
    assert cache.hits==1 and cache.misses==1
    updated=cache.compute('TEST',bars,days)
    assert updated==features(bars,days) and updated[:150]==initial
    revised=[dict(row) for row in bars];revised[100]['volume']*=2
    correction=cache.compute('TEST',revised,days)
    assert correction==features(revised,days)
    assert correction[110]['adv20']!=updated[110]['adv20']
    assert cache.misses==3
