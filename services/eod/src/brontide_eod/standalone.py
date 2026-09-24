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
from html.parser import HTMLParser
import socket
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .local_profile import LocalProfileStore, SelectedView
from .local_instance import WindowsStandaloneInstance
from .local_session import LocalSessionManager, local_session_router
from .security_headers import script_policy


HOST = "127.0.0.1"
_LAUNCH_SCRIPT = """(()=>{const prefix='#bootstrap=';const fragment=location.hash;history.replaceState(null,'',location.pathname);const message=document.getElementById('message');if(!fragment.startsWith(prefix)){message.textContent='Launch Brontide from its desktop shortcut.';return;}let token;try{token=decodeURIComponent(fragment.slice(prefix.length));}catch{message.textContent='The launch authorization is invalid.';return;}fetch('/v1/local/session/bootstrap',{method:'POST',credentials:'same-origin',headers:{'X-Brontide-Local':'1','X-Brontide-Bootstrap':token}}).then(response=>{token='';if(!response.ok)throw Error('expired');location.replace('/standalone/');}).catch(()=>{token='';message.textContent='The launch authorization expired. Open Brontide from its desktop shortcut again.';});})();"""


class ViewChoice(BaseModel):
    view: SelectedView


class _AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths: set[str] = set()

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"} and value and value.startswith("/"):
                self.paths.add(urlsplit(value).path)


def validate_assets(assets: Path) -> Path:
    """Require the Trading shell, its read-only evidence page, and local assets."""
    root = assets.resolve(strict=True)
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


def _hash_script(script: str) -> str:
    encoded = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    return f"'sha256-{encoded}'"


def create_app(assets: Path, *, port: int, manager: LocalSessionManager,
               profile_store: LocalProfileStore | None = None,
               allow_testclient: bool = False) -> FastAPI:
    """Serve only the reviewed static shell and non-trading local-session API."""
    root = validate_assets(assets)
    if profile_store is not None and profile_store.root.resolve().is_relative_to(root):
        raise ValueError("Private profile storage must be outside served assets.")
    if not 1 <= port <= 65535:
        raise ValueError("A valid loopback port is required.")
    origin = f"http://{HOST}:{port}"
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        peer = request.client.host if request.client else None
        allowed_peers = {HOST, "::1", "testclient"} if allow_testclient else {HOST, "::1"}
        if peer not in allowed_peers or request.headers.get("host") != f"{HOST}:{port}":
            return JSONResponse({"detail": "Local browser access only."}, status_code=403)
        supplied_origin = request.headers.get("origin")
        if supplied_origin and supplied_origin != origin:
            return JSONResponse({"detail": "Cross-origin access is not permitted."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/v1/") or request.url.path == "/launch":
            response.headers["Cache-Control"] = "no-store"
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
                                   allow_testclient=allow_testclient)
    app.include_router(session)

    if profile_store is not None:
        @app.get("/v1/local/profile")
        def profile(_principal=Depends(session.require_session)):
            stored = profile_store.load_or_create()
            if stored.profile_id != manager.profile_id:
                raise HTTPException(409, "Local profile changed; relaunch Brontide.")
            return {"profileId": stored.profile_id, "selectedView": stored.selected_view,
                    "brokerAccount": None, "executionEnabled": False}

        @app.put("/v1/local/profile/view")
        def select_view(choice: ViewChoice, _principal=Depends(session.require_session)):
            try:
                stored = profile_store.select_view(choice.view,
                                                   expected_profile_id=manager.profile_id)
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


def run(assets: Path, *, open_browser: bool = True) -> None:
    """Start one isolated candidate instance on a reserved loopback socket."""
    profile_store = LocalProfileStore()
    profile = profile_store.load_or_create()
    with WindowsStandaloneInstance.acquire(profile_store, profile.profile_id):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            sock.bind((HOST, 0))
            sock.listen(2048)
            port = sock.getsockname()[1]
            manager = LocalSessionManager(profile.profile_id)
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
            print(f"Brontide sample available at http://{HOST}:{port}/standalone/ (execution locked).",
                  flush=True)
            if open_browser:
                capability = manager.issue_bootstrap()
                opened = webbrowser.open(f"http://{HOST}:{port}/launch#bootstrap={capability}")
                capability = ""
                if not opened:
                    print("The browser did not open. Relaunch Brontide to renew browser authorization.",
                          flush=True)
            try:
                worker.join()
            except KeyboardInterrupt:
                server.should_exit = True
                worker.join(timeout=10)
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
