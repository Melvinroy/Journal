from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from brontide_eod.api import app
from brontide_eod.scanner import BIGGEST_ONE_MONTH_FORMULA_VERSION
from brontide_eod.store import DuckDBStore


def seeded_publication(path, formula_version=BIGGEST_ONE_MONTH_FORMULA_VERSION):
    publication_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    now = datetime(2026, 9, 12, tzinfo=timezone.utc)
    with DuckDBStore(path) as store:
        store.connection.execute(
            """INSERT INTO eod_update_runs
            (run_id,mode,started_at,completed_at,status,expected_session,candidate_sessions,retry_attempt,explanation)
            VALUES (?, 'forced', ?, ?, 'succeeded', ?, '[]', 0, NULL)""",
            [run_id, now, now, date(2026, 9, 11)],
        )
        manifest = json.dumps({"scanner_universe": {"source": "tc2000-export", "candidate_eligible": 3,
                              "rank_eligible": 3, "stale": False, "age_sessions": 0}})
        store.connection.execute(
            "INSERT INTO eod_publications VALUES (?, ?, ?, ?, ?, 'sip', ?, 'universe', 'calendar', ?, 3, 3, 100, 0, ?)",
            [publication_id, run_id, now, date(2026, 9, 11), date(2026, 9, 11), json.dumps({"all": 3, "raw": 3, "split": 3}), formula_version, manifest],
        )
        store.connection.execute(
            "INSERT INTO eod_update_state VALUES (1,'current',?,?,?,?,NULL,0,100,3,3,?,NULL,?)",
            [date(2026, 9, 11), date(2026, 9, 11), publication_id, now,
             json.dumps({"all": 3, "raw": 3, "split": 3}), now],
        )
        store.connection.executemany(
            """INSERT INTO scanner_measurements
            (publication_id,scanner_key,formula_version,symbol,session_date,dollar_volume,
             growth_percent,adr_percent,growth_rank,day_percent)
            VALUES (?, 'biggest-one-month', ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (publication_id, formula_version, "AAA", date(2026, 9, 11), 90_000_000, 20, 6, 100, 3.42),
                (publication_id, formula_version, "BBB", date(2026, 9, 11), 89_000_000, 30, 8, 99, -2.18),
                (publication_id, formula_version, "CCC", date(2026, 9, 11), 100_000_000, 10, 4, 98, None),
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
        assert body["comparison_universe"]["eligible"] == 3
        assert body["comparison_universe"]["ranked"] == 3
        assert body["comparison_universe"]["excluded"] == 0
        assert body["status"]["state"] == "current"
        assert body["status"]["recent_runs"][0]["status"] == "succeeded"
        assert body["definition"]["thresholds"]["min_dollar_volume"] == 89_000_000
        assert body["results"][0]["day_percent"] == 3.42


def test_scanner_api_rejects_non_finite_and_out_of_range_values(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        assert client.get("/v1/scanners/biggest-one-month?min_growth_rank=101").status_code == 422
        assert client.get("/v1/scanners/biggest-one-month?min_dollar_volume=NaN").status_code == 422


def test_scanner_api_marks_a_superseded_publication_stale(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database, formula_version="biggest-one-month-v1")
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        body = client.get("/v1/scanners/biggest-one-month").json()
        assert body["formula_version"] == "biggest-one-month-v1"
        assert body["status"]["state"] == "stale"
        assert "superseded formula" in body["status"]["explanation"]


def test_refresh_requires_local_request_header(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        response = client.post("/v1/eod/refresh")
        assert response.status_code == 403


def test_dead_update_lock_reports_failed_last_good_instead_of_updating(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    lock_path = database.with_suffix(database.suffix + ".update.lock")
    lock_path.write_text(json.dumps({
        "pid": 999999, "token": "dead", "created_at": "2026-09-11T12:00:00+00:00",
    }))
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        body = client.get("/v1/eod/status").json()
        assert body["state"] == "failed"
        assert "stopped unexpectedly" in body["explanation"]


def test_live_update_lock_reports_updating(tmp_path, monkeypatch):
    database = tmp_path / "published.duckdb"
    seeded_publication(database)
    lock_path = database.with_suffix(database.suffix + ".update.lock")
    lock_path.write_text(json.dumps({
        "pid": os.getpid(), "token": "live", "created_at": datetime.now(timezone.utc).isoformat(),
    }))
    monkeypatch.setenv("BRONTIDE_DB_PATH", str(database))
    monkeypatch.setenv("BRONTIDE_PUBLISHED_DB_PATH", str(database))
    with TestClient(app) as client:
        body = client.get("/v1/eod/status").json()
        assert body["state"] == "updating"
