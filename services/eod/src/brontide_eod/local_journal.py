"""Read-only, fixture-scoped Journal projection for standalone development.

This adapter is deliberately opt-in. A local profile is not a broker account
binding, and this module must not be pointed at or auto-discover an owner ledger.
The production standalone service does not mount the fixture router.
"""

from __future__ import annotations

import json
import hashlib
import math
import re
import sqlite3
import stat
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .ibkr_tws import PaperSafetyError
from .local_binding import LocalLedgerScope
from .paper_domain import summarize, validate_exit_plan
from .paper_store import canonical


MARKER = "synthetic-journal.json"
LEDGER = "ledger.sqlite3"
RECORDED_MARKER = "recorded-journal.json"
RECORDED_DIRECTORY = "paper-recorded"
_AWARE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$")
_FIXTURE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_FIXTURE_BINDING = re.compile(r"^fixture-[A-Za-z0-9-]{1,64}$")
_STOCK_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")
_MAX_SAFE_INTEGER = (1 << 53) - 1
_CAMPAIGN_STATES = frozenset({"Pending entry", "Partially filled", "Open", "Closed",
                             "Cancelled", "Closing", "Needs reconciliation", "Unprotected",
                             "Paused", "Paused — submissions locked"})


class LocalJournalUnavailable(ValueError):
    """The isolated fixture cannot be safely interpreted as recorded history."""


def _browser_number(value: object) -> bool:
    """Keep synthetic monetary values within JavaScript's safe magnitude."""
    return (type(value) in {int, float} and math.isfinite(value)
            and abs(value) <= _MAX_SAFE_INTEGER)


def _recorded_command_request(value: object, *, synthetic_only: bool = False) -> bool:
    """Accept the action and order-write shapes actually saved by PaperService."""
    if not isinstance(value, dict):
        return False
    if synthetic_only and value == {"action": "synthetic"}:
        return True
    action = value.get("action")
    if action is not None and not isinstance(action, str):
        return False
    if synthetic_only and action in {
            "approve", "recover", "submit", "save-amendment", "cancel-entry",
            "cleanup", "apply-amendment", "cancel-exits", "resume"}:
        return True
    if action == "approve":
        return (set(value) == {"action", "digest"}
                and isinstance(value.get("digest"), str)
                and bool(re.fullmatch(r"[0-9a-f]{64}", value["digest"])))
    if action == "recover":
        return (set(value) == {"action", "revision"}
                and type(value.get("revision")) is int and value["revision"] >= 0)
    if action == "submit":
        return (set(value) == {"action", "batchId", "ticketIndex"}
                and isinstance(value.get("batchId"), str)
                and bool(_FIXTURE_ID.fullmatch(value["batchId"]))
                and type(value.get("ticketIndex")) is int
                and value["ticketIndex"] >= 0)
    if action in {"save-amendment", "cancel-entry", "cleanup",
                  "apply-amendment", "cancel-exits", "resume"}:
        return (set(value) == {"action", "revision", "payload"}
                and type(value.get("revision")) is int and value["revision"] >= 1
                and (isinstance(value["payload"], dict)
                     if action == "save-amendment" else
                     value["payload"] is None or isinstance(value["payload"], dict)))
    if (set(value) != {"role", "orderId", "fields", "cancel"}
            or value.get("role") not in {
                "entry", "protection", "protection-retry", "tighten-stop",
                "target", "cleanup", "cleanup-reprice"}
            or type(value.get("orderId")) is not int
            or not 0 < value["orderId"] <= _MAX_SAFE_INTEGER
            or type(value.get("cancel")) is not bool
            or not isinstance(value.get("fields"), dict)):
        return False
    fields = value["fields"]
    return (isinstance(fields.get("account"), str) and bool(fields["account"])
            and isinstance(fields.get("orderRef"), str) and bool(fields["orderRef"])
            and fields.get("action") in {"BUY", "SELL"}
            and type(fields.get("totalQuantity")) is int
            and fields["totalQuantity"] == 1)


def _not_reparse(path: Path) -> None:
    if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & getattr(
        stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0
    ):
        raise LocalJournalUnavailable("Fixture storage must not be a reparse point.")


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _json(raw: bytes | str) -> object:
    return json.loads(raw, object_pairs_hook=_unique_pairs)


