"""Account choice can be persisted only from fresh, corroborated paper evidence."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from brontide_eod import local_binding
from brontide_eod.local_binding import (BrokerAccountObservation, LocalBindingError,
                                        LocalBindingStore)
from brontide_eod.local_discovery import DiscoveryEndpoint
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.ibkr_tws import PaperGatewayConfig


NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def observation(**changes):
    original = BrokerAccountObservation(
        connection_generation="generation-1234567890",
        source_binding="a" * 64,
        accounts=("DU123456", "DU654321"),
        environment="paper",
        paper_identity_verified=True,
        sdk_compatible=True,
        api_usable=True,
        observed_at=NOW - timedelta(seconds=2),
    )
    return replace(original, **changes)


def setup(tmp_path, *, owner_account="DU654321"):
    profile_store = LocalProfileStore(base=tmp_path)
    profile = profile_store.load_or_create()
    if owner_account is not None:
        LocalPaperReferenceStore(profile_store).record_owner_attested(
            profile.profile_id, owner_account)
    return profile, LocalBindingStore(profile_store, clock=lambda: NOW)


def test_exact_multiple_account_choice_is_private_durable_and_stays_locked(tmp_path):
    profile, store = setup(tmp_path)
    assert store.load(profile.profile_id) is None
    selected = store.confirm(profile.profile_id, "DU654321", "DU654321", observation())
    assert selected.account_mask == "DU••••21"
    assert selected.public_status() == {
        "remembered": True, "environment": "paper", "accountMask": "DU••••21",
        "connectionVerified": False,
        "reconciliationRequired": True, "executionEnabled": False,
    }
    raw = store.path.read_text(encoding="utf-8")
    assert "DU654321" not in raw and "DU123456" not in raw
    stored_document = json.loads(raw)
    assert stored_document["schemaVersion"] == 2
    assert selected.matches_reference(
        LocalPaperReferenceStore(store.profile_store).load(profile.profile_id))
    assert stored_document["ownerReferenceDigest"] == selected.owner_reference_digest
    assert LocalBindingStore(store.profile_store, clock=lambda: NOW).load(profile.profile_id) == selected
    assert store.confirm(profile.profile_id, "DU654321", "DU654321", observation()) == selected
    assert store.path.read_text(encoding="utf-8") == raw


def test_missing_or_legacy_reference_link_preserves_private_binding_locked(tmp_path):
    profile, store = setup(tmp_path, owner_account=None)
    with pytest.raises(LocalBindingError, match="owner paper reference"):
        store.confirm(profile.profile_id, "DU654321", "DU654321", observation())
    assert not store.path.exists()

    reference = LocalPaperReferenceStore(store.profile_store)
    reference.record_owner_attested(profile.profile_id, "DU654321")
    store.confirm(profile.profile_id, "DU654321", "DU654321", observation())
    legacy = json.loads(store.path.read_text(encoding="utf-8"))
    legacy["schemaVersion"] = 1
    legacy.pop("ownerReferenceDigest")
    raw = json.dumps(legacy).encode("utf-8")
    store.path.write_bytes(raw)
    with pytest.raises(LocalBindingError):
        store.load(profile.profile_id)
    assert store.path.read_bytes() == raw


@pytest.mark.parametrize("selected,typed,changes", [
    ("DU654321", "DU123456", {}),
    ("DU000000", "DU000000", {}),
    ("DU654321", "DU654321", {"accounts": ()}),
    ("DU654321", "DU654321", {"accounts": ("DU654321", "DU654321")}),
    ("DU654321", "DU654321", {"accounts": ("DU654321", "bad/account")}),
    ("DU654321", "DU654321", {"environment": "live"}),
    ("DU654321", "DU654321", {"paper_identity_verified": False}),
    ("DU654321", "DU654321", {"sdk_compatible": False}),
    ("DU654321", "DU654321", {"api_usable": False}),
    ("DU654321", "DU654321", {"observed_at": NOW - timedelta(seconds=31)}),
    ("DU654321", "DU654321", {"observed_at": NOW + timedelta(seconds=1)}),
    ("DU654321", "DU654321", {"source_binding": "unknown"}),
    ("DU654321", "DU654321", {"connection_generation": "old"}),
])
def test_unverified_ambiguous_or_stale_choice_never_creates_binding(
    tmp_path, selected, typed, changes,
):
    profile, store = setup(tmp_path)
    with pytest.raises(LocalBindingError):
        store.confirm(profile.profile_id, selected, typed, observation(**changes))
    assert not store.path.exists()


def test_another_profile_or_account_cannot_be_adopted_or_silently_switched(tmp_path):
    profile, store = setup(tmp_path, owner_account="DU123456")
    before = store.confirm(profile.profile_id, "DU123456", "DU123456", observation())
    original = store.path.read_bytes()
    with pytest.raises(LocalBindingError, match="different paper account"):
        store.confirm(profile.profile_id, "DU654321", "DU654321", observation())
    with pytest.raises(LocalBindingError, match="different paper account"):
        store.confirm(profile.profile_id, "DU123456", "DU123456",
                      observation(source_binding="b" * 64))
    with pytest.raises(LocalBindingError, match="profile changed"):
        store.confirm("local-other-profile", "DU123456", "DU123456", observation())
    with pytest.raises(LocalBindingError, match="profile changed"):
        store.load("local-other-profile")
    assert store.path.read_bytes() == original
    assert store.load(profile.profile_id) == before


def test_competing_account_confirmations_preserve_exactly_one_binding(tmp_path):
    profile, store = setup(tmp_path, owner_account="DU123456")

    def choose(account):
        try:
            return store.confirm(profile.profile_id, account, account, observation())
        except LocalBindingError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        choices = list(pool.map(choose, ("DU123456", "DU654321")))
    winners = [choice for choice in choices if choice is not None]
    assert len(winners) == 1
    assert store.load(profile.profile_id) == winners[0]
    assert sum(winners[0].account_mask.endswith(suffix)
               for suffix in ("56", "21")) == 1


def test_returning_session_matches_exact_account_without_unlocking_execution(tmp_path):
    profile, store = setup(tmp_path)
    with pytest.raises(LocalBindingError, match="No confirmed"):
        store.matched_account_for_reconciliation(profile.profile_id, observation())
    stored = store.confirm(profile.profile_id, "DU654321", "DU654321", observation())
    assert store.matched_account_for_reconciliation(profile.profile_id, observation()) == "DU654321"
    assert stored.public_status()["reconciliationRequired"] is True
    assert stored.public_status()["executionEnabled"] is False
    with pytest.raises(LocalBindingError):
        store.matched_account_for_reconciliation(
            profile.profile_id, observation(accounts=("DU123456",)))
    with pytest.raises(LocalBindingError):
        store.matched_account_for_reconciliation(
            profile.profile_id, observation(source_binding="b" * 64))
    with pytest.raises(LocalBindingError):
        store.matched_account_for_reconciliation(
            profile.profile_id, observation(observed_at=NOW - timedelta(seconds=31)))
    with pytest.raises(LocalBindingError):
        store.matched_account_for_reconciliation(
            profile.profile_id, observation(paper_identity_verified=False))
    with pytest.raises(LocalBindingError):
        store.matched_account_for_reconciliation("local-other-profile", observation())


def test_candidate_ledger_scope_requires_exact_discovery_and_new_record_owner(tmp_path):
    profile, store = setup(tmp_path)
    endpoint = DiscoveryEndpoint("127.0.0.1", 7497, 91)
    verified = observation(source_binding=endpoint.binding())
    remembered = store.confirm(profile.profile_id, "DU654321", "DU654321", verified)
    gateway = PaperGatewayConfig("127.0.0.1", 7497, 92, "DU654321")

    scope = store.candidate_ledger_scope(profile.profile_id, verified, endpoint, gateway)
    assert scope.profile_id == profile.profile_id
    assert scope.remembered_account_binding == remembered.account_binding
    assert scope.paper_ledger_binding == gateway.binding()
    assert scope.paper_ledger_binding != scope.remembered_account_binding
    assert scope.matches_new_campaign({
        "userId": profile.profile_id, "accountBinding": gateway.binding(),
        "environment": "paper",
    })
    for campaign in (
        {"accountBinding": gateway.binding(), "environment": "paper"},
        {"userId": "local-other", "accountBinding": gateway.binding(), "environment": "paper"},
        {"userId": profile.profile_id, "accountBinding": remembered.account_binding,
         "environment": "paper"},
        {"userId": profile.profile_id, "accountBinding": gateway.binding(),
         "environment": "live"},
    ):
        assert not scope.matches_new_campaign(campaign)
    assert store.load(profile.profile_id).public_status()["executionEnabled"] is False


@pytest.mark.parametrize("changed", [
    {"host": "localhost"}, {"port": 7496}, {"account_id": "DU123456"},
])
def test_candidate_ledger_scope_rejects_changed_gateway(tmp_path, changed):
    profile, store = setup(tmp_path)
    endpoint = DiscoveryEndpoint("127.0.0.1", 7497, 91)
    verified = observation(source_binding=endpoint.binding())
    store.confirm(profile.profile_id, "DU654321", "DU654321", verified)
    gateway = PaperGatewayConfig("127.0.0.1", 7497, 92, "DU654321")
    with pytest.raises(LocalBindingError, match="differ"):
        store.candidate_ledger_scope(profile.profile_id, verified, endpoint,
                                     replace(gateway, **changed))


def test_candidate_ledger_scope_rejects_other_source_or_stale_paper_proof(tmp_path):
    profile, store = setup(tmp_path)
    endpoint = DiscoveryEndpoint("127.0.0.1", 7497, 91)
    verified = observation(source_binding=endpoint.binding())
    store.confirm(profile.profile_id, "DU654321", "DU654321", verified)
    gateway = PaperGatewayConfig("127.0.0.1", 7497, 92, "DU654321")
    for endpoint_or_observation in (
        (DiscoveryEndpoint("127.0.0.1", 7497, 93), verified),
        (endpoint, observation(source_binding="b" * 64)),
        (endpoint, replace(verified, paper_identity_verified=False)),
        (endpoint, replace(verified, observed_at=NOW - timedelta(seconds=31))),
    ):
        with pytest.raises(LocalBindingError):
            store.candidate_ledger_scope(profile.profile_id,
                                         endpoint_or_observation[1],
                                         endpoint_or_observation[0], gateway)


def test_corrupt_or_foreign_binding_fails_closed_without_replacement(tmp_path):
    profile, store = setup(tmp_path, owner_account="DU123456")
    saved = store.confirm(profile.profile_id, "DU123456", "DU123456", observation())
    original = json.loads(store.path.read_text(encoding="utf-8"))
    for modified in [
        {**original, "profileId": "local-foreign"},
        {**original, "submissionLocked": False},
        {**original, "reconciliationRequired": False},
        {**original, "accountBinding": "unverified"},
    ]:
        raw = json.dumps(modified).encode()
        store.path.write_bytes(raw)
        with pytest.raises(LocalBindingError):
            store.load(profile.profile_id)
        assert store.path.read_bytes() == raw
    store.path.write_bytes(json.dumps(original).encode())
    assert store.load(profile.profile_id) == saved
    store.path.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
    with pytest.raises(LocalBindingError):
        store.load(profile.profile_id)


def test_interrupted_atomic_write_leaves_no_claimed_binding(tmp_path, monkeypatch):
    profile, store = setup(tmp_path, owner_account="DU123456")

    def fail_replace(_source, _destination):
        raise OSError("simulated interruption")

    monkeypatch.setattr(local_binding.os, "replace", fail_replace)
    with pytest.raises(OSError, match="simulated interruption"):
        store.confirm(profile.profile_id, "DU123456", "DU123456", observation())
    assert not store.path.exists()
    assert not list(store.profile_store.root.glob(".paper-binding-*.tmp"))


def test_linked_binding_cannot_redirect_private_write(tmp_path):
    profile, store = setup(tmp_path, owner_account="DU123456")
    outside = tmp_path / "outside.txt"
    outside.write_text("private elsewhere", encoding="utf-8")
    try:
        os.symlink(outside, store.path)
    except OSError as exc:
        pytest.skip(f"Creating a test symlink is unavailable: {exc}")
    with pytest.raises(OSError, match="reparse"):
        store.confirm(profile.profile_id, "DU123456", "DU123456", observation())
    assert outside.read_text(encoding="utf-8") == "private elsewhere"
