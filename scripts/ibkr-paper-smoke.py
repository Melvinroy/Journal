"""Read-only TWS paper boundary smoke check; this script cannot submit orders."""

from __future__ import annotations

import sys

from brontide_eod.ibkr_tws import PaperSafetyError, client_from_environment, mask_account_id


def main() -> int:
    client = None
    try:
        client = client_from_environment()
        account_id = client.connect_verified()
        snapshot = client.read_only_snapshot()
        print(f"PASS connection: verified single connected account {mask_account_id(account_id)}.")
        print(f"PASS account summary: completed ({snapshot.account_summary_items} values).")
        positions = "empty" if snapshot.positions == 0 else f"{snapshot.positions} position(s)"
        open_orders = "empty" if snapshot.open_orders == 0 else f"{snapshot.open_orders} open order(s)"
        print(f"PASS positions: completed ({positions}).")
        print(f"PASS open orders: completed ({open_orders}); no orders bound or changed.")
        print("PASS safety: submissions disabled; no order submitted, modified or cancelled.")
        return 0
    except (PaperSafetyError, RuntimeError, OSError, ValueError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2
    finally:
        if client is not None:
            client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
