"""Synthetic-only Journal reads never imply a broker connection or authority."""

from __future__ import annotations

import json
import shutil
import sqlite3
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brontide_eod.local_journal import (
    LEDGER, MARKER, RECORDED_DIRECTORY, RECORDED_MARKER, LocalJournalSource,
    LocalJournalUnavailable, LocalRecordedJournalSource,
)
from brontide_eod.local_binding import (BrokerAccountObservation, LocalBindingStore,
                                        LocalLedgerScope)
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.paper_store import PaperStore
from brontide_eod.standalone import create_app


PROFILE = "local-synthetic-profile"
BINDING = "fixture-paper-account-A"
CONTRACT_SAMPLE = Path(__file__).resolve().parents[3] / "tests/fixtures/synthetic-journal-v1.json"


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
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": "synthetic-plan-1", "quantity": 2,
                   "planningPrice": 100, "hardCap": 100,
                   "exitPlan": {"schemaVersion": 1, "legs": [
                       {"id": "target-1", "role": "Target", "allocationPercent": 100,
                        "target": {"mode": "R", "multipleR": 1}},
                   ], "breakeven": {"activationR": 1,
                                     "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "state": "Partially filled", "createdAt": "2026-09-24T10:00:00Z",
        "executions": [
            {"executionId": "entry-1", "orderId": 101, "effect": "entry", "role": "entry", "quantity": 2,
             "price": 100, "commission": .2, "occurredAt": "2026-09-24T10:01:00Z"},
            {"executionId": "exit-1", "orderId": 102, "effect": "exit", "role": "target", "quantity": 1,
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


def recorded_fixture(tmp_path):
    _, _, campaign = fixture(tmp_path)
    directory = tmp_path / "recorded"
    directory.mkdir()
    scope = LocalLedgerScope(PROFILE, "a" * 64, "b" * 64)
    (directory / RECORDED_MARKER).write_text(json.dumps({
        "schemaVersion": 1, "syntheticOnly": False,
        "profileId": PROFILE, "accountBinding": scope.remembered_account_binding,
        "paperLedgerBinding": scope.paper_ledger_binding, "environment": "paper",
    }), encoding="utf-8")
    campaign = deepcopy(campaign)
    campaign.pop("profileId")
    campaign.pop("syntheticOnly")
    campaign.update(userId=PROFILE, accountBinding=scope.paper_ledger_binding,
                    batchId="batch-1")
    batch = {"id": "batch-1", "userId": PROFILE,
             "accountBinding": scope.paper_ledger_binding, "environment": "paper"}
    store = PaperStore(directory / LEDGER)
    with store.transaction() as db:
        store.put(db, "batch", batch["id"], batch)
        store.put(db, "campaign", campaign["id"], campaign)
        store.command(db, "approval-1", batch["id"],
                      {"action": "approve", "digest": "a" * 64})
        store.command(db, "submit-1", campaign["id"],
                      {"action": "submit", "batchId": batch["id"], "ticketIndex": 0})
        for execution in campaign["executions"]:
            store.event(db, "exec:" + execution["executionId"],
                        {"executionId": execution["executionId"]})
    source = LocalRecordedJournalSource(ledger_directory=directory, scope=scope)
    return source, store, campaign, batch, scope


def test_recorded_economic_events_require_matching_projected_fills(tmp_path):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    with store.transaction() as db:
        store.event(db, "exec-v1:entry-1", {
            "schemaVersion": 1, "executionId": "entry-1", "account": "DU654321",
            "clientId": 92, "conId": 42, "orderId": 101,
            "orderRef": "fixture-entry", "side": "BOT", "quantity": 2.0,
            "price": 100.0, "executedAt": "2026-09-24T10:01:00Z",
        })
    assert source.read(PROFILE)["records"][0]["executionCount"] == 2

    with store.transaction() as db:
        store.event(db, "exec-v1:orphan-fill", {"executionId": "orphan-fill"})
    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(PROFILE)
    with store.transaction() as db:
        assert store.get(db, "campaign", campaign["id"])["executions"] == campaign["executions"]


@pytest.mark.parametrize("missing", ["one", "all"])
def test_recorded_fill_without_durable_economic_event_is_unavailable(tmp_path, missing):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    assert len(campaign["executions"]) == 2
    with store.transaction() as db:
        if missing == "one":
            db.execute("DELETE FROM events WHERE id='exec:exit-1'")
        else:
            db.execute("DELETE FROM events WHERE id GLOB 'exec*'")
    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(PROFILE)
    with store.transaction() as db:
        assert store.get(db, "campaign", campaign["id"])["executions"] == campaign["executions"]


def test_future_economic_event_cannot_be_ignored_beside_recorded_trade(tmp_path):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    with store.transaction() as db:
        store.event(db, "exec-v2:entry-1", {
            "schemaVersion": 2, "executionId": "entry-1", "orderId": 101,
        })

    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(PROFILE)
    with store.transaction() as db:
        assert store.get(db, "campaign", campaign["id"])["executions"] == campaign["executions"]


@pytest.mark.parametrize("field,value", [
    ("price", 101),
    ("orderId", 999),
    ("occurredAt", "2026-09-24T10:01:30Z"),
])
def test_recorded_fill_must_agree_with_durable_economic_event(tmp_path, field, value):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    with store.transaction() as db:
        store.event(db, "exec-v1:entry-1", {
            "schemaVersion": 1, "executionId": "entry-1", "account": "DU654321",
            "clientId": 92, "conId": 42, "orderId": 101,
            "orderRef": "fixture-entry", "side": "BOT", "quantity": 2.0,
            "price": 100.0, "executedAt": "2026-09-24T10:01:00Z",
        })
    assert source.read(PROFILE)["journalCampaigns"][0]["executions"][0]["price"] == 100

    campaign["executions"][0][field] = value
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(PROFILE)


def test_recorded_fee_without_projected_fill_makes_history_unavailable(tmp_path):
    source, store, _, _, _ = recorded_fixture(tmp_path)
    assert source.read(PROFILE)["historyStatus"] == "recorded"
    with store.transaction() as db:
        store.put(db, "fee", "missing-fill", {
            "kind": "commission", "executionId": "missing-fill",
            "commission": 0.25, "currency": "USD",
        })
    with pytest.raises(LocalJournalUnavailable, match="fee evidence"):
        source.read(PROFILE)


@pytest.mark.parametrize("change", ["commission", "currency", "executionId"])
def test_recorded_fee_must_agree_with_projected_fill(tmp_path, change):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    fee = {"kind": "commission", "executionId": "entry-1",
           "commission": 0.2, "currency": "USD"}
    with store.transaction() as db:
        store.put(db, "fee", "entry-1", fee)
    assert source.read(PROFILE)["records"][0]["fees"] is None

    if change == "commission":
        campaign["executions"][0]["commission"] = 0.3
        with store.transaction() as db:
            store.put(db, "campaign", campaign["id"], campaign)
    else:
        fee[change] = "CAD" if change == "currency" else "different-fill"
        with store.transaction() as db:
            store.put(db, "fee", "entry-1", fee)
    with pytest.raises(LocalJournalUnavailable, match="fee evidence"):
        source.read(PROFILE)


def test_recorded_history_does_not_reprice_an_exit_after_a_later_entry(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][0]["quantity"] = 1
    later_entry = deepcopy(campaign["executions"][0])
    later_entry.update(executionId="entry-2", orderId=103, price=110,
                       occurredAt="2026-09-24T10:03:00Z")
    campaign["executions"].append(later_entry)
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="protection and allocations"):
        source.read(PROFILE)
    campaign["state"] = "Needs reconciliation"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    row = source.read(PROFILE)["journalCampaigns"][0]
    assert row["summary"]["grossRealized"] == 2
    assert row["summary"]["averageEntry"] == 110
    assert row["summary"]["openQuantity"] == 1

    # A different-price entry at the exit's exact broker timestamp could
    # change which cost basis was sold; keep the recorded row but no result.
    later_entry["occurredAt"] = campaign["executions"][1]["occurredAt"]
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    uncertain = source.read(PROFILE)["journalCampaigns"][0]
    assert uncertain["state"] == "Needs reconciliation"
    assert uncertain["summary"]["grossRealized"] is None
    assert uncertain["summary"]["averageEntry"] is None


def test_ambiguous_recorded_cost_keeps_history_visible_without_inventing_result(tmp_path):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    campaign["executions"][0].update(quantity=1, commission=0.2)
    campaign["executions"][1]["commission"] = 0.1
    later_entry = deepcopy(campaign["executions"][0])
    later_entry.update(executionId="uncertain-entry", orderId=103, price=110,
                       commission=0, occurredAt=campaign["executions"][1]["occurredAt"])
    campaign["executions"].append(later_entry)
    campaign["state"] = "Needs reconciliation"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
        store.event(db, "exec:uncertain-entry",
                    {"executionId": "uncertain-entry"})
    view = source.read(PROFILE)
    assert len(view["records"]) == 1
    assert view["records"][0]["entered"] == 2
    assert view["records"][0]["recordedOpenQuantity"] == 1
    assert view["records"][0]["grossRealized"] is None
    assert view["records"][0]["fees"] == pytest.approx(0.3)
    assert view["records"][0]["netRealized"] is None
    assert view["journalCampaigns"][0]["state"] == "Needs reconciliation"
    assert view["journalCampaigns"][0]["summary"]["averageEntry"] is None


def test_recorded_local_reader_requires_explicit_scope_and_preserves_unknowns(tmp_path):
    source, store, campaign, _, scope = recorded_fixture(tmp_path)
    campaign["executions"][0].update(account="DU-PRIVATE", clientId=92,
                                     rawCallback={"private": "payload"})
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    before = store.path.read_bytes()
    result = source.read(PROFILE)
    assert store.path.read_bytes() == before
    assert result["source"] == "recorded-local-ledger"
    assert result["connectionStatus"] == "not-connected"
    assert result["currentExposure"] is None and result["ordersCleared"] is None
    assert result["uncertainCommandCount"] == 2
    assert result["records"][0]["id"] == "recorded:campaign-1"
    assert result["records"][0]["fees"] is None
    assert result["journalCampaigns"][0]["accountBinding"] == scope.remembered_account_binding
    assert result["journalCampaigns"][0]["syntheticOnly"] is False
    assert "DU-PRIVATE" not in json.dumps(result)
    assert "rawCallback" not in json.dumps(result)
    assert scope.paper_ledger_binding not in json.dumps(result)
    with pytest.raises(LocalJournalUnavailable, match="profile changed"):
        source.read("local-other")


@pytest.mark.parametrize("change", ["foreign-user", "foreign-ledger", "legacy-row",
                                     "synthetic-row", "missing-batch", "foreign-batch",
                                     "wrong-manifest", "orphan-command",
                                     "malformed-command", "missing-command-action",
                                     "unknown-command-action", "campaign-approve",
                                     "batch-order-write", "malformed-submit-shape",
                                     "malformed-approval-shape", "wrong-submit-batch",
                                     "unknown-order-role", "invalid-order-command"])
def test_recorded_local_reader_rejects_mixed_or_unowned_history(tmp_path, change):
    source, store, campaign, batch, scope = recorded_fixture(tmp_path)
    if change == "foreign-user":
        campaign["userId"] = "local-other"
    elif change == "foreign-ledger":
        campaign["accountBinding"] = "c" * 64
    elif change == "legacy-row":
        campaign.pop("userId")
    elif change == "synthetic-row":
        campaign["syntheticOnly"] = True
    elif change == "missing-batch":
        campaign["batchId"] = "missing"
    elif change == "foreign-batch":
        batch["userId"] = "local-other"
    elif change == "wrong-manifest":
        marker = source.directory / RECORDED_MARKER
        document = json.loads(marker.read_text(encoding="utf-8"))
        document["accountBinding"] = "c" * 64
        marker.write_text(json.dumps(document), encoding="utf-8")
    elif change == "orphan-command":
        with store.transaction() as db:
            store.command(db, "orphan", "another-account",
                          {"action": "submit", "batchId": batch["id"], "ticketIndex": 0})
    elif change in {"malformed-command", "missing-command-action", "unknown-command-action"}:
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='submit-1'", (
                "{" if change == "malformed-command" else
                '{"action":"future-unknown"}' if change == "unknown-command-action" else '{}',))
    elif change == "campaign-approve":
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='submit-1'",
                       (json.dumps({"action": "approve", "digest": "a" * 64}),))
    elif change == "batch-order-write":
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='approval-1'",
                       (json.dumps({"role": "entry", "orderId": 101,
                                    "cancel": False, "fields": {
                                        "account": "DU654321", "orderRef": "fixture",
                                        "action": "BUY", "totalQuantity": 1}}),))
    elif change == "malformed-submit-shape":
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='submit-1'",
                       (json.dumps({"action": "submit", "batchId": 42,
                                    "ticketIndex": 0}),))
    elif change == "malformed-approval-shape":
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='approval-1'",
                       (json.dumps({"action": "approve", "digest": "bad"}),))
    elif change == "wrong-submit-batch":
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='submit-1'",
                       (json.dumps({"action": "submit", "batchId": "other-batch",
                                    "ticketIndex": 0}),))
    elif change in {"unknown-order-role", "invalid-order-command"}:
        request = {"role": "entry", "orderId": 101, "cancel": False,
                   "fields": {"account": "DU654321", "orderRef": "fixture",
                              "action": "BUY", "totalQuantity": 1}}
        if change == "unknown-order-role":
            request["role"] = "future-write"
        else:
            request["orderId"] = 0
        with store.transaction() as db:
            db.execute("UPDATE commands SET request=? WHERE id='submit-1'",
                       (json.dumps(request),))
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
        store.put(db, "batch", batch["id"], batch)
    with pytest.raises(LocalJournalUnavailable):
        source.read(PROFILE)


