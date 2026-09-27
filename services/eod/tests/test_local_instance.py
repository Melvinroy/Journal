"""Synthetic single-instance checks; no active Brontide profile is accessed."""

import ctypes
import os
import subprocess
import sys

import pytest

from brontide_eod.local_instance import (
    InstanceAlreadyRunning, InstanceUnavailable, WindowsStandaloneInstance,
    _reopen_event_name,
)
from brontide_eod.local_profile import LocalProfileStore


pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows named mutex")


def test_same_profile_cannot_start_second_instance_and_releases_on_close(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        with pytest.raises(InstanceAlreadyRunning, match="Another Brontide instance"):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as second:
        second.close()  # Repeated close is harmless.


def test_offline_maintenance_never_creates_profile_or_coexists_with_service(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    with pytest.raises(InstanceUnavailable, match="existing local profile"):
        WindowsStandaloneInstance.acquire_stopped(store)
    assert store.read_existing() is None
    profile = store.load_or_create()
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        with pytest.raises(InstanceAlreadyRunning, match="Close the local Brontide"):
            WindowsStandaloneInstance.acquire_stopped(store)
    with WindowsStandaloneInstance.acquire_stopped(store) as maintenance:
        assert maintenance.profile_id == profile.profile_id
        with pytest.raises(InstanceAlreadyRunning):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
        assert not WindowsStandaloneInstance.request_reopen(store, profile.profile_id)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        pass


def test_first_instance_creates_profile_only_after_acquiring_owner(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    assert store.read_existing() is None
    with WindowsStandaloneInstance.acquire(store) as owner:
        assert owner.profile_id == store.read_existing().profile_id
        assert not owner.consume_reopen_signal()


def test_second_launch_sends_only_a_one_bit_reopen_request(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    wrong_id = "local-00000000-0000-4000-8000-000000000001"
    assert not WindowsStandaloneInstance.request_reopen(store, profile.profile_id)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as owner:
        assert not owner.consume_reopen_signal()
        assert not WindowsStandaloneInstance.request_reopen(store, wrong_id)
        with pytest.raises(InstanceAlreadyRunning):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
        assert WindowsStandaloneInstance.request_reopen(store, profile.profile_id)
        assert owner.consume_reopen_signal()
        assert not owner.consume_reopen_signal()
    assert not WindowsStandaloneInstance.request_reopen(store, profile.profile_id)


def test_other_process_can_signal_owner_without_receiving_session_data(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    requester = (
        "import sys\n"
        "from pathlib import Path\n"
        "from brontide_eod.local_profile import LocalProfileStore\n"
        "from brontide_eod.local_instance import WindowsStandaloneInstance\n"
        "store = LocalProfileStore(base=Path(sys.argv[1]))\n"
        "print('SENT' if WindowsStandaloneInstance.request_reopen(store, sys.argv[2]) "
        "else 'REFUSED')\n"
    )
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as owner:
        completed = subprocess.run(
            [sys.executable, "-c", requester, str(tmp_path), profile.profile_id],
            capture_output=True, text=True, timeout=10, check=True,
        )
        assert completed.stdout.strip() == "SENT"
        assert completed.stderr == ""
        assert owner.consume_reopen_signal()
        assert not owner.consume_reopen_signal()


def test_preexisting_reopen_event_prevents_owner_start_and_releases_mutex(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_event = kernel32.CreateEventW
    create_event.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                             ctypes.c_wchar_p]
    create_event.restype = ctypes.c_void_p
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [ctypes.c_void_p]
    close_handle.restype = ctypes.c_int
    event = create_event(None, False, False,
                         _reopen_event_name(store.root, profile.profile_id))
    assert event
    try:
        with pytest.raises(InstanceUnavailable, match="reopen channel is already in use"):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
    finally:
        assert close_handle(event)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        pass


def test_different_private_profile_directory_has_independent_owner(tmp_path):
    left = LocalProfileStore(base=tmp_path / "left")
    right = LocalProfileStore(base=tmp_path / "right")
    left.base.mkdir()
    right.base.mkdir()
    left_id = left.load_or_create().profile_id
    right_id = right.load_or_create().profile_id
    with WindowsStandaloneInstance.acquire(left, left_id):
        with WindowsStandaloneInstance.acquire(right, right_id):
            pass


def test_wrong_or_changed_profile_never_acquires_owner(tmp_path, monkeypatch):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    with pytest.raises(InstanceUnavailable, match="profile changed"):
        WindowsStandaloneInstance.acquire(store, "local-00000000-0000-4000-8000-000000000001")

    original = store.load_or_create
    calls = 0

    def changed_on_second_read():
        nonlocal calls
        calls += 1
        if calls == 2:
            return type(profile)("local-00000000-0000-4000-8000-000000000001", "connect")
        return original()

    monkeypatch.setattr(store, "load_or_create", changed_on_second_read)
    with pytest.raises(InstanceUnavailable, match="profile changed"):
        WindowsStandaloneInstance.acquire(store, profile.profile_id)
    monkeypatch.setattr(store, "load_or_create", original)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        pass


def test_other_process_holding_profile_prevents_second_manager(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    worker = (
        "import sys\n"
        "from pathlib import Path\n"
        "from brontide_eod.local_profile import LocalProfileStore\n"
        "from brontide_eod.local_instance import WindowsStandaloneInstance\n"
        "store = LocalProfileStore(base=Path(sys.argv[1]))\n"
        "with WindowsStandaloneInstance.acquire(store, sys.argv[2]):\n"
        "    print('READY', flush=True)\n"
        "    sys.stdin.readline()\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-c", worker, str(tmp_path), profile.profile_id],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "READY"
        with pytest.raises(InstanceUnavailable, match="Another Brontide instance"):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
    finally:
        assert process.stdin is not None
        process.stdin.write("\n")
        process.stdin.flush()
        process.communicate(timeout=10)
    assert process.returncode == 0
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        pass


def test_kernel_releases_instance_guard_after_owner_process_exits_abruptly(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    worker = (
        "import sys, time\n"
        "from pathlib import Path\n"
        "from brontide_eod.local_profile import LocalProfileStore\n"
        "from brontide_eod.local_instance import WindowsStandaloneInstance\n"
        "store = LocalProfileStore(base=Path(sys.argv[1]))\n"
        "with WindowsStandaloneInstance.acquire(store, sys.argv[2]):\n"
        "    print('READY', flush=True)\n"
        "    time.sleep(60)\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-c", worker, str(tmp_path), profile.profile_id],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "READY"
        with pytest.raises(InstanceUnavailable, match="Another Brontide instance"):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
    finally:
        process.kill()
        process.communicate(timeout=10)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        pass
