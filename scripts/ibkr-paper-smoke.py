"""Read-only TWS paper boundary smoke check; this script cannot submit orders."""

from __future__ import annotations

import sys

from brontide_eod.ibkr_tws import PaperSafetyError, client_from_environment, mask_account_id


def main() -> int:
    try:
        client = client_from_environment()
        account_id = client.connect_verified()
        print(f"PASS: verified single connected account {mask_account_id(account_id)}; no order submitted.")
        client.disconnect()
        return 0
    except (PaperSafetyError, RuntimeError, OSError, ValueError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
