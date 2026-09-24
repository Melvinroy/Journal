"""Standalone profile persistence never claims old cloud or broker records."""

import json
import os
from concurrent.futures import ThreadPoolExecutor

import pytest

from brontide_eod import local_profile
from brontide_eod.local_profile import LocalProfileStore


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


@pytest.mark.skipif(os.name != "nt", reason="Windows Known Folder API")
def test_default_path_ignores_spoofed_localappdata_environment(tmp_path, monkeypatch):
    expected = local_profile.windows_local_app_data()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    store = LocalProfileStore()
    assert store.base == expected
    assert store.root == expected / "BrontideStandalone"
