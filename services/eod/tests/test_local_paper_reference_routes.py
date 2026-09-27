"""A local owner's paper reference remains private and never grants broker authority."""

from fastapi.testclient import TestClient

from brontide_eod.local_binding import LocalBindingStore
from brontide_eod.local_paper_reference import LocalPaperReferenceStore
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_session import LocalSessionManager
from brontide_eod.standalone import create_app


ORIGIN = "http://127.0.0.1:8765"
ROUTE = "/v1/local/paper-reference"
ACCOUNT = "DU654321"


def setup(tmp_path):
    private = tmp_path / "private"
    private.mkdir()
    profile_store = LocalProfileStore(base=private)
    profile = profile_store.load_or_create()
    assets = tmp_path / "public"
    for view in ("standalone", "verification"):
        (assets / view).mkdir(parents=True)
        (assets / view / "index.html").write_text("<!doctype html>locked", encoding="utf-8")
    (assets / "_next").mkdir()
    manager = LocalSessionManager(profile.profile_id)
    client = TestClient(create_app(
        assets, port=8765, manager=manager, profile_store=profile_store,
        allow_testclient=True,
    ), base_url=ORIGIN)
    return client, manager, profile_store


def unlock(client, manager):
    response = client.post("/v1/local/session/bootstrap", headers={
        "X-Brontide-Local": "1", "Origin": ORIGIN,
        "X-Brontide-Bootstrap": manager.issue_bootstrap(),
    })
    assert response.status_code == 200
    return {"X-Brontide-Local": "1", "Origin": ORIGIN,
            "X-Brontide-CSRF": response.json()["csrf"]}


def confirmation(account=ACCOUNT):
    return {"typedAccount": account, "repeatedAccount": account,
            "checkedInIbkrPaper": True}


def test_reference_requires_local_session_csrf_exact_owner_confirmation(tmp_path):
    client, manager, profile = setup(tmp_path)
    reference = LocalPaperReferenceStore(profile)
    assert client.get(ROUTE, headers={"X-Brontide-Local": "1"}).status_code == 401
    assert client.post(ROUTE, headers={"X-Brontide-Local": "1", "Origin": ORIGIN},
                       json=confirmation()).status_code == 403
    assert client.post(ROUTE, headers={"X-Brontide-Local": "1", "Origin": ORIGIN,
                                       "X-Brontide-CSRF": "unissued"},
                       json=confirmation()).status_code == 401
    headers = unlock(client, manager)
    assert client.get(ROUTE, headers=headers).json() == {
        "recorded": False, "accountMask": None, "environment": None,
        "paperIdentityVerified": False, "executionEnabled": False,
    }
    assert client.post(ROUTE, headers={"X-Brontide-Local": "1", "Origin": ORIGIN},
                       json=confirmation()).status_code == 403
    assert client.post(ROUTE, headers={**headers, "Origin": "https://outside.invalid"},
                       json=confirmation()).status_code == 403
    for invalid in (
        {**confirmation(), "checkedInIbkrPaper": False},
        {**confirmation(), "checkedInIbkrPaper": "true"},
        {**confirmation(), "repeatedAccount": "DU123456"},
        {**confirmation(), "paperIdentityVerified": True},
        confirmation("du654321"),
    ):
        refused = client.post(ROUTE, headers=headers, json=invalid)
        assert refused.status_code in {409, 422}
        assert ACCOUNT not in refused.text
    assert not reference.path.exists()
    assert not LocalBindingStore(profile).path.exists()


def test_recorded_reference_is_masked_idempotent_and_never_binds_execution(tmp_path):
    client, manager, profile = setup(tmp_path)
    headers = unlock(client, manager)
    saved = client.post(ROUTE, headers=headers, json=confirmation())
    assert saved.status_code == 200
    assert saved.headers["cache-control"] == "no-store"
    assert saved.json() == {
        "recorded": True, "accountMask": "DU••••21", "environment": "paper",
        "paperIdentityVerified": False, "executionEnabled": False,
    }
    assert ACCOUNT not in saved.text
    reference = LocalPaperReferenceStore(profile)
    original = reference.path.read_bytes()
    assert ACCOUNT.encode() not in original
    assert client.get(ROUTE, headers=headers).json() == saved.json()
    assert client.post(ROUTE, headers=headers, json=confirmation()).json() == saved.json()
    assert reference.path.read_bytes() == original
    assert client.post(ROUTE, headers=headers,
                       json=confirmation("DU123456")).status_code == 409
    assert reference.path.read_bytes() == original
    assert not LocalBindingStore(profile).path.exists()
    assert client.post("/v1/local/account-selection", headers=headers).status_code == 503
    manager.lock()
    assert client.get(ROUTE, headers=headers).status_code == 401
    assert client.post(ROUTE, headers=headers, json=confirmation()).status_code == 401
    assert reference.path.read_bytes() == original


def test_malformed_or_large_body_never_echoes_or_records_account(tmp_path):
    client, manager, profile = setup(tmp_path)
    headers = unlock(client, manager)
    malformed = (
        '{"typedAccount":"DU654321","typedAccount":"DU654321",'
        '"repeatedAccount":"DU654321","checkedInIbkrPaper":true}'
    )
    for content in (malformed, '{"typedAccount":"DU654321"',
                    '{"typedAccount":"DU654321","repeatedAccount":null,"checkedInIbkrPaper":true}'):
        refused = client.post(ROUTE, headers={**headers, "Content-Type": "application/json"},
                              content=content)
        assert refused.status_code in {400, 409}
        assert ACCOUNT not in refused.text
    too_large = client.post(ROUTE, headers={**headers, "Content-Type": "application/json"},
                            content='{"typedAccount":"' + ACCOUNT + '"}' + " " * 300)
    assert too_large.status_code == 413
    assert ACCOUNT not in too_large.text
    assert not LocalPaperReferenceStore(profile).path.exists()


def test_existing_account_choice_without_owner_reference_fails_closed(
        tmp_path, monkeypatch):
    client, manager, profile = setup(tmp_path)
    headers = unlock(client, manager)
    monkeypatch.setattr(LocalBindingStore, "load", lambda self, profile_id: object())
    status = client.get(ROUTE, headers=headers)
    assert status.status_code == 409
    assert ACCOUNT not in status.text
    save = client.post(ROUTE, headers=headers, json=confirmation())
    assert save.status_code == 409
    assert ACCOUNT not in save.text
    assert not LocalPaperReferenceStore(profile).path.exists()
