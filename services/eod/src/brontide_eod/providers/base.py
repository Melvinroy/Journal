from __future__ import annotations

from datetime import date
from typing import Protocol, Sequence

from brontide_eod.models import DailyBar, Instrument, MarketSession


class MarketDataProvider(Protocol):
    def list_instruments(self, *, status: str = "active") -> list[Instrument]: ...

    def get_daily_bars(
        self,
        symbols: Sequence[str],
        start: date,
        end: date,
    ) -> list[DailyBar]: ...

    def get_market_calendar(self, start: date, end: date) -> list[MarketSession]: ...

    def health(self) -> dict[str, str | bool]: ...
