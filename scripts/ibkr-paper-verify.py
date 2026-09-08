"""Record an operator's local paper-account verification outside the repo."""

from __future__ import annotations

import argparse
from getpass import getpass
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

from brontide_eod.ibkr_tws import PaperGatewayConfig, create_operator_verification


def main() -> int:
    parser = argparse.ArgumentParser(description="Bind Brontide to the paper account visibly verified in TWS/IB Gateway.")
    parser.add_argument("--interface", choices=("TWS", "IB Gateway"), required=True)
    parser.add_argument("--replace", action="store_true", help="Replace an existing verification after repeating the visual check.")
    args = parser.parse_args()
    destination_value = os.environ.get("BRONTIDE_IBKR_VERIFICATION_FILE", "")
    if not destination_value:
        parser.error("BRONTIDE_IBKR_VERIFICATION_FILE must name a private file outside the repository.")
    destination = Path(destination_value).expanduser().resolve()
    if destination.exists() and not args.replace:
        parser.error("Verification already exists; repeat the visual check and pass --replace to replace it.")
    config = PaperGatewayConfig.from_environment()
    observed = getpass(f"Exact account ID currently visible in {args.interface}: ").strip()
    verification = create_operator_verification(
        config,
        observed,
        args.interface,
        datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    payload = {
        "accountId": verification.account_id,
        "observedIn": verification.observed_in,
        "verifiedAt": verification.verified_at,
        "configurationBinding": verification.configuration_binding,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Recorded operator verification at {destination}; submissions remain controlled by BRONTIDE_IBKR_SUBMISSIONS_ENABLED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
