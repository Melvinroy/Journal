"""Pure paper lifecycle calculations. No broker I/O or fabricated executions."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING
import math

from .ibkr_tws import PaperSafetyError


def positive(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise PaperSafetyError(f"{label} must be a finite positive number.")
    return float(value)


def validate_exit_plan(plan):
    if not isinstance(plan, dict) or plan.get("schemaVersion") != 1:
        raise PaperSafetyError("A versioned exit plan is required.")
    legs = plan.get("legs", [])
    if not 1 <= len(legs) <= 4 or len({leg.get('id') for leg in legs}) != len(legs):
        raise PaperSafetyError("One to four uniquely identified exit legs are required.")
    if sum(leg.get("role") == "Runner" for leg in legs) > 2:
        raise PaperSafetyError("At most two independent runners are supported.")
    if not 1 <= sum(leg.get("role") == "Target" for leg in legs) <= 2:
        raise PaperSafetyError("One or two targets are required.")
    for leg in legs:
        if not isinstance(leg.get("id"), str) or not leg["id"]:
            raise PaperSafetyError("Exit leg identity is required.")
        positive(leg.get("allocationPercent"), "Allocation")
        if leg.get("role") == "Target":
            target = leg.get("target", {})
            if target.get("mode") not in {"R", "Price"}:
                raise PaperSafetyError("Unknown target mode.")
            positive(target.get("multipleR" if target["mode"] == "R" else "price"), "Target")
        elif leg.get("role") == "Runner":
            positive(leg.get("activationR"), "Runner activation")
            rule = leg.get("trailing", {})
            mode = rule.get("mode")
            if mode == "SMA":
                if rule.get("period") not in {10, 20, 50}:
                    raise PaperSafetyError("SMA period must be 10, 20 or 50.")
            elif mode in {"Dollar", "Percentage", "Manual"}:
                value = positive(rule.get({"Dollar": "distance", "Percentage": "percent", "Manual": "stopPrice"}[mode]), "Runner value")
                if mode == "Percentage" and value >= 100:
                    raise PaperSafetyError("Trailing percent must be below 100.")
            elif mode != "Day extreme":
                raise PaperSafetyError("Unknown trailing mode.")
        else:
            raise PaperSafetyError("Unknown exit role.")
    if abs(sum(leg["allocationPercent"] for leg in legs) - 100) > 1e-9:
        raise PaperSafetyError("Exit allocations must sum to 100%.")
    be = plan.get("breakeven", {})
    positive(be.get("activationR"), "Breakeven activation")
    offset = be.get("favorableOffset", {})
    value = offset.get("value")
    if offset.get("unit") not in {"Dollar", "R"} or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise PaperSafetyError("Breakeven offset must be finite and non-negative.")
    return deepcopy(plan)


def allocations(quantity, plan):
    validate_exit_plan(plan)
    if not isinstance(quantity, int) or quantity < 1:
        raise PaperSafetyError("Allocation requires positive whole shares.")
    exact = [quantity * leg["allocationPercent"] / 100 for leg in plan["legs"]]
    counts = [math.floor(value) for value in exact]
    order = sorted(range(len(counts)), key=lambda i: (-(exact[i] - counts[i]), i))
    for i in order[:quantity - sum(counts)]: counts[i] += 1
    return [dict(leg, quantity=count) for leg, count in zip(plan["legs"], counts)]


def rounded_stop(value, tick, direction):
    positive(value, "Stop")
    positive(tick, "Minimum tick")
    rounding = ROUND_FLOOR if direction == "Long" else ROUND_CEILING
    return float((Decimal(str(value)) / Decimal(str(tick))).to_integral_value(rounding=rounding) * Decimal(str(tick)))


def next_stop(direction, entry, risk, current, quote, favorable, leg, breakeven, tick, references=None, activated=False):
    """Executable-side quote only; absent daily references never become zero prices."""
    sign = 1 if direction == "Long" else -1
    proposed = current
    progress = sign * (quote - entry) / risk
    if progress >= breakeven["activationR"]:
        offset = breakeven["favorableOffset"]
        value = offset["value"] * (risk if offset["unit"] == "R" else 1)
        proposed = max(proposed, entry + value) if sign == 1 else min(proposed, entry - value)
    if leg["role"] == "Runner" and (activated or progress >= leg["activationR"]):
        rule = leg["trailing"]
        mode = rule["mode"]
        reference = references or {}
        candidate = None
        if mode == "Dollar": candidate = favorable - sign * rule["distance"]
        elif mode == "Percentage": candidate = favorable * (1 - sign * rule["percent"] / 100)
        elif mode == "Manual": candidate = rule["stopPrice"]
        elif mode == "SMA": candidate = reference.get(f"SMA{rule['period']}")
        elif mode == "Day extreme": candidate = reference.get("low" if sign == 1 else "high")
        if candidate is not None:
            positive(candidate, "Trailing reference")
            proposed = max(proposed, candidate) if sign == 1 else min(proposed, candidate)
    proposed = rounded_stop(proposed, tick, direction)
    if (sign == 1 and not current < proposed < quote) or (sign == -1 and not quote < proposed < current):
        return None
    return proposed


def summarize(campaign):
    executions = campaign.get("executions", [])
    entries = [e for e in executions if e["effect"] == "entry"]
    exits = [e for e in executions if e["effect"] == "exit"]
    entered = sum(e["quantity"] for e in entries)
    exited = sum(e["quantity"] for e in exits)
    avg = sum(e["price"] * e["quantity"] for e in entries) / entered if entered else None
    sign = 1 if campaign["ticket"]["direction"] == "Long" else -1
    gross = sum(sign * (e["price"] - avg) * e["quantity"] for e in exits) if avg is not None else None
    costs_complete = bool(executions) and all(e.get("commission") is not None for e in executions)
    fees = sum(e.get("commission") or 0 for e in executions)
    net = gross - fees if gross is not None and costs_complete else None
    initial_risk = entered * abs(avg - campaign["ticket"]["stopPrice"]) if avg is not None else None
    return {"entered": entered, "exited": exited, "openQuantity": entered - exited,
            "averageEntry": avg, "grossRealized": gross, "fees": fees if costs_complete else None,
            "netRealized": net, "costsComplete": costs_complete, "initialRisk": initial_risk,
            "finalNetR": net / initial_risk if entered == exited and initial_risk and net is not None else None}
