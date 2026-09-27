"""PyInstaller/source entry point for the locked local desktop candidate."""

import argparse
import json
from pathlib import Path
import sys

from brontide_eod.local_session import LocalSessionManager
from brontide_eod.local_instance import InstanceUnavailable
from brontide_eod.local_profile import LocalProfileStore
from brontide_eod.local_verification import VerificationProfileStore
from brontide_eod.standalone import candidate_diagnostics, create_app, run


def main() -> None:
    parser = argparse.ArgumentParser(description="Brontide desktop candidate")
    parser.add_argument("--check-assets", action="store_true",
                        help="Validate packaged assets without starting a service")
    parser.add_argument("--check-profile-schema", action="store_true",
                        help="Read-only check of this locked candidate's private-data compatibility")
    parser.add_argument("--diagnostics", action="store_true",
                        help="Print a sanitized, read-only candidate support summary")
    parser.add_argument("--verification-profile", metavar="UUID",
                        help="Use an isolated, labelled artificial-record profile; execution remains locked")
    args = parser.parse_args()
    try:
        verification = VerificationProfileStore(args.verification_profile) if args.verification_profile is not None else None
    except (ValueError, OSError):
        parser.exit(2, "Verification profile is invalid or unavailable; nothing was launched.\n")
    if getattr(sys, "frozen", False):
        assets = Path(sys._MEIPASS) / "out"  # type: ignore[attr-defined]
    else:
        assets = Path(__file__).resolve().parents[1] / "out"
    if args.diagnostics:
        try:
            store = verification if verification is not None else LocalProfileStore()
        except OSError:
            store = None
        print(json.dumps(candidate_diagnostics(assets, store), sort_keys=True))
        return
    if args.check_profile_schema:
        try:
            (verification if verification is not None else LocalProfileStore()).check_locked_sample_update()
        except (OSError, ValueError):
            parser.exit(3, "Brontide private data is unavailable or incompatible; installation stayed locked.\n")
        print("Brontide locked candidate is compatible; no private data was changed.")
        return
    if args.check_assets:
        create_app(assets, port=8765, manager=LocalSessionManager("package-check"))
        print("Brontide desktop assets are present; execution remains locked.")
        return
    try:
        run(assets, verification_id=args.verification_profile)
    except (InstanceUnavailable, OSError, ValueError) as exc:
        parser.exit(2, f"Brontide stayed locked: {exc}\n")


if __name__ == "__main__":
    main()
