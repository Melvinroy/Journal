"""The installed account-review route cannot promote browser claims to authority."""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from brontide_eod.local_binding import BrokerAccountObservation, LocalBindingStore
from brontide_eod.local_account_evidence import OwnerAttestedAccountEvidence
from brontide_eod.local_discovery import DiscoveryEndpoint, ManagedAccountDiscovery
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import create_app


ORIGIN = "http://127.0.0.1:8765"
ACCOUNTS = ("DU123456", "DU654321")


class FakeEvidence:
    def __init__(self):
        self.discover_calls = 0
        self.corroborate_calls = 0
        self.on_discover = lambda: None
        self.on_corroborate = lambda: None
        self.paper = True

    def discover(self):
        self.discover_calls += 1
        self.on_discover()
        return ManagedAccountDiscovery(
            "generation-1234567890", "a" * 64, ACCOUNTS,
            (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
        )

    def corroborate(self, discovery):
        self.corroborate_calls += 1
        self.on_corroborate()
        return BrokerAccountObservation(
            discovery.connection_generation, discovery.source_binding,
            discovery.accounts, "paper" if self.paper else "live", self.paper,
            True, True, datetime.now(timezone.utc),
        )


def setup(tmp_path, evidence=None, *, paper_account="DU123456",
          create_reference=True):
    base = tmp_path / "private"
    base.mkdir()
    profile_store = LocalProfileStore(base=base)
    profile = profile_store.load_or_create()
    if evidence is not None and create_reference:
        LocalPaperReferenceStore(profile_store).record_owner_attested(
            profile.profile_id, paper_account)
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(
        assets, port=8765, manager=manager, profile_store=profile_store,
        account_evidence=evidence, allow_testclient=True,
    ), base_url=ORIGIN)
    return client, manager, profile_store


def unlock(client, manager):
    response = client.post("/v1/local/session/bootstrap", headers={
        "X-Brontide-Local": "1", "Origin": ORIGIN,
        "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert response.status_code == 200
    return {"X-Brontide-Local": "1", "Origin": ORIGIN,
            "X-Brontide-CSRF": response.json()["csrf"]}


class BridgeProxy:
    """Inject the unmounted production bridge without installing a TWS caller."""

    def __init__(self):
        self.bridge = None

    def discover(self):
        return self.bridge.discover()

    def corroborate(self, discovery):
        return self.bridge.corroborate(discovery)


def setup_bridge(tmp_path):
    proxy = BridgeProxy()
    client, manager, profile_store = setup(tmp_path, proxy)
    profile_id = profile_store.read_existing().profile_id
    endpoint = DiscoveryEndpoint("127.0.0.1", 7947, 17)
    now = datetime.now(timezone.utc)
    observations = [
        ManagedAccountDiscovery("first-generation-1234567890", endpoint.binding(),
                                ACCOUNTS, (now - timedelta(seconds=2)).isoformat()),
        ManagedAccountDiscovery("second-generation-1234567890", endpoint.binding(),
                                ACCOUNTS, (now - timedelta(seconds=1)).isoformat()),
    ]
    calls = []

    def factory():
        def read():
            calls.append("account-list")
            return observations.pop(0)

        return SimpleNamespace(endpoint=endpoint, sdk_approved=True, discover=read)

    proxy.bridge = OwnerAttestedAccountEvidence(
        profile_store, profile_id, endpoint, sdk_approved=True,
        reader_factory=factory, clock=lambda: now,
    )
    return client, manager, profile_store, calls


def test_unmounted_bridge_and_normal_account_routes_keep_orders_locked(tmp_path):
    client, manager, profile_store, calls = setup_bridge(tmp_path)
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers)
    assert review.status_code == 200
    assert review.json()["executionEnabled"] is False
    assert "DU123456" not in review.text
    assert calls == ["account-list"]

    body = {"selectionId": review.json()["selectionId"], "index": 0,
            "typedAccount": "DU123456"}
    confirmed = client.post("/v1/local/account-selection/confirm",
                            headers=headers, json=body)
    assert confirmed.status_code == 200
    assert confirmed.json()["accountMask"] == "DU••••56"
    assert confirmed.json()["connectionVerified"] is False
    assert confirmed.json()["executionEnabled"] is False
    assert calls == ["account-list", "account-list"]
    saved = LocalBindingStore(profile_store).path.read_bytes()
    assert b"DU123456" not in saved
    assert client.post("/v1/local/account-selection/confirm",
                       headers=headers, json=body).status_code == 409
    assert LocalBindingStore(profile_store).path.read_bytes() == saved
    assert calls == ["account-list", "account-list"]


def test_unmounted_bridge_cannot_confirm_after_session_lock(tmp_path):
    client, manager, profile_store, calls = setup_bridge(tmp_path)
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers).json()
    manager.lock()
    refused = client.post("/v1/local/account-selection/confirm", headers=headers,
                          json={"selectionId": review["selectionId"], "index": 0,
                                "typedAccount": "DU123456"})
    assert refused.status_code == 401
    assert calls == ["account-list"]
    assert not LocalBindingStore(profile_store).path.exists()


