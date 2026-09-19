"""Headers for the local static export and authenticated financial API."""
import base64
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
import re


@lru_cache(maxsize=4)
def script_policy(root, build_stamp):
    # Next's static export contains inline hydration scripts. Authorize the exact
    # built bytes, rather than unsafe-inline or unsafe-eval for executable scripts.
    hashes = set()
    for page in Path(root).rglob("*.html"):
        for attrs, script in re.findall(r"<script\b([^>]*)>(.*?)</script>", page.read_text(encoding="utf-8"), re.S | re.I):
            if not re.search(r"\bsrc\s*=", attrs, re.I) and script:
                hashes.add("'sha256-" + base64.b64encode(sha256(script.encode()).digest()).decode() + "'")
    return "script-src 'self' " + " ".join(sorted(hashes))


class SecurityHeaders:
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http": return await self.app(scope, receive, send)
        async def protected(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend([(b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY"),
                                (b"referrer-policy", b"no-referrer"), (b"permissions-policy", b"camera=(), microphone=(), geolocation=()")])
                if scope["path"].startswith("/v1/ibkr/"):
                    headers = [(k, v) for k, v in headers if k.lower() != b"cache-control"]
                    headers.append((b"cache-control", b"no-store"))
                if any(k == b"content-type" and b"text/html" in v for k, v in headers):
                    root = Path(__file__).resolve().parents[4] / "out"
                    marker = root / "index.html"
                    scripts = script_policy(str(root), marker.stat().st_mtime_ns if marker.exists() else 0)
                    policy = ("default-src 'self'; " + scripts + "; style-src 'self' 'unsafe-inline'; "
                              "connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob: https:; "
                              "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
                    headers.append((b"content-security-policy", policy.encode()))
                message = {**message, "headers": headers}
            await send(message)
        await self.app(scope, receive, protected)
