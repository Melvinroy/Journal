from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    exchange: str
    asset_class: str
    status: str
    tradable: bool
    fractionable: bool
    provider_id: str
    source: str = "alpaca"

    def as_record(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class DailyBar:
    symbol: str
    session_date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    trade_count: int | None
    vwap: float | None
    source_timestamp: datetime
    timeframe: str = "1Day"
    adjustment: str = "all"
    source: str = "alpaca_sip"
    quality_status: str = "ready"
    schema_version: int = 1

    def as_record(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QualityIssue:
    symbol: str
    session_date: date
    code: str
    detail: str
