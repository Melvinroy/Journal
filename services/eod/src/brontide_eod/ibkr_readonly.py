"""In-memory, read-only IBKR snapshot service for the local Brontide UI."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from hashlib import sha256
from threading import Lock
from typing import Any

from brontide_eod.ibkr_tws import (
    PaperSafetyError,
    ReadOnlySmokeSnapshot,
    TwsPaperClient,
    client_from_environment,
    mask_account_id,
)
from brontide_eod.ibkr_execution import PaperIntentStore, prepare_paper_intent


def _opaque_id(prefix: str, *parts: object) -> str:
    payload = "\x1f".join(str(part) for part in parts)
    return f"{prefix}-{sha256(payload.encode('utf-8')).hexdigest()[:20]}"


def _number(value: str) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and abs(result) != float("inf") else None


class IbkrReadOnlyService:
    """Own one API client and retain the last complete snapshot on failures."""

    def __init__(
        self, client_factory: Callable[[], TwsPaperClient] = client_from_environment,
        intent_store: PaperIntentStore | None = None,
    ) -> None:
        self._client_factory = client_factory
        self._client: TwsPaperClient | None = None
        self._lock = Lock()
        self._last_success: dict[str, Any] | None = None
        self._intent_store = intent_store or PaperIntentStore()

    @staticmethod
    def _empty_status() -> dict[str, Any]:
        return {
            "mode": "read-only",
            "source": "IBKR TWS",
            "connectionStatus": "disconnected",
            "dataStatus": "unavailable",
            "lastSuccessfulUpdate": None,
            "account": None,
            "positions": [],
            "openOrders": [],
            "error": None,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            if self._last_success is None:
                return self._empty_status()
            result = deepcopy(self._last_success)
            connected = bool(
                self._client
                and self._client.authorized_account
                and self._client.isConnected()
            )
            result["connectionStatus"] = "connected" if connected else "disconnected"
            if not connected:
                result["dataStatus"] = "stale"
                result["positions"] = [
                    {**item, "stale": True} for item in result["positions"]
                ]
            return result

    def _position_view(
        self, account_key: str, observed_at: str, row: dict[str, Any]
    ) -> dict[str, Any] | None:
        signed_quantity = float(row.get("quantity") or 0)
        if signed_quantity == 0:
            return None
        con_id = int(row.get("conId") or 0)
        symbol = str(row.get("symbol") or row.get("localSymbol") or "").strip().upper()
        sec_type = str(row.get("secType") or "").strip().upper()
        average_cost = float(row.get("averageCost") or 0)
        quantity = abs(signed_quantity)
        whole_shares = quantity.is_integer()
        complete = bool(
            con_id > 0
            and symbol
            and sec_type == "STK"
            and whole_shares
            and average_cost > 0
        )
        instrument_id = f"IBKR-STK:{con_id}" if con_id > 0 else ""
        broker_position_id = _opaque_id("ibkr-position", account_key, con_id, symbol)
        revision = _opaque_id(
            "ibkr-revision", broker_position_id, quantity, average_cost
        )
        return {
            "id": broker_position_id,
            "accountId": account_key,
            "instrumentId": instrument_id,
            "positionRevision": revision,
            "symbol": symbol or "Unavailable",
            "direction": "Long" if signed_quantity > 0 else "Short",
            "quantity": int(quantity) if whole_shares else quantity,
            "averageEntry": average_cost if average_cost > 0 else None,
            "currency": str(row.get("currency") or "").strip() or None,
            "exchange": str(row.get("exchange") or "").strip() or None,
            "marketValue": None,
            "changedAt": observed_at,
            "snapshotState": "current",
            "associationEligible": complete,
            "missingInformation": []
            if complete
            else [
                "Exact stock contract, whole-share quantity, or average cost is unavailable."
            ],
            "stale": False,
        }

    def _build_success(
        self, account_id: str, snapshot: ReadOnlySmokeSnapshot
    ) -> dict[str, Any]:
        account_key = _opaque_id("ibkr-account", account_id)
        values = {item["tag"]: item for item in snapshot.account_summary}
        equity_item = values.get("NetLiquidation")
        equity = _number(equity_item["value"]) if equity_item else None
        account = {
            "id": account_key,
            "maskedId": mask_account_id(account_id),
            "value": equity,
            "currency": equity_item.get("currency") if equity_item else None,
            "source": "IBKR accountSummary",
            "observedAt": snapshot.observed_at,
            "available": equity is not None,
        }
        current = [
            item
            for row in snapshot.position_rows
            if (item := self._position_view(account_key, snapshot.observed_at, row))
        ]
        current_by_id = {item["id"]: item for item in current}

        previous = (self._last_success or {}).get("positions", [])
        missing = []
        for item in previous:
            if item["id"] in current_by_id:
                continue
            missing.append(
                {
                    **item,
                    "snapshotState": "reconciliation-required",
                    "stale": True,
                    "associationEligible": False,
                    "missingInformation": [
                        "Absent from the latest completed snapshot; reconcile before treating it as closed."
                    ],
                }
            )

        open_orders = [
            {
                "id": _opaque_id("ibkr-order", account_key, row.get("orderId")),
                "instrumentId": f"IBKR-STK:{int(row.get('conId') or 0)}"
                if int(row.get("conId") or 0) > 0
                else "",
                "symbol": str(row.get("symbol") or "").strip().upper() or "Unavailable",
                "action": str(row.get("action") or "").strip().upper() or "Unavailable",
                "quantity": float(row.get("quantity") or 0),
                "orderType": str(row.get("orderType") or "").strip() or "Unavailable",
                "timeInForce": str(row.get("timeInForce") or "").strip() or "Unavailable",
                "status": str(row.get("status") or "").strip() or "Unavailable",
            }
            for row in snapshot.open_order_rows
        ]
        return {
            "mode": "read-only",
            "source": "IBKR TWS",
            "connectionStatus": "connected",
            "dataStatus": "fresh",
            "lastSuccessfulUpdate": snapshot.observed_at,
            "account": account,
            "positions": [*current, *missing],
            "openOrders": open_orders,
            "error": None,
        }

    def refresh(self) -> dict[str, Any]:
        if not self._lock.acquire(blocking=False):
            result = deepcopy(self._last_success or self._empty_status())
            return {**result, "connectionStatus": "refreshing"}
        try:
            try:
                if not (
                    self._client
                    and self._client.authorized_account
                    and self._client.isConnected()
                ):
                    if self._client is not None:
                        self._client.disconnect()
                    self._client = self._client_factory()
                    account_id = self._client.connect_verified()
                else:
                    account_id = self._client.authorized_account
                if account_id is None:
                    raise PaperSafetyError("Verified account authorization is unavailable.")
                snapshot = self._client.read_only_snapshot()
                self._last_success = self._build_success(account_id, snapshot)
                return deepcopy(self._last_success)
            except (PaperSafetyError, RuntimeError, OSError, ValueError) as exc:
                if self._client is not None and not self._client.isConnected():
                    self._client.disconnect()
                    self._client = None
                result = deepcopy(self._last_success or self._empty_status())
                result["connectionStatus"] = (
                    "stale" if self._last_success is not None else "disconnected"
                )
                result["dataStatus"] = (
                    "stale" if self._last_success is not None else "unavailable"
                )
                result["positions"] = [
                    {**item, "stale": True} for item in result["positions"]
                ]
                result["error"] = (
                    str(exc)
                    if isinstance(exc, PaperSafetyError)
                    else "Read-only broker refresh failed."
                )
                return result
        finally:
            self._lock.release()

    def disconnect(self) -> dict[str, Any]:
        with self._lock:
            if self._client is not None:
                self._client.disconnect()
                self._client = None
            result = deepcopy(self._last_success or self._empty_status())
            result["connectionStatus"] = "disconnected"
            result["dataStatus"] = (
                "stale" if self._last_success is not None else "unavailable"
            )
            result["positions"] = [
                {**item, "stale": True} for item in result["positions"]
            ]
            result["error"] = None
            return result

    def instrument(self, symbol: str, route: str = "SMART") -> dict[str, Any]:
        """Read qualified contract/tick metadata and a snapshot quote on the owned client."""

        if not self._lock.acquire(blocking=False):
            raise PaperSafetyError("Another broker refresh is in progress.")
        try:
            if not (
                self._client
                and self._client.authorized_account
                and self._client.isConnected()
            ):
                raise PaperSafetyError(
                    "Refresh the verified read-only paper connection before validating an intent."
                )
            snapshot = self._client.read_only_instrument_snapshot(symbol, route=route)
            return self._instrument_view(snapshot)
        finally:
            self._lock.release()

    @staticmethod
    def _instrument_view(snapshot: Any) -> dict[str, Any]:
        return {
                "source": "IBKR TWS snapshot",
                "observedAt": snapshot.observed_at,
                "contract": {
                    "conId": snapshot.con_id,
                    "symbol": snapshot.symbol,
                    "secType": "STK",
                    "exchange": snapshot.exchange,
                    "primaryExchange": snapshot.exchange,
                    "route": snapshot.route,
                    "currency": snapshot.currency,
                    "minimumTick": snapshot.minimum_tick,
                    "orderTypes": list(snapshot.order_types),
                    "validExchanges": list(snapshot.valid_exchanges),
                    "tradingHours": snapshot.trading_hours,
                    "liquidHours": snapshot.liquid_hours,
                    "timeZoneId": snapshot.time_zone_id,
                    "serverVersion": snapshot.server_version,
                },
                "quote": {
                    "bid": snapshot.bid,
                    "ask": snapshot.ask,
                    "complete": snapshot.quote_complete,
                    "marketDataType": snapshot.market_data_type,
                },
                "executable": snapshot.quote_complete
                and snapshot.market_data_type == 1,
                "error": None
                if snapshot.quote_complete and snapshot.market_data_type == 1
                else (
                    "The broker quote is delayed or frozen; execution validation requires live market data."
                    if snapshot.quote_complete
                    else "A complete bid/ask snapshot is unavailable; intent validation remains blocked."
                ),
            }

    def prepare_intent(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Validate and durably record an intent without submitting an order."""

        if not self._lock.acquire(blocking=False):
            raise PaperSafetyError("Another broker operation is in progress.")
        try:
            if not (
                self._client
                and self._client.authorized_account
                and self._client.isConnected()
            ):
                raise PaperSafetyError("Refresh the verified paper connection before validating an intent.")
            account_id = self._client.authorized_account
            session_mode = str(payload.get("sessionMode") or "Regular")
            route = "OVERNIGHT" if session_mode == "Overnight" else "SMART"
            snapshot = self._client.read_only_instrument_snapshot(str(payload.get("symbol") or ""), route=route)
            instrument = self._instrument_view(snapshot)
            current_symbols = {
                str(item.get("symbol") or "").upper()
                for item in (self._last_success or {}).get("positions", [])
                if item.get("snapshotState") == "current"
            }
            return prepare_paper_intent(
                payload,
                account_id=account_id,
                account_binding=self._client.config.binding(),
                instrument=instrument,
                existing_symbols=current_symbols,
                store=self._intent_store,
            )
        finally:
            self._lock.release()
