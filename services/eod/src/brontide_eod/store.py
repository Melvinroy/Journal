from __future__ import annotations

from pathlib import Path
from typing import Iterable

import duckdb

from brontide_eod.models import DailyBar, Instrument, QualityIssue


SCHEMA = """
CREATE TABLE IF NOT EXISTS instruments (
  symbol VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  exchange VARCHAR NOT NULL,
  asset_class VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  tradable BOOLEAN NOT NULL,
  fractionable BOOLEAN NOT NULL,
  provider_id VARCHAR NOT NULL,
  source VARCHAR NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
);
CREATE TABLE IF NOT EXISTS daily_bars (
  symbol VARCHAR NOT NULL,
  session_date DATE NOT NULL,
  timeframe VARCHAR NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume BIGINT NOT NULL,
  trade_count BIGINT,
  vwap DOUBLE,
  adjustment VARCHAR NOT NULL,
  source VARCHAR NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
  quality_status VARCHAR NOT NULL,
  schema_version INTEGER NOT NULL,
  PRIMARY KEY (symbol, session_date, timeframe, adjustment, source)
);
CREATE TABLE IF NOT EXISTS data_ingest_runs (
  run_id UUID PRIMARY KEY,
  provider VARCHAR NOT NULL,
  session_date DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
  completed_at TIMESTAMPTZ,
  status VARCHAR NOT NULL,
  instrument_count INTEGER NOT NULL DEFAULT 0,
  bar_count INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  detail VARCHAR
);
CREATE TABLE IF NOT EXISTS data_quality_issues (
  run_id UUID NOT NULL,
  symbol VARCHAR NOT NULL,
  session_date DATE NOT NULL,
  code VARCHAR NOT NULL,
  detail VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
);
"""


class DuckDBStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = duckdb.connect(str(self.path))
        self.connection.execute(SCHEMA)

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "DuckDBStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def upsert_instruments(self, instruments: Iterable[Instrument]) -> int:
        rows = list(instruments)
        if not rows:
            return 0
        self.connection.executemany(
            """
            INSERT INTO instruments (
              symbol, name, exchange, asset_class, status, tradable,
              fractionable, provider_id, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
              name=excluded.name, exchange=excluded.exchange, asset_class=excluded.asset_class,
              status=excluded.status, tradable=excluded.tradable, fractionable=excluded.fractionable,
              provider_id=excluded.provider_id, source=excluded.source, updated_at=current_timestamp
            """,
            [
                (
                    row.symbol, row.name, row.exchange, row.asset_class, row.status,
                    row.tradable, row.fractionable, row.provider_id, row.source,
                )
                for row in rows
            ],
        )
        return len(rows)

    def upsert_bars(self, bars: Iterable[DailyBar]) -> int:
        rows = list(bars)
        if not rows:
            return 0
        self.connection.executemany(
            """
            INSERT INTO daily_bars (
              symbol, session_date, timeframe, open, high, low, close, volume, trade_count,
              vwap, adjustment, source, source_timestamp, quality_status, schema_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, session_date, timeframe, adjustment, source) DO UPDATE SET
              open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
              volume=excluded.volume, trade_count=excluded.trade_count, vwap=excluded.vwap,
              source_timestamp=excluded.source_timestamp, ingested_at=current_timestamp,
              quality_status=excluded.quality_status, schema_version=excluded.schema_version
            """,
            [
                (
                    row.symbol, row.session_date, row.timeframe, row.open, row.high, row.low,
                    row.close, row.volume, row.trade_count, row.vwap, row.adjustment, row.source,
                    row.source_timestamp, row.quality_status, row.schema_version,
                )
                for row in rows
            ],
        )
        return len(rows)

    def write_issues(self, run_id: str, issues: Iterable[QualityIssue]) -> int:
        rows = list(issues)
        if not rows:
            return 0
        self.connection.executemany(
            "INSERT INTO data_quality_issues (run_id, symbol, session_date, code, detail) VALUES (?, ?, ?, ?, ?)",
            [(run_id, row.symbol, row.session_date, row.code, row.detail) for row in rows],
        )
        return len(rows)

    def symbols(self, *, tradable_only: bool = True) -> list[str]:
        where = "WHERE status = 'active' AND tradable" if tradable_only else ""
        return [row[0] for row in self.connection.execute(f"SELECT symbol FROM instruments {where} ORDER BY symbol").fetchall()]

    def bars(self, symbol: str, limit: int = 300) -> list[dict[str, object]]:
        columns = [item[0] for item in self.connection.execute("DESCRIBE daily_bars").fetchall()]
        rows = self.connection.execute(
            "SELECT * FROM daily_bars WHERE symbol = ? ORDER BY session_date DESC LIMIT ?",
            [symbol.upper(), limit],
        ).fetchall()
        return [dict(zip(columns, row, strict=True)) for row in reversed(rows)]
