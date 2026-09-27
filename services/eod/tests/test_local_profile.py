"""Standalone profile persistence never claims old cloud or broker records."""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from runpy import run_path

import pytest

from brontide_eod import local_profile
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.standalone import candidate_diagnostics
from brontide_eod.local_modules import LocalModulePreferencesStore
from brontide_eod.local_binding import BrokerAccountObservation, LocalBindingStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore


def test_profile_identity_and_view_survive_store_recreation(tmp_path):
    first = LocalProfileStore(base=tmp_path).load_or_create()
    assert first.profile_id.startswith("local-")
    assert first.selected_view == "connect"
    reopened = LocalProfileStore(base=tmp_path)
    assert reopened.load_or_create() == first
    changed = reopened.select_view("journal")
    assert changed.profile_id == first.profile_id
    assert LocalProfileStore(base=tmp_path).load_or_create() == changed
    assert reopened.select_view("trading").profile_id == first.profile_id


def test_read_existing_never_creates_a_missing_profile(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    assert store.read_existing() is None
    assert not store.root.exists()
    profile = store.load_or_create()
    assert store.read_existing() == profile
    before = store.path.read_bytes()
    assert store.read_existing() == profile
    assert store.path.read_bytes() == before


@pytest.mark.parametrize("orphan", ["owner-paper-account.json", "paper-recorded"])
def test_missing_profile_preserves_existing_private_state(tmp_path, orphan):
    store = LocalProfileStore(base=tmp_path)
    store.root.mkdir()
    candidate = store.root / orphan
    if orphan == "paper-recorded":
        candidate.mkdir()
        sentinel = candidate / "ledger.sqlite3"
    else:
        sentinel = candidate
    sentinel.write_bytes(b"preserve unknown private data")

    with pytest.raises(ValueError, match="profile is missing"):
        store.check_locked_sample_update()
    assert not store.path.exists()
    with pytest.raises(ValueError, match="profile is missing"):
        store.load_or_create()
    assert not store.path.exists()
    assert sentinel.read_bytes() == b"preserve unknown private data"


def test_profile_does_not_discover_or_edit_legacy_private_records(tmp_path):
    old = tmp_path / "Brontide"
    old.mkdir()
    legacy = old / "paper-owner.json"
    legacy.write_text('{"userId":"existing-cloud-user","accountBinding":"existing-broker"}')
    profile = LocalProfileStore(base=tmp_path).load_or_create()
    assert "existing-cloud-user" not in profile.profile_id
    assert "existing-broker" not in profile.profile_id
    assert legacy.read_text() == '{"userId":"existing-cloud-user","accountBinding":"existing-broker"}'
    assert json.loads((tmp_path / "BrontideStandalone" / "profile.json").read_text()) == {
        "schemaVersion": 1, "profileId": profile.profile_id, "selectedView": "connect",
    }


def test_invalid_preference_and_missing_profile_do_not_initialize_implicitly(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    with pytest.raises(FileNotFoundError):
        store.select_view("journal")
    first = store.load_or_create()
    with pytest.raises(ValueError):
        store.select_view("scanner")
    assert store.load_or_create() == first


def test_view_write_rejects_changed_local_identity(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    original = store.load_or_create()
    with pytest.raises(ValueError, match="profile changed"):
        store.select_view("trading", expected_profile_id="local-00000000-0000-4000-8000-000000000001")
    assert store.load_or_create() == original


@pytest.mark.parametrize("payload", [
    b"not-json", b"{\"schemaVersion\":2}",
    b'{"schemaVersion":1,"profileId":"cloud-user","selectedView":"trading"}',
    b'{"schemaVersion":1,"profileId":"local-not-a-uuid","selectedView":"trading"}',
    b'{"schemaVersion":1,"profileId":"local-00000000-0000-0000-0000-000000000000","selectedView":"trading"}',
    b"x" * 4097,
])
def test_corrupt_or_unsupported_profile_fails_closed_without_replacement(tmp_path, payload):
    store = LocalProfileStore(base=tmp_path)
    store.root.mkdir()
    store.path.write_bytes(payload)
    with pytest.raises(ValueError):
        store.load_or_create()
    assert store.path.read_bytes() == payload


def test_failed_atomic_preference_write_preserves_previous_profile(tmp_path, monkeypatch):
    store = LocalProfileStore(base=tmp_path)
    first = store.load_or_create()
    original = store.path.read_bytes()

    def rejected_replace(_source, _destination):
        raise OSError("simulated interrupted replace")

    monkeypatch.setattr(local_profile.os, "replace", rejected_replace)
    with pytest.raises(OSError, match="interrupted replace"):
        store.select_view("journal")
    assert store.path.read_bytes() == original
    assert store.load_or_create() == first
    assert not list(store.root.glob(".profile-*.tmp"))


def test_concurrent_first_launch_uses_one_profile_id(tmp_path):
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: LocalProfileStore(base=tmp_path).load_or_create(), range(6)))
    assert len({profile.profile_id for profile in results}) == 1


def test_reparse_profile_path_is_not_read_or_overwritten(tmp_path):
    outside = tmp_path / "outside.json"
    outside.write_text("private elsewhere")
    store = LocalProfileStore(base=tmp_path)
    store.root.mkdir()
    try:
        os.symlink(outside, store.path)
    except (NotImplementedError, OSError) as exc:
        pytest.skip(f"Symlink creation unavailable: {exc}")
    with pytest.raises(OSError, match="reparse"):
        store.load_or_create()
    assert outside.read_text() == "private elsewhere"


def test_update_schema_probe_is_read_only_and_rejects_unknown_profile(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    store.check_existing_schema()
    assert not store.root.exists()

    store.load_or_create()
    before = store.path.read_bytes()
    store.check_existing_schema()
    assert store.path.read_bytes() == before

    unsupported = before.replace(b'"schemaVersion":1', b'"schemaVersion":2')
    store.path.write_bytes(unsupported)
    with pytest.raises(ValueError, match="schema"):
        store.check_existing_schema()
    assert store.path.read_bytes() == unsupported


def test_locked_candidate_probe_refuses_existing_recorded_ledger(tmp_path, monkeypatch,
                                                                  capsys):
    # Full verification runs pytest from services/eod, where the repository's
    # scripts directory is not an importable top-level package.
    launcher = Path(__file__).resolve().parents[3] / "scripts" / "standalone_entry.py"
    standalone_main = run_path(str(launcher))["main"]

    store = LocalProfileStore(base=tmp_path)
    store.check_locked_sample_update()
    assert not store.root.exists()
    store.load_or_create()
    profile_bytes = store.path.read_bytes()
    recorded = store.root / "paper-recorded"
    recorded.mkdir()
    sentinel = recorded / "ledger.sqlite3"
    sentinel.write_bytes(b"preserve isolated trade data")
    store.check_existing_schema()  # The profile version alone is insufficient.
    with pytest.raises(ValueError, match="recorded trade data"):
        store.check_locked_sample_update()

    monkeypatch.setattr(local_profile, "windows_local_app_data", lambda: tmp_path)
    monkeypatch.setattr(sys, "argv", ["BrontideDesktop", "--check-profile-schema"])
    with pytest.raises(SystemExit) as stopped:
        standalone_main()
    assert stopped.value.code == 3
    assert "installation stayed locked" in capsys.readouterr().err
    assert store.path.read_bytes() == profile_bytes
    assert sentinel.read_bytes() == b"preserve isolated trade data"


@pytest.mark.parametrize("as_directory", [False, True])
def test_locked_candidate_probe_refuses_unrecognized_private_state(tmp_path, as_directory):
    store = LocalProfileStore(base=tmp_path)
    store.load_or_create()
    profile_before = store.path.read_bytes()
    unexpected = store.root / "future-private-state"
    if as_directory:
        unexpected.mkdir()
        sentinel = unexpected / "private.bin"
    else:
        sentinel = unexpected
    sentinel.write_bytes(b"preserve unfamiliar private state")

    with pytest.raises(ValueError, match="Unknown private profile data"):
        store.check_locked_sample_update()
    report = candidate_diagnostics(tmp_path / "absent-assets", store)
    assert report["profileSchema"] == "unavailable-or-incompatible"
    assert "preserve unfamiliar private state" not in json.dumps(report)
    assert store.path.read_bytes() == profile_before
    assert sentinel.read_bytes() == b"preserve unfamiliar private state"


@pytest.mark.parametrize("name", ["modules.json", "owner-paper-account.json",
                                        "paper-binding.json"])
def test_locked_candidate_probe_refuses_malformed_known_private_state(tmp_path, name):
    store = LocalProfileStore(base=tmp_path)
    store.load_or_create()
    sidecar = store.root / name
    original = b"preserve malformed private bytes"
    sidecar.write_bytes(original)

    with pytest.raises(ValueError):
        store.check_locked_sample_update()
    assert candidate_diagnostics(tmp_path / "absent-assets", store)["profileSchema"] == \
        "unavailable-or-incompatible"
    assert sidecar.read_bytes() == original


def test_locked_candidate_probe_refuses_binding_unlinked_from_owner_reference(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    reference = LocalPaperReferenceStore(store).record_owner_attested(
        profile.profile_id, "DU123456")
    binding = store.root / "paper-binding.json"
    document = {
        "schemaVersion": 2, "profileId": profile.profile_id,
        "environment": "paper", "accountBinding": "a" * 64,
        "accountMask": reference.account_mask, "sourceBinding": "b" * 64,
        "ownerReferenceDigest": "c" * 64, "confirmedAt": "2026-09-25T12:00:00Z",
        "submissionLocked": True, "reconciliationRequired": True,
    }
    original = json.dumps(document).encode("utf-8")
    binding.write_bytes(original)

    with pytest.raises(ValueError, match="does not match the owner reference"):
        store.check_locked_sample_update()
    assert binding.read_bytes() == original
    assert candidate_diagnostics(tmp_path / "absent-assets", store)["profileSchema"] == \
        "unavailable-or-incompatible"


def test_locked_candidate_probe_accepts_valid_unbound_setup_sidecars(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    LocalModulePreferencesStore(store).save(profile.profile_id, ["trading"])
    LocalPaperReferenceStore(store).record_owner_attested(profile.profile_id, "DU123456")
    before = {entry.name: entry.read_bytes() for entry in store.root.iterdir()
              if entry.is_file()}

    store.check_locked_sample_update()
    assert {entry.name: entry.read_bytes() for entry in store.root.iterdir()
            if entry.is_file()} == before


def test_locked_candidate_probe_accepts_valid_linked_choice_without_ledger(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    LocalPaperReferenceStore(store).record_owner_attested(profile.profile_id, "DU123456")
    now = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
    observed = BrokerAccountObservation(
        connection_generation="generation-1234567890", source_binding="a" * 64,
        accounts=("DU123456",), environment="paper", paper_identity_verified=True,
        sdk_compatible=True, api_usable=True, observed_at=now - timedelta(seconds=1),
    )
    LocalBindingStore(store, clock=lambda: now).confirm(
        profile.profile_id, "DU123456", "DU123456", observed)
    before = {entry.name: entry.read_bytes() for entry in store.root.iterdir()
              if entry.is_file()}

    store.check_locked_sample_update()
    assert {entry.name: entry.read_bytes() for entry in store.root.iterdir()
            if entry.is_file()} == before


@pytest.mark.skipif(os.name != "nt", reason="Windows Known Folder API")
def test_default_path_ignores_spoofed_localappdata_environment(tmp_path, monkeypatch):
    expected = local_profile.windows_local_app_data()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    store = LocalProfileStore()
    assert store.base == expected
    assert store.root == expected / "BrontideStandalone"
