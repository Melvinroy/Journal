"""Synthetic, read-only assessment of an explicitly named legacy paper store."""

import json
import sqlite3
from contextlib import closing
from uuid import UUID

import pytest

from brontide_eod.local_migration import MigrationAssessmentError, assess_legacy_paper_store
from brontide_eod.paper_store import PaperStore


OWNER = str(UUID("12345678-1234-4234-8234-123456789abc"))
BINDING = "a" * 64


def fixture_paths(tmp_path):
    source = tmp_path / "source.sqlite3"
    owner = tmp_path / "owner.json"
    scratch = tmp_path / "private-scratch"
    scratch.mkdir()
    owner.write_text(json.dumps({"userId": OWNER, "accountBinding": BINDING}))
    with PaperStore(source).transaction() as db:
        PaperStore.put(db, "campaign", "campaign-1", {
            "userId": OWNER, "accountBinding": BINDING, "environment": "paper", "state": "Closed",
        })
        PaperStore.command(db, "command-1", "campaign-1", {"kind": "synthetic"})
        db.execute("UPDATE commands SET state='confirmed' WHERE id='command-1'")
        PaperStore.event(db, "event-1", {
            "userId": OWNER, "accountBinding": BINDING, "environment": "paper", "kind": "synthetic",
        })
    return source, owner, scratch


def assess(source, owner, scratch, **changes):
    arguments = dict(source_db=source, owner_file=owner, expected_user_id=OWNER,
                     expected_account_binding=BINDING, expected_environment="paper", scratch_root=scratch)
    arguments.update(changes)
    return assess_legacy_paper_store(**arguments)


