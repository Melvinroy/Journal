"""Read-only TWS account discovery never proves paper identity or arms orders."""

import threading
from datetime import datetime, timezone

import pytest

from brontide_eod import local_discovery
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.local_discovery import DiscoveryEndpoint, TwsManagedAccountReader


NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
ENDPOINT = DiscoveryEndpoint("127.0.0.1", 7947, 17)


def reader(monkeypatch, *, sdk_approved=True, response="DU123456,DU654321"):
    monkeypatch.setattr(local_discovery, "sdk_available", lambda: True)
    client = TwsManagedAccountReader(ENDPOINT, sdk_approved=sdk_approved, clock=lambda: NOW)
    calls = []
    connected = [False]

    def connect(host, port, client_id):
        calls.append(("connect", host, port, client_id))
        connected[0] = True
        client.nextValidId(100)

    def disconnect():
        calls.append(("disconnect",))
        connected[0] = False

    def request_accounts():
        calls.append(("reqManagedAccts",))
        if response is not None:
            client.managedAccounts(response)

    monkeypatch.setattr(client, "connect", connect)
    monkeypatch.setattr(client, "disconnect", disconnect)
    monkeypatch.setattr(client, "isConnected", lambda: connected[0])
    monkeypatch.setattr(client, "run", lambda: None)
    monkeypatch.setattr(client, "reqManagedAccts", request_accounts)
    return client, calls


def test_multiple_accounts_are_candidates_only_and_connection_is_closed(monkeypatch):
    client, calls = reader(monkeypatch)
    observed = client.discover(timeout_seconds=0.1)
    assert observed.accounts == ("DU123456", "DU654321")
    assert observed.source_binding == ENDPOINT.binding()
    assert observed.public_summary() == {
        "source": "broker-accessible-accounts",
        "connectionGeneration": observed.connection_generation,
        "observedAt": "2026-09-25T12:00:00Z",
        "candidates": [{"index": 0, "mask": "DU••••56"},
                       {"index": 1, "mask": "DU••••21"}],
        "paperIdentityVerified": False,
        "connectionVerifiedNow": False,
        "reconciliationComplete": False,
        "executionEnabled": False,
    }
    assert "DU123456" not in str(observed.public_summary())
    assert [call[0] for call in calls] == ["connect", "reqManagedAccts", "disconnect"]
    with pytest.raises(PaperSafetyError, match="cannot be reused"):
        client.discover(timeout_seconds=0.1)
    for method in (client.placeOrder, client.cancelOrder, client.reqAutoOpenOrders):
        with pytest.raises(PaperSafetyError):
            method()


def test_sdk_must_be_separately_approved_before_even_read_only_discovery(monkeypatch):
    client, calls = reader(monkeypatch, sdk_approved=False)
    with pytest.raises(PaperSafetyError, match="verified supported"):
        client.discover(timeout_seconds=0.1)
    assert calls == []


@pytest.mark.parametrize("endpoint", [
    DiscoveryEndpoint("localhost", 7947, 17),
    DiscoveryEndpoint("192.168.1.10", 7947, 17),
    DiscoveryEndpoint("127.0.0.1", 0, 17),
    DiscoveryEndpoint("127.0.0.1", 7947, 0),
    DiscoveryEndpoint("127.0.0.1", True, 17),
])
def test_discovery_rejects_nonliteral_or_invalid_endpoint(endpoint):
    with pytest.raises(PaperSafetyError, match="dedicated loopback"):
        TwsManagedAccountReader(endpoint)


@pytest.mark.parametrize("response", [
    "", "DU123456,", "DU123456,DU123456", "DU123456,bad/account",
    ",".join(f"DU{i:06}" for i in range(9)),
])
def test_empty_duplicate_or_invalid_broker_account_list_fails_closed(monkeypatch, response):
    client, calls = reader(monkeypatch, response=response)
    with pytest.raises(PaperSafetyError, match="invalid or ambiguous"):
        client.discover(timeout_seconds=0.1)
    assert calls[-1] == ("disconnect",)


