from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from dataclasses import replace
import json
import subprocess
import sys

import duckdb
import httpx
import pytest
import brontide_eod.updater as updater_module

from brontide_eod.config import Settings
from brontide_eod.models import DailyBar, Instrument, MarketSession
from brontide_eod.tc2000 import TC2000_SCANNER_DEFINITION, TC2000_SOURCE_CATEGORIES
from brontide_eod.updater import (
    UpdateLockedError,
    CoverageValidationError,
    _record_failure,
    _target_coverage,
    _request_with_retries,
    acquire_update_lock,
    expected_completed_session,
    inspect_update_lock,
    publish_snapshot,
    read_update_history,
    read_update_status,
    run_scheduled_update,
    run_update,
)


def weekday_sessions(end: date, count: int = 22) -> list[MarketSession]:
    days = []
    cursor = end
    while len(days) < count:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor -= timedelta(days=1)
    return [MarketSession(day, time(9, 30), time(16)) for day in reversed(days)]


class FakeProvider:
    def __init__(self, end: date, *, fail_adjustment: str | None = None):
        self.sessions = weekday_sessions(end)
        self.fail_adjustment = fail_adjustment
        self.calls: list[tuple[str, date, date]] = []

    def get_market_calendar(self, start, end):
        return self.sessions

    def list_instruments(self, *, status="active"):
        return [
            Instrument("AAA", "Alpha", "NASDAQ", "us_equity", "active", True, True, "1"),
            Instrument("ETF", "Fund", "ARCA", "us_equity", "active", False, False, "2"),
        ]

    def get_daily_bars(self, symbols, start, end, *, adjustment="all"):
        self.calls.append((adjustment, start, end))
        if adjustment == self.fail_adjustment:
            raise httpx.TimeoutException("secret provider detail")
        rows = []
        selected = [item.session_date for item in self.sessions if start <= item.session_date <= end]
        for symbol_index, symbol in enumerate(symbols):
            for index, day in enumerate(selected):
                close = 10 + symbol_index + index
                rows.append(DailyBar(symbol, day, close, close * 1.06, close, close, 1_000_000,
                                     10, close, datetime.combine(day, time(), timezone.utc), adjustment=adjustment))
        return rows


def settings(tmp_path):
    return Settings("key", "secret", tmp_path / "canonical.duckdb", published_db_path=tmp_path / "published.duckdb",
                    alpaca_batch_size=200, eod_minimum_coverage_percent=99)


def test_normal_early_close_holiday_and_dst_due_logic():
    friday = MarketSession(date(2026, 7, 3), time(9, 30), time(13))
    monday = MarketSession(date(2026, 7, 6), time(9, 30), time(16))
    assert expected_completed_session([friday, monday], datetime(2026, 7, 3, 17, 29, tzinfo=timezone.utc)) is None
    assert expected_completed_session([friday, monday], datetime(2026, 7, 3, 17, 30, tzinfo=timezone.utc)) == friday.session_date
    assert expected_completed_session([friday, monday], datetime(2026, 7, 5, 20, tzinfo=timezone.utc)) == friday.session_date
    winter = MarketSession(date(2026, 12, 1), time(9, 30), time(16))
    assert expected_completed_session([winter], datetime(2026, 12, 1, 21, 29, tzinfo=timezone.utc)) is None
    assert expected_completed_session([winter], datetime(2026, 12, 1, 21, 30, tzinfo=timezone.utc)) == winter.session_date


def test_lock_contention_and_dead_stale_recovery(tmp_path):
    path = tmp_path / "update.lock"
    first = acquire_update_lock(path)
    with pytest.raises(UpdateLockedError):
        acquire_update_lock(path)
    first.release()
    path.write_text('{"pid":999999,"token":"old","created_at":"2026-01-01T00:00:00+00:00"}')
    recovered = acquire_update_lock(path, now=datetime(2026, 1, 2, tzinfo=timezone.utc))
    recovered.release()