def _recorded_time(value: object) -> datetime:
    if not isinstance(value, str) or not _AWARE_ISO.fullmatch(value):
        raise LocalJournalUnavailable("Fixture timestamp is invalid.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError("A timezone is required")
        observed = parsed.astimezone(timezone.utc)
        delta = observed - datetime(1970, 1, 1, tzinfo=timezone.utc)
        micros = ((delta.days * 86400 + delta.seconds) * 1_000_000
                  + delta.microseconds)
        if abs(micros) > _MAX_SAFE_INTEGER:
            raise ValueError("Timestamp exceeds browser-safe microsecond precision")
        return observed
    except ValueError as exc:
        raise LocalJournalUnavailable("Fixture timestamp is invalid.") from exc


def _validate_timeline(created: datetime, executions: list[dict]) -> datetime:
    """Require recorded exits to follow already held shares, including timestamp ties."""
    groups: dict[datetime, list[dict]] = {}
    for execution in executions:
        observed = _recorded_time(execution.get("occurredAt"))
        if observed < created:
            raise LocalJournalUnavailable("Fixture execution precedes its campaign.")
        groups.setdefault(observed, []).append(execution)
    held = 0
    for observed in sorted(groups):
        events = groups[observed]
        exited = sum(e["quantity"] for e in events if e["effect"] == "exit")
        if exited > held:
            # An entry at the same timestamp cannot establish whether the exit
            # followed it. Reject that ambiguous ordering rather than invent it.
            raise LocalJournalUnavailable("Fixture exit precedes recorded inventory.")
        held += sum(e["quantity"] for e in events if e["effect"] == "entry") - exited
    return max(groups, default=created)


def _journal_exit_plan(value: object) -> dict:
    """Validate the shared plan semantics, then drop unrelated/private fields."""
    # Python equality treats True as 1; the shared schema validator accepts
    # that equivalence, so the fixture boundary must enforce the actual type.
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int:
        raise LocalJournalUnavailable("Fixture exit plan schema is invalid.")
    plan = validate_exit_plan(value)
    # This detail is consumed by the browser's shared Journal projector.
    # Large finite Python numbers are not necessarily precise in JavaScript.
    numeric = [plan["breakeven"]["activationR"],
               plan["breakeven"]["favorableOffset"]["value"]]
    for leg in plan["legs"]:
        numeric.append(leg["allocationPercent"])
        if leg["role"] == "Target":
            target = leg["target"]
            numeric.append(target["multipleR" if target["mode"] == "R" else "price"])
        else:
            numeric.append(leg["activationR"])
            trailing = leg["trailing"]
            field = {"Dollar": "distance", "Percentage": "percent",
                     "Manual": "stopPrice"}.get(trailing["mode"])
            if field:
                numeric.append(trailing[field])
    if not all(_browser_number(item) for item in numeric):
        raise LocalJournalUnavailable("Fixture exit plan exceeds browser-safe magnitude.")
    legs = []
    for leg in plan["legs"]:
        if not _FIXTURE_ID.fullmatch(leg["id"]):
            raise LocalJournalUnavailable("Fixture exit leg identity is invalid.")
        visible = {"id": leg["id"], "role": leg["role"],
                   "allocationPercent": leg["allocationPercent"]}
        if leg["role"] == "Target":
            target = leg["target"]
            name = "multipleR" if target["mode"] == "R" else "price"
            visible["target"] = {"mode": target["mode"], name: target[name]}
        else:
            trailing = leg["trailing"]
            name = {"Dollar": "distance", "Percentage": "percent",
                    "Manual": "stopPrice", "SMA": "period"}.get(trailing["mode"])
            visible["activationR"] = leg["activationR"]
            visible["trailing"] = {"mode": trailing["mode"]}
            if name:
                visible["trailing"][name] = trailing[name]
        legs.append(visible)
    offset = plan["breakeven"]["favorableOffset"]
    return {"schemaVersion": 1, "legs": legs,
            "breakeven": {"activationR": plan["breakeven"]["activationR"],
                          "favorableOffset": {"unit": offset["unit"],
                                              "value": offset["value"]}}}


class LocalJournalSource:
    """Project only an explicitly selected synthetic PaperStore database.

    ``fixture_directory`` has no default. The marker and *every* campaign must
    carry the exact independently supplied profile, account and environment.
    No browser-supplied identity or account selector is accepted.
    """

    def __init__(self, *, fixture_directory: Path, profile_id: str,
                 account_binding: str, environment: str = "paper") -> None:
        if (not isinstance(profile_id, str) or not profile_id
                or not isinstance(account_binding, str)
                or not _FIXTURE_BINDING.fullmatch(account_binding)
                or environment != "paper"):
            raise ValueError("An explicit synthetic profile and account scope is required.")
        self.directory = Path(fixture_directory)
        self.profile_id = profile_id
        self.account_binding = account_binding
        self.environment = environment
        self._synthetic_only = True
        self._marker = MARKER
        self._ledger_binding = account_binding
        self._source = "synthetic-ledger-fixture"
        self._record_prefix = "fixture"

    def scope_id(self) -> str:
        """Opaque identity shared by recorded history and its private plans."""
        if self._synthetic_only:
            raise LocalJournalUnavailable("Synthetic history has no private paper scope.")
        scope = {"profileId": self.profile_id,
                 "accountBinding": self.account_binding,
                 "ledgerBinding": self._ledger_binding,
                 "environment": self.environment,
                 "index": "last-saved-plan"}
        return hashlib.sha256(canonical(scope).encode("utf-8")).hexdigest()

    def _paths(self) -> tuple[Path, Path]:
        directory = self.directory
        if not directory.is_absolute() or not directory.is_dir():
            raise LocalJournalUnavailable("Fixture directory is unavailable.")
        _not_reparse(directory)
        marker, ledger = directory / self._marker, directory / LEDGER
        if not marker.is_file() or not ledger.is_file():
            raise LocalJournalUnavailable("Fixture marker or ledger is unavailable.")
        _not_reparse(marker)
        _not_reparse(ledger)
        return marker, ledger

    def read(self, principal_profile_id: str) -> dict:
        if principal_profile_id != self.profile_id:
            raise LocalJournalUnavailable("Local profile changed; relaunch Brontide.")
        marker, ledger = self._paths()
        try:
            if marker.stat().st_size > 4096:
                raise LocalJournalUnavailable("Fixture marker is invalid.")
            with marker.open("rb") as stored:
                raw_manifest = stored.read(4097)
            if len(raw_manifest) > 4096:
                raise LocalJournalUnavailable("Fixture marker is invalid.")
            manifest = _json(raw_manifest)
            expected_manifest = {"schemaVersion": 1,
                                 "syntheticOnly": self._synthetic_only,
                                 "profileId": self.profile_id,
                                 "accountBinding": self.account_binding,
                                 "environment": self.environment}
            if not self._synthetic_only:
                expected_manifest["paperLedgerBinding"] = self._ledger_binding
            if (not isinstance(manifest, dict)
                    or type(manifest.get("schemaVersion")) is not int
                    or type(manifest.get("syntheticOnly")) is not bool
                    or manifest != expected_manifest):
                raise LocalJournalUnavailable("Fixture scope is invalid.")
            with closing(sqlite3.connect(ledger.as_uri() + "?mode=ro", uri=True,
                                         timeout=2)) as db:
                db.execute("PRAGMA query_only=ON")
                db.execute("BEGIN")
                if db.execute("PRAGMA user_version").fetchone()[0] != 1:
                    raise LocalJournalUnavailable("Fixture ledger schema is unsupported.")
                required = {"objects", "commands", "events"}
                tables = {row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
                if not required.issubset(tables):
                    raise LocalJournalUnavailable("Fixture ledger schema is incomplete.")
                campaigns = db.execute(
                    "SELECT id,body FROM objects WHERE kind='campaign' ORDER BY rowid"
                ).fetchall()
                batches = db.execute(
                    "SELECT id,body FROM objects WHERE kind='batch' ORDER BY rowid"
                ).fetchall() if not self._synthetic_only else []
                command_rows = db.execute(
                    "SELECT campaign,request,state FROM commands"
                ).fetchall()
                # Reserve the entire exec namespace. A future economic event
                # format must not disappear from an older Journal projection.
                economic_rows = db.execute(
                    "SELECT id,body FROM events WHERE id GLOB 'exec*'"
                ).fetchall()
                fee_rows = db.execute(
                    "SELECT id,body FROM objects WHERE kind='fee'"
                ).fetchall()
                return self._project(campaigns, command_rows, batches,
                                     economic_rows, fee_rows)
        except LocalJournalUnavailable:
            raise
        except (OSError, sqlite3.Error, UnicodeError, ValueError, TypeError,
                PaperSafetyError, AttributeError,
                KeyError, ArithmeticError) as exc:
            raise LocalJournalUnavailable("Fixture history is unavailable or invalid.") from exc

    def _project(self, campaigns: list[tuple[str, str]],
                 command_rows: list[tuple[str, str, str]],
                 batches: list[tuple[str, str]],
                 economic_rows: list[tuple[str, str]],
                 fee_rows: list[tuple[str, str]]) -> dict:
        rows: list[dict] = []
        journal_campaigns: list[dict] = []
        campaign_ids: set[str] = set()
        campaign_batch_ids: dict[str, str] = {}
        execution_ids: set[str] = set()
        economic_projection: dict[str, tuple[dict, int, str, str]] = {}
        latest: datetime | None = None
        batch_ids: set[str] = set()
        for identity, body in batches:
            batch = _json(body)
            if (not isinstance(batch, dict) or batch.get("id") != identity
                    or not isinstance(identity, str) or not _FIXTURE_ID.fullmatch(identity)
                    or batch.get("userId") != self.profile_id
                    or batch.get("accountBinding") != self._ledger_binding
                    or batch.get("environment") != "paper"
                    or "syntheticOnly" in batch or identity in batch_ids):
                raise LocalJournalUnavailable("Recorded ledger contains an unowned batch.")
            batch_ids.add(identity)
        for identity, body in campaigns:
            campaign = _json(body)
            if (not isinstance(campaign, dict) or campaign.get("id") != identity
                    or not isinstance(identity, str) or not _FIXTURE_ID.fullmatch(identity)):
                raise LocalJournalUnavailable("Fixture campaign identity is invalid.")
            scope = ((campaign.get("profileId"), campaign.get("accountBinding"),
                      campaign.get("environment"), campaign.get("syntheticOnly"))
                     if self._synthetic_only else
                     (campaign.get("userId"), campaign.get("accountBinding"),
                      campaign.get("environment"), "syntheticOnly" not in campaign))
            expected = (self.profile_id, self._ledger_binding, self.environment,
                        True)
            if (scope != expected
                    or (self._synthetic_only and campaign.get("syntheticOnly") is not True)
                    or (not self._synthetic_only and
                        campaign.get("batchId") not in batch_ids)):
                # Fail the entire read. Silently hiding a mismatched row could
                # make an incomplete account history look like an empty one.
                raise LocalJournalUnavailable("Fixture contains an unowned campaign.")
            if identity in campaign_ids:
                raise LocalJournalUnavailable("Fixture campaign identity is duplicated.")
            campaign_ids.add(identity)
            if not self._synthetic_only:
                campaign_batch_ids[identity] = campaign["batchId"]
            executions = campaign.get("executions")
            if not isinstance(executions, list):
                raise LocalJournalUnavailable("Fixture executions are invalid.")
            for execution in executions:
                if not isinstance(execution, dict) or not isinstance(execution.get("executionId"), str):
                    raise LocalJournalUnavailable("Fixture execution identity is invalid.")
                execution_id = execution["executionId"]
                if not _FIXTURE_ID.fullmatch(execution_id):
                    raise LocalJournalUnavailable("Fixture execution identity is invalid.")
                if execution_id in execution_ids:
                    raise LocalJournalUnavailable("Fixture execution identity is duplicated.")
                execution_ids.add(execution_id)
                if (execution.get("effect") not in {"entry", "exit"}
                        or type(execution.get("quantity")) is not int
                        or not 0 < execution["quantity"] <= _MAX_SAFE_INTEGER
                        or not _browser_number(execution.get("price")) or execution["price"] <= 0):
                    raise LocalJournalUnavailable("Fixture execution value is invalid.")
                fee = execution.get("commission")
                if fee is not None and not _browser_number(fee):
                    raise LocalJournalUnavailable("Fixture fee is invalid.")
                if (type(execution.get("orderId")) is not int
                        or not 0 < execution["orderId"] <= _MAX_SAFE_INTEGER
                        or execution.get("role") not in ({"entry", "stop", "target", "manual"}
                                                        if self._synthetic_only else
                                                        {"entry", "stop", "target", "cleanup"})
                        or (execution["effect"] == "entry") != (execution["role"] == "entry")):
                    raise LocalJournalUnavailable("Fixture execution details are invalid.")
            ticket = campaign.get("ticket")
            if (not isinstance(ticket, dict) or ticket.get("direction") not in {"Long", "Short"}
                    or not isinstance(ticket.get("symbol"), str)
                    or not _STOCK_SYMBOL.fullmatch(ticket["symbol"])
                    or not _browser_number(ticket.get("stopPrice")) or ticket["stopPrice"] <= 0):
                raise LocalJournalUnavailable("Fixture ticket is invalid.")
            if (not isinstance(ticket.get("planId"), str)
                    or not _FIXTURE_ID.fullmatch(ticket["planId"])
                    or type(ticket.get("quantity")) is not int
                    or not 0 < ticket["quantity"] <= _MAX_SAFE_INTEGER
                    or any(not _browser_number(ticket.get(name)) or ticket[name] <= 0
                           for name in ("planningPrice", "hardCap"))):
                raise LocalJournalUnavailable("Fixture plan details are invalid.")
            exit_plan = _journal_exit_plan(ticket.get("exitPlan"))
            contract = campaign.get("contract")
            if (not isinstance(contract, dict) or type(contract.get("conId")) is not int
                    or not 0 < contract["conId"] <= _MAX_SAFE_INTEGER
                    or contract.get("currency") != "USD"):
                raise LocalJournalUnavailable("Fixture contract is invalid.")
            for execution in executions:
                economic_projection[execution["executionId"]] = (
                    execution, contract["conId"], ticket["direction"],
                    contract["currency"])
            created = _recorded_time(campaign.get("createdAt"))
            recorded_time = _validate_timeline(created, executions)
            summary = summarize(campaign)
            if not summary["accountingComplete"] and campaign.get("state") != "Needs reconciliation":
                # A recorded reconciliation case is still history. Keep the
                # executions and share counts visible with unknown P&L, but
                # never show an ordinary open/closed state for guessed cost.
                raise LocalJournalUnavailable("Fixture cost basis needs reconciliation.")
            if summary["entryAfterExit"] and campaign.get("state") != "Needs reconciliation":
                raise LocalJournalUnavailable(
                    "Fixture protection and allocations need reconciliation.")
            if summary["openQuantity"] < 0 or summary["entered"] > ticket["quantity"]:
                raise LocalJournalUnavailable("Fixture execution quantities conflict.")
            if any(type(summary[key]) is not int or not 0 <= summary[key] <= _MAX_SAFE_INTEGER
                   for key in ("entered", "exited", "openQuantity")):
                raise LocalJournalUnavailable("Fixture execution quantity is not browser-safe.")
            if campaign.get("state") not in _CAMPAIGN_STATES:
                raise LocalJournalUnavailable("Fixture campaign state is invalid.")
            if campaign["state"] == "Closed" and (summary["entered"] == 0 or summary["openQuantity"] != 0):
                raise LocalJournalUnavailable("Fixture closed state conflicts with recorded quantity.")
            if campaign["state"] == "Pending entry" and summary["entered"] != 0:
                raise LocalJournalUnavailable("Fixture pending state conflicts with recorded quantity.")
            if campaign["state"] in {"Open", "Partially filled", "Unprotected"} and summary["entered"] == 0:
                raise LocalJournalUnavailable("Fixture open state conflicts with recorded quantity.")
            if any(not _browser_number(value)
                   for value in summary.values() if value is not None and type(value) is not bool):
                raise LocalJournalUnavailable("Fixture projection is invalid.")
            recorded_at = recorded_time.isoformat().replace("+00:00", "Z")
            if latest is None or recorded_time > latest:
                latest = recorded_time
            rows.append({
                "id": f"{self._record_prefix}:{identity}", "campaignId": identity,
                "symbol": ticket.get("symbol"), "direction": ticket["direction"],
                "state": campaign.get("state"), "recordedAt": recorded_at,
                "entered": summary["entered"], "exited": summary["exited"],
                "recordedOpenQuantity": summary["openQuantity"],
                "grossRealized": summary["grossRealized"],
                "fees": summary["fees"], "netRealized": summary["netRealized"],
                "finalNetR": summary["finalNetR"],
                "costsCompleteRecorded": summary["costsComplete"],
                "executionCount": len(executions),
            })
            # Enough recorded detail for the existing paperJournalRow adapter,
            # with no broker status, order slots, approvals or raw callbacks.
            # A later frontend adapter must override its hard-coded IBKR
            # provenance before displaying synthetic records.
            journal_campaigns.append({
                "id": identity, "symbol": ticket["symbol"],
                "direction": ticket["direction"], "state": campaign.get("state"),
                "accountBinding": self.account_binding, "createdAt":
                _recorded_time(campaign["createdAt"]).isoformat().replace("+00:00", "Z"),
                "contract": {"conId": contract["conId"], "currency": contract["currency"]},
                "ticket": {"planId": ticket["planId"],
                           "planningPrice": ticket["planningPrice"],
                           "quantity": ticket["quantity"],
                           "hardCap": ticket["hardCap"],
                           "stopPrice": ticket["stopPrice"],
                           "exitPlan": exit_plan},
                # The internal accounting gate is checked above. Keep the
                # versioned browser DTO limited to its existing public fields.
                "summary": {key: value for key, value in summary.items()
                            if key not in {"accountingComplete", "entryAfterExit"}},
                "executions": [{"executionId": e["executionId"],
                                "orderId": e["orderId"], "effect": e["effect"],
                                "role": e["role"], "quantity": e["quantity"],
                                "price": e["price"],
                                "occurredAt": _recorded_time(e["occurredAt"]).isoformat().replace("+00:00", "Z"),
                                "commission": e.get("commission")}
                               for e in executions],
                "syntheticOnly": self._synthetic_only,
            })
        witnessed_executions: set[str] = set()
        for identity, body in economic_rows:
            if not identity.startswith(("exec:", "exec-v1:")):
                raise LocalJournalUnavailable(
                    "Recorded economic evidence has an unsupported version.")
            execution_id = identity.split(":", 1)[1]
            event = _json(body)
            if (not _FIXTURE_ID.fullmatch(execution_id)
                    or not isinstance(event, dict)
                    or event.get("executionId") != execution_id
                    or execution_id not in execution_ids):
                # An economic event without a projected fill makes even an
                # apparently empty or closed history incomplete.
                raise LocalJournalUnavailable(
                    "Recorded economic evidence lacks a campaign projection.")
            witnessed_executions.add(execution_id)
            if identity.startswith("exec-v1:"):
                execution, con_id, direction, _currency = economic_projection[execution_id]
                expected_side = ("BOT" if (direction == "Long") ==
                                 (execution["effect"] == "entry") else "SLD")
                if (type(event.get("schemaVersion")) is not int
                        or event["schemaVersion"] != 1
                        or type(event.get("conId")) is not int
                        or event["conId"] != con_id
                        or type(event.get("orderId")) is not int
                        or event["orderId"] != execution["orderId"]
                        or not _browser_number(event.get("quantity"))
                        or event["quantity"] != execution["quantity"]
                        or not _browser_number(event.get("price"))
                        or event["price"] != execution["price"]
                        or event.get("side") != expected_side
                        or _recorded_time(event.get("executedAt")) !=
                           _recorded_time(execution["occurredAt"])):
                    raise LocalJournalUnavailable(
                        "Recorded economic evidence conflicts with a campaign fill.")
        if not self._synthetic_only and witnessed_executions != execution_ids:
            # New private ledgers do not import historical campaigns. Every
            # projected fill must have its durable economic event, including
            # after a restore; otherwise a cached row could look complete.
            raise LocalJournalUnavailable(
                "Recorded economic evidence is missing for a campaign fill.")
        for identity, body in fee_rows:
            fee = _json(body)
            projected = economic_projection.get(identity)
            if (projected is None or not isinstance(fee, dict)
                    or fee.get("kind") != "commission"
                    or fee.get("executionId") != identity
                    or fee.get("currency") != projected[3]
                    or not _browser_number(fee.get("commission"))
                    or projected[0].get("commission") != fee["commission"]):
                # A fee can arrive before its execution. Until the saved fill
                # catches up, history is incomplete rather than fee-free.
                raise LocalJournalUnavailable(
                    "Recorded fee evidence conflicts with a campaign fill.")
        uncertain = 0
        for owner_id, request_body, state in command_rows:
            if state not in {"unknown", "confirmed"}:
                raise LocalJournalUnavailable("Recorded command state is invalid.")
            request = _json(request_body)
            if not _recorded_command_request(request, synthetic_only=self._synthetic_only):
                raise LocalJournalUnavailable("Recorded command request is invalid.")
            if owner_id in campaign_ids:
                if request.get("action") == "approve":
                    raise LocalJournalUnavailable("Recorded campaign command is invalid.")
                if (not self._synthetic_only and request.get("action") == "submit"
                        and request["batchId"] != campaign_batch_ids[owner_id]):
                    raise LocalJournalUnavailable("Recorded submit command targets another batch.")
            else:
                if owner_id not in batch_ids:
                    raise LocalJournalUnavailable("Fixture command has no recorded campaign.")
                if request.get("action") != "approve":
                    raise LocalJournalUnavailable("Recorded batch command is invalid.")
            if state == "unknown":
                uncertain += 1
        return {
            "source": self._source, "environment": self.environment,
            **({"scopeId": self.scope_id()} if not self._synthetic_only else {}),
            "executionEnabled": False, "connectionStatus": "not-connected",
            "historyStatus": "recorded" if rows else "no-records",
            "lastRecordedAt": latest.isoformat().replace("+00:00", "Z") if latest else None,
            "lastBrokerReconciledAt": None,
            "currentExposure": None, "ordersCleared": None,
            "uncertainCommandCount": uncertain, "records": rows,
            "journalCampaigns": journal_campaigns,
        }


class LocalRecordedJournalSource(LocalJournalSource):
    """Read a separately provisioned, profile-bound *new* paper ledger only.

    The private marker is not created here. A future connected service must
    provision it after exact account confirmation and durable-ledger review.
    This reader never auto-discovers or adopts the historical owner database.
    """

    @classmethod
    def from_private_directory(
        cls, *, ledger_directory: Path, profile_id: str,
        remembered_account_binding: str,
    ) -> "LocalRecordedJournalSource":
        """Load an existing private mapping without creating or changing data."""
        directory = Path(ledger_directory)
        marker = directory / RECORDED_MARKER
        try:
            if not directory.is_absolute() or not directory.is_dir():
                raise LocalJournalUnavailable("Recorded history directory is unavailable.")
            _not_reparse(directory)
            _not_reparse(marker)
            if not marker.is_file() or marker.stat().st_size > 4096:
                raise LocalJournalUnavailable("Recorded history scope is unavailable.")
            with marker.open("rb") as stored:
                raw_marker = stored.read(4097)
            if len(raw_marker) > 4096:
                raise LocalJournalUnavailable("Recorded history scope is unavailable.")
            document = _json(raw_marker)
            if (not isinstance(document, dict)
                    or type(document.get("schemaVersion")) is not int
                    or document.get("schemaVersion") != 1
                    or document.get("syntheticOnly") is not False
                    or document.get("profileId") != profile_id
                    or document.get("accountBinding") != remembered_account_binding
                    or document.get("environment") != "paper"
                    or not isinstance(document.get("paperLedgerBinding"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", document["paperLedgerBinding"])
                    or set(document) != {"schemaVersion", "syntheticOnly", "profileId",
                                         "accountBinding", "paperLedgerBinding",
                                         "environment"}):
                raise LocalJournalUnavailable("Recorded history scope is invalid.")
            scope = LocalLedgerScope(profile_id, remembered_account_binding,
                                     document["paperLedgerBinding"])
            return cls(ledger_directory=directory, scope=scope)
        except LocalJournalUnavailable:
            raise
        except (OSError, UnicodeError, ValueError, TypeError) as exc:
            raise LocalJournalUnavailable("Recorded history scope is unavailable.") from exc

    def __init__(self, *, ledger_directory: Path, scope: LocalLedgerScope) -> None:
        if (not isinstance(scope, LocalLedgerScope)
                or not isinstance(scope.profile_id, str)
                or not scope.profile_id.startswith("local-")
                or not isinstance(scope.remembered_account_binding, str)
                or not re.fullmatch(r"[0-9a-f]{64}", scope.remembered_account_binding)
                or not isinstance(scope.paper_ledger_binding, str)
                or not re.fullmatch(r"[0-9a-f]{64}", scope.paper_ledger_binding)
                or scope.environment != "paper"):
            raise ValueError("An explicit verified local paper ledger scope is required.")
        self.directory = Path(ledger_directory)
        self.profile_id = scope.profile_id
        self.account_binding = scope.remembered_account_binding
        self.environment = scope.environment
        self._synthetic_only = False
        self._marker = RECORDED_MARKER
        self._ledger_binding = scope.paper_ledger_binding
        self._source = "recorded-local-ledger"
        self._record_prefix = "recorded"
