from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from brontide_eod.api import app
from brontide_eod.store import DuckDBStore


def seeded_publication(path):
    publication_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    now = datetime(2026, 9, 12, tzinfo=timezone.utc)
    with DuckDBStore(path) as store:
        store.connection.execute(
            "INSERT INTO eod_update_runs VALUES (?, 'forced', ?, ?, 'succeeded', ?, '[]', 0, NULL)",
            [run_id, now, now, date(2026, 9, 11)],
        )
        store.connection.execute(
            "INSERT INTO eod_publications VALUES (?, ?, ?, ?, ?, 'sip', ?, 'universe', 'calendar', 'biggest-one-month-v1', 3, 3, 100, 0, '{}')",
            [publication_id, run_id, now, date(2026, 9, 11), date(2026, 9, 11), json.dumps({"all": 3, "raw": 3, "split": 3})],
        )
        store.connection.execute(
            "INSERT INTO eod_update_state VALUES (1,'current',?,?,?,?,NULL,0,100,3,3,?,NULL,?)",
            [date(2026, 9, 11), date(2026, 9, 11), publication_id, now,
             json.dumps({"all": 3, "raw": 3, "split": 3}), now],
        )
        store.connection.executemany(
            "INSERT INTO scanner_measurements VALUES (?, 'biggest-one-month', 'biggest-one-month-v1', ?, ?, ?, ?, ?, ?)",
            [
                (publication_id, "AAA", date(2026, 9, 11), 10_000_000, 20, 6, 100),
                (publication_id, "BBB", date(2026, 9, 11), 9_000_000, 30, 8, 99),
                (publication_id, "CCC", date(2026, 9, 11), 20_000_000, 10, 4, 98),
            ],
        )


def test_scanner_api_filters_strictly_and_returns_shared_contract(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        response = client.get("/v1/scanners/biggest-one-month")
        assert response.status_code == 200
        body = response.json()
        assert [row["symbol"] for row in body["results"]] == ["AAA"]
        assert body["data_date"] == "2026-09-11"
        assert body["comparison_universe"] == {"eligible": 3, "ranked": 3, "excluded": 0}
        assert body["status"]["state"] == "current"
        assert body["definition"]["thresholds"]["min_dollar_volume"] == 9_000_000


def test_scanner_api_rejects_non_finite_and_out_of_range_values(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        assert client.get("/v1/scanners/biggest-one-month?min_growth_rank=101").status_code == 422
        assert client.get("/v1/scanners/biggest-one-month?min_dollar_volume=NaN").status_code == 422


def test_refresh_requires_local_request_header(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        response = client.post("/v1/eod/refresh")
        assert response.status_code == 403
