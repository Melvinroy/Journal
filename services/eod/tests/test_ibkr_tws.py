from dataclasses import replace

import pytest

from brontide_eod.ibkr_tws import (
    OperatorVerification,
    PaperGatewayConfig,
    PaperSafetyError,
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


def test_order_validation_requires_explicit_account_rth_whole_shares_and_no_market():
    base = {"account": CONFIG.account_id, "outsideRth": False, "totalQuantity": 10, "orderType": "MIDPRICE"}
    assert validate_order_fields(CONFIG.account_id, base) == base
    for bad in ({**base, "account": "OTHER"}, {**base, "outsideRth": True}, {**base, "totalQuantity": 1.5}, {**base, "orderType": "MKT"}):
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
