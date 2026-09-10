import json

from brontide_eod.ibkr_readonly import IbkrReadOnlyService
from brontide_eod.ibkr_tws import PaperSafetyError, ReadOnlyInstrumentSnapshot, ReadOnlySmokeSnapshot


ACCOUNT = "EXACT-PRIVATE-PAPER-ACCOUNT"


def snapshot(*, positions, open_orders=(), observed_at="2026-09-10T04:00:00Z"):
    return ReadOnlySmokeSnapshot(
        observed_at=observed_at,
        account_summary=(
            {"tag": "NetLiquidation", "value": "30000.50", "currency": "USD"},
        ),
        position_rows=tuple(positions),
        open_order_rows=tuple(open_orders),
    )


def stock(con_id, symbol, quantity, average_cost):
    return {
        "conId": con_id,
        "symbol": symbol,
        "localSymbol": symbol,
        "secType": "STK",
        "currency": "USD",
        "exchange": "NASDAQ",
        "quantity": quantity,
        "averageCost": average_cost,
    }


class FakeClient:
    def __init__(self, snapshots):
        self.snapshots = iter(snapshots)
        self.authorized_account = None
        self.connected = False
        self.disconnects = 0

    def connect_verified(self):
        self.connected = True
        self.authorized_account = ACCOUNT
        return ACCOUNT

    def isConnected(self):
        return self.connected

    def read_only_snapshot(self):
        value = next(self.snapshots)
        if isinstance(value, Exception):
            raise value
        return value

    def disconnect(self):
        self.connected = False
        self.authorized_account = None
        self.disconnects += 1

    def read_only_instrument_snapshot(self, symbol, route="SMART"):
        return ReadOnlyInstrumentSnapshot(
            observed_at="2026-09-10T04:02:00Z", con_id=42, symbol=symbol.upper(),
            exchange="NASDAQ", route=route, currency="USD", minimum_tick=.01,
            bid=99.99, ask=100.01, quote_complete=True,
            market_data_type=1, order_types=("LMT", "MIDPX", "STP", "STPLMT"),
            valid_exchanges=("SMART", "NASDAQ", "OVERNIGHT"),
            trading_hours="20260910:0400-20260910:2000",
            liquid_hours="20260910:0930-20260910:1600",
            time_zone_id="US/Eastern", server_version=191,
        )


def test_refresh_masks_account_and_deduplicates_repeated_complete_snapshots():
    first = snapshot(
        positions=(stock(1, "AAPL", 5, 100), stock(2, "MSFT", -3, 200))
    )
    client = FakeClient([first, first])
    service = IbkrReadOnlyService(lambda: client)

    result = service.refresh()
    repeated = service.refresh()

    assert result["connectionStatus"] == "connected"
    assert len(result["positions"]) == 2
    assert len({item["id"] for item in repeated["positions"]}) == 2
    assert repeated["openOrders"] == []
    assert repeated["account"]["value"] == 30000.5
    assert ACCOUNT not in json.dumps(repeated)


def test_failed_refresh_retains_last_positions_as_stale_without_implying_closure():
    client = FakeClient(
        [
            snapshot(positions=(stock(1, "AAPL", 5, 100),)),
            PaperSafetyError("Positions did not complete before the read-only timeout."),
        ]
    )
    service = IbkrReadOnlyService(lambda: client)

    service.refresh()
    failed = service.refresh()

    assert failed["dataStatus"] == "stale"
    assert failed["positions"][0]["quantity"] == 5
    assert failed["positions"][0]["stale"] is True
    assert "closed" not in json.dumps(failed).lower()


def test_absent_position_from_complete_snapshot_requires_reconciliation():
    client = FakeClient(
        [
            snapshot(positions=(stock(1, "AAPL", 5, 100), stock(2, "MSFT", 3, 200))),
            snapshot(
                positions=(stock(1, "AAPL", 5, 100),),
                observed_at="2026-09-10T04:01:00Z",
            ),
        ]
    )
    service = IbkrReadOnlyService(lambda: client)

    service.refresh()
    result = service.refresh()

    missing = next(item for item in result["positions"] if item["symbol"] == "MSFT")
    assert missing["snapshotState"] == "reconciliation-required"
    assert missing["associationEligible"] is False
    assert missing["quantity"] == 3


def test_disconnect_retains_snapshot_and_next_refresh_reconnects():
    clients = [
        FakeClient([snapshot(positions=(stock(1, "AAPL", 5, 100),))]),
        FakeClient([snapshot(positions=(stock(1, "AAPL", 6, 101),))]),
    ]
    service = IbkrReadOnlyService(lambda: clients.pop(0))

    first = service.refresh()
    disconnected = service.disconnect()
    recovered = service.refresh()

    assert first["connectionStatus"] == "connected"
    assert disconnected["connectionStatus"] == "disconnected"
    assert disconnected["positions"][0]["quantity"] == 5
    assert recovered["connectionStatus"] == "connected"
    assert recovered["positions"][0]["quantity"] == 6


def test_instrument_snapshot_uses_owned_verified_client_and_exposes_no_account():
    client = FakeClient([snapshot(positions=())])
    service = IbkrReadOnlyService(lambda: client)
    service.refresh()
    result = service.instrument("aapl")
    assert result["contract"]["conId"] == 42
    assert result["quote"] == {"bid": 99.99, "ask": 100.01, "complete": True, "marketDataType": 1}
    assert result["executable"] is True
    assert ACCOUNT not in json.dumps(result)
