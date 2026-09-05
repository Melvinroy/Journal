"""Causal EOD measurements. No provider calls, wall clock or storage writes."""
from __future__ import annotations

from collections import deque
from math import isfinite

FEATURE_VERSION = "eod-core-1.0"


def ratio(a, b):
    return a / b if a is not None and b is not None and b != 0 else None


def features(bars: list[dict], sessions: list[str], benchmark: dict[str, float] | None = None) -> list[dict]:
    """Align to authoritative sessions; a missing session invalidates its rolling windows.

    ATR restarts its 14-TR seed after a gap. No synthetic flat/zero-volume bars.
    Benchmark values are already-computed 20-session returns on the same price basis.
    """
    if sessions != sorted(set(sessions)):
        raise ValueError("Sessions must be unique and chronological")
    indexed = {}
    calendar_set = set(sessions)
    previous = ""
    for bar in bars:
        day = str(bar["session_date"])
        if day <= previous or day not in calendar_set:
            raise ValueError("Bars must be ordered, unique and inside the calendar")
        previous = day
        o, h, low, c, v = (float(bar[key]) for key in ("open", "high", "low", "close", "volume"))
        if not all(isfinite(x) for x in (o, h, low, c, v)) or min(o, low, c) <= 0 or h < max(o, low, c) or low > min(o, c) or v < 0:
            raise ValueError("Invalid OHLCV")
        indexed[day] = {**bar, "session_date": day}
    aligned = [indexed.get(day) for day in sessions]
    prefixes = {key: [0.0] for key in ("close", "volume", "dollar")}
    missing = [0]
    for row in aligned:
        missing.append(missing[-1] + (row is None))
        for key, sums in prefixes.items():
            value = (row["close"] * row["volume"] if key == "dollar" else row[key]) if row else 0
            sums.append(sums[-1] + value)

    def mean(key, end, size):
        start = end - size + 1
        if start < 0 or missing[end + 1] != missing[start]:
            return None
        return (prefixes[key][end + 1] - prefixes[key][start]) / size

    output = []
    true_ranges = deque(maxlen=14)
    rolling_high = deque()
    atr = None
    for i, day in enumerate(sessions):
        row = aligned[i]
        while rolling_high and rolling_high[0][0] <= i - 252:
            rolling_high.popleft()
        if row:
            while rolling_high and rolling_high[-1][1] <= row["high"]:
                rolling_high.pop()
            rolling_high.append((i, row["high"]))
        f = {"session_date": day, "available": row is not None}
        if not row:
            atr = None
            true_ranges.clear()
            output.append(f)
            continue
        f.update({key: row[key] for key in ("open", "high", "low", "close", "volume")})
        prev = aligned[i - 1] if i else None
        f.update(previous_close=prev["close"] if prev else None, previous_volume=prev["volume"] if prev else None)
        if prev:
            tr = max(row["high"] - row["low"], abs(row["high"] - prev["close"]), abs(row["low"] - prev["close"]))
            true_ranges.append(tr)
            atr = (13 * atr + tr) / 14 if atr is not None else sum(true_ranges) / 14 if len(true_ranges) == 14 else None
        else:
            atr = None
            true_ranges.clear()
        for size in (10, 20, 50, 200):
            f[f"sma{size}"] = mean("close", i, size)
        slope = ratio(f["sma20"], output[i-5].get("sma20") if i >= 5 else None)
        f["sma20_slope5"] = 100 * (slope - 1) if slope is not None else None
        for size in (1, 5, 20, 60):
            valid = i >= size and missing[i+1] == missing[i-size]
            f[f"return{size}"] = 100 * (row["close"] / aligned[i-size]["close"] - 1) if valid else None
        bench = (benchmark or {}).get(day)
        f["relative_spy20"] = f["return20"] - bench if f["return20"] is not None and bench is not None else None
        f["adv20"] = mean("volume", i-1, 20)
        f["inclusive_adv20"] = mean("volume", i, 20)
        f["dollar_volume20"] = mean("dollar", i-1, 20)
        f["rvol"] = ratio(row["volume"], f["adv20"])
        f["volume_previous_ratio"] = ratio(row["volume"], f["previous_volume"])
        f["volume_contraction3"] = ratio(mean("volume", i, 3), f["adv20"])
        f["atr14"] = atr
        f["atr_percent"] = 100 * atr / row["close"] if atr is not None else None
        f["body_atr"] = ratio(abs(row["close"] - row["open"]), atr)
        f["range_atr"] = ratio(row["high"] - row["low"], atr)
        recent = aligned[max(0, i-2):i+1]
        f["tightness3_atr"] = ratio(max(r["high"] for r in recent)-min(r["low"] for r in recent), atr) if len(recent) == 3 and all(recent) else None
        f["distance_sma20_atr"] = ratio(row["close"]-f["sma20"], atr) if f["sma20"] is not None else None
        f["distance_high252_percent"] = 100 * (row["close"]/rolling_high[0][1]-1) if i >= 251 and missing[i+1] == missing[i-251] else None
        f["close_location"] = ratio(row["close"]-row["low"], row["high"]-row["low"])
        output.append(f)
    return output
