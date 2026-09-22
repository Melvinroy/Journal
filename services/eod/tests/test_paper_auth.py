import json
from datetime import timedelta
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from brontide_eod import paper_auth, paper_api
from brontide_eod.api import app
from test_paper_lifecycle import service, ticket, opened
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.paper_service import utcnow, execution_time

USER = "00000000-0000-0000-0000-000000000001"

@pytest.fixture
def auth(monkeypatch):
    monkeypatch.setenv("BRONTIDE_AUTH_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("BRONTIDE_AUTH_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    def lookup(url, headers, timeout):
        assert url == "https://project.supabase.co/auth/v1/user"
        assert headers["Authorization"] == "Bearer valid-test-token"
        return SimpleNamespace(status_code=200, json=lambda: {"id": USER, "email": "test@example.com", "email_confirmed_at": "verified"})
    monkeypatch.setattr(paper_auth.httpx, "get", lookup)


def test_server_verifies_identity_and_does_not_claim_first_user(auth, monkeypatch, tmp_path, service):
    user = paper_auth.verified_user("Bearer valid-test-token")
    assert user["id"] == USER
    monkeypatch.setenv("BRONTIDE_PAPER_OWNER_FILE", str(tmp_path / "owner.json"))
    monkeypatch.setattr(paper_auth.PaperGatewayConfig, "from_environment", lambda: service.client.config)
    with pytest.raises(HTTPException) as error: paper_auth.require_owner(user)
    assert error.value.status_code == 403
    assert not (tmp_path / "owner.json").exists()
    (tmp_path / "owner.json").write_text(json.dumps({"userId": USER, "accountBinding": service.client.config.binding()}))
    assert paper_auth.require_owner(user) == user
    with pytest.raises(HTTPException): paper_auth.require_owner({"id": "wrong-user"})
    (tmp_path / "owner.json").write_text(json.dumps({"userId": USER, "accountBinding": "wrong-account"}))
    with pytest.raises(HTTPException): paper_auth.require_owner(user)


def test_all_broker_routes_require_signin(auth):
    with TestClient(app) as client:
        for route in ("read-only", "paper/status", "paper/identity"):
            assert client.get("/v1/ibkr/" + route).status_code == 401
        for route in ("read-only/refresh", "read-only/disconnect", "read-only/instrument", "paper/intents", "paper/connect", "paper/submit", "paper/batches"):
            assert client.post("/v1/ibkr/" + route, headers={"X-Brontide-Local": "1"}, json={}).status_code == 401


def test_expired_and_unverified_identity_rejected(auth, monkeypatch):
    monkeypatch.setattr(paper_auth.httpx, "get", lambda *a, **k: SimpleNamespace(status_code=401))
    with pytest.raises(HTTPException) as error: paper_auth.verified_user("Bearer valid-test-token")
    assert error.value.status_code == 401
    monkeypatch.setattr(paper_auth.httpx, "get", lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: {"id": USER}))
    with pytest.raises(HTTPException) as error: paper_auth.verified_user("Bearer valid-test-token")
    assert error.value.status_code == 403


@pytest.mark.parametrize("failure", [paper_auth.httpx.TimeoutException, paper_auth.httpx.ConnectError])
def test_identity_outage_blocks_requests_before_authority_or_dispatch(auth, monkeypatch, failure):
    attempts = []
    def unavailable(url, headers, timeout):
        attempts.append(url)
        raise failure("private upstream diagnostic must not escape")
    def forbidden(*args, **kwargs):
        pytest.fail("Unavailable identity must not reach owner lookup, authority or broker dispatch")
    monkeypatch.setattr(paper_auth.httpx, "get", unavailable)
    monkeypatch.setattr(paper_api, "require_owner", forbidden)
    monkeypatch.setattr(paper_api, "service", SimpleNamespace(authenticated=forbidden, status=forbidden, submit=forbidden))
    headers = {"Authorization": "Bearer valid-test-token", "X-Brontide-Local": "1"}
    with TestClient(app) as client:
        responses = [
            client.get("/v1/ibkr/paper/status", headers=headers),
            client.post("/v1/ibkr/paper/submit", headers=headers,
                        json={"batchId": "fixture-batch", "ticketIndex": 0, "commandId": "fixture-command"}),
        ]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": "Brontide identity verification is unavailable; trading remains locked."}
    assert attempts == ["https://project.supabase.co/auth/v1/user"] * 2


@pytest.mark.parametrize("body", [None, [], "invalid", {"id": None}, {"id": USER, "email_confirmed_at": "yes", "is_anonymous": True}])
def test_malformed_or_anonymous_identity_fails_closed(auth, monkeypatch, body):
    monkeypatch.setattr(paper_auth.httpx, "get", lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: body))
    with pytest.raises(HTTPException) as error: paper_auth.verified_user("Bearer valid-test-token")
    assert error.value.status_code in (403, 503)


