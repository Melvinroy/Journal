"""Verified application identity plus an operator-installed local account binding."""
import json
import os
import re
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import Header, HTTPException

from .ibkr_tws import PaperGatewayConfig, OperatorVerification, PaperSafetyError


def owner_path():
    configured = os.environ.get("BRONTIDE_PAPER_OWNER_FILE")
    return Path(configured) if configured else Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Brontide" / "paper-owner.json"


def verified_user(authorization: str = Header(default="")):
    url = (os.environ.get("BRONTIDE_AUTH_SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")).rstrip("/")
    key = os.environ.get("BRONTIDE_AUTH_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url) or not key.startswith("sb_publishable_"):
        raise HTTPException(503, "Configure Brontide sign-in before connecting TWS.")
    if not authorization.startswith("Bearer ") or len(authorization) < 15:
        raise HTTPException(401, "Sign into Brontide to connect your paper account.")
    try:
        response = httpx.get(url + "/auth/v1/user", headers={"Authorization": authorization, "apikey": key}, timeout=5)
        if response.status_code != 200:
            raise HTTPException(401, "Brontide sign-in expired; sign in again.")
        user = response.json()
        user_id = str(UUID(user["id"]))
        if not user.get("email_confirmed_at") or user.get("is_anonymous"):
            raise HTTPException(403, "A verified Brontide account is required.")
        return {"id": user_id, "email": user.get("email", "")}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(503, "Brontide identity verification is unavailable; trading remains locked.") from None


def require_owner(user):
    try:
        binding = json.loads(owner_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(403, "One-time local account linking is required. Open connection details for your verified user ID.") from None
    try:
        config = PaperGatewayConfig.from_environment()
    except (PaperSafetyError, ValueError):
        raise HTTPException(503, "Local TWS paper configuration is unavailable.") from None
    if binding.get("userId") != user["id"] or binding.get("accountBinding") != config.binding():
        raise HTTPException(403, "This Brontide user is not linked to the configured TWS paper account.")
    return user


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Operator-only local setup. Copy the verified user ID from Brontide connection details; confirm the paper account in TWS first.")
    parser.add_argument("user_id", type=UUID)
    args = parser.parse_args()
    config = PaperGatewayConfig.from_environment()
    verification = OperatorVerification.load(Path(os.environ["BRONTIDE_IBKR_VERIFICATION_FILE"]))
    verification.validate_for(config)
    path = owner_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Never claim or replace another owner's binding through an HTTP request.
    with path.open("x", encoding="utf-8") as file:
        json.dump({"userId": str(args.user_id), "accountBinding": config.binding()}, file)
    print("Local paper account linked. Reload Brontide; submissions remain locked.")


if __name__ == "__main__":
    main()
