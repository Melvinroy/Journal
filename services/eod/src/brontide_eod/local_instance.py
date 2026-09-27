"""Fail-closed ownership and one-bit reopen signal for a Windows profile.

Only the mutex owner can issue a browser authorization. A second launcher can
signal its same-session event, but receives no port, token, or broker authority.
"""

from __future__ import annotations

import ctypes
import hashlib
import os
from pathlib import Path

from .local_profile import LocalProfileStore


ERROR_ALREADY_EXISTS = 183
EVENT_MODIFY_STATE = 0x0002
WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 0x00000102


class InstanceUnavailable(RuntimeError):
    """The profile cannot safely be owned by this process."""


class InstanceAlreadyRunning(InstanceUnavailable):
    """The exact profile already has an owner; a reopen signal may be sent."""


def _mutex_name(root: Path) -> str:
    """Use the directory, not a mutable profile ID, to name the lock.

    The Global namespace covers multiple Windows logon sessions. A digest
    avoids disclosing the private directory in the kernel object name.
    """
    canonical = os.path.normcase(os.path.abspath(root))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return "Global\\BrontideStandalone." + digest


def _reopen_event_name(root: Path, profile_id: str) -> str:
    # The mutex remains global; browser windows only reopen in the owner's
    # interactive logon session. No profile path or capability is sent in IPC.
    canonical = os.path.normcase(os.path.abspath(root))
    digest = hashlib.sha256((canonical + "\0" + profile_id).encode("utf-8")).hexdigest()
    return "Local\\BrontideStandalone.Reopen." + digest


def _kernel32():
    return ctypes.WinDLL("kernel32", use_last_error=True)


def _close_handle(handle: int) -> None:
    close_handle = _kernel32().CloseHandle
    close_handle.argtypes = [ctypes.c_void_p]
    close_handle.restype = ctypes.c_int
    if not close_handle(handle):
        raise OSError(ctypes.get_last_error(), "Could not release a Brontide instance handle.")


