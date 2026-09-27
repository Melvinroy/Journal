"""A new local paper ledger is prepared only for an exact confirmed scope."""

import json
import subprocess
import sys
import uuid
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from brontide_eod.ibkr_tws import PaperGatewayConfig
from brontide_eod.local_binding import (BrokerAccountObservation, LocalBindingError,
                                        LocalBindingStore)
from brontide_eod.local_discovery import DiscoveryEndpoint
from brontide_eod.local_journal import (LEDGER, RECORDED_DIRECTORY, RECORDED_MARKER,
                                        LocalJournalUnavailable)
from brontide_eod.local_modules import LocalModulePreferencesStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore, REFERENCE_FILE
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_recorded_store import LocalRecordedStorePreparation
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.paper_store import PaperStore
from brontide_eod.standalone import create_app


NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def record_fixture_fills(ledger, db, campaign):
    """Mirror the durable economic events written with a real paper fill."""
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


def fixture(tmp_path, *, confirm=True, reference_account="DU654321"):
    profile_store = LocalProfileStore(base=tmp_path)
    profile = profile_store.load_or_create()
    endpoint = DiscoveryEndpoint("127.0.0.1", 7497, 91)
    gateway = PaperGatewayConfig("127.0.0.1", 7497, 92, "DU654321")
    observation = BrokerAccountObservation(
        "generation-1234567890", endpoint.binding(), ("DU654321",),
        "paper", True, True, True, NOW,
    )
    binding_store = LocalBindingStore(profile_store, clock=lambda: NOW)
    paper_reference = LocalPaperReferenceStore(profile_store, clock=lambda: NOW)
    if confirm:
        paper_reference.record_owner_attested(profile.profile_id, "DU654321")
        binding_store.confirm(profile.profile_id, "DU654321", "DU654321", observation)
        if reference_account != "DU654321":
            paper_reference.path.unlink()
            if reference_account is not None:
                paper_reference.record_owner_attested(profile.profile_id,
                                                      reference_account)
    elif reference_account is not None:
        paper_reference.record_owner_attested(profile.profile_id, reference_account)
    preparer = LocalRecordedStorePreparation(profile_store, binding_store,
                                            paper_reference)
    return profile_store, profile, endpoint, gateway, observation, preparer


