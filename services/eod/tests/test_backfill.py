from __future__ import annotations

from datetime import date, datetime, time, timezone
from pathlib import Path

import httpx
import pytest

from brontide_eod.ingest import (
    PIPELINE_VERSION,
    RequestRateLimiter,
    backfill_sessions,
    calendar_fingerprint,
    ingestion_config_fingerprint,
    is_market_session,
    market_sessions,
    preflight_historical_universe,
    refresh_historical_universe_details,
    refresh_historical_universe,
    refresh_universe,
    universe_fingerprint,
)
from brontide_eod.models import DailyBar, Instrument, MarketSession
from brontide_eod.store import DuckDBStore


def instrument(symbol: str = "AAPL") -> Instrument:
    return Instrument(
        symbol=symbol,
        name=symbol,
        exchange="NASDAQ",
        asset_class="us_equity",
        status="active",
        tradable=True,
        fractionable=True,
        provider_id=symbol,
    )


def bar(symbol: str = "AAPL", session: date = date(2026, 9, 3)) -> DailyBar:
    return DailyBar(
        symbol=symbol,
        session_date=session,
        open=100,
        high=101,
        low=99,
        close=100.5,
        volume=10_000,
        trade_count=100,
        vwap=100.2,
        source_timestamp=datetime(session.year, session.month, session.day, tzinfo=timezone.utc),
    )


def calendar_session(day: date, *, close_time: time = time(16, 0)) -> MarketSession:
    return MarketSession(
        session_date=day,
        open_time=time(9, 30),
        close_time=close_time,
        session_open="0400",
        session_close="1700" if close_time == time(13, 0) else "2000",
        settlement_date=day,
    )


def corrected_calendar() -> list[MarketSession]:
    return [
        calendar_session(date(2025, 1, 8)),
        calendar_session(date(2025, 1, 10)),
    ]


class FakeProvider:
    def __init__(
        self,
        *,
        fail_once: bool = False,
        out_of_range: bool = False,
        market_dates: set[date] | None = None,
    ) -> None:
        self.fail_once = fail_once
        self.out_of_range = out_of_range
        self.market_dates = market_dates
        self.calls = 0
        self.ranges: list[tuple[date, date]] = []

    def list_instruments(self, *, status: str = "active") -> list[Instrument]:
        return [instrument()]

    def get_market_calendar(self, start: date, end: date) -> list[MarketSession]:
        return [calendar_session(day) for day in market_sessions(start, end)]

    def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
        self.calls += 1
        self.ranges.append((start, end))
        if self.fail_once and self.calls == 1:
            request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
            response = httpx.Response(429, request=request)
            raise httpx.HTTPStatusError("rate limited", request=request, response=response)
        if self.out_of_range:
            return [bar(symbols[0], date(2026, 9, 8))]
        rows = []
        session = start
        while session <= end:
            if session in self.market_dates if self.market_dates is not None else is_market_session(session):
                rows.extend(bar(symbol, session) for symbol in symbols)
            session = date.fromordinal(session.toordinal() + 1)
        return rows

    def health(self) -> dict[str, str | bool]:
        return {"ok": True}


def test_market_sessions_skip_weekends_and_us_holidays() -> None:
    assert is_market_session(date(2026, 9, 3))
    assert not is_market_session(date(2026, 9, 5))
    assert not is_market_session(date(2026, 1, 1))
    assert not is_market_session(date(2026, 4, 3))


def test_authoritative_calendar_excludes_january_9_2025() -> None:
    calendar = corrected_calendar()

    assert is_market_session(date(2025, 1, 8), calendar)
    assert not is_market_session(date(2025, 1, 9), calendar)
    assert is_market_session(date(2025, 1, 10), calendar)
    assert list(market_sessions(date(2025, 1, 8), date(2025, 1, 10), calendar)) == [
        date(2025, 1, 8),
        date(2025, 1, 10),
    ]


def test_authoritative_calendar_skips_standard_holidays() -> None:
    calendar = [calendar_session(date(2026, 1, 2))]

    assert list(market_sessions(date(2026, 1, 1), date(2026, 1, 2), calendar)) == [date(2026, 1, 2)]