def test_dead_young_lock_is_not_reported_as_an_active_update(tmp_path, monkeypatch):
    path = tmp_path / "update.lock"
    path.write_text('{"pid":999999,"token":"old","created_at":"2026-09-11T12:00:00+00:00"}')
    status = inspect_update_lock(path, now=datetime(2026, 9, 11, 13, tzinfo=timezone.utc))
    assert status["present"] is True
    assert status["owner_alive"] is False
    assert status["recoverable"] is False
    assert status["recoverable_at"] == datetime(2026, 9, 11, 18, tzinfo=timezone.utc)


def test_process_probe_does_not_signal_live_owner():
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        assert updater_module._pid_alive(child.pid) is True
        assert child.poll() is None
        child.terminate()
        child.wait(timeout=10)
        assert updater_module._pid_alive(child.pid) is False
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=10)


def test_transport_retries_timeout_and_rate_limit_without_leaking_body():
    calls = 0
    sleeps = []
    request = httpx.Request("GET", "https://data.alpaca.markets")
    def operation():
        nonlocal calls
        calls += 1
        if calls == 1:
            response = httpx.Response(429, request=request, headers={"retry-after": "1"}, text="credential-like body")
            raise httpx.HTTPStatusError("body", request=request, response=response)
        return []
    assert _request_with_retries(operation, sleep=sleeps.append) == []
    assert calls == 2 and sleeps == [1.0]


def test_target_coverage_separates_no_trade_adjustment_loss_and_continuity():
    eligible = [f"S{index}" for index in range(10)]
    symmetric = {key: set(eligible[:9]) for key in ("all", "raw", "split")}
    complete, absent, diagnostics = _target_coverage(eligible, symmetric)
    assert complete == set(eligible[:9]) and absent == ["S9"]
    assert diagnostics["adjustment_coverage_percent"] == 100
    assert diagnostics["session_continuity_percent"] == 90

    asymmetric = {**symmetric, "split": set(eligible[:8])}
    _, _, diagnostics = _target_coverage(eligible, asymmetric)
    assert diagnostics["adjustment_coverage_percent"] < 99
    assert diagnostics["session_continuity_percent"] == 90

    catastrophic = {key: set(eligible[:2]) for key in ("all", "raw", "split")}
    _, _, diagnostics = _target_coverage(eligible, catastrophic)
    assert diagnostics["adjustment_coverage_percent"] == 100
    assert diagnostics["session_continuity_percent"] == 20


def test_failure_persists_sanitized_coverage_diagnostics_and_history(tmp_path):
    configured = settings(tmp_path)
    diagnostics = {"observed_symbols": 95, "complete_symbols": 94,
                   "adjustment_coverage_percent": 98.947368,
                   "session_continuity_percent": 95.0,
                   "adjustments": {"all": 95, "raw": 95, "split": 94}}
    _record_failure(configured, str(__import__("uuid").uuid4()), date(2026, 9, 14), "due",
                    CoverageValidationError("coverage failed", diagnostics))
    status = read_update_status(configured.db_path)
    assert status["coverage"]["expected_symbols"] == 95
    assert status["coverage"]["loaded_symbols"] == 94
    history = read_update_history(configured.db_path)
    assert history[0]["diagnostics"]["session_continuity_percent"] == 95
    assert history[0]["explanation"] == "coverage failed"


def test_scheduled_update_uses_only_bounded_persisted_retries(tmp_path, monkeypatch):
    configured = settings(tmp_path)
    base = datetime(2026, 9, 15, tzinfo=timezone.utc)
    calls = []
    sleeps = []
    events = []

    def fake_update(*_args, **_kwargs):
        calls.append(True)
        if len(calls) < 3:
            raise ValueError("temporary")
        return {"status": "published", "publication_id": "publication"}

    retry_times = iter((base + timedelta(minutes=15), base + timedelta(minutes=30)))
    monkeypatch.setattr(updater_module, "run_update", fake_update)
    monkeypatch.setattr(updater_module, "read_update_status",
                        lambda _path: {"state": "failed", "retry_at": next(retry_times),
                                       "explanation": "Temporary provider failure."})
    result = run_scheduled_update(configured, FakeProvider(date(2026, 9, 14)),
                                  sleep=sleeps.append, clock=lambda: base, emit=events.append)
    assert result["status"] == "published" and len(calls) == 3
    assert sleeps == [900, 1800]
    assert [event["event"] for event in events].count("scheduled-retry") == 2


