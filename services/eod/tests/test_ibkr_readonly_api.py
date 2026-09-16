from fastapi.testclient import TestClient
from brontide_eod.api import app
from brontide_eod.paper_api import current_operator


def test_legacy_broker_endpoints_are_retired_after_authentication():
    app.dependency_overrides[current_operator] = lambda: {"id": "operator"}
    try:
        with TestClient(app) as client:
            assert client.get("/v1/ibkr/read-only").status_code == 410
            for path in ("read-only/refresh", "read-only/disconnect", "read-only/instrument", "paper/intents"):
                assert client.post("/v1/ibkr/" + path).status_code == 403
                assert client.post("/v1/ibkr/" + path, headers={"X-Brontide-Local": "1"}, json={}).status_code == 410
    finally:
        app.dependency_overrides.clear()
