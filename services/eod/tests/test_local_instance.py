"""Synthetic single-instance checks; no active Brontide profile is accessed."""

import os
import subprocess
import sys

import pytest

from brontide_eod.local_instance import InstanceUnavailable, WindowsStandaloneInstance
from brontide_eod.local_profile import LocalProfileStore


pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows named mutex")


def test_same_profile_cannot_start_second_instance_and_releases_on_close(tmp_path):
    store = LocalProfileStore(base=tmp_path)
    profile = store.load_or_create()
    with WindowsStandaloneInstance.acquire(store, profile.profile_id):
        with pytest.raises(InstanceUnavailable, match="Another Brontide instance"):
            WindowsStandaloneInstance.acquire(store, profile.profile_id)
    with WindowsStandaloneInstance.acquire(store, profile.profile_id) as second:
        second.close()  # Repeated close is harmless.


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
