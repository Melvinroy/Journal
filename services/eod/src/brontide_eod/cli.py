from __future__ import annotations

import argparse
import json
from datetime import date

from brontide_eod.config import Settings
from brontide_eod.ingest import ingest_session, refresh_universe
from brontide_eod.providers.alpaca import AlpacaProvider
from brontide_eod.store import DuckDBStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Brontide local EOD data service")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("init-db", help="Create the local DuckDB schema")
    subcommands.add_parser("health", help="Verify Alpaca credentials and connectivity")
    subcommands.add_parser("refresh-universe", help="Refresh active U.S. equities from Alpaca")
    ingest = subcommands.add_parser("ingest-session", help="Load one completed U.S. market session")
    ingest.add_argument("--session", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    serve = subcommands.add_parser("serve", help="Start the local chart API")
    serve.add_argument("--reload", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    settings = Settings.from_env(require_alpaca=args.command in {"health", "refresh-universe", "ingest-session"})
    if args.command == "init-db":
        with DuckDBStore(settings.db_path):
            pass
        print(json.dumps({"status": "ready", "database": str(settings.db_path)}))
        return
    if args.command == "serve":
        import uvicorn

        uvicorn.run("brontide_eod.api:app", host=settings.api_host, port=settings.api_port, reload=args.reload)
        return
    with AlpacaProvider(settings.alpaca_api_key, settings.alpaca_api_secret) as provider:
        if args.command == "health":
            print(json.dumps(provider.health()))
            return
        with DuckDBStore(settings.db_path) as store:
            if args.command == "refresh-universe":
                print(json.dumps({"instruments": refresh_universe(provider, store)}))
            elif args.command == "ingest-session":
                print(json.dumps(ingest_session(provider, store, args.session, batch_size=settings.alpaca_batch_size)))


if __name__ == "__main__":
    main()
