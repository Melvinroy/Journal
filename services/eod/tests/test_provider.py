from datetime import date

import httpx

from brontide_eod.providers.alpaca import AlpacaProvider


def test_alpaca_provider_parses_sip_daily_bars_and_pagination() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url.params["feed"] == "sip"
        assert request.url.params["adjustment"] == "all"
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
    provider = AlpacaProvider("key", "secret", client=client)
    bars = provider.get_daily_bars(["AAPL", "MSFT"], date(2026, 9, 3), date(2026, 9, 3))

    assert calls == 2
    assert [bar.symbol for bar in bars] == ["AAPL", "MSFT"]
    assert bars[0].session_date == date(2026, 9, 3)
    assert bars[0].source == "alpaca_sip"
