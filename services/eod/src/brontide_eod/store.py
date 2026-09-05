from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

import duckdb

from brontide_eod.models import DailyBar, Instrument, QualityIssue


SIP_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$")


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
  sip_queryable BOOLEAN NOT NULL DEFAULT true,
  sip_queryable_reason VARCHAR,
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
  universe_fingerprint VARCHAR,
  config_fingerprint VARCHAR,
  instrument_count INTEGER NOT NULL DEFAULT 0,
  bar_count INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  detail VARCHAR
);
CREATE TABLE IF NOT EXISTS universe_memberships (
  universe_fingerprint VARCHAR NOT NULL,
  symbol VARCHAR NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (universe_fingerprint, symbol)
);
CREATE TABLE IF NOT EXISTS ingestion_configs (
  config_fingerprint VARCHAR PRIMARY KEY,
  provider VARCHAR NOT NULL,
  feed VARCHAR NOT NULL,
  timeframe VARCHAR NOT NULL,
  adjustment VARCHAR NOT NULL,
  asof_value VARCHAR NOT NULL,
  symbol_validation_rules VARCHAR NOT NULL,
  universe_fingerprint VARCHAR NOT NULL,
  pipeline_version VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
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


def _sql_string(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _sql_optional(value: object | None) -> str:
    return "null" if value is None else str(value)


def _sql_bool(value: bool) -> str:
    return "true" if value else "false"


def _dedupe_instruments_by_symbol(instruments: Iterable[Instrument]) -> list[Instrument]:
    by_symbol: dict[str, Instrument] = {}
    for instrument in instruments:
        existing = by_symbol.get(instrument.symbol)
        if existing is None or (existing.status != "active" and instrument.status == "active"):
            by_symbol[instrument.symbol] = instrument
    return list(by_symbol.values())


class DuckDBStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = duckdb.connect(str(self.path))
        self.connection.execute(SCHEMA)
        self._migrate()

    def close(self) -> None:
        self.connection.close()

    def _migrate(self) -> None:
        columns = {
            row[0]
            for row in self.connection.execute("DESCRIBE data_ingest_runs").fetchall()
        }
        if "universe_fingerprint" not in columns:
            self.connection.execute("ALTER TABLE data_ingest_runs ADD COLUMN universe_fingerprint VARCHAR")
        if "config_fingerprint" not in columns:
            self.connection.execute("ALTER TABLE data_ingest_runs ADD COLUMN config_fingerprint VARCHAR")
        instrument_columns = {
            row[0]
            for row in self.connection.execute("DESCRIBE instruments").fetchall()
        }
        if "sip_queryable" not in instrument_columns:
            self.connection.execute("ALTER TABLE instruments ADD COLUMN sip_queryable BOOLEAN DEFAULT true")
            self.connection.execute("UPDATE instruments SET sip_queryable = true WHERE sip_queryable IS NULL")
        if "sip_queryable_reason" not in instrument_columns:
            self.connection.execute("ALTER TABLE instruments ADD COLUMN sip_queryable_reason VARCHAR")

    def begin(self) -> None:
        self.connection.execute("BEGIN TRANSACTION")

    def commit(self) -> None:
        self.connection.execute("COMMIT")

    def rollback(self) -> None:
        try:
            self.connection.execute("ROLLBACK")
        except duckdb.TransactionException:
            pass

    def checkpoint(self) -> None:
        self.connection.execute("CHECKPOINT")

    def __enter__(self) -> "DuckDBStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def upsert_instruments(self, instruments: Iterable[Instrument]) -> int:
        rows = _dedupe_instruments_by_symbol(instruments)
        if not rows:
            return 0
        values_sql = ",\n".join(
            "(" + ", ".join((
                _sql_string(row.symbol),
                _sql_string(row.name),
                _sql_string(row.exchange),
                _sql_string(row.asset_class),
                _sql_string(row.status),
                _sql_bool(row.tradable),
                _sql_bool(row.fractionable),
                _sql_string(row.provider_id),
                _sql_string(row.source),
            )) + ")"
            for row in rows
        )
        self.connection.execute(
            f"""
            CREATE OR REPLACE TEMP TABLE incoming_instruments AS
            SELECT * FROM (VALUES {values_sql}) AS row(
              symbol, name, exchange, asset_class, status, tradable,
              fractionable, provider_id, source
            )
            """
        )
        self.connection.execute(
            """
            CREATE OR REPLACE TEMP TABLE existing_instrument_flags AS
            SELECT symbol, sip_queryable, sip_queryable_reason
            FROM instruments
            WHERE symbol IN (SELECT symbol FROM incoming_instruments)
            """
        )
        self.connection.execute(
            "DELETE FROM instruments WHERE symbol IN (SELECT symbol FROM incoming_instruments)"
        )
        self.connection.execute(
            """
            INSERT INTO instruments (
              symbol, name, exchange, asset_class, status, tradable,
              fractionable, provider_id, source, sip_queryable,
              sip_queryable_reason, updated_at
            )
            SELECT symbol, name, exchange, asset_class, status, tradable,
              fractionable, provider_id, source,
              coalesce(existing.sip_queryable, true),
              existing.sip_queryable_reason,
              now()
            FROM incoming_instruments
            LEFT JOIN existing_instrument_flags AS existing USING (symbol)
            """
        )
        self.connection.execute("DROP TABLE existing_instrument_flags")
        self.connection.execute("DROP TABLE incoming_instruments")
        return len(rows)

    def mark_symbols_not_sip_queryable(self, symbols: Iterable[str], reason: str) -> int:
        rows = sorted(set(symbols))
        if not rows:
            return 0
        values_sql = ",\n".join(f"({_sql_string(symbol)})" for symbol in rows)
        self.connection.execute(
            f"""
            CREATE OR REPLACE TEMP TABLE rejected_symbols AS
            SELECT * FROM (VALUES {values_sql}) AS row(symbol)
            """
        )
        self.connection.execute(
            """
            UPDATE instruments
            SET sip_queryable=false, sip_queryable_reason=?
            WHERE symbol IN (SELECT symbol FROM rejected_symbols)
            """,
            [reason[:2_000]],
        )
        self.connection.execute("DROP TABLE rejected_symbols")
        return len(rows)

    def upsert_bars(self, bars: Iterable[DailyBar]) -> int:
        rows = list(bars)
        if not rows:
            return 0
        values_sql = ",\n".join(
            "(" + ", ".join((
                _sql_string(row.symbol),
                _sql_string(row.session_date.isoformat()),
                _sql_string(row.timeframe),
                str(row.open),
                str(row.high),
                str(row.low),
                str(row.close),
                str(row.volume),
                _sql_optional(row.trade_count),
                _sql_optional(row.vwap),
                _sql_string(row.adjustment),
                _sql_string(row.source),
                _sql_string(row.source_timestamp.isoformat()),
                _sql_string(row.quality_status),
                str(row.schema_version),
            )) + ")"
            for row in rows
        )
        self.connection.execute(
            f"""
            CREATE OR REPLACE TEMP TABLE incoming_daily_bars AS
            SELECT * FROM (VALUES {values_sql}) AS row(
              symbol, session_date, timeframe, open, high, low, close, volume,
              trade_count, vwap, adjustment, source, source_timestamp,
              quality_status, schema_version
            )
            """
        )
        self.connection.execute(
            """
            DELETE FROM daily_bars
            USING incoming_daily_bars
            WHERE daily_bars.symbol = incoming_daily_bars.symbol
              AND daily_bars.session_date = incoming_daily_bars.session_date
              AND daily_bars.timeframe = incoming_daily_bars.timeframe
              AND daily_bars.adjustment = incoming_daily_bars.adjustment
              AND daily_bars.source = incoming_daily_bars.source
            """
        )
        self.connection.execute(
            """
            INSERT INTO daily_bars (
              symbol, session_date, timeframe, open, high, low, close, volume,
              trade_count, vwap, adjustment, source, source_timestamp,
              quality_status, schema_version
            )
            SELECT symbol, session_date, timeframe, open, high, low, close, volume,
              trade_count, vwap, adjustment, source, source_timestamp,
              quality_status, schema_version
            FROM incoming_daily_bars
            """
        )
        self.connection.execute("DROP TABLE incoming_daily_bars")
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

    def record_universe_membership(self, universe_fingerprint: str, symbols: Iterable[str]) -> None:
        sorted_symbols = sorted(symbols)
        existing = [
            row[0]
            for row in self.connection.execute(
                """
                SELECT symbol FROM universe_memberships
                WHERE universe_fingerprint = ?
                ORDER BY ordinal
                """,
                [universe_fingerprint],
            ).fetchall()
        ]
        if existing:
            if existing != sorted_symbols:
                raise ValueError("universe fingerprint membership conflict")
            return
        values_sql = ",\n".join(
            "(" + ", ".join((_sql_string(universe_fingerprint), _sql_string(symbol), str(index))) + ")"
            for index, symbol in enumerate(sorted_symbols)
        )
        if not values_sql:
            raise ValueError("universe fingerprint cannot be recorded for an empty symbol set")
        self.connection.execute(
            f"""
            INSERT INTO universe_memberships (universe_fingerprint, symbol, ordinal)
            SELECT * FROM (VALUES {values_sql}) AS row(universe_fingerprint, symbol, ordinal)
            """
        )

    def universe_symbols(self, universe_fingerprint: str) -> list[str]:
        return [
            row[0]
            for row in self.connection.execute(
                """
                SELECT symbol FROM universe_memberships
                WHERE universe_fingerprint = ?
                ORDER BY ordinal
                """,
                [universe_fingerprint],
            ).fetchall()
        ]

    def record_ingestion_config(
        self,
        *,
        config_fingerprint: str,
        provider: str,
        feed: str,
        timeframe: str,
        adjustment: str,
        asof: str,
        symbol_validation_rules: str,
        universe_fingerprint: str,
        pipeline_version: str,
    ) -> None:
        existing = self.connection.execute(
            """
            SELECT provider, feed, timeframe, adjustment, asof_value, symbol_validation_rules,
              universe_fingerprint, pipeline_version
            FROM ingestion_configs
            WHERE config_fingerprint = ?
            """,
            [config_fingerprint],
        ).fetchone()
        payload = (
            provider,
            feed,
            timeframe,
            adjustment,
            asof,
            symbol_validation_rules,
            universe_fingerprint,
            pipeline_version,
        )
        if existing:
            if tuple(existing) != payload:
                raise ValueError("ingestion configuration fingerprint conflict")
            return
        self.connection.execute(
            """
            INSERT INTO ingestion_configs (
              config_fingerprint, provider, feed, timeframe, adjustment, asof_value,
              symbol_validation_rules, universe_fingerprint, pipeline_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (config_fingerprint, *payload),
        )

    def live_scan_symbols(self) -> list[str]:
        return self.symbols(statuses=["active"], tradable_only=True, exclude_otc=True)

    def historical_symbols(self, *, source_symbols: Iterable[str] | None = None) -> list[str]:
        source_symbol_set = set(source_symbols) if source_symbols is not None else None
        return [
            symbol for symbol in self.symbols(
                statuses=["active", "inactive"],
                tradable_only=False,
                exclude_otc=True,
                sip_queryable_only=True,
            )
            if is_sip_symbol(symbol) and (source_symbol_set is None or symbol in source_symbol_set)
        ]

    def historical_universe_reconciliation(
        self,
        *,
        source_count: int | None = None,
        duplicates_removed: int = 0,
        source_symbols: Iterable[str] | None = None,
    ) -> dict[str, int]:
        source_symbol_set = set(source_symbols) if source_symbols is not None else None
        rows = self.connection.execute(
            """
            SELECT symbol, exchange, coalesce(sip_queryable, true)
            FROM instruments
            WHERE status IN ('active', 'inactive')
            """
        ).fetchall()
        counts = {
            "included": 0,
            "rejected_by_alpaca": 0,
            "excluded_malformed": 0,
            "excluded_otc": 0,
            "removed_duplicate": duplicates_removed,
            "excluded_other": 0,
        }
        for symbol, exchange, sip_queryable in rows:
            if source_symbol_set is not None and symbol not in source_symbol_set:
                continue
            if exchange == "OTC":
                counts["excluded_otc"] += 1
            elif not is_sip_symbol(symbol):
                counts["excluded_malformed"] += 1
            elif not sip_queryable:
                counts["rejected_by_alpaca"] += 1
            else:
                counts["included"] += 1
        population = source_count if source_count is not None else len(rows) + duplicates_removed
        assigned = sum(counts.values())
        if assigned > population:
            raise ValueError(f"historical universe reconciliation over-assigned {assigned} > {population}")
        counts["excluded_other"] = population - assigned
        assigned = sum(counts.values())
        if assigned != population:
            raise ValueError(f"historical universe reconciliation mismatch {assigned} != {population}")
        counts["source_population"] = population
        return counts

    def symbols(
        self,
        *,
        statuses: list[str] | None = None,
        tradable_only: bool = True,
        exclude_otc: bool = False,
        sip_queryable_only: bool = False,
    ) -> list[str]:
        clauses = []
        if statuses:
            status_list = ", ".join(_sql_string(status) for status in statuses)
            clauses.append(f"status IN ({status_list})")
        elif tradable_only:
            clauses.append("status = 'active'")
        if tradable_only:
            clauses.append("tradable")
        if exclude_otc:
            clauses.append("exchange <> 'OTC'")
        if sip_queryable_only:
            clauses.append("coalesce(sip_queryable, true)")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return [row[0] for row in self.connection.execute(f"SELECT symbol FROM instruments {where} ORDER BY symbol").fetchall()]

    def bars(self, symbol: str, limit: int = 300) -> list[dict[str, object]]:
        columns = [item[0] for item in self.connection.execute("DESCRIBE daily_bars").fetchall()]
        rows = self.connection.execute(
            "SELECT * FROM daily_bars WHERE symbol = ? ORDER BY session_date DESC LIMIT ?",
            [symbol.upper(), limit],
        ).fetchall()
        return [dict(zip(columns, row, strict=True)) for row in reversed(rows)]


def is_sip_symbol(symbol: str) -> bool:
    return bool(SIP_SYMBOL_PATTERN.fullmatch(symbol))