def test_installed_route_stays_unavailable_without_server_broker_evidence(tmp_path):
    client, manager, profile = setup(tmp_path)
    headers = unlock(client, manager)
    assert client.get("/v1/local/binding", headers=headers).json()[
        "accountSelectionAvailable"] is False
    assert client.post("/v1/local/binding/check", headers=headers,
                       json={"typedAccount": "DU123456"}).json() == {
        "remembered": False, "exactMatch": False,
        "connectionVerified": False, "reconciliationRequired": True,
        "executionEnabled": False,
    }
    assert client.post("/v1/local/account-selection", headers=headers).status_code == 503
    assert client.post("/v1/local/account-selection/confirm", headers=headers,
                       json={"selectionId": "anything", "index": 0,
                             "typedAccount": "DU123456"}).status_code == 503
    assert not LocalBindingStore(profile).path.exists()


def test_only_local_authenticated_csrf_request_can_trigger_discovery(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    route = "/v1/local/account-selection"
    assert client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"}).status_code == 401
    assert client.post(route, headers={"X-Brontide-Local": "1", "Origin": ORIGIN,
                                       "X-Brontide-CSRF": "invalid"}
                       ).status_code == 401
    headers = unlock(client, manager)
    status = client.get("/v1/local/binding", headers=headers).json()
    assert status["accountSelectionAvailable"] is True
    assert status["executionEnabled"] is False
    assert client.post(route, headers={"X-Brontide-Local": "1", "Origin": ORIGIN}
                       ).status_code == 403
    assert client.post(route, headers={**headers, "Origin": "https://outside.invalid"}
                       ).status_code == 403
    assert client.post(route, headers={key: value for key, value in headers.items()
                                      if key != "Origin"}).status_code == 403
    assert evidence.discover_calls == 0
    review = client.post(route, headers=headers)
    assert review.status_code == 200
    assert review.headers["cache-control"] == "no-store"
    assert review.json()["candidates"] == [
        {"index": 0, "mask": "DU••••56"}, {"index": 1, "mask": "DU••••21"},
    ]
    assert review.json()["executionEnabled"] is False
    assert "DU123456" not in review.text
    assert not LocalBindingStore(profile).path.exists()


def test_failed_authenticated_rediscovery_retires_previous_account_review(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    previous = client.post("/v1/local/account-selection", headers=headers)
    assert previous.status_code == 200

    def unavailable():
        raise RuntimeError("fixture reader unavailable")

    evidence.on_discover = unavailable
    failed = client.post("/v1/local/account-selection", headers=headers)
    assert failed.status_code == 503
    old_choice = client.post("/v1/local/account-selection/confirm", headers=headers,
        json={"selectionId": previous.json()["selectionId"], "index": 0,
              "typedAccount": "DU123456"})
    assert old_choice.status_code == 409
    assert evidence.corroborate_calls == 0
    assert not LocalBindingStore(profile).path.exists()


def test_exact_confirmation_uses_only_correlated_server_evidence(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence,
                                     paper_account="DU654321")
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers).json()
    route = "/v1/local/account-selection/confirm"
    body = {"selectionId": review["selectionId"], "index": 1,
            "typedAccount": "DU654321"}
    assert client.post(route, headers=headers, json={**body, "paperIdentityVerified": True}
                       ).status_code == 422
    assert evidence.corroborate_calls == 0
    assert client.post(route, headers=headers, json={**body, "typedAccount": "DU123456"}
                       ).status_code == 409
    assert evidence.corroborate_calls == 0
    review = client.post("/v1/local/account-selection", headers=headers).json()
    body["selectionId"] = review["selectionId"]
    confirmed = client.post(route, headers=headers, json=body)
    assert confirmed.status_code == 200
    assert confirmed.json() == {
        "remembered": True, "environment": "paper", "accountMask": "DU••••21",
        "connectionVerified": False, "reconciliationRequired": True,
        "executionEnabled": False,
    }
    assert evidence.corroborate_calls == 1
    assert "DU654321" not in LocalBindingStore(profile).path.read_text(encoding="utf-8")
    assert client.get("/v1/local/binding", headers=headers).json()[
        "accountSelectionAvailable"] is False
    assert client.post(route, headers=headers, json=body).status_code == 409
    assert evidence.corroborate_calls == 1
    assert client.post("/v1/local/account-selection", headers=headers).status_code == 409
    assert evidence.discover_calls == 2


@pytest.mark.parametrize("replacement", ["DU654321", "DU999956"])
def test_changed_owner_reference_cannot_display_old_choice_as_remembered(tmp_path,
                                                                         replacement):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers).json()
    confirmed = client.post("/v1/local/account-selection/confirm", headers=headers,
        json={"selectionId": review["selectionId"], "index": 0,
              "typedAccount": "DU123456"})
    assert confirmed.status_code == 200
    assert client.get("/v1/local/binding", headers=headers).json()["remembered"] is True

    # Model a damaged/partially restored private setup with a different,
    # individually valid owner reference. Neither file grants orders.
    reference = LocalPaperReferenceStore(profile)
    saved_binding = LocalBindingStore(profile).path.read_bytes()
    reference.path.unlink()
    reference.record_owner_attested(profile._read().profile_id, replacement)
    assert client.get("/v1/local/paper-reference", headers=headers).status_code == 409
    assert client.post("/v1/local/paper-reference", headers=headers,
        json={"typedAccount": replacement, "repeatedAccount": replacement,
              "checkedInIbkrPaper": True}).status_code == 409
    status = client.get("/v1/local/binding", headers=headers)
    assert status.status_code == 503
    assert "DU••••56" not in status.text
    assert LocalBindingStore(profile).path.read_bytes() == saved_binding
    assert evidence.discover_calls == evidence.corroborate_calls == 1


