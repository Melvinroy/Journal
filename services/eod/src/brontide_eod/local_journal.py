"""Read-only, fixture-scoped Journal projection for standalone development.

This adapter is deliberately opt-in. A local profile is not a broker account
binding, and this module must not be pointed at or auto-discover an owner ledger.
The production standalone service does not mount the fixture router.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import stat
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .ibkr_tws import PaperSafetyError
from .paper_domain import summarize, validate_exit_plan


MARKER = "synthetic-journal.json"
LEDGER = "ledger.sqlite3"
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
        return parsed.astimezone(timezone.utc)
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

    def _paths(self) -> tuple[Path, Path]:
        directory = self.directory
        if not directory.is_absolute() or not directory.is_dir():
            raise LocalJournalUnavailable("Fixture directory is unavailable.")
        _not_reparse(directory)
        marker, ledger = directory / MARKER, directory / LEDGER
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
            manifest = _json(marker.read_bytes())
            if (not isinstance(manifest, dict)
                    or type(manifest.get("schemaVersion")) is not int
                    or manifest.get("syntheticOnly") is not True
                    or manifest != {"schemaVersion": 1, "syntheticOnly": True,
                            "profileId": self.profile_id,
                            "accountBinding": self.account_binding,
                            "environment": self.environment}):
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
                command_rows = db.execute(
                    "SELECT campaign,state FROM commands"
                ).fetchall()
                return self._project(campaigns, command_rows)
        except LocalJournalUnavailable:
            raise
        except (OSError, sqlite3.Error, UnicodeError, ValueError, TypeError,
                PaperSafetyError, AttributeError,
                KeyError, ArithmeticError) as exc:
            raise LocalJournalUnavailable("Fixture history is unavailable or invalid.") from exc

    def _project(self, campaigns: list[tuple[str, str]],
                 command_rows: list[tuple[str, str]]) -> dict:
        rows: list[dict] = []
        journal_campaigns: list[dict] = []
        campaign_ids: set[str] = set()
        execution_ids: set[str] = set()
        latest: datetime | None = None
        for identity, body in campaigns:
            campaign = _json(body)
            if (not isinstance(campaign, dict) or campaign.get("id") != identity
                    or not isinstance(identity, str) or not _FIXTURE_ID.fullmatch(identity)):
                raise LocalJournalUnavailable("Fixture campaign identity is invalid.")
            scope = (campaign.get("profileId"), campaign.get("accountBinding"),
                     campaign.get("environment"), campaign.get("syntheticOnly"))
            expected = (self.profile_id, self.account_binding, self.environment, True)
            if scope != expected or campaign.get("syntheticOnly") is not True:
                # Fail the entire read. Silently hiding a mismatched row could
                # make an incomplete account history look like an empty one.
                raise LocalJournalUnavailable("Fixture contains an unowned campaign.")
            if identity in campaign_ids:
                raise LocalJournalUnavailable("Fixture campaign identity is duplicated.")
            campaign_ids.add(identity)
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
                        or type(execution.get("price")) not in {int, float}
                        or not math.isfinite(execution["price"]) or execution["price"] <= 0):
                    raise LocalJournalUnavailable("Fixture execution value is invalid.")
                fee = execution.get("commission")
                if fee is not None and (type(fee) not in {int, float} or not math.isfinite(fee)):
                    raise LocalJournalUnavailable("Fixture fee is invalid.")
                if (type(execution.get("orderId")) is not int
                        or not 0 < execution["orderId"] <= _MAX_SAFE_INTEGER
                        or execution.get("role") not in {"entry", "stop", "target", "manual"}
                        or (execution["effect"] == "entry") != (execution["role"] == "entry")):
                    raise LocalJournalUnavailable("Fixture execution details are invalid.")
            ticket = campaign.get("ticket")
            if (not isinstance(ticket, dict) or ticket.get("direction") not in {"Long", "Short"}
                    or not isinstance(ticket.get("symbol"), str)
                    or not _STOCK_SYMBOL.fullmatch(ticket["symbol"])
                    or type(ticket.get("stopPrice")) not in {int, float}
                    or not math.isfinite(ticket["stopPrice"]) or ticket["stopPrice"] <= 0):
                raise LocalJournalUnavailable("Fixture ticket is invalid.")
            if (not isinstance(ticket.get("planId"), str)
                    or not _FIXTURE_ID.fullmatch(ticket["planId"])
                    or type(ticket.get("quantity")) is not int
                    or not 0 < ticket["quantity"] <= _MAX_SAFE_INTEGER
                    or any(type(ticket.get(name)) not in {int, float}
                           or not math.isfinite(ticket[name]) or ticket[name] <= 0
                           for name in ("planningPrice", "hardCap"))):
                raise LocalJournalUnavailable("Fixture plan details are invalid.")
            exit_plan = _journal_exit_plan(ticket.get("exitPlan"))
            contract = campaign.get("contract")
            if (not isinstance(contract, dict) or type(contract.get("conId")) is not int
                    or not 0 < contract["conId"] <= _MAX_SAFE_INTEGER
                    or contract.get("currency") != "USD"):
                raise LocalJournalUnavailable("Fixture contract is invalid.")
            summary = summarize(campaign)
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
            if any(type(value) not in {int, float} or not math.isfinite(value)
                   for value in summary.values() if value is not None and type(value) is not bool):
                raise LocalJournalUnavailable("Fixture projection is invalid.")
            created = _recorded_time(campaign.get("createdAt"))
            recorded_time = _validate_timeline(created, executions)
            recorded_at = recorded_time.isoformat().replace("+00:00", "Z")
            if latest is None or recorded_time > latest:
                latest = recorded_time
            rows.append({
                "id": f"fixture:{identity}", "campaignId": identity,
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
                "summary": summary,
                "executions": [{"executionId": e["executionId"],
                                "orderId": e["orderId"], "effect": e["effect"],
                                "role": e["role"], "quantity": e["quantity"],
                                "price": e["price"],
                                "occurredAt": _recorded_time(e["occurredAt"]).isoformat().replace("+00:00", "Z"),
                                "commission": e.get("commission")}
                               for e in executions],
                "syntheticOnly": True,
            })
        if any(campaign_id not in campaign_ids for campaign_id, _state in command_rows):
            raise LocalJournalUnavailable("Fixture command has no recorded campaign.")
        uncertain = sum(1 for campaign_id, state in command_rows
                        if campaign_id in campaign_ids and state == "unknown")
        if any(campaign_id in campaign_ids and state not in {"unknown", "confirmed"}
               for campaign_id, state in command_rows):
            raise LocalJournalUnavailable("Fixture command state is invalid.")
        return {
            "source": "synthetic-ledger-fixture", "environment": self.environment,
            "executionEnabled": False, "connectionStatus": "not-connected",
            "historyStatus": "recorded" if rows else "no-records",
            "lastRecordedAt": latest.isoformat().replace("+00:00", "Z") if latest else None,
            "lastBrokerReconciledAt": None,
            "currentExposure": None, "ordersCleared": None,
            "uncertainCommandCount": uncertain, "records": rows,
            "journalCampaigns": journal_campaigns,
        }
