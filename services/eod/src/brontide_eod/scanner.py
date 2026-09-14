from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import date
from typing import Iterable, Mapping, Sequence


BIGGEST_ONE_MONTH_FORMULA_VERSION = "biggest-one-month-v1"
DEFAULT_MIN_DOLLAR_VOLUME = 9_000_000.0
DEFAULT_MIN_ADR_PERCENT = 5.0
DEFAULT_MIN_GROWTH_RANK = 93.77


@dataclass(frozen=True)
class ScannerMeasurement:
    symbol: str
    session_date: date
    dollar_volume: float
    growth_percent: float
    adr_percent: float
    growth_rank: float | None = None

    def as_record(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ScannerExclusion:
    symbol: str
    reason: str
    detail: str


def _finite_positive(value: object) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value)) and float(value) > 0


def calculate_symbol_measurement(
    symbol: str,
    sessions: Sequence[date],
    raw_bars: Mapping[date, Mapping[str, object]],
    split_bars: Mapping[date, Mapping[str, object]],
) -> tuple[ScannerMeasurement | None, ScannerExclusion | None]:
    """Calculate the provisional 21-session growth and ADR20 definitions.

    `sessions` must contain the 22 consecutive authoritative sessions ending at
    the evaluation session. Missing rows are rejected rather than compressed.
    """
    if len(sessions) != 22:
        return None, ScannerExclusion(symbol, "missing_history", "22 authoritative sessions are required")
    target = sessions[-1]
    if any(day not in split_bars for day in sessions):
        return None, ScannerExclusion(symbol, "missing_history", "split series is missing an authoritative session")
    if target not in raw_bars:
        return None, ScannerExclusion(symbol, "missing_data", "raw series is missing the evaluation session")

    raw = raw_bars[target]
    start = split_bars[sessions[0]]
    end = split_bars[target]
    required = [raw.get("close"), raw.get("volume"), start.get("close"), end.get("close")]
    if not all(_finite_positive(value) for value in required):
        return None, ScannerExclusion(symbol, "invalid_values", "close and volume inputs must be finite and positive")

    adr_components: list[float] = []
    for day in sessions[-20:]:
        bar = split_bars[day]
        high, low = bar.get("high"), bar.get("low")
        if not _finite_positive(high) or not _finite_positive(low) or float(high) < float(low):
            return None, ScannerExclusion(symbol, "invalid_values", "ADR inputs must have finite positive high/low values")
        adr_components.append(float(high) / float(low) - 1.0)

    return ScannerMeasurement(
        symbol=symbol,
        session_date=target,
        dollar_volume=float(raw["close"]) * float(raw["volume"]),
        growth_percent=100.0 * (float(end["close"]) / float(start["close"]) - 1.0),
        adr_percent=100.0 * sum(adr_components) / len(adr_components),
    ), None


def apply_average_growth_ranks(
    measurements: Iterable[ScannerMeasurement],
) -> list[ScannerMeasurement]:
    rows = list(measurements)
    if len(rows) < 2:
        return [ScannerMeasurement(**{**row.as_record(), "growth_rank": None}) for row in rows]
    ordered = sorted(enumerate(rows), key=lambda item: (item[1].growth_percent, item[1].symbol))
    ranks: dict[int, float] = {}
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        value = ordered[cursor][1].growth_percent
        while end < len(ordered) and ordered[end][1].growth_percent == value:
            end += 1
        average_rank = ((cursor + 1) + end) / 2.0
        percentile = 100.0 * (average_rank - 1.0) / (len(rows) - 1.0)
        for offset in range(cursor, end):
            ranks[ordered[offset][0]] = percentile
        cursor = end
    return [ScannerMeasurement(**{**row.as_record(), "growth_rank": ranks[index]}) for index, row in enumerate(rows)]


def filter_biggest_one_month(
    measurements: Iterable[ScannerMeasurement],
    *,
    min_dollar_volume: float = DEFAULT_MIN_DOLLAR_VOLUME,
    min_adr_percent: float = DEFAULT_MIN_ADR_PERCENT,
    min_growth_rank: float = DEFAULT_MIN_GROWTH_RANK,
) -> list[ScannerMeasurement]:
    rows = [
        row
        for row in measurements
        if row.growth_rank is not None
        and row.dollar_volume > min_dollar_volume
        and row.adr_percent > min_adr_percent
        and row.growth_rank >= min_growth_rank
    ]
    return sorted(rows, key=lambda row: (-row.growth_percent, row.symbol))


def validate_scanner_thresholds(
    min_dollar_volume: float,
    min_adr_percent: float,
    min_growth_rank: float,
) -> None:
    values = (min_dollar_volume, min_adr_percent, min_growth_rank)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Scanner thresholds must be finite")
    if min_dollar_volume < 0 or min_dollar_volume > 10_000_000_000_000:
        raise ValueError("min_dollar_volume must be between 0 and 10 trillion")
    if min_adr_percent < 0 or min_adr_percent > 1_000:
        raise ValueError("min_adr_percent must be between 0 and 1000")
    if min_growth_rank < 0 or min_growth_rank > 100:
        raise ValueError("min_growth_rank must be between 0 and 100")
