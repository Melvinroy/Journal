from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any, Callable, Sequence

import httpx

from brontide_eod.models import DailyBar, Instrument, MarketSession


class AlpacaProvider:
    """Alpaca historical SIP adapter; credentials never cross the local API boundary."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        timeout_seconds: float = 45,
        trading_base_url: str = "https://api.alpaca.markets",
        before_request: Callable[[], None] | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        if not api_key or not api_secret:
            raise ValueError("Alpaca credentials are required")
        self._owns_client = client is None
        self._trading_base_url = trading_base_url.rstrip("/")
        self._before_request = before_request
        self._client = client or httpx.Client(
            timeout=timeout_seconds,
            headers={
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": api_secret,
                "User-Agent": "brontide-eod/0.1",
            },
        )

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "AlpacaProvider":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _get(self, url: str, *, params: dict[str, Any]) -> httpx.Response:
        if self._before_request:
            self._before_request()
        return self._client.get(url, params=params)

    def health(self) -> dict[str, str | bool]:
        response = self._get(
            "https://data.alpaca.markets/v2/stocks/AAPL/bars",
            params={
                "timeframe": "1Day",
                "start": "2024-01-02",
                "end": "2024-01-04",
                "feed": "sip",
                "adjustment": "all",
                "limit": 2,
            },
        )
        response.raise_for_status()
        payload = response.json()
        return {"ok": bool(payload.get("bars")), "provider": "alpaca", "feed": "sip"}

    def list_instruments(self, *, status: str = "active") -> list[Instrument]:
        response = self._get(
            f"{self._trading_base_url}/v2/assets",
            params={"status": status, "asset_class": "us_equity"},
        )
        response.raise_for_status()
        return [self._parse_instrument(row) for row in response.json()]

    def get_market_calendar(self, start: date, end: date) -> list[MarketSession]:
        response = self._get(
            f"{self._trading_base_url}/v2/calendar",
            params={"start": start.isoformat(), "end": end.isoformat()},
        )
        response.raise_for_status()
        return [self._parse_market_session(row) for row in response.json()]

    def get_daily_bars(
        self,
        symbols: Sequence[str],
        start: date,
        end: date,
    ) -> list[DailyBar]:
        if not symbols:
            return []
        # Alpaca treats a date-only end value as a boundary that can include the
        # following/current session.  That triggers the free-plan 15-minute SIP
        # restriction while the U.S. market is open.  Use an explicit inclusive
        # timestamp on the requested final session instead.
        start_timestamp = datetime.combine(start, time.min, tzinfo=timezone.utc)
        end_timestamp = datetime.combine(end, time(23, 59, 59), tzinfo=timezone.utc)
        params: dict[str, Any] = {
            "symbols": ",".join(symbols),
            "timeframe": "1Day",
            "start": start_timestamp.isoformat().replace("+00:00", "Z"),
            "end": end_timestamp.isoformat().replace("+00:00", "Z"),
            "feed": "sip",
            "adjustment": "all",
            "asof": "-",
            "limit": 10_000,
            "sort": "asc",
        }
        rows: list[DailyBar] = []
        while True:
            response = self._get("https://data.alpaca.markets/v2/stocks/bars", params=params)
            response.raise_for_status()
            payload = response.json()
            for symbol, bars in payload.get("bars", {}).items():
                rows.extend(self._parse_bar(symbol, bar) for bar in bars)
            token = payload.get("next_page_token")
            if not token:
                break
            params["page_token"] = token
        return rows

    @staticmethod
    def _parse_instrument(row: dict[str, Any]) -> Instrument:
        return Instrument(
            symbol=str(row["symbol"]).upper(),
            name=str(row.get("name") or row["symbol"]),
            exchange=str(row.get("exchange") or "UNKNOWN"),
            asset_class=str(row.get("class") or "us_equity"),
            status=str(row.get("status") or "unknown"),
            tradable=bool(row.get("tradable")),
            fractionable=bool(row.get("fractionable")),
            provider_id=str(row.get("id") or row["symbol"]),
        )

    @staticmethod
    def _parse_bar(symbol: str, row: dict[str, Any]) -> DailyBar:
        timestamp = datetime.fromisoformat(str(row["t"]).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return DailyBar(
            symbol=symbol.upper(),
            session_date=timestamp.date(),
            open=float(row["o"]),
            high=float(row["h"]),
            low=float(row["l"]),
            close=float(row["c"]),
            volume=int(row["v"]),
            trade_count=int(row["n"]) if row.get("n") is not None else None,
            vwap=float(row["vw"]) if row.get("vw") is not None else None,
            source_timestamp=timestamp,
        )

    @staticmethod
    def _parse_market_session(row: dict[str, Any]) -> MarketSession:
        return MarketSession(
            session_date=date.fromisoformat(str(row["date"])),
            open_time=time.fromisoformat(str(row["open"])),
            close_time=time.fromisoformat(str(row["close"])),
            session_open=str(row["session_open"]) if row.get("session_open") is not None else None,
            session_close=str(row["session_close"]) if row.get("session_close") is not None else None,
            settlement_date=(
                date.fromisoformat(str(row["settlement_date"]))
                if row.get("settlement_date") is not None
                else None
            ),
        )
