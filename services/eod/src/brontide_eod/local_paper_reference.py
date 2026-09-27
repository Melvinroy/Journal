"""Private owner-attested paper-account reference for future local setup.

This is not TWS paper-mode evidence by itself. An operator must establish the
paper account outside the TWS API before recording it. The local setup route
can record and display a masked reference; matching it never permits submissions.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .local_discovery import ManagedAccountDiscovery
from .local_profile import LocalProfileStore, _reject_reparse


REFERENCE_FILE = "owner-paper-account.json"
MAX_REFERENCE_BYTES = 2048
_ACCOUNT = re.compile(r"^[A-Z][A-Z0-9]{5,31}$", re.ASCII)
_HEX = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
_GENERATION = re.compile(r"^[A-Za-z0-9_-]{16,64}$", re.ASCII)
_ATTESTATION = "owner-confirmed-paper-account"


class LocalPaperReferenceError(ValueError):
    """The private reference or fresh account observation is unavailable."""


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise LocalPaperReferenceError("Paper reference has a duplicate field.")
        result[key] = value
    return result


def _digest(salt: str, profile_id: str, account: str) -> str:
    return hashlib.sha256(bytes.fromhex(salt) + profile_id.encode("utf-8")
                          + b"\0" + account.encode("ascii")).hexdigest()


def _mask(account: str) -> str:
    return account[:2] + "•" * (len(account) - 4) + account[-2:]


@dataclass(frozen=True)
class LocalOwnerPaperReference:
    profile_id: str
    account_mask: str
    salt: str
    account_digest: str
    recorded_at: str

    def matches(self, account: str) -> bool:
        return (isinstance(account, str) and bool(_ACCOUNT.fullmatch(account))
                and self.account_mask == _mask(account)
                and secrets.compare_digest(
                    self.account_digest, _digest(self.salt, self.profile_id, account)))


class LocalPaperReferenceStore:
    """One owner-attested account per local profile, without broker authority."""

    def __init__(self, profile_store: LocalProfileStore, *,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.profile_store = profile_store
        self.path = profile_store.root / REFERENCE_FILE
        self.clock = clock

    def _read(self, profile_id: str) -> LocalOwnerPaperReference | None:
        _reject_reparse(self.path)
        if not self.path.exists():
            return None
        if not self.path.is_file() or self.path.stat().st_size > MAX_REFERENCE_BYTES:
            raise LocalPaperReferenceError("Private paper reference is unavailable.")
        try:
            with self.path.open("rb") as stored:
                raw = stored.read(MAX_REFERENCE_BYTES + 1)
            document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
            if (len(raw) > MAX_REFERENCE_BYTES or not isinstance(document, dict)
                    or set(document) != {"schemaVersion", "profileId", "environment",
                                        "attestation", "accountMask", "salt",
                                        "accountDigest", "recordedAt"}
                    or type(document["schemaVersion"]) is not int
                    or document["schemaVersion"] != 1
                    or document["profileId"] != profile_id
                    or document["environment"] != "paper"
                    or document["attestation"] != _ATTESTATION
                    or not isinstance(document["accountMask"], str)
                    or not re.fullmatch(r"[A-Z0-9]{2}•{2,28}[A-Z0-9]{2}",
                                        document["accountMask"])
                    or not isinstance(document["salt"], str)
                    or not _HEX.fullmatch(document["salt"])
                    or not isinstance(document["accountDigest"], str)
                    or not _HEX.fullmatch(document["accountDigest"])
                    or not isinstance(document["recordedAt"], str)):
                raise LocalPaperReferenceError("Private paper reference is invalid.")
            recorded = datetime.fromisoformat(
                document["recordedAt"].replace("Z", "+00:00"))
            if recorded.tzinfo is None:
                raise LocalPaperReferenceError("Paper reference time is invalid.")
            return LocalOwnerPaperReference(
                profile_id, document["accountMask"], document["salt"],
                document["accountDigest"], document["recordedAt"])
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError,
                KeyError, ValueError) as exc:
            raise LocalPaperReferenceError("Private paper reference is unavailable or invalid.") from exc

    def load(self, profile_id: str) -> LocalOwnerPaperReference | None:
        self.profile_store.check_existing_schema()
        profile = self.profile_store._read()
        if profile is None or profile.profile_id != profile_id:
            raise LocalPaperReferenceError("Local profile changed; relaunch Brontide.")
        return self._read(profile_id)

    def record_owner_attested(self, profile_id: str, account: str) -> LocalOwnerPaperReference:
        """Store an externally checked paper ID; this method cannot check IBKR."""
        if not isinstance(account, str) or not _ACCOUNT.fullmatch(account):
            raise LocalPaperReferenceError("An exact owner-confirmed account is required.")
        now = self.clock()
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise LocalPaperReferenceError("A valid local reference time is required.")
        with self.profile_store._exclusive():
            profile = self.profile_store._read()
            if profile is None or profile.profile_id != profile_id:
                raise LocalPaperReferenceError("Local profile changed; relaunch Brontide.")
            existing = self._read(profile_id)
            if existing is not None:
                if not existing.matches(account):
                    raise LocalPaperReferenceError(
                        "A different paper reference exists; reconcile before changing it.")
                return existing
            salt = secrets.token_hex(32)
            document = {
                "schemaVersion": 1, "profileId": profile_id, "environment": "paper",
                "attestation": _ATTESTATION,
                "accountMask": _mask(account),
                "salt": salt, "accountDigest": _digest(salt, profile_id, account),
                "recordedAt": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            temporary: Path | None = None
            try:
                descriptor, name = tempfile.mkstemp(prefix=".paper-reference-", suffix=".tmp",
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
            return self._read(profile_id)

    def match_fresh_account(self, profile_id: str,
                            discovery: ManagedAccountDiscovery) -> str:
        """Return the one matching TWS ID, without asserting paper mode or authority."""
        reference = self.load(profile_id)
        if reference is None:
            raise LocalPaperReferenceError("An owner-confirmed paper reference is required.")
        if (not isinstance(discovery, ManagedAccountDiscovery)
                or not isinstance(discovery.connection_generation, str)
                or not _GENERATION.fullmatch(discovery.connection_generation)
                or not isinstance(discovery.source_binding, str)
                or not _HEX.fullmatch(discovery.source_binding)
                or not isinstance(discovery.accounts, tuple)
                or not 1 <= len(discovery.accounts) <= 8
                or any(not isinstance(account, str) or not _ACCOUNT.fullmatch(account)
                       for account in discovery.accounts)
                or len(set(discovery.accounts)) != len(discovery.accounts)):
            raise LocalPaperReferenceError("TWS account observation is invalid.")
        try:
            observed = datetime.fromisoformat(
                discovery.observed_at.replace("Z", "+00:00"))
            now = self.clock()
            if (observed.tzinfo is None or not isinstance(now, datetime)
                    or now.tzinfo is None
                    or not timedelta(0) <= now - observed <= timedelta(seconds=30)):
                raise LocalPaperReferenceError("Fresh TWS account observation is required.")
        except (AttributeError, TypeError, ValueError) as exc:
            raise LocalPaperReferenceError("Fresh TWS account observation is required.") from exc
        matches = [account for account in discovery.accounts if reference.matches(account)]
        if len(matches) != 1:
            raise LocalPaperReferenceError("The paper reference was not uniquely observed.")
        return matches[0]
