from datetime import datetime, timezone
from pathlib import Path

import pytest

from brontide_eod import ibkr_acceptance as acceptance
from brontide_eod.ibkr_acceptance import (
    AcceptanceEvidenceStore,
    assert_approval_binding,
    load_acceptance_manifest,
    read_only_preflight,
    select_batch,
    ticket_digest,
)
from brontide_eod.ibkr_execution import PaperIntentStore, broker_session_phase, prepare_paper_intent
from brontide_eod.ibkr_tws import PaperSafetyError


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "docs" / "trading" / "IBKR_PAPER_ACCEPTANCE_PACKAGE.json"
NOW = datetime.fromisoformat("2026-09-10T21:00:05+00:00")


def instrument(observed_at="2026-09-10T21:00:00Z"):
    return {
        "observedAt": observed_at,
        "contract": {
            "conId": 42, "symbol": "TEST", "secType": "STK", "exchange": "NYSE",
            "primaryExchange": "NYSE", "route": "SMART", "currency": "USD",
            "minimumTick": .01, "orderTypes": ["LMT", "MIDPX", "STP", "STPLMT", "OCA"],
            "validExchanges": ["SMART", "NYSE", "OVERNIGHT"],
            "tradingHours": "20260910:0400-20260910:2000",
            "liquidHours": "20260910:0930-20260910:1600",
            "timeZoneId": "US/Eastern", "serverVersion": 191,
        },
        "quote": {"bid": 99.99, "ask": 100.0, "complete": True, "marketDataType": 1},
        "executable": True,
    }


def extended_ticket():
    return {
        "intentId": "post-intent", "idempotencyKey": "post:v1", "planId": "post-plan",
        "campaignId": "post-campaign", "symbol": "TEST", "direction": "Long",
        "method": "Limit", "sessionMode": "RegularExtended", "duration": "DAY",
        "protectionOrderType": "STP LMT", "protectionLimitPrice": 97.99,
        "quantity": 3, "planningPrice": 100, "hardCap": 100, "stopPrice": 98,
        "maximumPriceDriftPercent": .5,
        "exitPlan": {"allocations": [{"quantity": 1}, {"quantity": 1}, {"quantity": 1}]},
    }


def test_repository_manifest_preserves_r2_and_keeps_session_candidates_distinct():
    manifest = load_acceptance_manifest(MANIFEST)
    r2 = select_batch(manifest, "BRONTIDE-RTH-20260910-R2")
    tickets = {item["ticketId"]: item for item in r2["tickets"]}
    assert tickets["QC-F-LONG"]["hardCap"] == 13.54
    assert tickets["QC-F-LONG"]["cleanup"]["priceFloor"] == 12.54
    assert tickets["QC-SOFI-BREAKOUT"]["hardCap"] == 17.52
    assert tickets["QC-SOFI-BREAKOUT"]["cleanup"]["priceFloor"] == 16.97
    assert tickets["QC-CSCO-SHORT"]["status"] == "blocked"
    assert "cannot cap favorable price improvement" in tickets["QC-CSCO-SHORT"]["blockedReason"]
    assert select_batch(manifest, "BRONTIDE-EXT-PRE-20260910-P1")["tickets"][0]["requiredPhase"] == "Premarket"
    assert select_batch(manifest, "BRONTIDE-EXT-POST-20260910-P1")["tickets"] == []
    assert select_batch(manifest, "BRONTIDE-OVERNIGHT-PLANNING")["status"] == "blocked"


def test_manifest_rejects_exposure_or_risk_above_package_limits(tmp_path):
    value = load_acceptance_manifest(MANIFEST)
    value["batches"][1]["tickets"][0]["plannedRisk"] = 10.01
    candidate = tmp_path / "manifest.json"
    candidate.write_text(__import__("json").dumps(value), encoding="utf-8")
    with pytest.raises(PaperSafetyError, match="per-campaign risk"):
        load_acceptance_manifest(candidate)


