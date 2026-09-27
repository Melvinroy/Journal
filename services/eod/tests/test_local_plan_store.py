"""A saved local plan is durable evidence, never a broker approval."""

import json
import os
import sqlite3
import shutil
import uuid
from copy import deepcopy
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from brontide_eod.ibkr_tws import PaperGatewayConfig
from brontide_eod.local_binding import BrokerAccountObservation, LocalBindingStore
from brontide_eod.local_backup import LocalBackupUnavailable, create_private_snapshot
from brontide_eod.local_discovery import DiscoveryEndpoint
from brontide_eod.local_instance import InstanceAlreadyRunning, WindowsStandaloneInstance
from brontide_eod.local_modules import LocalModulePreferencesStore
from brontide_eod.local_journal import (LEDGER, RECORDED_DIRECTORY,
                                        RECORDED_MARKER, LocalJournalUnavailable,
                                        LocalRecordedJournalSource)
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_plan_store import LocalPlanUnavailable, LocalSavedPlanStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_recorded_store import LocalRecordedStorePreparation
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.paper_plan import generated_plan
from brontide_eod.paper_store import PaperStore
from brontide_eod.standalone import create_app


NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
ORIGIN = "http://127.0.0.1:8765"


def record_fixture_fills(ledger, db, campaign):
    """Keep the artificial campaign projection tied to immutable fill rows."""
    for execution in campaign["executions"]:
        side = ("BOT" if (campaign["ticket"]["direction"] == "Long") ==
                (execution["effect"] == "entry") else "SLD")
        ledger.event(db, "exec-v1:" + execution["executionId"], {
            "schemaVersion": 1, "executionId": execution["executionId"],
            "account": "DU654321", "clientId": 92,
            "conId": campaign["contract"]["conId"],
            "orderId": execution["orderId"], "orderRef": "fixture-order",
            "side": side, "quantity": execution["quantity"],
            "price": execution["price"],
            "executedAt": execution["occurredAt"],
        })


def prepared(tmp_path):
    profile_store = LocalProfileStore(base=tmp_path)
    profile = profile_store.load_or_create()
    endpoint = DiscoveryEndpoint("127.0.0.1", 7497, 91)
    gateway = PaperGatewayConfig("127.0.0.1", 7497, 92, "DU654321")
    observation = BrokerAccountObservation(
        "generation-1234567890", endpoint.binding(), ("DU654321",),
        "paper", True, True, True, NOW,
    )
    binding = LocalBindingStore(profile_store, clock=lambda: NOW)
    reference = LocalPaperReferenceStore(profile_store, clock=lambda: NOW)
    reference.record_owner_attested(profile.profile_id, "DU654321")
    binding.confirm(profile.profile_id, "DU654321", "DU654321", observation)
    LocalRecordedStorePreparation(profile_store, binding, reference).prepare(
        profile.profile_id, observation, endpoint, gateway)
    return profile_store, profile.profile_id, LocalSavedPlanStore(profile_store, binding)


def complete_plan():
    ticket = {
        "planId": str(uuid.uuid4()), "planRevision": str(uuid.uuid4()),
        "symbol": "TEST", "direction": "Long", "planningPrice": 100,
        "stopPrice": 98, "cleanupFloor": 98, "method": "Limit",
        "quantity": 1, "hardCap": 100, "sessionMode": "Regular",
        "duration": "DAY", "protectionOrderType": "STP",
        "planningSource": "Manual",
        "exitPlan": {"schemaVersion": 1, "legs": [{
            "id": "target-1", "role": "Target", "allocationPercent": 100,
            "target": {"mode": "R", "multipleR": 1},
        }], "breakeven": {"activationR": 1,
                            "favorableOffset": {"unit": "Dollar", "value": 0}}},
    }
    plan = generated_plan(ticket, "2026-09-25T12:00:00Z")
    del plan["origin"]
    plan.update(atrMultiplier=1, accountEquity=30000, sizingEquity=30000,
                riskPercent=.5, maxAllocationPercent=15,
                sizingBasis={"source": "Legacy planning equity", "currency": "USD",
                             "value": 30000},
                result={"valid": True, "shares": 1})
    return plan