def test_atomic_update_snapshot_idempotence_overlap_and_cache_recompute(tmp_path):
    target = date(2026, 9, 11)
    provider = FakeProvider(target)
    configured = settings(tmp_path)
    now = datetime(2026, 9, 11, 21, tzinfo=timezone.utc)
    first = run_update(configured, provider, force=True, now=now, sleep=lambda _: None)
    assert first["status"] == "published" and first["measurements"] == 2
    assert configured.serving_db_path.is_file()
    status = read_update_status(configured.serving_db_path)
    assert status["state"] == "current" and status["published_session"] == target
    provider.calls.clear()
    second = run_update(configured, provider, force=True, now=now + timedelta(minutes=1), sleep=lambda _: None)
    assert second["status"] == "published"
    assert all((end - start).days <= 7 for _, start, end in provider.calls)
    connection = duckdb.connect(str(configured.serving_db_path), read_only=True)
    try:
        assert connection.execute("SELECT count(*) FROM scanner_measurements WHERE publication_id=?", [second["publication_id"]]).fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 22 * 2 * 3
    finally:
        connection.close()


def test_partial_failure_rolls_back_and_preserves_published_snapshot(tmp_path):
    target = date(2026, 9, 11)
    configured = settings(tmp_path)
    now = datetime(2026, 9, 11, 21, tzinfo=timezone.utc)
    good = run_update(configured, FakeProvider(target), force=True, now=now, sleep=lambda _: None)
    before = configured.serving_db_path.read_bytes()
    with pytest.raises(httpx.TimeoutException):
        run_update(configured, FakeProvider(target, fail_adjustment="split"), force=True,
                   now=now + timedelta(minutes=1), sleep=lambda _: None)
    assert configured.serving_db_path.read_bytes() == before
    assert read_update_status(configured.db_path)["state"] == "failed"
    assert read_update_status(configured.serving_db_path)["publication_id"] == good["publication_id"]


def test_update_records_separate_tc2000_candidate_and_rank_universes(tmp_path):
    target = date(2026, 9, 11)
    export = tmp_path / "tc2000.json"
    export.write_text(json.dumps({
        "schema_version": 1, "evaluation_session": target.isoformat(),
        "captured_at": "2026-09-12T00:00:00Z", "tc2000_version": "25",
        "scanner_definition": TC2000_SCANNER_DEFINITION,
        "candidate_universe": {"symbols": ["ETF"], "source_categories": list(TC2000_SOURCE_CATEGORIES)},
        "rank_universe": {"symbols": ["AAA", "ETF"]},
        "result_list": {"symbols": ["ETF"]},
    }), encoding="utf-8")
    configured = replace(settings(tmp_path), tc2000_universe_path=export)
    result = run_update(configured, FakeProvider(target), force=True,
                        now=datetime(2026, 9, 11, 21, tzinfo=timezone.utc), sleep=lambda _: None)
    connection = duckdb.connect(str(configured.serving_db_path), read_only=True)
    try:
        manifest = json.loads(connection.execute(
            "SELECT manifest_json FROM eod_publications WHERE publication_id=?", [result["publication_id"]]
        ).fetchone()[0])
        assert manifest["scanner_universe"]["source"] == "tc2000-export"
        assert manifest["scanner_universe"]["candidate_eligible"] == 1
        assert manifest["scanner_universe"]["rank_eligible"] == 2
        assert connection.execute(
            "SELECT symbol FROM scanner_measurements WHERE publication_id=?", [result["publication_id"]]
        ).fetchall() == [("ETF",)]
    finally:
        connection.close()


def test_snapshot_replacement_rejects_wrong_publication(tmp_path):
    configured = settings(tmp_path)
    run_update(configured, FakeProvider(date(2026, 9, 11)), force=True,
               now=datetime(2026, 9, 11, 21, tzinfo=timezone.utc), sleep=lambda _: None)
    with pytest.raises(ValueError):
        publish_snapshot(configured.db_path, tmp_path / "bad.duckdb", "not-the-publication", sleep=lambda _: None)
