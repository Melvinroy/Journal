from dataclasses import replace
from datetime import date, datetime, time, timezone

import duckdb
import pytest
from fastapi.testclient import TestClient

from brontide_eod.api import app
from brontide_eod.chart_repository import DuckDBChartRepository
from brontide_eod.models import DailyBar, Instrument, MarketSession
from brontide_eod.store import DuckDBStore


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / "fixture.duckdb"
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(path))
    with DuckDBStore(path) as store:
        for symbol, name in [("AAPL", "Apple Inc."), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"), ("SPY", "SPDR S&P 500"), ("EMPTY", "Empty")]:
            store.upsert_instruments([Instrument(symbol, name, "NASDAQ", "us_equity", "active", True, False, symbol)])
            if symbol == "EMPTY":
                continue
            bar = DailyBar(symbol, date(2026, 9, 3), 100, 103, 98, 102, 1000, None, None, datetime(2026, 9, 3, 20, tzinfo=timezone.utc))
            store.upsert_bars([bar, replace(bar, session_date=date(2026, 9, 2)), replace(bar, adjustment="raw", close=101),
                               replace(bar, source="other", close=103), replace(bar, timeframe="1Week"),
                               replace(bar, session_date=date(2026, 9, 4), quality_status="quarantined")])
        store.record_market_calendar(calendar_fingerprint="fixture-calendar", provider="alpaca", start=date(2026, 9, 1), end=date(2026, 9, 7), sessions=[
            MarketSession(date(2026, 9, 2), time(9, 30), time(16)),
            MarketSession(date(2026, 9, 3), time(9, 30), time(13)),  # Synthetic early close.
            MarketSession(date(2026, 9, 4), time(9, 30), time(16)),
        ])
    return path


@pytest.mark.parametrize("symbol", ["AAPL", "MSFT", "NVDA", "SPY"])
def test_chart_matches_database(database, symbol):
    response = TestClient(app).get(f"/v1/chart/{symbol}?limit=1").json()
    with duckdb.connect(str(database), read_only=True) as connection:
        expected = connection.execute("SELECT open, high, low, close, volume FROM daily_bars WHERE symbol=? AND session_date='2026-09-03' AND source='alpaca_sip' AND adjustment='all' AND timeframe='1Day'", [symbol]).fetchone()
    bar = response["bars"][0]
    assert tuple(bar[key] for key in ("open", "high", "low", "close", "volume")) == expected
    assert response["series"]["returned"] == 1
    assert response["instrument"]["symbol"] == symbol


def test_series_isolation_order_and_limits(database):
    client = TestClient(app)
    rows = client.get("/v1/bars/aapl").json()
    assert [row["session_date"] for row in rows] == ["2026-09-02", "2026-09-03"]
    assert all(row["source"] == "alpaca_sip" and row["adjustment"] == "all" for row in rows)
    assert client.get("/v1/bars/AAPL?adjustment=raw").json()[0]["close"] == 101
    assert client.get("/v1/bars/AAPL?source=other").json()[0]["close"] == 103
    for path in ["/v1/chart/AAPL?limit=5001", "/v1/bars/AAPL?limit=0", "/v1/chart/AAPL?adjustment=invalid", "/v1/chart/AAPL%27"]:
        assert client.get(path).status_code == 422


def test_search_metadata_empty_and_missing(database):
    client = TestClient(app)
    assert client.get("/health").json()["database"] == "read_only"
    assert client.get("/v1/instruments?q=apple").json()[0]["symbol"] == "AAPL"
    assert client.get("/v1/instruments?q=%25").json() == []
    assert client.get("/v1/instruments?q=%27%20OR%201=1").json() == []
    assert client.get("/v1/instruments/AAPL").json()["series"]
    assert client.get("/v1/chart/EMPTY").json()["bars"] == []
    assert client.get("/v1/chart/AAPL?adjustment=split").json()["bars"] == []
    assert client.get("/v1/chart/MISSING").status_code == 404
    assert client.get("/v1/bars/EMPTY").status_code == 404


def test_missing_database_never_created(tmp_path, monkeypatch):
    path = tmp_path / "missing" / "absent.duckdb"
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(path))
    client = TestClient(app)
    for route in ["/health", "/v1/chart/AAPL", "/v1/instruments", "/v1/instruments/AAPL"]:
        result = client.get(route)
        assert result.status_code == 503
        assert str(path) not in result.text
    assert not path.parent.exists()


def test_reads_do_not_mutate_database(database):
    before = database.read_bytes()
    client = TestClient(app)
    for route in ["/health", "/v1/chart/AAPL", "/v1/instruments"]:
        assert client.get(route).status_code == 200
    assert database.read_bytes() == before
    assert not database.with_suffix(".duckdb.wal").exists()


def test_freshness_early_close_delay_weekend_and_expired_calendar(database):
    repo = DuckDBChartRepository(database)
    try:
        before_close = repo.freshness(date(2026, 9, 2), datetime(2026, 9, 3, 17, 14, tzinfo=timezone.utc))
        assert before_close["freshness"] == "fresh"
        after_delay = repo.freshness(date(2026, 9, 2), datetime(2026, 9, 3, 17, 15, tzinfo=timezone.utc))
        assert after_delay["freshness"] == "stale"
        weekend = repo.freshness(date(2026, 9, 4), datetime(2026, 9, 6, 12, tzinfo=timezone.utc))
        assert weekend["freshness"] == "fresh"
        expired = repo.freshness(date(2026, 9, 4), datetime(2026, 9, 8, 12, tzinfo=timezone.utc))
        assert expired["freshness"] == "unknown" and not expired["calendar_covered"]
    finally:
        repo.close()


def test_host_and_cors_boundary(database):
    client = TestClient(app)
    assert client.get("/health", headers={"host": "attacker.example"}).status_code == 400
    response = client.get("/v1/chart/AAPL", headers={"origin": "https://melvinroy.github.io"})
    assert "access-control-allow-origin" not in response.headers
    assert client.get("/services/eod/.env").status_code == 404
    assert client.get("/data/brontide.duckdb").status_code == 404
