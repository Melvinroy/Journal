"""Versioned EP hypotheses. These are not labelled legacy reproductions."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
import json
from math import isfinite

from brontide_eod.features import ratio


def fingerprint(value) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str).encode()).hexdigest()


@dataclass(frozen=True)
class Definition:
    id: str
    ep_multiple: float
    setup_rvol: float
    distribution_drop_percent: float
    ep_average: str = "inclusive"
    min_age: int = 3
    max_age: int = 15
    target_r: float = 10
    max_hold: int = 60
    version: str = "research-hypothesis-1.0"
    distribution_atr: float | None = None
    supersede_on_new_ep: bool = False

    def __post_init__(self):
        if self.distribution_atr is not None and (not isfinite(self.distribution_atr) or self.distribution_atr<=0):
            raise ValueError("Positive ATR distribution threshold required")
        if self.ep_average not in {"inclusive", "prior"} or not 1 <= self.min_age <= self.max_age <= 60:
            raise ValueError("Invalid strategy window/average")
        if not all(isfinite(x) and x > 0 for x in (self.ep_multiple,self.setup_rvol,self.distribution_drop_percent,self.target_r)) or self.max_hold < 1:
            raise ValueError("Positive finite strategy parameters required")

    def manifest(self):
        return {**asdict(self), "fingerprint": fingerprint(asdict(self)), "evidence_status": "unvalidated_hypothesis",
                "legacy_reproduction": False, "distribution_rule": "previous_close - close >= distribution_atr * prior_ATR14 AND volume > previous_volume" if self.distribution_atr is not None else "return1 <= -drop_percent AND volume > previous_volume",
                "distribution_atr": self.distribution_atr,
                "event_overlap": "new EP supersedes previous episode" if self.supersede_on_new_ep else "independent EP events; first qualifying setup per event",
                "entry_policy": "next authoritative session open", "atr": "Wilder14; 14 valid prior-close true ranges seed; resets after missing session", "feature_price_basis": "declared by run",
                "fixed_rules":{"ep_return_percent_gte":4,"ep_volume_gte":8900000,"ep_volume_previous_ratio_gt":1,"price_gt":3,
                  "setup_stack":"close > SMA10 > SMA20","body_atr_lt":.25,"range_atr_lt":.75,"setup_ep_volume_percent_lt":50,
                  "post_ep_high_distance_atr_lte":1,"major_distribution_count_eq":0,"setup_rvol_denominator":"prior 20 authoritative sessions"}}


def definitions(drop_percent: float) -> list[Definition]:
    return [Definition(f"EP-{multiple}x-rvol{int(rvol*100)}", multiple, rvol, drop_percent,
                       distribution_atr=.75, supersede_on_new_ep=True, version="reconstructed-episode-1.0")
            for multiple, rvol in ((3,.75),(2,.75),(3,.95),(2,.95))]


def condition(name, value, op, threshold, unit=""):
    if value is None:
        status = "Missing"
    else:
        comparisons = {">=": lambda: value >= threshold, ">": lambda: value > threshold,
                       "<": lambda: value < threshold, "<=": lambda: value <= threshold, "==": lambda: value == threshold}
        status = "Pass" if comparisons[op]() else "Fail"
    return {"condition": name, "observed": value, "operator": op, "threshold": threshold, "unit": unit, "status": status}


def scan(symbol: str, rows: list[dict], definition: Definition, detail_from: str = "") -> dict:
    signals, evaluations = [], []
    strategy_fingerprint=definition.manifest()["fingerprint"]
    for e, event in enumerate(rows):
        if not event["available"]:
            continue
        ep_rvol = ratio(event["volume"], event.get("inclusive_adv20" if definition.ep_average == "inclusive" else "adv20"))
        ep_checks = [condition("EP return",event.get("return1"),">=",4,"%"),
                     condition("EP volume",event["volume"],">=",8_900_000,"shares"),
                     condition("EP RVOL",ep_rvol,">=",definition.ep_multiple,"x"),
                     condition("EP volume / previous",event.get("volume_previous_ratio"),">",1,"x"),
                     condition("EP price",event["close"],">",3,"USD")]
        if any(check["status"] != "Pass" for check in ep_checks):
            continue
        event_id = fingerprint([symbol,event["session_date"],strategy_fingerprint])
        high, distribution, gap = event["high"], [], False
        for t in range(e+1, min(len(rows), e+definition.max_age+1)):
            f = rows[t]
            current_rvol = ratio(f.get("volume"), f.get("inclusive_adv20" if definition.ep_average == "inclusive" else "adv20"))
            if definition.supersede_on_new_ep and f["available"] and f.get("return1") is not None and f["return1"]>=4 and f["volume"]>=8_900_000 and (current_rvol or 0)>=definition.ep_multiple and (f.get("volume_previous_ratio") or 0)>1 and f["close"]>3:
                break
            if not f["available"]:
                gap = True
            else:
                high = max(high, f["high"])
                prior_atr=rows[t-1].get("atr14")
                major = (f.get("previous_close") is not None and prior_atr is not None and f["previous_close"]-f["close"] >= definition.distribution_atr*prior_atr) if definition.distribution_atr is not None else (f.get("return1") is not None and f["return1"] <= -definition.distribution_drop_percent)
                if major and f["previous_volume"] is not None and f["volume"] > f["previous_volume"]:
                    distribution.append(f["session_date"])
            if t-e < definition.min_age:
                continue
            measurements = {**f, "ep_age":t-e,"ep_return":event["return1"],"ep_rvol":ep_rvol,
                            "post_ep_high":high,"distance_post_ep_high_atr":ratio(high-f["close"],f.get("atr14")) if f["available"] else None,
                            "setup_ep_volume_percent":100*f["volume"]/event["volume"] if f["available"] else None,
                            "distribution_count":len(distribution) if not gap else None}
            stack = (f["close"] > f["sma10"] > f["sma20"]) if f.get("sma10") is not None and f.get("sma20") is not None else None
            checks = ep_checks + [condition("EP age",t-e,">=",definition.min_age,"sessions"),condition("EP age upper limit",t-e,"<=",definition.max_age,"sessions"),
                condition("Complete post-EP history",not gap,"==",True),condition("Setup price",f.get("close"),">",3,"USD"),
                condition("Close > SMA10 > SMA20",stack,"==",True),condition("Body / ATR",f.get("body_atr"),"<",.25,"ATR"),
                condition("Range / ATR",f.get("range_atr"),"<",.75,"ATR"),condition("Setup RVOL",f.get("rvol"),"<",definition.setup_rvol,"x"),
                condition("Setup / EP volume",measurements["setup_ep_volume_percent"],"<",50,"%"),
                condition("Distribution count",measurements["distribution_count"],"==",0,"sessions"),
                condition("Distance from post-EP high",measurements["distance_post_ep_high_atr"],"<=",1,"ATR")]
            qualified = all(check["status"] == "Pass" for check in checks)
            record = {"signal_id":fingerprint([event_id,f["session_date"]]),"event_id":event_id,"symbol":symbol,
                      "strategy_id":definition.id,"strategy_fingerprint":strategy_fingerprint,
                      "ep_date":event["session_date"],"setup_date":f["session_date"],"trigger_date":f["session_date"],
                      "intended_entry_date":rows[t+1]["session_date"] if t+1<len(rows) else None,
                      "status":"Qualified" if qualified else "Expired" if t-e==definition.max_age else "Watching",
                      "measurements":measurements,"conditions":checks,"distribution_sessions":distribution.copy()}
            if f["session_date"] >= detail_from:
                evaluations.append(record)
            if qualified:
                signals.append(record)
                break
    return {"signals":signals,"evaluations":evaluations}
