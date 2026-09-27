"""Locked, loopback-only entry point for the modular desktop candidate.

This deliberately does not mount the cloud-backed paper router or broker adapter.
The launcher capability authenticates a browser to the local shell only; it never
grants permission to submit an order.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
from html.parser import HTMLParser
import os
import re
import socket
import stat
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Callable, Literal, Protocol
from urllib.parse import urlsplit

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from .local_profile import LocalProfileStore, SelectedView
from .local_verification import VerificationProfileStore, VERIFICATION_LABEL
from .local_binding import (BrokerAccountObservation, LocalBindingError,
                            LocalBindingStore, LocalPaperBinding)
from .local_discovery import ManagedAccountDiscovery
from .local_modules import LocalModulePreferencesStore
from .local_journal import (LocalJournalUnavailable, LocalRecordedJournalSource,
                            RECORDED_DIRECTORY)
from .local_instance import InstanceAlreadyRunning, InstanceUnavailable, WindowsStandaloneInstance
from .local_sdk import inspect_sdk_metadata
from .local_selection import LocalAccountSelection
from .local_paper_reference import LocalPaperReferenceStore
from .local_plan_store import LocalPlanUnavailable, LocalSavedPlanStore
from .local_session import COOKIE_NAME, CSRF_HEADER, LocalSessionManager, local_session_router
from .security_headers import script_policy


HOST = "127.0.0.1"
_LAUNCH_SCRIPT = """(()=>{const prefix='#bootstrap=';const fragment=location.hash;history.replaceState(null,'',location.pathname);const message=document.getElementById('message');if(!fragment.startsWith(prefix)){message.textContent='Launch Brontide from its desktop shortcut.';return;}let token;try{token=decodeURIComponent(fragment.slice(prefix.length));}catch{message.textContent='The launch authorization is invalid.';return;}fetch('/v1/local/session/bootstrap',{method:'POST',credentials:'same-origin',headers:{'X-Brontide-Local':'1','X-Brontide-Bootstrap':token}}).then(response=>{token='';if(!response.ok)throw Error('expired');location.replace('/standalone/');}).catch(()=>{token='';message.textContent='The launch authorization expired. Open Brontide from its desktop shortcut again.';});})();"""


class ViewChoice(BaseModel):
    view: SelectedView


class ModuleChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabledViews: list[Literal["trading", "journal"]]


class AccountConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selectionId: str
    index: StrictInt
    typedAccount: str


class ExactAccountCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    typedAccount: StrictStr


class LocalPlanRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    savedPlan: dict[str, object]
    expectedRevision: str | None = None
    expectedScopeId: str
    expectedActiveRevision: str | None = None


class LocalAccountEvidence(Protocol):
    """Server-owned, bounded broker reads; browser data is never evidence."""

    def discover(self) -> ManagedAccountDiscovery: ...

    def corroborate(self, discovery: ManagedAccountDiscovery) -> BrokerAccountObservation: ...


class LocalJournalReader(Protocol):
    """Read-only fixture projection; the installed launcher does not supply one."""

    def read(self, principal_profile_id: str) -> dict: ...


class _AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # Browsers use the first occurrence of a duplicate HTML attribute,
        # while dict(attrs) keeps the last. Reject ambiguity before deciding
        # which resource the packaged page can load.
        names = [name for name, _value in attrs]
        if len(names) != len(set(names)):
            raise ValueError("Standalone frontend contains duplicate HTML attributes.")
        attributes = dict(attrs)
        resource_link = tag == "link" and bool(set(
            (attributes.get("rel") or "").lower().split()
        ) & {"stylesheet", "preload", "modulepreload", "prefetch", "preconnect",
             "dns-prefetch", "icon", "manifest"})
        value = attributes.get("src") if tag == "script" else (
            attributes.get("href") if resource_link else None
        )
        if value is None:
            return  # Inline scripts are checked by the response CSP.
        parsed = urlsplit(value)
        path_is_packaged = parsed.path == "/favicon.svg" or bool(re.fullmatch(
            r"/_next/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*",
            parsed.path,
        ))
        if (not value.startswith("/") or value.startswith("//") or parsed.scheme
                or parsed.netloc or parsed.query or parsed.fragment
                or not path_is_packaged):
            raise ValueError("Standalone frontend references an external or unlisted resource.")
        self.paths.add(parsed.path)


def validate_assets(assets: Path) -> Path:
    """Require the Trading shell, its read-only evidence page, and local assets."""
    def reject_link(path: Path) -> None:
        attributes = getattr(path.lstat(), "st_file_attributes", 0)
        if path.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise ValueError("Standalone frontend contains a linked asset.")

    reject_link(assets)
    root = assets.resolve(strict=True)
    # StaticFiles must only serve files contained in the reviewed package. A
    # linked chunk, stylesheet or route directory could otherwise resolve to
    # content outside the archive after installation.
    for directory, subdirectories, files in os.walk(root, followlinks=False):
        reject_link(Path(directory))
        for name in [*subdirectories, *files]:
            reject_link(Path(directory) / name)
    page = root / "standalone" / "index.html"
    verification = root / "verification" / "index.html"
    if not page.is_file() or not verification.is_file() or not (root / "_next").is_dir():
        raise ValueError("A built standalone frontend is required.")
    references = _AssetReferences()
    references.feed(page.read_text(encoding="utf-8"))
    references.feed(verification.read_text(encoding="utf-8"))
    for path in references.paths:
        if path.startswith("/_next/") or path == "/favicon.svg":
            if not (root / path.lstrip("/")).is_file():
                raise ValueError(f"Standalone frontend asset is missing: {path}")
    for unexpected in root.iterdir():
        if unexpected.name not in {"standalone", "verification", "_next", "favicon.svg"}:
            raise ValueError("Standalone package contains an unrelated exported route.")
    return root


def candidate_diagnostics(assets: Path, profile_store: LocalProfileStore | None) -> dict[str, object]:
    """Build a user-reviewed support summary without exposing private values.

    This probe neither creates a profile nor starts the service. Errors are
    reduced to fixed status labels so paths and file contents stay private.
    """
    profile_status = "unavailable-or-incompatible"
    if profile_store is not None:
        try:
            profile_store.check_locked_sample_update()
            profile_status = "compatible-or-not-created"
        except (OSError, ValueError):
            pass
    try:
        validate_assets(assets)
        asset_status = "valid"
    except (OSError, ValueError, UnicodeError):
        asset_status = "unavailable-or-invalid"
    return {
        "schemaVersion": 1,
        "candidate": "locked-verification" if isinstance(profile_store, VerificationProfileStore) else "locked-sample",
        **({"verificationProfile": True} if isinstance(profile_store, VerificationProfileStore) else {}),
        "executionEnabled": False,
        "brokerConnection": "not-available",
        "profileSchema": profile_status,
        "packagedAssets": asset_status,
    }


def _hash_script(script: str) -> str:
    encoded = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    return f"'sha256-{encoded}'"


def _open_local_browser(manager: LocalSessionManager, port: int,
                        opener: Callable[[str], bool] = webbrowser.open) -> bool:
    """Ask this owning process to authorize one browser; never log the token."""
    capability = manager.issue_bootstrap()
    try:
        return bool(opener(f"http://{HOST}:{port}/launch#bootstrap={capability}"))
    except Exception:
        return False


def create_app(assets: Path, *, port: int, manager: LocalSessionManager,
               profile_store: LocalProfileStore | None = None,
               journal_source: LocalJournalReader | None = None,
               account_evidence: LocalAccountEvidence | None = None,
               allow_testclient: bool = False) -> FastAPI:
    """Serve only the reviewed static shell and non-trading local-session API."""
    root = validate_assets(assets)
    if journal_source is not None and not allow_testclient:
        raise ValueError("Synthetic Journal source is available only in isolated tests.")
    if account_evidence is not None and profile_store is None:
        raise ValueError("Account selection requires private profile storage.")
    verification = profile_store if isinstance(profile_store, VerificationProfileStore) else None
    if verification is not None and (journal_source is not None or account_evidence is not None):
        raise ValueError("Verification uses only its isolated artificial ledger; broker evidence is unavailable.")
    if profile_store is not None and profile_store.root.resolve().is_relative_to(root):
        raise ValueError("Private profile storage must be outside served assets.")
    if not 1 <= port <= 65535:
        raise ValueError("A valid loopback port is required.")
    origin = f"http://{HOST}:{port}"
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        def apply_common_headers(response):
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
            if request.url.path.startswith("/v1/") or request.url.path == "/launch":
                response.headers["Cache-Control"] = "no-store"
            return response

        peer = request.client.host if request.client else None
        allowed_peers = {HOST, "::1", "testclient"} if allow_testclient else {HOST, "::1"}
        if peer not in allowed_peers or request.headers.get("host") != f"{HOST}:{port}":
            return apply_common_headers(JSONResponse({"detail": "Local browser access only."}, status_code=403))
        supplied_origin = request.headers.get("origin")
        if supplied_origin and supplied_origin != origin:
            return apply_common_headers(JSONResponse({"detail": "Cross-origin access is not permitted."}, status_code=403))
        response = apply_common_headers(await call_next(request))
        if "text/html" in response.headers.get("content-type", ""):
            marker = root / "standalone" / "index.html"
            evidence_marker = root / "verification" / "index.html"
            built_scripts = script_policy(str(root),
                                          (marker.stat().st_mtime_ns,
                                           evidence_marker.stat().st_mtime_ns))
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; " + built_scripts + " " + _hash_script(_LAUNCH_SCRIPT)
                + "; style-src 'self' 'unsafe-inline'; connect-src 'self'; "
                "img-src 'self' data: blob:; font-src 'self' data:; "
                "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
            )
        return response

    session = local_session_router(manager, origin=origin,
                                   allow_testclient=allow_testclient,
                                   verification_binding=verification.binding if verification else None)
    app.include_router(session)

    if verification is not None:
        @app.get("/v1/local/journal/verification")
        def verification_journal(request: Request, principal=Depends(session.require_session)):
            try:
                result = verification.journal_source(principal.profile_id).read(principal.profile_id)
                # Revalidate both the session and profile after the ledger read.
                manager.authenticate(request.cookies.get(COOKIE_NAME))
                verification.journal_source(principal.profile_id)
                return result
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Artificial verification history is unavailable.") from exc

    @app.get("/v1/local/sdk/metadata")
    def sdk_metadata(_principal=Depends(session.require_session)):
        # Package metadata is a diagnostic claim, never broker authority.
        return inspect_sdk_metadata()

    if journal_source is not None:
        @app.get("/v1/local/journal/fixture")
        def fixture_journal(principal=Depends(session.require_session)):
            try:
                return journal_source.read(principal.profile_id)
            except ValueError as exc:
                raise HTTPException(503, "Synthetic Journal history is unavailable.") from exc

    if profile_store is not None:
        paper_reference = LocalPaperReferenceStore(profile_store)
        account_selection = LocalAccountSelection(
            manager, LocalBindingStore(profile_store),
            paper_reference)
        saved_plans = LocalSavedPlanStore(
            profile_store, LocalBindingStore(profile_store))

        @app.get("/v1/local/paper-reference")
        def read_paper_reference(request: Request,
                                 principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    saved = paper_reference.load(principal.profile_id)
                    remembered = LocalBindingStore(profile_store).load(principal.profile_id)
                    if remembered is not None and (not isinstance(remembered, LocalPaperBinding)
                                                   or not remembered.matches_reference(saved)):
                        raise ValueError("A remembered account choice conflicts with its owner reference.")
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Private paper reference is unavailable.") from exc
            return {"recorded": saved is not None,
                    "accountMask": saved.account_mask if saved else None,
                    "environment": "paper" if saved else None,
                    "paperIdentityVerified": False, "executionEnabled": False}

        @app.post("/v1/local/paper-reference")
        async def record_paper_reference(request: Request,
                                         principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise HTTPException(415, "A JSON account confirmation is required.")
            chunks: list[bytes] = []
            size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 256:
                    raise HTTPException(413, "Account confirmation is too large.")
                chunks.append(chunk)

            def unique_fields(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("Duplicate account field.")
                    result[key] = value
                return result

            try:
                choice = json.loads(b"".join(chunks).decode("utf-8"),
                                    object_pairs_hook=unique_fields)
            except (UnicodeError, ValueError) as exc:
                raise HTTPException(400, "Account confirmation is invalid.") from exc
            if (not isinstance(choice, dict)
                    or set(choice) != {"typedAccount", "repeatedAccount", "checkedInIbkrPaper"}
                    or not isinstance(choice["typedAccount"], str)
                    or not isinstance(choice["repeatedAccount"], str)
                    or choice["checkedInIbkrPaper"] is not True
                    or choice["typedAccount"] != choice["repeatedAccount"]):
                raise HTTPException(409, "Confirm the exact paper account outside Brontide first.")
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    existing = paper_reference.load(principal.profile_id)
                    remembered = LocalBindingStore(profile_store).load(principal.profile_id)
                    if remembered is not None and (not isinstance(remembered, LocalPaperBinding)
                                                   or not remembered.matches_reference(existing)):
                        raise ValueError("A confirmed binding conflicts with its owner reference.")
                    saved = paper_reference.record_owner_attested(
                        principal.profile_id, choice["typedAccount"])
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Private paper reference is unavailable or changed.") from exc
            return {"recorded": True, "accountMask": saved.account_mask,
                    "environment": "paper", "paperIdentityVerified": False,
                    "executionEnabled": False}

        @app.post("/v1/local/plans")
        def save_local_plan(revision: LocalPlanRevision, request: Request,
                            principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    return saved_plans.save(principal.profile_id,
                                            revision.savedPlan,
                                            revision.expectedRevision,
                                            revision.expectedScopeId,
                                            revision.expectedActiveRevision)
            except LocalPlanUnavailable as exc:
                raise HTTPException(409, "Private saved plan is unavailable or changed.") from exc
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Private plan storage is unavailable.") from exc

        @app.get("/v1/local/plans/current")
        def read_latest_local_plan(request: Request,
                                   principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    result = saved_plans.load_latest(principal.profile_id)
            except LocalPlanUnavailable as exc:
                raise HTTPException(409, "Private saved plan is unavailable or changed.") from exc
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Private plan storage is unavailable.") from exc
            if result is None:
                raise HTTPException(404, "No saved plan was found in this account.")
            return result

        @app.get("/v1/local/plans/status")
        def local_plan_scope(request: Request,
                             principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    return saved_plans.scope_status(principal.profile_id)
            except LocalPlanUnavailable as exc:
                raise HTTPException(409, "Private plan scope is unavailable or changed.") from exc
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Private plan storage is unavailable.") from exc

        @app.get("/v1/local/plans/{plan_id}")
        def read_local_plan(plan_id: str, request: Request,
                            principal=Depends(session.require_session)):
            # The CSRF value is required for this private read as well: keep
            # the local session stable while the account-scoped ledger opens.
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    result = saved_plans.load_current(principal.profile_id, plan_id)
            except LocalPlanUnavailable as exc:
                raise HTTPException(409, "Private saved plan is unavailable or changed.") from exc
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Private plan storage is unavailable.") from exc
            if result is None:
                raise HTTPException(404, "Saved plan was not found in this account.")
            return result

        @app.post("/v1/local/account-selection")
        def discover_accounts(request: Request,
                              _principal=Depends(session.require_session)):
            # The installed candidate has no evidence provider. An account
            # list is only a masked review, never an execution permission.
            if account_evidence is None:
                raise HTTPException(503, "Verified paper account discovery is unavailable.")
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            try:
                # A browser request must not wake TWS account discovery before
                # the owner records a paper reference or after binding exists.
                lease = account_selection.require_ready(cookie, csrf)
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Paper account review is unavailable.") from exc
            try:
                discovery = account_evidence.discover()
            except Exception as exc:
                raise HTTPException(503, "Paper account discovery is unavailable.") from exc
            manager.require_lease(lease, cookie, csrf)
            try:
                review = account_selection.begin(cookie, csrf, discovery)
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Paper account review is unavailable.") from exc
            manager.require_lease(lease, cookie, csrf)
            return review

        @app.post("/v1/local/account-selection/confirm")
        def confirm_account(choice: AccountConfirmation, request: Request,
                            _principal=Depends(session.require_session)):
            if account_evidence is None:
                raise HTTPException(503, "Verified paper account confirmation is unavailable.")

            def read_evidence(discovery: ManagedAccountDiscovery) -> BrokerAccountObservation:
                try:
                    return account_evidence.corroborate(discovery)
                except Exception as exc:
                    # Even a provider-raised HTTP exception can contain SDK
                    # details or account values; never return it to the page.
                    raise RuntimeError("Paper account evidence is unavailable.") from exc

            try:
                return account_selection.confirm(
                    request.cookies.get(COOKIE_NAME), request.headers.get(CSRF_HEADER),
                    choice.selectionId, choice.index, choice.typedAccount,
                    read_evidence,
                )
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Paper account confirmation is unavailable.") from exc
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(503, "Paper account evidence is unavailable.") from exc

        @app.get("/v1/local/modules")
        def enabled_modules(principal=Depends(session.require_session)):
            try:
                preferences = LocalModulePreferencesStore(profile_store).load(
                    principal.profile_id)
                remembered = LocalBindingStore(profile_store).load(principal.profile_id)
                if remembered is not None and "trading" not in preferences.enabled_views:
                    raise ValueError("Trading view and account state conflict.")
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Local module preferences are unavailable.") from exc
            return {**preferences.public_status(), "canHideTrading": remembered is None}

        @app.put("/v1/local/modules")
        def select_modules(choice: ModuleChoice, request: Request,
                           principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    preferences = LocalModulePreferencesStore(profile_store).save(
                        principal.profile_id, choice.enabledViews)
                    remembered = LocalBindingStore(profile_store).load(principal.profile_id)
            except ValueError as exc:
                raise HTTPException(409, "Module selection is unavailable or conflicts with account state.") from exc
            except OSError as exc:
                raise HTTPException(503, "Local module preferences are unavailable.") from exc
            return {**preferences.public_status(), "canHideTrading": remembered is None}

        @app.get("/v1/local/journal/recorded")
        def recorded_journal(request: Request,
                             principal=Depends(session.require_session)):
            try:
                remembered = LocalBindingStore(profile_store).load(principal.profile_id)
                if remembered is None:
                    raise LocalJournalUnavailable("No paper account is confirmed.")
                reference = paper_reference.load(principal.profile_id)
                if not isinstance(remembered, LocalPaperBinding) or not remembered.matches_reference(reference):
                    raise LocalJournalUnavailable("Owner paper account reference is unavailable.")
                source = LocalRecordedJournalSource.from_private_directory(
                    ledger_directory=profile_store.root / RECORDED_DIRECTORY,
                    profile_id=principal.profile_id,
                    remembered_account_binding=remembered.account_binding)
                result = source.read(principal.profile_id)
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Recorded Journal history is unavailable.") from exc
            # A lock or relaunch while SQLite was read must not return the old
            # account's result to a now-invalid browser session.
            manager.authenticate(request.cookies.get(COOKIE_NAME))
            try:
                current_binding = LocalBindingStore(profile_store).load(principal.profile_id)
                current_reference = paper_reference.load(principal.profile_id)
                current_source = LocalRecordedJournalSource.from_private_directory(
                    ledger_directory=profile_store.root / RECORDED_DIRECTORY,
                    profile_id=principal.profile_id,
                    remembered_account_binding=remembered.account_binding)
                if (current_binding != remembered or current_reference != reference
                        or current_source._ledger_binding != source._ledger_binding):
                    raise LocalJournalUnavailable("Paper account or ledger scope changed during history read.")
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Recorded Journal history is unavailable.") from exc
            # A concurrent lock during scope revalidation has the same effect.
            manager.authenticate(request.cookies.get(COOKIE_NAME))
            return result

        @app.get("/v1/local/binding")
        def remembered_binding(principal=Depends(session.require_session)):
            try:
                remembered = LocalBindingStore(profile_store).load(principal.profile_id)
                reference = (paper_reference.load(principal.profile_id)
                             if account_evidence is not None or remembered is not None else None)
                if remembered is not None and (not isinstance(remembered, LocalPaperBinding)
                                               or not remembered.matches_reference(reference)):
                    raise ValueError("A confirmed account conflicts with its owner paper reference.")
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Local account choice is unavailable; trading remains locked.") from exc
            status = remembered.public_status() if remembered else {
                "remembered": False, "environment": None, "accountMask": None,
                "connectionVerified": False, "reconciliationRequired": True,
                "executionEnabled": False,
            }
            # This is only initial-selection availability, not TWS readiness.
            # The POST route rechecks before contacting its evidence reader.
            return {**status, "accountSelectionAvailable": (
                account_evidence is not None and reference is not None
                and remembered is None)}

        @app.post("/v1/local/binding/check")
        def check_exact_saved_binding(choice: ExactAccountCheck, request: Request,
                                      principal=Depends(session.require_session)):
            """Read-only recovery for a lost confirmation acknowledgement.

            A masked GET alone cannot distinguish two account IDs sharing a
            mask. This endpoint never changes the choice or contacts TWS.
            """
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    with profile_store._exclusive():
                        remembered = LocalBindingStore(profile_store).load(
                            principal.profile_id)
                        reference = paper_reference.load(principal.profile_id)
                        if remembered is not None and (not isinstance(remembered, LocalPaperBinding)
                                                       or not remembered.matches_reference(reference)):
                            raise ValueError("Confirmed account has no private reference.")
                        exact = (remembered is not None and reference is not None
                                 and remembered.matches_exact_account(choice.typedAccount)
                                 and reference.matches(choice.typedAccount))
            except (OSError, ValueError) as exc:
                raise HTTPException(503, "Saved account identity is unavailable.") from exc
            return {"remembered": remembered is not None, "exactMatch": bool(exact),
                    "connectionVerified": False, "reconciliationRequired": True,
                    "executionEnabled": False}

        @app.get("/v1/local/profile")
        def profile(_principal=Depends(session.require_session)):
            stored = profile_store.load_or_create()
            if stored.profile_id != manager.profile_id:
                raise HTTPException(409, "Local profile changed; relaunch Brontide.")
            return {"profileId": stored.profile_id, "selectedView": stored.selected_view,
                    "brokerAccount": None, "executionEnabled": False}

        @app.put("/v1/local/profile/view")
        def select_view(choice: ViewChoice, request: Request,
                        _principal=Depends(session.require_session)):
            cookie = request.cookies.get(COOKIE_NAME)
            csrf = request.headers.get(CSRF_HEADER)
            lease = manager.lease(cookie, csrf)
            try:
                with manager.hold_lease(lease, cookie, csrf):
                    stored = profile_store.select_view(
                        choice.view, expected_profile_id=manager.profile_id)
            except ValueError as exc:
                raise HTTPException(409, "Local profile changed; relaunch Brontide.") from exc
            return {"selectedView": stored.selected_view, "executionEnabled": False}

    @app.get("/launch", response_class=HTMLResponse)
    def launch():
        # The inline script runs before any external asset is loaded. The token
        # is removed from the address bar before it is exchanged and is never
        # included in the HTTP request target, app logs, or persistent storage.
        return HTMLResponse(
            "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='referrer' content='no-referrer'><title>Opening Brontide</title>"
            "</head><body><p id='message'>Opening Brontide…</p>"
            "<script>" + _LAUNCH_SCRIPT + "</script></body></html>"
        )

    @app.get("/")
    def home():
        return RedirectResponse("/standalone/", status_code=307)

    @app.get("/favicon.svg")
    def favicon():
        if not (root / "favicon.svg").is_file():
            raise HTTPException(404)
        return FileResponse(root / "favicon.svg", media_type="image/svg+xml")

    app.mount("/_next", StaticFiles(directory=str(root / "_next")), name="assets")
    app.mount("/verification", StaticFiles(directory=str(root / "verification"), html=True),
              name="verification")
    app.mount("/standalone", StaticFiles(directory=str(root / "standalone"), html=True),
              name="standalone")
    return app


def run(assets: Path, *, open_browser: bool = True, verification_id: str | None = None) -> None:
    """Start one isolated candidate instance on a reserved loopback socket."""
    profile_store = VerificationProfileStore(verification_id) if verification_id is not None else LocalProfileStore()
    try:
        instance = WindowsStandaloneInstance.acquire(profile_store)
    except InstanceAlreadyRunning:
        try:
            profile = profile_store.read_existing()
        except (OSError, ValueError):
            profile = None
        if profile is None or not WindowsStandaloneInstance.request_reopen(
                profile_store, profile.profile_id):
            raise InstanceUnavailable(
                "Another Brontide instance is running, but its browser could not be reopened. "
                "Use its existing window or console R action."
            ) from None
        print("Asked the running Brontide app to reopen its browser. "
              "If no window appears, use its existing window or console R action.", flush=True)
        return
    with instance:
        if isinstance(profile_store, VerificationProfileStore):
            profile_store.initialize_journal(instance.profile_id)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            sock.bind((HOST, 0))
            sock.listen(2048)
            port = sock.getsockname()[1]
            manager = LocalSessionManager(instance.profile_id)
            app = create_app(assets, port=port, manager=manager, profile_store=profile_store)
            server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port,
                                                  proxy_headers=False, log_level="warning"))
            worker = threading.Thread(target=lambda: asyncio.run(server.serve(sockets=[sock])),
                                      daemon=True, name="brontide-loopback")
            worker.start()
            deadline = time.monotonic() + 10
            while not server.started and worker.is_alive() and time.monotonic() < deadline:
                time.sleep(0.05)
            if not server.started:
                server.should_exit = True
                worker.join(timeout=3)
                raise RuntimeError("The local Brontide service did not start.")
            launch_label = VERIFICATION_LABEL if verification_id else "Brontide sample (execution locked)"
            print(f"{launch_label} available at http://{HOST}:{port}/standalone/.",
                  flush=True)
            if open_browser:
                if not _open_local_browser(manager, port):
                    print("The browser did not open. Launch Brontide again to request a new "
                          "window, or press R in this console if available.",
                          flush=True)
            try:
                console_reopen = open_browser and os.name == "nt" and sys.stdin.isatty()
                if console_reopen:
                    import msvcrt
                    print("If the browser session expires, press R in this console to reopen it.",
                          flush=True)
                last_reopen = time.monotonic() if open_browser else float("-inf")
                while worker.is_alive():
                    requested = instance.consume_reopen_signal()
                    if console_reopen and msvcrt.kbhit():
                        requested = msvcrt.getwch().lower() == "r" or requested
                    if (requested and server.started and not server.should_exit
                            and time.monotonic() - last_reopen >= 3):
                        try:
                            current_profile = profile_store.read_existing()
                        except (OSError, ValueError):
                            current_profile = None
                        if current_profile is None or current_profile.profile_id != instance.profile_id:
                            print("The local profile changed; browser reopening is locked.", flush=True)
                            worker.join(timeout=0.2)
                            continue
                        last_reopen = time.monotonic()
                        if not _open_local_browser(manager, port):
                            print("The browser did not open. Launch Brontide again or "
                                  "press R here to try again.", flush=True)
                    worker.join(timeout=0.2)
            except KeyboardInterrupt:
                server.should_exit = True
                worker.join(timeout=10)
            except BaseException:
                server.should_exit = True
                worker.join(timeout=10)
                raise
        finally:
            sock.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the locked Brontide desktop candidate")
    parser.add_argument("--assets", type=Path, required=True,
                        help="Directory containing the reviewed static frontend export")
    args = parser.parse_args()
    run(args.assets)


if __name__ == "__main__":
    main()
