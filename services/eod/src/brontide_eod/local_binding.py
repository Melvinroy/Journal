"""Private paper-account binding contract for a future connected local adapter.

No HTTP route constructs BrokerAccountObservation. The installed sample has no
broker adapter and cannot call this module to claim a fixture as a real account.
An installed binding is a remembered choice, not current connection authority.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import tempfile
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .ibkr_tws import PaperGatewayConfig, PaperSafetyError
from .local_discovery import DiscoveryEndpoint
from .local_paper_reference import LocalOwnerPaperReference, LocalPaperReferenceStore
from .local_profile import LocalProfileStore, _reject_reparse


BINDING_FILE = "paper-binding.json"
MAX_BINDING_BYTES = 2048
_ACCOUNT = re.compile(r"^[A-Z][A-Z0-9]{5,31}$", re.ASCII)
_HEX = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
_GENERATION = re.compile(r"^[A-Za-z0-9_-]{16,64}$", re.ASCII)


class LocalBindingError(ValueError):
    """Account evidence is absent, stale, changed, or cannot be stored safely."""


@dataclass(frozen=True)
class BrokerAccountObservation:
    """Adapter-owned evidence; never deserialize this class from a browser body."""

    connection_generation: str
    source_binding: str
    accounts: tuple[str, ...]
    environment: str
    paper_identity_verified: bool
    sdk_compatible: bool
    api_usable: bool
    observed_at: datetime


@dataclass(frozen=True)
class LocalPaperBinding:
    profile_id: str
    account_binding: str
    account_mask: str
    source_binding: str
    confirmed_at: str
    owner_reference_digest: str | None = None

    def matches_reference(self, reference: LocalOwnerPaperReference | None) -> bool:
        """Tie the remembered choice to the exact private reference used to save it."""
        return (isinstance(reference, LocalOwnerPaperReference)
                and reference.profile_id == self.profile_id
                and reference.account_mask == self.account_mask
                and isinstance(self.owner_reference_digest, str)
                and bool(_HEX.fullmatch(self.owner_reference_digest))
                and secrets.compare_digest(self.owner_reference_digest,
                                           reference.account_digest))

    def matches_exact_account(self, account: str) -> bool:
        """Compare a typed ID with the stored binding without publishing either."""
        if not isinstance(account, str) or not _ACCOUNT.fullmatch(account):
            return False
        payload = json.dumps({"accountId": account, "environment": "paper",
                              "sourceBinding": self.source_binding},
                             sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return secrets.compare_digest(self.account_binding, digest)

    def public_status(self) -> dict[str, object]:
        if (not isinstance(self.owner_reference_digest, str)
                or not _HEX.fullmatch(self.owner_reference_digest)):
            raise LocalBindingError("An unlinked paper choice cannot be displayed as remembered.")
        return {
            "remembered": True, "environment": "paper",
            "accountMask": self.account_mask, "connectionVerified": False,
            "reconciliationRequired": True, "executionEnabled": False,
        }


@dataclass(frozen=True)
class LocalLedgerScope:
    """Candidate scope for *new* local records, never legacy import authority."""

    profile_id: str
    remembered_account_binding: str
    paper_ledger_binding: str
    environment: str = "paper"

    def matches_new_campaign(self, campaign: object) -> bool:
        return (isinstance(campaign, dict)
                and campaign.get("userId") == self.profile_id
                and campaign.get("accountBinding") == self.paper_ledger_binding
                and campaign.get("environment") == self.environment)


def _confirmed_binding(profile_id: str, selected_account: str, typed_account: str,
                       observation: BrokerAccountObservation,
                       now: datetime) -> LocalPaperBinding:
    if (not isinstance(profile_id, str) or not profile_id.startswith("local-")
            or not isinstance(selected_account, str)
            or not isinstance(typed_account, str)
            or not _ACCOUNT.fullmatch(selected_account)
            or selected_account != typed_account):
        raise LocalBindingError("Exact paper account confirmation is required.")
    if (not isinstance(observation, BrokerAccountObservation)
            or not isinstance(observation.connection_generation, str)
            or not _GENERATION.fullmatch(observation.connection_generation)
            or not isinstance(observation.source_binding, str)
            or not _HEX.fullmatch(observation.source_binding)
            or observation.environment != "paper"
            or observation.paper_identity_verified is not True
            or observation.sdk_compatible is not True
            or observation.api_usable is not True
            or not isinstance(observation.accounts, tuple)
            or not observation.accounts or len(observation.accounts) > 8
            or any(not isinstance(account, str) or not _ACCOUNT.fullmatch(account)
                   for account in observation.accounts)
            or len(set(observation.accounts)) != len(observation.accounts)
            or selected_account not in observation.accounts):
        raise LocalBindingError("Verified paper account evidence is required.")
    if (not isinstance(now, datetime)
            or not isinstance(observation.observed_at, datetime)
            or now.tzinfo is None or observation.observed_at.tzinfo is None
            or not timedelta(0) <= now - observation.observed_at <= timedelta(seconds=30)):
        raise LocalBindingError("Fresh broker account evidence is required.")
    payload = json.dumps({"accountId": selected_account, "environment": "paper",
                          "sourceBinding": observation.source_binding},
                         sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    account_mask = selected_account[:2] + "•" * max(2, len(selected_account) - 4) + selected_account[-2:]
    return LocalPaperBinding(profile_id, digest, account_mask,
                             observation.source_binding,
                             now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"))


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise LocalBindingError("Paper binding has duplicate fields.")
        result[key] = value
    return result


class LocalBindingStore:
    """Atomic remembered choice under the existing private profile lock.

    A different binding is never silently adopted. Before a future account
    switch, the connected service must separately prove exposure/orders/rules
    reconciled and define an audited transition; this store offers no switch.
    """

    def __init__(self, profile_store: LocalProfileStore,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.profile_store = profile_store
        self.path = profile_store.root / BINDING_FILE
        self.clock = clock

    def _read(self, expected_profile_id: str) -> LocalPaperBinding | None:
        _reject_reparse(self.path)
        if not self.path.exists():
            return None
        if not self.path.is_file() or self.path.stat().st_size > MAX_BINDING_BYTES:
            raise LocalBindingError("Paper binding is invalid.")
        try:
            with self.path.open("rb") as stored:
                document = json.loads(stored.read(MAX_BINDING_BYTES + 1),
                                      object_pairs_hook=_unique_pairs)
            if (not isinstance(document, dict)
                    or set(document) != {"schemaVersion", "profileId", "environment",
                                        "accountBinding", "accountMask", "sourceBinding",
                                        "ownerReferenceDigest",
                                        "confirmedAt", "submissionLocked", "reconciliationRequired"}
                    or type(document["schemaVersion"]) is not int
                    or document["schemaVersion"] != 2
                    or document["profileId"] != expected_profile_id
                    or document["environment"] != "paper"
                    or document["submissionLocked"] is not True
                    or document["reconciliationRequired"] is not True
                    or not isinstance(document["accountBinding"], str)
                    or not _HEX.fullmatch(document["accountBinding"])
                    or not isinstance(document["sourceBinding"], str)
                    or not _HEX.fullmatch(document["sourceBinding"])
                    or not isinstance(document["ownerReferenceDigest"], str)
                    or not _HEX.fullmatch(document["ownerReferenceDigest"])
                    or not isinstance(document["accountMask"], str)
                    or not re.fullmatch(r"[A-Z0-9]{2}•{2,28}[A-Z0-9]{2}", document["accountMask"])
                    or not isinstance(document["confirmedAt"], str)
                    or not document["confirmedAt"].endswith("Z")
                    or datetime.fromisoformat(document["confirmedAt"].replace("Z", "+00:00")).tzinfo is None):
                raise LocalBindingError("Paper binding is invalid or belongs to another profile.")
            return LocalPaperBinding(expected_profile_id, document["accountBinding"],
                                     document["accountMask"], document["sourceBinding"],
                                     document["confirmedAt"],
                                     document["ownerReferenceDigest"])
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, KeyError, ValueError) as exc:
            raise LocalBindingError("Paper binding is unavailable or invalid.") from exc

    def load(self, expected_profile_id: str) -> LocalPaperBinding | None:
        self.profile_store.check_existing_schema()
        if not self.profile_store.root.exists():
            return None
        profile = self.profile_store._read()
        if profile is None or profile.profile_id != expected_profile_id:
            raise LocalBindingError("Local profile changed; relaunch Brontide.")
        return self._read(expected_profile_id)

    def confirm(self, expected_profile_id: str, selected_account: str,
                typed_account: str, observation: BrokerAccountObservation) -> LocalPaperBinding:
        with self.profile_store._exclusive():
            proposed = _confirmed_binding(expected_profile_id, selected_account,
                                          typed_account, observation, self.clock())
            profile = self.profile_store._read()
            if profile is None or profile.profile_id != expected_profile_id:
                raise LocalBindingError("Local profile changed; relaunch Brontide.")
            # A confirmed account cannot become active under a hidden Trading
            # view. Both preference and binding writes hold the same lock.
            from .local_modules import LocalModulePreferencesStore
            if "trading" not in LocalModulePreferencesStore(
                    self.profile_store)._read(expected_profile_id).enabled_views:
                raise LocalBindingError("Show Trading before confirming a paper account.")
            existing = self._read(expected_profile_id)
            if existing is not None:
                if (existing.account_binding != proposed.account_binding
                        or existing.source_binding != proposed.source_binding):
                    raise LocalBindingError("A different paper account is already bound; reconcile before switching.")
            reference = LocalPaperReferenceStore(self.profile_store).load(expected_profile_id)
            if reference is None or not reference.matches(selected_account):
                raise LocalBindingError("The exact owner paper reference is unavailable or changed.")
            proposed = replace(proposed, owner_reference_digest=reference.account_digest)
            if existing is not None:
                if not existing.matches_reference(reference):
                    raise LocalBindingError("The paper account reference changed; reconcile before continuing.")
                return existing
            document = {"schemaVersion": 2, "profileId": proposed.profile_id,
                        "environment": "paper", "accountBinding": proposed.account_binding,
                        "accountMask": proposed.account_mask, "sourceBinding": proposed.source_binding,
                        "ownerReferenceDigest": proposed.owner_reference_digest,
                        "confirmedAt": proposed.confirmed_at, "submissionLocked": True,
                        "reconciliationRequired": True}
            temporary: Path | None = None
            try:
                descriptor, name = tempfile.mkstemp(prefix=".paper-binding-", suffix=".tmp",
                                                    dir=self.profile_store.root)
                temporary = Path(name)
                with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                    json.dump(document, target, sort_keys=True, separators=(",", ":"))
                    target.write("\n")
                    target.flush()
                    os.fsync(target.fileno())
                _reject_reparse(self.path)
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return proposed

    def matched_account_for_reconciliation(
        self, expected_profile_id: str, observation: BrokerAccountObservation,
    ) -> str:
        """Find the exact remembered account in fresh evidence; never arm orders.

        The caller still owes complete broker snapshots, execution history and
        policy checks before any separate execution decision.
        """
        remembered = self.load(expected_profile_id)
        if remembered is None:
            raise LocalBindingError("No confirmed paper account is remembered.")
        if not remembered.matches_reference(
                LocalPaperReferenceStore(self.profile_store).load(expected_profile_id)):
            raise LocalBindingError("The exact owner paper reference changed.")
        if not isinstance(observation, BrokerAccountObservation):
            raise LocalBindingError("Fresh broker account evidence is required.")
        accounts = observation.accounts
        if not isinstance(accounts, tuple):
            raise LocalBindingError("Verified paper account evidence is required.")
        matches = []
        for account in accounts:
            candidate = _confirmed_binding(expected_profile_id, account, account,
                                           observation, self.clock())
            if (candidate.source_binding == remembered.source_binding
                    and candidate.account_binding == remembered.account_binding):
                matches.append(account)
        if len(matches) != 1:
            raise LocalBindingError("The remembered paper account was not uniquely observed.")
        return matches[0]

    def candidate_ledger_scope(
        self, expected_profile_id: str, observation: BrokerAccountObservation,
        discovery_endpoint: DiscoveryEndpoint, gateway_config: PaperGatewayConfig,
    ) -> LocalLedgerScope:
        """Bridge distinct account and ledger digests after exact paper evidence.

        This does not read or adopt a ledger, reconcile broker state, or grant
        submission authority. The caller must use server-owned endpoint/config
        objects and independently verify the private ledger before mounting it.
        """
        selected = self.matched_account_for_reconciliation(
            expected_profile_id, observation)
        if not isinstance(discovery_endpoint, DiscoveryEndpoint) \
                or not isinstance(gateway_config, PaperGatewayConfig):
            raise LocalBindingError("A verified local paper configuration is required.")
        try:
            discovery_source = discovery_endpoint.binding()
            ledger_binding = gateway_config.binding()
        except (PaperSafetyError, TypeError, ValueError) as exc:
            raise LocalBindingError("A verified local paper configuration is required.") from exc
        if (gateway_config.host != "127.0.0.1"
                or gateway_config.host != discovery_endpoint.host
                or gateway_config.port != discovery_endpoint.port
                or gateway_config.account_id != selected
                or observation.source_binding != discovery_source):
            raise LocalBindingError("Paper discovery and ledger configuration differ.")
        remembered = self.load(expected_profile_id)
        if remembered is None or remembered.source_binding != discovery_source:
            raise LocalBindingError("The confirmed paper account changed.")
        return LocalLedgerScope(expected_profile_id, remembered.account_binding,
                                ledger_binding)
