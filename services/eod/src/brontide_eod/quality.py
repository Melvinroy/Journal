from __future__ import annotations

from datetime import date

from brontide_eod.models import DailyBar, QualityIssue


def validate_bars(bars: list[DailyBar], expected_session: date | None = None) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    seen: set[tuple[str, date]] = set()
    for bar in bars:
        key = (bar.symbol, bar.session_date)
        if key in seen:
            issues.append(QualityIssue(bar.symbol, bar.session_date, "duplicate", "Duplicate symbol/session bar"))
        seen.add(key)
        if min(bar.open, bar.high, bar.low, bar.close) <= 0:
            issues.append(QualityIssue(bar.symbol, bar.session_date, "non_positive_price", "OHLC must be positive"))
        if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close) or bar.high < bar.low:
            issues.append(QualityIssue(bar.symbol, bar.session_date, "invalid_ohlc", "OHLC relationship is impossible"))
        if bar.volume < 0:
            issues.append(QualityIssue(bar.symbol, bar.session_date, "negative_volume", "Volume cannot be negative"))
        if expected_session and bar.session_date != expected_session:
            issues.append(QualityIssue(bar.symbol, bar.session_date, "wrong_session", f"Expected {expected_session}"))
    return issues