def test_timeout_and_callback_error_are_bounded_and_redacted(monkeypatch):
    client, calls = reader(monkeypatch, response=None)
    with pytest.raises(PaperSafetyError, match="did not complete"):
        client.discover(timeout_seconds=0.01)
    assert calls[-1] == ("disconnect",)

    client, calls = reader(monkeypatch)
    monkeypatch.setattr(client, "connect", lambda *_args: calls.append(("connect",)))
    monkeypatch.setattr(client, "isConnected", lambda: True)
    with pytest.raises(PaperSafetyError, match="API readiness did not complete"):
        client.discover(timeout_seconds=0.01)
    assert not any(call[0] == "reqManagedAccts" for call in calls)
    assert calls[-1] == ("disconnect",)

    client, calls = reader(monkeypatch, response=None)

    def rejected():
        client.error(-1, 326, "private account error text")

    monkeypatch.setattr(client, "reqManagedAccts", rejected)
    with pytest.raises(PaperSafetyError, match="API error") as failure:
        client.discover(timeout_seconds=0.1)
    assert "private account" not in str(failure.value)
    assert calls[-1] == ("disconnect",)


def test_sdk_or_transport_failure_never_returns_an_account(monkeypatch):
    monkeypatch.setattr(local_discovery, "sdk_available", lambda: False)
    client = TwsManagedAccountReader(ENDPOINT, sdk_approved=True)
    with pytest.raises(PaperSafetyError, match="verified supported"):
        client.discover(timeout_seconds=0.1)

    client, calls = reader(monkeypatch)
    monkeypatch.setattr(client, "connect", lambda *_args: (_ for _ in ()).throw(
        RuntimeError("C:/private/account-file")))
    with pytest.raises(PaperSafetyError, match="discovery is unavailable") as failure:
        client.discover(timeout_seconds=0.1)
    assert "private" not in str(failure.value)
    assert calls[-1] == ("disconnect",)


def test_conflicting_managed_account_callbacks_fail_closed(monkeypatch):
    client, calls = reader(monkeypatch, response=None)

    def conflicting():
        client.managedAccounts("DU123456")
        client.managedAccounts("DU654321")

    monkeypatch.setattr(client, "reqManagedAccts", conflicting)
    with pytest.raises(PaperSafetyError, match="API error"):
        client.discover(timeout_seconds=0.1)
    assert calls[-1] == ("disconnect",)


def test_late_conflicting_callback_before_reader_exit_cannot_publish_accounts(monkeypatch):
    client, calls = reader(monkeypatch, response="DU123456")
    release = threading.Event()
    stopped = threading.Event()
    original_disconnect = client.disconnect

    def late_callback():
        assert release.wait(2)
        client.managedAccounts("DU654321")
        stopped.set()

    def disconnect():
        original_disconnect()
        release.set()

    monkeypatch.setattr(client, "run", late_callback)
    monkeypatch.setattr(client, "disconnect", disconnect)
    with pytest.raises(PaperSafetyError, match="API error"):
        client.discover(timeout_seconds=0.1)
    assert stopped.is_set()
    assert calls[-1] == ("disconnect",)


def test_reader_that_does_not_stop_after_disconnect_blocks_result(monkeypatch):
    client, calls = reader(monkeypatch, response="DU123456")
    release = threading.Event()
    monkeypatch.setattr(client, "run", lambda: release.wait(2))
    try:
        with pytest.raises(PaperSafetyError, match="could not close"):
            client.discover(timeout_seconds=0.1)
        assert calls[-1] == ("disconnect",)
    finally:
        release.set()


def test_documented_farm_notifications_do_not_block_account_list(monkeypatch):
    client, calls = reader(monkeypatch, response=None)

    def notices_then_accounts():
        for code in (2104, 2106, 2107, 2108, 2158):
            client.error(-1, code, "informational broker text")
        client.managedAccounts("DU123456")

    monkeypatch.setattr(client, "reqManagedAccts", notices_then_accounts)
    assert client.discover(timeout_seconds=0.1).accounts == ("DU123456",)
    assert calls[-1] == ("disconnect",)
