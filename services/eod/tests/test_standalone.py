"""The desktop candidate must remain isolated from cloud and broker routes."""

import base64
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event
from urllib.parse import urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_binding import BrokerAccountObservation, LocalBindingStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_instance import InstanceUnavailable, WindowsStandaloneInstance
from brontide_eod.local_session import LocalSessionManager
from brontide_eod import standalone as standalone_module
from brontide_eod.standalone import _LAUNCH_SCRIPT, _open_local_browser, candidate_diagnostics, create_app


def _client(tmp_path):
    page = tmp_path / "standalone" / "index.html"
    page.parent.mkdir()
    page.write_text("<!doctype html><html><body>Trading sample</body></html>", encoding="utf-8")
    verification = tmp_path / "verification" / "index.html"
    verification.parent.mkdir()
    verification.write_text("<!doctype html><html><body>Read-only trading evidence"
                            "<script>window.evidenceLoaded=true</script></body></html>", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    manager = LocalSessionManager("isolated-profile")
    app = create_app(tmp_path, port=8765, manager=manager, allow_testclient=True)
    return TestClient(app, base_url="http://127.0.0.1:8765"), manager


def test_launch_removes_fragment_before_exchange_and_loads_no_external_asset(tmp_path):
    client, _ = _client(tmp_path)
    response = client.get("/launch")
    assert response.status_code == 200
    assert "history.replaceState" in response.text
    assert response.text.index("history.replaceState") < response.text.index("fetch(")
    assert "<script src=" not in response.text
    assert _LAUNCH_SCRIPT in response.text
    assert "connect-src 'self'" in response.headers["content-security-policy"]
    assert "supabase" not in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


def test_owning_process_can_reopen_one_browser_without_reusing_old_authorization(capsys):
    manager = LocalSessionManager("isolated-profile")
    opened: list[str] = []
    assert _open_local_browser(manager, 8765, lambda url: opened.append(url) or True)
    assert _open_local_browser(manager, 8765, lambda url: opened.append(url) or True)
    assert len(opened) == 2
    assert all(urlsplit(url).query == "" and urlsplit(url).path == "/launch" for url in opened)
    first, second = [urlsplit(url).fragment.removeprefix("bootstrap=") for url in opened]
    assert first != second
    with pytest.raises(HTTPException, match="missing or expired"):
        manager.consume_bootstrap(first)
    session, csrf = manager.consume_bootstrap(second)
    assert session and csrf
    assert manager.authenticate(session).profile_id == "isolated-profile"
    assert not _open_local_browser(manager, 8765, lambda _url: False)
    assert first not in capsys.readouterr().out


@pytest.mark.skipif(os.name != "nt", reason="Windows named reopen event")
def test_second_launcher_signals_owner_without_starting_another_service(tmp_path, monkeypatch, capsys):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    monkeypatch.setattr(standalone_module, "LocalProfileStore", lambda: store)
    monkeypatch.setattr(standalone_module.socket, "socket",
                        lambda *_args, **_kwargs: pytest.fail("second launcher opened a socket"))
    monkeypatch.setattr(standalone_module, "_open_local_browser",
                        lambda *_args: pytest.fail("second launcher minted a browser token"))
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as owner:
        standalone_module.run(tmp_path / "unused-assets", open_browser=False)
        assert owner.consume_reopen_signal()
    assert "Asked the running Brontide app" in capsys.readouterr().out


@pytest.mark.skipif(os.name != "nt", reason="Windows named reopen event")
@pytest.mark.parametrize("replace_profile", [False, True])
def test_second_launcher_does_not_recreate_or_reopen_a_changed_profile(
        tmp_path, monkeypatch, replace_profile):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    monkeypatch.setattr(standalone_module, "LocalProfileStore", lambda: store)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as owner:
        if replace_profile:
            changed_id = "local-00000000-0000-4000-8000-000000000001"
            store._write(type(profile)(changed_id, "connect"))
            expected_bytes = store.path.read_bytes()
        else:
            store.path.unlink()
            expected_bytes = None
        with pytest.raises(InstanceUnavailable, match="profile|reopened"):
            standalone_module.run(tmp_path / "unused-assets", open_browser=False)
        assert not owner.consume_reopen_signal()
        assert (store.path.read_bytes() if store.path.exists() else None) == expected_bytes


def test_static_shell_only_and_broker_routes_unavailable(tmp_path):
    client, _ = _client(tmp_path)
    assert client.get("/standalone/").status_code == 200
    assert client.get("/", follow_redirects=False).headers["location"] == "/standalone/"
    assert client.get("/charts/").status_code == 404
    evidence = client.get("/verification/")
    assert "Read-only trading evidence" in evidence.text
    script_hash = base64.b64encode(hashlib.sha256(
        b"window.evidenceLoaded=true").digest()).decode("ascii")
    assert f"'sha256-{script_hash}'" in evidence.headers["content-security-policy"]
    assert "'unsafe-inline'" not in evidence.headers["content-security-policy"].split("; style-src")[0]
    assert client.get("/index.html").status_code == 404
    assert client.get("/v1/ibkr/paper/status").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/docs").status_code == 404


def test_candidate_diagnostics_is_read_only_and_redacts_invalid_private_state(tmp_path):
    assets = tmp_path / "public"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Local sample</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    base = tmp_path / "private"
    base.mkdir()
    store = LocalProfileStore(base=base)

    first = candidate_diagnostics(assets, store)
    assert first == {
        "schemaVersion": 1, "candidate": "locked-sample",
        "executionEnabled": False, "brokerConnection": "not-available",
        "profileSchema": "compatible-or-not-created", "packagedAssets": "valid",
    }
    assert not store.root.exists()  # A support probe never creates an identity.
    assert candidate_diagnostics(assets, None)["profileSchema"] == "unavailable-or-incompatible"

    store.root.mkdir()
    store.path.write_text('PRIVATE-TOKEN-DO-NOT-REPORT', encoding="utf-8")
    (assets / "standalone" / "index.html").write_text(
        '<script src="https://private.invalid/SECRET-ACCOUNT"></script>', encoding="utf-8")
    before = store.path.read_bytes()
    report = candidate_diagnostics(assets, store)
    assert report["profileSchema"] == "unavailable-or-incompatible"
    assert report["packagedAssets"] == "unavailable-or-invalid"
    serialized = json.dumps(report)
    assert "PRIVATE-TOKEN" not in serialized and "SECRET-ACCOUNT" not in serialized
    assert str(base) not in serialized and str(assets) not in serialized
    assert store.path.read_bytes() == before


def test_candidate_diagnostics_does_not_call_recorded_data_compatible(tmp_path):
    assets = tmp_path / "public"
    for route in ("standalone", "verification"):
        page = assets / route / "index.html"
        page.parent.mkdir(parents=True)
        page.write_text("<!doctype html><title>Local sample</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    private = tmp_path / "private"
    private.mkdir()
    store = LocalProfileStore(base=private)
    store.load_or_create()
    original_profile = store.path.read_bytes()
    recorded = store.root / "paper-recorded"
    recorded.mkdir()
    marker = recorded / "recorded-journal.json"
    marker.write_bytes(b"private scope details")

    report = candidate_diagnostics(assets, store)
    assert report["profileSchema"] == "unavailable-or-incompatible"
    assert report["packagedAssets"] == "valid"
    assert report["executionEnabled"] is False
    assert "private scope details" not in json.dumps(report)
    assert str(private) not in json.dumps(report)
    assert store.path.read_bytes() == original_profile
    assert marker.read_bytes() == b"private scope details"


def test_missing_static_dependency_or_legacy_export_fails_package_check(tmp_path):
    page = tmp_path / "standalone" / "index.html"
    page.parent.mkdir()
    verification = tmp_path / "verification" / "index.html"
    verification.parent.mkdir()
    verification.write_text("<!doctype html><title>evidence</title>", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    page.write_text('<script src="/_next/static/missing.js"></script>', encoding="utf-8")
    with pytest.raises(ValueError, match="asset is missing"):
        create_app(tmp_path, port=8765, manager=LocalSessionManager("test"))
    page.write_text("<!doctype html><title>sample</title>", encoding="utf-8")
    (tmp_path / "charts").mkdir()
    with pytest.raises(ValueError, match="unrelated exported route"):
        create_app(tmp_path, port=8765, manager=LocalSessionManager("test"))


@pytest.mark.parametrize("resource", [
    '<script src="https://outside.invalid/app.js"></script>',
    '<script src="//outside.invalid/app.js"></script>',
    '<script src="/unlisted.js"></script>',
    '<script src="/_next/../../outside.js"></script>',
    '<script src="/_next/%2e%2e/outside.js"></script>',
    '<script src="/_next/static\\outside.js"></script>',
    '<script src="/_next/static/app.js?source=other"></script>',
    '<link rel="stylesheet" href="https://outside.invalid/app.css">',
    '<link rel="preconnect" href="https://outside.invalid">',
])
def test_standalone_html_rejects_external_or_unlisted_runtime_resources(tmp_path, resource):
    page = tmp_path / "standalone" / "index.html"
    page.parent.mkdir()
    page.write_text(f"<!doctype html>{resource}", encoding="utf-8")
    verification = tmp_path / "verification" / "index.html"
    verification.parent.mkdir()
    verification.write_text("<!doctype html><title>Evidence</title>", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    with pytest.raises(ValueError, match="external or unlisted resource"):
        create_app(tmp_path, port=8765, manager=LocalSessionManager("test"))


@pytest.mark.parametrize("resource", [
    '<script src="https://outside.invalid/app.js" src="/_next/static/app.js"></script>',
    '<link rel="stylesheet" href="https://outside.invalid/app.css" href="/_next/static/app.css">',
])
def test_standalone_html_rejects_ambiguous_duplicate_resource_attributes(tmp_path, resource):
    page = tmp_path / "standalone" / "index.html"
    page.parent.mkdir()
    page.write_text(f"<!doctype html>{resource}", encoding="utf-8")
    verification = tmp_path / "verification" / "index.html"
    verification.parent.mkdir()
    verification.write_text("<!doctype html><title>Evidence</title>", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    with pytest.raises(ValueError, match="duplicate HTML attributes"):
        create_app(tmp_path, port=8765, manager=LocalSessionManager("test"))


def test_linked_frontend_asset_fails_closed(tmp_path):
    assets = tmp_path / "public"
    standalone = assets / "standalone"
    verification = assets / "verification"
    standalone.mkdir(parents=True)
    verification.mkdir()
    (assets / "_next").mkdir()
    (standalone / "index.html").write_text("<!doctype html><title>sample</title>", encoding="utf-8")
    (verification / "index.html").write_text("<!doctype html><title>evidence</title>", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("not a packaged asset", encoding="utf-8")
    linked_asset = assets / "_next" / "unexpected.js"
    try:
        os.symlink(outside, linked_asset)
    except OSError as exc:
        pytest.skip(f"Creating a test symlink is unavailable: {exc}")
    with pytest.raises(ValueError, match="linked asset"):
        create_app(assets, port=8765, manager=LocalSessionManager("test"))

    linked_asset.unlink()
    linked_root = tmp_path / "linked-export"
    try:
        os.symlink(assets, linked_root, target_is_directory=True)
    except OSError:
        return  # The nested-link rejection above was still exercised.
    with pytest.raises(ValueError, match="linked asset"):
        create_app(linked_root, port=8765, manager=LocalSessionManager("test"))


def test_nested_link_is_rejected_during_asset_walk(tmp_path, monkeypatch):
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "verification").mkdir()
    (assets / "_next" / "nested").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("sample", encoding="utf-8")
    (assets / "verification" / "index.html").write_text("evidence", encoding="utf-8")
    nested_asset = assets / "_next" / "nested" / "unexpected.js"
    nested_asset.write_text("asset", encoding="utf-8")
    original = type(nested_asset).is_symlink
    monkeypatch.setattr(type(nested_asset), "is_symlink",
                        lambda path: path == nested_asset or original(path))
    with pytest.raises(ValueError, match="linked asset"):
        create_app(assets, port=8765, manager=LocalSessionManager("test"))


def test_foreign_host_and_origin_cannot_access_shell(tmp_path):
    client, _ = _client(tmp_path)
    host_rejection = client.get("/launch", headers={"Host": "attacker.invalid"})
    assert host_rejection.status_code == 403
    assert host_rejection.headers["cache-control"] == "no-store"
    assert host_rejection.headers["x-content-type-options"] == "nosniff"
    origin_rejection = client.get("/standalone/", headers={"Origin": "https://attacker.invalid"})
    assert origin_rejection.status_code == 403
    assert origin_rejection.headers["x-frame-options"] == "DENY"


def test_one_use_local_launch_cannot_enable_execution(tmp_path):
    client, manager = _client(tmp_path)
    capability = manager.issue_bootstrap()
    headers = {"Origin": "http://127.0.0.1:8765", "X-Brontide-Local": "1",
               "X-Brontide-Bootstrap": capability}
    first = client.post("/v1/local/session/bootstrap", headers=headers)
    assert first.status_code == 200
    assert first.json()["executionEnabled"] is False
    assert "httponly" in first.headers["set-cookie"].lower()
    assert client.post("/v1/local/session/bootstrap", headers=headers).status_code == 401
    assert client.get("/v1/local/session/status", headers={"X-Brontide-Local": "1"}).json()["executionEnabled"] is False


def test_sdk_inventory_requires_current_local_session_and_never_enables_execution(tmp_path, monkeypatch):
    client, manager = _client(tmp_path)
    calls = []
    monkeypatch.setattr(standalone_module, "inspect_sdk_metadata", lambda: calls.append(1) or {
        "metadataStatus": "metadata-present-unverified", "reportedVersion": "10.50.2",
        "reportedProtobufPin": "5.29.5", "knownDependencyAdvisory": "GHSA-7gcm-g887-7qv7",
        "officialOriginVerified": False,
        "dependencyCompatible": None, "executionEnabled": False,
    })
    headers = {"X-Brontide-Local": "1"}
    assert client.get("/v1/local/sdk/metadata", headers=headers).status_code == 401
    assert calls == []
    bootstrap = manager.issue_bootstrap()
    assert client.post("/v1/local/session/bootstrap", headers={
        **headers, "Origin": "http://127.0.0.1:8765", "X-Brontide-Bootstrap": bootstrap,
    }).status_code == 200
    response = client.get("/v1/local/sdk/metadata", headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["executionEnabled"] is False
    assert calls == [1]
    manager.lock()
    assert client.get("/v1/local/sdk/metadata", headers=headers).status_code == 401
    assert calls == [1]


def test_profile_selection_requires_session_csrf_and_preserves_identity(tmp_path):
    assets = tmp_path / "public"
    page = assets / "standalone" / "index.html"
    page.parent.mkdir(parents=True)
    page.write_text("<!doctype html><title>sample</title>", encoding="utf-8")
    verification = assets / "verification" / "index.html"
    verification.parent.mkdir()
    verification.write_text("<!doctype html><title>evidence</title>", encoding="utf-8")
    (assets / "_next").mkdir()
    store = LocalProfileStore(base=tmp_path / "private")
    store.base.mkdir()
    profile = store.load_or_create()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=store, allow_testclient=True),
                        base_url="http://127.0.0.1:8765")
    assert client.get("/v1/local/profile").status_code == 403
    assert client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"}).status_code == 401
    token = manager.issue_bootstrap()
    response = client.post("/v1/local/session/bootstrap", headers={
        "Origin": "http://127.0.0.1:8765", "X-Brontide-Local": "1",
        "X-Brontide-Bootstrap": token,
    })
    csrf = response.json()["csrf"]
    headers = {"Origin": "http://127.0.0.1:8765", "X-Brontide-Local": "1",
               "X-Brontide-CSRF": csrf}
    assert client.put("/v1/local/profile/view", json={"view": "journal"},
                      headers={"X-Brontide-Local": "1"}).status_code == 403
    changed = client.put("/v1/local/profile/view", json={"view": "journal"}, headers=headers)
    assert changed.status_code == 200
    assert changed.json() == {"selectedView": "journal", "executionEnabled": False}
    assert store.load_or_create().profile_id == profile.profile_id
    assert store.load_or_create().selected_view == "journal"
    assert client.get("/v1/local/profile", headers={"X-Brontide-Local": "1"}).json()["selectedView"] == "journal"
    empty_binding = client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"})
    assert empty_binding.status_code == 200
    assert empty_binding.headers["cache-control"] == "no-store"
    assert empty_binding.json() == {
        "remembered": False, "environment": None, "accountMask": None,
        "connectionVerified": False, "reconciliationRequired": True,
        "executionEnabled": False, "accountSelectionAvailable": False,
    }

    now = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
    reference = LocalPaperReferenceStore(store, clock=lambda: now)
    reference.record_owner_attested(profile.profile_id, "DU123456")
    LocalBindingStore(store, clock=lambda: now).confirm(profile.profile_id, "DU123456", "DU123456",
        BrokerAccountObservation("generation-1234567890", "a" * 64, ("DU123456", "DU654321"),
                                 "paper", True, True, True, now))
    # A later missing owner reference cannot make a remembered choice ready.
    saved_reference = reference.path.read_bytes()
    reference.path.unlink()
    assert client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"}).status_code == 503
    reference.path.write_bytes(saved_reference)
    remembered = client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"})
    assert remembered.status_code == 200
    assert remembered.json() == {
        "remembered": True, "environment": "paper", "accountMask": "DU••••56",
        "connectionVerified": False, "reconciliationRequired": True,
        "executionEnabled": False, "accountSelectionAvailable": False,
    }
    assert "DU123456" not in remembered.text
    assert client.get("/v1/local/binding", headers={
        "X-Brontide-Local": "1", "Origin": "https://outside.invalid",
    }).status_code == 403
    stored = (store.root / "paper-binding.json")
    stored.write_text('{"schemaVersion":2,"PRIVATE-PATH":"secret"}', encoding="utf-8")
    unavailable = client.get("/v1/local/binding", headers={"X-Brontide-Local": "1"})
    assert unavailable.status_code == 503
    assert "PRIVATE-PATH" not in unavailable.text
    assert stored.read_text(encoding="utf-8").startswith('{"schemaVersion":2')


def test_selected_view_save_finishes_before_concurrent_session_lock(tmp_path, monkeypatch):
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    base = tmp_path / "private"
    base.mkdir()
    store = LocalProfileStore(base=base)
    profile = store.load_or_create()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=store, allow_testclient=True),
                        base_url="http://127.0.0.1:8765")
    local = {"X-Brontide-Local": "1"}
    token = manager.issue_bootstrap()
    csrf = client.post("/v1/local/session/bootstrap", headers={
        **local, "Origin": "http://127.0.0.1:8765", "X-Brontide-Bootstrap": token,
    }).json()["csrf"]
    headers = {**local, "Origin": "http://127.0.0.1:8765", "X-Brontide-CSRF": csrf}
    entered, release, lock_started, lock_done = Event(), Event(), Event(), Event()
    original_select = LocalProfileStore.select_view

    def slow_select(self, *args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original_select(self, *args, **kwargs)

    monkeypatch.setattr(LocalProfileStore, "select_view", slow_select)

    def lock_session():
        lock_started.set()
        manager.lock()
        lock_done.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(client.put, "/v1/local/profile/view", headers=headers,
                              json={"view": "journal"})
        assert entered.wait(5)
        locked = pool.submit(lock_session)
        assert lock_started.wait(5)
        try:
            assert not lock_done.wait(.2)
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200
        locked.result(timeout=5)
    assert lock_done.is_set()
    assert store.read_existing().selected_view == "journal"
