"""The desktop candidate must remain isolated from cloud and broker routes."""

import base64
import hashlib

from fastapi.testclient import TestClient
import pytest

from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import _LAUNCH_SCRIPT, create_app


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


def test_foreign_host_and_origin_cannot_access_shell(tmp_path):
    client, _ = _client(tmp_path)
    assert client.get("/launch", headers={"Host": "attacker.invalid"}).status_code == 403
    assert client.get("/standalone/", headers={"Origin": "https://attacker.invalid"}).status_code == 403


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
