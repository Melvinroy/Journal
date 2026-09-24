"""Fail-closed ownership guard for a standalone Windows profile directory.

This guard is deliberately separate from browser authorization. A second
launcher cannot infer an existing service's port or mint a session merely by
finding an occupied port. Until an authenticated inter-process handoff exists,
the second launch stops without opening a browser or starting another manager.
"""

from __future__ import annotations

import ctypes
import hashlib
import os
from pathlib import Path

from .local_profile import LocalProfileStore


ERROR_ALREADY_EXISTS = 183


class InstanceUnavailable(RuntimeError):
    """The profile cannot safely be owned by this process."""


def _mutex_name(root: Path) -> str:
    """Use the directory, not a mutable profile ID, to name the lock.

    The Global namespace covers multiple Windows logon sessions. A digest
    avoids disclosing the private directory in the kernel object name.
    """
    canonical = os.path.normcase(os.path.abspath(root))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return "Global\\BrontideStandalone." + digest


class WindowsStandaloneInstance:
    """Hold one named Windows mutex for the lifetime of a local service.

    ``acquire`` verifies the exact profile before and after obtaining the
    mutex. Keep the returned object alive until the service has fully stopped.
    The mutex is never forcibly stolen from another process, and process death
    releases it through the kernel without a stale PID file to trust.
    """

    def __init__(self, handle: int):
        self._handle = handle

    @classmethod
    def acquire(cls, store: LocalProfileStore, expected_profile_id: str) -> WindowsStandaloneInstance:
        if os.name != "nt":
            raise OSError("Standalone single-instance ownership requires Windows.")
        if not expected_profile_id:
            raise ValueError("An established profile ID is required.")
        before = store.load_or_create()
        if before.profile_id != expected_profile_id:
            raise InstanceUnavailable("The local profile changed; relaunch Brontide.")

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        create_mutex = kernel32.CreateMutexW
        create_mutex.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        create_mutex.restype = ctypes.c_void_p
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = [ctypes.c_void_p]
        close_handle.restype = ctypes.c_int

        handle = create_mutex(None, False, _mutex_name(store.root))
        error = ctypes.get_last_error()
        if not handle:
            raise InstanceUnavailable(
                "Single-instance ownership could not be established; Brontide remains locked."
            )
        if error == ERROR_ALREADY_EXISTS:
            close_handle(handle)
            raise InstanceUnavailable(
                "Another Brontide instance may be running for this profile. "
                "Use its existing window or close it before relaunching."
            )

        instance = cls(handle)
        try:
            after = store.load_or_create()
            if after.profile_id != expected_profile_id:
                raise InstanceUnavailable("The local profile changed; relaunch Brontide.")
        except BaseException:
            instance.close()
            raise
        return instance

    def close(self) -> None:
        if self._handle is None:
            return
        handle = self._handle
        self._handle = None
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = [ctypes.c_void_p]
        close_handle.restype = ctypes.c_int
        if not close_handle(handle):
            raise OSError(ctypes.get_last_error(), "Could not release Brontide instance ownership.")

    def __enter__(self) -> WindowsStandaloneInstance:
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()