def test_recorded_local_reader_never_returns_a_partial_mixed_ledger(tmp_path):
    source, store, campaign, _, scope = recorded_fixture(tmp_path)
    foreign = deepcopy(campaign)
    foreign.update(id="campaign-foreign", userId="local-other")
    foreign["executions"][0]["executionId"] = "foreign-entry"
    foreign["executions"][1]["executionId"] = "foreign-exit"
    with store.transaction() as db:
        store.put(db, "campaign", foreign["id"], foreign)
    with pytest.raises(LocalJournalUnavailable, match="unowned"):
        source.read(PROFILE)
    with store.transaction() as db:
        db.execute("DELETE FROM objects WHERE kind='campaign' AND id=?", (foreign["id"],))
    recovered = source.read(PROFILE)
    assert [row["campaignId"] for row in recovered["records"]] == [campaign["id"]]
    assert recovered["journalCampaigns"][0]["accountBinding"] == scope.remembered_account_binding


def test_recorded_local_reader_keeps_bounded_cleanup_distinct_from_manual(tmp_path):
    source, store, campaign, _, _ = recorded_fixture(tmp_path)
    campaign["executions"][1]["role"] = "cleanup"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    result = source.read(PROFILE)
    assert result["journalCampaigns"][0]["executions"][1]["role"] == "cleanup"
    campaign["executions"][1]["role"] = "manual"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="execution details"):
        source.read(PROFILE)


