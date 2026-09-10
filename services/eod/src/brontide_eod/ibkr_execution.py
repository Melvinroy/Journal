"""Durable, fail-closed paper intent preparation for the owned TWS client."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from brontide_eod.ibkr_tws import PaperSafetyError, build_stock_contract_fields, validate_order_fields


def _positive(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PaperSafetyError(f"{label} must be positive.") from exc
    if result <= 0 or result != result or abs(result) == float("inf"):
        raise PaperSafetyError(f"{label} must be positive.")
    return result


def _whole(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise PaperSafetyError(f"{label} must be positive whole shares.")
    return value


def _tick(value: float, minimum_tick: float, label: str) -> float:
    if abs(value / minimum_tick - round(value / minimum_tick)) > 1e-7:
        raise PaperSafetyError(f"{label} does not conform to the broker minimum tick.")
    return value


def _new_york_zone(value: Any) -> ZoneInfo:
    name = str(value or "").strip()
    if name not in {"America/New_York", "US/Eastern", "EST5EDT"}:
        raise PaperSafetyError("The broker contract schedule is not identified as America/New_York.")
    return ZoneInfo("America/New_York")


def _broker_datetime(value: str, session_day: str, zone: ZoneInfo) -> datetime:
    text = value.strip()
    try:
        if ":" in text:
            return datetime.strptime(text, "%Y%m%d:%H%M").replace(tzinfo=zone)
        return datetime.strptime(f"{session_day}:{text}", "%Y%m%d:%H%M").replace(tzinfo=zone)
    except ValueError as exc:
        raise PaperSafetyError("The broker contract schedule contains an invalid time.") from exc


def _schedule_windows(value: Any, zone: ZoneInfo) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    for item in str(value or "").split(";"):
        if not item or ":" not in item:
            continue
        session_day, schedule = item.split(":", 1)
        if schedule == "CLOSED":
            continue
        for period in schedule.split(","):
            if "-" not in period:
                continue
            start, end = period.split("-", 1)
            start_at = _broker_datetime(start, session_day, zone)
            end_at = _broker_datetime(end, session_day, zone)
            if end_at <= start_at:
                end_at += timedelta(days=1)
            windows.append((start_at, end_at))
    return sorted(windows)


def broker_session_phase(instrument: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """Classify the current SMART stock session from broker-returned schedules.

    This is intentionally separate from order ``outsideRth`` flags: a total-hours
    window proves only schedule eligibility, not that the current instant is
    premarket, regular hours, or postmarket.
    """

    contract = instrument.get("contract") or instrument
    zone = _new_york_zone(contract.get("timeZoneId"))
    local_now = now.astimezone(zone)
    trading = _schedule_windows(contract.get("tradingHours"), zone)
    liquid = _schedule_windows(contract.get("liquidHours"), zone)
    total_window = next((window for window in trading if window[0] <= local_now < window[1]), None)
    liquid_window = next((window for window in liquid if window[0] <= local_now < window[1]), None)
    if liquid_window is not None:
        phase = "RTH"
        selected = liquid_window
    elif total_window is not None:
        same_day_liquid = next(
            (window for window in liquid if window[0].date() == local_now.date()),
            None,
        )
        if same_day_liquid is None:
            phase = "Extended"
        elif local_now < same_day_liquid[0]:
            phase = "Premarket"
        elif local_now >= same_day_liquid[1]:
            phase = "Postmarket"
        else:  # Defensive: a malformed overlapping schedule must not be guessed.
            phase = "Extended"
        selected = total_window
    else:
        phase = "Closed"
        selected = None
    return {
        "phase": phase,
        "observedAt": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "brokerTimeZone": "America/New_York",
        "windowStart": selected[0].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if selected else None,
        "windowEnd": selected[1].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if selected else None,
    }


def _effective_session(payload: Mapping[str, Any], instrument: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    mode = str(payload.get("sessionMode") or "Regular")
    duration = str(payload.get("duration") or "DAY")
    protection_type = str(payload.get("protectionOrderType") or "STP")
    if mode not in {"Regular", "RegularExtended", "Overnight", "OvernightDay"}:
        raise PaperSafetyError("Unsupported trading session.")
    if duration not in {"DAY", "GTC"} or (mode in {"Overnight", "OvernightDay"} and duration != "DAY"):
        raise PaperSafetyError("The selected duration is not valid for this trading session.")
    if mode == "OvernightDay":
        raise PaperSafetyError("Overnight + following day remains planning-only: installed TWS socket API 10.30.1 has no verified documented combined-route field; Web API OVT/OND values are not interchangeable.")
    if mode == "Overnight":
        raise PaperSafetyError("Overnight entry remains planning-only: the OVERNIGHT route supports limit entries, but supported broker-held initial stop protection has not been established.")
    contract = instrument.get("contract") or {}
    order_types = {str(value).upper() for value in contract.get("orderTypes") or []}
    valid_exchanges = {str(value).upper() for value in contract.get("validExchanges") or []}
    if "SMART" not in valid_exchanges:
        raise PaperSafetyError("SMART is not a valid route for the qualified contract.")
    method = str(payload.get("method") or "Normal")
    required_entry = "MIDPX" if method == "Normal" else "LMT" if method == "Limit" else "STPLMT"
    if required_entry not in order_types:
        raise PaperSafetyError("The qualified contract does not advertise the selected entry order type.")
    if mode == "RegularExtended" and method != "Limit":
        raise PaperSafetyError("Regular + extended hours requires an explicit limit entry; saved MIDPRICE or stop-limit entries are not converted.")
    if protection_type not in {"STP", "STP LMT"}:
        raise PaperSafetyError("Unsupported protection order type.")
    required_protection = "STP" if protection_type == "STP" else "STPLMT"
    if required_protection not in order_types:
        raise PaperSafetyError("The qualified contract does not advertise the selected protection order type.")
    if mode == "RegularExtended" and protection_type != "STP LMT":
        raise PaperSafetyError("Regular + extended hours requires explicit stop-limit protection; an ordinary stop is not silently replaced.")
    zone = _new_york_zone(contract.get("timeZoneId"))
    raw_schedule = contract.get("liquidHours") if mode == "Regular" else contract.get("tradingHours")
    windows = _schedule_windows(raw_schedule, zone)
    local_now = now.astimezone(zone)
    selected = next((window for window in windows if window[1] >= local_now), None)
    if selected is None:
        raise PaperSafetyError("The broker contract did not return a current or upcoming eligible session window.")
    start_at, end_at = selected
    return {
        "mode": mode,
        "duration": duration,
        "route": "SMART",
        "entryOrderType": "MIDPRICE" if method == "Normal" else "LMT" if method == "Limit" else "STP LMT",
        "outsideRth": mode == "RegularExtended",
        "protectionOrderType": protection_type,
        "protectionOutsideRth": mode == "RegularExtended",
        "effectiveCoverage": f"{start_at:%Y-%m-%d %H:%M}–{end_at:%H:%M} America/New_York",
        "expiresAt": end_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if duration == "DAY" else None,
        "expiryLabel": f"{end_at:%Y-%m-%d %H:%M} America/New_York" if duration == "DAY" else "Good until cancelled; active only during eligible broker sessions",
        "scheduleSource": "IBKR contract schedule",
        "brokerTimeZone": "America/New_York",
        "submissionEligible": True,
    }


def broker_trade_date(executed_at: str, session_mode: str) -> str:
    """Keep the immutable timestamp while deriving IBKR's overnight trade date separately."""
    value = datetime.fromisoformat(executed_at.replace("Z", "+00:00"))
    local = value.astimezone(ZoneInfo("America/New_York"))
    if session_mode in {"Overnight", "OvernightDay"} and local.hour >= 20:
        day = local.date() + timedelta(days=1)
        while day.weekday() >= 5:
            day += timedelta(days=1)
        return day.isoformat()
    return local.date().isoformat()


