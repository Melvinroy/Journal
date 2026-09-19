from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from brontide_eod.ibkr_tws import PaperGatewayConfig, create_operator_verification, PaperSafetyError
from brontide_eod.paper_domain import allocations, next_stop, summarize, validate_exit_plan
from brontide_eod.paper_store import PaperStore
from brontide_eod.paper_service import PaperService


def test_callback_transaction_failure_retains_events_for_retry(service, monkeypatch):
    from contextlib import contextmanager
    batch = approved(service)
    campaign = service.submit(batch["id"], 0, "entry")
    service._events()
    order_id = service.store.all("campaign")[0]["slots"][0]["entry"]["orderId"]
    service.client.events.append({"kind": "broker-error", "orderId": order_id, "code": 999, "eventId": "durable-error"})
    original = service.store.transaction
    @contextmanager
    def rollback():
        with original() as db:
            yield db
            raise OSError("disk failure at commit")
    monkeypatch.setattr(service.store, "transaction", rollback)
    with pytest.raises(OSError): service._events()
    assert len(service.pending_events) == 1
    assert not service.client.events
    monkeypatch.setattr(service.store, "transaction", original)
    service._events()
    assert not service.pending_events
    assert service.store.all("campaign")[0]["state"] == "Needs reconciliation"
    with original() as db:
        assert db.execute("SELECT COUNT(*) FROM events WHERE id='callback:durable-error'").fetchone()[0] == 1


def plan():
    return {"schemaVersion": 1, "breakeven": {"activationR": 1, "favorableOffset": {"unit": "Dollar", "value": 0}},
            "legs": [{"id": "T1", "role": "Target", "allocationPercent": 35, "target": {"mode": "R", "multipleR": 1}},
                     {"id": "A", "role": "Runner", "allocationPercent": 35, "activationR": 1, "trailing": {"mode": "Dollar", "distance": .5}},
                     {"id": "B", "role": "Runner", "allocationPercent": 30, "activationR": 2, "trailing": {"mode": "Percentage", "percent": 5}}]}


def ticket(**overrides):
    return {"symbol": "TEST", "direction": "Long", "method": "Limit", "quantity": 3,
            "planningPrice": 100, "hardCap": 100, "stopPrice": 98, "cleanupFloor": 98,
            "sessionMode": "Regular", "duration": "DAY", "protectionOrderType": "STP", "exitPlan": plan(), **overrides}


class FakeTransport:
    def __init__(self):
        self.config = PaperGatewayConfig("127.0.0.1", 12345, 71, "TEST-PAPER", True)
        self.verification = create_operator_verification(self.config, "TEST-PAPER", "TWS", datetime.now(timezone.utc).isoformat())
        self._managed_accounts = ["TEST-PAPER"]
        self.authorized_account = "TEST-PAPER"
        self.events, self.writes, self.orders, self.fills = [], [], {}, []
        self.next_id, self.bid, self.ask = 1000, 99.99, 100
        self.external = []
        self.connected = True
    def isConnected(self): return self.connected
    def connect_verified(self): self.connected = True
    def disconnect(self): self.connected = False
    def reserve(self, n):
        values = list(range(self.next_id, self.next_id + n)); self.next_id += n; return values
    def drain(self): events, self.events = self.events, []; return events
    def read_only_instrument_snapshot(self, symbol):
        day = datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")
        return SimpleNamespace(observed_at=datetime.now(timezone.utc).isoformat(), con_id=42, symbol=symbol,
            exchange="NYSE", route="SMART", currency="USD", minimum_tick=.01, bid=self.bid, ask=self.ask,
            quote_complete=True, market_data_type=1, order_types=["LMT", "MIDPX", "STP", "STPLMT", "OCA"],
            valid_exchanges=["SMART"], trading_hours=f"{day}:0000-{day}:2359", liquid_hours=f"{day}:0000-{day}:2359",
            time_zone_id="America/New_York", server_version=187)
    def read_only_snapshot(self):
        positions = sum(1 if f["side"] == "BOT" else -1 for f in self.fills)
        for oid, order in self.orders.items():
            if order["status"] not in {"Filled", "Cancelled", "Inactive"}: self.echo(oid)
        return SimpleNamespace(observed_at=datetime.now(timezone.utc).isoformat(), position_rows=([{"conId": 42, "quantity": positions, "symbol": "TEST"}] if positions else []) + self.external,
            open_order_rows=[{"orderId": oid, "conId": 42, "quantity": 1, "symbol": "TEST", "clientId": 71, "orderRef": o["fields"]["orderRef"]}
                             for oid, o in self.orders.items() if o["status"] not in {"Filled", "Cancelled", "Inactive"}],
            account_summary=[{"tag": tag, "value": "100000", "currency": "USD"} for tag in ("NetLiquidation", "AvailableFunds")])
    def execution_snapshot(self):
        self.events.extend(deepcopy(self.fills)); return {f["executionId"] for f in self.fills}
    def echo(self, oid):
        order = self.orders[oid]
        self.events.append({"kind": "open-order", "orderId": oid, "conId": 42, "status": order["status"],
                            "fields": {**order["fields"], "clientId": 71}})
    def write(self, oid, contract, fields):
        self.writes.append((oid, deepcopy(fields)))
        self.orders[oid] = {"fields": deepcopy(fields), "status": "Submitted"}
        self.echo(oid)
    def cancel_owned(self, oid):
        group = self.orders[oid]["fields"].get("ocaGroup")
        for other, order in self.orders.items():
            if (other == oid or (group and order["fields"].get("ocaGroup") == group)) and order["status"] not in {"Filled", "Cancelled", "Inactive"}:
                order["status"] = "Cancelled"
                self.events.append({"kind": "order-status", "orderId": other, "status": "Cancelled", "filled": 0, "remaining": 0, "clientId": 71})
    def fill(self, oid, price, fee=.1):
        order = self.orders[oid]; order["status"] = "Filled"
        event = {"kind": "execution", "executionId": f"E{oid}", "orderId": oid, "account": "TEST-PAPER", "clientId": 71,
                 "conId": 42, "side": "BOT" if order["fields"]["action"] == "BUY" else "SLD", "quantity": 1,
                 "price": price, "executedAt": "20260916 10:00:00 America/New_York", "orderRef": order["fields"]["orderRef"]}
        self.fills.append(event); self.events.append(event)
        if fee is not None: self.events.append({"kind": "commission", "executionId": event["executionId"], "commission": fee, "currency": "USD"})
        for other, candidate in self.orders.items():
            if other != oid and order["fields"].get("ocaGroup") and candidate["fields"].get("ocaGroup") == order["fields"]["ocaGroup"]:
                self.cancel_owned(other)
    def daily_references(self, contract): return {"SMA10": 102, "SMA20": 101, "SMA50": 100.5, "low": 101, "high": 105}


