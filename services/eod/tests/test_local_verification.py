"""Qualification mode uses isolated persistent storage and no execution route."""

import json
import os
import uuid
import runpy
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brontide_eod import local_verification as verification
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_instance import WindowsStandaloneInstance, InstanceAlreadyRunning
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import create_app, candidate_diagnostics


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(verification, "windows_local_app_data", lambda: tmp_path)
    return verification.VerificationProfileStore(str(uuid.uuid4()))


@pytest.mark.parametrize("value", ["", "../normal", "C:\\normal", "BrontideStandalone",
                                  "AABBCCDD-0000-4000-8000-000000000001",
                                  "aabbccdd000040008000000000000001"])
def test_invalid_id_never_resolves_or_writes_storage(value, monkeypatch):
    monkeypatch.setattr(verification, "windows_local_app_data",
                        lambda: pytest.fail("invalid ID reached filesystem"))
    with pytest.raises(ValueError, match="canonical UUID"):
        verification.VerificationProfileStore(value)


def test_normal_profile_and_two_verification_profiles_keep_separate_storage(store, tmp_path):
    normal = LocalProfileStore(base=tmp_path)
    normal_profile = normal.load_or_create()
    normal_bytes = normal.path.read_bytes()
    first = store.load_or_create()
    store.initialize_journal(first.profile_id)
    store.select_view("journal", expected_profile_id=first.profile_id)
    relaunched = verification.VerificationProfileStore(store.verification_id)
    assert relaunched.load_or_create().selected_view == "journal"
    assert relaunched.read_existing().profile_id == first.profile_id
    assert relaunched.journal_source(first.profile_id).read(first.profile_id)["historyStatus"] == "no-records"
    other = verification.VerificationProfileStore(str(uuid.uuid4()))
    assert other.load_or_create().profile_id not in {first.profile_id, normal_profile.profile_id}
    assert normal.path.read_bytes() == normal_bytes
    assert not (normal.root / "artificial-journal").exists()


def test_replaced_profile_or_ledger_scope_fails_closed(store):
    profile = store.load_or_create()
    store.initialize_journal(profile.profile_id)
    marker = store.journal_directory / verification.MARKER
    content = json.loads(marker.read_text())
    content["accountBinding"] = "fixture-somebody-else"
    marker.write_text(json.dumps(content))
    with pytest.raises(ValueError, match="scope"):
        store.journal_source(profile.profile_id).read(profile.profile_id)
    owner = json.loads(store.owner_path.read_text())
    owner["profileId"] = "local-" + str(uuid.uuid4())
    store.owner_path.write_text(json.dumps(owner))
    with pytest.raises(ValueError, match="ownership"):
        store.load_or_create()


def test_reparse_directories_are_rejected_before_profile_creation(store, monkeypatch):
    original = verification._reject_reparse
    def reject(path):
        if path == store.verification_parent:
            raise OSError("reparse point")
        original(path)
    monkeypatch.setattr(verification, "_reject_reparse", reject)
    with pytest.raises(OSError, match="reparse"):
        store.load_or_create()
    assert not store.root.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows directory junction")
def test_real_junction_cannot_redirect_verification_storage(store, tmp_path):
    target = tmp_path / "unrelated-storage"
    target.mkdir()
    sentinel = target / "keep.txt"
    sentinel.write_text("preserve unrelated data")
    subprocess.run(["cmd", "/c", "mklink", "/J", str(store.verification_parent), str(target)],
                   check=True, capture_output=True)
    try:
        with pytest.raises(OSError, match="[Ll]ink|[Rr]eparse"):
            store.load_or_create()
        assert sentinel.read_text() == "preserve unrelated data"
        assert list(target.iterdir()) == [sentinel]
    finally:
        # Remove just this junction, never recurse into its destination.
        os.rmdir(store.verification_parent)


def assets(tmp_path):
    root = tmp_path / "assets"
    for route in ("standalone", "verification"):
        (root / route).mkdir(parents=True)
        (root / route / "index.html").write_text("<html><body>Locked</body></html>")
    (root / "_next").mkdir()
    return root


