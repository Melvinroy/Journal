from dataclasses import replace
from types import SimpleNamespace

import pytest

from brontide_eod.ibkr_tws import (
    OperatorVerification,
    PaperGatewayConfig,
    PaperSafetyError,
    TwsPaperClient,
    authorize_connection,
    build_stock_contract_fields,
    create_operator_verification,
    client_from_environment,
    validate_order_fields,
    verify_connected_account,
)


CONFIG = PaperGatewayConfig("127.0.0.1", 12345, 17, "EXACT-ACCOUNT-7", True)


def verified() -> OperatorVerification:
    return create_operator_verification(CONFIG, CONFIG.account_id, "IB Gateway", "2026-09-09T09:00:00Z")


def test_submission_defaults_off_and_verification_is_exact():
    read_only = replace(CONFIG, submissions_enabled=False)
    read_only_verification = create_operator_verification(read_only, read_only.account_id, "TWS", "2026-09-09T09:00:00Z")
    assert verify_connected_account(read_only, read_only_verification, [read_only.account_id]) == read_only.account_id
    with pytest.raises(PaperSafetyError, match="disabled by default"):
        authorize_connection(read_only, read_only_verification, [CONFIG.account_id])
    with pytest.raises(PaperSafetyError, match="does not match"):
        create_operator_verification(CONFIG, "OTHER", "TWS", "2026-09-09T09:00:00Z")


@pytest.mark.parametrize("accounts", [[], ["OTHER"], ["EXACT-ACCOUNT-7", "OTHER"]])
def test_connection_rejects_missing_mismatched_or_unexpected_accounts(accounts):
    with pytest.raises(PaperSafetyError):
        authorize_connection(CONFIG, verified(), accounts)


def test_configuration_change_invalidates_operator_verification():
    with pytest.raises(PaperSafetyError, match="changed"):
        authorize_connection(replace(CONFIG, client_id=18), verified(), [CONFIG.account_id])


def test_client_zero_is_rejected_to_avoid_order_binding():
    with pytest.raises(PaperSafetyError, match="nonzero dedicated client ID"):
        replace(CONFIG, client_id=0).validate()


def test_order_validation_requires_explicit_account_rth_whole_shares_and_no_market():
    base = {"account": CONFIG.account_id, "outsideRth": False, "totalQuantity": 10, "orderType": "MIDPRICE"}
    assert validate_order_fields(CONFIG.account_id, base) == base
    assert validate_order_fields(CONFIG.account_id, {**base, "outsideRth": True})["outsideRth"] is True
    for bad in ({**base, "account": "OTHER"}, {**base, "outsideRth": None}, {**base, "totalQuantity": 1.5}, {**base, "orderType": "MKT"}):
        with pytest.raises(PaperSafetyError):
            validate_order_fields(CONFIG.account_id, bad)


def test_stock_contract_boundary_rejects_non_stock_or_unqualified_contract():
    stock = {"conId": 265598, "symbol": "AAPL", "secType": "STK", "exchange": "SMART", "currency": "USD"}
    assert build_stock_contract_fields(stock) == stock
    with pytest.raises(PaperSafetyError, match="stocks only"):
        build_stock_contract_fields({**stock, "secType": "OPT"})
    with pytest.raises(PaperSafetyError, match="contract ID"):
        build_stock_contract_fields({**stock, "conId": 0})


def test_environment_client_fails_closed_without_private_verification_file(monkeypatch):
    monkeypatch.delenv("BRONTIDE_IBKR_VERIFICATION_FILE", raising=False)
    with pytest.raises(PaperSafetyError, match="VERIFICATION_FILE"):
        client_from_environment()


def connected_read_client(monkeypatch):
    client = TwsPaperClient(CONFIG, verified())
    client.authorized_account = CONFIG.account_id
    monkeypatch.setattr(client, "isConnected", lambda: True)
    monkeypatch.setattr(client, "cancelAccountSummary", lambda _req_id: None)
    monkeypatch.setattr(client, "cancelPositions", lambda: None)
    return client


def test_read_only_snapshot_waits_for_all_completion_callbacks(monkeypatch):
    client = connected_read_client(monkeypatch)

    def account_summary(req_id, _group, _tags):
        client.accountSummary(req_id, CONFIG.account_id, "NetLiquidation", "100000", "USD")
        client.accountSummaryEnd(req_id)

    def positions():
        client.position(
            CONFIG.account_id,
            SimpleNamespace(
                conId=265598,
                symbol="AAPL",
                localSymbol="AAPL",
                secType="STK",
                currency="USD",
                primaryExchange="NASDAQ",
                exchange="SMART",
            ),
            12,
            101.25,
        )
        client.positionEnd()

    def open_orders():
        client.openOrder(
            44,
            SimpleNamespace(conId=265598, symbol="AAPL"),
            SimpleNamespace(
                account=CONFIG.account_id,
                action="SELL",
                totalQuantity=12,
                orderType="STP",
                tif="GTC",
            ),
            SimpleNamespace(status="Submitted"),
        )
        client.openOrderEnd()

    monkeypatch.setattr(client, "reqAccountSummary", account_summary)
    monkeypatch.setattr(client, "reqPositions", positions)
    monkeypatch.setattr(client, "reqAllOpenOrders", open_orders)

    snapshot = client.read_only_snapshot(timeout_seconds=0.1)
    assert snapshot.account_summary_items == 1
    assert snapshot.positions == 1
    assert snapshot.open_orders == 1
    assert snapshot.position_rows[0]["symbol"] == "AAPL"
    assert snapshot.open_order_rows[0]["orderType"] == "STP"