def test_revision_is_immutable_idempotent_and_account_scoped(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    plan = complete_plan()
    assert store.load_latest(profile_id) is None
    first = store.save(profile_id, plan, None)
    assert first["planId"] == plan["planId"]
    assert first["planRevision"] == plan["planRevision"]
    assert len(first["scopeId"]) == 64
    assert first["executionEnabled"] is False and first["reviewEligible"] is False
    remembered = LocalBindingStore(profile_store).load(profile_id)
    source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=profile_store.root / RECORDED_DIRECTORY,
        profile_id=profile_id,
        remembered_account_binding=remembered.account_binding,
    )
    assert source.read(profile_id)["scopeId"] == first["scopeId"]
    assert store.save(profile_id, deepcopy(plan), None) == first
    changed = deepcopy(plan)
    changed["accountEquity"] = 40000
    with pytest.raises(LocalPlanUnavailable, match="different content"):
        store.save(profile_id, changed, None)
    second = deepcopy(plan)
    second["planRevision"] = str(uuid.uuid4())
    second["savedAt"] = "2026-09-25T12:01:00Z"
    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, second, None)
    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, second, plan["planRevision"],
                   expected_active_revision=str(uuid.uuid4()))
    updated = store.save(profile_id, second, plan["planRevision"],
                         expected_active_revision=plan["planRevision"])
    assert updated["planRevision"] == second["planRevision"]
    assert store.save(profile_id, deepcopy(second), plan["planRevision"],
                      expected_active_revision=plan["planRevision"]) == updated
    assert store.load_latest(profile_id)["savedPlan"] == second
    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, {**second, "planRevision": str(uuid.uuid4())},
                   plan["planRevision"])
    ledger = profile_store.root / "paper-recorded" / "ledger.sqlite3"
    with sqlite3.connect(ledger) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM objects WHERE kind='local-plan-revision'"
        ).fetchone()[0] == 2
        assert db.execute(
            "SELECT COUNT(*) FROM objects WHERE kind='local-plan-head'"
        ).fetchone()[0] == 1


def test_sample_market_snapshot_cannot_be_disguised_as_manual_paper_plan(tmp_path):
    _profile_store, profile_id, store = prepared(tmp_path)
    plan = complete_plan()
    plan["marketSnapshot"] = {"status": "sample", "source": "Simulated fixture"}
    with pytest.raises(LocalPlanUnavailable, match="Sample market data"):
        store.save(profile_id, plan, None)
    assert store.load_latest(profile_id) is None


