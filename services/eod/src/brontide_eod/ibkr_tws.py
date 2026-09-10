"""Private, paper-only TWS API transport for Brontide Gate 2.

The official ``ibapi`` package is intentionally an optional, operator-installed
dependency because IBKR distributes it with the TWS API download rather than
through this repository. Importing this module remains safe without that SDK so
the deterministic safety tests can run without a gateway.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import threading
from typing import Any, Mapping

try:  # Installed from IBKR's official TWS API bundle by the operator.
    from ibapi.client import EClient
    from ibapi.contract import Contract
    from ibapi.order import Order
    from ibapi.wrapper import EWrapper
except ImportError:  # pragma: no cover - exercised through sdk_available()
    EClient = Contract = Order = EWrapper = None  # type: ignore[assignment,misc]


class PaperSafetyError(RuntimeError):
    """A fail-closed safety-boundary violation."""


@dataclass(frozen=True)
class PaperGatewayConfig:
    host: str
    port: int
    client_id: int
    account_id: str
    submissions_enabled: bool = False

    @classmethod
    def from_environment(cls) -> "PaperGatewayConfig":
        """Load private process configuration; order submission defaults off."""

        enabled = os.environ.get("BRONTIDE_IBKR_SUBMISSIONS_ENABLED", "false").lower() == "true"
        return cls(
            host=os.environ.get("BRONTIDE_IBKR_HOST", "127.0.0.1"),
            port=int(os.environ.get("BRONTIDE_IBKR_PORT", "0")),
            client_id=int(os.environ.get("BRONTIDE_IBKR_CLIENT_ID", "0")),
            account_id=os.environ.get("BRONTIDE_IBKR_ACCOUNT_ID", ""),
            submissions_enabled=enabled,
        )

    def validate(self) -> None:
        if not self.host.strip():
            raise PaperSafetyError("Gateway host is required.")
        if not 1 <= self.port <= 65535:
            raise PaperSafetyError("Gateway port is invalid.")
        if self.client_id <= 0:
            raise PaperSafetyError("A nonzero dedicated client ID is required.")
        if not self.account_id.strip():
            raise PaperSafetyError("Exact allowlisted account ID is required.")

    def binding(self) -> str:
        self.validate()
        payload = json.dumps(
            {
                "adapter": 1,
                "accountId": self.account_id,
                "clientId": self.client_id,
                "host": self.host,
                "port": self.port,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class OperatorVerification:
    account_id: str
    observed_in: str
    verified_at: str
    configuration_binding: str

    @classmethod
    def load(cls, path: Path) -> "OperatorVerification":
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return cls(
                account_id=raw["accountId"],
                observed_in=raw["observedIn"],
                verified_at=raw["verifiedAt"],
                configuration_binding=raw["configurationBinding"],
            )
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise PaperSafetyError("Operator verification file is missing or invalid.") from exc

    def validate_for(self, config: PaperGatewayConfig) -> None:
        if self.observed_in not in {"TWS", "IB Gateway"}:
            raise PaperSafetyError("Verification must identify TWS or IB Gateway.")
        try:
            datetime.fromisoformat(self.verified_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise PaperSafetyError("Verification timestamp is invalid.") from exc
        if self.account_id != config.account_id:
            raise PaperSafetyError("Verified account does not match the allowlist.")
        if self.configuration_binding != config.binding():
            raise PaperSafetyError("Gateway/client/account configuration changed after verification.")


def create_operator_verification(
    config: PaperGatewayConfig, observed_account_id: str, observed_in: str, verified_at: str
) -> OperatorVerification:
    """Create data that the operator may save outside the repository."""

    if observed_account_id != config.account_id:
        raise PaperSafetyError("The account visible in IBKR does not match the allowlist.")
    verification = OperatorVerification(
        account_id=observed_account_id,
        observed_in=observed_in,
        verified_at=verified_at,
        configuration_binding=config.binding(),
    )
    verification.validate_for(config)
    return verification


def verify_connected_account(
    config: PaperGatewayConfig, verification: OperatorVerification | None, managed_accounts: list[str]
) -> str:
    """Validate a read-only connection exposes exactly one verified account."""

    config.validate()
    if verification is None:
        raise PaperSafetyError("Operator verification is required.")
    verification.validate_for(config)
    accounts = sorted(set(account.strip() for account in managed_accounts if account.strip()))
    if not accounts:
        raise PaperSafetyError("The gateway returned no managed account.")
    if config.account_id not in accounts:
        raise PaperSafetyError("Connected account does not match the verified allowlist.")
    if accounts != [config.account_id]:
        raise PaperSafetyError("The gateway exposed an unexpected account.")
    return config.account_id


def authorize_connection(
    config: PaperGatewayConfig, verification: OperatorVerification | None, managed_accounts: list[str]
) -> str:
    if not config.submissions_enabled:
        raise PaperSafetyError("Paper submissions are disabled by default.")
    return verify_connected_account(config, verification, managed_accounts)


def build_stock_contract_fields(ticket: Mapping[str, Any]) -> dict[str, Any]:
    if ticket.get("secType") != "STK":
        raise PaperSafetyError("Gate 2 supports stocks only.")
    con_id = ticket.get("conId")
    if not isinstance(con_id, int) or con_id <= 0:
        raise PaperSafetyError("A qualified IBKR contract ID is required.")
    result = {
        "conId": con_id,
        "symbol": str(ticket.get("symbol", "")).strip(),
        "secType": "STK",
        "exchange": str(ticket.get("exchange", "")).strip(),
        "currency": str(ticket.get("currency", "")).strip(),
    }
    primary_exchange = str(ticket.get("primaryExchange", "")).strip()
    if primary_exchange:
        result["primaryExchange"] = primary_exchange
    if not all(result[key] for key in ("symbol", "exchange", "currency")):
        raise PaperSafetyError("Stock symbol, exchange and currency are required.")
    return result


def validate_order_fields(account_id: str, ticket: Mapping[str, Any]) -> dict[str, Any]:
    if ticket.get("account") != account_id:
        raise PaperSafetyError("Every order must explicitly use the verified account ID.")
    if not isinstance(ticket.get("outsideRth"), bool):
        raise PaperSafetyError("Every order must state its outside-RTH eligibility explicitly.")
    quantity = ticket.get("totalQuantity")
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity <= 0:
        raise PaperSafetyError("Order quantity must be positive whole shares.")
    if ticket.get("orderType") == "MKT":
        raise PaperSafetyError("Gate 2 provides no market-order fallback.")
    return dict(ticket)


def sdk_available() -> bool:
    return EClient is not None


def mask_account_id(account_id: str) -> str:
    if len(account_id) <= 4:
        return "••••"
    return f"{account_id[:2]}{'•' * max(2, len(account_id) - 4)}{account_id[-2:]}"


def client_from_environment() -> "TwsPaperClient":
    """Build a fail-closed client from private process configuration."""

    config = PaperGatewayConfig.from_environment()
    verification_path = os.environ.get("BRONTIDE_IBKR_VERIFICATION_FILE", "")
    if not verification_path:
        raise PaperSafetyError("BRONTIDE_IBKR_VERIFICATION_FILE is required.")
    verification = OperatorVerification.load(Path(verification_path).expanduser().resolve())
    verification.validate_for(config)
    return TwsPaperClient(config, verification)


@dataclass(frozen=True)
class ReadOnlySmokeSnapshot:
    """Completion-bounded broker reads; the raw account ID is never included."""

    observed_at: str
    account_summary: tuple[dict[str, str], ...]
    position_rows: tuple[dict[str, Any], ...]
    open_order_rows: tuple[dict[str, Any], ...]

    @property
    def account_summary_items(self) -> int:
        return len(self.account_summary)

    @property
    def positions(self) -> int:
        return len(self.position_rows)

    @property
    def open_orders(self) -> int:
        return len(self.open_order_rows)


@dataclass(frozen=True)
class ReadOnlyInstrumentSnapshot:
    """Qualified stock identity and executable-side quote from the active TWS session."""

    observed_at: str
    con_id: int
    symbol: str
    exchange: str
    route: str
    currency: str
    minimum_tick: float
    bid: float | None
    ask: float | None
    quote_complete: bool
    market_data_type: int | None
    order_types: tuple[str, ...]
    valid_exchanges: tuple[str, ...]
    trading_hours: str
    liquid_hours: str
    time_zone_id: str
    server_version: int


if sdk_available():

    class TwsPaperClient(EWrapper, EClient):  # type: ignore[misc,valid-type]
        """Minimal official-SDK transport. No live submission mode exists."""

        def __init__(self, config: PaperGatewayConfig, verification: OperatorVerification):
            EWrapper.__init__(self)
            EClient.__init__(self, self)
            self.config = config
            self.verification = verification
            self.authorized_account: str | None = None
            self._managed_accounts: list[str] = []
            self._accounts_ready = threading.Event()
            self._next_order_id: int | None = None
            self._order_id_ready = threading.Event()
            self._reader_thread: threading.Thread | None = None
            self._account_summary_ready = threading.Event()
            self._positions_ready = threading.Event()
            self._open_orders_ready = threading.Event()
            self._account_summary_items: list[dict[str, str]] = []
            self._positions: list[dict[str, Any]] = []
            self._open_orders: list[dict[str, Any]] = []
            self._read_error: PaperSafetyError | None = None
            self._api_error_codes: list[int] = []
            self._contract_details_ready = threading.Event()
            self._market_data_ready = threading.Event()
            self._contract_details: list[Any] = []
            self._market_prices: dict[str, float] = {}
            self._market_data_type: int | None = None

        def error(  # noqa: N802 - IBKR callback
            self,
            _req_id: int,
            error_code: int,
            _error_string: str,
            _advanced_order_reject_json: str = "",
        ) -> None:
            self._api_error_codes.append(error_code)

        def _record_unexpected_account(self, account: str, request: str) -> bool:
            if account == self.authorized_account:
                return False
            self._read_error = PaperSafetyError(
                f"{request} returned data for an unexpected account."
            )
            return True

        def managedAccounts(self, accounts_list: str) -> None:  # noqa: N802 - IBKR callback
            self._managed_accounts = [value for value in accounts_list.split(",") if value]
            self._accounts_ready.set()

        def nextValidId(self, order_id: int) -> None:  # noqa: N802 - IBKR callback
            self._next_order_id = order_id
            self._order_id_ready.set()

        def connect_verified(self, timeout_seconds: float = 10) -> str:
            self.authorized_account = None
            self._accounts_ready.clear()
            self._order_id_ready.clear()
            self._api_error_codes.clear()
            self.connect(self.config.host, self.config.port, self.config.client_id)
            self._reader_thread = threading.Thread(target=self.run, daemon=True)
            self._reader_thread.start()
            if not self._order_id_ready.wait(timeout_seconds):
                codes = sorted(set(self._api_error_codes))
                detail = f" API error code(s): {codes}." if codes else ""
                self.disconnect()
                raise PaperSafetyError(
                    f"TWS connection did not provide nextValidId readiness in time.{detail}"
                )
            self.reqManagedAccts()
            if not self._accounts_ready.wait(timeout_seconds):
                codes = sorted(set(self._api_error_codes))
                detail = f" API error code(s): {codes}." if codes else ""
                self.disconnect()
                raise PaperSafetyError(
                    f"TWS connection did not provide managed-account readiness in time.{detail}"
                )
            self.authorized_account = verify_connected_account(self.config, self.verification, self._managed_accounts)
            return self.authorized_account

        def connectionClosed(self) -> None:  # noqa: N802 - IBKR callback
            self.authorized_account = None

        def accountSummary(  # noqa: N802 - IBKR callback
            self, req_id: int, account: str, tag: str, value: str, currency: str
        ) -> None:
            if req_id != 9101:
                return
            if self._record_unexpected_account(account, "Account summary"):
                self._account_summary_ready.set()
                return
            self._account_summary_items.append(
                {"tag": tag, "value": value, "currency": currency}
            )

        def accountSummaryEnd(self, req_id: int) -> None:  # noqa: N802 - IBKR callback
            if req_id == 9101:
                self._account_summary_ready.set()

        def position(self, account: str, contract: Any, position: float, avg_cost: float) -> None:
            if self._record_unexpected_account(account, "Positions"):
                self._positions_ready.set()
                return
            self._positions.append(
                {
                    "conId": int(getattr(contract, "conId", 0) or 0),
                    "symbol": str(getattr(contract, "symbol", "") or ""),
                    "localSymbol": str(getattr(contract, "localSymbol", "") or ""),
                    "secType": str(getattr(contract, "secType", "") or ""),
                    "currency": str(getattr(contract, "currency", "") or ""),
                    "exchange": str(
                        getattr(contract, "primaryExchange", "")
                        or getattr(contract, "exchange", "")
                        or ""
                    ),
                    "quantity": float(position),
                    "averageCost": float(avg_cost),
                }
            )

        def positionEnd(self) -> None:  # noqa: N802 - IBKR callback
            self._positions_ready.set()

        def openOrder(  # noqa: N802 - IBKR callback
            self, order_id: int, contract: Any, order: Any, order_state: Any
        ) -> None:
            if self._record_unexpected_account(str(getattr(order, "account", "")), "Open orders"):
                self._open_orders_ready.set()
                return
            self._open_orders.append(
                {
                    "orderId": order_id,
                    "conId": int(getattr(contract, "conId", 0) or 0),
                    "symbol": str(getattr(contract, "symbol", "") or ""),
                    "action": str(getattr(order, "action", "") or ""),
                    "quantity": float(getattr(order, "totalQuantity", 0) or 0),
                    "orderType": str(getattr(order, "orderType", "") or ""),
                    "timeInForce": str(getattr(order, "tif", "") or ""),
                    "status": str(getattr(order_state, "status", "") or ""),
                }
            )

        def openOrderEnd(self) -> None:  # noqa: N802 - IBKR callback
            self._open_orders_ready.set()

        def contractDetails(self, req_id: int, details: Any) -> None:  # noqa: N802
            if req_id == 9201:
                self._contract_details.append(details)

        def contractDetailsEnd(self, req_id: int) -> None:  # noqa: N802
            if req_id == 9201:
                self._contract_details_ready.set()

        def tickPrice(self, req_id: int, tick_type: int, value: float, _attrib: Any) -> None:  # noqa: N802
            if req_id != 9202 or value <= 0:
                return
            if tick_type in {1, 66}:
                self._market_prices["bid"] = float(value)
            elif tick_type in {2, 67}:
                self._market_prices["ask"] = float(value)

        def tickSnapshotEnd(self, req_id: int) -> None:  # noqa: N802
            if req_id == 9202:
                self._market_data_ready.set()

        def marketDataType(self, req_id: int, market_data_type: int) -> None:  # noqa: N802
            if req_id == 9202:
                self._market_data_type = int(market_data_type)

        def _require_read_completion(
            self, event: threading.Event, label: str, timeout_seconds: float
        ) -> None:
            if not event.wait(timeout_seconds):
                raise PaperSafetyError(f"{label} did not complete before the read-only timeout.")
            if self._read_error is not None:
                raise self._read_error

        def read_only_snapshot(self, timeout_seconds: float = 10) -> ReadOnlySmokeSnapshot:
            """Read account, position and order snapshots without binding or changing orders."""

            if self.authorized_account is None or not self.isConnected():
                raise PaperSafetyError("A currently verified connection is required.")
            if timeout_seconds <= 0:
                raise ValueError("Read-only timeout must be positive.")

            self._read_error = None
            self._account_summary_items.clear()
            self._account_summary_ready.clear()
            self.reqAccountSummary(
                9101,
                "All",
                "NetLiquidation,TotalCashValue,BuyingPower,AvailableFunds,GrossPositionValue",
            )
            try:
                self._require_read_completion(
                    self._account_summary_ready, "Account summary", timeout_seconds
                )
            finally:
                self.cancelAccountSummary(9101)

            self._read_error = None
            self._positions.clear()
            self._positions_ready.clear()
            self.reqPositions()
            try:
                self._require_read_completion(self._positions_ready, "Positions", timeout_seconds)
            finally:
                self.cancelPositions()

            self._read_error = None
            self._open_orders.clear()
            self._open_orders_ready.clear()
            # reqAllOpenOrders is a read-only snapshot and, unlike client-zero binding
            # flows, does not bind orders to this API client.
            self.reqAllOpenOrders()
            self._require_read_completion(self._open_orders_ready, "Open orders", timeout_seconds)

            return ReadOnlySmokeSnapshot(
                observed_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                account_summary=tuple(dict(item) for item in self._account_summary_items),
                position_rows=tuple(dict(item) for item in self._positions),
                open_order_rows=tuple(dict(item) for item in self._open_orders),
            )

        def read_only_instrument_snapshot(
            self, symbol: str, timeout_seconds: float = 15, route: str = "SMART"
        ) -> ReadOnlyInstrumentSnapshot:
            """Qualify one US stock and request a bounded snapshot quote; never places orders."""

            if self.authorized_account is None or not self.isConnected():
                raise PaperSafetyError("A currently verified connection is required.")
            value = symbol.strip().upper()
            if not value or len(value) > 32 or not all(character.isalnum() or character in {".", "-"} for character in value):
                raise PaperSafetyError("A valid stock symbol is required.")
            if timeout_seconds <= 0:
                raise ValueError("Read-only timeout must be positive.")
            request = Contract()
            request.symbol = value
            request.secType = "STK"
            requested_route = route.strip().upper()
            if requested_route not in {"SMART", "OVERNIGHT"}:
                raise PaperSafetyError("The requested stock route is unsupported.")
            request.exchange = requested_route
            request.currency = "USD"
            self._contract_details.clear()
            self._contract_details_ready.clear()
            self.reqContractDetails(9201, request)
            self._require_read_completion(
                self._contract_details_ready, "Contract qualification", timeout_seconds
            )
            matches = [
                item
                for item in self._contract_details
                if str(getattr(item.contract, "symbol", "")).upper() == value
                and str(getattr(item.contract, "secType", "")).upper() == "STK"
            ]
            if len(matches) != 1:
                raise PaperSafetyError(
                    "The stock contract could not be resolved to exactly one broker identity."
                )
            details = matches[0]
            contract = details.contract
            minimum_tick = float(getattr(details, "minTick", 0) or 0)
            if int(getattr(contract, "conId", 0) or 0) <= 0 or minimum_tick <= 0:
                raise PaperSafetyError("Broker contract identity or minimum tick is unavailable.")
            self._market_prices.clear()
            self._market_data_type = None
            self._market_data_ready.clear()
            # Permit delayed display when live entitlement is absent, but the
            # returned data type remains explicit and cannot authorize execution.
            self.reqMarketDataType(3)
            self.reqMktData(9202, contract, "", True, False, [])
            self._require_read_completion(
                self._market_data_ready, "Market-data snapshot", timeout_seconds
            )
            observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            bid = self._market_prices.get("bid")
            ask = self._market_prices.get("ask")
            return ReadOnlyInstrumentSnapshot(
                observed_at=observed_at,
                con_id=int(contract.conId),
                symbol=str(contract.symbol).upper(),
                exchange=str(
                    getattr(contract, "primaryExchange", "")
                    or getattr(contract, "exchange", "")
                    or "SMART"
                ),
                route=requested_route,
                currency=str(getattr(contract, "currency", "") or ""),
                minimum_tick=minimum_tick,
                bid=bid,
                ask=ask,
                quote_complete=bool(bid and ask and bid <= ask),
                market_data_type=self._market_data_type,
                order_types=tuple(
                    value.strip().upper()
                    for value in str(getattr(details, "orderTypes", "") or "").split(",")
                    if value.strip()
                ),
                valid_exchanges=tuple(
                    value.strip().upper()
                    for value in str(getattr(details, "validExchanges", "") or "").split(",")
                    if value.strip()
                ),
                trading_hours=str(getattr(details, "tradingHours", "") or ""),
                liquid_hours=str(getattr(details, "liquidHours", "") or ""),
                time_zone_id=str(getattr(details, "timeZoneId", "") or ""),
                server_version=int(self.serverVersion() or 0),
            )

        @staticmethod
        def _contract(fields: Mapping[str, Any]) -> Any:
            value = Contract()
            for key, item in build_stock_contract_fields(fields).items():
                setattr(value, key, item)
            return value

        @staticmethod
        def _order(fields: Mapping[str, Any]) -> Any:
            value = Order()
            mapping = {
                "account": "account",
                "action": "action",
                "totalQuantity": "totalQuantity",
                "orderType": "orderType",
                "tif": "tif",
                "lmtPrice": "lmtPrice",
                "auxPrice": "auxPrice",
                "lmtPriceOffset": "lmtPriceOffset",
                "outsideRth": "outsideRth",
                "transmit": "transmit",
                "orderRef": "orderRef",
            }
            for source, target in mapping.items():
                if source in fields:
                    setattr(value, target, fields[source])
            return value

        def submit_bracket(self, package: Mapping[str, Any]) -> tuple[int, int]:
            """Stage a parent and transmit its protective child as one bracket."""

            account = self.authorized_account
            if account is None or not self.isConnected():
                raise PaperSafetyError("A currently verified connection is required.")
            # Revalidate the immutable boundary immediately before every order operation.
            authorize_connection(self.config, self.verification, self._managed_accounts)
            if package.get("submissionPolicy") != "paper-enabled":
                raise PaperSafetyError("Unvalidated auction submission is disabled.")
            contract = self._contract(package["contract"])
            entry_fields = validate_order_fields(account, package["entry"])
            protection_fields = validate_order_fields(account, package["protection"])
            if entry_fields.get("transmit") is not False or protection_fields.get("transmit") is not True:
                raise PaperSafetyError("Bracket transmit flags are unsafe.")
            if self._next_order_id is None:
                raise PaperSafetyError("No broker order ID is available.")
            parent_id = self._next_order_id
            protection_id = parent_id + 1
            entry = self._order(entry_fields)
            protection = self._order(protection_fields)
            protection.parentId = parent_id
            self.placeOrder(parent_id, contract, entry)
            self.placeOrder(protection_id, contract, protection)
            self._next_order_id = protection_id + 1
            return parent_id, protection_id

else:

    class TwsPaperClient:  # pragma: no cover - clear runtime error without SDK
        def __init__(self, *_args: Any, **_kwargs: Any):
            raise RuntimeError("Install the official IBKR TWS API Python SDK before connected testing.")
