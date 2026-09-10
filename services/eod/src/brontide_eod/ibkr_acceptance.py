"""Immutable paper-acceptance manifests, read-only preflight, and masked evidence.

This module never submits, changes, or cancels an order. It extends the existing
read-only HTTP adapter and paper-intent validator; it is not an execution path.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from brontide_eod.ibkr_execution import PaperIntentStore, broker_session_phase, prepare_paper_intent
from brontide_eod.ibkr_tws import PaperSafetyError


EVENT_KINDS = {
    "submission-requested", "broker-acknowledged", "entry-fill", "entry-final",
    "protection-acknowledged", "protection-rejected", "target-fill", "runner-fill",
    "stop-fill", "breakeven-requested", "breakeven-acknowledged",
    "runner-update-requested", "runner-update-acknowledged", "amendment-requested",
    "amendment-acknowledged", "cleanup-requested", "cleanup-fill",
    "cancellation-requested", "cancellation-confirmed", "submission-unknown",
    "reconciliation-order-found", "reconciliation-no-order", "connection-lost",
    "connection-restored", "fee", "session-expired",
}
ACTUAL_PROVENANCE = {"IBKR callback", "IBKR read-only reconciliation", "TWS operator observation"}


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def ticket_digest(batch: Mapping[str, Any]) -> str:
    """Digest every approval-bearing field in one batch."""

    return sha256(_canonical(batch)).hexdigest()


def load_acceptance_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise PaperSafetyError("The acceptance manifest is unreadable.") from exc
    if value.get("schemaVersion") != 1 or not isinstance(value.get("batches"), list):
        raise PaperSafetyError("The acceptance manifest schema is unsupported.")
    identifiers: set[str] = set()
    for batch in value["batches"]:
        identifier = str(batch.get("batchId") or "").strip()
        if not identifier or identifier in identifiers:
            raise PaperSafetyError("Acceptance batches require unique identifiers.")
        identifiers.add(identifier)
        if batch.get("status") not in {"executable", "pending-session", "blocked"}:
            raise PaperSafetyError(f"Batch {identifier} has an invalid status.")
        tickets = batch.get("tickets")
        if not isinstance(tickets, list):
            raise PaperSafetyError(f"Batch {identifier} requires a ticket list.")
        ticket_ids: set[str] = set()
        for ticket in tickets:
            ticket_id = str(ticket.get("ticketId") or "").strip()
            if not ticket_id or ticket_id in ticket_ids:
                raise PaperSafetyError(f"Batch {identifier} requires unique ticket identifiers.")
            ticket_ids.add(ticket_id)
            if ticket.get("status") == "executable":
                _validate_executable_ticket(ticket)
        executable = [ticket for ticket in tickets if ticket.get("status") == "executable"]
        limits = value.get("limits") or {}
        if len(executable) > int(limits.get("maximumConcurrentCampaigns") or 0):
            raise PaperSafetyError(f"Batch {identifier} exceeds the campaign-count limit.")
        if sum(float(ticket.get("maximumNotional") or 0) for ticket in executable) > float(limits.get("maximumSimultaneousEntryNotional") or 0):
            raise PaperSafetyError(f"Batch {identifier} exceeds the entry-exposure limit.")
        if any(float(ticket.get("plannedRisk") or 0) > float(limits.get("maximumPlannedRiskPerCampaign") or 0) for ticket in executable):
            raise PaperSafetyError(f"Batch {identifier} exceeds the per-campaign risk limit.")
        if sum(float(ticket.get("plannedRisk") or 0) for ticket in executable) > float(limits.get("maximumCombinedPlannedRisk") or 0):
            raise PaperSafetyError(f"Batch {identifier} exceeds the combined risk limit.")
    return value


def select_batch(manifest: Mapping[str, Any], batch_id: str) -> dict[str, Any]:
    matches = [item for item in manifest.get("batches", []) if item.get("batchId") == batch_id]
    if len(matches) != 1:
        raise PaperSafetyError("The selected acceptance batch is missing or ambiguous.")
    return deepcopy(matches[0])


def _positive(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PaperSafetyError(f"{label} must be positive.") from exc
    if result <= 0 or result != result or abs(result) == float("inf"):
        raise PaperSafetyError(f"{label} must be positive.")
    return result


def _validate_executable_ticket(ticket: Mapping[str, Any]) -> None:
    required = {
        "ticketId", "campaignId", "symbol", "direction", "method", "sessionMode",
        "requiredPhase", "duration", "quantity", "planningPrice", "hardCap",
        "stopPrice", "protectionOrderType", "exitPlan", "cleanup",
    }
    if missing := sorted(required - set(ticket)):
        raise PaperSafetyError(f"Executable ticket is incomplete: {', '.join(missing)}.")
    if ticket["direction"] not in {"Long", "Short"}:
        raise PaperSafetyError("Executable ticket direction is invalid.")
    quantity = ticket["quantity"]
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity <= 0:
        raise PaperSafetyError("Executable ticket quantity must be positive whole shares.")
    cap = _positive(ticket["hardCap"], "Entry bound")
    stop = _positive(ticket["stopPrice"], "Protection stop")
    if ticket["direction"] == "Long" and stop >= cap:
        raise PaperSafetyError("Long protection must be below the entry cap.")
    if ticket["direction"] == "Short" and stop <= cap:
        raise PaperSafetyError("Short protection must be above the entry floor.")
    if ticket["direction"] == "Short" and ticket.get("maximumEntryPrice") is not None:
        # A sell LMT/MIDPRICE cap is a minimum acceptable fill price. It cannot
        # enforce a maximum improved fill, so an interval-bounded short may not
        # be represented as executable by this manifest.
        raise PaperSafetyError("The existing short sell order cannot enforce both a minimum and maximum fill price.")
    cleanup = ticket["cleanup"]
    if cleanup.get("maximumAttempts") != 2 or cleanup.get("maximumRetries") != 1:
        raise PaperSafetyError("Cleanup must allow exactly one bounded retry.")
    _positive(cleanup.get("priceFloor") if ticket["direction"] == "Long" else cleanup.get("priceCeiling"), "Cleanup bound")
    allocations = ticket["exitPlan"].get("allocations") or []
    if sum(int(item.get("quantity") or 0) for item in allocations) != quantity:
        raise PaperSafetyError("Exit allocations must conserve the ticket quantity exactly.")


def assert_approval_binding(
    batch: Mapping[str, Any], *, current_source_identity: str,
    approval: Mapping[str, Any] | None,
) -> dict[str, Any]:
    digest = ticket_digest(batch)
    if approval is None:
        return {"approvalStatus": "preparation-only", "ticketDigest": digest}
    if approval.get("batchId") != batch.get("batchId"):
        raise PaperSafetyError("Approval identifies a different batch.")
    if approval.get("sourceIdentity") != current_source_identity:
        raise PaperSafetyError("Approval source identity does not match the current implementation.")
    if approval.get("ticketDigest") != digest:
        raise PaperSafetyError("Approved ticket content changed; repricing is not permitted.")
    approved = set(approval.get("approvedTicketIds") or [])
    executable = {item["ticketId"] for item in batch.get("tickets", []) if item.get("status") == "executable"}
    if approved != executable:
        raise PaperSafetyError("Approval does not identify exactly the executable ticket set.")
    try:
        approved_at = datetime.fromisoformat(str(approval.get("approvedAt")).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise PaperSafetyError("Approval timestamp is invalid.") from exc
    if approved_at.tzinfo is None:
        raise PaperSafetyError("Approval timestamp must include a timezone.")
    return {"approvalStatus": "exact-match", "ticketDigest": digest}


def _http_json(base_url: str, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
    data = _canonical(body) if body is not None else None
    request = Request(
        f"{base_url.rstrip('/')}{path}", data=data, method=method,
        headers={"Content-Type": "application/json", "X-Brontide-Local": "1"},
    )
    try:
        with urlopen(request, timeout=35) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("detail")
        except (ValueError, json.JSONDecodeError):
            detail = None
        raise PaperSafetyError(str(detail or f"Local broker endpoint returned HTTP {exc.code}.")) from exc
    except (OSError, URLError, ValueError, json.JSONDecodeError) as exc:
        raise PaperSafetyError("The local Brontide broker endpoint is unavailable or returned invalid data.") from exc


def _intent_payload(ticket: Mapping[str, Any]) -> dict[str, Any]:
    value = {
        "intentId": ticket["ticketId"],
        "idempotencyKey": ticket["idempotencyKey"],
        "planId": ticket["planId"],
        "campaignId": ticket["campaignId"],
        "symbol": ticket["symbol"],
        "direction": ticket["direction"],
        "method": ticket["method"],
        "sessionMode": ticket["sessionMode"],
        "duration": ticket["duration"],
        "protectionOrderType": ticket["protectionOrderType"],
        "quantity": ticket["quantity"],
        "planningPrice": ticket["planningPrice"],
        "hardCap": ticket["hardCap"],
        "stopPrice": ticket["stopPrice"],
        "maximumPriceDriftPercent": ticket.get("maximumPriceDriftPercent", 0.5),
        "exitPlan": ticket["exitPlan"],
    }
    for key in ("triggerPrice", "protectionLimitPrice"):
        if ticket.get(key) is not None:
            value[key] = ticket[key]
    return value


def read_only_preflight(
    manifest: Mapping[str, Any], batch: Mapping[str, Any], *, base_url: str,
    current_source_identity: str, approval: Mapping[str, Any] | None = None,
    now: datetime | None = None, persist_intents: bool = True,
) -> dict[str, Any]:
    """Run a complete selected-batch preflight without any order operation."""

    binding = assert_approval_binding(
        batch, current_source_identity=current_source_identity, approval=approval,
    )
    checked_at = now or datetime.now(timezone.utc)
    valid_from = batch.get("validFrom")
    valid_until = batch.get("validUntil")
    if valid_from or valid_until:
        try:
            start = datetime.fromisoformat(str(valid_from).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00"))
        except (TypeError, ValueError) as exc:
            raise PaperSafetyError("The batch validity window is invalid.") from exc
        if not start <= checked_at <= end:
            raise PaperSafetyError("The selected acceptance batch is not currently valid; expired or future tickets are never reused.")
    served = _http_json(base_url, "GET", "/brontide-preview-identity.json")
    if served.get("identifier") != current_source_identity:
        raise PaperSafetyError("The served preview does not match the current source identity.")
    snapshot = _http_json(base_url, "POST", "/v1/ibkr/read-only/refresh", {})
    if snapshot.get("mode") != "read-only" or snapshot.get("connectionStatus") != "connected" or snapshot.get("dataStatus") != "fresh":
        raise PaperSafetyError("The paper account/position/order snapshot did not complete fresh and read-only.")
    if not snapshot.get("account") or not snapshot["account"].get("maskedId"):
        raise PaperSafetyError("The verified private account binding is unavailable.")
    positions = [item for item in snapshot.get("positions", []) if item.get("snapshotState") == "current"]
    orders = snapshot.get("openOrders")
    if not isinstance(orders, list):
        raise PaperSafetyError("The open-order snapshot did not complete.")
    for excluded in manifest.get("exclusions", []):
        matches = [item for item in positions if item.get("symbol") == excluded.get("symbol")]
        if len(matches) != 1 or matches[0].get("direction") != excluded.get("direction") or matches[0].get("quantity") != excluded.get("quantity"):
            raise PaperSafetyError("An excluded broker position changed; the batch remains blocked.")
    occupied = {str(item.get("symbol") or "").upper() for item in positions}
    occupied.update(str(item.get("symbol") or "").upper() for item in orders)
    ticket_results: list[dict[str, Any]] = []
    for ticket in batch.get("tickets", []):
        result = {"ticketId": ticket["ticketId"], "status": ticket.get("status"), "reason": ticket.get("blockedReason")}
        if ticket.get("status") != "executable":
            ticket_results.append(result)
            continue
        if ticket["symbol"].upper() in occupied:
            ticket_results.append({**result, "status": "blocked", "reason": "The symbol already has a position or working order."})
            continue
        instrument = _http_json(base_url, "POST", "/v1/ibkr/read-only/instrument", {"symbol": ticket["symbol"], "route": "SMART"})
        validation_now = checked_at if now is not None else datetime.now(timezone.utc)
        phase = broker_session_phase(instrument, validation_now)
        if phase["phase"] != ticket["requiredPhase"]:
            ticket_results.append({**result, "status": "pending-session", "reason": f"Requires {ticket['requiredPhase']}; broker schedule reports {phase['phase']}.", "session": phase})
            continue
        if not instrument.get("executable"):
            ticket_results.append({**result, "status": "blocked", "reason": instrument.get("error") or "A live complete quote is unavailable.", "session": phase})
            continue
        try:
            if persist_intents:
                prepared = _http_json(base_url, "POST", "/v1/ibkr/paper/intents", _intent_payload(ticket))
            else:
                with TemporaryDirectory(prefix="brontide-preflight-") as temporary:
                    prepared = prepare_paper_intent(
                        _intent_payload(ticket), account_id="PREFLIGHT-PRIVATE-ACCOUNT",
                        account_binding="preflight-current-verified-binding",
                        instrument=instrument, existing_symbols=set(),
                        store=PaperIntentStore(Path(temporary) / "intent.json"),
                        now=validation_now,
                    )
            ticket_results.append({
                **result, "status": "validated", "session": phase,
                "quote": {
                    "side": prepared.get("quoteSide"),
                    "value": prepared.get("executableQuote"),
                    "observedAt": prepared.get("quoteObservedAt"),
                    "marketDataType": instrument.get("quote", {}).get("marketDataType"),
                },
                "contract": {
                    "symbol": instrument.get("contract", {}).get("symbol"),
                    "route": instrument.get("contract", {}).get("route"),
                    "minimumTick": instrument.get("contract", {}).get("minimumTick"),
                    "serverVersion": instrument.get("contract", {}).get("serverVersion"),
                },
                "intentPersisted": persist_intents, "submissionsEnabled": prepared.get("submissionsEnabled", False),
            })
        except PaperSafetyError as exc:
            ticket_results.append({**result, "status": "blocked", "reason": str(exc), "session": phase})
    return {
        "schemaVersion": 1,
        "packageId": manifest.get("packageId"),
        "batchId": batch.get("batchId"),
        "sourceIdentity": current_source_identity,
        **binding,
        "checkedAt": checked_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mode": "read-only",
        "account": snapshot["account"]["maskedId"],
        "snapshot": {"completed": True, "positionCount": len(positions), "openOrderCount": len(orders)},
        "excludedPositions": [{"symbol": item["symbol"], "direction": item["direction"], "quantity": item["quantity"]} for item in positions if item["symbol"] in {value["symbol"] for value in manifest.get("exclusions", [])}],
        "tickets": ticket_results,
        "ordersChanged": False,
    }


class AcceptanceEvidenceStore:
    """Atomic append-only evidence ledger; full broker IDs remain private."""

    def __init__(self, path: Path):
        self.path = path

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schemaVersion": 1, "events": []}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise PaperSafetyError("Private acceptance evidence is unreadable; reconcile before continuing.") from exc
        if value.get("schemaVersion") != 1 or not isinstance(value.get("events"), list):
            raise PaperSafetyError("Private acceptance evidence requires reconciliation.")
        return value

    def append(self, event: Mapping[str, Any]) -> dict[str, Any]:
        required = {"eventId", "batchId", "ticketId", "scenarioId", "kind", "occurredAt", "provenance"}
        if missing := sorted(required - set(event)):
            raise PaperSafetyError(f"Evidence event is incomplete: {', '.join(missing)}.")
        if event["kind"] not in EVENT_KINDS:
            raise PaperSafetyError("Evidence event kind is unsupported.")
        try:
            observed = datetime.fromisoformat(str(event["occurredAt"]).replace("Z", "+00:00"))
        except (TypeError, ValueError) as exc:
            raise PaperSafetyError("Evidence timestamp is invalid.") from exc
        if observed.tzinfo is None:
            raise PaperSafetyError("Evidence timestamp must include a timezone.")
        if event["provenance"] in ACTUAL_PROVENANCE and not (event.get("brokerOrderId") or event.get("brokerExecutionId")):
            raise PaperSafetyError("Actual broker evidence requires a broker order or execution identifier.")
        state = self._read()
        existing = next((item for item in state["events"] if item.get("eventId") == event["eventId"]), None)
        if existing:
            if _canonical(existing) != _canonical(event):
                raise PaperSafetyError("A duplicate evidence identity contains conflicting data.")
            return deepcopy(existing)
        ticket_events = [item for item in state["events"] if item.get("ticketId") == event["ticketId"]]
        unresolved = next((item for item in reversed(ticket_events) if item["kind"] in {"submission-unknown", "reconciliation-order-found", "reconciliation-no-order"}), None)
        if event["kind"] == "submission-requested" and unresolved and unresolved["kind"] in {"submission-unknown", "reconciliation-order-found"}:
            reason = "must be reconciled" if unresolved["kind"] == "submission-unknown" else "already exists at the broker"
            raise PaperSafetyError(f"The prior submission {reason}; a retry is not permitted.")
        next_state = {"schemaVersion": 1, "events": [*state["events"], dict(event)]}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent, delete=False) as handle:
                json.dump(next_state, handle, sort_keys=True, separators=(",", ":"))
                handle.flush()
                temporary = Path(handle.name)
            temporary.replace(self.path)
            if not any(item.get("eventId") == event["eventId"] for item in self._read()["events"]):
                raise OSError("round-trip mismatch")
        except OSError as exc:
            raise PaperSafetyError("Acceptance evidence could not be persisted; stop and reconcile.") from exc
        return deepcopy(dict(event))

    def masked_report(self, batch_id: str) -> dict[str, Any]:
        events = [item for item in self._read()["events"] if item.get("batchId") == batch_id]
        scenarios: dict[str, dict[str, Any]] = {}
        for event in events:
            scenario = scenarios.setdefault(event["scenarioId"], {"events": [], "classification": "Simulated pass/fail"})
            if event.get("provenance") in ACTUAL_PROVENANCE:
                scenario["classification"] = "Actual paper observed"
            safe = {key: value for key, value in event.items() if key not in {"brokerOrderId", "brokerExecutionId", "accountId"}}
            for key in ("brokerOrderId", "brokerExecutionId"):
                if event.get(key):
                    safe[f"{key}Reference"] = sha256(str(event[key]).encode("utf-8")).hexdigest()[:10]
            scenario["events"].append(safe)
        return {"schemaVersion": 1, "batchId": batch_id, "scenarios": scenarios}