def test_calendar_fingerprint_includes_early_close_times() -> None:
    regular = [calendar_session(date(2025, 7, 3))]
    early = [calendar_session(date(2025, 7, 3), close_time=time(13, 0))]

    assert calendar_fingerprint(regular) != calendar_fingerprint(early)


def test_backfill_retries_rate_limits_and_records_completion(tmp_path: Path) -> None:
    provider = FakeProvider(fail_once=True)
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument()])
        result = backfill_sessions(
            provider,
            store,
            date(2026, 9, 3),
            date(2026, 9, 3),
            max_retries=1,
            sleep=lambda _: None,
        )
        assert result["completed"] == 1
        assert result["bars"] == 1
        assert provider.calls == 2
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 1
        assert store.connection.execute("SELECT status FROM data_ingest_runs").fetchone()[0] == "completed"


def test_backfill_skips_previously_completed_sessions(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument()])
        first = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        second = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        assert first["completed"] == 1
        assert second["completed"] == 0
        assert second["skipped_completed"] == 1
        assert provider.calls == 1


def test_same_session_with_expanded_universe_is_reprocessed(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL")])
        first = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        store.upsert_instruments([instrument("MSFT")])
        second = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)

        assert first["completed"] == 1
        assert second["completed"] == 1
        assert second["skipped_completed"] == 0
        assert provider.calls == 2
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 2


def test_feed_adjustment_asof_or_schema_changes_invalidate_checkpoint() -> None:
    fingerprint = universe_fingerprint(["AAPL"])
    base = ingestion_config_fingerprint(universe_fingerprint=fingerprint)

    assert ingestion_config_fingerprint(universe_fingerprint=fingerprint, feed="iex") != base
    assert ingestion_config_fingerprint(universe_fingerprint=fingerprint, adjustment="raw") != base
    assert ingestion_config_fingerprint(universe_fingerprint=fingerprint, asof="2026-09-03") != base
    assert ingestion_config_fingerprint(
        universe_fingerprint=fingerprint,
        pipeline_version=f"{PIPELINE_VERSION}_next",
    ) != base
    assert ingestion_config_fingerprint(
        universe_fingerprint=fingerprint,
        calendar_fingerprint=calendar_fingerprint(corrected_calendar()),
    ) != base


def test_same_session_with_corrected_calendar_is_reprocessed(tmp_path: Path) -> None:
    old_calendar = [calendar_session(date(2025, 1, 9))]
    new_calendar = corrected_calendar()

    class SwitchingCalendarProvider(FakeProvider):
        def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
            self.market_dates = (
                {date(2025, 1, 9)}
                if self.calls == 0
                else {session.session_date for session in new_calendar}
            )
            return super().get_daily_bars(symbols, start, end)

    provider = SwitchingCalendarProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL")])
        first = backfill_sessions(
            provider,
            store,
            date(2025, 1, 9),
            date(2025, 1, 9),
            calendar=old_calendar,
            sleep=lambda _: None,
        )
        second = backfill_sessions(
            provider,
            store,
            date(2025, 1, 8),
            date(2025, 1, 10),
            calendar=new_calendar,
            sleep=lambda _: None,
        )

        assert first["completed"] == 1
        assert second["completed"] == 2
        assert second["skipped_non_market"] == 1
        assert provider.calls == 2
        assert store.connection.execute(
            "SELECT status FROM data_ingest_runs WHERE session_date = DATE '2025-01-09' ORDER BY completed_at DESC LIMIT 1"
        ).fetchone() == ("skipped",)