@pytest.fixture
def service(tmp_path, monkeypatch):
    fake = FakeTransport()
    s = PaperService(PaperStore(tmp_path / "paper.sqlite3"), factory=lambda: fake, source=lambda: "reviewed-source")
    s.client = fake; s.connection_id = "connection"
    monkeypatch.setenv("BRONTIDE_PAPER_APPROVAL_FILE", str(tmp_path / "approval.json"))
    yield s
    s.shutdown()


def approved(s):
    import os
    from pathlib import Path
    batch = s.prepare_batch([ticket()])
    Path(os.environ["BRONTIDE_PAPER_APPROVAL_FILE"]).write_text(json.dumps({"batchId": batch["id"], "ticketDigest": batch["digest"],
        "sourceIdentity": "reviewed-source", "accountBinding": s.client.config.binding(), "connectionId": s.connection_id,
        "approvedAt": datetime.now(timezone.utc).isoformat()}))
    s.arm(batch["id"])
    return batch


def opened(s):
    b = approved(s); c = s.submit(b["id"], 0, "entry-command")
    s._events()
    raw = s.store.all("campaign")[0]
    for slot in raw["slots"]: s.client.fill(slot["entry"]["orderId"], 100)
    s._events()
    return s.store.all("campaign")[0]


def test_utc_execution_and_legacy_replay_are_idempotent(service):
    from brontide_eod.paper_service import execution_time
    assert execution_time("20260916-15:23:43") == "2026-09-16T15:23:43+00:00"
    assert execution_time("20260916 11:23:43 America/New_York") == "2026-09-16T15:23:43+00:00"
    assert execution_time("ambiguous") == ""
    c = opened(service)
    original = deepcopy(service.client.fills[0])
    original["executedAt"] = "20260916-15:23:43"
    with service.store.transaction() as db:
        db.execute("DELETE FROM events WHERE id=?", ("exec-v1:" + original["executionId"],))
        service.store.event(db, "exec:" + original["executionId"], original)
        c["executions"][0]["occurredAt"] = ""
        service.store.put(db, "campaign", c["id"], c)
    replay = {**original, "eventId": "fresh-replay", "executedAt": "20260916 11:23:43 America/New_York", "quantity": 1.0, "permId": 123}
    service.client.events.append(replay); service._events()
    recovered = service.store.all("campaign")[0]
    assert len(recovered["executions"]) == 3
    assert recovered["executions"][0]["occurredAt"] == "2026-09-16T15:23:43+00:00"
    service.client.events.append({**replay, "eventId": "conflicting-replay", "price": 101}); service._events()
    assert service.store.all("campaign")[0]["state"] == "Needs reconciliation"
    assert len(service.store.all("quarantine")) == 1
    assert len(service.store.all("campaign")[0]["executions"]) == 3


