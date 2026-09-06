"""Versioned, read-only analytics over immutable research evidence.

The source run's summary and content hash are never changed. R statistics are
equal-risk trade observations, not currency-weighted account performance.
"""
import json
from math import isfinite
from pathlib import Path
from statistics import mean, median

CATALOG = json.loads(Path(__file__).with_name("research_metrics.json").read_text())
VERSION = CATALOG["version"]
METRICS = {m["id"]: m for m in CATALOG["metrics"]}


def numeric(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value)


def analytics(run, rows=None, scope="whole run"):
    ledger = run.get("trades", []) if rows is None else rows
    closed = sorted((r for r in ledger if str(r.get("status", "")).lower() == "closed" and numeric(r.get("outcome_r"))),
                    key=lambda r: (r.get("exit_date") or "", r.get("trade_id") or r.get("signal_id") or ""))
    outcomes = [r["outcome_r"] for r in closed]
    wins, losses = [x for x in outcomes if x > 0], [x for x in outcomes if x < 0]
    values = {m["id"]: None for m in CATALOG["metrics"] if m["scope"] == "run"}
    reasons = {k: "No applicable observations" for k in values}
    values.update(signals=len(ledger), entered=sum(r.get("entry_date") is not None for r in ledger),
                  closed=len(closed), winners=len(wins), losers=len(losses), breakeven=sum(x == 0 for x in outcomes),
                  open=sum(str(r.get("status", "")).lower() == "open" for r in ledger),
                  unresolved=sum(str(r.get("status", "")).lower() == "unresolved" for r in ledger),
                  not_entered=sum(str(r.get("status", "")).lower() == "not entered" for r in ledger),
                  ambiguous_count=sum(bool(r.get("ambiguous")) for r in ledger),
                  invalid_closed=sum(str(r.get("status", "")).lower() == "closed" and not numeric(r.get("outcome_r")) for r in ledger))
    if scope == "whole run":
        values["missing_symbols"] = run.get("manifest", {}).get("missing_symbols")
    else:
        reasons["missing_symbols"] = "Coverage belongs to the whole run, not a filtered trade cohort"
    if ledger and any(r.get("ambiguous") is None for r in ledger):
        values["ambiguous_count"] = None
        reasons["ambiguous_count"] = "Ambiguity flags are not recorded for every trade; absence is not evidence of no ambiguity"
    if outcomes:
        values.update(total_r=sum(outcomes), expectancy_r=mean(outcomes), median_r=median(outcomes),
                      win_rate=len(wins)/len(outcomes), best_r=max(outcomes), worst_r=min(outcomes),
                      top_five_winners_r=sum(sorted(wins, reverse=True)[:5]))
        values["average_win_r"] = mean(wins) if wins else None
        values["average_loss_r"] = mean(losses) if losses else None
        values["payoff_ratio"] = mean(wins)/abs(mean(losses)) if wins and losses else None
        values["profit_factor_r"] = sum(wins)/abs(sum(losses)) if losses else None
        if not losses:
            reasons["profit_factor_r"] = "No losing trades; denominator is zero"
        peak = cumulative = drawdown = 0.
        winning = losing = max_win = max_loss = 0
        for x in outcomes:
            cumulative += x
            peak = max(peak, cumulative)
            drawdown = max(drawdown, peak-cumulative)
            winning = winning+1 if x > 0 else 0
            losing = losing+1 if x < 0 else 0
            max_win, max_loss = max(max_win, winning), max(max_loss, losing)
        values.update(closed_trade_drawdown_r=drawdown, winning_streak=max_win, losing_streak=max_loss)
    for result, field in (("average_hold_sessions", "hold_sessions"), ("average_mfe_r", "mfe_r"), ("average_mae_r", "mae_r")):
        observed = [r[field] for r in closed if numeric(r.get(field))]
        values[result] = mean(observed) if observed else None
    for key in values:
        if METRICS[key]["availability"] == "requires_portfolio":
            reasons[key] = METRICS[key]["limitations"]
    distribution = [{"label": label, "count": sum(lo <= x < hi for x in outcomes)} for label, lo, hi in
                    (("Below −2R", -float("inf"), -2), ("−2 to −1R", -2, -1), ("−1 to 0R", -1, 0),
                     ("0 to 1R", 0, 1), ("1 to 3R", 1, 3), ("3 to 5R", 3, 5), ("5R and above", 5, float("inf")))]
    return {"version": VERSION, "scope": scope, "values": values,
            "unavailable": {k: reasons[k] for k, v in values.items() if v is None},
            "distribution": distribution, "closed_observations": len(closed),
            "ordering": "exit date, then stable trade ID; intraday order unknown; breakeven resets streaks",
            "basis": "Net R; independent positions. Not portfolio returns."}


def enrich_trades(run, source):
    """Only join the recorded scan. Never read contemporary market features."""
    signals = {r["signal_id"]: r for r in (source or {}).get("signals", [])}
    output = []
    for row in run.get("trades", []):
        signal = signals.get(row.get("signal_id"))
        valid = signal and signal.get("symbol") == row.get("symbol") and signal.get("setup_date") == row.get("setup_date") and signal.get("strategy_id") == row.get("strategy_id")
        output.append({**row, "measurements": signal.get("measurements", {}) if valid else {},
                       "conditions": signal.get("conditions", []) if valid else [],
                       "setup_evidence": "Recorded source scan" if valid else "Source scan unavailable or signal identity mismatch"})
    return output


def field_value(row, key):
    return row.get("measurements", {}).get(key[6:]) if key.startswith("setup.") else row.get(key)


def filter_sort(values, symbol="", session="", sort="setup_date", descending=False):
    selected = [r for r in values if (not session or r.get("setup_date") == session) and (not symbol.strip() or symbol.strip().upper() in r.get("symbol", ""))]
    selected.sort(key=lambda r: (r.get("symbol", ""), r.get("trade_id") or r.get("signal_id") or ""))
    present = [r for r in selected if field_value(r, sort) is not None]
    missing = [r for r in selected if field_value(r, sort) is None]
    present.sort(key=lambda r: field_value(r, sort), reverse=descending)
    return present + missing
