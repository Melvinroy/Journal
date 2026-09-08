"""Private, paper-only TWS API transport for Brontide Gate 2.

The official ``ibapi`` package is intentionally an optional, operator-installed
dependency because IBKR distributes it with the TWS API download rather than
through this repository. Importing this module remains safe without that SDK so
the deterministic safety tests can run without a gateway.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
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
        if self.client_id < 0:
            raise PaperSafetyError("Client ID is invalid.")
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
    if not all(result[key] for key in ("symbol", "exchange", "currency")):
        raise PaperSafetyError("Stock symbol, exchange and currency are required.")
    return result


def validate_order_fields(account_id: str, ticket: Mapping[str, Any]) -> dict[str, Any]:
    if ticket.get("account") != account_id:
        raise PaperSafetyError("Every order must explicitly use the verified account ID.")
    if ticket.get("outsideRth") is not False:
        raise PaperSafetyError("Gate 2 tickets must use regular trading hours.")
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
            self.connect(self.config.host, self.config.port, self.config.client_id)
            self._reader_thread = threading.Thread(target=self.run, daemon=True)
            self._reader_thread.start()
            self.reqManagedAccts()
            if not self._accounts_ready.wait(timeout_seconds) or not self._order_id_ready.wait(timeout_seconds):
                self.disconnect()
                raise PaperSafetyError("TWS connection did not provide account/order readiness in time.")
            self.authorized_account = verify_connected_account(self.config, self.verification, self._managed_accounts)
            return self.authorized_account

        def connectionClosed(self) -> None:  # noqa: N802 - IBKR callback
            self.authorized_account = None

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
