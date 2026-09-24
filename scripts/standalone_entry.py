"""PyInstaller/source entry point for the locked local desktop candidate."""

import argparse
from pathlib import Path
import sys

from brontide_eod.local_session import LocalSessionManager
from brontide_eod.local_instance import InstanceUnavailable
from brontide_eod.standalone import create_app
from brontide_eod.standalone import run


def main() -> None:
    parser = argparse.ArgumentParser(description="Brontide desktop candidate")
    parser.add_argument("--check-assets", action="store_true",
                        help="Validate packaged assets without starting a service")
    args = parser.parse_args()
    if getattr(sys, "frozen", False):
        assets = Path(sys._MEIPASS) / "out"  # type: ignore[attr-defined]
    else:
        assets = Path(__file__).resolve().parents[1] / "out"
    if args.check_assets:
        create_app(assets, port=8765, manager=LocalSessionManager("package-check"))
        print("Brontide desktop assets are present; execution remains locked.")
        return
    try:
        run(assets)
    except InstanceUnavailable as exc:
        parser.exit(2, f"Brontide stayed locked: {exc}\n")


if __name__ == "__main__":
    main()
