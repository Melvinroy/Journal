"""Session-bound handoff from read-only discovery to future paper confirmation.

An accessible-account list alone cannot prove TWS is in paper mode. A
server-owned adapter must corroborate that fact before ``confirm`` can write
a locked binding; the installed candidate does not supply that adapter.
"""

from __future__ import annotations

import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from .local_binding import BrokerAccountObservation, LocalBindingError, LocalBindingStore
from .local_discovery import ManagedAccountDiscovery
from .local_paper_reference import LocalPaperReferenceStore
from .local_session import LocalSessionLease, LocalSessionManager


_ACCOUNT = re.compile(r"^[A-Z][A-Z0-9]{5,31}$", re.ASCII)
_GENERATION = re.compile(r"^[A-Za-z0-9_-]{16,64}$", re.ASCII)
_SOURCE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)


@dataclass(frozen=True)
class _PendingSelection:
    lease: LocalSessionLease
    discovery: ManagedAccountDiscovery
    review_id: str
    expires_at: float


class LocalAccountSelection:
    """One ephemeral selection review per local service, never broker authority."""

    def __init__(self, session: LocalSessionManager, binding: LocalBindingStore,
                 paper_reference: LocalPaperReferenceStore,
                 *, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 monotonic: Callable[[], float] = time.monotonic):
        if paper_reference.profile_store is not binding.profile_store:
            raise ValueError("Paper reference and account choice must share one private profile.")
        self.session = session
        self.binding = binding
        self.paper_reference = paper_reference
        self.clock = clock
        self.monotonic = monotonic
        self._lock = threading.RLock()
        self._pending: _PendingSelection | None = None

    def require_ready(self, cookie: str | None, csrf: str | None) -> LocalSessionLease:
        """Refuse broker discovery until initial paper selection is eligible."""
        with self._lock:
            lease = self.session.lease(cookie, csrf)
            try:
                reference = self.paper_reference.load(lease.profile_id)
                if reference is None:
                    raise LocalBindingError("Record the owner-confirmed paper account first.")
                existing = self.binding.load(lease.profile_id)
            except LocalBindingError:
                raise
            except (OSError, ValueError) as exc:
                raise LocalBindingError(
                    "Private paper account setup is unavailable; discovery stays locked.") from exc
            if existing is not None:
                raise LocalBindingError(
                    "A paper account is already bound; use reconciliation, not a new selection.")
            # This is the first authenticated step of a new discovery route.
            # Retire its prior review before the broker reader runs: a failed
            # refresh must not leave the old selection confirmable.
            self._pending = None
            return lease

    def begin(self, cookie: str | None, csrf: str | None,
              discovery: ManagedAccountDiscovery) -> dict[str, object]:
        """Present masked candidates from a server-owned read observation."""
        with self._lock:
            lease = self.require_ready(cookie, csrf)
            if (not isinstance(discovery, ManagedAccountDiscovery)
                    or not isinstance(discovery.connection_generation, str)
                    or not _GENERATION.fullmatch(discovery.connection_generation)
                    or not isinstance(discovery.source_binding, str)
                    or not _SOURCE.fullmatch(discovery.source_binding)
                    or not isinstance(discovery.accounts, tuple)
                    or not 1 <= len(discovery.accounts) <= 8
                    or any(not isinstance(account, str) or not _ACCOUNT.fullmatch(account)
                           for account in discovery.accounts)
                    or len(set(discovery.accounts)) != len(discovery.accounts)):
                raise LocalBindingError("TWS account candidates are invalid.")
            try:
                observed = datetime.fromisoformat(discovery.observed_at.replace("Z", "+00:00"))
                now = self.clock()
                if (observed.tzinfo is None or now.tzinfo is None
                        or not timedelta(0) <= now - observed <= timedelta(seconds=30)):
                    raise ValueError("stale or future observation")
            except (AttributeError, TypeError, ValueError) as exc:
                raise LocalBindingError("Fresh TWS account candidates are required.") from exc
            review_id = secrets.token_urlsafe(24)
            self._pending = _PendingSelection(lease, discovery, review_id,
                                               self.monotonic() + 30)
            return {
                "selectionId": review_id,
                "candidates": discovery.public_summary()["candidates"],
                "paperIdentityVerified": False,
                "reconciliationRequired": True,
                "executionEnabled": False,
            }

    def confirm(self, cookie: str | None, csrf: str | None, selection_id: str,
                index: int, typed_account: str,
                observation: BrokerAccountObservation | Callable[
                    [ManagedAccountDiscovery], BrokerAccountObservation]) -> dict[str, object]:
        """Persist only a fresh, exact, independently corroborated paper choice."""
        with self._lock:
            self.session.lease(cookie, csrf)
            pending = self._pending
            if (pending is None or not isinstance(selection_id, str)
                    or selection_id != pending.review_id
                    or self.monotonic() >= pending.expires_at):
                raise LocalBindingError("Account selection expired; discover accounts again.")
            self.session.require_lease(pending.lease, cookie, csrf)
            self._pending = None  # Every authenticated attempt consumes its review.
            accounts = pending.discovery.accounts
            if (type(index) is not int or not 0 <= index < len(accounts)
                    or not isinstance(typed_account, str)
                    or not _ACCOUNT.fullmatch(typed_account)
                    or typed_account not in accounts
                    or len(typed_account) != len(accounts[index])
                    or typed_account[:2] != accounts[index][:2]
                    or typed_account[-2:] != accounts[index][-2:]):
                # The selected mask can represent more than one full ID.
                # Resolve only an exact observed ID, then match the independent
                # owner reference below. Never infer identity from the mask.
                raise LocalBindingError("Type an exact observed account with the selected mask.")
            # Keep the browser lock responsive during a bounded SDK read.
            # Reacquire the session lease for the short durable write below.
            if callable(observation):
                observation = observation(pending.discovery)
            with self.session.hold_lease(pending.lease, cookie, csrf) as principal:
                if (not isinstance(observation, BrokerAccountObservation)
                        or observation.connection_generation != pending.discovery.connection_generation
                        or observation.source_binding != pending.discovery.source_binding
                        or observation.accounts != accounts):
                    raise LocalBindingError("Broker account evidence changed; discover accounts again.")
                discovered_at = datetime.fromisoformat(
                    pending.discovery.observed_at.replace("Z", "+00:00"))
                if (not isinstance(observation.observed_at, datetime)
                        or observation.observed_at.tzinfo is None
                        or observation.observed_at < discovered_at):
                    raise LocalBindingError("Fresh broker account evidence is required.")
                try:
                    independently_matched = self.paper_reference.match_fresh_account(
                        principal.profile_id, pending.discovery)
                except (OSError, ValueError) as exc:
                    raise LocalBindingError(
                        "Owner-confirmed paper account reference is unavailable.") from exc
                if independently_matched != typed_account:
                    raise LocalBindingError(
                        "The selected account differs from the owner-confirmed paper reference.")
                try:
                    remembered = self.binding.confirm(principal.profile_id,
                                                       typed_account, typed_account,
                                                       observation)
                except LocalBindingError:
                    raise
                except (OSError, ValueError) as exc:
                    raise LocalBindingError("Local account storage is unavailable.") from exc
                return remembered.public_status()
