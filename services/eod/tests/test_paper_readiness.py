"""Offline evidence must survive restarts without becoming fresh broker evidence."""
from copy import deepcopy
from datetime import datetime, timezone
import pytest
from test_paper_lifecycle import service
from brontide_eod.paper_service import PaperService
from brontide_eod.ibkr_tws import PaperGatewayConfig
from brontide_eod.ibkr_tws import PaperSafetyError
from test_paper_lifecycle import ticket
from test_paper_lifecycle import opened
from brontide_eod.paper_store import PaperStore
import sqlite3


def complete_snapshot(service, monkeypatch):
    original = service.client.read_only_snapshot
    def capture():
        result = original()
        result.observed_at = datetime.now(timezone.utc).isoformat()
        return result
    monkeypatch.setattr(service.client, "read_only_snapshot", capture)
    monkeypatch.setattr(PaperGatewayConfig, "from_environment", lambda: service.client.config)
    service.authenticated("owner-a")


def test_snapshot_is_private_stale_after_restart_and_isolated(service, monkeypatch):
    complete_snapshot(service, monkeypatch)
    service.reconcile()
    view = service.status()["broker"]
    assert view["account"]["value"] == 100000
    restarted = PaperService(service.store)
    assert restarted.status()["broker"] is None
    restarted.authenticated("owner-a")
    restored = restarted.status()["broker"]
    assert restored["account"] == view["account"]
    assert restored["dataStatus"] == "stale"
    assert restored["connectionStatus"] == "disconnected"
    assert not restarted.status()["submissionsEnabled"]
    restarted.authenticated("owner-b")
    assert restarted.status()["broker"] is None


def test_failed_refresh_retains_last_complete_snapshot(service, monkeypatch):
    complete_snapshot(service, monkeypatch)
    service.reconcile()
    previous = deepcopy(service.broker_view)
    def fail(): raise OSError("execution snapshot incomplete")
    monkeypatch.setattr(service.client, "execution_snapshot", fail)
    with pytest.raises(OSError): service.reconcile()
    assert service.broker_view == previous
    assert len(service.store.all("broker-snapshot")) == 1
    assert service.status()["broker"]["dataStatus"] == "stale"


def test_confirmed_closure_removes_owned_snapshot_but_not_unrelated_absence(service):
    campaign = opened(service)
    service.client.external = [{"conId": 99, "quantity": 2, "symbol": "OTHER"}]
    service.reconcile()
    owned = next(p for p in service.broker_view["positions"] if p["instrumentId"] == "IBKR-STK:42")
    assert owned["ownedCampaignId"] == campaign["id"]
    for slot in campaign["slots"]:
        service.client.fill(slot["stop"]["orderId"], 98)
    service.client.external = []
    service._events()
    service.reconcile()
    assert service.store.all("campaign")[0]["state"] == "Closed"
    assert all(p["instrumentId"] != "IBKR-STK:42" for p in service.broker_view["positions"])
    unrelated = next(p for p in service.broker_view["positions"] if p["instrumentId"] == "IBKR-STK:99")
    assert unrelated["quantity"] == 2
    assert unrelated["snapshotState"] != "current"


def test_plan_revision_content_cannot_be_reused(service):
    service.authenticated("owner")
    original = ticket(planId="plan", planRevision="revision", planningSource="Manual")
    service.prepare_batch([original])
    service.prepare_batch([original])
    assert len(service.store.all("plan-revision")) == 1
    with pytest.raises(PaperSafetyError, match="different content"):
        service.prepare_batch([{**original, "planningPrice": 99.99}])


def test_funds_and_environment_fail_closed(service, monkeypatch):
    service.authenticated("owner")
    original = service.client.read_only_snapshot
    def insufficient():
        result = original()
        result.account_summary = [{"tag": tag, "value": "1", "currency": "USD"} for tag in ("NetLiquidation", "AvailableFunds")]
        return result
    monkeypatch.setattr(service.client, "read_only_snapshot", insufficient)
    with pytest.raises(PaperSafetyError, match="funds"):
        service.prepare_batch([ticket(planId="plan", planRevision="revision", planningSource="Manual")])
    assert not service.client.writes
    monkeypatch.setenv("BRONTIDE_EXECUTION_ENVIRONMENT", "live")
    with pytest.raises(PaperSafetyError, match="not an enabled release"):
        PaperGatewayConfig.from_environment()


def test_backup_restores_all_evidence_without_mutating_original(tmp_path):
    store = PaperStore(tmp_path / "original.sqlite3")
    with store.transaction() as db:
        store.put(db, "campaign", "owned", {"executions": ["real-evidence"]})
        store.event(db, "callback", {"raw": "unchanged"})
    restored = store.backup(tmp_path / "restored.sqlite3")
    assert PaperStore(restored).all("campaign") == store.all("campaign")
    with sqlite3.connect(restored) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
    with pytest.raises(PaperSafetyError): store.backup(restored)


def test_target_amendment_retains_approval_and_never_runs(service):
    service.authenticated("owner")
    prior = {"id": "historical", "userId": "owner", "accountBinding": service.client.config.binding(), "target": 200, "completed": 1, "state": "Halted"}
    with service.store.transaction() as db:
        service.store.put(db, "test-session", prior["id"], prior)
        service.store.event(db, "original-approval", prior)
    revised = service.test_sessions.amend_target("historical", 30, "reduce")
    assert revised["target"] == 30 and revised["state"] == "Halted"
    assert revised["approvalAmendments"][0]["previousTarget"] == 200
    service.test_sessions.amend_target("historical", 30, "reduce")
    with pytest.raises(PaperSafetyError): service.test_sessions.amend_target("historical", 31, "raise")
    assert not service.client.writes
    with service.store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2


def test_security_headers_cover_unauthorized_and_html():
    from fastapi import FastAPI
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.testclient import TestClient
    from brontide_eod.security_headers import SecurityHeaders
    app = FastAPI()
    app.add_middleware(SecurityHeaders)
    @app.get("/")
    def page(): return HTMLResponse("<h1>Trading</h1>")
    @app.get("/v1/ibkr/paper/status")
    def denied(): return JSONResponse({"detail": "unauthorized"}, status_code=401)
    with TestClient(app) as client:
        response = client.get("/")
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
        assert "unsafe-eval" not in response.headers["content-security-policy"]
        response = client.get("/v1/ibkr/paper/status")
        assert response.status_code == 401 and response.headers["cache-control"] == "no-store"


def test_new_operational_routes_require_authentication(monkeypatch):
    from fastapi.testclient import TestClient
    from brontide_eod.api import app
    monkeypatch.setenv("BRONTIDE_AUTH_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("BRONTIDE_AUTH_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    with TestClient(app) as client:
        for path in ("pause", "test-session/historical/target", "test-session/start", "test-session/resume"):
            response = client.post("/v1/ibkr/paper/" + path, headers={"X-Brontide-Local": "1"}, json={"target": 30, "commandId": "test"})
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
