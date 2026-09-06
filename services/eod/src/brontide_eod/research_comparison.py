"""Explain engine differences without treating unknown outcomes as agreement."""
from math import isclose
from brontide_eod.research_analytics import analytics


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return isclose(a, b, rel_tol=1e-10, abs_tol=1e-10)
    return a == b


def key(row): return (row.get("strategy_id", "EP-2x-rvol95"), row["symbol"], row["setup_date"])


def compare_results(current, lean):
    differences, matched = [], []
    def difference(category, identity, field, a, b, explanation):
        differences.append({"category": category, "identity": identity, "field": field,
                            "current": a, "lean": b, "explanation": explanation})
    cs, ls = {key(s): s for s in current["signals"]}, {key(s): s for s in lean["signals"]}
    for k in sorted(cs.keys() | ls.keys()):
        identity = " / ".join(k)
        if k not in cs or k not in ls:
            difference("signal logic", identity, "signal", k in cs, k in ls, "Independent signal detection disagrees; inspect source conditions before accepting parity.")
            continue
        for field, a, b in [("ep_date", cs[k].get("ep_date"), ls[k].get("ep_date")),
                            ("setup_atr", cs[k].get("measurements", {}).get("atr14"), ls[k].get("atr"))]:
            if not same(a, b): difference("signal logic", identity, field, a, b, "Independent feature or episode calculation differs.")
    ct, lt = {key(t): t for t in current["trades"]}, {key(t): t for t in lean["trades"]}
    for k in sorted(ct.keys() | lt.keys()):
        identity = " / ".join(k)
        if k not in ct or k not in lt:
            difference("trade accounting", identity, "trade", k in ct, k in lt, "Trade exists in only one engine ledger.")
            continue
        a, b = ct[k], lt[k]
        matched.append({"identity": identity, "current": a, "lean": b})
        for field in ("status", "entry_date", "exit_date", "entry", "exit", "stop", "target", "exit_reason", "hold_sessions", "setup_atr", "outcome_r", "fees_per_share", "ambiguous", "mfe_r", "mae_r"):
            x, y = a.get(field), b.get(field)
            if same(x, y): continue
            category, explanation = "unresolved", "Unexpected difference; requires investigation."
            if field in ("ambiguous", "mfe_r", "mae_r") and y is None:
                category, explanation = "trade accounting", "Native adapter does not record this conservative path statistic; unavailable is not zero."
            elif field == "fees_per_share":
                category, explanation = "costs", "Current engine charges actual fill price; native fees use contemporaneous security price."
            elif field in ("exit_date", "hold_sessions") and a.get("exit_reason") == "Maximum hold":
                category, explanation = "execution", "Current engine exits at session-60 close; native market orders submitted after that close can fill next open."
            elif field in ("entry", "exit", "stop", "target") and isinstance(x, (int, float)) and isinstance(y, (int, float)) and abs(x-y) <= .005000001:
                category, explanation = "execution", "Native cent tick rounding versus unrounded research prices."
            elif field == "exit_reason" and str(x).lower().startswith("gap"):
                category, explanation = "execution", "Native order type and research gap labels use different terminology."
            elif field == "outcome_r" and a.get("setup_atr") and same(a.get("setup_atr"), b.get("setup_atr")) and all(t.get(f) is not None for t in (a,b) for f in ("entry","exit","fees_per_share")):
                delta = ((b["exit"]-a["exit"])-(b["entry"]-a["entry"])-(b["fees_per_share"]-a["fees_per_share"]))/b["setup_atr"]
                if same(y-x, delta): category, explanation = "execution", "Net-R difference reconciles exactly to the recorded entry, exit and fee differences."
            difference(category, identity, field, x, y, explanation)
    ca, la = analytics(current), analytics(lean)
    metric_differences = [{"metric": k, "current": v, "lean": la["values"].get(k),
                           "category": "statistics definition" if v is None or la["values"].get(k) is None else "trade accounting",
                           "explanation": ca["unavailable"].get(k) or la["unavailable"].get(k) or "Shared formula applied to each engine's complete ledger; trade outcomes differ."}
                          for k, v in ca["values"].items() if not same(v, la["values"].get(k))]
    return {"version": 1, "scope": "Whole pilot; all matching records before pagination", "signal_counts": {"current": len(cs), "lean": len(ls), "matched": len(cs.keys() & ls.keys())},
            "matched_trades": matched, "differences": differences, "metric_differences": metric_differences,
            "unresolved_count": sum(d["category"] == "unresolved" for d in differences),
            "analytics": {"current": ca, "lean": la},
            "native_statistics_notes": ["Shared analytics keep breakeven separate. LEAN TradeStatistics counts zero P/L as a loss.",
                "Shared profit factor is unavailable without losses. Native LEAN can return a sentinel of 10 when profits exist without losses.",
                "Native closed-trade drawdown is signed negative; the shared catalog displays a positive magnitude.",
                "Trade Sharpe/Sortino and one-share replay statistics are not funded-portfolio returns."]}
