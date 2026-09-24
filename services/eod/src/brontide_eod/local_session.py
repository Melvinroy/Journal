"""Private, launcher-bootstrapped browser session for the standalone app.

This module does not grant broker authority. In particular, it is never used as
an authentication fallback for the existing Supabase-backed paper API.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response


COOKIE_NAME = "brontide_local_session"
LOCAL_HEADER = "X-Brontide-Local"
BOOTSTRAP_HEADER = "X-Brontide-Bootstrap"
CSRF_HEADER = "X-Brontide-CSRF"


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


@dataclass(frozen=True)
class LocalPrincipal:
    """An authenticated local profile, with no broker account authority."""

    profile_id: str


class LocalSessionManager:
    """In-memory, one-browser-session authority owned by the local launcher.

    The launcher calls ``issue_bootstrap`` and delivers the returned capability
    through a separately reviewed browser handoff. It must never put it in an
    HTTP query, log, or persistent browser storage. The only API exchange is
    the one-use bootstrap header. Restart invalidates all browser sessions.
    """

    def __init__(self, profile_id: str, *, clock: Callable[[], float] = time.monotonic,
                 bootstrap_seconds: int = 60, session_seconds: int = 1800):
        if not profile_id or not profile_id.strip():
            raise ValueError("An established local profile ID is required.")
        if bootstrap_seconds <= 0 or session_seconds <= 0:
            raise ValueError("Session lifetimes must be positive.")
        self.profile_id = profile_id
        self._clock = clock
        self.bootstrap_seconds = bootstrap_seconds
        self.session_seconds = session_seconds
        self._lock = threading.RLock()
        self._bootstrap_digest: bytes | None = None
        self._bootstrap_until = 0.0
        self._session_digest: bytes | None = None
        self._session_until = 0.0
        self._csrf_digest: bytes | None = None
        self._csrf_token: str | None = None

    def issue_bootstrap(self) -> str:
        """Issue only from a trusted local launcher; never expose as an API."""
        capability = secrets.token_urlsafe(32)
        with self._lock:
            self._bootstrap_digest = _digest(capability)
            self._bootstrap_until = self._clock() + self.bootstrap_seconds
        return capability

    def consume_bootstrap(self, capability: str) -> tuple[str, str]:
        with self._lock:
            if (not self._bootstrap_digest or self._clock() >= self._bootstrap_until
                    or not capability or not hmac.compare_digest(_digest(capability), self._bootstrap_digest)):
                raise HTTPException(401, "Local launch authorization is missing or expired.")
            self._bootstrap_digest = None
            self._bootstrap_until = 0.0
            session = secrets.token_urlsafe(32)
            csrf = secrets.token_urlsafe(32)
            self._session_digest = _digest(session)
            self._csrf_digest = _digest(csrf)
            self._csrf_token = csrf
            self._session_until = self._clock() + self.session_seconds
            return session, csrf

    def authenticate(self, cookie: str | None, csrf: str | None = None) -> LocalPrincipal:
        with self._lock:
            if (not self._session_digest or self._clock() >= self._session_until
                    or not cookie or not hmac.compare_digest(_digest(cookie), self._session_digest)):
                raise HTTPException(401, "Local session is locked or expired.")
            if csrf is not None and (not self._csrf_digest or not hmac.compare_digest(_digest(csrf), self._csrf_digest)):
                raise HTTPException(403, "Local request verification failed.")
            return LocalPrincipal(self.profile_id)

    def csrf_for_cookie(self, cookie: str | None) -> str:
        """Recover a tab's in-memory CSRF value after a same-origin reload."""
        with self._lock:
            self.authenticate(cookie)
            assert self._csrf_token is not None
            return self._csrf_token

    def lock(self) -> None:
        with self._lock:
            self._session_digest = None
            self._csrf_digest = None
            self._csrf_token = None
            self._session_until = 0.0
            self._bootstrap_digest = None
            self._bootstrap_until = 0.0


def local_session_router(manager: LocalSessionManager, *, origin: str,
                         allow_testclient: bool = False) -> APIRouter:
    """Build the standalone router for one exact loopback origin.

    The caller must bind its server to that literal loopback address, serve UI
    from the same origin, mount this router, and use ``require_session`` on any
    additional protected routes. It must not mount the legacy paper router as
    a way to enable trading with this local session.
    """
    parsed = urlsplit(origin)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.port is None or parsed.path or parsed.query or parsed.fragment
            or parsed.username or parsed.password):
        raise ValueError("Local session origin must be one exact loopback HTTP origin with a port.")
    allowed_host = parsed.netloc
    router = APIRouter(prefix="/v1/local/session")

    def guard(request: Request, *, unsafe: bool = False) -> None:
        peer = request.client.host if request.client else None
        if peer not in ({"127.0.0.1", "::1", "testclient"} if allow_testclient else {"127.0.0.1", "::1"}):
            raise HTTPException(403, "Local browser access only.")
        if request.headers.get("host") != allowed_host or request.url.scheme != "http":
            raise HTTPException(403, "Unexpected local host.")
        if request.headers.get(LOCAL_HEADER) != "1":
            raise HTTPException(403, "Local browser request required.")
        supplied_origin = request.headers.get("origin")
        if supplied_origin and supplied_origin != origin:
            raise HTTPException(403, "Cross-origin access is not permitted.")
        if request.headers.get("sec-fetch-site") not in (None, "same-origin", "none"):
            raise HTTPException(403, "Cross-site access is not permitted.")
        if unsafe and supplied_origin != origin:
            raise HTTPException(403, "A same-origin request is required.")

    def require_session(request: Request) -> LocalPrincipal:
        guard(request, unsafe=request.method not in {"GET", "HEAD"})
        csrf = request.headers.get(CSRF_HEADER) if request.method not in {"GET", "HEAD"} else None
        if request.method not in {"GET", "HEAD"} and not csrf:
            raise HTTPException(403, "Local request verification failed.")
        return manager.authenticate(request.cookies.get(COOKIE_NAME), csrf)

    @router.post("/bootstrap")
    def bootstrap(request: Request, response: Response):
        guard(request, unsafe=True)
        capability = request.headers.get(BOOTSTRAP_HEADER)
        if not capability:
            raise HTTPException(401, "Local launch authorization is missing or expired.")
        cookie, csrf = manager.consume_bootstrap(capability)
        response.set_cookie(COOKIE_NAME, cookie, httponly=True, secure=False,
                            samesite="strict", path="/", max_age=manager.session_seconds)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return {"profileId": manager.profile_id, "csrf": csrf, "executionEnabled": False}

    @router.get("/status")
    def status(request: Request, response: Response, principal: LocalPrincipal = Depends(require_session)):
        response.headers["Cache-Control"] = "no-store"
        return {"profileId": principal.profile_id, "authenticated": True,
                "brokerAccount": None, "environment": None, "executionEnabled": False,
                "csrf": manager.csrf_for_cookie(request.cookies.get(COOKIE_NAME))}

    @router.post("/lock")
    def lock(response: Response, principal: LocalPrincipal = Depends(require_session)):
        manager.lock()
        response.delete_cookie(COOKIE_NAME, path="/")
        response.headers["Cache-Control"] = "no-store"
        return {"locked": True, "executionEnabled": False}

    # A protected standalone route can depend on this callable without gaining
    # broker authority. The instance is intentionally not exposed over HTTP.
    router.require_session = require_session  # type: ignore[attr-defined]
    return router
