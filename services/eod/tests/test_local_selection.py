"""Account selection is session-bound and cannot turn discovery into authority."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from threading import Event

import pytest
from fastapi import HTTPException

from brontide_eod.local_binding import (
    BrokerAccountObservation, LocalBindingError, LocalBindingStore,
)
from brontide_eod.local_discovery import ManagedAccountDiscovery
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_selection import LocalAccountSelection
from brontide_eod.local_session import LocalSessionManager


NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
ACCOUNTS = ("DU123456", "DU654321")
GENERATION = "generation-1234567890"
SOURCE = "a" * 64


def setup(tmp_path, *, session_seconds=1800, paper_account="DU123456",
          create_reference=True):
    profile_store = LocalProfileStore(base=tmp_path)
    profile = profile_store.load_or_create()
    seconds = [100.0]
    session = LocalSessionManager(profile.profile_id, clock=lambda: seconds[0],
                                  session_seconds=session_seconds)
    binding = LocalBindingStore(profile_store, clock=lambda: NOW)
    reference = LocalPaperReferenceStore(profile_store, clock=lambda: NOW)
    if create_reference:
        reference.record_owner_attested(profile.profile_id, paper_account)
    selection = LocalAccountSelection(session, binding, reference, clock=lambda: NOW,
                                      monotonic=lambda: seconds[0])
    cookie, csrf = session.consume_bootstrap(session.issue_bootstrap())
    discovery = ManagedAccountDiscovery(GENERATION, SOURCE, ACCOUNTS,
                                        (NOW - timedelta(seconds=2)).isoformat())
    observation = BrokerAccountObservation(GENERATION, SOURCE, ACCOUNTS,
        "paper", True, True, True, NOW - timedelta(seconds=1))
    return session, binding, selection, seconds, cookie, csrf, discovery, observation


def test_only_correlated_paper_evidence_can_save_exact_choice(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(
        tmp_path, paper_account="DU654321")
    public = selection.begin(cookie, csrf, discovery)
    assert public["candidates"] == [
        {"index": 0, "mask": "DU••••56"}, {"index": 1, "mask": "DU••••21"},
    ]
    assert public["paperIdentityVerified"] is False
    assert public["executionEnabled"] is False
    assert "DU123456" not in str(public) and "DU654321" not in str(public)
    assert not binding.path.exists()
    status = selection.confirm(cookie, csrf, public["selectionId"], 1,
                               "DU654321", observation)
    assert status["accountMask"] == "DU••••21"
    assert status["connectionVerified"] is False
    assert status["reconciliationRequired"] is True
    assert status["executionEnabled"] is False
    assert "DU654321" not in binding.path.read_text(encoding="utf-8")
    with pytest.raises(LocalBindingError, match="expired"):
        selection.confirm(cookie, csrf, public["selectionId"], 1,
                          "DU654321", observation)


@pytest.mark.parametrize("change", [
    {"paper_identity_verified": False},
    {"sdk_compatible": False},
    {"api_usable": False},
    {"environment": "live"},
    {"connection_generation": "generation-9999999999"},
    {"source_binding": "b" * 64},
    {"accounts": ("DU654321", "DU123456")},
    {"observed_at": NOW - timedelta(seconds=31)},
    {"observed_at": NOW - timedelta(seconds=3)},
])
def test_unverified_changed_or_stale_observation_never_binds(tmp_path, change):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    with pytest.raises(LocalBindingError):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", replace(observation, **change))
    assert not binding.path.exists()


def test_expiry_wrong_account_and_profile_change_do_not_write(tmp_path):
    _, binding, selection, seconds, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    with pytest.raises(LocalBindingError, match="exact observed account"):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU654321", observation)
    assert not binding.path.exists()
    review = selection.begin(cookie, csrf, discovery)
    seconds[0] += 31
    with pytest.raises(LocalBindingError, match="expired"):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert not binding.path.exists()
    seconds[0] = 100
    review = selection.begin(cookie, csrf, discovery)
    binding.profile_store.path.write_text("broken", encoding="utf-8")
    with pytest.raises((OSError, ValueError)):
        selection.begin(cookie, csrf, discovery)
    with pytest.raises(LocalBindingError):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert not binding.path.exists()


def test_colliding_masks_require_an_exact_observed_owner_account(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(
        tmp_path, paper_account="DU999956")
    accounts = ("DU123456", "DU999956")
    discovery = replace(discovery, accounts=accounts)
    observation = replace(observation, accounts=accounts)
    review = selection.begin(cookie, csrf, discovery)
    assert [candidate["mask"] for candidate in review["candidates"]] == [
        "DU••••56", "DU••••56"]
    with pytest.raises(LocalBindingError, match="exact observed account"):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU888856", observation)
    assert not binding.path.exists()
    review = selection.begin(cookie, csrf, discovery)
    with pytest.raises(LocalBindingError, match="owner-confirmed paper reference"):
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert not binding.path.exists()
    review = selection.begin(cookie, csrf, discovery)
    saved = selection.confirm(cookie, csrf, review["selectionId"], 0,
                              "DU999956", observation)
    assert saved["remembered"] is True
    assert saved["executionEnabled"] is False
    assert binding.load(binding.profile_store._read().profile_id).matches_exact_account(
        "DU999956") is True
    assert binding.load(binding.profile_store._read().profile_id).matches_exact_account(
        "DU123456") is False


def test_relaunch_and_lock_reject_old_selection_without_consuming_new_session(tmp_path):
    session, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    new_cookie, new_csrf = session.consume_bootstrap(session.issue_bootstrap())
    with pytest.raises(HTTPException) as old:
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert old.value.status_code == 401
    with pytest.raises(HTTPException) as changed:
        selection.confirm(new_cookie, new_csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert changed.value.status_code == 409
    assert not binding.path.exists()
    fresh = selection.begin(new_cookie, new_csrf, discovery)
    session.lock()
    with pytest.raises(HTTPException) as locked:
        selection.confirm(new_cookie, new_csrf, fresh["selectionId"], 0,
                          "DU123456", observation)
    assert locked.value.status_code == 401
    assert not binding.path.exists()


def test_real_session_expiry_rejects_pending_selection(tmp_path):
    session, binding, selection, seconds, cookie, csrf, discovery, observation = setup(
        tmp_path, session_seconds=5)
    review = selection.begin(cookie, csrf, discovery)
    seconds[0] += 6
    with pytest.raises(HTTPException) as expired:
        selection.confirm(cookie, csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert expired.value.status_code == 401
    assert not binding.path.exists()


def test_unauthenticated_attempt_does_not_replace_valid_pending_choice(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    with pytest.raises(HTTPException):
        selection.begin("invalid", csrf, discovery)
    with pytest.raises(HTTPException):
        selection.confirm("invalid", csrf, review["selectionId"], 0,
                          "DU123456", observation)
    assert not binding.path.exists()
    assert selection.confirm(cookie, csrf, review["selectionId"], 0,
                             "DU123456", observation)["remembered"] is True


def test_authenticated_failed_rediscovery_invalidates_previous_review(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    previous = selection.begin(cookie, csrf, discovery)
    with pytest.raises(LocalBindingError, match="invalid"):
        selection.begin(cookie, csrf, replace(discovery, accounts=("DU123456", "DU123456")))
    with pytest.raises(LocalBindingError, match="expired"):
        selection.confirm(cookie, csrf, previous["selectionId"], 0,
                          "DU123456", observation)
    assert not binding.path.exists()


def test_competing_confirmations_write_only_one_bound_choice(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)

    def choose(index):
        try:
            return selection.confirm(cookie, csrf, review["selectionId"], index,
                                     ACCOUNTS[index], observation)
        except LocalBindingError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(choose, (0, 1)))
    assert len([result for result in results if result is not None]) == 1
    assert binding.load(binding.profile_store._read().profile_id).account_mask == "DU••••56"


def test_missing_owner_reference_blocks_even_correlated_paper_claim(tmp_path):
    _, binding, selection, _, cookie, csrf, discovery, observation = setup(
        tmp_path, create_reference=False)
    with pytest.raises(LocalBindingError, match="owner-confirmed paper account"):
        selection.begin(cookie, csrf, discovery)
    assert not binding.path.exists()


def test_session_cannot_relaunch_midway_through_binding_write(tmp_path, monkeypatch):
    session, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    entered = Event()
    release = Event()
    locked = Event()
    original = binding.confirm

    def delayed_confirm(*args):
        entered.set()
        assert release.wait(5)
        return original(*args)

    monkeypatch.setattr(binding, "confirm", delayed_confirm)

    def lock_session():
        session.lock()
        locked.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        confirmation = pool.submit(selection.confirm, cookie, csrf,
                                   review["selectionId"], 0, "DU123456", observation)
        assert entered.wait(2)
        locking = pool.submit(lock_session)
        assert not locked.wait(.05)
        release.set()
        assert confirmation.result(timeout=5)["remembered"] is True
        locking.result(timeout=5)
    assert locked.is_set()


def test_browser_lock_during_server_evidence_read_prevents_binding(tmp_path):
    session, binding, selection, _, cookie, csrf, discovery, observation = setup(tmp_path)
    review = selection.begin(cookie, csrf, discovery)
    entered = Event()
    release = Event()

    def read_evidence(_discovery):
        entered.set()
        assert release.wait(5)
        return observation

    with ThreadPoolExecutor(max_workers=2) as pool:
        confirmation = pool.submit(selection.confirm, cookie, csrf,
                                   review["selectionId"], 0, "DU123456", read_evidence)
        assert entered.wait(2)
        locking = pool.submit(session.lock)
        locking.result(timeout=2)  # Lock must not wait for the broker read.
        release.set()
        with pytest.raises(HTTPException) as locked:
            confirmation.result(timeout=5)
    assert locked.value.status_code == 401
    assert not binding.path.exists()