def test_consistent_snapshot_reports_counts_without_importing_or_changing_source(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    original_source, original_owner = source.read_bytes(), owner.read_bytes()
    report = assess(source, owner, scratch)
    assert report["counts"] == {
        "objects": 1, "objectsByKind": {"campaign": 1}, "commands": 1,
        "commandsByState": {"confirmed": 1}, "events": 1, "activeCampaigns": 0,
    }
    assert report["blockers"] == {}
    assert report["scopeConsistent"] is True
    assert report["importAuthorized"] is False
    assert source.read_bytes() == original_source
    assert owner.read_bytes() == original_owner
    assert list(scratch.iterdir()) == []
    assert "campaign-1" not in json.dumps(report)


def test_ambiguous_scope_unknown_command_and_obsolete_target_are_reported(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with PaperStore(source).transaction() as db:
        PaperStore.put(db, "campaign", "campaign-2", {
            "userId": OWNER, "accountBinding": "b" * 64, "environment": "paper", "state": "Active",
        })
        PaperStore.put(db, "test-session", "session-1", {
            "userId": OWNER, "accountBinding": BINDING, "environment": "paper", "target": 200,
        })
        PaperStore.command(db, "command-2", "campaign-2", {"kind": "synthetic"})
        PaperStore.event(db, "event-2", {"kind": "unscoped"})
    report = assess(source, owner, scratch)
    assert report["scopeConsistent"] is False
    assert report["blockers"] == {
        "active_campaign": 1, "conflicting_object_scope": 1, "obsolete_test_target": 1,
        "unlinked_command": 1, "unresolved_command_state": 1, "unscoped_event_scope": 1,
    }
    assert report["counts"]["commandsByState"] == {"confirmed": 1, "unknown": 1}
    assert list(scratch.iterdir()) == []


@pytest.mark.parametrize("owner_body", [
    {"userId": OWNER, "accountBinding": "b" * 64},
    {"userId": OWNER, "accountBinding": BINDING, "environment": "paper"},
])
def test_owner_mismatch_fails_before_snapshot(tmp_path, owner_body):
    source, owner, scratch = fixture_paths(tmp_path)
    owner.write_text(json.dumps(owner_body))
    with pytest.raises(MigrationAssessmentError, match="does not match"):
        assess(source, owner, scratch)
    assert list(scratch.iterdir()) == []


def test_duplicate_owner_key_and_wrong_environment_fail_closed(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with pytest.raises(MigrationAssessmentError, match="paper environment"):
        assess(source, owner, scratch, expected_environment="live")
    owner.write_text('{"userId":"%s","userId":"%s","accountBinding":"%s"}' % (OWNER, OWNER, BINDING))
    with pytest.raises(MigrationAssessmentError, match="unreadable"):
        assess(source, owner, scratch)


def test_oversized_owner_file_is_rejected_before_a_snapshot(tmp_path, monkeypatch):
    source, owner, scratch = fixture_paths(tmp_path)
    owner.write_bytes(b" " * 4097)
    original_source = source.read_bytes()
    monkeypatch.setattr(PaperStore, "backup", lambda self, destination: pytest.fail(
        "An oversized owner binding must be rejected before reading the ledger."))
    with pytest.raises(MigrationAssessmentError, match="too large"):
        assess(source, owner, scratch)
    assert source.read_bytes() == original_source
    assert list(scratch.iterdir()) == []


def test_unscoped_and_duplicate_keys_in_ledger_are_blockers(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with sqlite3.connect(source) as db:
        db.execute("INSERT INTO objects VALUES ('approval','approval-1',?)", (
            json.dumps({"kind": "approval"}),))
        db.execute("INSERT INTO events VALUES ('event-duplicate',?)", (
            '{"userId":"%s","userId":"%s","accountBinding":"%s","environment":"paper"}'
            % (OWNER, OWNER, BINDING),))
    report = assess(source, owner, scratch)
    assert report["blockers"] == {"malformed_event_scope": 1, "unscoped_object_scope": 1}


def test_unexpected_kind_and_state_cannot_leak_ledger_values_in_report(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with sqlite3.connect(source) as db:
        db.execute("INSERT INTO objects VALUES (?,?,?)", (
            "private-identity-123", "object-2", json.dumps({
                "userId": OWNER, "accountBinding": BINDING, "environment": "paper",
            }),))
        db.execute("UPDATE commands SET state=? WHERE id='command-1'", ("private-state-123",))
    report = assess(source, owner, scratch)
    assert report["blockers"] == {"unknown_command_state": 1, "unknown_object_kind": 1,
                                   "unresolved_command_state": 1}
    assert report["counts"]["objectsByKind"]["other"] == 1
    assert report["counts"]["commandsByState"] == {"other": 1}
    assert "private-" not in json.dumps(report)


def test_command_must_reference_a_scoped_campaign_batch_or_session(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with PaperStore(source).transaction() as db:
        PaperStore.put(db, "approval", "approval-2", {
            "userId": OWNER, "accountBinding": BINDING, "environment": "paper",
        })
        PaperStore.command(db, "command-2", "approval-2", {"kind": "synthetic"})
        db.execute("UPDATE commands SET state='confirmed' WHERE id='command-2'")
    report = assess(source, owner, scratch)
    assert report["blockers"] == {"unlinked_command": 1}


def test_backup_assessment_includes_committed_wal_records(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with closing(sqlite3.connect(source)) as writer:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("INSERT INTO objects VALUES (?,?,?)", (
            "campaign", "campaign-2", json.dumps({
                "userId": OWNER, "accountBinding": BINDING,
                "environment": "paper", "state": "Closed",
            }),))
        writer.commit()
        assert source.with_name(source.name + "-wal").exists()
        report = assess(source, owner, scratch)
        assert report["counts"]["objectsByKind"] == {"campaign": 2}
        assert report["blockers"] == {}
    assert list(scratch.iterdir()) == []


def test_unsupported_schema_and_nonabsolute_paths_fail_closed(tmp_path):
    source, owner, scratch = fixture_paths(tmp_path)
    with pytest.raises(MigrationAssessmentError, match="absolute source database"):
        assess(source.name, owner, scratch)
    with sqlite3.connect(source) as db:
        db.execute("PRAGMA user_version=2")
    with pytest.raises(MigrationAssessmentError, match="schema is unsupported"):
        assess(source, owner, scratch)
    assert list(scratch.iterdir()) == []