def test_read_only_snapshot_distinguishes_successful_empty_results(monkeypatch):
    client = connected_read_client(monkeypatch)
    monkeypatch.setattr(client, "reqAccountSummary", lambda req_id, _group, _tags: client.accountSummaryEnd(req_id))
    monkeypatch.setattr(client, "reqPositions", client.positionEnd)
    monkeypatch.setattr(client, "reqAllOpenOrders", client.openOrderEnd)

    snapshot = client.read_only_snapshot(timeout_seconds=0.1)
    assert snapshot.account_summary_items == 0
    assert snapshot.positions == 0
    assert snapshot.open_orders == 0


def test_read_only_snapshot_rejects_unexpected_account(monkeypatch):
    client = connected_read_client(monkeypatch)

    def account_summary(req_id, _group, _tags):
        client.accountSummary(req_id, "OTHER", "NetLiquidation", "100000", "USD")

    monkeypatch.setattr(client, "reqAccountSummary", account_summary)

    with pytest.raises(PaperSafetyError, match="unexpected account"):
        client.read_only_snapshot(timeout_seconds=0.1)


def test_read_only_snapshot_times_out_without_completion_callback(monkeypatch):
    client = connected_read_client(monkeypatch)
    monkeypatch.setattr(client, "reqAccountSummary", lambda _req_id, _group, _tags: None)

    with pytest.raises(PaperSafetyError, match="Account summary did not complete"):
        client.read_only_snapshot(timeout_seconds=0.01)


def test_read_only_instrument_snapshot_qualifies_contract_and_waits_for_bid_ask(monkeypatch):
    client = connected_read_client(monkeypatch)

    def contract_details(req_id, request):
        contract = SimpleNamespace(
            conId=265598,
            symbol=request.symbol,
            secType="STK",
            exchange="SMART",
            primaryExchange="NASDAQ",
            currency="USD",
        )
        client.contractDetails(req_id, SimpleNamespace(contract=contract, minTick=0.01, orderTypes="LMT,MIDPX,STP,STPLMT", validExchanges="SMART,NASDAQ,OVERNIGHT", tradingHours="20260910:0400-20260910:2000", liquidHours="20260910:0930-20260910:1600", timeZoneId="US/Eastern"))
        client.contractDetailsEnd(req_id)

    def market_data(req_id, _contract, _ticks, snapshot, regulatory, _options):
        assert snapshot is True
        assert regulatory is False
        client.marketDataType(req_id, 1)
        client.tickPrice(req_id, 1, 99.99, None)
        client.tickPrice(req_id, 2, 100.01, None)
        client.tickSnapshotEnd(req_id)

    monkeypatch.setattr(client, "reqContractDetails", contract_details)
    monkeypatch.setattr(client, "reqMarketDataType", lambda _kind: None)
    monkeypatch.setattr(client, "reqMktData", market_data)
    monkeypatch.setattr(client, "serverVersion", lambda: 191)
    result = client.read_only_instrument_snapshot("aapl", timeout_seconds=0.1)
    assert result.con_id == 265598
    assert result.symbol == "AAPL"
    assert result.minimum_tick == 0.01
    assert result.bid == 99.99
    assert result.ask == 100.01
    assert result.quote_complete is True
    assert result.market_data_type == 1


def test_read_only_instrument_snapshot_reports_missing_quote_without_fabrication(monkeypatch):
    client = connected_read_client(monkeypatch)

    def contract_details(req_id, request):
        contract = SimpleNamespace(conId=1, symbol=request.symbol, secType="STK", exchange="SMART", primaryExchange="", currency="USD")
        client.contractDetails(req_id, SimpleNamespace(contract=contract, minTick=0.01, orderTypes="LMT,MIDPX,STP,STPLMT", validExchanges="SMART", tradingHours="20260910:0400-20260910:2000", liquidHours="20260910:0930-20260910:1600", timeZoneId="US/Eastern"))
        client.contractDetailsEnd(req_id)

    monkeypatch.setattr(client, "reqContractDetails", contract_details)
    monkeypatch.setattr(client, "reqMarketDataType", lambda _kind: None)
    monkeypatch.setattr(client, "reqMktData", lambda req_id, *_args: client.tickSnapshotEnd(req_id))
    monkeypatch.setattr(client, "serverVersion", lambda: 191)
    result = client.read_only_instrument_snapshot("TEST", timeout_seconds=0.1)
    assert result.bid is None
    assert result.ask is None
    assert result.quote_complete is False
