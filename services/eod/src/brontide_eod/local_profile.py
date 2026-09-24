"""Durable standalone shell preferences, separate from trading and cloud data.

The profile ID is an opaque label, not an authentication credential or broker
binding. LocalSessionManager still requires a launcher-issued capability.
"""

from __future__ import annotations

import ctypes
import json
import os
import stat
import tempfile
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal


PROFILE_DIRECTORY = "BrontideStandalone"
PROFILE_FILE = "profile.json"
PROFILE_VERSION = 1
MAX_PROFILE_BYTES = 4096
SelectedView = Literal["connect", "trading", "journal"]


@dataclass(frozen=True)
class LocalProfile:
    profile_id: str
    selected_view: SelectedView


def windows_local_app_data() -> Path:
    """Resolve the calling Windows user's LocalAppData via the OS, not env vars."""
    if os.name != "nt":
        raise OSError("The standalone profile requires Windows LocalAppData.")

    class Guid(ctypes.Structure):
        _fields_ = [("data1", ctypes.c_uint32), ("data2", ctypes.c_uint16),
                    ("data3", ctypes.c_uint16), ("data4", ctypes.c_ubyte * 8)]

    local_app_data_id = Guid.from_buffer_copy(
        uuid.UUID("f1b32785-6fba-4fcf-9d55-7b8e7f157091").bytes_le
    )
    shell32 = ctypes.windll.shell32
    shell32.SHGetKnownFolderPath.argtypes = [ctypes.POINTER(Guid), ctypes.c_uint32,
                                              ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p)]
    shell32.SHGetKnownFolderPath.restype = ctypes.c_long
    allocated = ctypes.c_wchar_p()
    result = shell32.SHGetKnownFolderPath(ctypes.byref(local_app_data_id), 0, None,
                                          ctypes.byref(allocated))
    if result != 0 or not allocated.value:
        raise OSError("Windows LocalAppData could not be resolved.")
    try:
        return Path(allocated.value)
    finally:
        ole32 = ctypes.windll.ole32
        ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
        ole32.CoTaskMemFree(ctypes.cast(allocated, ctypes.c_void_p))


def _reject_reparse(path: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    if path.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
        raise OSError("Standalone profile path must not be a reparse point.")


def _validated_profile(raw: bytes) -> LocalProfile:
    if len(raw) > MAX_PROFILE_BYTES:
        raise ValueError("Standalone profile is too large.")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Standalone profile is invalid; it was not replaced.") from exc
    if not isinstance(document, dict) or set(document) != {"schemaVersion", "profileId", "selectedView"}:
        raise ValueError("Standalone profile has an unsupported shape.")
    if type(document["schemaVersion"]) is not int or document["schemaVersion"] != PROFILE_VERSION:
        raise ValueError("Standalone profile schema is unsupported.")
    profile_id = document["profileId"]
    if not isinstance(profile_id, str) or not profile_id.startswith("local-"):
        raise ValueError("Standalone profile ID is invalid.")
    try:
        parsed_id = uuid.UUID(profile_id.removeprefix("local-"))
    except ValueError as exc:
        raise ValueError("Standalone profile ID is invalid.") from exc
    if parsed_id.version != 4 or profile_id != "local-" + str(parsed_id):
        raise ValueError("Standalone profile ID is invalid.")
    selected_view = document["selectedView"]
    if selected_view not in ("connect", "trading", "journal"):
        raise ValueError("Standalone selected view is unsupported.")
    return LocalProfile(profile_id, selected_view)


class LocalProfileStore:
    """Atomic, versioned preferences under a dedicated Windows-user directory.

    ``base`` exists only for isolated tests. Production resolves the current
    Windows user's Known Folder and never imports legacy owner/ledger files.
    This class does not establish or prove Windows ACLs for a release.
    """

    def __init__(self, *, base: Path | None = None):
        self.base = Path(base) if base is not None else windows_local_app_data()
        self.root = self.base / PROFILE_DIRECTORY
        self.path = self.root / PROFILE_FILE
        self.lock_path = self.root / ".profile.lock"

    def _ensure_root(self) -> None:
        _reject_reparse(self.base)
        if not self.base.is_dir():
            raise OSError("Windows LocalAppData is unavailable.")
        _reject_reparse(self.root)
        self.root.mkdir(mode=0o700, exist_ok=True)
        _reject_reparse(self.root)
        # The OS may virtualize a newly created LocalAppData child into a
        # packaged app's LocalCache. In that case Path.resolve() reports a
        # different physical parent even though this is the direct child of
        # the trusted Known Folder. Guard explicit reparse points above, then
        # retain the logical direct-child relationship here.
        if self.root.parent != self.base:
            raise OSError("Standalone profile escaped the selected Windows user directory.")

    @contextmanager
    def _exclusive(self) -> Iterator[None]:
        self._ensure_root()
        _reject_reparse(self.lock_path)
        with self.lock_path.open("a+b") as lock:
            _reject_reparse(self.lock_path)
            if lock.tell() == 0:
                lock.write(b"\0")
                lock.flush()
            lock.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _read(self) -> LocalProfile | None:
        _reject_reparse(self.path)
        if not self.path.exists():
            return None
        if not self.path.is_file():
            raise OSError("Standalone profile is not a regular file.")
        with self.path.open("rb") as stored:
            return _validated_profile(stored.read(MAX_PROFILE_BYTES + 1))

    def _write(self, profile: LocalProfile) -> None:
        document = {"schemaVersion": PROFILE_VERSION, "profileId": profile.profile_id,
                    "selectedView": profile.selected_view}
        temporary: Path | None = None
        try:
            descriptor, temp_name = tempfile.mkstemp(prefix=".profile-", suffix=".tmp", dir=self.root)
            temporary = Path(temp_name)
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

    def load_or_create(self) -> LocalProfile:
        with self._exclusive():
            existing = self._read()
            if existing is not None:
                return existing
            profile = LocalProfile("local-" + str(uuid.uuid4()), "connect")
            self._write(profile)
            return profile

    def select_view(self, selected_view: SelectedView, *,
                    expected_profile_id: str | None = None) -> LocalProfile:
        if selected_view not in ("connect", "trading", "journal"):
            raise ValueError("Unknown standalone view.")
        with self._exclusive():
            existing = self._read()
            if existing is None:
                raise FileNotFoundError("Standalone profile has not been initialized.")
            if expected_profile_id is not None and existing.profile_id != expected_profile_id:
                raise ValueError("Standalone profile changed; relaunch Brontide.")
            updated = LocalProfile(existing.profile_id, selected_view)
            if updated != existing:
                self._write(updated)
            return updated