def test_exact_new_scope_prepares_empty_locked_ledger_without_legacy_import(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    legacy = tmp_path / "legacy.sqlite3"
    with PaperStore(legacy).transaction() as db:
        PaperStore.put(db, "campaign", "unowned", {"id": "unowned"})
    source = preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    directory = profile_store.root / RECORDED_DIRECTORY
    assert (directory / LEDGER).is_file()
    marker = json.loads((directory / RECORDED_MARKER).read_text(encoding="utf-8"))
    assert marker == {
        "schemaVersion": 1, "syntheticOnly": False,
        "profileId": profile.profile_id,
        "accountBinding": preparer.binding_store.load(profile.profile_id).account_binding,
        "paperLedgerBinding": gateway.binding(), "environment": "paper",
    }
    view = source.read(profile.profile_id)
    assert view["historyStatus"] == "no-records"
    assert view["currentExposure"] is None and view["ordersCleared"] is None
    assert view["records"] == [] and view["executionEnabled"] is False
    original_marker = (directory / RECORDED_MARKER).read_bytes()
    assert preparer.prepare(profile.profile_id, observation, endpoint, gateway).read(
        profile.profile_id) == view
    assert (directory / RECORDED_MARKER).read_bytes() == original_marker
    assert legacy.is_file()


def test_fake_paper_service_and_recorded_journal_share_one_scoped_ledger(tmp_path):
    """Exercise the actual service writer and Journal reader on one private DB."""
    from brontide_eod.ibkr_tws import create_operator_verification
    from brontide_eod.paper_plan import generated_plan
    from brontide_eod.paper_service import PaperService
    from test_paper_lifecycle import FakeTransport, ticket

    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    gateway = replace(gateway, client_id=71)
    source = preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    ledger = PaperStore(profile_store.root / RECORDED_DIRECTORY / LEDGER)
    fake = FakeTransport()
    fake.config = replace(gateway, submissions_enabled=True)  # isolated fake only
    fake.verification = create_operator_verification(
        fake.config, gateway.account_id, "TWS", datetime.now(timezone.utc).isoformat())
    fake._managed_accounts = [gateway.account_id]
    fake.authorized_account = gateway.account_id
    service = PaperService(ledger, factory=lambda: fake, source=lambda: "isolated-source")
    service.client = fake
    service.connection_id = "isolated-connection"
    service.authenticated(profile.profile_id)
    try:
        order = ticket(quantity=1, exitPlan={"schemaVersion": 1, "legs": [{
            "id": "target-1", "role": "Target", "allocationPercent": 100,
            "target": {"mode": "R", "multipleR": 1},
        }], "breakeven": {"activationR": 1,
                           "favorableOffset": {"unit": "Dollar", "value": 0}}},
            planId=str(uuid.uuid4()), planRevision=str(uuid.uuid4()),
            planningSource="Manual")
        saved = generated_plan(order, datetime.now(timezone.utc).isoformat())
        del saved["origin"]
        saved.update(accountEquity=30000, sizingEquity=30000,
                     riskPercent=.5, maxAllocationPercent=15,
                     sizingBasis={"source": "Legacy planning equity",
                                  "currency": "USD", "value": 30000},
                     sessionPolicy={"sessionMode": "Regular"})
        order["savedPlan"] = saved
        batch = service.prepare_batch([order])
        service.approve(batch["id"], batch["digest"], "isolated-approval")
        service.submit(batch["id"], 0, "isolated-entry")
        service._events()
        campaign = ledger.all("campaign")[0]
        for slot in campaign["slots"]:
            fake.fill(slot["entry"]["orderId"], 100)
        observed_at = datetime.now(timezone.utc).isoformat()
        for event in fake.events:
            if event.get("kind") == "execution":
                event["account"] = gateway.account_id
                event["executedAt"] = observed_at
        service._events()

        campaign = ledger.all("campaign")[0]
        history = source.read(profile.profile_id)
        assert history["historyStatus"] == "recorded"
        assert history["executionEnabled"] is False
        assert history["currentExposure"] is None
        assert history["ordersCleared"] is None
        assert len(history["records"]) == 1
        row = history["records"][0]
        assert row["campaignId"] == campaign["id"]
        assert row["entered"] == 1 and row["recordedOpenQuantity"] == 1
        assert row["exited"] == 0
        public_summary = service.public_campaign(campaign)["summary"]
        journal_summary = history["journalCampaigns"][0]["summary"]
        for key in ("entered", "exited", "openQuantity", "grossRealized",
                    "fees", "netRealized", "finalNetR"):
            assert journal_summary[key] == public_summary[key]
        assert len(history["journalCampaigns"][0]["executions"]) == 1
        assert source.read(profile.profile_id) == history  # replay reads no duplicate

        fake.bid, fake.ask = 103, 103.01
        service._automate(campaign)
        service._events()
        campaign = ledger.all("campaign")[0]
        target = campaign["slots"][0]["exit"]
        fake.fill(target["orderId"], 102, fee=None)
        for event in fake.events:
            if event.get("kind") == "execution":
                event["account"] = gateway.account_id
                event["executedAt"] = datetime.now(timezone.utc).isoformat()
        service._events()

        closed = ledger.all("campaign")[0]
        history = source.read(profile.profile_id)
        row = history["records"][0]
        assert closed["state"] == row["state"] == "Closed"
        assert row["entered"] == row["exited"] == 1
        assert row["recordedOpenQuantity"] == 0
        assert row["grossRealized"] == 2
        assert row["fees"] is None and row["netRealized"] is None
        assert history["journalCampaigns"][0]["summary"]["netRealized"] is None

        fake.events.append({"kind": "commission",
                            "executionId": "E" + str(target["orderId"]),
                            "commission": .1, "currency": "USD",
                            "eventId": "isolated-late-fee"})
        service._events()
        closed = ledger.all("campaign")[0]
        history = source.read(profile.profile_id)
        row = history["records"][0]
        assert len(history["records"]) == 1
        assert row["fees"] == pytest.approx(0.2)
        assert row["netRealized"] == pytest.approx(1.8)
        assert len(history["journalCampaigns"][0]["executions"]) == 2
        closed_summary = service.public_campaign(closed)["summary"]
        for key in ("entered", "exited", "openQuantity", "grossRealized",
                    "fees", "netRealized", "finalNetR"):
            assert history["journalCampaigns"][0]["summary"][key] == closed_summary[key]
        assert history["currentExposure"] is None
        assert history["ordersCleared"] is None
    finally:
        service.shutdown()

    # A fresh local session can read the closed record after the writer quits.
    # This is the same protected HTTP route the standalone Journal uses.
    assets = tmp_path / "integrated-assets"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Isolated app</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    origin = "http://127.0.0.1:8765"
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store,
                                   allow_testclient=True), base_url=origin)
    headers = {"X-Brontide-Local": "1"}
    assert client.get("/v1/local/journal/recorded", headers=headers).status_code == 401
    unlocked = client.post("/v1/local/session/bootstrap", headers={
        **headers, "Origin": origin, "X-Brontide-Bootstrap": manager.issue_bootstrap()})
    assert unlocked.status_code == 200
    view = client.get("/v1/local/journal/recorded", headers=headers)
    assert view.status_code == 200
    assert view.json()["records"][0]["state"] == "Closed"
    assert view.json()["records"][0]["netRealized"] == pytest.approx(1.8)
    assert view.json()["currentExposure"] is None
    assert view.json()["ordersCleared"] is None


