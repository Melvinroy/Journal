"""Conservative daily-bar simulation; no claim of intraday path knowledge."""
from __future__ import annotations
from math import isfinite
from brontide_eod.scan_engine import Definition, fingerprint


def backtest(signals: list[dict], bars_by_symbol: dict[str,list[dict]], sessions: list[str], definition: Definition,
             cost_bps: float = 10, slippage_bps: float = 0) -> dict:
    if not all(isfinite(x) and x >= 0 for x in (cost_bps,slippage_bps)):
        raise ValueError("Costs/slippage must be finite and nonnegative")
    ledger = []
    calendar = {day:i for i,day in enumerate(sessions)}
    prices = {symbol:{str(row["session_date"]):row for row in rows} for symbol,rows in bars_by_symbol.items()}
    for signal in sorted(signals,key=lambda row:(row["setup_date"],row["symbol"],row["event_id"])):
        record = {key:signal[key] for key in ("signal_id","symbol","ep_date","setup_date","trigger_date","strategy_id")}
        record.update(trade_id=fingerprint([signal["signal_id"],cost_bps,slippage_bps,definition.manifest()["fingerprint"]]),
                      entry_date=None,entry=None,stop=None,exit_date=None,exit=None,outcome_r=None,outcome_percent=None,mfe_r=None,mae_r=None,
                      setup_atr=signal["measurements"].get("atr14"),status="Not entered",exit_reason="Next session unavailable",ambiguous=False)
        t=calendar[signal["setup_date"]]+1
        if t >= len(sessions):
            ledger.append(record); continue
        day=sessions[t]
        row=prices.get(signal["symbol"],{}).get(day)
        atr=record["setup_atr"]
        if row is None or atr is None or atr <= 0:
            record["exit_reason"]="Missing next-open bar or setup ATR"
            ledger.append(record); continue
        entry=row["open"]*(1+slippage_bps/10_000)
        stop,target=entry-atr,entry+definition.target_r*atr
        if stop <= 0:
            record["exit_reason"]="Non-positive protective stop"
            ledger.append(record); continue
        record.update(entry_date=day,entry=entry,stop=stop,target=target,status="Open",exit_reason="Incomplete holding period")
        favorable,adverse=entry,entry
        for j in range(t,min(len(sessions),t+definition.max_hold)):
            row=prices.get(signal["symbol"],{}).get(sessions[j])
            if row is None:
                record.update(status="Unresolved",exit_reason="Missing holding-period bar; no assumed liquidation")
                break
            price,reason=None,None
            if j>t and row["open"] <= stop:
                price,reason=row["open"],"Gap through stop"
            elif j>t and row["open"] >= target:
                price,reason=target,"Target (gap improvement not assumed)"
            elif row["low"] <= stop:
                price,reason=stop,"Stop"
                record["ambiguous"]=row["high"]>=target
            elif row["high"] >= target:
                price,reason=target,"Target"
            elif j==t+definition.max_hold-1:
                price,reason=row["close"],"Maximum hold"
            if price is not None:
                fill=price*(1-slippage_bps/10_000)
                fees=(entry+fill)*cost_bps/10_000
                net=fill-entry-fees
                # Only known pre-exit information: prior complete candles plus exit/open.
                favorable=max(favorable,row["open"],price)
                adverse=min(adverse,row["open"],price)
                record.update(status="Closed",exit_date=sessions[j],exit=fill,exit_reason=reason,
                              outcome_r=net/atr,outcome_percent=100*net/entry,fees_per_share=fees,hold_sessions=j-t+1)
                break
            favorable=max(favorable,row["high"])
            adverse=min(adverse,row["low"])
        record.update(mfe_r=(favorable-entry)/atr,mae_r=(adverse-entry)/atr)
        ledger.append(record)
    return {"trades":ledger,"summary":summarize(ledger),
            "execution":{"version":"daily-long-1.0","cost_bps_per_side":cost_bps,"slippage_bps_per_side":slippage_bps,
            "same_bar_policy":"stop first; ambiguous flag retained","excursions":"conservative: complete prior candles plus exit and opening prices",
            "capital":"independent positions; no capital or overlap constraints","drawdown":"closed-trade cumulative R, not mark-to-market portfolio drawdown"}}


def summarize(ledger):
    closed=sorted([row for row in ledger if row["status"]=="Closed"],key=lambda row:(row["exit_date"],row["trade_id"]))
    total,peak,drawdown=0.,0.,0.
    for row in closed:
        total+=row["outcome_r"];peak=max(peak,total);drawdown=max(drawdown,peak-total)
    return {"signals":len(ledger),"closed":len(closed),"winners":sum(row["outcome_r"]>0 for row in closed),
            "losers":sum(row["outcome_r"]<0 for row in closed),"breakeven":sum(row["outcome_r"]==0 for row in closed),
            "unresolved_or_open":sum(row["status"] in {"Open","Unresolved"} for row in ledger),
            "not_entered":sum(row["status"]=="Not entered" for row in ledger),"total_r":total,
            "expectancy_r":total/len(closed) if closed else None,"closed_trade_drawdown_r":drawdown,
            "win_rate":sum(row["outcome_r"]>0 for row in closed)/len(closed) if closed else None}
