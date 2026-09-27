"""Explicit artificial-record qualification profile; never a broker identity.

The CLI accepts an ID, never a storage path. Normal launch still uses the
ordinary LocalProfileStore. This subclass reuses its locking and persistence.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from .local_profile import LocalProfile, LocalProfileStore, _reject_reparse, windows_local_app_data
from .local_journal import LEDGER, MARKER, LocalJournalSource
from .paper_store import PaperStore

VERIFICATION_DIRECTORY = "BrontideVerification"
VERIFICATION_LABEL = "Verification profile — artificial records — execution locked"


class VerificationProfileStore(LocalProfileStore):
    def __init__(self, verification_id: str):
        try:
            parsed = uuid.UUID(verification_id)
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Verification profile must be a canonical UUID, not a path.") from exc
        if str(parsed) != verification_id:
            raise ValueError("Verification profile must be a canonical UUID, not a path.")
        self.verification_id = verification_id
        self.known_folder = windows_local_app_data()
        self.verification_parent = self.known_folder / VERIFICATION_DIRECTORY
        super().__init__(base=self.verification_parent / verification_id)
        self.owner_path = self.root / "verification-owner.json"
        self.binding = "fixture-" + verification_id
        self.journal_directory = self.root / "artificial-journal"
        self._validate_paths()

    def _validate_paths(self) -> None:
        for path in (self.known_folder, self.verification_parent, self.base, self.root):
            _reject_reparse(path)
            if path.exists() and not path.is_dir():
                raise OSError("Verification profile directory is invalid.")
        if not self.known_folder.is_dir():
            raise OSError("Windows LocalAppData is unavailable.")

    def _ensure_root(self) -> None:
        self._validate_paths()
        for directory in (self.verification_parent, self.base):
            directory.mkdir(mode=0o700, exist_ok=True)
            _reject_reparse(directory)
        super()._ensure_root()

    def _owner(self, profile: LocalProfile) -> dict:
        return {"schemaVersion": 1, "verificationId": self.verification_id,
                "profileId": profile.profile_id, "artificialRecords": True}

    def _read(self) -> LocalProfile | None:
        self._validate_paths()
        profile = super()._read()
        _reject_reparse(self.owner_path)
        if profile is None:
            if self.owner_path.exists():
                raise ValueError("Verification profile is missing beside its ownership record.")
            return None
        if not self.owner_path.is_file() or self.owner_path.stat().st_size > 1024:
            raise ValueError("Verification profile ownership is unavailable.")
        if json.loads(self.owner_path.read_text(encoding="utf-8")) != self._owner(profile):
            raise ValueError("Verification profile ownership changed.")
        return profile

    def _write(self, profile: LocalProfile) -> None:
        self._validate_paths()
        existing = self._read()
        if existing is not None and existing.profile_id != profile.profile_id:
            raise ValueError("Verification profile ownership cannot be replaced.")
        super()._write(profile)
        if existing is None:
            # A crash between these writes fails closed on the next launch.
            with self.owner_path.open("x", encoding="utf-8") as owner:
                json.dump(self._owner(profile), owner, sort_keys=True)

    def check_existing_schema(self) -> None:
        self._validate_paths()
        if not self.base.exists():
            return
        super().check_existing_schema()

    def check_locked_sample_update(self) -> None:
        self.check_existing_schema()
        if not self.root.exists():
            return
        profile = self._read()
        if profile is None and self._orphaned_entries():
            raise ValueError("Verification ownership is missing beside stored data.")
        from .local_modules import MODULES_FILE, LocalModulePreferencesStore
        known = {self.path.name, self.lock_path.name, self.owner_path.name,
                 self.journal_directory.name, MODULES_FILE}
        for entry in self.root.iterdir():
            _reject_reparse(entry)
            if entry.name not in known:
                raise ValueError("Unknown verification data requires review before update.")
        if profile is not None:
            LocalModulePreferencesStore(self)._read(profile.profile_id)
            if self.journal_directory.exists():
                self.journal_source(profile.profile_id).read(profile.profile_id)

    def initialize_journal(self, profile_id: str) -> None:
        """Create an empty artificial ledger once; never replace existing data."""
        with self._exclusive():
            profile = self._read()
            if profile is None or profile.profile_id != profile_id:
                raise ValueError("Verification profile changed.")
            _reject_reparse(self.journal_directory)
            if self.journal_directory.exists():
                return
            self.journal_directory.mkdir(mode=0o700)
            with PaperStore(self.journal_directory / LEDGER).transaction():
                pass
            with (self.journal_directory / MARKER).open("x", encoding="utf-8") as marker:
                json.dump({"schemaVersion": 1, "syntheticOnly": True,
                           "profileId": profile_id, "accountBinding": self.binding,
                           "environment": "paper"}, marker, sort_keys=True)

    def journal_source(self, profile_id: str) -> LocalJournalSource:
        profile = self.read_existing()
        if profile is None or profile.profile_id != profile_id:
            raise ValueError("Verification profile changed.")
        return LocalJournalSource(fixture_directory=self.journal_directory,
                                  profile_id=profile_id, account_binding=self.binding)