def test_broker_bracket_group_requires_exact_parent_permanent_identity(service):
    b = approved(service); service.submit(b["id"], 0, "entry-command")
    c = service.store.all("campaign")[0]; slot = c["slots"][0]
    # Reproduce TWS assigning the parent's permanent ID as the child's OCA group.
    for event in service.client.events:
        if event["orderId"] == slot["entry"]["orderId"]: event["fields"]["permId"] = 560287590
        if event["orderId"] == slot["stop"]["orderId"]: event["fields"].update(ocaGroup="560287590", lmtPrice=1.7976931348623157e308)
    service._events()
    bound = service.store.all("campaign")[0]["slots"][0]
    assert bound["requestedGroup"] == slot["group"]
    assert bound["brokerGroup"] == "560287590"
    assert bound["stop"]["confirmed"]["auxPrice"] == 98
    event = {"kind": "open-order", "orderId": slot["stop"]["orderId"], "conId": 42, "status": "PreSubmitted",
             "fields": {**bound["stop"]["confirmed"], "ocaGroup": "unrelated"}}
    service.client.events.append(event); service._events()
    assert service.store.all("campaign")[0]["state"] == "Needs reconciliation"


def test_trigger_wait_is_protection_but_child_wait_is_not(service):
    from brontide_eod.paper_service import stop_is_protective
    c = opened(service)
    stop = c["slots"][0]["stop"]
    stop.update(status="PreSubmitted", whyHeld="trigger")
    assert stop_is_protective(stop)
    stop["whyHeld"] = "child,trigger"
    assert not stop_is_protective(stop)
    stop["whyHeld"] = "locate"
    assert not stop_is_protective(stop)


def test_audited_recovery_does_not_enable_entry_or_change_original_source(service):
    c = opened(service)
    c["state"] = "Needs reconciliation"; c["message"] = "Changed in IBKR: quantity or protection relationship differs."
    service._save(c)
    service.authenticated("verified-user")
    service.source = lambda: "fixed-source"
    before = len(service.client.writes)
    result = service.recover(c["id"], c["revision"], "recover-once")
    assert result["state"] == "Open"
    assert len(service.client.writes) == before
    batch = service._batch(c["batchId"])
    assert batch["sourceIdentity"] == "reviewed-source"
    assert service.management_source(batch) == "fixed-source"
    assert service.recover(c["id"], c["revision"], "recover-once")["state"] == "Open"
    with pytest.raises(PaperSafetyError): service._authority(batch, entry=True)


def test_three_independently_protected_shares_and_no_duplicate_submission(service):
    b = approved(service)
    first = service.submit(b["id"], 0, "entry-command")
    service.submit(b["id"], 0, "entry-command")
    assert len(service.client.writes) == 6
    assert {f["totalQuantity"] for _, f in service.client.writes} == {1}
    stops = [f for _, f in service.client.writes if f["orderType"] == "STP"]
    assert len({f["ocaGroup"] for f in stops}) == 3
    assert all(f["ocaType"] == 1 and f["transmit"] for f in stops)
    assert first["summary"]["entered"] == 0
    with pytest.raises(PaperSafetyError): service.submit(b["id"], 0, "another-command")


def test_execution_and_fees_drive_journal_not_acknowledgement(service):
    c = opened(service)
    assert c["state"] == "Open"
    assert summarize(c)["entered"] == 3
    service.reconcile()
    assert len(service.store.all("campaign")[0]["executions"]) == 3
    service.client.bid, service.client.ask = 103, 103.01
    service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    target = c["slots"][0]["exit"]
    assert target["fields"]["lmtPrice"] == 102
    assert target["fields"]["ocaGroup"] == c["slots"][0]["stop"]["fields"]["ocaGroup"]
    service.client.fill(target["orderId"], 102)
    service._events()
    result = summarize(service.store.all("campaign")[0])
    assert result["openQuantity"] == 2
    assert result["grossRealized"] == 2
    assert result["netRealized"] == pytest.approx(1.6)


def test_missing_execution_never_becomes_fill_and_position_mismatch_blocks(service):
    b = approved(service); service.submit(b["id"], 0, "entry-command"); service._events()
    assert summarize(service.store.all("campaign")[0])["entered"] == 0
    service.client.external = [{"conId": 42, "quantity": 1, "symbol": "TEST"}]
    service.reconcile()
    assert service.store.all("campaign")[0]["state"] == "Needs reconciliation"


def test_blocked_short_excluded_symbol_and_expired_approval(service, monkeypatch):
    for value in (ticket(direction="Short"), ticket(symbol="AMD"), ticket(quantity=4), ticket(hardCap=200)):
        with pytest.raises(PaperSafetyError): service.prepare_batch([value])
    batch = approved(service)
    service.source = lambda: "different-source"
    with pytest.raises(PaperSafetyError, match="source"): service.submit(batch["id"], 0, "entry")
    assert not service.client.writes