class PaperIntentStore:
    """Atomic private JSON store; values are never returned directly to the browser."""

    def __init__(self, path: Path | None = None) -> None:
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Brontide"
        self.path = path or Path(os.environ.get("BRONTIDE_IBKR_EXECUTION_STATE_FILE") or base / "paper-execution-intents.json")

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schemaVersion": 1, "records": []}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise PaperSafetyError("Private paper-intent state is unreadable; submission remains blocked.") from exc
        if value.get("schemaVersion") != 1 or not isinstance(value.get("records"), list):
            raise PaperSafetyError("Private paper-intent state requires reconciliation.")
        return value

    def upsert(self, record: Mapping[str, Any]) -> dict[str, Any]:
        state = self._read()
        existing = next((item for item in state["records"] if item.get("idempotencyKey") == record.get("idempotencyKey")), None)
        if existing:
            if existing.get("intentDigest") != record.get("intentDigest"):
                raise PaperSafetyError("This idempotency key already identifies a different economic action.")
            return deepcopy(existing)
        next_state = {"schemaVersion": 1, "records": [*state["records"], dict(record)]}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent, delete=False) as handle:
                json.dump(next_state, handle, separators=(",", ":"), sort_keys=True)
                handle.flush()
                temporary = Path(handle.name)
            temporary.replace(self.path)
            persisted = self._read()
            if not any(item.get("intentId") == record.get("intentId") for item in persisted["records"]):
                raise OSError("round-trip mismatch")
        except OSError as exc:
            raise PaperSafetyError("Paper intent could not be persisted; submission remains blocked.") from exc
        return deepcopy(dict(record))


