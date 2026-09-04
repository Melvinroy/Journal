from datetime import date

import httpx

from brontide_eod.providers.alpaca import AlpacaProvider


def test_alpaca_provider_parses_sip_daily_bars_and_pagination() -> None:
    calls = 0
    throttled_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url.params["feed"] == "sip"
        assert request.url.params["adjustment"] == "all"
        assert request.url.params["asof"] == "-"
        assert request.url.params["start"] == "2026-09-03T00:00:00Z"
        assert request.url.params["end"] == "2026-09-03T23:59:59Z"
        if calls == 1:
            return httpx.Response(200, json={
                "bars": {"AAPL": [{"t": "2026-09-03T04:00:00Z", "o": 100, "h": 104, "l": 99, "c": 103, "v": 10_000, "n": 500, "vw": 102.2}]},
                "next_page_token": "next",
            })
        assert request.url.params["page_token"] == "next"
        return httpx.Response(200, json={
            "bars": {"MSFT": [{"t": "2026-09-03T04:00:00Z", "o": 200, "h": 205, "l": 198, "c": 204, "v": 20_000, "n": 700, "vw": 202.8}]},
            "next_page_token": None,
        })

    client = httpx.Client(transport=httpx.MockTransport(handler))
    def before_request() -> None:
        nonlocal throttled_requests
        throttled_requests += 1

    provider = AlpacaProvider("key", "secret", before_request=before_request, client=client)
    bars = provider.get_daily_bars(["AAPL", "MSFT"], date(2026, 9, 3), date(2026, 9, 3))

    assert calls == 2
    assert throttled_requests == 2
    assert [bar.symbol for bar in bars] == ["AAPL", "MSFT"]
    assert bars[0].session_date == date(2026, 9, 3)
    assert bars[0].source == "alpaca_sip"


def test_alpaca_provider_uses_configured_trading_base_url_for_assets() -> None:
    requested_url = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requested_url
        requested_url = str(request.url)
        return httpx.Response(200, json=[{
            "symbol": "AAPL",
            "name": "Apple Inc.",
            "exchange": "NASDAQ",
            "class": "us_equity",
            "status": "active",
            "id": "asset-id",
        }])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AlpacaProvider("key", "secret", trading_base_url="https://paper-api.alpaca.markets/", client=client)

    assert provider.list_instruments()[0].symbol == "AAPL"
    assert requested_url and requested_url.startswith("https://paper-api.alpaca.markets/v2/assets?")
