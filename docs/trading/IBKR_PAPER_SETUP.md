# IBKR paper setup for connected Gate 2 testing

Brontide's TWS integration is paper-only in Gate 2. It relies on an operator-verified configuration boundary because the TWS API cannot independently attest paper versus live. Host/port choices, account prefixes and the word "paper" in configuration are not proof.

## Short setup checklist

1. Install a current TWS or IB Gateway and the matching **official IBKR TWS API** bundle. Install its Python client into `services/eod/.venv` from the bundle's `source/pythonclient` directory; do not use an unofficial PyPI copy.
2. Start the dedicated gateway/profile, choose the paper login in IBKR's own interface, enable socket clients, and leave API **Read-Only** enabled during connection checks. Configure a dedicated client ID and a loopback-only socket endpoint.
3. In the IBKR interface, visually confirm the unmistakable paper indicator and exact paper account ID. Do not enter or send login credentials to Brontide, the repository or chat.
4. Put `BRONTIDE_IBKR_HOST`, `BRONTIDE_IBKR_PORT`, `BRONTIDE_IBKR_CLIENT_ID`, the exact `BRONTIDE_IBKR_ACCOUNT_ID`, and an absolute `BRONTIDE_IBKR_VERIFICATION_FILE` path in private server-process configuration outside the repository. Keep `BRONTIDE_IBKR_SUBMISSIONS_ENABLED=false`.
5. With `services/eod/.venv` activated and `services/eod` installed editable, run `python scripts/ibkr-paper-verify.py --interface "IB Gateway"` (or `TWS`) from the repository root. Type the already visible account ID only into the local hidden prompt. Re-run with `--replace` after any endpoint/client/account change.
6. With IBKR API Read-Only still enabled and `BRONTIDE_IBKR_SUBMISSIONS_ENABLED=false`, run `python scripts/ibkr-paper-smoke.py` and confirm it reports exactly one masked allowlisted account without submitting an order. Only then disable IBKR API Read-Only and set `BRONTIDE_IBKR_SUBMISSIONS_ENABLED=true` for the controlled paper QC session. Any missing, extra or changed account/configuration fails closed and requires reverification.

Opening-auction submission remains disabled. IBKR defines Limit-on-Open as `LMT` with `OPG`, but its paper guide lists Auction orders among unsupported paper order types. Gate 2 tests its ticket construction and failure handling only unless a separately approved non-live validation path is provided.

Official references:

- [Download the official TWS API](https://www.interactivebrokers.com/docs/tws-api/doc/download-the-tws-api/introduction)
- [Configure TWS for API use](https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/?retakeFinal=1)
- [IBKR API order types — Limit On Open](https://www.interactivebrokers.com/campus/?p=195739&post_type=ibkr-api-page)
- [Paper-account simulator limitations](https://www.ibkrguides.com/clientportal/aboutpapertradingaccounts.htm)
