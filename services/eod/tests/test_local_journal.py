"""Synthetic-only Journal reads never imply a broker connection or authority."""

from __future__ import annotations

import json
import sqlite3

import pytest

from brontide_eod.local_journal import (
    LEDGER, MARKER, LocalJournalSource, LocalJournalUnavailable,
)
from brontide_eod.paper_store import PaperStore


PROFILE = "local-synthetic-profile"
BINDING = "fixture-paper-account-A"


def fixture(tmp_path):
    directory = tmp_path / "synthetic"
    directory.mkdir()
    (directory / MARKER).write_text(json.dumps({
        "schemaVersion": 1, "syntheticOnly": True,
        "profileId": PROFILE, "accountBinding": BINDING,
        "environment": "paper",
    }), encoding="utf-8")
    store = PaperStore(directory / LEDGER)
    campaign = {
        "id": "campaign-1", "profileId": PROFILE, "accountBinding": BINDING,
        "environment": "paper", "syntheticOnly": True,
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST"},
        "state": "Partially filled", "createdAt": "2026-09-24T10:00:00Z",
        "executions": [
            {"executionId": "entry-1", "effect": "entry", "quantity": 2,
             "price": 100, "commission": .2, "occurredAt": "2026-09-24T10:01:00Z"},
            {"executionId": "exit-1", "effect": "exit", "quantity": 1,
             "price": 102, "commission": None, "occurredAt": "2026-09-24T10:02:00Z"},
        ],
    }
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
        assert store.command(db, "uncertain-1", campaign["id"], {"action": "synthetic"})
        assert store.event(db, "callback:entry-1", {"synthetic": True})
    source = LocalJournalSource(fixture_directory=directory, profile_id=PROFILE,
                                account_binding=BINDING)
    return source, store, campaign


def test_fixture_projection_preserves_partial_history_and_unknown_costs(tmp_path):
    source, store, _ = fixture(tmp_path)
    before = store.path.read_bytes()
    result = source.read(PROFILE)
    assert result["source"] == "synthetic-ledger-fixture"
    assert result["connectionStatus"] == "not-connected"
    assert result["executionEnabled"] is False
    assert result["currentExposure"] is None
    assert result["ordersCleared"] is None
    assert result["lastBrokerReconciledAt"] is None
    assert result["historyStatus"] == "recorded"
    assert result["uncertainCommandCount"] == 1
    assert result["lastRecordedAt"] == "2026-09-24T10:02:00Z"
    assert len(result["records"]) == 1
    row = result["records"][0]
    assert row["entered"] == 2 and row["exited"] == 1
    assert row["recordedOpenQuantity"] == 1
    assert row["grossRealized"] == 2
    assert row["fees"] is None and row["netRealized"] is None
    assert row["finalNetR"] is None and row["costsCompleteRecorded"] is False
    assert store.path.read_bytes() == before


def test_reconstruction_late_fee_and_replay_keep_one_trade_and_uncertainty(tmp_path):
    source, store, campaign = fixture(tmp_path)
    backup = store.backup(tmp_path / "restore" / LEDGER)
    restored_fixture = tmp_path / "restore"
    (restored_fixture / MARKER).write_bytes((source.directory / MARKER).read_bytes())
    reopened = LocalJournalSource(fixture_directory=restored_fixture,
                                  profile_id=PROFILE, account_binding=BINDING)
    restored = PaperStore(backup)
    initial = reopened.read(PROFILE)
    assert initial["uncertainCommandCount"] == 1
    assert initial["records"] == source.read(PROFILE)["records"]
    campaign["executions"][1]["commission"] = .1
    campaign["state"] = "Partially filled"
    with restored.transaction() as db:
        restored.put(db, "campaign", campaign["id"], campaign)
        assert not restored.event(db, "callback:entry-1", {"synthetic": True})
        assert restored.event(db, "callback:fee-exit-1", {"synthetic": True})
    after = reopened.read(PROFILE)
    assert len(after["records"]) == 1
    assert after["records"][0]["executionCount"] == 2
    assert after["records"][0]["fees"] == pytest.approx(.3)
    assert after["records"][0]["netRealized"] == pytest.approx(1.7)
    assert after["records"][0]["finalNetR"] is None  # still partly open
    assert after["uncertainCommandCount"] == 1
    with sqlite3.connect(backup) as db:
        assert db.execute("SELECT state FROM commands WHERE id='uncertain-1'").fetchone()[0] == "unknown"
        assert db.execute("SELECT COUNT(*) FROM objects WHERE kind='campaign'").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2


def test_missing_marker_invalid_scope_and_unscoped_campaign_fail_closed(tmp_path):
    source, store, campaign = fixture(tmp_path)
    with pytest.raises(LocalJournalUnavailable, match="profile changed"):
        source.read("another-profile")
    (source.directory / MARKER).unlink()
    with pytest.raises(LocalJournalUnavailable, match="marker or ledger"):
        source.read(PROFILE)
    (source.directory / MARKER).write_text(json.dumps({
        "schemaVersion": 1, "syntheticOnly": True, "profileId": PROFILE,
        "accountBinding": "fixture-another-account", "environment": "paper",
    }), encoding="utf-8")
    with pytest.raises(LocalJournalUnavailable, match="scope"):
        source.read(PROFILE)
    (source.directory / MARKER).write_text(json.dumps({
        "schemaVersion": 1, "syntheticOnly": True, "profileId": PROFILE,
        "accountBinding": BINDING, "environment": "paper",
    }), encoding="utf-8")
    campaign["accountBinding"] = "fixture-another-account"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="unowned campaign"):
        source.read(PROFILE)


def test_no_records_is_distinct_from_unavailable_and_duplicate_execution_rejected(tmp_path):
    source, store, campaign = fixture(tmp_path)
    with store.transaction() as db:
        db.execute("DELETE FROM objects WHERE kind='campaign'")
    with pytest.raises(LocalJournalUnavailable, match="no recorded campaign"):
        source.read(PROFILE)
    with store.transaction() as db:
        db.execute("DELETE FROM commands")
    empty = source.read(PROFILE)
    assert empty["historyStatus"] == "no-records"
    assert empty["records"] == []
    assert empty["currentExposure"] is None
    with store.transaction() as db:
        campaign["executions"].append(dict(campaign["executions"][0]))
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="duplicated"):
        source.read(PROFILE)


def test_correction_changes_one_record_without_duplicate_trade(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][1]["commission"] = .1
    campaign["executions"][1]["price"] = 103
    with store.transaction() as db:
        assert store.event(db, "callback:correction-exit-1", {"synthetic": True})
        assert not store.event(db, "callback:correction-exit-1", {"synthetic": True})
        store.put(db, "campaign", campaign["id"], campaign)
    result = source.read(PROFILE)
    assert len(result["records"]) == 1
    row = result["records"][0]
    assert row["executionCount"] == 2
    assert row["grossRealized"] == 3
    assert row["netRealized"] == pytest.approx(2.7)
    assert row["recordedOpenQuantity"] == 1


def test_recorded_time_rejects_malformed_values_and_orders_offsets_by_instant(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][1]["occurredAt"] = "not-a-time"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="timestamp"):
        source.read(PROFILE)

    # 11:30 at +02:00 precedes the 10:01 UTC entry, regardless of lexicographic order.
    campaign["executions"][1]["occurredAt"] = "2026-09-24T11:30:00+02:00"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    result = source.read(PROFILE)
    assert result["lastRecordedAt"] == "2026-09-24T10:01:00Z"
    assert result["records"][0]["recordedAt"] == "2026-09-24T10:01:00Z"
