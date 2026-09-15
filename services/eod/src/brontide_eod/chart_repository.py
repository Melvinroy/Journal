"""Read-only serving boundary; ingestion remains owned by DuckDBStore."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

import duckdb

from brontide_eod.scanner import BIGGEST_ONE_MONTH_FORMULA_VERSION


class ChartRepository(Protocol):
    def search(self, query: str, limit: int) -> list[dict]: ...
    def instrument(self, symbol: str) -> dict | None: ...
    def bars(self, symbol: str, limit: int, adjustment: str, source: str) -> list[dict]: ...
    def freshness(self, latest: object, now: datetime) -> dict: ...
    def update_status(self) -> dict: ...
    def biggest_one_month(self, min_dollar_volume: float, min_adr_percent: float, min_growth_rank: float) -> dict: ...
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
        result = {"freshness": state, "last_session": latest, "expected_session": expected,
                  "calendar_covered": covered, "checked_at": now.isoformat()}
        try:
            status = self.update_status()
            result["publication"] = {
                "state": status.get("state"), "publication_id": status.get("publication_id"),
                "published_session": status.get("published_session"), "last_success_at": status.get("last_success_at"),
            }
        except duckdb.CatalogException:
            pass
        return result

    def update_status(self) -> dict:
        rows = self._query("""
            SELECT state,expected_session,published_session,last_success_at,publication_id,
              coverage_percent,expected_symbols,loaded_symbols,adjustment_coverage,retry_at,explanation
            FROM eod_update_state WHERE singleton_id=1
        """)
        if not rows:
            return {"state": "stale", "explanation": "No validated EOD publication is available."}
        row = rows[0]
        import json
        return {
            "state": row["state"], "expected_session": row["expected_session"],
            "published_session": row["published_session"], "last_success_at": row["last_success_at"],
            "publication_id": row["publication_id"], "retry_at": row["retry_at"],
            "coverage": {"percent": row["coverage_percent"], "expected_symbols": row["expected_symbols"],
                         "loaded_symbols": row["loaded_symbols"],
                         "adjustments": json.loads(row["adjustment_coverage"]) if row["adjustment_coverage"] else {}},
            "explanation": row["explanation"],
        }

    def biggest_one_month(self, min_dollar_volume: float, min_adr_percent: float, min_growth_rank: float) -> dict:
        status = self.update_status()
        publication_id = status.get("publication_id")
        if publication_id is None:
            return {"status": status, "data_date": None, "comparison_universe": {"eligible": 0, "ranked": 0}, "results": []}
        counts = self._query("""
            SELECT count(*) AS ranked,
              (SELECT expected_symbols FROM eod_publications WHERE publication_id=?) AS eligible,
              (SELECT excluded_count FROM eod_publications WHERE publication_id=?) AS excluded,
              (SELECT manifest_json FROM eod_publications WHERE publication_id=?) AS manifest_json,
              (SELECT formula_version FROM eod_publications WHERE publication_id=?) AS formula_version
            FROM scanner_measurements WHERE publication_id=? AND scanner_key='biggest-one-month'
        """, [publication_id, publication_id, publication_id, publication_id, publication_id])[0]
        import json
        manifest = json.loads(counts["manifest_json"]) if counts["manifest_json"] else {}
        scanner_universe = manifest.get("scanner_universe") or {}
        scanner_columns = {
            row["column_name"] for row in self._query("DESCRIBE scanner_measurements")
        }
        day_percent = "day_percent" if "day_percent" in scanner_columns else "NULL AS day_percent"
        results = self._query(f"""
            SELECT symbol,dollar_volume,growth_percent,adr_percent,growth_rank,{day_percent}
            FROM scanner_measurements
            WHERE publication_id=? AND scanner_key='biggest-one-month'
              AND dollar_volume > ? AND adr_percent > ? AND growth_rank >= ?
            ORDER BY growth_percent DESC, symbol ASC
        """, [publication_id, min_dollar_volume, min_adr_percent, min_growth_rank])
        formula_version = counts["formula_version"] or "unknown"
        definition = (
            {
                "dollar_volume": "raw close[t] × raw actual-share volume[t]",
                "growth": "100 × (split close[t] / minimum split low[t…t−21] − 1)",
                "adr": "100 × (sum of 21 split high/low ratios ending at t ÷ 20 − 1)",
                "rank": "average ascending tie rank against TC2000 US Stocks before Universal filters",
                "thresholds": {"min_dollar_volume": min_dollar_volume, "min_adr_percent": min_adr_percent,
                               "min_growth_rank": min_growth_rank},
            }
            if formula_version == BIGGEST_ONE_MONTH_FORMULA_VERSION else
            {
                "dollar_volume": "raw close[t] × raw actual-share volume[t]",
                "growth": "legacy published Scanner formula; refresh required for TC2000 parity",
                "adr": "legacy published Scanner formula; refresh required for TC2000 parity",
                "rank": "legacy published Scanner universe; refresh required for TC2000 parity",
                "thresholds": {"min_dollar_volume": min_dollar_volume, "min_adr_percent": min_adr_percent,
                               "min_growth_rank": min_growth_rank},
            }
        )
        return {
            "scanner": "biggest-one-month", "formula_version": formula_version,
            "definition": definition,
            "comparison_universe": {
                "eligible": scanner_universe.get("candidate_measured", counts["eligible"]),
                "ranked": scanner_universe.get("rank_measured", counts["ranked"]),
                "excluded": scanner_universe.get("candidate_excluded", counts["excluded"]),
                "source": scanner_universe.get("source", "unknown"),
                "evaluation_session": scanner_universe.get("evaluation_session"),
                "candidate_fingerprint": scanner_universe.get("candidate_fingerprint"),
                "rank_fingerprint": scanner_universe.get("rank_fingerprint"),
                "age_sessions": scanner_universe.get("age_sessions"),
                "stale": scanner_universe.get("stale", True),
                "ranking_mode": scanner_universe.get("ranking_mode", "unknown"),
                "effective_rank_cutoff": scanner_universe.get("effective_rank_cutoff"),
                "missing_candidate_symbols": scanner_universe.get("missing_candidate_symbols", []),
                "missing_rank_symbols": scanner_universe.get("missing_rank_symbols", []),
            },
            "status": status, "data_date": status.get("published_session"), "results": results,
        }
