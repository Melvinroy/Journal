from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from brontide_eod.api import app
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.research_analytics import analytics, enrich_trades, filter_sort, CATALOG
from brontide_eod.scan_engine import definitions, scan
from brontide_eod.features import features
from test_research import event_fixture, fixture
from brontide_eod.backtest_engine import backtest


def ledger(values):
    return [{"symbol":"TEST","trade_id":str(i).zfill(4),"signal_id":str(i),"strategy_id":"S","status":"Closed","entry_date":"2026-08-05","setup_date":"2026-08-04","exit_date":"2026-08-06","outcome_r":v,"hold_sessions":2} for i,v in enumerate(values)]


def test_hand_calculated_statistics_and_same_day_order():
    r={"trades":ledger([2,-1,0,4,-2,-1]),"manifest":{"missing_symbols":3}}
    a=analytics(r);v=a["values"]
    assert v["expectancy_r"]==pytest.approx(1/3)
    assert v["median_r"]==-.5
    assert v["profit_factor_r"]==1.5 and v["payoff_ratio"]==2.25
    assert v["closed_trade_drawdown_r"]==3
    assert v["winning_streak"]==1 and v["losing_streak"]==2
    assert v["breakeven"]==1 and v["win_rate"]==pytest.approx(2/6)
    assert v["top_five_winners_r"]==6 and sum(x["count"] for x in a["distribution"])==6
    assert analytics({**r,"trades":list(reversed(r["trades"]))})==a


def test_empty_no_losses_missing_and_portfolio_are_not_zero():
    empty=analytics({"trades":[]});assert empty["values"]["closed"]==0
    assert empty["values"]["expectancy_r"] is None and empty["values"]["closed_trade_drawdown_r"] is None
    a=analytics({"trades":ledger([1,2,None])});assert a["values"]["invalid_closed"]==1
    assert a["values"]["profit_factor_r"] is None and "denominator" in a["unavailable"]["profit_factor_r"]
    assert a["values"]["average_mfe_r"] is None and a["values"]["cagr"] is None
    assert "equity" in a["unavailable"]["cagr"]


def test_source_join_is_exact_and_missing_evidence_stays_missing():
    r={"trades":ledger([1])};source={"signals":[{**r["trades"][0],"measurements":{"rvol":.5}}]}
    assert enrich_trades(r,source)[0]["measurements"]["rvol"]==.5
    source["signals"][0]["symbol"]="WRONG"
    assert enrich_trades(r,source)[0]["measurements"]=={}
    assert "unavailable" in enrich_trades(r,None)[0]["setup_evidence"]


def test_api_whole_cohort_sort_before_page_and_immutable(tmp_path,monkeypatch):
    monkeypatch.setenv("BRONTIDE_DB_PATH",str(tmp_path/"market.duckdb"))
    repo=FileResearchRepository(tmp_path/"research")
    trades=ledger(list(range(125)))
    for i,t in enumerate(trades):t["symbol"]="AA" if i%2 else "BB"
    scan_id=repo.publish({"kind":"scan","signals":[{**t,"measurements":{"rvol":i/100}} for i,t in enumerate(trades)]})
    payload={"kind":"backtest","manifest":{"scan_run_id":scan_id},"trades":trades}
    run_id=repo.publish(payload);before=(tmp_path/"research"/(run_id+".json.gz")).read_bytes()
    client=TestClient(app)
    assert client.get('/v1/research/metrics').json()==CATALOG
    r=client.get(f'/v1/research/runs/{run_id}/rows?view=trades&enriched=true&sort=setup.rvol&descending=true&offset=100&limit=10').json()
    assert r['rows'][0]['outcome_r']==24 and r['total']==125
    a=client.get(f'/v1/research/runs/{run_id}/analytics?symbol=AA').json()
    assert a['values']['closed']==62 and a['values']['expectancy_r']==62
    assert a['scope']=='Filtered cohort: AA'
    assert client.get(f'/v1/research/runs/{run_id}/rows?sort=__dict__').status_code==422
    assert client.get(f'/v1/research/runs/{run_id}/export').json()['trades']==trades
    assert before==(tmp_path/"research"/(run_id+".json.gz")).read_bytes()


def test_null_sort_stays_last_in_both_directions():
    r=ledger([None,1,2]);assert filter_sort(r,sort="outcome_r",descending=True)[-1]['outcome_r'] is None
    assert filter_sort(r,sort="outcome_r")[0]['outcome_r']==1


@pytest.mark.parametrize('definition',definitions(3))
def test_future_perturbation_all_variants(definition):
    days,bars=event_fixture();future=deepcopy(bars)
    for b in future[80:]:b.update(open=500,high=600,low=400,close=550,volume=900000000)
    a=features(bars,days);b=features(future,days)
    assert a[:80]==b[:80]
    earlier=lambda r:[{k:v for k,v in s.items() if k!='intended_entry_date'} for s in r['signals'] if s['setup_date']<days[80]]
    assert earlier(scan('TEST',a,definition))==earlier(scan('TEST',b,definition))==earlier(scan('TEST',features(bars[:80],days[:80]),definition))


def test_sixty_session_exit_and_window_cutoff():
    days,bars=fixture(70)
    for b in bars:b.update(open=100,high=101,low=99,close=100)
    s={'signal_id':'x','event_id':'e','symbol':'TEST','ep_date':days[0],'setup_date':days[1],'trigger_date':days[1],'strategy_id':'S','measurements':{'atr14':2}}
    d=definitions(3)[0]
    short=backtest([s],{'TEST':bars[:30]},days[:30],d)['trades'][0]
    assert short['status']=='Open' and short['outcome_r'] is None
    full=backtest([s],{'TEST':bars},days,d)['trades'][0]
    assert full['exit_date']==days[61] and full['hold_sessions']==60 and full['exit_reason']=='Maximum hold'
def test_metric_catalog_contract():
    from brontide_eod.research_analytics import CATALOG, analytics
    metrics=CATALOG['metrics']
    assert len({m['id'] for m in metrics})==len(metrics)
    for m in metrics:
        assert all(m.get(k) for k in ('id','label','scope','unit','definition','inputs','availability'))
        assert m['scope'] in ('run','trade')
        if m['availability']=='requires_portfolio':
            assert analytics({'trades':[]})['values'][m['id']] is None
            assert analytics({'trades':[]})['unavailable'][m['id']]