def prepare_paper_intent(
    payload: Mapping[str, Any],
    *,
    account_id: str,
    account_binding: str,
    instrument: Mapping[str, Any],
    existing_symbols: set[str],
    store: PaperIntentStore,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    symbol = str(payload.get("symbol") or "").strip().upper()
    if symbol in existing_symbols:
        raise PaperSafetyError("This instrument has an existing broker position and is excluded from paper QC.")
    contract = build_stock_contract_fields(instrument["contract"])
    if contract["symbol"].upper() != symbol:
        raise PaperSafetyError("Qualified broker identity does not match the saved plan.")
    quote = instrument.get("quote") or {}
    if not instrument.get("executable") or quote.get("marketDataType") != 1:
        raise PaperSafetyError("A complete live broker bid/ask is required; delayed or frozen data is not executable.")
    observed = datetime.fromisoformat(str(instrument["observedAt"]).replace("Z", "+00:00"))
    if (now - observed).total_seconds() > 15 or observed > now:
        raise PaperSafetyError("Executable quote is stale; refresh before validating the intent.")
    direction = payload.get("direction")
    if direction not in {"Long", "Short"}:
        raise PaperSafetyError("Direction must be Long or Short.")
    bid, ask = _positive(quote.get("bid"), "Bid"), _positive(quote.get("ask"), "Ask")
    if bid > ask:
        raise PaperSafetyError("Broker quote is crossed.")
    planning_price = _positive(payload.get("planningPrice"), "Captured planning price")
    executable_quote = ask if direction == "Long" else bid
    drift = abs(executable_quote - planning_price) / planning_price * 100
    maximum_drift = _positive(payload.get("maximumPriceDriftPercent", 0.5), "Price drift limit")
    if drift > maximum_drift:
        raise PaperSafetyError(f"Price drift {drift:.2f}% exceeds the approved {maximum_drift:.2f}% limit.")
    quantity = _whole(payload.get("quantity"), "Order quantity")
    cap = _positive(payload.get("hardCap"), "Hard cap")
    stop = _positive(payload.get("stopPrice"), "Protection stop")
    minimum_tick = _positive(instrument["contract"].get("minimumTick"), "Minimum tick")
    _tick(cap, minimum_tick, "Hard cap")
    _tick(stop, minimum_tick, "Protection stop")
    if (direction == "Long" and ask > cap) or (direction == "Short" and bid < cap):
        raise PaperSafetyError("The refreshed executable quote crossed the saved hard cap.")
    if (direction == "Long" and stop >= cap) or (direction == "Short" and stop <= cap):
        raise PaperSafetyError("Protection stop is on the wrong side of the entry cap.")
    method = payload.get("method", "Normal")
    if method not in {"Normal", "Limit", "Breakout", "Opening"}:
        raise PaperSafetyError("Unsupported entry method.")
    if method == "Opening":
        raise PaperSafetyError("Opening-auction submission remains disabled; LMT plus OPG is construction-only.")
    session_policy = _effective_session(payload, instrument, now)
    action = "BUY" if direction == "Long" else "SELL"
    order_type = "MIDPRICE" if method == "Normal" else "LMT" if method == "Limit" else "STP LMT"
    trigger = None
    if method == "Breakout":
        trigger = _tick(_positive(payload.get("triggerPrice"), "Breakout trigger"), minimum_tick, "Breakout trigger")
        if (direction == "Long" and cap < trigger) or (direction == "Short" and cap > trigger):
            raise PaperSafetyError("A stop-limit worst price cannot cross inside its trigger.")
    protection_order_type = session_policy["protectionOrderType"]
    protection_limit = None
    if protection_order_type == "STP LMT":
        protection_limit = _tick(_positive(payload.get("protectionLimitPrice"), "Protection limit"), minimum_tick, "Protection limit")
        if (direction == "Long" and protection_limit > stop) or (direction == "Short" and protection_limit < stop):
            raise PaperSafetyError("Protection stop-limit price is on the wrong side of its trigger.")
    intent_id = str(payload.get("intentId") or "").strip()
    idempotency_key = str(payload.get("idempotencyKey") or "").strip()
    plan_id = str(payload.get("planId") or "").strip()
    campaign_id = str(payload.get("campaignId") or "").strip()
    if not all((intent_id, idempotency_key, plan_id, campaign_id)):
        raise PaperSafetyError("Intent, idempotency, plan and campaign identities are required.")
    contract = {**contract, "exchange": session_policy["route"], "primaryExchange": instrument["contract"].get("primaryExchange") or contract["exchange"]}
    package = {
        "contract": contract,
        "entry": validate_order_fields(account_id, {
            "account": account_id, "action": action, "totalQuantity": quantity,
            "orderType": order_type, "tif": session_policy["duration"], "lmtPrice": cap,
            **({"auxPrice": trigger} if trigger is not None else {}),
            "outsideRth": session_policy["outsideRth"], "transmit": False, "orderRef": idempotency_key,
        }),
        "protection": validate_order_fields(account_id, {
            "account": account_id, "action": "SELL" if action == "BUY" else "BUY",
            "totalQuantity": quantity, "orderType": protection_order_type, "tif": "GTC",
            "auxPrice": stop, **({"lmtPrice": protection_limit} if protection_limit is not None else {}),
            "outsideRth": session_policy["protectionOutsideRth"], "transmit": True,
            "parentRef": idempotency_key, "orderRef": f"{idempotency_key}:protection",
        }),
        "sessionPolicy": session_policy,
        "submissionPolicy": "paper-enabled",
    }
    digest_source = json.dumps({"plan": payload, "contract": contract, "accountBinding": account_binding}, sort_keys=True, separators=(",", ":"))
    from hashlib import sha256
    record = {
        "schemaVersion": 1, "intentId": intent_id, "idempotencyKey": idempotency_key,
        "planId": plan_id, "campaignId": campaign_id, "symbol": symbol,
        "status": "Validated intent", "createdAt": now.isoformat().replace("+00:00", "Z"),
        "quoteObservedAt": instrument["observedAt"], "quoteSide": "ask" if direction == "Long" else "bid",
        "executableQuote": executable_quote, "priceDriftPercent": drift,
        "accountBinding": account_binding, "intentDigest": sha256(digest_source.encode()).hexdigest(),
        "package": package, "sessionPolicy": deepcopy(session_policy), "exitPlanSnapshot": deepcopy(payload.get("exitPlan")),
        "audit": ["validated", "persisted-before-submission"],
    }
    stored = store.upsert(record)
    return {
        "intentId": stored["intentId"], "idempotencyKey": stored["idempotencyKey"],
        "status": stored["status"], "symbol": stored["symbol"],
        "quoteObservedAt": stored["quoteObservedAt"], "quoteSide": stored["quoteSide"],
        "executableQuote": stored["executableQuote"], "priceDriftPercent": stored["priceDriftPercent"],
        "contract": {**contract, "minimumTick": minimum_tick},
        "sessionPolicy": deepcopy(stored["sessionPolicy"]),
        "submissionsEnabled": False,
        "message": "Validated intent persisted privately before submission. Submission remains approval-locked.",
    }
