"""Immutable planner evidence, separate from server-validated execution bounds."""
import math
from datetime import datetime

from .ibkr_tws import PaperSafetyError
from .paper_store import canonical


REQUIRED_FIELDS = {
    "schemaVersion", "planId", "planRevision", "symbol", "side", "entryPrice",
    "stopPrice", "stopSource", "atrMultiplier", "executionMethod", "executionQuantity", "hardCap",
    "capturedEntrySource", "marketSnapshot", "accountEquity", "sizingEquity", "sizingBasis",
    "riskPercent", "maxAllocationPercent", "result", "exitPlan", "sessionMode",
    "duration", "protectionOrderType", "sessionPolicy", "savedAt",
}


def _number(value, label, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise PaperSafetyError(f"Saved planner {label} is invalid.")
    if positive and value <= 0:
        raise PaperSafetyError(f"Saved planner {label} must be positive.")


def _timestamp(value, label):
    if not isinstance(value, str) or not value:
        raise PaperSafetyError(f"Saved planner {label} is missing.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise PaperSafetyError(f"Saved planner {label} is invalid.") from None
    if parsed.tzinfo is None:
        raise PaperSafetyError(f"Saved planner {label} must include a timezone.")


def _validate_exit_plan(value):
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise PaperSafetyError("Saved planner exit rules are incomplete.")
    legs = value.get("legs")
    if not isinstance(legs, list) or not 1 <= len(legs) <= 4:
        raise PaperSafetyError("Saved planner targets and runners are incomplete.")
    if any(not isinstance(leg, dict) or leg.get("role") not in {"Target", "Runner"}
           or not isinstance(leg.get("id"), str) for leg in legs):
        raise PaperSafetyError("Saved planner target or runner is invalid.")
    if not isinstance(value.get("breakeven"), dict):
        raise PaperSafetyError("Saved planner breakeven rule is missing.")


def validate_saved_plan(ticket):
    saved = ticket.get("savedPlan")
    if not isinstance(saved, dict) or saved.get("schemaVersion") != 2:
        raise PaperSafetyError("Save a complete new planner revision before reviewing an order.")
    if len(canonical(saved).encode()) > 65536:
        raise PaperSafetyError("Saved planner evidence exceeds the supported size.")
    missing = REQUIRED_FIELDS.difference(saved)
    if missing:
        raise PaperSafetyError("Saved planner evidence is incomplete; save a new revision.")
    matches = {"planId": "planId", "planRevision": "planRevision", "symbol": "symbol",
               "side": "direction", "entryPrice": "planningPrice", "stopPrice": "stopPrice",
               "executionMethod": "method", "sessionMode": "sessionMode", "duration": "duration",
               "protectionOrderType": "protectionOrderType", "exitPlan": "exitPlan"}
    if any(saved.get(field) != ticket.get(bound) for field, bound in matches.items()):
        raise PaperSafetyError("Saved planner evidence differs from the execution ticket. Save again.")
    if saved.get("stopPrice") != ticket.get("cleanupFloor"):
        raise PaperSafetyError("Saved planner evidence differs from the execution ticket. Save again.")
    source = saved.get("capturedEntrySource")
    if not isinstance(source, dict) or source.get("source") != ticket.get("planningSource"):
        raise PaperSafetyError("Saved pricing provenance differs from the execution ticket.")
    _timestamp(source.get("observedAt"), "pricing observation time")
    result = saved.get("result")
    quantity = saved.get("executionQuantity") or (result.get("shares") if isinstance(result, dict) else None)
    if quantity != ticket.get("quantity") or (saved.get("hardCap") or saved["entryPrice"]) != ticket.get("hardCap"):
        raise PaperSafetyError("Saved quantity or price cap differs from the execution ticket.")
    for key in ("triggerPrice", "protectionLimitPrice"):
        if key in ticket and saved.get(key) != ticket[key]:
            raise PaperSafetyError("Saved conditional order price differs from the execution ticket.")
    generated = saved.get("origin") == "acceptance generator"
    for field in ("entryPrice", "stopPrice", "hardCap"):
        _number(saved[field], field, positive=True)
    _number(saved["executionQuantity"], "executionQuantity", positive=True)
    if not isinstance(saved["executionQuantity"], int):
        raise PaperSafetyError("Saved planner executionQuantity must be a whole number.")
    if not generated:
        for field in ("accountEquity", "sizingEquity", "riskPercent", "maxAllocationPercent"):
            _number(saved[field], field, positive=True)
    if saved.get("stopSource") not in {"ATR", "LoD", "HoD", "Manual"}:
        raise PaperSafetyError("Saved planner stop method is invalid.")
    basis = saved.get("sizingBasis")
    allowed_basis = {"Fresh broker equity", "Stale broker estimate", "Legacy planning equity"} | ({"Acceptance fixture"} if generated else set())
    if not isinstance(basis, dict) or basis.get("source") not in allowed_basis \
            or basis.get("currency") != "USD" or basis.get("value") != saved.get("sizingEquity"):
        raise PaperSafetyError("Saved planner sizing basis is incomplete.")
    if basis["source"] in {"Fresh broker equity", "Stale broker estimate"}:
        _timestamp(basis.get("observedAt"), "broker-equity observation time")
    if not isinstance(result, dict) or result.get("valid") is not True:
        raise PaperSafetyError("Saved planner sizing result is incomplete.")
    if not isinstance(saved.get("sessionPolicy"), dict):
        raise PaperSafetyError("Saved planner session policy is incomplete.")
    _validate_exit_plan(saved.get("exitPlan"))
    _timestamp(saved.get("savedAt"), "save time")


def generated_plan(ticket, at):
    """Explicitly label machine-generated acceptance records; never invent UI inputs."""
    return {"schemaVersion": 2, "origin": "acceptance generator", "planId": ticket["planId"],
            "planRevision": ticket["planRevision"], "symbol": ticket["symbol"], "side": ticket["direction"],
            "entryPrice": ticket["planningPrice"], "stopPrice": ticket["stopPrice"], "stopSource": "Manual",
            "atrMultiplier": 0, "marketSnapshot": None,
            "executionMethod": ticket["method"], "executionQuantity": ticket["quantity"], "hardCap": ticket["hardCap"],
            "sessionMode": ticket["sessionMode"], "duration": ticket["duration"], "protectionOrderType": ticket["protectionOrderType"],
            "exitPlan": ticket["exitPlan"], "savedAt": at, "accountEquity": None, "sizingEquity": None,
            "sizingBasis": {"source": "Acceptance fixture", "currency": "USD", "value": None},
            "riskPercent": None, "maxAllocationPercent": None, "result": {"valid": True, "shares": ticket["quantity"]},
            "sessionPolicy": {"origin": "acceptance generator"},
            "capturedEntrySource": {"source": ticket["planningSource"], "observedAt": at},
            **{k: ticket[k] for k in ("triggerPrice", "protectionLimitPrice") if k in ticket}}