def test_legacy_unlinked_binding_is_preserved_but_never_reported_ready(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers).json()
    assert client.post("/v1/local/account-selection/confirm", headers=headers,
        json={"selectionId": review["selectionId"], "index": 0,
              "typedAccount": "DU123456"}).status_code == 200
    binding = LocalBindingStore(profile).path
    legacy = json.loads(binding.read_text(encoding="utf-8"))
    legacy["schemaVersion"] = 1
    legacy.pop("ownerReferenceDigest")
    original = json.dumps(legacy).encode("utf-8")
    binding.write_bytes(original)

    assert client.get("/v1/local/binding", headers=headers).status_code == 503
    assert client.get("/v1/local/paper-reference", headers=headers).status_code == 409
    assert client.post("/v1/local/account-selection", headers=headers).status_code == 409
    assert client.post("/v1/local/binding/check", headers=headers,
        json={"typedAccount": "DU123456"}).status_code == 503
    assert binding.read_bytes() == original
    assert evidence.discover_calls == evidence.corroborate_calls == 1


def test_lost_confirmation_can_check_exact_saved_account_without_resubmission(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    check = "/v1/local/binding/check"
    expected_locked = {"remembered": False, "exactMatch": False,
                       "connectionVerified": False,
                       "reconciliationRequired": True, "executionEnabled": False}
    assert client.post(check, headers=headers,
                       json={"typedAccount": "DU123456"}).json() == expected_locked
    assert client.post(check, headers={"X-Brontide-Local": "1", "Origin": ORIGIN},
                       json={"typedAccount": "DU123456"}).status_code == 403
    assert client.post(check, headers={**headers, "Origin": "https://outside.invalid"},
                       json={"typedAccount": "DU123456"}).status_code == 403
    assert evidence.discover_calls == evidence.corroborate_calls == 0

    review = client.post("/v1/local/account-selection", headers=headers).json()
    confirmed = client.post("/v1/local/account-selection/confirm", headers=headers,
        json={"selectionId": review["selectionId"], "index": 0,
              "typedAccount": "DU123456"})
    assert confirmed.status_code == 200
    saved_bytes = LocalBindingStore(profile).path.read_bytes()
    assert client.post(check, headers=headers,
                       json={"typedAccount": "DU123456"}).json() == {
        **expected_locked, "remembered": True, "exactMatch": True,
    }
    # A different full ID can display the same mask. It must not pass.
    assert client.post(check, headers=headers,
                       json={"typedAccount": "DU999956"}).json() == {
        **expected_locked, "remembered": True,
    }
    assert client.post(check, headers=headers,
                       json={"typedAccount": "du123456"}).json()["exactMatch"] is False
    assert LocalBindingStore(profile).path.read_bytes() == saved_bytes
    assert evidence.discover_calls == evidence.corroborate_calls == 1
    manager.lock()
    assert client.post(check, headers=headers,
                       json={"typedAccount": "DU123456"}).status_code == 401


def test_missing_owner_paper_reference_cannot_bind_from_provider_claim(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence, create_reference=False)
    headers = unlock(client, manager)
    assert client.get("/v1/local/binding", headers=headers).json()[
        "accountSelectionAvailable"] is False
    refused = client.post("/v1/local/account-selection", headers=headers)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Paper account review is unavailable."
    assert evidence.discover_calls == evidence.corroborate_calls == 0
    assert not LocalBindingStore(profile).path.exists()


def test_reference_removed_during_discovery_cannot_create_review(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    reference = LocalPaperReferenceStore(profile)
    evidence.on_discover = lambda: reference.path.unlink()

    refused = client.post("/v1/local/account-selection", headers=headers)
    assert refused.status_code == 409
    assert evidence.discover_calls == 1
    assert evidence.corroborate_calls == 0
    assert not LocalBindingStore(profile).path.exists()


def test_account_bound_during_discovery_cannot_create_second_review(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    binding = LocalBindingStore(profile)

    def bind_during_discovery():
        binding.confirm(profile._read().profile_id, "DU123456", "DU123456",
            BrokerAccountObservation("generation-1234567890", "a" * 64,
                ACCOUNTS, "paper", True, True, True, datetime.now(timezone.utc)))

    evidence.on_discover = bind_during_discovery
    refused = client.post("/v1/local/account-selection", headers=headers)
    assert refused.status_code == 409
    assert evidence.discover_calls == 1
    assert evidence.corroborate_calls == 0
    assert binding.load(profile._read().profile_id).public_status()["executionEnabled"] is False


def test_other_discovered_account_cannot_replace_owner_paper_reference(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence,
                                     paper_account="DU654321")
    headers = unlock(client, manager)
    review = client.post("/v1/local/account-selection", headers=headers).json()
    refused = client.post("/v1/local/account-selection/confirm", headers=headers,
        json={"selectionId": review["selectionId"], "index": 0,
              "typedAccount": "DU123456"})
    assert refused.status_code == 409
    assert not LocalBindingStore(profile).path.exists()
    assert "DU654321" not in refused.text


def test_live_evidence_or_changed_session_never_saves_account(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    route = "/v1/local/account-selection/confirm"
    evidence.paper = False
    review = client.post("/v1/local/account-selection", headers=headers).json()
    body = {"selectionId": review["selectionId"], "index": 0,
            "typedAccount": "DU123456"}
    assert client.post(route, headers=headers, json=body).status_code == 409
    assert not LocalBindingStore(profile).path.exists()
    evidence.paper = True
    review = client.post("/v1/local/account-selection", headers=headers).json()
    body["selectionId"] = review["selectionId"]
    evidence.on_corroborate = manager.lock
    assert client.post(route, headers=headers, json=body).status_code == 401
    assert not LocalBindingStore(profile).path.exists()


def test_discovery_result_after_relaunch_cannot_create_review(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)
    evidence.on_discover = manager.lock
    assert client.post("/v1/local/account-selection", headers=headers).status_code == 401
    assert not LocalBindingStore(profile).path.exists()
    assert evidence.corroborate_calls == 0


def test_provider_failure_is_sanitized_and_does_not_save_account(tmp_path):
    evidence = FakeEvidence()
    client, manager, profile = setup(tmp_path, evidence)
    headers = unlock(client, manager)

    def fail():
        raise RuntimeError("private operator path and account must stay server-side")

    evidence.on_discover = fail
    failed_discovery = client.post("/v1/local/account-selection", headers=headers)
    assert failed_discovery.status_code == 503
    assert "private operator path" not in failed_discovery.text
    evidence.on_discover = lambda: None
    review = client.post("/v1/local/account-selection", headers=headers).json()
    evidence.on_corroborate = fail
    failed_confirmation = client.post("/v1/local/account-selection/confirm",
        headers=headers, json={"selectionId": review["selectionId"],
                               "index": 0, "typedAccount": "DU123456"})
    assert failed_confirmation.status_code == 503
    assert "private operator path" not in failed_confirmation.text
    assert not LocalBindingStore(profile).path.exists()

    review = client.post("/v1/local/account-selection", headers=headers).json()
    evidence.on_corroborate = lambda: (_ for _ in ()).throw(
        HTTPException(418, "private broker account evidence"))
    failed_confirmation = client.post("/v1/local/account-selection/confirm",
        headers=headers, json={"selectionId": review["selectionId"],
                               "index": 0, "typedAccount": "DU123456"})
    assert failed_confirmation.status_code == 503
    assert "private broker account evidence" not in failed_confirmation.text
    assert not LocalBindingStore(profile).path.exists()
