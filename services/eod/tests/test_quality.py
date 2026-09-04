from datetime import date, datetime, timezone

from brontide_eod.models import DailyBar
from brontide_eod.quality import validate_bars


def bar(**overrides: object) -> DailyBar:
    values = {
        "symbol": "AAPL",
        "session_date": date(2026, 9, 3),
        "open": 100.0,
        "high": 105.0,
        "low": 99.0,
        "close": 103.0,
        "volume": 10_000,
        "trade_count": 100,
        "vwap": 102.0,
        "source_timestamp": datetime(2026, 9, 3, tzinfo=timezone.utc),
    }
    values.update(overrides)
    return DailyBar(**values)  # type: ignore[arg-type]


def test_valid_bar_has_no_issues() -> None:
    assert validate_bars([bar()], date(2026, 9, 3)) == []


def test_invalid_bar_is_rejected_with_specific_issue() -> None:
    issues = validate_bars([bar(high=98.0)], date(2026, 9, 3))
    assert [issue.code for issue in issues] == ["invalid_ohlc"]
