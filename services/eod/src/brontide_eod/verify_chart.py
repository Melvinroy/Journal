"""Compare served OHLCV with the existing database; no downloads or writes."""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path
from time import perf_counter

import duckdb
import httpx

from brontide_eod.config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--db", type=Path)
    args = parser.parse_args()
    path = args.db or Settings.from_env().db_path
    if not path.is_file():
        raise SystemExit("Database not found. Run from services/eod or supply --db.")
    summaries = []
    with duckdb.connect(str(path), read_only=True) as connection, httpx.Client(base_url=args.url, timeout=30, trust_env=False) as client:
        for symbol in ("AAPL", "MSFT", "NVDA", "SPY"):
            expected = connection.execute("""
                SELECT session_date, open, high, low, close, volume FROM daily_bars
                WHERE symbol=? AND source='alpaca_sip' AND adjustment='all'
                      AND timeframe='1Day' AND quality_status='ready'
                ORDER BY session_date DESC LIMIT 5000
            """, [symbol]).fetchall()[::-1]
            started = perf_counter()
            response = client.get(f"/v1/chart/{symbol}?limit=5000&adjustment=all&source=alpaca_sip")
            response.raise_for_status()
            payload = response.json()
            actual = [(date.fromisoformat(bar["session_date"]), *(bar[key] for key in ("open", "high", "low", "close", "volume"))) for bar in payload["bars"]]
            if not expected or actual != expected:
                raise SystemExit(f"FAIL: {symbol} API records differ from the selected stored series or are empty")
            if payload["instrument"]["symbol"] != symbol or payload["series"]["adjustment"] != "all":
                raise SystemExit(f"FAIL: {symbol} metadata mismatch")
            summaries.append({"symbol": symbol, "bars_compared": len(actual), "first": str(actual[0][0]),
                              "last": str(actual[-1][0]), "close": actual[-1][4],
                              "api_ms": round((perf_counter()-started)*1000), "result": "PASS"})
    print(json.dumps({"checked_at": datetime.now().isoformat(), "verification": summaries}, indent=2))


if __name__ == "__main__":
    main()
