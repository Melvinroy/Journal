"""An owner-attested paper reference is private, exact and not broker authority."""

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from brontide_eod.local_discovery import ManagedAccountDiscovery
from brontide_eod.local_paper_reference import (LocalPaperReferenceError,
                                                LocalPaperReferenceStore)
from brontide_eod.local_profile import LocalProfileStore


NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def setup(tmp_path):
    profiles = LocalProfileStore(base=tmp_path)
    profile = profiles.load_or_create()
    return profile, LocalPaperReferenceStore(profiles, clock=lambda: NOW)


def discovery(*, accounts=("U123456", "DU654321"),
              observed_at="2026-09-25T11:59:59Z"):
    return ManagedAccountDiscovery("generation-1234567890", "a" * 64,
                                   accounts, observed_at)


def test_owner_reference_is_private_and_only_matches_fresh_exact_account(tmp_path):
    profile, store = setup(tmp_path)
    assert store.load(profile.profile_id) is None
    saved = store.record_owner_attested(profile.profile_id, "DU654321")
    assert saved.account_mask == "DU••••21"
    assert saved.matches("DU654321") and not saved.matches("U123456")
    raw = store.path.read_text(encoding="utf-8")
    assert "DU654321" not in raw and "U123456" not in raw
    assert store.match_fresh_account(profile.profile_id, discovery()) == "DU654321"
    assert store.record_owner_attested(profile.profile_id, "DU654321") == saved
    assert store.path.read_text(encoding="utf-8") == raw
    assert LocalPaperReferenceStore(store.profile_store,
                                    clock=lambda: NOW).load(profile.profile_id) == saved


def test_reference_cannot_be_switched_or_assigned_to_another_profile(tmp_path):
    profile, store = setup(tmp_path)
    saved = store.record_owner_attested(profile.profile_id, "DU654321")
    original = store.path.read_bytes()
    with pytest.raises(LocalPaperReferenceError, match="different paper reference"):
        store.record_owner_attested(profile.profile_id, "U123456")
    with pytest.raises(LocalPaperReferenceError, match="profile changed"):
        store.record_owner_attested("local-other", "DU654321")
    with pytest.raises(LocalPaperReferenceError, match="profile changed"):
        store.load("local-other")
    assert store.path.read_bytes() == original
    assert store.load(profile.profile_id) == saved


@pytest.mark.parametrize("changed", [
    {"accounts": ("U123456",)},
    {"accounts": ("DU654321", "DU654321")},
    {"accounts": ("DU654321", "bad/account")},
    {"source_binding": "wrong"},
    {"connection_generation": "old"},
    {"observed_at": "2026-09-25T11:59:29Z"},
    {"observed_at": "2026-09-25T12:00:01Z"},
    {"observed_at": "not-a-time"},
])
def test_stale_changed_or_ambiguous_discovery_cannot_match(tmp_path, changed):
    profile, store = setup(tmp_path)
    store.record_owner_attested(profile.profile_id, "DU654321")
    with pytest.raises(LocalPaperReferenceError):
        store.match_fresh_account(profile.profile_id,
                                  replace(discovery(), **changed))


def test_absent_reference_or_invalid_input_never_creates_authority(tmp_path):
    profile, store = setup(tmp_path)
    with pytest.raises(LocalPaperReferenceError, match="owner-confirmed"):
        store.match_fresh_account(profile.profile_id, discovery())
    for account in ("", "du654321", "DU 654321", "DU654321\n"):
        with pytest.raises(LocalPaperReferenceError):
            store.record_owner_attested(profile.profile_id, account)
    assert not store.path.exists()


@pytest.mark.parametrize("mutation,loads", [
    (lambda row: {**row, "profileId": "local-other"}, False),
    (lambda row: {**row, "environment": "live"}, False),
    (lambda row: {**row, "schemaVersion": True}, False),
    (lambda row: {**row, "accountDigest": "0" * 64}, True),
    (lambda row: {**row, "accountMask": "DU••••99"}, True),
    (lambda row: {**row, "recordedAt": "not-a-time"}, False),
])
def test_malformed_or_foreign_reference_is_preserved_and_refused(
        tmp_path, mutation, loads):
    profile, store = setup(tmp_path)
    store.record_owner_attested(profile.profile_id, "DU654321")
    row = json.loads(store.path.read_text(encoding="utf-8"))
    bad = json.dumps(mutation(row)).encode("utf-8")
    store.path.write_bytes(bad)
    if loads:
        # A well-formed but changed digest can load, yet must not match.
        with pytest.raises(LocalPaperReferenceError):
            store.match_fresh_account(profile.profile_id, discovery())
    else:
        with pytest.raises(LocalPaperReferenceError):
            store.load(profile.profile_id)
    assert store.path.read_bytes() == bad
