"""Standalone local session checks; no cloud identity or broker transport."""

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from brontide_eod.local_session import LocalSessionManager, local_session_router


ORIGIN = "http://127.0.0.1:8766"
HEADERS = {"Origin": ORIGIN, "X-Brontide-Local": "1"}


@pytest.fixture
def local_app():
    now = [100.0]
    manager = LocalSessionManager("profile-fixture", clock=lambda: now[0],
                                  bootstrap_seconds=60, session_seconds=300)
    router = local_session_router(manager, origin=ORIGIN, allow_testclient=True)
    app = FastAPI()
    app.include_router(router)

    @app.post("/v1/local/protected")
    def protected(principal=Depends(router.require_session)):
        return {"profileId": principal.profile_id}

    return manager, now, TestClient(app, base_url=ORIGIN)


def unlock(manager, client):
    token = manager.issue_bootstrap()
    response = client.post("/v1/local/session/bootstrap",
                           headers={**HEADERS, "X-Brontide-Bootstrap": token})
    assert response.status_code == 200
    return token, response.json()["csrf"]


def test_bootstrap_is_single_use_short_lived_and_never_returns_session_cookie_value(local_app):
    manager, now, client = local_app
    with client:
        assert client.get("/v1/local/session/status", headers=HEADERS).status_code == 401
        token, csrf = unlock(manager, client)
        assert token not in client.get("/v1/local/session/status", headers=HEADERS).text
        assert "brontide_local_session" in client.cookies
        response = client.post("/v1/local/session/bootstrap",
                               headers={**HEADERS, "X-Brontide-Bootstrap": token})
        assert response.status_code == 401
        assert client.get("/v1/local/session/status", headers=HEADERS).json() == {
            "profileId": "profile-fixture", "authenticated": True,
            "brokerAccount": None, "environment": None, "executionEnabled": False, "csrf": csrf,
        }
        assert client.post("/v1/local/protected", headers={**HEADERS, "X-Brontide-CSRF": csrf}).status_code == 200
        now[0] += 301
        assert client.get("/v1/local/session/status", headers=HEADERS).status_code == 401
        expiring = manager.issue_bootstrap()
        now[0] += 61
        assert client.post("/v1/local/session/bootstrap",
                           headers={**HEADERS, "X-Brontide-Bootstrap": expiring}).status_code == 401


def test_mutation_needs_exact_origin_cookie_and_csrf_and_lock_revokes(local_app):
    manager, _, client = local_app
    with client:
        _, csrf = unlock(manager, client)
        path = "/v1/local/protected"
        assert client.post(path, headers=HEADERS).status_code == 403
        assert client.post(path, headers={**HEADERS, "X-Brontide-CSRF": "bad"}).status_code == 403
        assert client.post(path, headers={"X-Brontide-Local": "1", "X-Brontide-CSRF": csrf}).status_code == 403
        assert client.post(path, headers={**HEADERS, "X-Brontide-CSRF": csrf}).json() == {"profileId": "profile-fixture"}
        assert client.post("/v1/local/session/lock", headers={**HEADERS, "X-Brontide-CSRF": csrf}).json() == {
            "locked": True, "executionEnabled": False,
        }
        assert client.post(path, headers={**HEADERS, "X-Brontide-CSRF": csrf}).status_code == 401


@pytest.mark.parametrize("headers", [
    {"Origin": "http://evil.example", "X-Brontide-Local": "1"},
    {"Origin": ORIGIN, "X-Brontide-Local": "1", "Host": "evil.example"},
    {"Origin": ORIGIN, "X-Brontide-Local": "1", "Sec-Fetch-Site": "cross-site"},
    {"Origin": ORIGIN},
    {"X-Brontide-Local": "1"},
])
def test_foreign_or_unmarked_requests_cannot_consume_launcher_capability(local_app, headers):
    manager, _, client = local_app
    with client:
        capability = manager.issue_bootstrap()
        refused = client.post("/v1/local/session/bootstrap",
                              headers={**headers, "X-Brontide-Bootstrap": capability})
        assert refused.status_code == 403
        accepted = client.post("/v1/local/session/bootstrap",
                               headers={**HEADERS, "X-Brontide-Bootstrap": capability})
        assert accepted.status_code == 200


def test_relaunch_replaces_old_session_and_cookie_is_http_only(local_app):
    manager, _, client = local_app
    with client:
        _, csrf = unlock(manager, client)
        old_cookie = client.cookies.get("brontide_local_session")
        token = manager.issue_bootstrap()
        refreshed = client.post("/v1/local/session/bootstrap",
                                headers={**HEADERS, "X-Brontide-Bootstrap": token})
        assert refreshed.status_code == 200
        assert "httponly" in refreshed.headers["set-cookie"].lower()
        assert "samesite=strict" in refreshed.headers["set-cookie"].lower()
        assert "max-age=300" in refreshed.headers["set-cookie"].lower()
        assert refreshed.headers["cache-control"] == "no-store"
        with TestClient(client.app, base_url=ORIGIN) as old_client:
            old_client.cookies.set("brontide_local_session", old_cookie)
            assert old_client.post("/v1/local/protected", headers={**HEADERS, "X-Brontide-CSRF": csrf}).status_code == 401


def test_long_running_account_review_cannot_cross_relaunch_lock_or_expiry(local_app):
    manager, now, client = local_app
    with client:
        _, csrf = unlock(manager, client)
        original_cookie = client.cookies.get("brontide_local_session")
        lease = manager.lease(original_cookie, csrf)
        assert manager.require_lease(lease, original_cookie, csrf).profile_id == "profile-fixture"

        _, replacement_csrf = unlock(manager, client)
        replacement_cookie = client.cookies.get("brontide_local_session")
        with pytest.raises(HTTPException) as old_session:
            manager.require_lease(lease, original_cookie, csrf)
        assert old_session.value.status_code == 401
        with pytest.raises(HTTPException) as changed_generation:
            manager.require_lease(lease, replacement_cookie, replacement_csrf)
        assert changed_generation.value.status_code == 409

        replacement_lease = manager.lease(replacement_cookie, replacement_csrf)
        now[0] += 301
        with pytest.raises(HTTPException) as expired:
            manager.require_lease(replacement_lease, replacement_cookie, replacement_csrf)
        assert expired.value.status_code == 401

        now[0] = 500
        _, csrf = unlock(manager, client)
        cookie = client.cookies.get("brontide_local_session")
        new_lease = manager.lease(cookie, csrf)
        manager.lock()
        with pytest.raises(HTTPException) as locked:
            manager.require_lease(new_lease, cookie, csrf)
        assert locked.value.status_code == 401


@pytest.mark.parametrize("origin", ["http://evil.example:8766", "https://127.0.0.1:8766", "http://localhost:8766",
                                     "http://127.0.0.1:8766/path", "http://127.0.0.1"])
def test_router_requires_explicit_literal_loopback_origin(origin):
    with pytest.raises(ValueError):
        local_session_router(LocalSessionManager("test"), origin=origin)
