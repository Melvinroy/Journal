"""Read-only serving boundary; ingestion remains owned by DuckDBStore."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

import duckdb


class ChartRepository(Protocol):
    def search(self, query: str, limit: int) -> list[dict]: ...
    def instrument(self, symbol: str) -> dict | None: ...
    def bars(self, symbol: str, limit: int, adjustment: str, source: str) -> list[dict]: ...
    def freshness(self, latest: object, now: datetime) -> dict: ...
    def close(self) -> None: ...


class DuckDBChartRepository:
    def __init__(self, path: Path):
        # Never create a missing database, run migrations, checkpoint, or write a WAL.
        if not path.is_file():
            raise FileNotFoundError("EOD database is not available")
        self.connection = duckdb.connect(str(path), read_only=True)

    def close(self) -> None:
        self.connection.close()

    def _query(self, sql: str, params: list | None = None) -> list[dict]:
        result = self.connection.execute(sql, params or [])
        names = [column[0] for column in result.description]
        return [dict(zip(names, row, strict=True)) for row in result.fetchall()]

    def search(self, query: str, limit: int) -> list[dict]:
        return self._query("""
            SELECT symbol, name, exchange, status FROM instruments
            WHERE contains(upper(symbol), ?) OR contains(upper(name), ?)
            ORDER BY CASE WHEN symbol = ? THEN 0 WHEN starts_with(symbol, ?) THEN 1 ELSE 2 END, symbol
            LIMIT ?
        """, [query.upper(), query.upper(), query.upper(), query.upper(), limit])

    def instrument(self, symbol: str) -> dict | None:
        rows = self._query("""
            SELECT symbol, name, exchange, asset_class, status, tradable, source
            FROM instruments WHERE symbol = ?
        """, [symbol])
        if not rows:
            return None
        rows[0]["series"] = self._query("""
            SELECT source, adjustment, timeframe, count(*) AS bar_count,
                   min(session_date) AS first_session, max(session_date) AS last_session
            FROM daily_bars WHERE symbol = ? AND quality_status = 'ready'
            GROUP BY source, adjustment, timeframe ORDER BY source, adjustment, timeframe
        """, [symbol])
        return rows[0]

    def bars(self, symbol: str, limit: int, adjustment: str, source: str) -> list[dict]:
        rows = self._query("""
            SELECT session_date, open, high, low, close, volume,
                   adjustment, source, timeframe, quality_status
            FROM daily_bars
            WHERE symbol = ? AND timeframe = '1Day' AND adjustment = ?
                  AND source = ? AND quality_status = 'ready'
            ORDER BY session_date DESC LIMIT ?
        """, [symbol, adjustment, source, limit])
        return list(reversed(rows))

    def freshness(self, latest: object, now: datetime) -> dict:
        # Use the stored authoritative calendar, including early closes and SIP delay.
        local_now = now.astimezone(ZoneInfo("America/New_York"))
        snapshots = self._query("""
            SELECT calendar_fingerprint, end_date FROM market_calendar_snapshots
            WHERE provider = 'alpaca' AND start_date <= ?
            ORDER BY end_date DESC, created_at DESC LIMIT 1
        """, [local_now.date()])
        expected = None
        covered = False
        if snapshots:
            snapshot = snapshots[0]
            covered = snapshot["end_date"] >= local_now.date()
            sessions = self._query("""
                SELECT session_date, close_time FROM market_calendar_sessions
                WHERE calendar_fingerprint = ? AND session_date <= ?
                ORDER BY session_date DESC LIMIT 2
            """, [snapshot["calendar_fingerprint"], local_now.date()])
            for session in sessions:
                available = datetime.combine(session["session_date"], session["close_time"], local_now.tzinfo) + timedelta(minutes=15)
                if available <= local_now:
                    expected = session["session_date"]
                    break
        state = "stale" if latest and expected and latest < expected else "fresh" if latest and covered and expected else "unknown"
        return {"freshness": state, "last_session": latest, "expected_session": expected,
                "calendar_covered": covered, "checked_at": now.isoformat()}