def test_protected_recorded_route_reads_only_confirmed_private_history(tmp_path, monkeypatch):
    source, store, campaign, batch, scope = recorded_fixture(tmp_path)
    profile_store = LocalProfileStore(base=tmp_path)
    profile = profile_store.load_or_create()
    manager = LocalSessionManager(profile.profile_id)
    assets = tmp_path / "public"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Local Journal</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    origin = "http://127.0.0.1:8765"
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store, allow_testclient=True),
                        base_url=origin)
    path = "/v1/local/journal/recorded"
    headers = {"X-Brontide-Local": "1"}
    assert client.get(path, headers=headers).status_code == 401
    bootstrap = client.post("/v1/local/session/bootstrap", headers={
        **headers, "Origin": origin, "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert bootstrap.status_code == 200
    assert client.get(path, headers=headers).status_code == 503  # No confirmed account.

    now = datetime.now(timezone.utc)
    observation = BrokerAccountObservation(
        connection_generation="generation-1234567890", source_binding="a" * 64,
        accounts=("DU123456",), environment="paper", paper_identity_verified=True,
        sdk_compatible=True, api_usable=True, observed_at=now)
    LocalPaperReferenceStore(profile_store, clock=lambda: now).record_owner_attested(
        profile.profile_id, "DU123456")
    remembered = LocalBindingStore(profile_store, clock=lambda: now).confirm(
        profile.profile_id, "DU123456", "DU123456", observation)
    marker = source.directory / RECORDED_MARKER
    manifest = json.loads(marker.read_text(encoding="utf-8"))
    manifest.update(profileId=profile.profile_id,
                    accountBinding=remembered.account_binding)
    marker.write_text(json.dumps(manifest), encoding="utf-8")
    campaign["userId"] = profile.profile_id
    batch["userId"] = profile.profile_id
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
        store.put(db, "batch", batch["id"], batch)
    private_dir = profile_store.root / RECORDED_DIRECTORY
    shutil.copytree(source.directory, private_dir)
    ledger_before = (private_dir / LEDGER).read_bytes()
    result = client.get(path, headers=headers)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    view = result.json()
    assert view["source"] == "recorded-local-ledger"
    assert view["uncertainCommandCount"] == 2
    assert view["currentExposure"] is None and view["ordersCleared"] is None
    assert "DU123456" not in result.text and scope.paper_ledger_binding not in result.text
    assert (private_dir / LEDGER).read_bytes() == ledger_before
    assert client.get(path, headers={**headers, "Origin": "https://outside.invalid"}).status_code == 403

    manifest["accountBinding"] = "c" * 64
    (private_dir / RECORDED_MARKER).write_text(json.dumps(manifest), encoding="utf-8")
    unavailable = client.get(path, headers=headers)
    assert unavailable.status_code == 503
    assert "DU123456" not in unavailable.text and str(private_dir) not in unavailable.text
    manifest["accountBinding"] = remembered.account_binding
    (private_dir / RECORDED_MARKER).write_text(json.dumps(manifest), encoding="utf-8")
    (private_dir / RECORDED_MARKER).unlink()
    assert client.get(path, headers=headers).status_code == 503
    (private_dir / RECORDED_MARKER).write_text(json.dumps(manifest), encoding="utf-8")

    owner_reference = LocalPaperReferenceStore(profile_store)
    original_reference = owner_reference.path.read_bytes()
    owner_reference.path.unlink()
    owner_reference.record_owner_attested(profile.profile_id, "DU999956")
    assert client.get(path, headers=headers).status_code == 503
    owner_reference.path.write_bytes(original_reference)

    original_read = LocalRecordedJournalSource.read
    binding_path = LocalBindingStore(profile_store).path
    binding_before = binding_path.read_bytes()
    def switch_binding_during_read(reader, principal_id):
        value = original_read(reader, principal_id)
        changed = json.loads(binding_before)
        changed["accountBinding"] = "c" * 64
        binding_path.write_text(json.dumps(changed), encoding="utf-8")
        return value
    monkeypatch.setattr(LocalRecordedJournalSource, "read", switch_binding_during_read)
    changed_binding = client.get(path, headers=headers)
    assert changed_binding.status_code == 503
    assert "DU123456" not in changed_binding.text and str(private_dir) not in changed_binding.text
    binding_path.write_bytes(binding_before)

    reference_path = LocalPaperReferenceStore(profile_store).path
    reference_before = reference_path.read_bytes()
    def remove_reference_during_read(reader, principal_id):
        value = original_read(reader, principal_id)
        reference_path.unlink()
        return value
    monkeypatch.setattr(LocalRecordedJournalSource, "read", remove_reference_during_read)
    changed_reference = client.get(path, headers=headers)
    assert changed_reference.status_code == 503
    assert "DU123456" not in changed_reference.text and str(private_dir) not in changed_reference.text
    reference_path.write_bytes(reference_before)

    def switch_ledger_scope_during_read(reader, principal_id):
        value = original_read(reader, principal_id)
        changed = dict(manifest, paperLedgerBinding="d" * 64)
        (private_dir / RECORDED_MARKER).write_text(json.dumps(changed), encoding="utf-8")
        return value
    monkeypatch.setattr(LocalRecordedJournalSource, "read", switch_ledger_scope_during_read)
    changed_ledger = client.get(path, headers=headers)
    assert changed_ledger.status_code == 503
    assert "DU123456" not in changed_ledger.text and str(private_dir) not in changed_ledger.text
    (private_dir / RECORDED_MARKER).write_text(json.dumps(manifest), encoding="utf-8")

    def lock_during_read(reader, principal_id):
        value = original_read(reader, principal_id)
        manager.lock()
        return value
    monkeypatch.setattr(LocalRecordedJournalSource, "read", lock_during_read)
    assert client.get(path, headers=headers).status_code == 401


def test_fixture_journal_route_requires_local_session_and_is_absent_from_default_app(tmp_path):
    source, _, _ = fixture(tmp_path)
    assets = tmp_path / "public"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Local fixture test</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(PROFILE)
    base = "http://127.0.0.1:8765"
    with pytest.raises(ValueError, match="only in isolated tests"):
        create_app(assets, port=8765, manager=manager, journal_source=source)
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   journal_source=source, allow_testclient=True),
                        base_url=base)
    path = "/v1/local/journal/fixture"
    assert client.get(path).status_code == 403
    assert client.get(path, headers={"X-Brontide-Local": "1"}).status_code == 401
    token = manager.issue_bootstrap()
    unlocked = client.post("/v1/local/session/bootstrap", headers={
        "Origin": base, "X-Brontide-Local": "1", "X-Brontide-Bootstrap": token,
    })
    assert unlocked.status_code == 200
    response = client.get(path, headers={"X-Brontide-Local": "1"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    record = response.json()
    assert record["source"] == "synthetic-ledger-fixture"
    assert record["executionEnabled"] is False
    assert record["currentExposure"] is None
    assert record["uncertainCommandCount"] == 1
    assert len(record["records"]) == 1
    assert client.get(path, headers={"Origin": "https://outside.invalid",
                                     "X-Brontide-Local": "1"}).status_code == 403
    (source.directory / MARKER).unlink()
    unavailable = client.get(path, headers={"X-Brontide-Local": "1"})
    assert unavailable.status_code == 503
    assert "synthetic" in unavailable.text.lower()
    assert str(source.directory) not in unavailable.text
    manager.lock()
    assert client.get(path, headers={"X-Brontide-Local": "1"}).status_code == 401

    default = TestClient(create_app(assets, port=8765, manager=LocalSessionManager(PROFILE),
                                    allow_testclient=True), base_url=base)
    assert default.get(path, headers={"X-Brontide-Local": "1"}).status_code == 404
    assert default.get("/v1/ibkr/paper/status").status_code == 404


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
    assert len(result["journalCampaigns"]) == 1
    row = result["records"][0]
    assert row["entered"] == 2 and row["exited"] == 1
    assert row["recordedOpenQuantity"] == 1
    assert row["grossRealized"] == 2
    assert row["fees"] is None and row["netRealized"] is None
    assert row["finalNetR"] is None and row["costsCompleteRecorded"] is False
    journal = result["journalCampaigns"][0]
    assert journal["summary"]["netRealized"] is None
    assert journal["executions"][1]["commission"] is None
    assert journal["syntheticOnly"] is True
    assert journal["ticket"]["exitPlan"]["legs"][0]["target"]["multipleR"] == 1
    assert "slots" not in journal and "brokerAccount" not in journal
    assert store.path.read_bytes() == before


def test_durable_ledger_projection_matches_browser_contract_sample(tmp_path):
    source, _, _ = fixture(tmp_path)
    expected = json.loads(CONTRACT_SAMPLE.read_text(encoding="utf-8"))
    assert source.read(PROFILE) == expected


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
    assert after["journalCampaigns"][0]["summary"]["netRealized"] == pytest.approx(1.7)
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
    assert empty["journalCampaigns"] == []
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


def test_two_campaigns_keep_accounting_and_command_uncertainty_separate(tmp_path):
    source, store, first = fixture(tmp_path)
    second = deepcopy(first)
    second["id"] = "campaign-2"
    second["ticket"]["symbol"] = "NEXT"
    second["ticket"]["planId"] = "synthetic-plan-2"
    second["contract"]["conId"] = 43
    second["state"] = "Closed"
    second["createdAt"] = "2026-09-24T10:03:00Z"
    second["executions"][0].update(executionId="entry-2", orderId=201,
                                    occurredAt="2026-09-24T10:04:00Z")
    second["executions"][1].update(executionId="exit-2", orderId=202,
                                    quantity=2, commission=.1,
                                    occurredAt="2026-09-24T10:05:00Z")
    with store.transaction() as db:
        store.put(db, "campaign", second["id"], second)
        assert store.command(db, "confirmed-2", second["id"], {"action": "synthetic"})
        db.execute("UPDATE commands SET state='confirmed' WHERE id='confirmed-2'")

    before = source.read(PROFILE)
    records = {row["campaignId"]: row for row in before["records"]}
    assert set(records) == {"campaign-1", "campaign-2"}
    assert before["uncertainCommandCount"] == 1
    assert before["lastRecordedAt"] == "2026-09-24T10:05:00Z"
    assert records["campaign-1"]["fees"] is None
    assert records["campaign-2"]["grossRealized"] == 4
    assert records["campaign-2"]["fees"] == pytest.approx(.3)
    assert records["campaign-2"]["netRealized"] == pytest.approx(3.7)

    second["executions"][1]["commission"] = .4
    with store.transaction() as db:
        store.put(db, "campaign", second["id"], second)
    after = source.read(PROFILE)
    revised = {row["campaignId"]: row for row in after["records"]}
    assert len(revised) == 2
    assert revised["campaign-1"] == records["campaign-1"]
    assert revised["campaign-2"]["fees"] == pytest.approx(.6)
    assert revised["campaign-2"]["netRealized"] == pytest.approx(3.4)
    assert after["uncertainCommandCount"] == 1


def test_recorded_time_rejects_malformed_values_and_orders_offsets_by_instant(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][1]["occurredAt"] = "not-a-time"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="timestamp"):
        source.read(PROFILE)

    # 12:00 at +02:00 precedes the 10:01 UTC entry despite the later wall clock.
    campaign["executions"][1]["occurredAt"] = "2026-09-24T12:00:00+02:00"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="precedes recorded inventory"):
        source.read(PROFILE)
    campaign["executions"][1]["occurredAt"] = "2026-09-24T12:30:00+02:00"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    result = source.read(PROFILE)
    assert result["lastRecordedAt"] == "2026-09-24T10:30:00Z"
    assert result["records"][0]["recordedAt"] == "2026-09-24T10:30:00Z"
    assert result["journalCampaigns"][0]["executions"][1]["occurredAt"] == "2026-09-24T10:30:00Z"