class WindowsStandaloneInstance:
    """Hold one named Windows mutex for the lifetime of a local service.

    ``acquire`` verifies the exact profile before and after obtaining the
    mutex. Keep the returned object alive until the service has fully stopped.
    The mutex is never forcibly stolen from another process, and process death
    releases it through the kernel without a stale PID file to trust.
    """

    def __init__(self, handle: int):
        self._handle = handle
        self._reopen_handle: int | None = None
        self.profile_id = ""

    @classmethod
    def acquire(cls, store: LocalProfileStore,
                expected_profile_id: str | None = None) -> WindowsStandaloneInstance:
        if os.name != "nt":
            raise OSError("Standalone single-instance ownership requires Windows.")
        if expected_profile_id is not None and not expected_profile_id:
            raise ValueError("An established profile ID is required.")

        kernel32 = _kernel32()
        create_mutex = kernel32.CreateMutexW
        create_mutex.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        create_mutex.restype = ctypes.c_void_p
        handle = create_mutex(None, False, _mutex_name(store.root))
        error = ctypes.get_last_error()
        if not handle:
            raise InstanceUnavailable(
                "Single-instance ownership could not be established; Brontide remains locked."
            )
        if error == ERROR_ALREADY_EXISTS:
            _close_handle(handle)
            raise InstanceAlreadyRunning(
                "Another Brontide instance may be running for this profile. "
                "Use its existing window or close it before relaunching."
            )

        instance = cls(handle)
        try:
            # Own the root mutex before creating a first-run profile. A second
            # launcher must not replace a missing profile under a live owner.
            before = store.load_or_create()
            if expected_profile_id is not None and before.profile_id != expected_profile_id:
                raise InstanceUnavailable("The local profile changed; relaunch Brontide.")
            after = store.load_or_create()
            if after.profile_id != before.profile_id:
                raise InstanceUnavailable("The local profile changed; relaunch Brontide.")
            create_event = kernel32.CreateEventW
            create_event.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                     ctypes.c_wchar_p]
            create_event.restype = ctypes.c_void_p
            event = create_event(None, False, False,
                                 _reopen_event_name(store.root, before.profile_id))
            event_error = ctypes.get_last_error()
            if not event:
                raise InstanceUnavailable("The local reopen channel could not be established.")
            if event_error == ERROR_ALREADY_EXISTS:
                _close_handle(event)
                raise InstanceUnavailable("The local reopen channel is already in use.")
            instance._reopen_handle = event
            instance.profile_id = before.profile_id
        except BaseException:
            instance.close()
            raise
        return instance

    @classmethod
    def acquire_stopped(cls, store: LocalProfileStore) -> WindowsStandaloneInstance:
        """Hold the same root mutex for offline maintenance, without launching.

        Never create a missing profile, reopen event, browser token or service.
        This guard proves only that this app's engine is not running; callers
        must separately qualify private destination permissions and restore.
        """
        if os.name != "nt":
            raise OSError("Offline maintenance ownership requires Windows.")
        before = store.read_existing()
        if before is None:
            raise InstanceUnavailable("An existing local profile is required for maintenance.")
        kernel32 = _kernel32()
        create_mutex = kernel32.CreateMutexW
        create_mutex.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        create_mutex.restype = ctypes.c_void_p
        handle = create_mutex(None, False, _mutex_name(store.root))
        error = ctypes.get_last_error()
        if not handle:
            raise InstanceUnavailable("Offline maintenance ownership could not be established.")
        if error == ERROR_ALREADY_EXISTS:
            _close_handle(handle)
            raise InstanceAlreadyRunning("Close the local Brontide service before maintenance.")
        instance = cls(handle)
        try:
            after = store.read_existing()
            if after is None or after.profile_id != before.profile_id:
                raise InstanceUnavailable("The local profile changed during maintenance setup.")
            instance.profile_id = before.profile_id
        except BaseException:
            instance.close()
            raise
        return instance

    @staticmethod
    def request_reopen(store: LocalProfileStore, expected_profile_id: str) -> bool:
        """Signal an existing owner only; never mint a token or start a service."""
        if os.name != "nt" or not expected_profile_id:
            return False
        try:
            existing = store.read_existing()
            if existing is None or existing.profile_id != expected_profile_id:
                return False
            kernel32 = _kernel32()
            open_event = kernel32.OpenEventW
            open_event.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_wchar_p]
            open_event.restype = ctypes.c_void_p
            handle = open_event(EVENT_MODIFY_STATE, False,
                                _reopen_event_name(store.root, expected_profile_id))
            if not handle:
                return False
            try:
                existing = store.read_existing()
                if existing is None or existing.profile_id != expected_profile_id:
                    return False
                set_event = kernel32.SetEvent
                set_event.argtypes = [ctypes.c_void_p]
                set_event.restype = ctypes.c_int
                return bool(set_event(handle))
            finally:
                _close_handle(handle)
        except (OSError, ValueError):
            return False

    def consume_reopen_signal(self) -> bool:
        if self._reopen_handle is None:
            raise InstanceUnavailable("The local reopen channel is unavailable.")
        wait = _kernel32().WaitForSingleObject
        wait.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        wait.restype = ctypes.c_uint32
        outcome = wait(self._reopen_handle, 0)
        if outcome == WAIT_OBJECT_0:
            return True
        if outcome == WAIT_TIMEOUT:
            return False
        raise InstanceUnavailable("The local reopen channel stopped working.")

    def close(self) -> None:
        if self._handle is None:
            return
        handle = self._handle
        self._handle = None
        try:
            if self._reopen_handle is not None:
                event = self._reopen_handle
                self._reopen_handle = None
                _close_handle(event)
        finally:
            _close_handle(handle)

    def __enter__(self) -> WindowsStandaloneInstance:
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()