def test_no_transmission_when_persistence_fails(service, monkeypatch):
    batch = approved(service)
    monkeypatch.setattr(service.store, "command", lambda *args: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError): service.submit(batch["id"], 0, "entry")
    assert service.client.writes == []


def test_transport_timeout_cannot_be_retried_as_new_economic_action(service, monkeypatch):
    batch = approved(service)
    original = service.client.write
    def uncertain(*args): original(*args); raise TimeoutError("unknown")
    monkeypatch.setattr(service.client, "write", uncertain)
    with pytest.raises(TimeoutError): service.submit(batch["id"], 0, "entry")
    assert service.store.all("campaign")[0]["state"] == "Needs reconciliation"
    service.submit(batch["id"], 0, "entry")
    assert len(service.client.writes) == 1


def test_cleanup_keeps_protection_and_uses_at_most_two_attempts(service):
    c = opened(service)
    service.client.bid = 99
    service.action(c["id"], c["revision"], "cleanup", "cleanup")
    service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    assert all(s["stop"]["status"] in {"Submitted", "PreSubmitted"} for s in c["slots"])
    assert all(s["exit"]["fields"]["lmtPrice"] >= 98 for s in c["slots"])
    for slot in c["slots"]: service.client.fill(slot["exit"]["orderId"], 99)
    service._events()
    c = service.store.all("campaign")[0]
    assert c["state"] == "Closed"
    assert summarize(c)["finalNetR"] == pytest.approx(-.6)


def test_restart_replays_without_duplicate_executions(service):
    c = opened(service)
    other = PaperService(service.store, factory=lambda: service.client, source=lambda: "reviewed-source")
    other.client = service.client
    other.reconcile()
    assert other.armed is None
    assert summarize(other.store.all("campaign")[0])["entered"] == 3


@pytest.mark.parametrize("direction,entry,current,quote,favorable,expected", [
    ("Long", 100, 98, 103, 103, 102.5), ("Short", 100, 102, 97, 97, 97.5)])
def test_long_short_independent_runner_symmetry(direction, entry, current, quote, favorable, expected):
    p = plan()
    assert next_stop(direction, entry, 2, current, quote, favorable, p["legs"][1], p["breakeven"], .01) == expected


@pytest.mark.parametrize("direction", ["Long", "Short"])
@pytest.mark.parametrize("mode", ["Dollar", "Percentage", "Manual", "SMA", "Day extreme"])
def test_all_runner_modes_preserve_direction_and_latched_activation(direction, mode):
    sign = 1 if direction == "Long" else -1
    candidate = 100 + sign * 2
    rule = {"mode": mode, "distance": 2, "percent": 2, "stopPrice": candidate, "period": 10}
    leg = {"role": "Runner", "activationR": 5, "trailing": rule}
    be = {"activationR": 20, "favorableOffset": {"unit": "Dollar", "value": 0}}
    quote, favorable, initial = 100 + sign * 3, 100 + sign * 4, 100 - sign * 2
    refs = {"SMA10": candidate, "low": candidate, "high": candidate}
    assert next_stop(direction, 100, 2, initial, quote, favorable, leg, be, .01, refs) is None
    stop = next_stop(direction, 100, 2, initial, quote, favorable, leg, be, .01, refs, True)
    assert sign * (stop - initial) > 0 and sign * (quote - stop) > 0
    assert next_stop(direction, 100, 2, stop, quote, favorable, leg, be, .01, refs, True) is None