def test_last_saved_plan_survives_store_reconstruction_without_becoming_a_review(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    plan = complete_plan()
    assert store.load_current(profile_id, plan["planId"]) is None
    store.save(profile_id, plan, None)
    fresh_profile = LocalProfileStore(base=tmp_path)
    recovered = LocalSavedPlanStore(fresh_profile, LocalBindingStore(fresh_profile))
    loaded = recovered.load_current(profile_id, plan["planId"])
    assert loaded["savedPlan"] == plan
    assert loaded["scopeId"] == store.scope_status(profile_id)["scopeId"]
    assert loaded["executionEnabled"] is False
    assert loaded["reviewEligible"] is False
    assert loaded["contentDigest"] == store.save(profile_id, plan, None)["contentDigest"]
    assert recovered.load_latest(profile_id) == loaded


def test_private_backup_retains_saved_plan_pointer_and_detects_tampering(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    second = deepcopy(first)
    second["planRevision"] = str(uuid.uuid4())
    second["savedAt"] = "2026-09-25T12:01:00Z"
    store.save(profile_id, first, None)
    store.save(profile_id, second, first["planRevision"],
               expected_active_revision=first["planRevision"])
    expected = store.load_latest(profile_id)

    original = profile_store.root / RECORDED_DIRECTORY
    restored_directory = tmp_path / "isolated-restored-plans"
    restored_ledger = PaperStore(original / LEDGER).backup(
        restored_directory / LEDGER)
    (restored_directory / RECORDED_MARKER).write_bytes(
        (original / RECORDED_MARKER).read_bytes())
    remembered = LocalBindingStore(profile_store).load(profile_id)
    restored_source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=restored_directory, profile_id=profile_id,
        remembered_account_binding=remembered.account_binding)
    assert restored_source.read(profile_id)["executionEnabled"] is False
    with PaperStore(restored_ledger).transaction() as db:
        assert store._read_latest(db, restored_source) == expected
        assert db.execute(
            "SELECT COUNT(*) FROM objects WHERE kind='local-plan-revision'"
        ).fetchone()[0] == 2

    with sqlite3.connect(restored_ledger) as db:
        db.execute("UPDATE objects SET body=? WHERE kind='local-plan-revision' "
                   "AND body LIKE ?", ('{"savedPlan":{"symbol":"OTHER"}}',
                                        f'%{second["planRevision"]}%'))
        assert db.total_changes == 1
    with PaperStore(restored_ledger).transaction() as db:
        with pytest.raises(LocalPlanUnavailable):
            store._read_latest(db, restored_source)
    assert store.load_latest(profile_id) == expected


def test_restored_private_scope_reopens_plan_history_and_unknown_command(tmp_path):
    """A fixture backup needs every private identity file plus a SQLite snapshot."""
    original_base = tmp_path / "owner"
    original_base.mkdir()
    profile_store, profile_id, plans = prepared(original_base)
    plan = complete_plan()
    saved = plans.save(profile_id, plan, None)
    original_plan = plans.load_latest(profile_id)
    binding = LocalBindingStore(profile_store).load(profile_id)
    assert binding is not None
    directory = profile_store.root / RECORDED_DIRECTORY
    original_source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=directory, profile_id=profile_id,
        remembered_account_binding=binding.account_binding)
    campaign = {
        "id": "restored-campaign", "batchId": "restored-batch",
        "userId": profile_id, "accountBinding": original_source._ledger_binding,
        "environment": "paper", "state": "Partially filled",
        "createdAt": "2026-09-25T12:00:00Z",
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": plan["planId"], "quantity": 1,
                   "planningPrice": 100, "hardCap": 100,
                   "exitPlan": {"schemaVersion": 1, "legs": [{
                       "id": "target-1", "role": "Target", "allocationPercent": 100,
                       "target": {"mode": "R", "multipleR": 1},
                   }], "breakeven": {"activationR": 1,
                                      "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "executions": [{"executionId": "restored-fill", "orderId": 101,
                        "effect": "entry", "role": "entry", "quantity": 1,
                        "price": 100, "commission": None,
                        "occurredAt": "2026-09-25T12:01:00Z"}],
    }
    ledger = PaperStore(directory / LEDGER)
    with ledger.transaction() as db:
        ledger.put(db, "batch", campaign["batchId"], {
            "id": campaign["batchId"], "userId": profile_id,
            "accountBinding": original_source._ledger_binding,
            "environment": "paper",
        })
        ledger.put(db, "campaign", campaign["id"], campaign)
        ledger.command(db, "restored-unknown", campaign["id"],
                       {"action": "submit", "batchId": campaign["batchId"], "ticketIndex": 0})
        record_fixture_fills(ledger, db, campaign)
    original_history = original_source.read(profile_id)

    # Copy private identity files only under an isolated test base. The
    # database uses SQLite's online backup rather than copying a live WAL.
    restored_base = tmp_path / "restored"
    restored_root = restored_base / profile_store.root.name
    restored_directory = restored_root / RECORDED_DIRECTORY
    restored_directory.mkdir(parents=True)
    for name in ("profile.json", "owner-paper-account.json", "paper-binding.json"):
        shutil.copy2(profile_store.root / name, restored_root / name)
    shutil.copy2(directory / RECORDED_MARKER, restored_directory / RECORDED_MARKER)
    ledger.backup(restored_directory / LEDGER)

    restored_profile = LocalProfileStore(base=restored_base)
    assert restored_profile.read_existing().profile_id == profile_id
    restored_reference = LocalPaperReferenceStore(restored_profile, clock=lambda: NOW)
    assert restored_reference.load(profile_id).matches("DU654321")
    restored_binding = LocalBindingStore(restored_profile).load(profile_id)
    assert restored_binding == binding
    restored_source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=restored_directory, profile_id=profile_id,
        remembered_account_binding=restored_binding.account_binding)
    assert restored_source.read(profile_id) == original_history
    assert original_history["uncertainCommandCount"] == 1
    assert original_history["currentExposure"] is None
    assert original_history["records"][0]["fees"] is None
    assert original_history["executionEnabled"] is False
    restored_plans = LocalSavedPlanStore(restored_profile,
                                         LocalBindingStore(restored_profile))
    assert restored_plans.load_latest(profile_id) == original_plan
    assert restored_plans.load_current(profile_id, plan["planId"]) == original_plan
    assert original_plan["contentDigest"] == saved["contentDigest"]
    with pytest.raises(LocalPlanUnavailable):
        restored_plans.load_latest("local-other")
    with pytest.raises(LocalJournalUnavailable):
        LocalRecordedJournalSource.from_private_directory(
            ledger_directory=restored_directory, profile_id=profile_id,
            remembered_account_binding="0" * 64)