def test_corrected_calendar_can_adopt_valid_existing_bars_without_redownload(tmp_path: Path) -> None:
    old_calendar = [calendar_session(date(2025, 1, 8)), calendar_session(date(2025, 1, 9))]
    new_calendar = [calendar_session(date(2025, 1, 8))]
    provider = FakeProvider(market_dates={session.session_date for session in old_calendar})
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL")])
        first = backfill_sessions(
            provider,
            store,
            date(2025, 1, 8),
            date(2025, 1, 9),
            calendar=old_calendar,
            sleep=lambda _: None,
        )
        provider.calls = 0
        second = backfill_sessions(
            provider,
            store,
            date(2025, 1, 8),
            date(2025, 1, 9),
            calendar=new_calendar,
            sleep=lambda _: None,
        )

        assert first["completed"] == 2
        assert second["completed"] == 1
        assert second["bars"] == 0
        assert provider.calls == 0
        assert store.connection.execute(
            """
            SELECT status, detail FROM data_ingest_runs
            WHERE session_date = DATE '2025-01-09'
            ORDER BY completed_at DESC LIMIT 1
            """
        ).fetchone() == ("skipped", "non-market day")


def test_older_checkpoint_history_remains_available(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.connection.execute(
            """
            INSERT INTO data_ingest_runs (run_id, provider, session_date, completed_at, status, detail)
            VALUES ('00000000-0000-0000-0000-000000000001', 'alpaca_sip', '2026-09-03',
              current_timestamp, 'completed', 'legacy active-only checkpoint')
            """
        )
        store.upsert_instruments([instrument("AAPL")])
        result = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)

        assert result["completed"] == 1
        rows = store.connection.execute(
            "SELECT detail, config_fingerprint FROM data_ingest_runs ORDER BY started_at, run_id"
        ).fetchall()
        assert rows[0] == ("legacy active-only checkpoint", None)
        assert rows[-1][1] is not None


def test_rerun_with_identical_configuration_downloads_zero_bars(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL"), instrument("MSFT")])
        first = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        second = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)

        assert first["bars"] == 2
        assert second["bars"] == 0
        assert provider.calls == 1


def test_legacy_september_3_checkpoint_is_not_skipped_for_historical_universe(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.connection.execute(
            """
            INSERT INTO data_ingest_runs (run_id, provider, session_date, completed_at, status, instrument_count)
            VALUES ('00000000-0000-0000-0000-000000000002', 'alpaca_sip', '2026-09-03',
              current_timestamp, 'completed', 13393)
            """
        )
        store.upsert_instruments([instrument("AAPL"), instrument("MSFT")])
        result = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)

        assert result["completed"] == 1
        assert result["skipped_completed"] == 0
        assert provider.calls == 1


def test_full_historical_range_has_671_authoritative_market_sessions() -> None:
    removed = {date(2025, 1, 9)}
    calendar = [
        calendar_session(day)
        for day in market_sessions(date(2024, 1, 1), date(2026, 9, 3))
        if day not in removed
    ]

    assert len(list(market_sessions(date(2024, 1, 1), date(2026, 9, 3), calendar))) == 671


def test_backfill_does_not_redownload_completed_sessions_inside_range(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument()])
        backfill_sessions(provider, store, date(2026, 9, 2), date(2026, 9, 2), sleep=lambda _: None)

        provider.ranges.clear()
        backfill_sessions(
            provider,
            store,
            date(2026, 9, 1),
            date(2026, 9, 3),
            session_chunk_size=35,
            sleep=lambda _: None,
        )

        assert provider.ranges == [
            (date(2026, 9, 1), date(2026, 9, 1)),
            (date(2026, 9, 3), date(2026, 9, 3)),
        ]


def test_backfill_requests_multiple_sessions_per_symbol_batch(tmp_path: Path) -> None:
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL"), instrument("MSFT")])
        result = backfill_sessions(
            provider,
            store,
            date(2026, 9, 1),
            date(2026, 9, 4),
            batch_size=1,
            session_chunk_size=4,
            sleep=lambda _: None,
        )
        assert result["completed"] == 4
        assert provider.calls == 2
        assert provider.ranges == [(date(2026, 9, 1), date(2026, 9, 4))] * 2
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 8