def test_cleanup_exhaustion_reprices_same_order_and_keeps_stop(service):
    from datetime import timedelta
    c = opened(service)
    service.client.bid = 99
    service.action(c["id"], c["revision"], "cleanup-bounded", "cleanup")
    for attempt in range(2):
        service._automate(service.store.all("campaign")[0]); service._events()
        c = service.store.all("campaign")[0]
        assert all(s["cleanupAttempts"] == attempt + 1 for s in c["slots"])
        for slot in c["slots"]:
            slot["exit"]["createdAt"] = (datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat()
        service._save(c)
        service._automate(c)
        # Pending modification cannot authorize another transmission before its callback.
        before = len(service.client.writes)
        service._automate(service.store.all("campaign")[0])
        assert len(service.client.writes) == before
        service._events()
    before = len(service.client.writes)
    service._automate(service.store.all("campaign")[0])
    c = service.store.all("campaign")[0]
    assert len(service.client.writes) == before
    assert summarize(c)["openQuantity"] == 3
    assert all(s["stop"]["status"] == "Submitted" for s in c["slots"])
    assert "exhausted" in c["automation"]
    assert len({oid for oid, fields in service.client.writes if fields["orderType"] == "LMT" and fields["action"] == "SELL"}) == 3
    assert all(s["exit"]["status"] == "Submitted" for s in c["slots"])


def test_cleanup_modifies_target_in_place_and_pause_retains_oca_protection(service):
    c = opened(service)
    service._automate(c); service._events()
    c = service.store.all("campaign")[0]
    target_id = c["slots"][0]["exit"]["orderId"]
    before = len(service.client.writes)
    service.action(c["id"], c["revision"], "pause", "cancel-exits")
    service._events()
    c = service.store.all("campaign")[0]
    assert len(service.client.writes) == before
    assert c["slots"][0]["exit"]["status"] == "Submitted"
    assert all(s["stop"]["status"] == "Submitted" for s in c["slots"])
    service.action(c["id"], c["revision"], "close", "cleanup")
    service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    assert c["slots"][0]["exit"]["orderId"] == target_id
    assert c["slots"][0]["exit"]["role"] == "cleanup"
    assert all(s["stop"]["status"] == "Submitted" for s in c["slots"])
    for slot in c["slots"]: service.client.fill(slot["exit"]["orderId"], 99.99)
    service._events()
    c = service.store.all("campaign")[0]
    assert c["state"] == "Closed"
    assert all(s["stop"]["status"] == "Cancelled" for s in c["slots"])


def test_cancelled_oca_recovery_is_closure_only_and_retains_floor(service):
    c = opened(service)
    service._automate(c); service._events()
    c = service.store.all("campaign")[0]
    slot = c["slots"][0]
    service.client.cancel_owned(slot["exit"]["orderId"]); service._events()
    c = service.store.all("campaign")[0]
    slot = c["slots"][0]
    c["cleanup"] = True
    slot["entry"]["permId"] = 123
    slot["stop"]["permId"] = 124
    slot["brokerGroup"] = "123"
    # Close the other slots using their broker-held stops; one cancelled pair remains.
    for other in c["slots"][1:]: service.client.fill(other["stop"]["orderId"], 98)
    service._save(c); service._events()
    c = service.store.all("campaign")[0]
    service.authenticated("verified-user")
    service.source = lambda: "fixed-source"
    writes = len(service.client.writes)
    # An unrelated order or a mismatched permanent parent blocks recovery.
    service.client.orders[9999] = {"status": "Submitted", "fields": {"orderRef": "unrelated", "action": "SELL"}}
    with pytest.raises(PaperSafetyError): service.recover(c["id"], c["revision"], "blocked-unrelated")
    del service.client.orders[9999]
    c = service.store.all("campaign")[0]
    c["slots"][0]["brokerGroup"] = "wrong-parent"; service._save(c)
    with pytest.raises(PaperSafetyError): service.recover(c["id"], c["revision"], "blocked-parent")
    c = service.store.all("campaign")[0]
    c["slots"][0]["brokerGroup"] = "123"; service._save(c)
    recovered = service.recover(c["id"], c["revision"], "recover-cancelled")
    assert recovered["state"] == "Unprotected"
    assert len(service.client.writes) == writes
    c = service.store.all("campaign")[0]
    assert c["closureOnly"]
    with pytest.raises(PaperSafetyError, match="closure only"):
        service.review_action(c["id"], c["revision"], "cannot-resume", "resume")
    service.review_action(c["id"], c["revision"], "close-only", "cleanup")
    service.client.bid = 97
    service._automate(service.store.all("campaign")[0])
    assert len(service.client.writes) == writes
    service.client.bid = 99
    service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    service.client.fill(c["slots"][0]["exit"]["orderId"], 99)
    service._events()
    assert service.store.all("campaign")[0]["state"] == "Closed"


def test_exit_fill_racing_cancellation_cannot_create_another_close(service):
    c = opened(service)
    service.client.bid = 99
    service.action(c["id"], c["revision"], "cleanup-race", "cleanup")
    service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    oid = c["slots"][0]["exit"]["orderId"]
    service.client.cancel_owned(oid)
    service.client.fill(oid, 99)
    service._events()
    c = service.store.all("campaign")[0]
    assert c["slots"][0]["open"] == 0
    before = len(service.client.writes)
    service._automate(c); service._events()
    assert len(service.client.writes) == before
    assert summarize(service.store.all("campaign")[0])["openQuantity"] == 2


def test_shared_allocation_contract():
    assert [leg["quantity"] for leg in allocations(37, plan())] == [13, 13, 11]
    assert [leg["quantity"] for leg in allocations(3, plan())] == [1, 1, 1]
    assert next_stop("Long", 100, 2, 102.9, 103, 103, plan()["legs"][1], plan()["breakeven"], .01) is None


def test_api_origin_boundary_and_readonly_status(service):
    from brontide_eod.api import app
    from brontide_eod.paper_api import execution_service
    app.dependency_overrides[execution_service] = lambda: service
    try:
        client = TestClient(app)
        assert client.get("/v1/ibkr/paper/status").status_code == 200
        assert client.post("/v1/ibkr/paper/connect").status_code == 403
        assert client.post("/v1/ibkr/paper/batches", json={"tickets": [ticket()]},
                           headers={"X-Brontide-Local": "1", "Origin": "https://untrusted.example"}).status_code == 403
        assert not service.client.writes
        assert client.get("/v1/ibkr/paper/status", headers={"Host": "untrusted.example"}).status_code == 400
    finally: app.dependency_overrides.clear()


def test_shared_fixture_parity():
    from pathlib import Path
    fixture = json.loads((Path(__file__).parents[1] / "fixtures/paper-domain-parity.json").read_text())
    for item in fixture["allocations"]:
        p = plan()
        while len(p["legs"]) < len(item["percentages"]): p["legs"].append({"id": "T2", "role": "Target", "target": {"mode": "R", "multipleR": 2}})
        for leg, percent in zip(p["legs"], item["percentages"]): leg["allocationPercent"] = percent
        assert [leg["quantity"] for leg in allocations(item["quantity"], p)] == item["expected"]
    for item in fixture["risk"]: assert abs(item["entry"] - item["stop"]) == item["expected"]


def test_partial_entry_defers_targets_until_cancelled_remainders(service):
    b = approved(service); service.submit(b["id"], 0, "entry"); service._events()
    c = service.store.all("campaign")[0]
    service.client.fill(c["slots"][0]["entry"]["orderId"], 100)
    service._events(); c = service.store.all("campaign")[0]
    assert c["state"] == "Partially filled"
    service._automate(c)
    assert all("exit" not in s for s in service.store.all("campaign")[0]["slots"])
    c = service.store.all("campaign")[0]
    service.action(c["id"], c["revision"], "cancel-rest", "cancel-entry")
    service._events(); c = service.store.all("campaign")[0]
    assert c["entryFinal"] and c["executionRisk"] == 2
    assert c["allocationPending"]
    assert "leg" not in c["slots"][0]
    assert c["slots"][0]["stop"]["status"] == "Submitted"


def test_stop_rejection_has_one_reconciled_replacement_only(service):
    c = opened(service)
    old = c["slots"][0]["stop"]["orderId"]
    service.client.orders[old]["status"] = "Inactive"
    service.client.events.append({"kind": "broker-error", "orderId": old, "code": 201})
    service._events(); service._automate(service.store.all("campaign")[0]); service._events()
    c = service.store.all("campaign")[0]
    new = c["slots"][0]["stop"]["orderId"]
    assert new != old and c["slots"][0]["protectionAttempts"] == 1
    service.client.orders[new]["status"] = "Inactive"
    service.client.events.append({"kind": "broker-error", "orderId": new, "code": 201})
    service._events(); before = len(service.client.writes)
    service._automate(service.store.all("campaign")[0])
    assert len(service.client.writes) == before
    assert service.store.all("campaign")[0]["state"] == "Unprotected"


def test_amendment_is_unapplied_and_requires_exact_approval(service):
    import os
    from pathlib import Path
    c = opened(service)
    changed = plan(); changed["legs"][0]["target"]["multipleR"] = 3
    saved = service.action(c["id"], c["revision"], "draft", "save-amendment", changed)
    before = len(service.client.writes)
    assert saved["ticket"]["exitPlan"]["legs"][0]["target"]["multipleR"] == 1
    with pytest.raises(PaperSafetyError, match="approval"):
        service.action(c["id"], saved["revision"], "apply-unapproved", "apply-amendment")
    path = Path(os.environ["BRONTIDE_PAPER_APPROVAL_FILE"])
    receipt = json.loads(path.read_text()); receipt["approvedAmendmentDigests"] = [saved["draft"]["digest"]]; path.write_text(json.dumps(receipt))
    service.action(c["id"], saved["revision"], "apply-approved", "apply-amendment")
    assert len(service.client.writes) == before
    assert service.store.all("campaign")[0]["activeExitPlan"]["legs"][0]["target"]["multipleR"] == 3


@pytest.mark.parametrize("change_legs", [False, True])
def test_working_targets_allow_only_breakeven_amendment(service, change_legs):
    c = opened(service)
    service._automate(c); service._events()
    c = service.store.all("campaign")[0]
    service.authenticated("verified-user")
    changed = plan(); changed["breakeven"]["activationR"] = 2
    if change_legs: changed["legs"][0]["target"]["multipleR"] = 3
    saved = service.action(c["id"], c["revision"], "amend-draft", "save-amendment", changed)
    before = len(service.client.writes)
    if change_legs:
        with pytest.raises(PaperSafetyError, match="Only breakeven"):
            service.review_action(c["id"], saved["revision"], "amend-apply", "apply-amendment", {"digest": saved["draft"]["digest"]})
    else:
        service.review_action(c["id"], saved["revision"], "amend-apply", "apply-amendment", {"digest": saved["draft"]["digest"]})
        assert service.store.all("campaign")[0]["activeExitPlan"]["breakeven"]["activationR"] == 2
    assert len(service.client.writes) == before
    assert all(s["stop"]["status"] == "Submitted" for s in service.store.all("campaign")[0]["slots"])


def test_missing_and_late_fees_remain_truthful(service):
    b = approved(service); service.submit(b["id"], 0, "entry"); service._events()
    c = service.store.all("campaign")[0]
    for slot in c["slots"]: service.client.fill(slot["entry"]["orderId"], 100, fee=None)
    service._events()
    assert summarize(service.store.all("campaign")[0])["netRealized"] is None
    for e in service.client.fills:
        service.client.events.append({"kind": "commission", "executionId": e["executionId"], "commission": .1, "currency": "USD"})
    service._events()
    assert summarize(service.store.all("campaign")[0])["fees"] == pytest.approx(.3)


def test_snapshot_absence_does_not_mark_unknown_order_cancelled(service):
    b = approved(service); service.submit(b["id"], 0, "entry"); service._events()
    service.client.orders.clear()
    service.reconcile()
    c = service.store.all("campaign")[0]
    assert c["state"] == "Needs reconciliation"
    assert summarize(c)["entered"] == 0


def test_transport_uses_official_order_cancel_and_independent_oca_fields(monkeypatch):
    pytest.importorskip("ibapi.order_cancel", reason="Official TWS SDK is operator-installed; never substitute an unofficial client.")
    from brontide_eod.paper_transport import PaperTransport
    from ibapi.order_cancel import OrderCancel
    fake = FakeTransport()
    transport = PaperTransport(fake.config, fake.verification)
    transport.authorized_account = "TEST-PAPER"; transport._managed_accounts = ["TEST-PAPER"]
    monkeypatch.setattr(transport, "isConnected", lambda: True)
    sent, cancelled = [], []
    monkeypatch.setattr(transport, "placeOrder", lambda oid, contract, order: sent.append(order))
    monkeypatch.setattr(transport, "cancelOrder", lambda oid, spec: cancelled.append(spec))
    transport.write(1, {"conId": 42, "symbol": "TEST", "secType": "STK", "exchange": "SMART", "currency": "USD"},
                    {"account": "TEST-PAPER", "action": "SELL", "orderType": "LMT", "lmtPrice": 102,
                     "totalQuantity": 1, "outsideRth": False, "tif": "DAY", "transmit": True, "ocaGroup": "owned", "ocaType": 1})
    transport.cancel_owned(1)
    assert isinstance(cancelled[0], OrderCancel)
    assert sent[0].ocaGroup == "owned" and sent[0].ocaType == 1


def test_transport_ids_exceed_observed_orders_and_never_regress(monkeypatch):
    pytest.importorskip("ibapi.order_cancel")
    from concurrent.futures import ThreadPoolExecutor
    from brontide_eod.paper_transport import PaperTransport
    fake = FakeTransport()
    transport = PaperTransport(fake.config, fake.verification)
    transport.observe_order_id(700)
    with pytest.raises(PaperSafetyError, match="unavailable"):
        transport.reserve(1)
    transport.nextValidId(100)
    assert transport.reserve(2) == [701, 702]
    transport.orderStatus(900, "Submitted", 0, 1, 0, 1, 0, 0, 99, "")
    assert transport.reserve(1) == [901]
    transport.nextValidId(200)  # a reconnect callback cannot reuse a reserved ID
    assert transport.reserve(1) == [902]
    with ThreadPoolExecutor(max_workers=4) as pool:
        allocated = list(pool.map(lambda _: transport.reserve(3), range(40)))
    ids = [value for batch in allocated for value in batch]
    assert len(ids) == len(set(ids)) == 120
    assert min(ids) == 903
    transport._order_id_ready.clear()
    with pytest.raises(PaperSafetyError, match="unavailable"):
        transport.reserve(1)


def test_malformed_owned_callback_is_quarantined_without_losing_other_fees(service):
    c = opened(service)
    service.client.events.extend([
        {"kind": "execution", "orderId": c["slots"][0]["entry"]["orderId"], "eventId": "malformed"},
        {"kind": "commission", "executionId": c["executions"][0]["executionId"], "commission": 1.25, "currency": "USD", "eventId": "late-fee"},
    ])
    service._events()
    result = service.store.all("campaign")[0]
    assert result["state"] == "Needs reconciliation"
    assert result["executions"][0]["commission"] == 1.25
    assert len(service.store.all("quarantine")) == 1
    assert service.pending_events == []


def test_execution_snapshot_filters_owned_client_and_explicit_utc_history(service, monkeypatch):
    from brontide_eod.paper_transport import PaperTransport
    from datetime import timedelta
    transport = PaperTransport(service.client.config, service.client.verification)
    transport.authorized_account = service.client.authorized_account
    captured = {}
    def request(request_id, filters):
        captured.update(client=filters.clientId, account=filters.acctCode, time=filters.time)
        transport.execution_end.set()
    monkeypatch.setattr(transport, "reqExecutions", request)
    transport.execution_snapshot()
    assert captured["client"] == 71
    assert captured["account"] == service.client.authorized_account
    since = datetime.strptime(captured["time"], "%Y%m%d-%H:%M:%S").replace(tzinfo=timezone.utc)
    assert timedelta(days=6, hours=23, minutes=59) < datetime.now(timezone.utc) - since < timedelta(days=7, minutes=1)


def test_completed_parent_identity_requires_recorded_client_and_exact_reference(service):
    batch = approved(service); service.submit(batch["id"], 0, "entry-command")
    for event in service.client.events:
        if event["fields"]["orderType"] == "STP": event["fields"]["ocaGroup"] = "560287590"
    service._events()
    c = service.store.all("campaign")[0]; slot = c["slots"][0]
    completed = {"kind": "completed-order", "conId": 42, "status": "Filled", "quantity": 1, "filledQuantity": 1,
                 "fields": {**slot["entry"]["fields"], "permId": 560287590}}
    service.client.events.append({**completed, "fields": {**completed["fields"], "orderRef": "unrelated"}})
    service._events()
    assert service.store.all("campaign")[0]["slots"][0]["entry"].get("permId") is None
    service.client.events.append(completed)
    stop = deepcopy(slot["stop"]["fields"]); stop.update(ocaGroup="560287590", clientId=71)
    service.client.events.append({"kind": "open-order", "orderId": slot["stop"]["orderId"], "conId": 42, "fields": stop, "status": "PreSubmitted"})
    service._events()
    c = service.store.all("campaign")[0]
    assert c["slots"][0]["entry"]["permId"] == 560287590
    assert c["slots"][0]["stop"]["confirmed"]["ocaGroup"] == "560287590"
    assert c["executions"] == []  # A completed-order acknowledgement is never a fill.


def test_audited_recovery_rebuilds_missing_timestamp_from_preserved_fill(service, monkeypatch):
    c = opened(service)
    original = deepcopy(service.client.fills[0]); original["executedAt"] = "20260916-15:23:43"
    with service.store.transaction() as db:
        db.execute("DELETE FROM events WHERE id=?", ("exec-v1:" + original["executionId"],))
        service.store.event(db, "exec:" + original["executionId"], original)
        c["executions"][0]["occurredAt"] = ""
        c["state"] = "Needs reconciliation"
        service.store.put(db, "campaign", c["id"], c)
    monkeypatch.setattr(service.client, "execution_snapshot", lambda: set())
    service.authenticated("verified-owner")
    recovered = service.recover(c["id"], c["revision"], "audited-history")
    assert recovered["executions"][0]["occurredAt"] == "2026-09-16T15:23:43+00:00"
    assert len(recovered["executions"]) == 3
    assert recovered["state"] == "Open"


def test_modern_sdk_history_requests_seven_days_and_normalizes_errors_and_fees(service, monkeypatch):
    from types import SimpleNamespace
    from brontide_eod.paper_transport import PaperTransport
    from ibapi.execution import ExecutionFilter
    if not hasattr(ExecutionFilter(), "lastNDays"):
        pytest.skip("Explicit seven-day history requires the current official SDK")
    transport = PaperTransport(service.client.config, service.client.verification)
    transport.authorized_account = service.client.authorized_account
    monkeypatch.setattr(transport, "serverVersion", lambda: 226)
    captured = {}
    def request(request_id, filters):
        captured.update(days=filters.lastNDays, client=filters.clientId, account=filters.acctCode)
        transport.execution_end.set()
    monkeypatch.setattr(transport, "reqExecutions", request)
    transport.execution_snapshot()
    assert captured == {"days": 7, "client": 71, "account": service.client.authorized_account}
    transport.error(9301, 10197, "legacy broker text", "")
    transport.error(9301, 1770000000000, 321, "modern broker text", "")
    transport.commissionAndFeesReport(SimpleNamespace(execId="known-fill", commissionAndFees=1.09, currency="USD"))
    events = transport.drain()
    assert [e["code"] for e in events if e["kind"] == "broker-error"] == [10197, 321]
    assert all("broker text" not in str(e) for e in events)
    fee = events[-1]
    assert fee["kind"] == "commission" and fee["executionId"] == "known-fill"
    assert fee["commission"] == 1.09 and fee["currency"] == "USD"