@pytest.mark.skipif(os.name != "nt", reason="Windows offline maintenance mutex")
def test_offline_private_snapshot_preserves_profile_binding_plan_and_history(tmp_path):
    owner = tmp_path / "owner"
    owner.mkdir()
    profile_store, profile_id, plans = prepared(owner)
    LocalModulePreferencesStore(profile_store).save(profile_id, ["trading"])
    plan = complete_plan()
    plans.save(profile_id, plan, None)
    binding = LocalBindingStore(profile_store).load(profile_id)
    source_directory = profile_store.root / RECORDED_DIRECTORY
    source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=source_directory, profile_id=profile_id,
        remembered_account_binding=binding.account_binding)
    campaign = {
        "id": "snapshot-campaign", "batchId": "snapshot-batch",
        "userId": profile_id, "accountBinding": source._ledger_binding,
        "environment": "paper", "state": "Partially filled",
        "createdAt": "2026-09-25T12:00:00Z",
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": plan["planId"], "quantity": 1,
                   "planningPrice": 100, "hardCap": 100,
                   "exitPlan": {"schemaVersion": 1, "legs": [{
                       "id": "target-1", "role": "Target", "allocationPercent": 100,
                       "target": {"mode": "R", "multipleR": 1},
                   }], "breakeven": {"activationR": 1,
                                      "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "executions": [{"executionId": "snapshot-fill", "orderId": 101,
                        "effect": "entry", "role": "entry", "quantity": 1,
                        "price": 100, "commission": None,
                        "occurredAt": "2026-09-25T12:01:00Z"}],
    }
    with PaperStore(source_directory / LEDGER).transaction() as db:
        PaperStore.put(db, "batch", campaign["batchId"], {
            "id": campaign["batchId"], "userId": profile_id,
            "accountBinding": source._ledger_binding,
            "environment": "paper",
        })
        PaperStore.put(db, "campaign", campaign["id"], campaign)
        PaperStore.command(db, "snapshot-unknown", campaign["id"],
                           {"action": "submit", "batchId": campaign["batchId"], "ticketIndex": 0})
        record_fixture_fills(PaperStore, db, campaign)
    history = source.read(profile_id)
    latest = plans.load_latest(profile_id)
    parent = tmp_path / "private-snapshots"
    parent.mkdir()
    destination = create_private_snapshot(profile_store, parent / "one")
    assert destination == parent / "one"
    restored_profile = LocalProfileStore(base=destination)
    assert restored_profile.read_existing().profile_id == profile_id
    assert LocalModulePreferencesStore(restored_profile).load(profile_id).enabled_views == ("trading",)
    assert LocalPaperReferenceStore(restored_profile).load(profile_id).matches("DU654321")
    restored_binding = LocalBindingStore(restored_profile).load(profile_id)
    assert restored_binding == binding
    restored_source = LocalRecordedJournalSource.from_private_directory(
        ledger_directory=restored_profile.root / RECORDED_DIRECTORY,
        profile_id=profile_id,
        remembered_account_binding=binding.account_binding)
    assert restored_source.read(profile_id) == history
    assert history["uncertainCommandCount"] == 1
    assert history["currentExposure"] is None
    assert history["records"][0]["fees"] is None
    assert history["executionEnabled"] is False
    assert LocalSavedPlanStore(restored_profile,
                               LocalBindingStore(restored_profile)).load_latest(profile_id) == latest
    assert source.read(profile_id) == history


@pytest.mark.skipif(os.name != "nt", reason="Windows offline maintenance mutex")
def test_offline_private_snapshot_refuses_running_or_unknown_state(tmp_path):
    owner = tmp_path / "owner"
    owner.mkdir()
    profile_store, profile_id, _plans = prepared(owner)
    parent = tmp_path / "private-snapshots"
    parent.mkdir()
    destination = parent / "one"
    with WindowsStandaloneInstance.acquire(profile_store, profile_id):
        with pytest.raises(InstanceAlreadyRunning):
            create_private_snapshot(profile_store, destination)
    assert not destination.exists()
    unrelated = profile_store.root / "unreviewed.private"
    unrelated.write_bytes(b"preserve")
    with pytest.raises(LocalBackupUnavailable, match="Unknown private profile data"):
        create_private_snapshot(profile_store, destination)
    assert unrelated.read_bytes() == b"preserve" and not destination.exists()
    with pytest.raises(LocalBackupUnavailable, match="inside the active profile"):
        create_private_snapshot(profile_store, profile_store.root / "backup")


@pytest.mark.skipif(os.name != "nt", reason="Windows offline maintenance mutex")
@pytest.mark.parametrize("replacement", ["DU999999", "DU999921"])
def test_offline_private_snapshot_refuses_conflicting_paper_reference(tmp_path,
                                                                       replacement):
    owner = tmp_path / "owner"
    owner.mkdir()
    profile_store, profile_id, _plans = prepared(owner)
    reference_file = profile_store.root / "owner-paper-account.json"
    reference_file.unlink()
    LocalPaperReferenceStore(profile_store, clock=lambda: NOW).record_owner_attested(
        profile_id, replacement
    )
    parent = tmp_path / "private-snapshots"
    parent.mkdir()
    destination = parent / "one"
    with pytest.raises(LocalBackupUnavailable, match="paper reference"):
        create_private_snapshot(profile_store, destination)
    assert not destination.exists() and not list(parent.iterdir())


