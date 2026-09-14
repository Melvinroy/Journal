from __future__ import annotations

import argparse
import json
import os
from datetime import date
from pathlib import Path

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
from brontide_eod.reconcile import reconcile_fixture
from brontide_eod.updater import read_update_status, run_update


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
    for command, help_text in (
        ("due-update", "Update only when a completed session or retry is due"),
        ("force-update", "Run the shared EOD update immediately"),
    ):
        update = subcommands.add_parser(command, help=help_text)
        update.add_argument("--env-file", type=Path, default=None)
    status = subcommands.add_parser("status", help="Print shared EOD publication state")
    status.add_argument("--env-file", type=Path, default=None)
    reconcile = subcommands.add_parser("reconcile", help="Reconcile the dated TC2000 reference fixture")
    reconcile.add_argument("--env-file", type=Path, default=None)
    reconcile.add_argument("--session", required=True, type=date.fromisoformat)
    reconcile.add_argument("--dollar-volume", required=True, type=float)
    reconcile.add_argument("--fixture", type=Path, default=Path("fixtures/tc2000-biggest-one-month-2026-09-11.json"))
    reconcile.add_argument("--output", type=Path, default=None)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if getattr(args, "env_file", None):
        os.environ["BRONTIDE_ENV_FILE"] = str(args.env_file.resolve())
    settings = Settings.from_env(require_alpaca=args.command in {
        "health",
        "refresh-universe",
        "refresh-historical-universe",
        "ingest-session",
        "backfill",
        "due-update",
        "force-update",
    })
    if args.command == "status":
        print(json.dumps(read_update_status(settings.db_path), default=str, separators=(",", ":")))
        return
    if args.command == "reconcile":
        fixture_payload = json.loads(args.fixture.read_text(encoding="utf-8"))
        if date.fromisoformat(fixture_payload["evaluation_session"]) != args.session:
            raise SystemExit("Fixture evaluation session does not match --session")
        database = settings.serving_db_path if settings.serving_db_path.is_file() else settings.db_path
        result = reconcile_fixture(database, args.fixture, dollar_threshold=args.dollar_volume, output=args.output)
        print(json.dumps(result, default=str, separators=(",", ":")))
        return
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
        if args.command in {"due-update", "force-update"}:
            try:
                print(json.dumps(run_update(settings, provider, force=args.command == "force-update"), default=str, separators=(",", ":")))
            except BaseException as exc:
                print(json.dumps({"status": "failed", "error": type(exc).__name__,
                                  "state": read_update_status(settings.db_path)}, default=str, separators=(",", ":")))
                raise SystemExit(1) from None
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
                calendar = provider.get_market_calendar(args.start, args.end)
                preflight_session = next(market_sessions(args.start, args.end, calendar))
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
                    calendar=calendar,
                    emit=print_progress,
                )))


if __name__ == "__main__":
    main()
