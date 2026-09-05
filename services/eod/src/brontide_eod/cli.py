from __future__ import annotations

import argparse
import json
from datetime import date

from brontide_eod.config import Settings
from brontide_eod.ingest import (
    RequestRateLimiter,
    backfill_sessions,
    ingest_session,
    market_sessions,
    print_progress,
    refresh_historical_universe_details,
    refresh_historical_universe,
    refresh_universe,
)
from brontide_eod.providers.alpaca import AlpacaProvider
from brontide_eod.store import DuckDBStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Brontide local EOD data service")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("init-db", help="Create the local DuckDB schema")
    subcommands.add_parser("health", help="Verify Alpaca credentials and connectivity")
    subcommands.add_parser("refresh-universe", help="Refresh active U.S. equities from Alpaca")
    subcommands.add_parser("refresh-historical-universe", help="Refresh active and inactive U.S. equities from Alpaca")
    ingest = subcommands.add_parser("ingest-session", help="Load one completed U.S. market session")
    ingest.add_argument("--session", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    backfill = subcommands.add_parser("backfill", help="Resumably backfill completed U.S. market sessions")
    backfill.add_argument("--start", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    backfill.add_argument("--end", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    backfill.add_argument("--batch-size", type=int, default=None)
    backfill.add_argument("--session-chunk-size", type=int, default=35)
    backfill.add_argument("--requests-per-minute", type=int, default=180)
    backfill.add_argument("--max-retries", type=int, default=5)
    backfill.add_argument("--base-delay-seconds", type=float, default=2.0)
    serve = subcommands.add_parser("serve", help="Start the local chart API")
    serve.add_argument("--reload", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    settings = Settings.from_env(require_alpaca=args.command in {
        "health",
        "refresh-universe",
        "refresh-historical-universe",
        "ingest-session",
        "backfill",
    })
    if args.command == "init-db":
        with DuckDBStore(settings.db_path):
            pass
        print(json.dumps({"status": "ready", "database": str(settings.db_path)}))
        return
    if args.command == "serve":
        import uvicorn

        uvicorn.run("brontide_eod.api:app", host=settings.api_host, port=settings.api_port, reload=args.reload)
        return
    rate_limiter = RequestRateLimiter(requests_per_minute=args.requests_per_minute) if args.command == "backfill" else None
    before_request = rate_limiter.wait if rate_limiter else None
    with AlpacaProvider(
        settings.alpaca_api_key,
        settings.alpaca_api_secret,
        trading_base_url=settings.alpaca_trading_base_url,
        before_request=before_request,
    ) as provider:
        if args.command == "health":
            print(json.dumps(provider.health()))
            return
        with DuckDBStore(settings.db_path) as store:
            if args.command == "refresh-universe":
                print(json.dumps({"instruments": refresh_universe(provider, store)}))
            elif args.command == "refresh-historical-universe":
                print(json.dumps({"instruments": refresh_historical_universe(provider, store)}))
            elif args.command == "ingest-session":
                print(json.dumps(ingest_session(provider, store, args.session, batch_size=settings.alpaca_batch_size)))
            elif args.command == "backfill":
                batch_size = args.batch_size if args.batch_size is not None else settings.alpaca_batch_size
                preflight_session = next(market_sessions(args.start, args.end))
                refresh_result = refresh_historical_universe_details(provider, store)
                print(json.dumps(backfill_sessions(
                    provider,
                    store,
                    args.start,
                    args.end,
                    batch_size=batch_size,
                    session_chunk_size=args.session_chunk_size,
                    rate_limiter=rate_limiter,
                    max_retries=args.max_retries,
                    base_delay_seconds=args.base_delay_seconds,
                    preflight_session=preflight_session,
                    stop_on_error=True,
                    source_population=refresh_result.source_population,
                    duplicates_removed=refresh_result.duplicates_removed,
                    source_symbols=refresh_result.deduped_symbols,
                    emit=print_progress,
                )))


if __name__ == "__main__":
    main()
