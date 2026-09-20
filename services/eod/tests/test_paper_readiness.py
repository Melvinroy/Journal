"""Offline evidence must survive restarts without becoming fresh broker evidence."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
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


def customer_ticket(**overrides):
    result = ticket(planId="plan", planRevision="revision", planningSource="Manual", **overrides)
    saved = result["savedPlan"]
    saved.pop("origin")
    saved.update(accountEquity=30000, sizingEquity=30000, riskPercent=.5, maxAllocationPercent=10,
                 sizingBasis={"source": "Legacy planning equity", "currency": "USD", "value": 30000})
    return result


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
        changed = deepcopy(original)
        changed["savedPlan"]["riskPercent"] = 0.5
        service.prepare_batch([changed])


def test_new_batches_are_hidden_from_a_different_user_on_the_same_account(service):
    service.authenticated("owner-a")
    service.prepare_batch([ticket(planId="plan", planRevision="revision", planningSource="Manual")])
    stored = service.store.all("batch")[0]
    assert (stored["userId"], stored["accountBinding"], stored["environment"]) == (
        "owner-a", service.client.config.binding(), "paper")
    service.authenticated("owner-b")
    assert service.status()["batches"] == []


def test_same_user_records_are_isolated_by_paper_account_and_environment(service):
    service.authenticated("owner")
    current = service.prepare_batch([ticket(planId="plan", planRevision="revision", planningSource="Manual")])
    stored = service._batch(current["id"])
    other_config = PaperGatewayConfig(
        service.client.config.host,
        service.client.config.port,
        service.client.config.client_id,
        "OTHER-PAPER",
        service.client.config.submissions_enabled,
    )
    other_account = deepcopy(stored)
    other_account.update(id="other-account", accountBinding=other_config.binding())
    other_environment = deepcopy(stored)
    other_environment.update(id="other-environment", environment="live")
    with service.store.transaction() as db:
        service.store.put(db, "batch", other_account["id"], other_account)
        service.store.put(db, "batch", other_environment["id"], other_environment)

    assert {batch["id"] for batch in service.status()["batches"]} == {current["id"]}

    service.client.config = other_config
    service.client.authorized_account = "OTHER-PAPER"
    service.client._managed_accounts = ["OTHER-PAPER"]
    assert {batch["id"] for batch in service.status()["batches"]} == {"other-account"}
    assert "other-environment" not in {batch["id"] for batch in service.status()["batches"]}


@pytest.mark.parametrize("field,value", [("side", "Short"), ("planRevision", "other"), ("executionQuantity", 2), ("hardCap", 101), ("stopPrice", 97)])
def test_saved_planner_mismatch_never_prepares_or_transmits(service, field, value):
    service.authenticated("owner")
    original = ticket(planId="plan", planRevision="revision", planningSource="Manual")
    original["savedPlan"][field] = value
    with pytest.raises(PaperSafetyError, match="differs"):
        service.prepare_batch([original])
    assert not service.store.all("batch") and not service.client.writes


def test_full_planner_content_is_archived_and_legacy_requires_resave(service):
    service.authenticated("owner")
    original = customer_ticket()
    original["savedPlan"]["marketSnapshot"] = {"session": "2026-09-18", "atr": 1.23456789}
    service.prepare_batch([original])
    archived = service.store.all("plan-revision")[0]
    assert archived["ticket"]["savedPlan"] == original["savedPlan"]
    assert len(archived["planDigest"]) == 64
    assert len(archived["contentDigest"]) == 64
    del original["savedPlan"]
    with pytest.raises(PaperSafetyError, match="complete new planner"):
        service.prepare_batch([original])


@pytest.mark.parametrize("field", ["capturedEntrySource", "sizingBasis", "sessionPolicy", "savedAt", "exitPlan"])
def test_incomplete_saved_plan_is_never_archived(field, service):
    service.authenticated("owner")
    original = customer_ticket()
    del original["savedPlan"][field]
    with pytest.raises(PaperSafetyError, match="incomplete"):
        service.prepare_batch([original])
    assert not service.store.all("plan-revision")


def test_concurrent_revision_reuse_accepts_only_one_content(service):
    service.authenticated("owner")
    first = ticket(planId="plan", planRevision="revision", planningSource="Manual")
    second = deepcopy(first)
    second["savedPlan"]["marketSnapshot"] = {"session": "different"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda value: _prepare_outcome(service, value), (first, second)))
    assert sorted(outcomes) == ["accepted", "rejected"]
    assert len(service.store.all("plan-revision")) == 1


def _prepare_outcome(service, value):
    try:
        service.prepare_batch([value])
        return "accepted"
    except PaperSafetyError:
        return "rejected"


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
