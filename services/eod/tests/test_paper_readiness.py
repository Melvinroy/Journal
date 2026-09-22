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


def test_target_reduction_counts_outside_pilot_once_and_preserves_history(service):
    pilot = opened(service)
    for slot in pilot["slots"]:
        service.client.fill(slot["stop"]["orderId"], 98)
    service._events()
    pilot = service.store.all("campaign")[0]
    assert pilot["state"] == "Closed"
    service.authenticated("owner")
    session_campaign = deepcopy(pilot)
    session_campaign["id"] = "session-owned"
    unrelated = deepcopy(pilot)
    unrelated.update(id="other-account", accountBinding="different-binding")
    prior = {"id": "historical", "userId": "owner", "accountBinding": pilot["accountBinding"],
             "target": 200, "completed": 1, "state": "Halted",
             "attempts": [{"campaignId": session_campaign["id"]}]}
    with service.store.transaction() as db:
        for campaign in (session_campaign, unrelated):
            service.store.put(db, "campaign", campaign["id"], campaign)
        service.store.put(db, "test-session", prior["id"], prior)
        service.store.event(db, "original-approval", prior)
        original_events = db.execute("SELECT * FROM events ORDER BY rowid").fetchall()
    original_campaigns = deepcopy(service.store.all("campaign"))
    writes = deepcopy(service.client.writes)
    first = service.test_sessions.amend_target("historical", 30, "reduce-30")
    assert (first["target"], first["completed"], first["baselineCompleted"], first["state"]) == (30, 2, 1, "Halted")
    second = service.test_sessions.amend_target("historical", 29, "reduce-29")
    assert (second["target"], second["completed"], second["baselineCompleted"]) == (29, 2, 1)
    assert [a["previousTarget"] for a in second["approvalAmendments"]] == [200, 30]
    service.test_sessions.amend_target("historical", 29, "reduce-29")
    with pytest.raises(PaperSafetyError):
        service.test_sessions.amend_target("historical", 1, "below-completed")
    with pytest.raises(PaperSafetyError):
        service.test_sessions.amend_target("historical", 30, "raise-back")
    assert service.client.writes == writes
    assert service.store.all("campaign") == original_campaigns
    with service.store.transaction() as db:
        events = db.execute("SELECT * FROM events ORDER BY rowid").fetchall()
        assert events[:len(original_events)] == original_events
        assert len(events) == len(original_events) + 2


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


def _ledger_rows(path):
    """Compare exact durable content, not merely counts or a selected campaign."""
    with sqlite3.connect(path) as db:
        return {
            "objects": db.execute("SELECT * FROM objects ORDER BY kind,id").fetchall(),
            "commands": db.execute("SELECT * FROM commands ORDER BY id").fetchall(),
            "events": db.execute("SELECT * FROM events ORDER BY id").fetchall(),
            "version": db.execute("PRAGMA user_version").fetchone()[0],
            "integrity": db.execute("PRAGMA integrity_check").fetchall(),
        }