def test_fixture_preserves_microsecond_execution_order_and_rejects_ambiguous_ties(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][0]["occurredAt"] = "2026-09-24T10:01:00.123100Z"
    campaign["executions"][1]["occurredAt"] = "2026-09-24T10:01:00.123200Z"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    result = source.read(PROFILE)
    assert result["lastRecordedAt"] == "2026-09-24T10:01:00.123200Z"
    assert result["records"][0]["recordedAt"] == "2026-09-24T10:01:00.123200Z"
    campaign["executions"][1]["occurredAt"] = "2026-09-24T10:01:00.123100Z"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="precedes recorded inventory"):
        source.read(PROFILE)


def test_fixture_rejects_dates_outside_safe_microsecond_epoch(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["createdAt"] = "2400-01-01T00:00:00Z"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="timestamp"):
        source.read(PROFILE)


def test_journal_detail_strips_private_fields_and_rejects_invalid_fee(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["ticket"]["privateNote"] = "not a journal field"
    campaign["ticket"]["exitPlan"]["privateNote"] = "hidden plan text"
    campaign["ticket"]["exitPlan"]["legs"][0]["privateNote"] = "hidden leg text"
    campaign["executions"][0].update(account="DU-PRIVATE", clientId=903,
                                      rawCallback={"private": "payload"})
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    detail = source.read(PROFILE)["journalCampaigns"][0]
    assert detail["accountBinding"] == BINDING  # explicitly synthetic, never broker-discovered
    assert "privateNote" not in json.dumps(detail)
    assert "DU-PRIVATE" not in json.dumps(detail)
    assert "rawCallback" not in json.dumps(detail)
    assert detail["executions"][0]["orderId"] == 101
    campaign["executions"][1]["commission"] = "0.1"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="fee"):
        source.read(PROFILE)


