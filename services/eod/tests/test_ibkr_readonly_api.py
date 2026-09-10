from fastapi.testclient import TestClient

from brontide_eod.api import app, ibkr_read_only_service


class FakeService:
    def status(self):
        return {"connectionStatus": "disconnected", "positions": []}

    def refresh(self):
        return {"connectionStatus": "connected", "positions": [{"symbol": "AAPL"}]}

    def disconnect(self):
        return {"connectionStatus": "disconnected", "positions": [{"symbol": "AAPL"}]}

    def instrument(self, symbol, route="SMART"):
        return {"contract": {"symbol": symbol.upper(), "route": route}, "quote": {"bid": 1, "ask": 2}, "executable": True}

    def prepare_intent(self, payload):
        return {"intentId": payload["intentId"], "status": "Validated intent", "submissionsEnabled": False}


def test_read_only_broker_routes_require_local_header_for_connection_changes():
    app.dependency_overrides[ibkr_read_only_service] = FakeService
    try:
        with TestClient(app) as client:
            assert client.get("/v1/ibkr/read-only").status_code == 200
            assert client.post("/v1/ibkr/read-only/refresh").status_code == 403
            refreshed = client.post(
                "/v1/ibkr/read-only/refresh", headers={"X-Brontide-Local": "1"}
            )
            assert refreshed.json()["positions"] == [{"symbol": "AAPL"}]
            disconnected = client.post(
                "/v1/ibkr/read-only/disconnect", headers={"X-Brontide-Local": "1"}
            )
            assert disconnected.json()["connectionStatus"] == "disconnected"
            assert client.post("/v1/ibkr/read-only/instrument", json={"symbol": "AAPL"}).status_code == 403
            instrument = client.post(
                "/v1/ibkr/read-only/instrument",
                json={"symbol": "AAPL"},
                headers={"X-Brontide-Local": "1"},
            )
            assert instrument.json()["contract"]["symbol"] == "AAPL"
            assert client.post("/v1/ibkr/paper/intents", json={}).status_code == 403
            prepared = client.post(
                "/v1/ibkr/paper/intents",
                headers={"X-Brontide-Local": "1"},
                json={
                    "intentId": "i", "idempotencyKey": "k", "planId": "p", "campaignId": "c",
                    "symbol": "AAPL", "direction": "Long", "method": "Normal", "quantity": 1,
                    "planningPrice": 100, "hardCap": 100, "stopPrice": 98,
                    "maximumPriceDriftPercent": .5, "exitPlan": {},
                },
            )
            assert prepared.json()["status"] == "Validated intent"
            assert prepared.json()["submissionsEnabled"] is False
    finally:
        app.dependency_overrides.clear()
