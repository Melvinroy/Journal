from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from brontide_eod.models import DailyBar, Instrument
from brontide_eod.store import DuckDBStore


def instrument(symbol: str, name: str) -> Instrument:
    return Instrument(
        symbol=symbol,
        name=name,
        exchange="NASDAQ",
        asset_class="us_equity",
        status="active",
        tradable=True,
        fractionable=False,
        provider_id=symbol,
    )


def bar(
    symbol: str,
    *,
    close: float = 100.5,
    trade_count: int | None = 100,
    vwap: float | None = 100.2,
    source_timestamp: datetime | None = None,
) -> DailyBar:
    session = date(2026, 9, 3)
    return DailyBar(
        symbol=symbol,
        session_date=session,
        open=100,
        high=max(101, close),
        low=99,
        close=close,
        volume=10_000,
        trade_count=trade_count,
        vwap=vwap,
        source_timestamp=source_timestamp or datetime(2026, 9, 3, 20, 0, tzinfo=timezone.utc),
    )


def test_upsert_instruments_escapes_apostrophes_and_unicode(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("OONE", "O'Brien Café Holdings")])

        row = store.connection.execute("SELECT name FROM instruments WHERE symbol = 'OONE'").fetchone()
        assert row == ("O'Brien Café Holdings",)


def test_upsert_bars_preserves_null_optional_values(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_bars([bar("AAPL", trade_count=None, vwap=None)])

        row = store.connection.execute("SELECT trade_count, vwap FROM daily_bars WHERE symbol = 'AAPL'").fetchone()
        assert row == (None, None)


def test_upsert_bars_serializes_timestamps(tmp_path: Path) -> None:
    timestamp = datetime(2026, 9, 3, 20, 15, 30, tzinfo=timezone.utc)
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_bars([bar("AAPL", source_timestamp=timestamp)])

        row = store.connection.execute("SELECT epoch(source_timestamp) FROM daily_bars WHERE symbol = 'AAPL'").fetchone()
        assert row[0] == timestamp.timestamp()


def test_repeated_idempotent_upserts(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("AAPL", "Apple Inc.")])
        store.upsert_instruments([instrument("AAPL", "Apple Inc.")])
        store.upsert_bars([bar("AAPL")])
        store.upsert_bars([bar("AAPL")])

        assert store.connection.execute("SELECT count(*) FROM instruments").fetchone()[0] == 1
        assert store.connection.execute("SELECT count(*) FROM daily_bars").fetchone()[0] == 1


def test_updating_existing_bar_preserves_unrelated_bars(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_bars([bar("AAPL", close=100.5), bar("MSFT", close=200.5)])
        store.upsert_bars([bar("AAPL", close=101.5)])

        rows = dict(store.connection.execute("SELECT symbol, close FROM daily_bars ORDER BY symbol").fetchall())
        assert rows == {"AAPL": 101.5, "MSFT": 200.5}


def test_malformed_string_values_are_escaped_as_literals(tmp_path: Path) -> None:
    payload = "Robert'); DROP TABLE instruments; --"
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.upsert_instruments([instrument("BADQ", payload)])

        assert store.connection.execute("SELECT name FROM instruments WHERE symbol = 'BADQ'").fetchone() == (payload,)
        assert store.connection.execute("SELECT count(*) FROM instruments").fetchone()[0] == 1


def test_universe_fingerprint_membership_is_reconstructable_and_immutable(tmp_path: Path) -> None:
    with DuckDBStore(tmp_path / "brontide.duckdb") as store:
        store.record_universe_membership("fingerprint-1", ["MSFT", "AAPL"])
        store.record_universe_membership("fingerprint-1", ["AAPL", "MSFT"])

        assert store.universe_symbols("fingerprint-1") == ["AAPL", "MSFT"]

        try:
            store.record_universe_membership("fingerprint-1", ["AAPL"])
        except ValueError as exc:
            assert "membership conflict" in str(exc)
        else:
            raise AssertionError("expected membership conflict")