def test_journal_detail_rejects_conflicting_role_quantity_and_closed_state(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][1]["role"] = "entry"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="execution details"):
        source.read(PROFILE)
    campaign["executions"][1]["role"] = "target"
    campaign["executions"][0]["quantity"] = 3
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="quantities conflict"):
        source.read(PROFILE)
    campaign["executions"][0]["quantity"] = 2
    campaign["state"] = "Closed"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="closed state"):
        source.read(PROFILE)


@pytest.mark.parametrize("field,value", [
    ("schemaVersion", True),
    ("syntheticOnly", 1),
])
def test_marker_requires_exact_schema_and_synthetic_boolean(tmp_path, field, value):
    source, _, _ = fixture(tmp_path)
    marker = source.directory / MARKER
    document = json.loads(marker.read_text(encoding="utf-8"))
    document[field] = value
    marker.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(LocalJournalUnavailable, match="scope"):
        source.read(PROFILE)


def test_campaign_and_exit_plan_require_exact_synthetic_and_schema_types(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["syntheticOnly"] = 1
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="unowned"):
        source.read(PROFILE)
    campaign["syntheticOnly"] = True
    campaign["ticket"]["exitPlan"]["schemaVersion"] = True
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="exit plan schema"):
        source.read(PROFILE)


@pytest.mark.parametrize("field,value", [
    ("symbol", "PRIVATE ACCOUNT 123"),
    ("planId", "C:/private/plan"),
])
def test_fixture_display_fields_reject_free_form_private_text(tmp_path, field, value):
    source, store, campaign = fixture(tmp_path)
    campaign["ticket"][field] = value
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable):
        source.read(PROFILE)