def test_real_session_authentication_required_and_no_write_or_broker_route(store, tmp_path):
    profile = store.load_or_create()
    store.initialize_journal(profile.profile_id)
    manager = LocalSessionManager(profile.profile_id)
    root = assets(tmp_path)
    app = create_app(root, port=8765, manager=manager, profile_store=store, allow_testclient=True)
    client = TestClient(app, base_url="http://127.0.0.1:8765")
    headers = {"X-Brontide-Local": "1", "Origin": "http://127.0.0.1:8765"}
    assert client.get("/v1/local/journal/verification", headers=headers).status_code == 401
    token = manager.issue_bootstrap()
    assert client.post("/v1/local/session/bootstrap", headers={**headers, "X-Brontide-Bootstrap": token}).status_code == 200
    status = client.get("/v1/local/session/status", headers=headers).json()
    assert status["verificationProfile"] is True
    assert status["brokerAccount"] is None and status["executionEnabled"] is False
    history = client.get("/v1/local/journal/verification", headers=headers)
    assert history.status_code == 200
    assert history.json()["source"] == "synthetic-ledger-fixture"
    assert history.json()["historyStatus"] == "no-records"
    marker = store.journal_directory / verification.MARKER
    original = marker.read_text()
    marker.write_text("{malformed")
    invalid = client.get("/v1/local/journal/verification", headers=headers)
    assert invalid.status_code == 503
    assert "campaigns" not in invalid.json()
    changed = json.loads(original)
    changed["accountBinding"] = "fixture-another-account"
    marker.write_text(json.dumps(changed))
    assert client.get("/v1/local/journal/verification", headers=headers).status_code == 503
    marker.write_text(original)
    assert client.get("/v1/local/journal/verification", headers=headers).status_code == 200
    assert client.post("/v1/local/journal/verification", headers=headers, json={}).status_code in (404, 405)
    assert not any("/paper/" in getattr(route, "path", "") for route in app.routes)
    assert candidate_diagnostics(root, store)["candidate"] == "locked-verification"
    assert candidate_diagnostics(root, store)["profileSchema"] == "compatible-or-not-created"
    manager.lock()
    assert client.get("/v1/local/journal/verification", headers=headers).status_code == 401
    ordinary = create_app(root, port=8765, manager=LocalSessionManager("normal"), allow_testclient=True)
    assert not any(getattr(route, "path", "") == "/v1/local/journal/verification" for route in ordinary.routes)


def test_diagnostics_never_create_verification_profile(store, tmp_path):
    report = candidate_diagnostics(assets(tmp_path), store)
    assert report["verificationProfile"] is True
    assert report["profileSchema"] == "compatible-or-not-created"
    assert not store.verification_parent.exists()


def test_harness_records_open_closure_and_late_fees_without_erasing_other_history(store):
    harness = Path(__file__).resolve().parents[3] / "scripts/prepare-phase2-verification.py"
    prepare = runpy.run_path(str(harness))["prepare"]
    assert prepare(store.verification_id, "empty")["records"] == []
    opened = prepare(store.verification_id, "open")["records"][0]
    assert opened["entered"] == 2 and opened["recordedOpenQuantity"] == 2
    closed = prepare(store.verification_id, "closed")["records"][0]
    assert closed["recordedOpenQuantity"] == 0 and closed["grossRealized"] == 6
    assert closed["netRealized"] is None
    fee = prepare(store.verification_id, "late-fee")["records"][0]
    assert fee["fees"] == pytest.approx(.7)
    assert fee["netRealized"] == pytest.approx(5.3)
    assert prepare(store.verification_id, "late-fee")["records"] == [fee]
    with pytest.raises(ValueError, match="preserved"):
        prepare(store.verification_id, "empty")
    with pytest.raises(ValueError, match="preserved"):
        prepare(store.verification_id, "open")


@pytest.mark.skipif(os.name != "nt", reason="Windows ownership mutex")
def test_single_instance_is_shared_with_existing_ownership_mechanism(store):
    with WindowsStandaloneInstance.acquire(store) as owner:
        with pytest.raises(InstanceAlreadyRunning):
            WindowsStandaloneInstance.acquire(verification.VerificationProfileStore(store.verification_id))
        assert store.read_existing().profile_id == owner.profile_id
