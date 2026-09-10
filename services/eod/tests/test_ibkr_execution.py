from datetime import datetime, timezone
import json

import pytest

from brontide_eod.ibkr_execution import PaperIntentStore, _effective_session, broker_trade_date, prepare_paper_intent
from brontide_eod.ibkr_tws import PaperSafetyError


ACCOUNT = "EXACT-PRIVATE-PAPER-ACCOUNT"


def instrument(*, executable=True, data_type=1, bid=99.99, ask=100.00):
    return {
        "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "contract": {"conId": 42, "symbol": "TEST", "secType": "STK", "exchange": "NYSE", "primaryExchange": "NYSE", "route": "SMART", "currency": "USD", "minimumTick": .01, "orderTypes": ["LMT", "MIDPX", "STP", "STPLMT", "TRAIL", "TRAILLMT"], "validExchanges": ["SMART", "NYSE", "OVERNIGHT"], "tradingHours": "20260910:0400-20260910:2000;20260911:0400-20260911:2000", "liquidHours": "20260910:0930-20260910:1600;20260911:0930-20260911:1600", "timeZoneId": "US/Eastern", "serverVersion": 191},
        "quote": {"bid": bid, "ask": ask, "complete": True, "marketDataType": data_type},
        "executable": executable,
    }


def payload(**overrides):
    value = {
        "intentId": "intent-1", "idempotencyKey": "plan-1:entry:v1", "planId": "plan-1", "campaignId": "campaign-1",
        "symbol": "TEST", "direction": "Long", "method": "Normal", "quantity": 2,
        "planningPrice": 100, "hardCap": 100, "stopPrice": 98,
        "maximumPriceDriftPercent": .5, "exitPlan": {"legs": [{"id": "T1"}]},
    }
    value.update(overrides)
    return value


def test_prepare_persists_private_exact_account_but_returns_only_safe_metadata(tmp_path):
    store = PaperIntentStore(tmp_path / "private.json")
    result = prepare_paper_intent(payload(), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    assert result["status"] == "Validated intent"
    assert result["submissionsEnabled"] is False
    assert ACCOUNT not in json.dumps(result)
    raw = json.loads(store.path.read_text(encoding="utf-8"))
    assert raw["records"][0]["package"]["entry"]["account"] == ACCOUNT
    assert raw["records"][0]["audit"][-1] == "persisted-before-submission"


def test_prepare_is_idempotent_and_rejects_changed_economic_action(tmp_path):
    store = PaperIntentStore(tmp_path / "private.json")
    first = prepare_paper_intent(payload(), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    repeated = prepare_paper_intent(payload(), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    assert first["intentId"] == repeated["intentId"]
    with pytest.raises(PaperSafetyError, match="different economic action"):
        prepare_paper_intent(payload(quantity=3), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)


@pytest.mark.parametrize(
    "observed,match",
    [
        (instrument(executable=False, data_type=3), "delayed or frozen"),
        (instrument(bid=101, ask=101.01), "drift"),
    ],
)
def test_prepare_blocks_non_executable_or_drifted_quotes(tmp_path, observed, match):
    validation_time = datetime.fromisoformat(observed["observedAt"].replace("Z", "+00:00"))
    with pytest.raises(PaperSafetyError, match=match):
        prepare_paper_intent(payload(hardCap=102), account_id=ACCOUNT, account_binding="binding", instrument=observed, existing_symbols=set(), store=PaperIntentStore(tmp_path / "private.json"), now=validation_time)


def test_prepare_excludes_existing_position_and_opening_auction(tmp_path):
    store = PaperIntentStore(tmp_path / "private.json")
    with pytest.raises(PaperSafetyError, match="existing broker position"):
        prepare_paper_intent(payload(), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols={"TEST"}, store=store)
    with pytest.raises(PaperSafetyError, match="Opening-auction"):
        prepare_paper_intent(payload(method="Opening"), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)


def test_extended_hours_requires_explicit_limit_and_stop_limit(tmp_path):
    store = PaperIntentStore(tmp_path / "private.json")
    with pytest.raises(PaperSafetyError, match="explicit limit entry"):
        prepare_paper_intent(payload(sessionMode="RegularExtended"), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    extended = prepare_paper_intent(payload(intentId="extended", idempotencyKey="extended:v1", method="Limit", sessionMode="RegularExtended", duration="GTC", protectionOrderType="STP LMT", protectionLimitPrice=97.5), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    assert extended["sessionPolicy"]["outsideRth"] is True
    assert extended["sessionPolicy"]["protectionOutsideRth"] is True
    raw = json.loads(store.path.read_text(encoding="utf-8"))["records"][-1]
    assert raw["package"]["entry"]["orderType"] == "LMT"
    assert raw["package"]["protection"] == {**raw["package"]["protection"], "orderType": "STP LMT", "auxPrice": 98.0, "lmtPrice": 97.5}


@pytest.mark.parametrize("mode,match", [("Overnight", "broker-held initial stop"), ("OvernightDay", "OVT/OND")])
def test_overnight_plans_fail_closed_before_intent_persistence(tmp_path, mode, match):
    store = PaperIntentStore(tmp_path / "private.json")
    with pytest.raises(PaperSafetyError, match=match):
        prepare_paper_intent(payload(method="Limit", sessionMode=mode, protectionOrderType="STP LMT", protectionLimitPrice=97.5), account_id=ACCOUNT, account_binding="binding", instrument=instrument(), existing_symbols=set(), store=store)
    assert not store.path.exists()


def test_broker_schedule_controls_dst_early_close_and_expiry():
    base_contract = instrument()["contract"]
    before_dst = {"contract": {**base_contract, "liquidHours": "20260306:0930-20260306:1600"}}
    after_dst = {"contract": {**base_contract, "liquidHours": "20260309:0930-20260309:1600"}}
    early = {"contract": {**base_contract, "liquidHours": "20261127:0930-20261127:1300"}}
    selected = {"sessionMode": "Regular", "duration": "DAY", "method": "Normal", "protectionOrderType": "STP"}
    assert _effective_session(selected, before_dst, datetime.fromisoformat("2026-03-06T12:00:00+00:00"))["expiresAt"] == "2026-03-06T21:00:00Z"
    assert _effective_session(selected, after_dst, datetime.fromisoformat("2026-03-09T12:00:00+00:00"))["expiresAt"] == "2026-03-09T20:00:00Z"
    early_result = _effective_session(selected, early, datetime.fromisoformat("2026-11-27T12:00:00+00:00"))
    assert early_result["expiryLabel"] == "2026-11-27 13:00 America/New_York"


def test_overnight_trade_date_is_separate_from_execution_timestamp():
    assert broker_trade_date("2026-09-14T01:15:00Z", "Overnight") == "2026-09-14"
    assert broker_trade_date("2026-09-11T19:15:00Z", "Regular") == "2026-09-11"
