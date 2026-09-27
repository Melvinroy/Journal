"""Unmounted read-only bridge from owner paper reference to TWS account lists.

The TWS API list does not establish paper mode. This adapter requires a prior
owner-attested paper account, an explicitly approved read-only SDK, and two
matching fresh account observations. It has no installed launcher caller and
never authorizes orders or current broker reconciliation.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Callable

from .local_binding import BrokerAccountObservation, LocalBindingStore
from .local_discovery import (DiscoveryEndpoint, ManagedAccountDiscovery,
                              TwsManagedAccountReader)
from .local_paper_reference import LocalOwnerPaperReference, LocalPaperReferenceStore
from .local_profile import LocalProfileStore


class LocalAccountEvidenceUnavailable(ValueError):
    """No account choice can be corroborated from this read-only source."""


_ACCOUNT = re.compile(r"^[A-Z][A-Z0-9]{5,31}$", re.ASCII)
_GENERATION = re.compile(r"^[A-Za-z0-9_-]{16,64}$", re.ASCII)


class OwnerAttestedAccountEvidence:
    """One-use pair of bounded reads for a future server-owned Connect route.

    ``sdk_approved`` is an explicit external gate, not a metadata-derived
    approval. The installed candidate never constructs this class.
    """

    def __init__(self, profile_store: LocalProfileStore, profile_id: str,
                 endpoint: DiscoveryEndpoint, *, sdk_approved: bool = False,
                 reader_factory: Callable[[], TwsManagedAccountReader] | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        if (not isinstance(profile_store, LocalProfileStore)
                or not isinstance(profile_id, str) or not profile_id.startswith("local-")):
            raise ValueError("An existing local owner profile is required.")
        endpoint.validate()
        self.profile_store = profile_store
        self.profile_id = profile_id
        self.endpoint = endpoint
        self.sdk_approved = sdk_approved is True
        self.reader_factory = reader_factory or (
            lambda: TwsManagedAccountReader(endpoint, sdk_approved=self.sdk_approved))
        self.clock = clock
        self.reference = LocalPaperReferenceStore(profile_store, clock=clock)
        self.binding = LocalBindingStore(profile_store)
        self._lock = RLock()
        self._pending: tuple[ManagedAccountDiscovery, LocalOwnerPaperReference] | None = None

    def _ready_reference(self) -> LocalOwnerPaperReference:
        try:
            profile = self.profile_store.read_existing()
            if profile is None or profile.profile_id != self.profile_id:
                raise LocalAccountEvidenceUnavailable("The local owner profile changed.")
            reference = self.reference.load(self.profile_id)
            if reference is None or self.binding.load(self.profile_id) is not None:
                raise LocalAccountEvidenceUnavailable(
                    "An unbound owner-confirmed paper reference is required.")
            return reference
        except LocalAccountEvidenceUnavailable:
            raise
        except (OSError, ValueError) as exc:
            raise LocalAccountEvidenceUnavailable(
                "Private paper account evidence is unavailable.") from exc

    def _read(self) -> ManagedAccountDiscovery:
        if not self.sdk_approved:
            raise LocalAccountEvidenceUnavailable(
                "A separately approved supported read-only SDK is required.")
        try:
            reader = self.reader_factory()
            if (reader.sdk_approved is not True
                    or reader.endpoint.binding() != self.endpoint.binding()):
                raise LocalAccountEvidenceUnavailable(
                    "The read-only account source is not approved.")
            discovery = reader.discover()
            if (not isinstance(discovery, ManagedAccountDiscovery)
                    or discovery.source_binding != self.endpoint.binding()
                    or not isinstance(discovery.connection_generation, str)
                    or not _GENERATION.fullmatch(discovery.connection_generation)
                    or not isinstance(discovery.accounts, tuple)
                    or not 1 <= len(discovery.accounts) <= 8
                    or any(not isinstance(account, str) or not _ACCOUNT.fullmatch(account)
                           for account in discovery.accounts)
                    or len(set(discovery.accounts)) != len(discovery.accounts)):
                raise LocalAccountEvidenceUnavailable(
                    "TWS account source changed during discovery or returned invalid accounts.")
            observed = datetime.fromisoformat(
                discovery.observed_at.replace("Z", "+00:00"))
            now = self.clock()
            if (observed.tzinfo is None or not isinstance(now, datetime)
                    or now.tzinfo is None
                    or not timedelta(0) <= now - observed <= timedelta(seconds=30)):
                raise LocalAccountEvidenceUnavailable(
                    "Fresh TWS account evidence is required.")
            return discovery
        except LocalAccountEvidenceUnavailable:
            raise
        except Exception:
            raise LocalAccountEvidenceUnavailable(
                "Read-only TWS account evidence is unavailable.") from None

    def discover(self) -> ManagedAccountDiscovery:
        with self._lock:
            self._pending = None
            reference = self._ready_reference()
            discovery = self._read()
            if self._ready_reference() != reference:
                raise LocalAccountEvidenceUnavailable(
                    "Owner paper reference changed during discovery.")
            self._pending = (discovery, reference)
            return discovery

    def corroborate(self, discovery: ManagedAccountDiscovery) -> BrokerAccountObservation:
        with self._lock:
            pending, self._pending = self._pending, None
            if pending is None or discovery is not pending[0]:
                raise LocalAccountEvidenceUnavailable(
                    "Start a fresh account review before confirmation.")
            reference = pending[1]
            if self._ready_reference() != reference:
                raise LocalAccountEvidenceUnavailable(
                    "Owner paper reference changed during account review.")
            fresh = self._read()
            if (fresh.source_binding != discovery.source_binding
                    or fresh.connection_generation == discovery.connection_generation
                    or fresh.accounts != discovery.accounts):
                raise LocalAccountEvidenceUnavailable(
                    "Independent TWS account evidence is unavailable; start a new review.")
            original_at = datetime.fromisoformat(
                discovery.observed_at.replace("Z", "+00:00"))
            observed_at = datetime.fromisoformat(
                fresh.observed_at.replace("Z", "+00:00"))
            if observed_at <= original_at or self._ready_reference() != reference:
                raise LocalAccountEvidenceUnavailable(
                    "Paper account evidence changed during review.")
            try:
                matched = self.reference.match_fresh_account(
                    self.profile_id, fresh)
            except (OSError, ValueError) as exc:
                raise LocalAccountEvidenceUnavailable(
                    "The owner paper reference was not uniquely observed.") from exc
            if matched not in discovery.accounts:
                raise LocalAccountEvidenceUnavailable(
                    "The owner paper account was not in the reviewed list.")
            return BrokerAccountObservation(
                discovery.connection_generation, discovery.source_binding,
                discovery.accounts, "paper", True, True, True, observed_at)
