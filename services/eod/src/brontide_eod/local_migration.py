"""Read-only assessment of an explicitly selected legacy paper ledger.

This does not import, claim, migrate, authorize, reconnect, or resume trading.
It uses PaperStore's SQLite backup into a temporary, caller-supplied private
scratch directory, then removes that snapshot after inspecting it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import stat
import tempfile
from collections import Counter
from contextlib import closing
from pathlib import Path
from uuid import UUID

from .ibkr_tws import PaperSafetyError
from .paper_store import PaperStore


MAX_OWNER_BYTES = 4096
EXPECTED_TABLES = {
    "objects": ("kind", "id", "body"),
    "commands": ("id", "campaign", "request", "state"),
    "events": ("id", "body"),
}
KNOWN_OBJECT_KINDS = frozenset({
    "amendment-approval", "approval", "batch", "broker-snapshot", "campaign",
    "fee", "plan-revision", "quarantine", "source-recovery", "test-session",
})
KNOWN_COMMAND_STATES = frozenset({"unknown", "confirmed"})


class MigrationAssessmentError(ValueError):
    """The assessment cannot establish a safe and unambiguous source."""


def _file(path: Path, label: str) -> Path:
    if not path.is_absolute() or not path.exists():
        raise MigrationAssessmentError(f"An existing absolute {label} path is required.")
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    if path.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
        raise MigrationAssessmentError(f"The {label} path must not be a reparse point.")
    if not path.is_file():
        raise MigrationAssessmentError(f"The {label} path must be a regular file.")
    return path


def _scratch(path: Path) -> Path:
    if not path.is_absolute() or not path.exists():
        raise MigrationAssessmentError("An existing absolute private scratch directory is required.")
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    if path.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0) or not path.is_dir():
        raise MigrationAssessmentError("The private scratch path must be a regular directory.")
    return path


def _scope(record: object, user_id: str, binding: str, environment: str) -> str:
    if not isinstance(record, dict):
        return "malformed"
    observed = (record.get("userId"), record.get("accountBinding"), record.get("environment"))
    if observed == (user_id, binding, environment):
        return "matching"
    if any(value is not None for value in observed) and any(
        value is not None and value != expected
        for value, expected in zip(observed, (user_id, binding, environment))
    ):
        return "conflicting"
    return "unscoped"


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _json(value: str) -> object | None:
    try:
        return json.loads(value, object_pairs_hook=_unique_pairs)
    except (TypeError, ValueError):
        return None


def assess_legacy_paper_store(*, source_db: Path, owner_file: Path,
                              expected_user_id: str, expected_account_binding: str,
                              expected_environment: str, scratch_root: Path) -> dict:
    """Return sanitized counts and blockers from one consistent source snapshot.

    A clean report is still *not* permission to import: active writer ownership,
    broker exposure and Windows ACLs require separate operator proof.
    """
    source = _file(Path(source_db), "source database")
    owner = _file(Path(owner_file), "owner binding")
    scratch = _scratch(Path(scratch_root))
    try:
        user_id = str(UUID(expected_user_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise MigrationAssessmentError("A canonical expected owner UUID is required.") from exc
    if user_id != expected_user_id:
        raise MigrationAssessmentError("A canonical expected owner UUID is required.")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_account_binding):
        raise MigrationAssessmentError("An exact expected paper account binding digest is required.")
    if expected_environment != "paper":
        raise MigrationAssessmentError("Only the paper environment can be assessed by this tool.")
    if owner.stat().st_size > MAX_OWNER_BYTES:
        raise MigrationAssessmentError("Owner binding file is too large.")
    with owner.open("rb") as owner_source:
        raw_owner = owner_source.read(MAX_OWNER_BYTES + 1)
    if len(raw_owner) > MAX_OWNER_BYTES:
        raise MigrationAssessmentError("Owner binding file is too large.")
    try:
        binding = json.loads(raw_owner.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, ValueError) as exc:
        raise MigrationAssessmentError("Owner binding is unreadable.") from exc
    if (not isinstance(binding, dict) or set(binding) != {"userId", "accountBinding"}
            or binding["userId"] != user_id or binding["accountBinding"] != expected_account_binding):
        raise MigrationAssessmentError("Owner or paper account binding does not match the expected source.")

    with tempfile.TemporaryDirectory(prefix="brontide-assess-", dir=scratch) as temporary:
        snapshot = PaperStore(source).backup(Path(temporary) / "snapshot.sqlite3")
        with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
            db.execute("PRAGMA query_only=ON")
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise MigrationAssessmentError("Consistent source snapshot failed SQLite integrity check.")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version != 1:
                raise MigrationAssessmentError("Source ledger schema is unsupported.")
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables != set(EXPECTED_TABLES):
                raise MigrationAssessmentError("Source ledger tables are incomplete or unexpected.")
            for table, expected_columns in EXPECTED_TABLES.items():
                columns = tuple(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
                if columns != expected_columns:
                    raise MigrationAssessmentError("Source ledger columns are unsupported.")

            blockers: Counter[str] = Counter()
            kinds: Counter[str] = Counter()
            states: Counter[str] = Counter()
            scoped_ids: set[str] = set()
            active_campaigns = 0
            for kind, identity, body in db.execute("SELECT kind,id,body FROM objects"):
                if kind not in KNOWN_OBJECT_KINDS:
                    blockers["unknown_object_kind"] += 1
                    kinds["other"] += 1
                else:
                    kinds[kind] += 1
                record = _json(body)
                result = _scope(record, user_id, expected_account_binding, expected_environment)
                if result == "matching" and kind in {"batch", "campaign", "test-session"}:
                    scoped_ids.add(str(identity))
                if result != "matching":
                    blockers[f"{result}_object_scope"] += 1
                if kind == "campaign" and isinstance(record, dict) and record.get("state") not in {"Closed", "Cancelled"}:
                    active_campaigns += 1
                if kind == "quarantine" and isinstance(record, dict) and not record.get("resolved"):
                    blockers["unresolved_quarantine"] += 1
                if kind == "test-session" and isinstance(record, dict) and isinstance(record.get("target"), int) and record["target"] > 30:
                    blockers["obsolete_test_target"] += 1
            if active_campaigns:
                blockers["active_campaign"] = active_campaigns

            commands = 0
            for _identity, campaign, request, state in db.execute("SELECT id,campaign,request,state FROM commands"):
                commands += 1
                if state not in KNOWN_COMMAND_STATES:
                    blockers["unknown_command_state"] += 1
                    states["other"] += 1
                else:
                    states[state] += 1
                if _json(request) is None:
                    blockers["malformed_command"] += 1
                if campaign is None or str(campaign) not in scoped_ids:
                    blockers["unlinked_command"] += 1
                if state != "confirmed":
                    blockers["unresolved_command_state"] += 1

            events = 0
            for _identity, body in db.execute("SELECT id,body FROM events"):
                events += 1
                result = _scope(_json(body), user_id, expected_account_binding, expected_environment)
                if result != "matching":
                    blockers[f"{result}_event_scope"] += 1

            return {
                "schemaVersion": version,
                "environment": "paper",
                "ownerBindingMatched": True,
                "counts": {"objects": sum(kinds.values()), "objectsByKind": dict(sorted(kinds.items())),
                           "commands": commands, "commandsByState": dict(sorted(states.items())),
                           "events": events, "activeCampaigns": active_campaigns},
                "blockers": dict(sorted(blockers.items())),
                "scopeConsistent": not blockers,
                "importAuthorized": False,
                "requires": ["exclusive service ownership", "broker reconciliation",
                             "Windows access proof", "reviewed cutover and rollback"],
            }


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only legacy paper-ledger assessment")
    parser.add_argument("--source-db", required=True, type=Path)
    parser.add_argument("--owner-file", required=True, type=Path)
    parser.add_argument("--expected-user-id", required=True)
    parser.add_argument("--expected-account-binding", required=True)
    parser.add_argument("--expected-environment", required=True, choices=["paper"])
    parser.add_argument("--scratch-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = assess_legacy_paper_store(
            source_db=args.source_db, owner_file=args.owner_file,
            expected_user_id=args.expected_user_id,
            expected_account_binding=args.expected_account_binding,
            expected_environment=args.expected_environment, scratch_root=args.scratch_root,
        )
    except MigrationAssessmentError as exc:
        parser.exit(2, f"Assessment blocked: {exc}\n")
    except (OSError, sqlite3.Error, PaperSafetyError):
        parser.exit(2, "Assessment blocked: source snapshot or private scratch access failed.\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
