from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import duckdb
import httpx
import pytest

from brontide_eod.config import Settings
from brontide_eod.models import DailyBar, Instrument, MarketSession
from brontide_eod.updater import (
    UpdateLockedError,
    _request_with_retries,
    acquire_update_lock,
    expected_completed_session,
    publish_snapshot,
    read_update_status,
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


def test_snapshot_replacement_rejects_wrong_publication(tmp_path):
    configured = settings(tmp_path)
    run_update(configured, FakeProvider(date(2026, 9, 11)), force=True,
               now=datetime(2026, 9, 11, 21, tzinfo=timezone.utc), sleep=lambda _: None)
    with pytest.raises(ValueError):
        publish_snapshot(configured.db_path, tmp_path / "bad.duckdb", "not-the-publication", sleep=lambda _: None)