def test_execution_identity_rejects_free_form_private_text(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][0]["executionId"] = "private callback\naccount 123"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="execution identity"):
        source.read(PROFILE)


@pytest.mark.parametrize("field,value", [
    ("leg", "C:/private/target"),
    ("state", "private account note"),
])
def test_fixture_detail_rejects_free_form_leg_and_state_text(tmp_path, field, value):
    source, store, campaign = fixture(tmp_path)
    if field == "leg":
        campaign["ticket"]["exitPlan"]["legs"][0]["id"] = value
    else:
        campaign["state"] = value
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="identity|state"):
        source.read(PROFILE)


@pytest.mark.parametrize("field", ["execution-price", "fee", "ticket-price", "plan-target"])
def test_fixture_monetary_values_must_fit_browser_safe_magnitude(tmp_path, field):
    source, store, campaign = fixture(tmp_path)
    too_large = 1 << 53
    if field == "execution-price":
        campaign["executions"][0]["price"] = too_large
    elif field == "fee":
        campaign["executions"][0]["commission"] = too_large
    elif field == "ticket-price":
        campaign["ticket"]["planningPrice"] = too_large
    else:
        campaign["ticket"]["exitPlan"]["legs"][0]["target"]["multipleR"] = too_large
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable):
        source.read(PROFILE)


def test_fixture_rejects_ambiguous_same_instant_exit_and_empty_closed_trade(tmp_path):
    source, store, campaign = fixture(tmp_path)
    campaign["executions"][1]["occurredAt"] = campaign["executions"][0]["occurredAt"]
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="precedes recorded inventory"):
        source.read(PROFILE)
    campaign["executions"] = []
    campaign["state"] = "Closed"
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable, match="closed state"):
        source.read(PROFILE)


@pytest.mark.parametrize("field", ["quantity", "orderId", "conId"])
def test_fixture_rejects_integers_not_exact_in_browser(tmp_path, field):
    source, store, campaign = fixture(tmp_path)
    if field == "conId":
        campaign["contract"][field] = 1 << 53
    else:
        campaign["executions"][0][field] = 1 << 53
    with store.transaction() as db:
        store.put(db, "campaign", campaign["id"], campaign)
    with pytest.raises(LocalJournalUnavailable):
        source.read(PROFILE)