@pytest.mark.skipif(os.name != "nt", reason="Windows offline maintenance mutex")
@pytest.mark.parametrize("damage", ["missing-reference", "invalid-marker", "future-ledger"])
def test_offline_private_snapshot_preserves_damaged_source_without_publishing(tmp_path, damage):
    owner = tmp_path / "owner"
    owner.mkdir()
    profile_store, profile_id, _plans = prepared(owner)
    recorded = profile_store.root / RECORDED_DIRECTORY
    if damage == "missing-reference":
        (profile_store.root / "owner-paper-account.json").unlink()
    elif damage == "invalid-marker":
        (recorded / RECORDED_MARKER).write_bytes(b"not valid scope")
    else:
        with sqlite3.connect(recorded / LEDGER) as db:
            db.execute("PRAGMA user_version=2")
    before = {path.relative_to(profile_store.root): path.read_bytes()
              for path in profile_store.root.rglob("*") if path.is_file()}
    parent = tmp_path / "private-snapshots"
    parent.mkdir()
    destination = parent / "one"
    with pytest.raises((LocalBackupUnavailable, LocalJournalUnavailable)):
        create_private_snapshot(profile_store, destination)
    assert not destination.exists()
    assert not list(parent.iterdir())
    assert {path.relative_to(profile_store.root): path.read_bytes()
            for path in profile_store.root.rglob("*") if path.is_file()} == before


@pytest.mark.skipif(os.name != "nt", reason="Windows offline maintenance mutex")
def test_offline_private_snapshot_removes_only_its_failed_staging_copy(tmp_path, monkeypatch):
    owner = tmp_path / "owner"
    owner.mkdir()
    profile_store, _profile_id, _plans = prepared(owner)
    parent = tmp_path / "private-snapshots"
    parent.mkdir()
    unrelated = parent / "keep.txt"
    unrelated.write_bytes(b"keep")

    def failed_backup(_self, _destination):
        raise OSError("simulated backup failure")

    with monkeypatch.context() as patch:
        patch.setattr(PaperStore, "backup", failed_backup)
        with pytest.raises(OSError, match="simulated backup failure"):
            create_private_snapshot(profile_store, parent / "one")
    assert [path.name for path in parent.iterdir()] == ["keep.txt"]
    assert unrelated.read_bytes() == b"keep"
    assert (profile_store.root / RECORDED_DIRECTORY / LEDGER).is_file()


def test_changed_saved_content_refuses_read_without_leaking_to_another_profile(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    plan = complete_plan()
    store.save(profile_id, plan, None)
    with pytest.raises(LocalPlanUnavailable):
        store.load_current("another-profile", plan["planId"])
    ledger = profile_store.root / "paper-recorded" / "ledger.sqlite3"
    with sqlite3.connect(ledger) as db:
        db.execute("UPDATE objects SET body=? WHERE kind='local-plan-revision'",
                   ('{"savedPlan":{"symbol":"OTHER"}}',))
    with pytest.raises(LocalPlanUnavailable):
        store.load_current(profile_id, plan["planId"])
    with pytest.raises(LocalPlanUnavailable):
        store.save(profile_id, plan, None)
    with pytest.raises(LocalPlanUnavailable):
        store.load_latest(profile_id)


def test_last_saved_pointer_switches_plans_without_losing_older_revision(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    second = complete_plan()
    store.save(profile_id, first, None)
    store.save(profile_id, second, None,
               expected_active_revision=first["planRevision"])
    assert store.load_latest(profile_id)["planId"] == second["planId"]
    assert store.load_current(profile_id, first["planId"])["savedPlan"] == first
    ledger = profile_store.root / "paper-recorded" / "ledger.sqlite3"
    with sqlite3.connect(ledger) as db:
        db.execute("UPDATE objects SET body=? WHERE kind='local-plan-active'",
                   ('{"planId":"wrong-account"}',))
    with pytest.raises(LocalPlanUnavailable):
        store.load_latest(profile_id)
    with pytest.raises(LocalPlanUnavailable):
        store.scope_status(profile_id)


def test_replaying_an_old_save_cannot_make_it_the_latest_plan(tmp_path):
    _profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    second = complete_plan()
    store.save(profile_id, first, None)
    store.save(profile_id, second, None,
               expected_active_revision=first["planRevision"])
    assert store.load_latest(profile_id)["planId"] == second["planId"]

    # A delayed/uncertain response from the earlier Save must not hide B.
    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, first, None)
    assert store.load_latest(profile_id)["planId"] == second["planId"]
    assert store.load_current(profile_id, first["planId"])["savedPlan"] == first


def test_archived_revision_cannot_replace_a_newer_plan_head(tmp_path):
    _profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    newer = deepcopy(first)
    newer["planRevision"] = str(uuid.uuid4())
    newer["savedAt"] = "2026-09-25T12:01:00Z"
    store.save(profile_id, first, None)
    store.save(profile_id, newer, first["planRevision"],
               expected_active_revision=first["planRevision"])

    with pytest.raises(LocalPlanUnavailable, match="new revision"):
        store.save(profile_id, first, newer["planRevision"],
                   expected_active_revision=newer["planRevision"])
    assert store.load_latest(profile_id)["savedPlan"] == newer
    assert store.load_current(profile_id, first["planId"])["savedPlan"] == newer


def test_stale_editor_cannot_update_an_inactive_plan(tmp_path):
    _profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    second = complete_plan()
    store.save(profile_id, first, None)
    store.save(profile_id, second, None,
               expected_active_revision=first["planRevision"])
    stale_update = deepcopy(first)
    stale_update["planRevision"] = str(uuid.uuid4())
    stale_update["savedAt"] = "2026-09-25T12:01:00Z"

    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, stale_update, first["planRevision"])
    assert store.load_latest(profile_id)["savedPlan"] == second
    assert store.load_current(profile_id, first["planId"])["savedPlan"] == first