@pytest.mark.parametrize("url", ["https://evil.example/path.supabase.co", "https://user@project.supabase.co", "http://project.supabase.co", "https://project.supabase.co:443"])
def test_identity_configuration_rejects_non_project_origins(auth, monkeypatch, url):
    monkeypatch.setenv("BRONTIDE_AUTH_SUPABASE_URL", url)
    monkeypatch.setattr(paper_auth.httpx, "get", lambda *a, **k: pytest.fail("No credentials may be sent"))
    with pytest.raises(HTTPException) as error: paper_auth.verified_user("Bearer valid-test-token")
    assert error.value.status_code == 503


def test_exact_persisted_approval_and_duplicate_submission(service):
    service.authenticated(USER)
    with pytest.raises(PaperSafetyError): service.prepare_batch([ticket()])
    batch = service.prepare_batch([ticket(planId="plan", planRevision="saved-1", planningSource="Manual")])
    with pytest.raises(PaperSafetyError): service.approve(batch["id"], "wrong", "approval")
    service.approve(batch["id"], batch["digest"], "approval")
    c = service.submit(batch["id"], 0, "submit")
    count = len(service.client.writes)
    assert service.submit(batch["id"], 0, "submit")["id"] == c["id"]
    assert len(service.client.writes) == count
    service.disarm()
    service.connection_id = "new-connection"
    with pytest.raises(PaperSafetyError): service.approve(batch["id"], batch["digest"], "approval")
    assert not service.reviewed_campaigns


def test_expired_lease_cannot_silently_resume(service):
    service.authenticated(USER)
    service.reviewed_campaigns.add("existing")
    service.armed = "old"
    service.operator_deadline = utcnow() - timedelta(seconds=1)
    service.authenticated(USER)
    assert service.armed is None
    assert not service.reviewed_campaigns


def test_expired_order_review_is_rejected_before_approval(service):
    service.authenticated(USER)
    batch = service.prepare_batch([ticket(planId="plan", planRevision="saved-1", planningSource="Manual")])
    stored = service._batch(batch["id"])
    stored["validUntil"] = (utcnow() - timedelta(seconds=1)).isoformat()
    with service.store.transaction() as db:
        service.store.put(db, "batch", stored["id"], stored)
    with pytest.raises(PaperSafetyError, match="stale"):
        service.approve(stored["id"], stored["digest"], "expired-review")
    assert not service.store.all("approval")
    assert not service.client.writes


def test_expired_managed_authority_disarms_reviewed_campaign(service):
    campaign = opened(service)
    service.authenticated(USER)
    service.disarm()
    campaign = service.store.all("campaign")[0]
    service.review_action(campaign["id"], campaign["revision"], "resume-reviewed", "resume")
    assert service.reviewed_campaigns == {campaign["id"]}
    assert service.armed == campaign["batchId"]
    service.operator_deadline = utcnow() - timedelta(seconds=1)
    with pytest.raises(PaperSafetyError, match="lease expired"):
        service._authority(service._batch(campaign["batchId"]))
    assert service.armed is None
    assert not service.reviewed_campaigns
    assert not service.authorized_batches


def test_execution_clock_is_explicit():
    assert execution_time("20260916 10:00:00 America/New_York") == "2026-09-16T14:00:00+00:00"
    assert execution_time("20260916 10:00:00") == ""


def test_signout_invalidates_existing_review_and_approval(service):
    service.authenticated(USER)
    batch = service.prepare_batch([ticket(planId="plan", planRevision="saved-1", planningSource="Manual")])
    service.approve(batch["id"], batch["digest"], "approval")
    before = service.connection_id
    service.disarm()
    assert service.connection_id != before
    with pytest.raises(PaperSafetyError): service.arm(batch["id"])
    with pytest.raises(PaperSafetyError): service.approve(batch["id"], batch["digest"], "fresh-command")


def test_simulation_cannot_enter_authenticated_preparation(service):
    service.authenticated(USER)
    with pytest.raises(PaperSafetyError, match="Simulation"):
        service.prepare_batch([ticket(planId="plan", planRevision="saved", planningSource="Simulated fixture")])
    assert not service.client.writes


def test_position_review_resumes_only_that_campaign_and_pause_returns_state(service):
    c = opened(service)
    service.authenticated(USER)
    service.disarm()
    c = service.store.all("campaign")[0]
    result = service.review_action(c["id"], c["revision"], "resume-one", "resume")
    assert result["id"] == c["id"]
    assert service.reviewed_campaigns == {c["id"]}
    before = len(service.client.writes)
    assert service.review_action(c["id"], c["revision"], "resume-one", "resume")["id"] == c["id"]
    assert len(service.client.writes) == before
    c = service.store.all("campaign")[0]
    result = service.review_action(c["id"], c["revision"], "pause-one", "cancel-exits")
    assert result["automation"] == "Managed rules paused; broker targets and stops remain active"
