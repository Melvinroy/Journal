from __future__ import annotations

from datetime import date
from typing import Protocol, Sequence

from brontide_eod.models import DailyBar, Instrument


class MarketDataProvider(Protocol):
    def list_instruments(self) -> list[Instrument]: ...

    def get_daily_bars(
        self,
        symbols: Sequence[str],
        start: date,
        end: date,
    ) -> list[DailyBar]: ...

    def health(self) -> dict[str, str | bool]: ...