def test_orphan_economic_execution_never_looks_like_no_records(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    source = preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    ledger = PaperStore(profile_store.root / RECORDED_DIRECTORY / LEDGER)
    with ledger.transaction() as db:
        ledger.event(db, "exec-v1:orphan-fill", {"executionId": "orphan-fill"})

    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(profile.profile_id)
    with ledger.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM events WHERE id='exec-v1:orphan-fill'").fetchone()[0] == 1


def test_future_economic_event_never_looks_like_no_records(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    source = preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    ledger = PaperStore(profile_store.root / RECORDED_DIRECTORY / LEDGER)
    with ledger.transaction() as db:
        ledger.event(db, "exec-v2:orphan-fill", {"executionId": "orphan-fill", "schemaVersion": 2})

    with pytest.raises(LocalJournalUnavailable, match="economic evidence"):
        source.read(profile.profile_id)
    with ledger.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM events WHERE id='exec-v2:orphan-fill'").fetchone()[0] == 1


@pytest.mark.parametrize("change", ["unconfirmed", "missing-reference",
                                     "different-reference", "submissions-on", "stale",
                                     "wrong-endpoint", "wrong-account", "wrong-profile"])
def test_missing_or_changed_authority_creates_no_ledger(tmp_path, change):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(
        tmp_path, confirm=change != "unconfirmed",
        reference_account=(None if change == "missing-reference" else
                           "DU123456" if change == "different-reference" else
                           "DU654321"))
    if change == "submissions-on":
        gateway = replace(gateway, submissions_enabled=True)
    elif change == "stale":
        observation = replace(observation, observed_at=NOW - timedelta(minutes=1))
    elif change == "wrong-endpoint":
        endpoint = replace(endpoint, client_id=99)
    elif change == "wrong-account":
        gateway = replace(gateway, account_id="DU123456")
    profile_id = "local-other" if change == "wrong-profile" else profile.profile_id
    with pytest.raises((ValueError, LocalBindingError)):
        preparer.prepare(profile_id, observation, endpoint, gateway)
    assert not (profile_store.root / RECORDED_DIRECTORY).exists()


def test_reference_from_another_profile_store_is_rejected(tmp_path):
    profile_store, _profile, _endpoint, _gateway, _observation, preparer = fixture(tmp_path)
    foreign = LocalProfileStore(base=tmp_path / "another")
    with pytest.raises(ValueError, match="must share one owner"):
        LocalRecordedStorePreparation(profile_store, preparer.binding_store,
                                      LocalPaperReferenceStore(foreign, clock=lambda: NOW))


def test_existing_mismatched_or_incomplete_ledger_is_preserved(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    directory = profile_store.root / RECORDED_DIRECTORY
    directory.mkdir()
    (directory / "unrelated.txt").write_text("preserve me", encoding="utf-8")
    with pytest.raises(LocalJournalUnavailable):
        preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    assert (directory / "unrelated.txt").read_text(encoding="utf-8") == "preserve me"


def test_existing_valid_ledger_cannot_change_configuration_or_lose_records(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    directory = profile_store.root / RECORDED_DIRECTORY
    marker = directory / RECORDED_MARKER
    before = marker.read_bytes()
    changed_gateway = replace(gateway, client_id=93)
    with pytest.raises((ValueError, LocalBindingError)):
        preparer.prepare(profile.profile_id, observation, endpoint, changed_gateway)
    assert marker.read_bytes() == before
    assert (directory / LEDGER).is_file()


def test_existing_ledger_is_preserved_but_unavailable_without_paper_reference(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    directory = profile_store.root / RECORDED_DIRECTORY
    original_marker = (directory / RECORDED_MARKER).read_bytes()
    original_ledger = (directory / LEDGER).read_bytes()
    (profile_store.root / REFERENCE_FILE).unlink()
    with pytest.raises(ValueError, match="paper account reference"):
        preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    assets = tmp_path / "private-reference-assets"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Isolated local app</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    origin = "http://127.0.0.1:8765"
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store, allow_testclient=True),
                        base_url=origin)
    headers = {"X-Brontide-Local": "1"}
    unlocked = client.post("/v1/local/session/bootstrap", headers={
        **headers, "Origin": origin, "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert unlocked.status_code == 200
    unavailable = client.get("/v1/local/journal/recorded", headers=headers)
    assert unavailable.status_code == 503
    assert unavailable.json() == {"detail": "Recorded Journal history is unavailable."}
    assert (directory / RECORDED_MARKER).read_bytes() == original_marker
    assert (directory / LEDGER).read_bytes() == original_ledger


def test_recorded_history_survives_a_fresh_process_without_broker(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    ledger = PaperStore(profile_store.root / RECORDED_DIRECTORY / LEDGER)
    batch = {"id": "restart-batch", "userId": profile.profile_id,
             "accountBinding": gateway.binding(), "environment": "paper"}
    campaign = {
        "id": "restart-campaign", "batchId": batch["id"],
        "userId": profile.profile_id, "accountBinding": gateway.binding(),
        "environment": "paper", "state": "Partially filled",
        "createdAt": "2026-09-25T10:00:00Z",
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": "restart-plan", "quantity": 1,
                   "planningPrice": 100, "hardCap": 100,
                   "exitPlan": {"schemaVersion": 1, "legs": [{
                       "id": "target-1", "role": "Target", "allocationPercent": 100,
                       "target": {"mode": "R", "multipleR": 1},
                   }], "breakeven": {"activationR": 1,
                                      "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "executions": [{"executionId": "restart-entry", "orderId": 101,
                        "effect": "entry", "role": "entry", "quantity": 1,
                        "price": 100, "commission": None,
                        "occurredAt": "2026-09-25T10:01:00Z"}],
    }
    with ledger.transaction() as db:
        ledger.put(db, "batch", batch["id"], batch)
        ledger.put(db, "campaign", campaign["id"], campaign)
        ledger.command(db, "restart-command", campaign["id"],
                       {"action": "submit", "batchId": batch["id"], "ticketIndex": 0})
        record_fixture_fills(ledger, db, campaign)

    assets = tmp_path / "fresh-process-assets"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Isolated app</title>", encoding="utf-8")
    (assets / "_next").mkdir()

    # A separate interpreter constructs a fresh local service, authenticates
    # a new browser session and reads its protected route. It inherits no
    # TestClient, TWS client, session token or in-memory store object.
    reader = """
import json
import sys
from pathlib import Path
from fastapi.testclient import TestClient
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import create_app
request = json.load(sys.stdin)
store = LocalProfileStore(base=Path(request["base"]))
manager = LocalSessionManager(request["profile"])
origin = "http://127.0.0.1:8765"
client = TestClient(create_app(Path(request["assets"]), port=8765,
                               manager=manager, profile_store=store,
                               allow_testclient=True), base_url=origin)
headers = {"X-Brontide-Local": "1"}
assert client.get("/v1/local/journal/recorded", headers=headers).status_code == 401
unlocked = client.post("/v1/local/session/bootstrap", headers={
    **headers, "Origin": origin, "X-Brontide-Bootstrap": manager.issue_bootstrap()})
assert unlocked.status_code == 200
response = client.get("/v1/local/journal/recorded", headers=headers)
assert response.status_code == 200
view = response.json()
print(json.dumps({"status": view["historyStatus"],
                  "ids": [row["campaignId"] for row in view["records"]],
                  "feesUnknown": view["records"][0]["fees"] is None,
                  "unknownExposure": view["currentExposure"] is None,
                  "unresolved": view["uncertainCommandCount"],
                  "executionEnabled": view["executionEnabled"]}))
"""
    completed = subprocess.run(
        [sys.executable, "-c", reader],
        input=json.dumps({"base": str(tmp_path), "assets": str(assets),
                          "profile": profile.profile_id}),
        text=True, capture_output=True, timeout=15, check=True,
    )
    assert json.loads(completed.stdout) == {
        "status": "recorded", "ids": ["restart-campaign"],
        "feesUnknown": True,
        "unknownExposure": True, "unresolved": 1,
        "executionEnabled": False,
    }


def test_private_recorded_backup_retains_scope_unknown_fees_and_command(tmp_path):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    source = preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    original_directory = profile_store.root / RECORDED_DIRECTORY
    ledger = PaperStore(original_directory / LEDGER)
    batch = {"id": "backup-batch", "userId": profile.profile_id,
             "accountBinding": gateway.binding(), "environment": "paper"}
    campaign = {
        "id": "backup-campaign", "batchId": batch["id"],
        "userId": profile.profile_id, "accountBinding": gateway.binding(),
        "environment": "paper", "state": "Partially filled",
        "createdAt": "2026-09-25T10:00:00Z",
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": "backup-plan", "quantity": 1,
                   "planningPrice": 100, "hardCap": 100,
                   "exitPlan": {"schemaVersion": 1, "legs": [{
                       "id": "target-1", "role": "Target", "allocationPercent": 100,
                       "target": {"mode": "R", "multipleR": 1},
                   }], "breakeven": {"activationR": 1,
                                      "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "executions": [{"executionId": "backup-entry", "orderId": 101,
                        "effect": "entry", "role": "entry", "quantity": 1,
                        "price": 100, "commission": None,
                        "occurredAt": "2026-09-25T10:01:00Z"}],
    }
    with ledger.transaction() as db:
        ledger.put(db, "batch", batch["id"], batch)
        ledger.put(db, "campaign", campaign["id"], campaign)
        ledger.command(db, "backup-command", campaign["id"],
                       {"action": "submit", "batchId": batch["id"], "ticketIndex": 0})
        record_fixture_fills(ledger, db, campaign)

    before = source.read(profile.profile_id)
    restored_directory = tmp_path / "isolated-restored-private"
    ledger.backup(restored_directory / LEDGER)
    (restored_directory / RECORDED_MARKER).write_bytes(
        (original_directory / RECORDED_MARKER).read_bytes())
    binding = preparer.binding_store.load(profile.profile_id).account_binding
    restored = source.from_private_directory(
        ledger_directory=restored_directory, profile_id=profile.profile_id,
        remembered_account_binding=binding)
    after = restored.read(profile.profile_id)
    assert after == before
    assert after["records"][0]["fees"] is None
    assert after["records"][0]["netRealized"] is None
    assert after["uncertainCommandCount"] == 1
    assert after["currentExposure"] is None and after["ordersCleared"] is None
    assert after["executionEnabled"] is False
    with pytest.raises(LocalJournalUnavailable):
        restored.read("local-other")
    with pytest.raises(LocalJournalUnavailable):
        source.from_private_directory(
            ledger_directory=restored_directory, profile_id=profile.profile_id,
            remembered_account_binding="0" * 64)
    assert source.read(profile.profile_id) == before


def test_interrupted_preparation_is_not_silently_restarted(tmp_path, monkeypatch):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    from brontide_eod import local_recorded_store
    def failed_marker(*_args, **_kwargs):
        raise OSError("simulated interruption")
    with monkeypatch.context() as patch:
        patch.setattr(local_recorded_store.os, "open", failed_marker)
        with pytest.raises(OSError, match="simulated interruption"):
            preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    directory = profile_store.root / RECORDED_DIRECTORY
    assert (directory / LEDGER).is_file()
    assert not (directory / RECORDED_MARKER).exists()
    with pytest.raises(LocalJournalUnavailable):
        preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    assert (directory / LEDGER).is_file()


@pytest.mark.parametrize("journal_visible", [True, False])
def test_prepared_ledger_reaches_authenticated_history_when_journal_hidden(
        tmp_path, journal_visible):
    profile_store, profile, endpoint, gateway, observation, preparer = fixture(tmp_path)
    preparer.prepare(profile.profile_id, observation, endpoint, gateway)
    if not journal_visible:
        LocalModulePreferencesStore(profile_store).save(profile.profile_id, ["trading"])
    assets = tmp_path / "public"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Isolated local app</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    origin = "http://127.0.0.1:8765"
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store, allow_testclient=True),
                        base_url=origin)
    path = "/v1/local/journal/recorded"
    headers = {"X-Brontide-Local": "1"}
    assert client.get(path, headers=headers).status_code == 401
    unlocked = client.post("/v1/local/session/bootstrap", headers={
        **headers, "Origin": origin, "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert unlocked.status_code == 200
    modules = client.get("/v1/local/modules", headers=headers)
    assert modules.status_code == 200
    assert modules.json()["enabledViews"] == (["trading", "journal"]
                                             if journal_visible else ["trading"])
    empty = client.get(path, headers=headers)
    assert empty.status_code == 200
    assert empty.json()["historyStatus"] == "no-records"
    assert empty.json()["currentExposure"] is None
    assert empty.json()["executionEnabled"] is False

    batch = {"id": "batch-1", "userId": profile.profile_id,
             "accountBinding": gateway.binding(), "environment": "paper"}
    campaign = {
        "id": "campaign-1", "batchId": batch["id"], "userId": profile.profile_id,
        "accountBinding": gateway.binding(), "environment": "paper",
        "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                   "planId": "plan-1", "quantity": 1, "planningPrice": 100,
                   "hardCap": 100, "exitPlan": {"schemaVersion": 1, "legs": [
                       {"id": "target-1", "role": "Target", "allocationPercent": 100,
                        "target": {"mode": "R", "multipleR": 1}},
                   ], "breakeven": {"activationR": 1,
                                     "favorableOffset": {"unit": "Dollar", "value": 0}}}},
        "contract": {"conId": 42, "currency": "USD"},
        "state": "Partially filled", "createdAt": "2026-09-25T10:00:00Z",
        "executions": [{"executionId": "entry-1", "orderId": 101,
                        "effect": "entry", "role": "entry", "quantity": 1,
                        "price": 100, "commission": None,
                        "occurredAt": "2026-09-25T10:01:00Z"}],
    }
    ledger = PaperStore(profile_store.root / RECORDED_DIRECTORY / LEDGER)
    with ledger.transaction() as db:
        ledger.put(db, "batch", batch["id"], batch)
        ledger.put(db, "campaign", campaign["id"], campaign)
        ledger.command(db, "submit-1", campaign["id"],
                       {"action": "submit", "batchId": batch["id"], "ticketIndex": 0})
        record_fixture_fills(ledger, db, campaign)
    response = client.get(path, headers=headers)
    assert response.status_code == 200
    history = response.json()
    assert history["historyStatus"] == "recorded"
    assert [record["campaignId"] for record in history["records"]] == ["campaign-1"]
    assert history["uncertainCommandCount"] == 1
    assert history["currentExposure"] is None and history["ordersCleared"] is None
    assert history["executionEnabled"] is False
    assert gateway.account_id not in response.text

    second_batch = {**batch, "id": "batch-2"}
    second = deepcopy(campaign)
    second.update(id="campaign-2", batchId=second_batch["id"], state="Closed",
                  createdAt="2026-09-25T10:02:00Z")
    second["ticket"].update(symbol="NEXT", planId="plan-2")
    second["contract"]["conId"] = 43
    second["executions"] = [
        {"executionId": "entry-2", "orderId": 201, "effect": "entry",
         "role": "entry", "quantity": 1, "price": 100, "commission": .1,
         "occurredAt": "2026-09-25T10:03:00Z"},
        {"executionId": "exit-2", "orderId": 202, "effect": "exit",
         "role": "target", "quantity": 1, "price": 102, "commission": .1,
         "occurredAt": "2026-09-25T10:04:00Z"},
    ]
    with ledger.transaction() as db:
        ledger.put(db, "batch", second_batch["id"], second_batch)
        ledger.put(db, "campaign", second["id"], second)
        record_fixture_fills(ledger, db, second)
    two_campaigns = client.get(path, headers=headers)
    assert two_campaigns.status_code == 200
    rows = {record["campaignId"]: record for record in two_campaigns.json()["records"]}
    assert set(rows) == {"campaign-1", "campaign-2"}
    assert rows["campaign-1"]["fees"] is None
    assert rows["campaign-2"]["netRealized"] == pytest.approx(1.8)
    assert two_campaigns.json()["uncertainCommandCount"] == 1

    second["executions"][1]["commission"] = .4
    with ledger.transaction() as db:
        ledger.put(db, "campaign", second["id"], second)
    revised = client.get(path, headers=headers)
    assert revised.status_code == 200
    revised_rows = {record["campaignId"]: record
                    for record in revised.json()["records"]}
    assert revised_rows["campaign-1"] == rows["campaign-1"]
    assert revised_rows["campaign-2"]["fees"] == pytest.approx(.5)
    assert revised_rows["campaign-2"]["netRealized"] == pytest.approx(1.5)
    assert revised.json()["uncertainCommandCount"] == 1

    manager.lock()
    assert client.get(path, headers=headers).status_code == 401