def test_new_plan_requires_the_latest_account_revision(tmp_path):
    _profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    second = complete_plan()
    stale_new_plan = complete_plan()
    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, first, None,
                   expected_active_revision=str(uuid.uuid4()))
    assert store.load_latest(profile_id) is None
    store.save(profile_id, first, None)
    store.save(profile_id, second, None,
               expected_active_revision=first["planRevision"])

    with pytest.raises(LocalPlanUnavailable, match="reopen"):
        store.save(profile_id, stale_new_plan, None,
                   expected_active_revision=first["planRevision"])
    assert store.load_latest(profile_id)["savedPlan"] == second
    assert store.load_current(profile_id, stale_new_plan["planId"]) is None


def test_save_cannot_silently_repair_a_missing_active_pointer(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    store.save(profile_id, first, None)
    ledger = profile_store.root / RECORDED_DIRECTORY / LEDGER
    with sqlite3.connect(ledger) as db:
        db.execute("DELETE FROM objects WHERE kind='local-plan-active'")
    newer = deepcopy(first)
    newer["planRevision"] = str(uuid.uuid4())

    with pytest.raises(LocalPlanUnavailable, match="active"):
        store.save(profile_id, newer, first["planRevision"])
    with pytest.raises(LocalPlanUnavailable, match="active"):
        store.save(profile_id, complete_plan(), None)
    assert store.load_latest(profile_id) is None


def test_new_save_cannot_hide_an_orphan_plan_head(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    store.save(profile_id, first, None)
    ledger = profile_store.root / RECORDED_DIRECTORY / LEDGER
    with sqlite3.connect(ledger) as db:
        db.execute("DELETE FROM objects WHERE kind IN ('local-plan-active', "
                   "'local-plan-revision')")
        assert db.execute("SELECT COUNT(*) FROM objects WHERE kind='local-plan-head'").fetchone()[0] == 1
    with pytest.raises(LocalPlanUnavailable, match="history"):
        store.save(profile_id, complete_plan(), None)
    assert store.load_latest(profile_id) is None


def local_client(tmp_path, profile_store, profile_id):
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile_id)
    client = TestClient(create_app(
        assets, port=8765, manager=manager, profile_store=profile_store,
        allow_testclient=True,
    ), base_url=ORIGIN)
    response = client.post("/v1/local/session/bootstrap", headers={
        "X-Brontide-Local": "1", "Origin": ORIGIN,
        "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert response.status_code == 200
    headers = {"X-Brontide-Local": "1", "Origin": ORIGIN,
               "X-Brontide-CSRF": response.json()["csrf"]}
    return client, manager, headers


def test_private_plan_routes_require_local_session_and_preserve_immutable_draft(tmp_path):
    profile_store, profile_id, _store = prepared(tmp_path)
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile_id)
    client = TestClient(create_app(
        assets, port=8765, manager=manager, profile_store=profile_store,
        allow_testclient=True,
    ), base_url=ORIGIN)
    plan = complete_plan()
    route = "/v1/local/plans"
    body = {"savedPlan": plan, "expectedRevision": None,
            "expectedScopeId": "a" * 64}
    assert client.post(route, headers={"X-Brontide-Local": "1", "Origin": ORIGIN,
                                       "X-Brontide-CSRF": "unissued"},
                       json=body).status_code == 401
    response = client.post("/v1/local/session/bootstrap", headers={
        "X-Brontide-Local": "1", "Origin": ORIGIN,
        "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert response.status_code == 200
    headers = {"X-Brontide-Local": "1", "Origin": ORIGIN,
               "X-Brontide-CSRF": response.json()["csrf"]}
    assert client.get(f"{route}/current", headers=headers).status_code == 404
    before = client.get(f"{route}/status", headers=headers)
    assert before.status_code == 200
    assert before.json()["hasSavedPlan"] is False
    assert before.json()["executionEnabled"] is False
    assert before.json()["reviewEligible"] is False
    assert len(before.json()["scopeId"]) == 64
    body["expectedScopeId"] = before.json()["scopeId"]
    assert client.post(route, headers={"X-Brontide-Local": "1", "Origin": ORIGIN},
                       json=body).status_code == 403
    assert client.post(route, headers={**headers, "Origin": "https://outside.invalid"},
                       json=body).status_code == 403
    assert client.post(route, headers=headers, json={**body, "submit": True}
                       ).status_code == 422
    assert client.post(route, headers=headers,
                       json={**body, "expectedScopeId": "b" * 64}
                       ).status_code == 409
    saved = client.post(route, headers=headers, json=body)
    assert saved.status_code == 200
    assert saved.headers["cache-control"] == "no-store"
    assert saved.json()["executionEnabled"] is False
    assert saved.json()["reviewEligible"] is False
    assert saved.json()["scopeId"] == before.json()["scopeId"]
    read = client.get(f"{route}/{plan['planId']}", headers=headers)
    assert read.status_code == 200
    assert read.json()["savedPlan"] == plan
    assert read.json()["executionEnabled"] is False
    assert client.get(f"{route}/current", headers=headers).json() == read.json()
    after = client.get(f"{route}/status", headers=headers)
    assert after.json() == {**before.json(), "hasSavedPlan": True}
    assert client.get(f"{route}/status", headers={
        "X-Brontide-Local": "1"}).status_code == 403
    assert client.get(f"{route}/{uuid.uuid4()}", headers=headers).status_code == 404
    assert client.get(f"{route}/{plan['planId']}", headers={
        "X-Brontide-Local": "1"}).status_code == 403
    altered = deepcopy(plan)
    altered["accountEquity"] = 40000
    assert client.post(route, headers=headers, json={**body, "savedPlan": altered}
                       ).status_code == 409
    manager.lock()
    assert client.get(f"{route}/{plan['planId']}", headers=headers).status_code == 401


def test_private_plan_route_rejects_stale_inactive_plan_update(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    client, _manager, headers = local_client(tmp_path, profile_store, profile_id)
    route = "/v1/local/plans"
    scope_id = store.scope_status(profile_id)["scopeId"]
    first = complete_plan()
    second = complete_plan()
    for plan, previous in ((first, None), (second, first["planRevision"])):
        response = client.post(route, headers=headers, json={
            "savedPlan": plan, "expectedRevision": None,
            "expectedScopeId": scope_id,
            "expectedActiveRevision": previous,
        })
        assert response.status_code == 200
        assert response.json()["executionEnabled"] is False
    third = complete_plan()
    for stale_active in (None, first["planRevision"]):
        assert client.post(route, headers=headers, json={
            "savedPlan": third, "expectedRevision": None,
            "expectedScopeId": scope_id,
            "expectedActiveRevision": stale_active,
        }).status_code == 409
    changed_active = deepcopy(second)
    changed_active["planRevision"] = str(uuid.uuid4())
    changed_active["savedAt"] = "2026-09-25T12:01:00Z"
    assert client.post(route, headers=headers, json={
        "savedPlan": changed_active, "expectedRevision": second["planRevision"],
        "expectedScopeId": scope_id,
        "expectedActiveRevision": first["planRevision"],
    }).status_code == 409
    stale = deepcopy(first)
    stale["planRevision"] = str(uuid.uuid4())
    stale["savedAt"] = "2026-09-25T12:01:00Z"
    response = client.post(route, headers=headers, json={
        "savedPlan": stale, "expectedRevision": first["planRevision"],
        "expectedScopeId": scope_id,
    })
    assert response.status_code == 409
    assert client.get(f"{route}/current", headers=headers).json()["savedPlan"] == second
    assert client.get(f"{route}/{first['planId']}", headers=headers).json()[
        "savedPlan"] == first
    assert client.get(f"{route}/{third['planId']}", headers=headers).status_code == 404


def test_private_plan_route_refuses_unprepared_or_wrongly_scoped_ledger(tmp_path):
    profile_store, profile_id, store = prepared(tmp_path)
    client, _manager, headers = local_client(tmp_path, profile_store, profile_id)
    plan = complete_plan()
    scope_id = store.scope_status(profile_id)["scopeId"]
    (profile_store.root / "paper-recorded" / "recorded-journal.json").unlink()
    response = client.post("/v1/local/plans", headers=headers,
                           json={"savedPlan": plan, "expectedScopeId": scope_id})
    assert response.status_code in (409, 503)
    assert "DU654321" not in response.text
    assert client.get(f"/v1/local/plans/{plan['planId']}", headers=headers
                      ).status_code in (409, 503)
    assert client.get("/v1/local/plans/status", headers=headers
                      ).status_code in (409, 503)


@pytest.mark.parametrize("reference_change", ["missing", "same-mask-different-reference"])
def test_private_plans_refuse_changed_owner_reference_without_losing_revisions(
    tmp_path, reference_change,
):
    profile_store, profile_id, store = prepared(tmp_path)
    first = complete_plan()
    saved = store.save(profile_id, first, None)
    client, _manager, headers = local_client(tmp_path, profile_store, profile_id)
    route = "/v1/local/plans"
    assert client.get(f"{route}/current", headers=headers).status_code == 200
    reference_path = profile_store.root / "owner-paper-account.json"
    original = reference_path.read_bytes()
    if reference_change == "missing":
        reference_path.unlink()
    else:
        changed = json.loads(original)
        changed["accountDigest"] = "f" * 64
        reference_path.write_text(json.dumps(changed), encoding="utf-8")
        assert changed["accountMask"] == json.loads(original)["accountMask"]
    after_change = reference_path.read_bytes() if reference_path.exists() else None
    second = deepcopy(first)
    second["planRevision"] = str(uuid.uuid4())
    second["savedAt"] = "2026-09-25T12:01:00Z"

    for read in (lambda: store.scope_status(profile_id),
                 lambda: store.load_latest(profile_id),
                 lambda: store.load_current(profile_id, first["planId"])):
        with pytest.raises(LocalPlanUnavailable, match="reference"):
            read()
    with pytest.raises(LocalPlanUnavailable, match="reference"):
        store.save(profile_id, second, first["planRevision"],
                   expected_scope_id=saved["scopeId"],
                   expected_active_revision=first["planRevision"])
    for path in (f"{route}/status", f"{route}/current",
                 f"{route}/{first['planId']}"):
        response = client.get(path, headers=headers)
        assert response.status_code in (409, 503)
        assert first["planId"] not in response.text
    response = client.post(route, headers=headers, json={
        "savedPlan": second, "expectedRevision": first["planRevision"],
        "expectedScopeId": saved["scopeId"],
        "expectedActiveRevision": first["planRevision"],
    })
    assert response.status_code in (409, 503)
    if after_change is None:
        assert not reference_path.exists()
    else:
        assert reference_path.read_bytes() == after_change
    with sqlite3.connect(profile_store.root / RECORDED_DIRECTORY / LEDGER) as db:
        assert db.execute("SELECT COUNT(*) FROM objects WHERE kind='local-plan-revision'") \
            .fetchone()[0] == 1

    reference_path.write_bytes(original)
    assert store.load_latest(profile_id)["savedPlan"] == first


@pytest.mark.parametrize("change", ["sample-origin", "sample-source", "missing-field",
                                     "wrong-profile", "no-ledger"])
def test_unqualified_plan_or_storage_creates_no_revision(tmp_path, change):
    profile_store, profile_id, store = prepared(tmp_path)
    plan = complete_plan()
    if change == "sample-origin":
        plan["origin"] = "acceptance generator"
    elif change == "sample-source":
        plan["capturedEntrySource"]["source"] = "Simulated fixture"
    elif change == "missing-field":
        del plan["sessionPolicy"]
    elif change == "wrong-profile":
        profile_id = "local-other"
    elif change == "no-ledger":
        (profile_store.root / "paper-recorded" / "recorded-journal.json").unlink()
    with pytest.raises(ValueError):
        store.save(profile_id, plan, None)
    ledger = profile_store.root / "paper-recorded" / "ledger.sqlite3"
    with sqlite3.connect(ledger) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM objects WHERE kind='local-plan-revision'"
        ).fetchone()[0] == 0