def test_failed_chunk_rolls_back_partial_bars_and_leaves_sessions_incomplete(tmp_path: Path) -> None:
    class PartlyFailingProvider(FakeProvider):
        def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
            rows = super().get_daily_bars(symbols, start, end)
            if self.calls == 2:
                request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
                response = httpx.Response(500, request=request)
                raise httpx.HTTPStatusError("temporary", request=request, response=response)
            return rows

    provider = PartlyFailingProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL"), instrument("MSFT")])
        result = backfill_sessions(
            provider,
            store,
            date(2026, 9, 3),
            date(2026, 9, 3),
            batch_size=1,
            max_retries=0,
            sleep=lambda _: None,
        )
        assert result["failed"] == 1
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 0
        assert store.connection.execute("SELECT count(*) FROM data_ingest_runs WHERE status = 'completed'").fetchone()[0] == 0
        assert store.connection.execute("SELECT count(*) FROM data_ingest_runs WHERE status = 'failed'").fetchone()[0] == 1


def test_backfill_rejects_bars_outside_requested_session_range(tmp_path: Path) -> None:
    provider = FakeProvider(out_of_range=True)
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument()])
        result = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        assert result["failed"] == 1
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 0


def test_historical_universe_preflight_excludes_bisected_bad_symbols(tmp_path: Path) -> None:
    class BadSymbolProvider(FakeProvider):
        def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
            if "BAD" in symbols:
                request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
                response = httpx.Response(400, json={"message": "invalid symbol: BAD"}, request=request)
                raise httpx.HTTPStatusError("bad request", request=request, response=response)
            return super().get_daily_bars(symbols, start, end)

    provider = BadSymbolProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL"), instrument("BAD"), instrument("MSFT")])
        result = preflight_historical_universe(
            provider,
            store,
            probe_session=date(2026, 9, 3),
            batch_size=200,
            sleep=lambda _: None,
        )

        assert result.rejected_symbols == ("BAD",)
        assert store.historical_symbols() == ["AAPL", "MSFT"]
        assert store.connection.execute(
            "SELECT sip_queryable, sip_queryable_reason FROM instruments WHERE symbol = 'BAD'"
        ).fetchone() == (
            False,
            'Alpaca SIP bars HTTP 400: {"message":"invalid symbol: BAD"}',
        )
        assert result.reconciliation == {
            "included": 2,
            "rejected_by_alpaca": 1,
            "excluded_malformed": 0,
            "excluded_otc": 0,
            "removed_duplicate": 0,
            "excluded_other": 0,
            "source_population": 3,
        }


def test_universe_reconciliation_partitions_every_source_candidate(tmp_path: Path) -> None:
    class MixedUniverseProvider(FakeProvider):
        def list_instruments(self, *, status: str = "active") -> list[Instrument]:
            if status == "active":
                return [
                    instrument("LIVE"),
                    instrument("LIVE"),
                    Instrument("OTCA", "OTC Active", "OTC", "us_equity", "active", True, False, "OTCA"),
                    Instrument("044CNT012", "Contra", "NYSE", "us_equity", "active", False, False, "044CNT012"),
                    instrument("BAD"),
                ]
            return [instrument("OLD")]

        def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
            if "BAD" in symbols:
                request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
                response = httpx.Response(400, json={"message": "invalid symbol: BAD"}, request=request)
                raise httpx.HTTPStatusError("bad request", request=request, response=response)
            return super().get_daily_bars(symbols, start, end)

    provider = MixedUniverseProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        refresh = refresh_historical_universe_details(provider, store)
        preflight = preflight_historical_universe(
            provider,
            store,
            probe_session=date(2026, 9, 3),
            source_population=refresh.source_population,
            duplicates_removed=refresh.duplicates_removed,
            sleep=lambda _: None,
        )

        assert preflight.reconciliation == {
            "included": 2,
            "rejected_by_alpaca": 1,
            "excluded_malformed": 1,
            "excluded_otc": 1,
            "removed_duplicate": 1,
            "excluded_other": 0,
            "source_population": 6,
        }
        assert sum(value for key, value in preflight.reconciliation.items() if key != "source_population") == 6


