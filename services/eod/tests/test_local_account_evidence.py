"""The future Connect evidence bridge uses only fake read-only account lists."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from brontide_eod.local_account_evidence import (
    LocalAccountEvidenceUnavailable, OwnerAttestedAccountEvidence,
)
from brontide_eod.local_binding import BrokerAccountObservation, LocalBindingStore
from brontide_eod.local_discovery import DiscoveryEndpoint, ManagedAccountDiscovery
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore


NOW = datetime(2026, 9, 25, 14, tzinfo=timezone.utc)
ENDPOINT = DiscoveryEndpoint("127.0.0.1", 7947, 17)
ACCOUNTS = ("DU123456", "DU654321")


def prepared(tmp_path):
    base = tmp_path / "private"
    base.mkdir()
    store = LocalProfileStore(base=base)
    profile = store.load_or_create()
    LocalPaperReferenceStore(store, clock=lambda: NOW).record_owner_attested(
        profile.profile_id, "DU123456")
    return store, profile.profile_id


def observation(generation, *, accounts=ACCOUNTS, source=None, at=NOW):
    return ManagedAccountDiscovery(
        generation, source or ENDPOINT.binding(), accounts,
        at.isoformat().replace("+00:00", "Z"),
    )


def evidence(store, profile_id, results, *, now=None, approved=True):
    calls = []
    pending = list(results)
    current = now or [NOW]

    def reader_factory():
        calls.append("create")

        def read():
            calls.append("discover")
            result = pending.pop(0)
            if isinstance(result, Exception):
                raise result
            if callable(result):
                return result()
            return result

        return SimpleNamespace(endpoint=ENDPOINT, sdk_approved=True, discover=read)

    bridge = OwnerAttestedAccountEvidence(
        store, profile_id, ENDPOINT, sdk_approved=approved,
        reader_factory=reader_factory, clock=lambda: current[0],
    )
    return bridge, calls


def test_two_matching_reads_and_owner_reference_corroborate_without_orders(tmp_path):
    store, profile_id = prepared(tmp_path)
    now = [NOW]
    first = observation("first-generation-1234567890")
    second = observation("second-generation-1234567890",
                         at=NOW + timedelta(seconds=1))
    bridge, calls = evidence(store, profile_id, [first, second], now=now)
    reviewed = bridge.discover()
    assert reviewed is first
    assert reviewed.public_summary()["paperIdentityVerified"] is False
    now[0] += timedelta(seconds=1)
    corroborated = bridge.corroborate(reviewed)
    assert isinstance(corroborated, BrokerAccountObservation)
    assert corroborated.connection_generation == first.connection_generation
    assert corroborated.source_binding == ENDPOINT.binding()
    assert corroborated.accounts == ACCOUNTS
    assert corroborated.environment == "paper"
    assert corroborated.paper_identity_verified is True
    assert corroborated.sdk_compatible is True
    assert corroborated.api_usable is True
    assert corroborated.observed_at == NOW + timedelta(seconds=1)
    assert calls == ["create", "discover", "create", "discover"]
    assert LocalBindingStore(store).load(profile_id) is None
    with pytest.raises(LocalAccountEvidenceUnavailable, match="fresh account review"):
        bridge.corroborate(reviewed)


def test_sdk_approval_and_private_owner_reference_are_required_before_read(tmp_path):
    store, profile_id = prepared(tmp_path)
    first = observation("first-generation-1234567890")
    bridge, calls = evidence(store, profile_id, [first], approved=False)
    with pytest.raises(LocalAccountEvidenceUnavailable, match="approved supported"):
        bridge.discover()
    assert calls == []

    (store.root / "owner-paper-account.json").unlink()
    bridge, calls = evidence(store, profile_id, [first])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="owner-confirmed"):
        bridge.discover()
    assert calls == []


def test_changed_account_list_or_unobserved_owner_refuses_corroboration(tmp_path):
    store, profile_id = prepared(tmp_path)
    first = observation("first-generation-1234567890")
    changed = observation("second-generation-1234567890",
                          accounts=("DU123456", "DU999999"))
    bridge, calls = evidence(store, profile_id, [first, changed])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="Independent"):
        bridge.corroborate(bridge.discover())
    assert calls == ["create", "discover", "create", "discover"]

    missing_owner = observation("second-generation-1234567890",
                                accounts=("DU654321",))
    bridge, _calls = evidence(store, profile_id, [first, missing_owner])
    with pytest.raises(LocalAccountEvidenceUnavailable):
        bridge.corroborate(bridge.discover())

    same_generation = observation("first-generation-1234567890",
                                  at=NOW + timedelta(seconds=1))
    bridge, _calls = evidence(store, profile_id, [first, same_generation],
                              now=[NOW + timedelta(seconds=1)])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="Independent"):
        bridge.corroborate(bridge.discover())

    same_time = observation("second-generation-1234567890")
    bridge, _calls = evidence(store, profile_id, [first, same_time])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="evidence changed"):
        bridge.corroborate(bridge.discover())


def test_changed_reference_or_saved_binding_refuses_a_second_read(tmp_path):
    store, profile_id = prepared(tmp_path)
    first = observation("first-generation-1234567890")
    bridge, calls = evidence(store, profile_id, [first, first])
    bridge.discover()
    (store.root / "owner-paper-account.json").unlink()
    LocalPaperReferenceStore(store, clock=lambda: NOW).record_owner_attested(
        profile_id, "DU654321")
    with pytest.raises(LocalAccountEvidenceUnavailable, match="reference changed"):
        bridge.corroborate(first)
    assert calls == ["create", "discover"]

    (store.root / "owner-paper-account.json").unlink()
    LocalPaperReferenceStore(store, clock=lambda: NOW).record_owner_attested(
        profile_id, "DU123456")
    LocalBindingStore(store, clock=lambda: NOW).confirm(
        profile_id, "DU123456", "DU123456",
        BrokerAccountObservation(first.connection_generation, first.source_binding,
                                 first.accounts, "paper", True, True, True, NOW),
    )
    bridge, calls = evidence(store, profile_id, [first])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="unbound"):
        bridge.discover()
    assert calls == []


def test_stale_or_wrong_source_and_reader_error_fail_closed(tmp_path):
    store, profile_id = prepared(tmp_path)
    now = [NOW]
    stale = observation("first-generation-1234567890")
    now[0] += timedelta(seconds=31)
    bridge, _calls = evidence(store, profile_id, [stale], now=now)
    with pytest.raises(LocalAccountEvidenceUnavailable, match="Fresh"):
        bridge.discover()

    wrong_source = observation("first-generation-1234567890", source="a" * 64)
    bridge, _calls = evidence(store, profile_id, [wrong_source])
    with pytest.raises(LocalAccountEvidenceUnavailable, match="source changed"):
        bridge.discover()

    bridge, _calls = evidence(store, profile_id,
                              [RuntimeError("C:/private/DU123456-secret")])
    with pytest.raises(LocalAccountEvidenceUnavailable) as failure:
        bridge.discover()
    assert "private" not in str(failure.value)
    assert "DU123456" not in str(failure.value)


@pytest.mark.parametrize("invalid", [
    observation("short"),
    observation("first-generation-1234567890", accounts=()),
    observation("first-generation-1234567890", accounts=("DU123456", "DU123456")),
    observation("first-generation-1234567890", accounts=("not-an-account",)),
])
def test_malformed_reader_result_never_becomes_a_review(tmp_path, invalid):
    store, profile_id = prepared(tmp_path)
    bridge, calls = evidence(store, profile_id, [invalid])
    with pytest.raises(LocalAccountEvidenceUnavailable):
        bridge.discover()
    assert calls == ["create", "discover"]
