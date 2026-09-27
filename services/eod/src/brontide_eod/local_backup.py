"""Offline, owner-scoped snapshot preparation for an isolated Windows profile.

This helper has no browser route or installed-candidate command. It requires the
same named mutex as the local service and refuses uncertain private contents.
Windows destination ACLs, operator restore and broker exposure remain separate
release gates; a successful snapshot does not authorize an update or trading.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

from .local_binding import BINDING_FILE, LocalBindingStore
from .local_instance import WindowsStandaloneInstance
from .local_journal import (LEDGER, RECORDED_DIRECTORY, RECORDED_MARKER,
                            LocalRecordedJournalSource)
from .local_modules import MODULES_FILE, LocalModulePreferencesStore
from .local_paper_reference import REFERENCE_FILE, LocalPaperReferenceStore
from .local_plan_store import LocalSavedPlanStore
from .local_profile import (PROFILE_DIRECTORY, PROFILE_FILE, LocalProfileStore,
                            _reject_reparse)
from .paper_store import PaperStore


_ROOT_FILES = frozenset({PROFILE_FILE, MODULES_FILE, REFERENCE_FILE, BINDING_FILE,
                         ".profile.lock"})
_OLD_BACKUP = re.compile(r"^ledger\.sqlite3\.pre-v1\.[0-9a-f]{32}\.bak$")


class LocalBackupUnavailable(ValueError):
    """A complete private snapshot cannot be established safely."""


def _regular(path: Path) -> None:
    _reject_reparse(path)
    if not path.is_file():
        raise LocalBackupUnavailable("Private backup source is not a regular file.")


def _copy(source: Path, destination: Path) -> None:
    _regular(source)
    with source.open("rb") as original:
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as copied:
            shutil.copyfileobj(original, copied)
            copied.flush()
            os.fsync(copied.fileno())


def create_private_snapshot(profile_store: LocalProfileStore,
                            destination: Path) -> Path:
    """Copy one stopped profile and a SQLite-consistent ledger to a new folder.

    The caller supplies an absolute, unused destination under an existing
    private parent. Nothing is imported, restored, switched or transmitted.
    This remains unmounted until destination ACL and operator checks pass.
    """
    if not isinstance(profile_store, LocalProfileStore) or os.name != "nt":
        raise LocalBackupUnavailable("An existing Windows local profile is required.")
    destination = Path(destination)
    parent = destination.parent
    if not destination.is_absolute() or not parent.is_dir() or destination.exists():
        raise LocalBackupUnavailable("An unused absolute private backup destination is required.")
    for ancestor in (parent, *parent.parents):
        _reject_reparse(ancestor)
    _reject_reparse(destination)
    if parent.resolve().is_relative_to(profile_store.root.resolve()):
        raise LocalBackupUnavailable("A backup cannot be placed inside the active profile.")

    with WindowsStandaloneInstance.acquire_stopped(profile_store) as maintenance:
        with profile_store._exclusive():
            profile = profile_store._read()
            if profile is None or profile.profile_id != maintenance.profile_id:
                raise LocalBackupUnavailable("The local profile changed during backup.")
            root = profile_store.root
            for entry in root.iterdir():
                _reject_reparse(entry)
                if entry.name not in _ROOT_FILES | {RECORDED_DIRECTORY}:
                    raise LocalBackupUnavailable("Unknown private profile data requires review before backup.")
            binding = LocalBindingStore(profile_store).load(profile.profile_id)
            reference = LocalPaperReferenceStore(profile_store).load(profile.profile_id)
            modules = LocalModulePreferencesStore(profile_store).load(profile.profile_id)
            recorded = root / RECORDED_DIRECTORY
            _reject_reparse(recorded)
            if binding is not None and (reference is None or not recorded.is_dir()):
                raise LocalBackupUnavailable("Bound paper data is incomplete; preserve it for review.")
            if binding is not None and not binding.matches_reference(reference):
                raise LocalBackupUnavailable("The paper reference conflicts with the saved account binding.")
            if recorded.exists() and binding is None:
                raise LocalBackupUnavailable("Recorded trade data has no exact saved account binding.")

            history = None
            plan = None
            if binding is not None:
                source = LocalRecordedJournalSource.from_private_directory(
                    ledger_directory=recorded, profile_id=profile.profile_id,
                    remembered_account_binding=binding.account_binding)
                history = source.read(profile.profile_id)
                # load_latest() takes the profile lock itself. We already
                # hold it, so read its validated pointer inside this lock.
                plan_store = LocalSavedPlanStore(
                    profile_store, LocalBindingStore(profile_store))
                with PaperStore(recorded / LEDGER).transaction() as db:
                    plan = plan_store._read_latest(db, source)

            stage = Path(tempfile.mkdtemp(prefix=".brontide-snapshot-", dir=parent))
            try:
                copied_root = stage / PROFILE_DIRECTORY
                copied_root.mkdir()
                for name in _ROOT_FILES - {".profile.lock"}:
                    source_file = root / name
                    if source_file.exists():
                        _copy(source_file, copied_root / name)
                if binding is not None:
                    copied_recorded = copied_root / RECORDED_DIRECTORY
                    copied_recorded.mkdir()
                    for entry in recorded.iterdir():
                        _reject_reparse(entry)
                        if entry.name in {LEDGER + "-wal", LEDGER + "-shm"}:
                            continue  # Included by SQLite's consistent backup.
                        if entry.name not in {LEDGER, RECORDED_MARKER} and not _OLD_BACKUP.fullmatch(entry.name):
                            raise LocalBackupUnavailable("Unknown recorded data requires review before backup.")
                        if entry.name not in {LEDGER, RECORDED_MARKER}:
                            _copy(entry, copied_recorded / entry.name)
                    _copy(recorded / RECORDED_MARKER,
                          copied_recorded / RECORDED_MARKER)
                    PaperStore(recorded / LEDGER).backup(copied_recorded / LEDGER)

                restored_store = LocalProfileStore(base=stage)
                restored = restored_store.read_existing()
                if restored != profile:
                    raise LocalBackupUnavailable("Snapshot profile does not match its source.")
                restored_reference = LocalPaperReferenceStore(restored_store).load(profile.profile_id)
                if restored_reference != reference:
                    raise LocalBackupUnavailable("Snapshot paper reference does not match its source.")
                restored_modules = LocalModulePreferencesStore(restored_store).load(profile.profile_id)
                if restored_modules != modules:
                    raise LocalBackupUnavailable("Snapshot module choice does not match its source.")
                restored_binding = LocalBindingStore(restored_store).load(profile.profile_id)
                if restored_binding != binding:
                    raise LocalBackupUnavailable("Snapshot account binding does not match its source.")
                if binding is not None:
                    restored_source = LocalRecordedJournalSource.from_private_directory(
                        ledger_directory=copied_root / RECORDED_DIRECTORY,
                        profile_id=profile.profile_id,
                        remembered_account_binding=binding.account_binding)
                    if restored_source.read(profile.profile_id) != history:
                        raise LocalBackupUnavailable("Snapshot trade history does not match its source.")
                    restored_plan = LocalSavedPlanStore(
                        restored_store, LocalBindingStore(restored_store)).load_latest(
                            profile.profile_id)
                    if restored_plan != plan:
                        raise LocalBackupUnavailable("Snapshot saved plan does not match its source.")
                if destination.exists():
                    raise LocalBackupUnavailable("Backup destination appeared during preparation.")
                os.rename(stage, destination)
                return destination
            finally:
                # Only a newly created sibling staging folder can be removed.
                if (stage.exists() and stage.parent.resolve() == parent.resolve()
                        and stage.name.startswith(".brontide-snapshot-")):
                    shutil.rmtree(stage)
