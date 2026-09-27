"""Isolated store-level recovery evidence for a future local profile."""

import sqlite3

import pytest

from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.paper_domain import summarize
from brontide_eod.paper_store import PaperStore


def test_private_backup_retains_uncertainty_and_idempotent_projection(tmp_path):
    source = PaperStore(tmp_path / "isolated-profile" / "ledger.sqlite3")
    campaign = {
        "ticket": {"direction": "Long", "stopPrice": 98},
        "executions": [
            {"executionId": "entry-1", "effect": "entry", "quantity": 1,
             "price": 100, "commission": .1},
            {"executionId": "exit-1", "effect": "exit", "quantity": 1,
             "price": 102, "commission": .1},
        ],
    }
    entry_event = {"kind": "execution", "executionId": "entry-1", "quantity": 1}
    exit_event = {"kind": "execution", "executionId": "exit-1", "quantity": 1}
    request = {"action": "submit", "planRevision": "revision-1"}
    with source.transaction() as db:
        source.put(db, "campaign", "campaign-1", campaign)
        assert source.command(db, "command-1", "campaign-1", request)
        assert source.event(db, "callback:entry-1", entry_event)
        assert source.event(db, "callback:exit-1", exit_event)

    source_projection = summarize(source.all("campaign")[0])
    assert source_projection["entered"] == source_projection["exited"] == 1
    assert source_projection["netRealized"] == pytest.approx(1.8)
    assert source_projection["finalNetR"] == pytest.approx(.9)

    restored_path = source.backup(tmp_path / "restored-profile" / "ledger.sqlite3")
    restored = PaperStore(restored_path)
    with restored.transaction() as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert db.execute("SELECT state FROM commands WHERE id='command-1'").fetchone()[0] == "unknown"
        assert [row[0] for row in db.execute("SELECT id FROM events ORDER BY id")] == [
            "callback:entry-1", "callback:exit-1",
        ]
        assert not restored.command(db, "command-1", "campaign-1", request)
        assert not restored.event(db, "callback:entry-1", entry_event)
        assert not restored.event(db, "callback:exit-1", exit_event)
        with pytest.raises(PaperSafetyError, match="Conflicting broker event identity"):
            restored.event(db, "callback:exit-1", {**exit_event, "quantity": 2})
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM commands").fetchone()[0] == 1

    assert restored.all("campaign") == source.all("campaign")
    assert summarize(restored.all("campaign")[0]) == source_projection
    with sqlite3.connect(source.path) as db:
        assert db.execute("SELECT state FROM commands WHERE id='command-1'").fetchone()[0] == "unknown"
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2
