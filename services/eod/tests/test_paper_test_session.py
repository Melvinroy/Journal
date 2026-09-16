"""Session mechanics are deterministic evidence, never broker trade counts."""
from copy import deepcopy
import pytest
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.paper_test_session import session_ticket
from test_paper_lifecycle import service, opened


def authenticate(service):
    service.authenticated("verified-owner")
    service.client.bid, service.client.ask = 49.99, 50


def test_session_requires_current_auth_and_flat_pilot(service):
    with pytest.raises(PaperSafetyError, match="authenticated"): service.test_sessions.start("session")
    opened(service)
    authenticate(service)
    with pytest.raises(PaperSafetyError, match="existing pilot"): service.test_sessions.start("session")


def test_exact_session_tickets_preserve_bounds_and_leg_allocations(service):
    authenticate(service)
    for index in range(35):
        instrument = service.quote("F")
        value, cancellation = session_ticket(instrument, index, "approved-session")
        assert value["quantity"] == len(value["exitPlan"]["legs"])
        assert value["quantity"] <= 3
        assert value["quantity"] * value["hardCap"] <= 245
        assert value["quantity"] * (value["hardCap"] - value["stopPrice"]) <= 10
        assert value["stopPrice"] < instrument["quote"]["bid"]
        service._validate_ticket(value)
        if cancellation: assert value["triggerPrice"] > instrument["quote"]["ask"]
    instrument["executable"] = False
    with pytest.raises(PaperSafetyError, match="Fresh"): session_ticket(instrument, 0, "session")


def test_session_counts_only_fills_with_fees_and_cleared_orders(service):
    authenticate(service)
    session = service.test_sessions.start("session", 1)
    assert session["completed"] == 0
    service.test_sessions.step()
    assert service.test_sessions.status()["state"] == "Running"
    c = service.store.all("campaign")[0]
    service._events()
    assert service.test_sessions.status()["completed"] == 0
    service.client.fill(c["slots"][0]["entry"]["orderId"], 50)
    service._events()
    c = service.store.all("campaign")[0]
    service.client.fill(c["slots"][0]["stop"]["orderId"], 49.74)
    service._events()
    service.test_sessions.step()
    result = service.test_sessions.status()
    assert result["completed"] == 1 and result["state"] == "Complete"
    assert result["checkpoints"] == [1]
    assert len(result["attempts"][0]["result"]["executionIds"]) == 2
    assert service.armed is None


def test_session_halts_uncertain_transmission_and_never_retries(service, monkeypatch):
    authenticate(service)
    service.test_sessions.start("session", 2)
    original = service.client.write
    def uncertain(*args):
        original(*args)
        raise OSError("unknown socket outcome")
    monkeypatch.setattr(service.client, "write", uncertain)
    service.test_sessions.step()
    assert service.test_sessions.status()["state"] == "Halted"
    writes = len(service.client.writes)
    service.test_sessions.step()
    assert len(service.client.writes) == writes
    assert service.test_sessions.status()["completed"] == 0


def test_session_source_change_blocks_new_entries(service):
    authenticate(service)
    service.test_sessions.start("session", 2)
    service.source = lambda: "unreviewed-source"
    service.test_sessions.step()
    assert service.test_sessions.status()["state"] == "Halted"
    assert not service.client.writes


def test_explicit_resume_audits_repaired_source_only_while_flat(service):
    authenticate(service)
    service.test_sessions.start("session", 2)
    service.source = lambda: "repaired-source"
    service.test_sessions.step()
    service.test_sessions.resume()
    session = service.test_sessions.status()
    assert session["state"] == "Running"
    assert session["sourceReviews"][0]["previousSource"] == "reviewed-source"
    assert session["sourceIdentity"] == "repaired-source"
    assert not service.client.writes
    service.test_sessions.step(); service._events()
    service.source = lambda: "another-repair"
    with pytest.raises(PaperSafetyError, match="Close and reconcile"):
        service.test_sessions.resume()
    assert service.test_sessions.status()["sourceIdentity"] == "repaired-source"


def test_session_duplicate_start_cannot_change_target(service):
    authenticate(service)
    service.test_sessions.start("session", 2)
    with pytest.raises(PaperSafetyError, match="identity"): service.test_sessions.start("session", 200)


def test_approved_session_reconnect_reconciles_protection_without_repeating_entry(service):
    from brontide_eod.paper_service import PaperService
    authenticate(service)
    service.test_sessions.start("session", 2)
    service.test_sessions.step(); service._events()
    c = service.store.all("campaign")[0]
    service.client.fill(c["slots"][0]["entry"]["orderId"], 50)
    service._events()
    writes = len(service.client.writes)
    restarted = PaperService(service.store, factory=lambda: service.client, source=service.source)
    restarted.client = service.client
    restarted.connection_id = "reconnected"
    restarted.authenticated("verified-owner")
    restarted.test_sessions.step()
    assert restarted.test_sessions.status()["state"] == "Running"
    assert c["id"] in restarted.reviewed_campaigns
    assert len(service.client.writes) == writes
    assert restarted.test_sessions.status()["completed"] == 0


def test_changed_execution_quantity_remains_quarantined_through_recovery(service):
    c = opened(service)
    event = deepcopy(service.client.fills[0])
    event.update(eventId="quantity-conflict", quantity=2)
    service.client.events.append(event); service._events()
    authenticate(service)
    current = service.store.all("campaign")[0]
    with pytest.raises(PaperSafetyError, match="Conflicting economic"):
        service.recover(c["id"], current["revision"], "recover-conflict")