def test_approval_binding_rejects_source_ticket_or_approved_set_changes():
    batch = select_batch(load_acceptance_manifest(MANIFEST), "BRONTIDE-EXT-PRE-20260910-P1")
    digest = ticket_digest(batch)
    approval = {
        "batchId": batch["batchId"], "sourceIdentity": "source-1", "ticketDigest": digest,
        "approvedTicketIds": [batch["tickets"][0]["ticketId"]], "approvedAt": "2026-09-10T08:00:00Z",
    }
    assert assert_approval_binding(batch, current_source_identity="source-1", approval=approval)["approvalStatus"] == "exact-match"
    with pytest.raises(PaperSafetyError, match="source identity"):
        assert_approval_binding(batch, current_source_identity="source-2", approval=approval)
    with pytest.raises(PaperSafetyError, match="content changed"):
        assert_approval_binding({**batch, "session": "changed"}, current_source_identity="source-1", approval=approval)
    with pytest.raises(PaperSafetyError, match="ticket set"):
        assert_approval_binding(batch, current_source_identity="source-1", approval={**approval, "approvedTicketIds": []})


@pytest.mark.parametrize(
    "timestamp,phase",
    [
        ("2026-09-10T08:00:00+00:00", "Premarket"),
        ("2026-09-10T14:00:00+00:00", "RTH"),
        ("2026-09-10T21:00:00+00:00", "Postmarket"),
        ("2026-09-11T01:00:00+00:00", "Closed"),
    ],
)
def test_broker_schedule_classifies_exact_session_phase(timestamp, phase):
    assert broker_session_phase(instrument(), datetime.fromisoformat(timestamp))["phase"] == phase


def test_postmarket_constructs_only_supported_independent_limit_legs(tmp_path):
    result = prepare_paper_intent(
        extended_ticket(), account_id="PRIVATE-PAPER", account_binding="binding",
        instrument=instrument(), existing_symbols=set(),
        store=PaperIntentStore(tmp_path / "intents.json"), now=NOW,
    )
    assert broker_session_phase(instrument(), NOW)["phase"] == "Postmarket"
    assert result["sessionPolicy"] == {
        **result["sessionPolicy"], "mode": "RegularExtended", "entryOrderType": "LMT",
        "outsideRth": True, "protectionOrderType": "STP LMT", "protectionOutsideRth": True,
        "expiresAt": "2026-09-11T00:00:00Z",
    }
    raw = PaperIntentStore(tmp_path / "intents.json")._read()["records"][0]
    assert raw["package"]["entry"] == {**raw["package"]["entry"], "orderType": "LMT", "tif": "DAY", "outsideRth": True}
    assert raw["package"]["protection"] == {**raw["package"]["protection"], "orderType": "STP LMT", "auxPrice": 98.0, "lmtPrice": 97.99, "outsideRth": True}


def test_read_only_preflight_checks_served_source_snapshot_exclusions_phase_and_bounds(monkeypatch):
    ticket = {
        "ticketId": "post", "status": "executable", "campaignId": "post", "planId": "plan",
        "idempotencyKey": "post:v1", "symbol": "TEST", "direction": "Long", "method": "Limit",
        "sessionMode": "RegularExtended", "requiredPhase": "Postmarket", "duration": "DAY",
        "quantity": 3, "planningPrice": 100, "hardCap": 100, "stopPrice": 98,
        "protectionOrderType": "STP LMT", "protectionLimitPrice": 97.99,
        "maximumPriceDriftPercent": .5,
        "exitPlan": {"allocations": [{"quantity": 1}, {"quantity": 1}, {"quantity": 1}]},
        "cleanup": {"priceFloor": 98, "maximumAttempts": 2, "maximumRetries": 1},
    }
    batch = {"batchId": "post-batch", "status": "executable", "session": "Postmarket", "tickets": [ticket]}
    manifest = {"schemaVersion": 1, "packageId": "package", "exclusions": [{"symbol": "PL", "direction": "Long", "quantity": 100}, {"symbol": "AMD", "direction": "Short", "quantity": 100}], "batches": [batch]}

    def fake_http(_base, method, path, body=None):
        if path == "/brontide-preview-identity.json":
            return {"identifier": "source"}
        if path.endswith("/refresh"):
            return {"mode": "read-only", "connectionStatus": "connected", "dataStatus": "fresh", "account": {"maskedId": "DU••10"}, "positions": [{"symbol": "PL", "direction": "Long", "quantity": 100, "snapshotState": "current"}, {"symbol": "AMD", "direction": "Short", "quantity": 100, "snapshotState": "current"}], "openOrders": []}
        if path.endswith("/instrument"):
            return instrument()
        raise AssertionError((method, path, body))

    monkeypatch.setattr(acceptance, "_http_json", fake_http)
    result = read_only_preflight(manifest, batch, base_url="http://local", current_source_identity="source", now=NOW, persist_intents=False)
    assert result["tickets"][0]["status"] == "validated"
    assert result["tickets"][0]["intentPersisted"] is False
    assert result["snapshot"] == {"completed": True, "positionCount": 2, "openOrderCount": 0}
    with pytest.raises(PaperSafetyError, match="served preview"):
        read_only_preflight(manifest, batch, base_url="http://local", current_source_identity="different", now=NOW, persist_intents=False)