def test_universe_reconciliation_fails_closed_on_unexplained_counts(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL")])
        try:
            store.historical_universe_reconciliation(source_count=0)
        except ValueError as exc:
            assert "over-assigned" in str(exc)
        else:
            raise AssertionError("expected reconciliation failure")


def test_universe_reconciliation_ignores_stale_store_rows_outside_current_source(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL"), instrument("STALE")])

        assert store.historical_universe_reconciliation(
            source_count=1,
            source_symbols=["AAPL"],
        ) == {
            "included": 1,
            "rejected_by_alpaca": 0,
            "excluded_malformed": 0,
            "excluded_otc": 0,
            "removed_duplicate": 0,
            "excluded_other": 0,
            "source_population": 1,
        }


def test_progress_separates_historical_density_from_live_coverage(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    provider = FakeProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([
            instrument("AAPL"),
            Instrument("OLD", "Old", "NYSE", "us_equity", "inactive", False, False, "OLD"),
        ])
        backfill_sessions(
            provider,
            store,
            date(2026, 9, 3),
            date(2026, 9, 3),
            sleep=lambda _: None,
            emit=events.append,
        )

    assert "historical_response_density_percent" in events[-1]
    assert "live_universe_coverage_percent" in events[-1]
    assert events[-1]["historical_response_density_percent"] == 100.0
    assert events[-1]["live_universe_coverage_percent"] == 100.0


def test_file_backed_chunk_failure_rolls_back_and_reopens_cleanly(tmp_path: Path) -> None:
    class PartlyFailingProvider(FakeProvider):
        def get_daily_bars(self, symbols: list[str], start: date, end: date) -> list[DailyBar]:
            rows = super().get_daily_bars(symbols, start, end)
            if self.calls == 2:
                request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
                response = httpx.Response(400, json={"message": "invalid symbol"}, request=request)
                raise httpx.HTTPStatusError("bad request", request=request, response=response)
            return rows

    db_path = tmp_path / "brontide.duckdb"
    with DuckDBStore(db_path) as store:
        store.upsert_instruments([instrument("AAPL"), instrument("MSFT")])
        with pytest.raises(httpx.HTTPStatusError):
            backfill_sessions(
                PartlyFailingProvider(),
                store,
                date(2026, 9, 3),
                date(2026, 9, 3),
                batch_size=1,
                max_retries=0,
                sleep=lambda _: None,
                stop_on_error=True,
            )

    with DuckDBStore(db_path) as reopened:
        assert reopened.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 0
        assert reopened.connection.execute("SELECT count(*) FROM data_ingest_runs WHERE status = 'failed'").fetchone()[0] == 1


def test_interruption_between_chunks_preserves_completed_chunk(tmp_path: Path) -> None:
    db_path = tmp_path / "brontide.duckdb"
    with DuckDBStore(db_path) as store:
        store.upsert_instruments([instrument("AAPL")])

        def interrupt_after_first_chunk(event: dict[str, object]) -> None:
            if event["status"] == "completed":
                raise KeyboardInterrupt()

        with pytest.raises(KeyboardInterrupt):
            backfill_sessions(
                FakeProvider(),
                store,
                date(2026, 9, 3),
                date(2026, 9, 4),
                session_chunk_size=1,
                sleep=lambda _: None,
                emit=interrupt_after_first_chunk,
            )

    with DuckDBStore(db_path) as reopened:
        assert reopened.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 1
        assert reopened.connection.execute("SELECT count(*) FROM data_ingest_runs WHERE status = 'completed'").fetchone()[0] == 1


def test_rate_limiter_targets_requested_request_spacing() -> None:
    times = iter([0.0, 0.1, 0.34])
    sleeps: list[float] = []
    limiter = RequestRateLimiter(requests_per_minute=180, clock=lambda: next(times), sleep=sleeps.append)

    limiter.wait()
    limiter.wait()

    assert limiter.requests == 2
    assert sleeps == [0.2333333333333333]


def test_backfill_honors_retry_after_header(tmp_path: Path) -> None:
    sleeps: list[float] = []
    provider = FakeProvider(fail_once=True)
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument()])
        request = httpx.Request("GET", "https://data.alpaca.markets/v2/stocks/bars")
        response = httpx.Response(429, headers={"retry-after": "3"}, request=request)

        def failing_once(symbols: list[str], start: date, end: date) -> list[DailyBar]:
            provider.calls += 1
            if provider.calls == 1:
                raise httpx.HTTPStatusError("rate limited", request=request, response=response)
            return [bar(symbol, start) for symbol in symbols]

        provider.get_daily_bars = failing_once  # type: ignore[method-assign]
        result = backfill_sessions(
            provider,
            store,
            date(2026, 9, 3),
            date(2026, 9, 3),
            max_retries=1,
            sleep=sleeps.append,
        )

        assert result["completed"] == 1
        assert sleeps == [3.0]


def test_bar_upsert_is_idempotent(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        assert store.upsert_bars([bar()]) == 1
        assert store.upsert_bars([bar()]) == 1
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 1


class UniverseProvider(FakeProvider):
    def list_instruments(self, *, status: str = "active") -> list[Instrument]:
        if status == "active":
            return [
                instrument("LIVE"),
                Instrument("OTCA", "OTC Active", "OTC", "us_equity", "active", True, False, "OTCA"),
            ]
        if status == "inactive":
            return [
                Instrument("OLD", "Old Listed", "NYSE", "us_equity", "inactive", False, False, "OLD"),
                Instrument("OTCI", "OTC Inactive", "OTC", "us_equity", "inactive", False, False, "OTCI"),
            ]
        return []


def test_inactive_historical_symbols_can_be_stored(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([Instrument("OLD", "Old Listed", "NYSE", "us_equity", "inactive", False, False, "OLD")])
        assert store.connection.execute("SELECT status FROM instruments WHERE symbol = 'OLD'").fetchone() == ("inactive",)


def test_live_scans_exclude_inactive_symbols(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        refresh_historical_universe(UniverseProvider(), store)
        assert store.live_scan_symbols() == ["LIVE"]


def test_historical_backtests_include_eligible_inactive_symbols(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        refresh_historical_universe(UniverseProvider(), store)
        assert store.historical_symbols() == ["LIVE", "OLD"]


def test_historical_backtests_exclude_malformed_inactive_symbols_but_store_them(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([
            Instrument("OLD", "Old Listed", "NYSE", "us_equity", "inactive", False, False, "OLD"),
            Instrument("044CNT012", "Contra CUSIP", "NYSE", "us_equity", "inactive", False, False, "044CNT012"),
        ])
        assert store.connection.execute("SELECT count(*) FROM instruments").fetchone()[0] == 2
        assert store.historical_symbols() == ["OLD"]


def test_otc_symbols_are_excluded_from_sip_coverage_denominator(tmp_path: Path) -> None:
    provider = UniverseProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        refresh_historical_universe(provider, store)
        result = backfill_sessions(provider, store, date(2026, 9, 3), date(2026, 9, 3), sleep=lambda _: None)
        assert result["completed"] == 1
        assert store.connection.execute(
            "SELECT count(*) FROM instruments WHERE status IN ('active', 'inactive') AND exchange <> 'OTC'"
        ).fetchone()[0] == 2


def test_active_and_historical_universe_refreshes_are_idempotent(tmp_path: Path) -> None:
    provider = UniverseProvider()
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        assert refresh_universe(provider, store) == 2
        assert refresh_universe(provider, store) == 2
        assert store.connection.execute("SELECT count(*) FROM instruments").fetchone()[0] == 2
        assert refresh_historical_universe(provider, store) == 4
        assert refresh_historical_universe(provider, store) == 4
        assert store.connection.execute("SELECT count(*) FROM instruments").fetchone()[0] == 4


def test_historical_universe_refresh_dedupes_symbols_and_prefers_active(tmp_path: Path) -> None:
    class DuplicateSymbolProvider(UniverseProvider):
        def list_instruments(self, *, status: str = "active") -> list[Instrument]:
            if status == "active":
                return [Instrument("DUPE", "Active Name", "NYSE", "us_equity", "active", True, False, "active-id")]
            return [Instrument("DUPE", "Inactive Name", "NYSE", "us_equity", "inactive", False, False, "inactive-id")]

    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        assert refresh_historical_universe(DuplicateSymbolProvider(), store) == 1
        assert store.connection.execute("SELECT name, status, provider_id FROM instruments").fetchone() == (
            "Active Name",
            "active",
            "active-id",
        )
