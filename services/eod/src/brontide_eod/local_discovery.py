"""Bounded, read-only TWS account discovery for future local setup.

This module has no standalone HTTP route. A discovery result is a list of
candidate account labels, not paper-environment proof, a durable binding, or
permission to place an order. The operator-installed official SDK is optional.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from .ibkr_tws import EClient, EWrapper, PaperSafetyError, sdk_available


_ACCOUNT = re.compile(r"^[A-Z][A-Z0-9]{5,31}$", re.ASCII)
# IBKR documents these as connected or idle data farms, not request failures.
_INFORMATIONAL_CODES = frozenset({2104, 2106, 2107, 2108, 2158})


@dataclass(frozen=True)
class DiscoveryEndpoint:
    host: str
    port: int
    client_id: int

    def validate(self) -> None:
        if (self.host != "127.0.0.1" or type(self.port) is not int
                or not 1 <= self.port <= 65535 or type(self.client_id) is not int
                or self.client_id <= 0):
            raise PaperSafetyError("A dedicated loopback TWS discovery endpoint is required.")

    def binding(self) -> str:
        self.validate()
        value = json.dumps({"adapter": "local-discovery-v1", "host": self.host,
                            "port": self.port, "clientId": self.client_id},
                           sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ManagedAccountDiscovery:
    connection_generation: str
    source_binding: str
    accounts: tuple[str, ...]
    observed_at: str

    def public_summary(self) -> dict[str, object]:
        return {
            "source": "broker-accessible-accounts",
            "connectionGeneration": self.connection_generation,
            "observedAt": self.observed_at,
            "candidates": [
                {"index": index, "mask": account[:2] + "•" * (len(account) - 4) + account[-2:]}
                for index, account in enumerate(self.accounts)
            ],
            "paperIdentityVerified": False,
            "connectionVerifiedNow": False,
            "reconciliationComplete": False,
            "executionEnabled": False,
        }


class TwsManagedAccountReader(EWrapper, EClient):  # type: ignore[misc,valid-type]
    """One-use API client exposing only a bounded account-list read."""

    def __init__(self, endpoint: DiscoveryEndpoint, *, sdk_approved: bool = False,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        endpoint.validate()
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self.endpoint = endpoint
        self.sdk_approved = sdk_approved
        self.clock = clock
        self._api_ready = threading.Event()
        self._ready = threading.Event()
        self._accounts: tuple[str, ...] | None = None
        self._error_codes: list[int] = []
        self._used = False

    def managedAccounts(self, accounts_list: str) -> None:  # noqa: N802 - SDK callback
        if not isinstance(accounts_list, str):
            values = ()
        else:
            values = tuple(part.strip() for part in accounts_list.split(","))
            values = values if all(values) else ()
        if self._accounts is not None and self._accounts != values:
            self._error_codes.append(-1)  # Conflicting callbacks; no account is authoritative.
        self._accounts = values
        self._ready.set()

    def nextValidId(self, order_id: int) -> None:  # noqa: N802 - readiness only
        if type(order_id) is not int or order_id <= 0:
            self._error_codes.append(-1)
        self._api_ready.set()

    def error(self, _req_id: int, *details) -> None:  # noqa: N802 - SDK callback
        modern = len(details) >= 3 and isinstance(details[1], int)
        code = details[1] if modern else details[0] if details else None
        if type(code) is int and code not in _INFORMATIONAL_CODES:
            self._error_codes.append(code)
            self._api_ready.set()
            self._ready.set()

    def placeOrder(self, *_args, **_kwargs) -> None:  # noqa: N802 - explicit deny
        raise PaperSafetyError("Account discovery cannot place orders.")

    def cancelOrder(self, *_args, **_kwargs) -> None:  # noqa: N802 - explicit deny
        raise PaperSafetyError("Account discovery cannot change orders.")

    def reqAutoOpenOrders(self, *_args, **_kwargs) -> None:  # noqa: N802 - explicit deny
        raise PaperSafetyError("Account discovery cannot bind orders to its client ID.")

    def discover(self, *, timeout_seconds: float = 10) -> ManagedAccountDiscovery:
        if self._used:
            raise PaperSafetyError("A discovery client cannot be reused.")
        self._used = True
        if self.sdk_approved is not True or not sdk_available():
            raise PaperSafetyError("A verified supported IBKR API is unavailable in this runtime.")
        if not isinstance(timeout_seconds, (int, float)) or isinstance(timeout_seconds, bool) \
                or not 0 < timeout_seconds <= 30:
            raise ValueError("Discovery timeout must be positive and bounded.")
        self._api_ready.clear()
        self._ready.clear()
        self._accounts = None
        self._error_codes.clear()
        deadline = time.monotonic() + timeout_seconds
        reader: threading.Thread | None = None
        reader_started = False
        try:
            self.connect(self.endpoint.host, self.endpoint.port, self.endpoint.client_id)
            reader = threading.Thread(target=self.run, daemon=True)
            reader.start()
            reader_started = True
            if not self.isConnected():
                raise PaperSafetyError("TWS did not establish a local API connection.")
            if not self._api_ready.wait(max(0, deadline - time.monotonic())):
                raise PaperSafetyError("TWS API readiness did not complete in time.")
            if self._error_codes:
                raise PaperSafetyError("TWS account discovery reported an API error.")
            self.reqManagedAccts()
            if not self._ready.wait(max(0, deadline - time.monotonic())):
                raise PaperSafetyError("TWS account discovery did not complete in time.")
            if self._error_codes:
                raise PaperSafetyError("TWS account discovery reported an API error.")
            if not self.isConnected():
                raise PaperSafetyError("TWS disconnected during account discovery.")
            accounts = self._accounts
            if (accounts is None or not accounts or len(accounts) > 8
                    or any(not _ACCOUNT.fullmatch(account) for account in accounts)
                    or len(set(accounts)) != len(accounts)):
                raise PaperSafetyError("TWS returned an invalid or ambiguous account list.")
            observed = self.clock()
            if not isinstance(observed, datetime) or observed.tzinfo is None:
                raise PaperSafetyError("Discovery observation time is unavailable.")
            return ManagedAccountDiscovery(
                secrets.token_urlsafe(24), self.endpoint.binding(), accounts,
                observed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
        except PaperSafetyError:
            raise
        except Exception as exc:
            raise PaperSafetyError("TWS account discovery is unavailable.") from exc
        finally:
            disconnect_failed = False
            try:
                self.disconnect()
            except Exception:
                disconnect_failed = True
            # The first managedAccounts callback is not final evidence while
            # the SDK reader can still deliver a conflicting account list.
            # Never return candidate identities before callbacks have stopped.
            reader_alive = False
            if reader_started and reader is not None:
                try:
                    reader.join(timeout=1)
                    reader_alive = reader.is_alive()
                except RuntimeError:
                    reader_alive = True
            if disconnect_failed or reader_alive:
                raise PaperSafetyError("TWS discovery could not close its API connection.")
            if self._error_codes:
                raise PaperSafetyError("TWS account discovery reported an API error.")