def test_preflight_rejects_wrong_session_without_repricing(monkeypatch):
    manifest = load_acceptance_manifest(MANIFEST)
    batch = select_batch(manifest, "BRONTIDE-EXT-PRE-20260910-P1")
    monkeypatch.setattr(acceptance, "_http_json", lambda _base, _method, path, _body=None: (
        {"identifier": "source"} if path.endswith("identity.json") else
        {"mode": "read-only", "connectionStatus": "connected", "dataStatus": "fresh", "account": {"maskedId": "DU••10"}, "positions": [{"symbol": "PL", "direction": "Long", "quantity": 100, "snapshotState": "current"}, {"symbol": "AMD", "direction": "Short", "quantity": 100, "snapshotState": "current"}], "openOrders": []} if path.endswith("refresh") else
        {**instrument(), "contract": {**instrument()["contract"], "symbol": "F"}}
    ))
    with pytest.raises(PaperSafetyError, match="not currently valid"):
        read_only_preflight(manifest, batch, base_url="http://local", current_source_identity="source", now=datetime.fromisoformat("2026-09-10T14:00:00+00:00"), persist_intents=False)
    assert batch["tickets"][0]["hardCap"] == 13.6


def test_preflight_rejects_expired_ticket_before_broker_access(monkeypatch):
    manifest = load_acceptance_manifest(MANIFEST)
    batch = select_batch(manifest, "BRONTIDE-EXT-PRE-20260910-P1")
    monkeypatch.setattr(acceptance, "_http_json", lambda *_args, **_kwargs: {"identifier": "source"})
    with pytest.raises(PaperSafetyError, match="not currently valid"):
        read_only_preflight(manifest, batch, base_url="http://local", current_source_identity="source", now=datetime.fromisoformat("2026-09-11T08:00:00+00:00"), persist_intents=False)


def test_evidence_is_append_only_masks_broker_ids_and_blocks_blind_retry(tmp_path):
    store = AcceptanceEvidenceStore(tmp_path / "private-evidence.json")
    unknown = {"eventId": "e1", "batchId": "b", "ticketId": "t", "scenarioId": "P21", "kind": "submission-unknown", "occurredAt": "2026-09-10T14:00:00Z", "provenance": "Simulation"}
    assert store.append(unknown) == store.append(unknown)
    with pytest.raises(PaperSafetyError, match="reconciled"):
        store.append({**unknown, "eventId": "e2", "kind": "submission-requested"})
    store.append({**unknown, "eventId": "e3", "kind": "reconciliation-no-order"})
    store.append({**unknown, "eventId": "e4", "kind": "submission-requested"})
    actual = {**unknown, "eventId": "e5", "scenarioId": "P01", "kind": "broker-acknowledged", "provenance": "IBKR callback", "brokerOrderId": "private-order-42"}
    store.append(actual)
    report = store.masked_report("b")
    assert report["scenarios"]["P01"]["classification"] == "Actual paper observed"
    assert "private-order-42" not in str(report)
    assert report["scenarios"]["P01"]["events"][0]["brokerOrderIdReference"]
    with pytest.raises(PaperSafetyError, match="conflicting"):
        store.append({**actual, "kind": "entry-fill"})

    found = AcceptanceEvidenceStore(tmp_path / "found.json")
    found.append(unknown)
    found.append({**unknown, "eventId": "found", "kind": "reconciliation-order-found", "brokerOrderId": "private-order-99"})
    with pytest.raises(PaperSafetyError, match="already exists"):
        found.append({**unknown, "eventId": "retry", "kind": "submission-requested"})
