from __future__ import annotations

from datetime import date, timedelta

import pytest

from brontide_eod.scanner import (
    ScannerMeasurement,
    apply_average_growth_ranks,
    calculate_symbol_measurement,
    filter_biggest_one_month,
    validate_scanner_thresholds,
)


def sessions() -> list[date]:
    return [date(2026, 8, 13) + timedelta(days=index) for index in range(22)]


def bars(days: list[date], *, start_close: float = 100, volume: int = 100_000):
    return {
        day: {"open": start_close + index, "high": (start_close + index) * 1.06,
              "low": start_close + index, "close": start_close + index, "volume": volume}
        for index, day in enumerate(days)
    }


def test_growth_uses_exact_twenty_one_session_offset_and_adr20():
    days = sessions()
    split = bars(days)
    raw = bars(days, volume=100_000)
    row, exclusion = calculate_symbol_measurement("AAA", days, raw, split)
    assert exclusion is None
    assert row is not None
    assert row.growth_percent == pytest.approx(21.0)
    assert row.adr_percent == pytest.approx(6.0)
    assert row.dollar_volume == 12_100_000


def test_missing_authoritative_session_is_not_compressed():
    days = sessions()
    split = bars(days)
    split.pop(days[10])
    row, exclusion = calculate_symbol_measurement("AAA", days, bars(days), split)
    assert row is None
    assert exclusion and exclusion.reason == "missing_history"


def test_invalid_zero_low_is_rejected():
    days = sessions()
    split = bars(days)
    split[days[-1]]["low"] = 0
    row, exclusion = calculate_symbol_measurement("AAA", days, bars(days), split)
    assert row is None
    assert exclusion and exclusion.reason == "invalid_values"


def measurement(symbol: str, growth: float, dollar: float = 10_000_001, adr: float = 5.01):
    return ScannerMeasurement(symbol, date(2026, 9, 11), dollar, growth, adr)


def test_average_tie_rank_and_insufficient_universe():
    ranked = apply_average_growth_ranks([measurement("A", 1), measurement("B", 1), measurement("C", 3)])
    assert [row.growth_rank for row in ranked] == [25.0, 25.0, 100.0]
    assert apply_average_growth_ranks([measurement("A", 1)])[0].growth_rank is None


def test_rank_is_calculated_before_liquidity_and_adr_filters():
    ranked = apply_average_growth_ranks([
        measurement("LOW", 1, dollar=1),
        measurement("MID", 2),
        measurement("HIGH", 3),
    ])
    results = filter_biggest_one_month(ranked, min_growth_rank=50)
    assert [row.symbol for row in results] == ["HIGH", "MID"]
    assert next(row for row in ranked if row.symbol == "MID").growth_rank == 50


def test_strict_thresholds_rank_boundary_and_stable_sort():
    rows = [
        ScannerMeasurement("B", date(2026, 9, 11), 9_000_001, 20, 5.01, 93.77),
        ScannerMeasurement("A", date(2026, 9, 11), 9_000_001, 20, 5.01, 93.77),
        ScannerMeasurement("DOLLAR_EQ", date(2026, 9, 11), 9_000_000, 99, 9, 100),
        ScannerMeasurement("ADR_EQ", date(2026, 9, 11), 99_000_000, 99, 5, 100),
    ]
    assert [row.symbol for row in filter_biggest_one_month(rows)] == ["A", "B"]


def test_non_finite_and_out_of_range_thresholds_are_rejected():
    for values in ((float("nan"), 5, 90), (1, -1, 90), (1, 5, 101)):
        try:
            validate_scanner_thresholds(*values)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid thresholds should fail")
