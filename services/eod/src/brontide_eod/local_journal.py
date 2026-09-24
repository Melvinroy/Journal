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
from .paper_domain import summarize


MARKER = "synthetic-journal.json"
LEDGER = "ledger.sqlite3"
_AWARE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$")


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


class LocalJournalSource:
    """Project only an explicitly selected synthetic PaperStore database.

    ``fixture_directory`` has no default. The marker and *every* campaign must
    carry the exact independently supplied profile, account and environment.
    No browser-supplied identity or account selector is accepted.
    """

    def __init__(self, *, fixture_directory: Path, profile_id: str,
                 account_binding: str, environment: str = "paper") -> None:
        if (not profile_id or not account_binding or environment != "paper"
                or not str(account_binding).startswith("fixture-")):
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
            if manifest != {"schemaVersion": 1, "syntheticOnly": True,
                            "profileId": self.profile_id,
                            "accountBinding": self.account_binding,
                            "environment": self.environment}:
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
                KeyError, ArithmeticError) as exc:
            raise LocalJournalUnavailable("Fixture history is unavailable or invalid.") from exc

    def _project(self, campaigns: list[tuple[str, str]],
                 command_rows: list[tuple[str, str]]) -> dict:
        rows: list[dict] = []
        campaign_ids: set[str] = set()
        execution_ids: set[str] = set()
        latest: datetime | None = None
        for identity, body in campaigns:
            campaign = _json(body)
            if not isinstance(campaign, dict) or campaign.get("id") != identity:
                raise LocalJournalUnavailable("Fixture campaign identity is invalid.")
            scope = (campaign.get("profileId"), campaign.get("accountBinding"),
                     campaign.get("environment"), campaign.get("syntheticOnly"))
            expected = (self.profile_id, self.account_binding, self.environment, True)
            if scope != expected:
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
                if not execution_id or execution_id in execution_ids:
                    raise LocalJournalUnavailable("Fixture execution identity is duplicated.")
                execution_ids.add(execution_id)
                if (execution.get("effect") not in {"entry", "exit"}
                        or type(execution.get("quantity")) is not int
                        or execution["quantity"] <= 0
                        or type(execution.get("price")) not in {int, float}
                        or not math.isfinite(execution["price"]) or execution["price"] <= 0):
                    raise LocalJournalUnavailable("Fixture execution value is invalid.")
                fee = execution.get("commission")
                if fee is not None and (type(fee) not in {int, float} or not math.isfinite(fee)):
                    raise LocalJournalUnavailable("Fixture fee is invalid.")
            ticket = campaign.get("ticket")
            if (not isinstance(ticket, dict) or ticket.get("direction") not in {"Long", "Short"}
                    or not isinstance(ticket.get("symbol"), str) or not ticket["symbol"]
                    or type(ticket.get("stopPrice")) not in {int, float}
                    or not math.isfinite(ticket["stopPrice"]) or ticket["stopPrice"] <= 0):
                raise LocalJournalUnavailable("Fixture ticket is invalid.")
            summary = summarize(campaign)
            if summary["openQuantity"] < 0:
                raise LocalJournalUnavailable("Fixture has exits without matching entries.")
            timestamps = [_recorded_time(campaign.get("createdAt"))]
            timestamps.extend(_recorded_time(execution.get("occurredAt"))
                              for execution in executions)
            recorded_time = max(timestamps)
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
        }