def test_restored_ledger_replays_and_applies_late_fees_without_changing_source(service, tmp_path):
    from brontide_eod.paper_domain import summarize

    campaign = opened(service)
    for slot in campaign["slots"]:
        service.client.fill(slot["stop"]["orderId"], 98, fee=None)
    service._events()
    campaign = service.store.all("campaign")[0]
    assert summarize(campaign)["netRealized"] is None
    service.authenticated("owner")
    service.prepare_batch([customer_ticket()])
    unrelated = deepcopy(campaign)
    unrelated.update(id="unrelated-synthetic", accountBinding="other-binding")
    for slot in unrelated["slots"]:
        for order in (slot.get("entry"), slot.get("stop"), slot.get("exit")):
            if order and order.get("orderId") is not None:
                order["orderId"] += 10000
    for execution in unrelated["executions"]:
        execution["orderId"] += 10000
        execution["executionId"] = "OTHER-" + execution["executionId"]
    with service.store.transaction() as db:
        service.store.put(db, "campaign", unrelated["id"], unrelated)
    before = _ledger_rows(service.store.path)
    assert before["commands"] and service.store.all("plan-revision")
    restored = service.store.backup(tmp_path / "new-runtime" / "restored.sqlite3")
    assert _ledger_rows(restored) == before
    replay = PaperService(PaperStore(restored), factory=lambda: service.client, source=lambda: "reviewed-source")
    replay.client = service.client
    writes = deepcopy(service.client.writes)
    try:
        assert replay.armed is None
        service.client.events.extend(deepcopy(list(reversed(service.client.fills))))
        service.client.events.extend(deepcopy(service.client.fills))
        replay._events()
        current = next(c for c in replay.store.all("campaign") if c["id"] == campaign["id"])
        assert current["executions"] == campaign["executions"]
        assert summarize(current) == summarize(campaign)
        for fill in service.client.fills:
            if fill["side"] == "SLD":
                event = {"kind": "commission", "executionId": fill["executionId"], "commission": .1, "currency": "USD"}
                service.client.events.extend([deepcopy(event), deepcopy(event)])
        replay._events()
        current = next(c for c in replay.store.all("campaign") if c["id"] == campaign["id"])
        result = summarize(current)
        assert result["fees"] == pytest.approx(.6)
        assert result["grossRealized"] == pytest.approx(-6)
        assert result["netRealized"] == pytest.approx(-6.6)
        without_fees = lambda executions: [{k: v for k, v in e.items() if k != "commission"} for e in executions]
        assert without_fees(current["executions"]) == without_fees(campaign["executions"])
        assert next(c for c in replay.store.all("campaign") if c["id"] == unrelated["id"]) == unrelated
        assert replay.store.all("plan-revision") == service.store.all("plan-revision")
        assert service.client.writes == writes
        assert _ledger_rows(service.store.path) == before
    finally:
        replay.shutdown()


def test_restored_uncertain_submission_stays_locked_without_transmission(service, tmp_path, monkeypatch):
    from test_paper_lifecycle import approved

    batch = approved(service)
    original = service.client.write
    def uncertain(*args):
        original(*args)
        raise TimeoutError("synthetic uncertain transmission")
    monkeypatch.setattr(service.client, "write", uncertain)
    with pytest.raises(TimeoutError):
        service.submit(batch["id"], 0, "uncertain-command")
    before = _ledger_rows(service.store.path)
    assert any(row[3] == "unknown" for row in before["commands"])
    restored = service.store.backup(tmp_path / "isolated-restored.sqlite3")
    assert _ledger_rows(restored) == before
    replay = PaperService(PaperStore(restored), factory=lambda: service.client, source=lambda: "reviewed-source")
    replay.client = service.client
    writes = deepcopy(service.client.writes)
    try:
        assert replay.armed is None
        for command in ("uncertain-command", "replacement-command"):
            with pytest.raises(PaperSafetyError, match="not armed for this connection"):
                replay.submit(batch["id"], 0, command)
        assert replay.store.all("campaign")[0]["state"] == "Needs reconciliation"
        assert service.client.writes == writes
        assert _ledger_rows(restored) == before
        # Match the isolated fixture receipt so the arming attempt reaches
        # reconciliation, rather than failing an unrelated approval check.
        replay.connection_id = service.connection_id
        with pytest.raises(PaperSafetyError, match="Resolve outstanding campaign reconciliation before arming"):
            replay.arm(batch["id"])
        assert replay.armed is None
        assert service.client.writes == writes
        with sqlite3.connect(restored) as db:
            commands = db.execute("SELECT * FROM commands ORDER BY id").fetchall()
            assert [row[:3] for row in commands] == [row[:3] for row in before["commands"]]
            assert next(row[3] for row in commands if row[0] == "uncertain-command:0:E") == "confirmed"
        assert replay.store.all("campaign")[0]["state"] == "Needs reconciliation"
        assert _ledger_rows(service.store.path) == before
    finally:
        replay.shutdown()
