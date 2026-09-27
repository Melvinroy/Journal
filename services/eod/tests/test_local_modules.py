"""Built-in view preferences never grant broker execution authority."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event

import pytest
from fastapi.testclient import TestClient

from brontide_eod.local_binding import (BrokerAccountObservation, LocalBindingError,
                                        LocalBindingStore)
from brontide_eod.local_modules import LocalModulePreferencesStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import create_app


def _profile(tmp_path):
    base = tmp_path / "private"
    base.mkdir()
    profile_store = LocalProfileStore(base=base)
    profile = profile_store.load_or_create()
    return profile_store, profile


def _observation(now):
    return BrokerAccountObservation(
        "generation-1234567890", "a" * 64, ("DU123456",), "paper",
        True, True, True, now,
    )


def test_default_and_saved_views_leave_profile_v1_unchanged(tmp_path):
    profile_store, profile = _profile(tmp_path)
    modules = LocalModulePreferencesStore(profile_store)
    original_profile = profile_store.path.read_bytes()
    assert modules.load(profile.profile_id).public_status() == {
        "enabledViews": ["trading", "journal"], "executionEnabled": False,
    }
    assert not modules.path.exists()
    saved = modules.save(profile.profile_id, ["journal"])
    assert saved.enabled_views == ("journal",)
    assert profile_store.path.read_bytes() == original_profile
    assert LocalModulePreferencesStore(profile_store).load(profile.profile_id) == saved
    assert modules.save(profile.profile_id, ["journal", "trading"]).enabled_views == (
        "trading", "journal",
    )


@pytest.mark.parametrize("views", [[], ["trading", "trading"], ["other"],
                                   ["trading", "journal", "other"], "trading"])
def test_invalid_selection_never_replaces_saved_views(tmp_path, views):
    profile_store, profile = _profile(tmp_path)
    modules = LocalModulePreferencesStore(profile_store)
    modules.save(profile.profile_id, ["journal"])
    original = modules.path.read_bytes()
    with pytest.raises(ValueError, match="Select one or both"):
        modules.save(profile.profile_id, views)
    assert modules.path.read_bytes() == original


@pytest.mark.parametrize("raw", [
    '{"schemaVersion":1,"profileId":"other","enabledViews":["journal"]}',
    '{"schemaVersion":1,"schemaVersion":1,"profileId":"other","enabledViews":["journal"]}',
    '{"schemaVersion":2,"profileId":"other","enabledViews":["journal"]}',
    '{"broken":true}',
])
def test_corrupt_or_foreign_preferences_fail_closed(tmp_path, raw):
    profile_store, profile = _profile(tmp_path)
    modules = LocalModulePreferencesStore(profile_store)
    modules.path.write_text(raw, encoding="utf-8")
    with pytest.raises(ValueError):
        modules.load(profile.profile_id)
    assert modules.path.read_text(encoding="utf-8") == raw


def test_paper_binding_and_hidden_trading_are_mutually_exclusive(tmp_path):
    profile_store, profile = _profile(tmp_path)
    modules = LocalModulePreferencesStore(profile_store)
    binding = LocalBindingStore(profile_store,
                                clock=lambda: datetime(2026, 9, 25, tzinfo=timezone.utc))
    modules.save(profile.profile_id, ["journal"])
    with pytest.raises(LocalBindingError, match="Show Trading"):
        binding.confirm(profile.profile_id, "DU123456", "DU123456",
                        _observation(datetime(2026, 9, 25, tzinfo=timezone.utc)))
    assert not binding.path.exists()
    modules.save(profile.profile_id, ["trading", "journal"])
    LocalPaperReferenceStore(profile_store).record_owner_attested(
        profile.profile_id, "DU123456")
    binding.confirm(profile.profile_id, "DU123456", "DU123456",
                    _observation(datetime(2026, 9, 25, tzinfo=timezone.utc)))
    original = modules.path.read_bytes()
    with pytest.raises(ValueError, match="exposure is unresolved"):
        modules.save(profile.profile_id, ["journal"])
    assert modules.path.read_bytes() == original


def test_module_routes_require_local_session_and_csrf(tmp_path):
    profile_store, profile = _profile(tmp_path)
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store, allow_testclient=True),
                        base_url="http://127.0.0.1:8765")
    local = {"X-Brontide-Local": "1"}
    assert client.get("/v1/local/modules", headers=local).status_code == 401
    assert client.put("/v1/local/modules", headers=local,
                      json={"enabledViews": ["journal"]}).status_code == 403
    token = manager.issue_bootstrap()
    response = client.post("/v1/local/session/bootstrap", headers={
        **local, "Origin": "http://127.0.0.1:8765", "X-Brontide-Bootstrap": token,
    })
    csrf = response.json()["csrf"]
    headers = {**local, "Origin": "http://127.0.0.1:8765",
               "X-Brontide-CSRF": csrf}
    status = client.get("/v1/local/modules", headers=local)
    assert status.status_code == 200
    assert status.headers["cache-control"] == "no-store"
    assert status.json() == {"enabledViews": ["trading", "journal"],
                             "executionEnabled": False, "canHideTrading": True}
    assert client.put("/v1/local/modules", headers=local,
                      json={"enabledViews": ["journal"]}).status_code == 403
    assert client.put("/v1/local/modules", headers={**headers,
        "Origin": "https://outside.invalid"},
        json={"enabledViews": ["journal"]}).status_code == 403
    changed = client.put("/v1/local/modules", headers=headers,
                         json={"enabledViews": ["journal"]})
    assert changed.status_code == 200
    assert changed.json() == {"enabledViews": ["journal"],
                              "executionEnabled": False, "canHideTrading": True}
    assert client.put("/v1/local/modules", headers=headers,
                      json={"enabledViews": []}).status_code == 409
    assert client.put("/v1/local/modules", headers=headers,
                      json={"enabledViews": ["journal"], "executionEnabled": True}
                      ).status_code == 422
    manager.lock()
    assert client.get("/v1/local/modules", headers=local).status_code == 401
    assert client.put("/v1/local/modules", headers=headers,
                      json={"enabledViews": ["trading"]}).status_code == 401
    assert json.loads(LocalModulePreferencesStore(profile_store).path.read_text())[
        "enabledViews"] == ["journal"]


def test_module_save_finishes_before_concurrent_session_lock(tmp_path, monkeypatch):
    profile_store, profile = _profile(tmp_path)
    assets = tmp_path / "public"
    (assets / "standalone").mkdir(parents=True)
    (assets / "standalone" / "index.html").write_text("<!doctype html>sample")
    (assets / "verification").mkdir()
    (assets / "verification" / "index.html").write_text("<!doctype html>evidence")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(assets, port=8765, manager=manager,
                                   profile_store=profile_store, allow_testclient=True),
                        base_url="http://127.0.0.1:8765")
    local = {"X-Brontide-Local": "1"}
    token = manager.issue_bootstrap()
    csrf = client.post("/v1/local/session/bootstrap", headers={
        **local, "Origin": "http://127.0.0.1:8765", "X-Brontide-Bootstrap": token,
    }).json()["csrf"]
    headers = {**local, "Origin": "http://127.0.0.1:8765", "X-Brontide-CSRF": csrf}
    entered, release, lock_started, lock_done = Event(), Event(), Event(), Event()
    original_save = LocalModulePreferencesStore.save

    def slow_save(self, *args):
        entered.set()
        assert release.wait(5)
        return original_save(self, *args)

    monkeypatch.setattr(LocalModulePreferencesStore, "save", slow_save)

    def lock_session():
        lock_started.set()
        manager.lock()
        lock_done.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(client.put, "/v1/local/modules", headers=headers,
                              json={"enabledViews": ["journal"]})
        assert entered.wait(5)
        locked = pool.submit(lock_session)
        assert lock_started.wait(5)
        try:
            # A completed lock must not precede a write from its old session.
            assert not lock_done.wait(.2)
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200
        locked.result(timeout=5)
    assert lock_done.is_set()
    assert LocalModulePreferencesStore(profile_store).load(
        profile.profile_id).enabled_views == ("journal",)
