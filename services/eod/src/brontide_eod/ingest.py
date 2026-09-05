from __future__ import annotations

from email.utils import parsedate_to_datetime
from dataclasses import asdict, dataclass
import hashlib
import json
import random
import time
from collections.abc import Callable
from datetime import date, timedelta
from itertools import islice
from typing import Iterable, Iterator, TypeVar
from uuid import uuid4

import httpx

from brontide_eod.models import Instrument
from brontide_eod.providers.base import MarketDataProvider
from brontide_eod.quality import validate_bars
from brontide_eod.store import DuckDBStore

T = TypeVar("T")

INGEST_PROVIDER = "alpaca"
INGEST_FEED = "sip"
INGEST_TIMEFRAME = "1Day"
INGEST_ADJUSTMENT = "all"
INGEST_ASOF = "-"
SYMBOL_VALIDATION_RULES = "active_inactive_non_otc_sip_symbol_v1"
PIPELINE_VERSION = "historical_sip_backfill_v2"
RUN_PROVIDER = "alpaca_sip"


@dataclass(frozen=True)
class IngestionConfig:
    provider: str
    feed: str
    timeframe: str
    adjustment: str
    asof: str
    symbol_validation_rules: str
    universe_fingerprint: str
    pipeline_version: str
    config_fingerprint: str


@dataclass(frozen=True)
class UniversePreflightResult:
    initial_symbols: int
    accepted_symbols: int
    rejected_symbols: tuple[str, ...]
    probe_session: date
    reconciliation: dict[str, int]


@dataclass(frozen=True)
class HistoricalUniverseRefreshResult:
    source_population: int
    deduped_instruments: int
    duplicates_removed: int
    deduped_symbols: tuple[str, ...]


def batched(values: Iterable[T], size: int) -> Iterator[list[T]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def universe_fingerprint(symbols: Iterable[str]) -> str:
    sorted_symbols = sorted(symbols)
    payload = json.dumps(sorted_symbols, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def ingestion_config_fingerprint(
    *,
    provider: str = INGEST_PROVIDER,
    feed: str = INGEST_FEED,
    timeframe: str = INGEST_TIMEFRAME,
    adjustment: str = INGEST_ADJUSTMENT,
    asof: str = INGEST_ASOF,
    symbol_validation_rules: str = SYMBOL_VALIDATION_RULES,
    universe_fingerprint: str,
    pipeline_version: str = PIPELINE_VERSION,
) -> str:
    payload = {
        "adjustment": adjustment,
        "asof": asof,
        "feed": feed,
        "pipeline_version": pipeline_version,
        "provider": provider,
        "symbol_validation_rules": symbol_validation_rules,
        "timeframe": timeframe,
        "universe_fingerprint": universe_fingerprint,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def historical_ingestion_config(store: DuckDBStore, symbols: list[str] | None = None) -> tuple[list[str], IngestionConfig]:
    symbols = sorted(symbols if symbols is not None else store.historical_symbols())
    fingerprint = universe_fingerprint(symbols)
    config_fingerprint = ingestion_config_fingerprint(universe_fingerprint=fingerprint)
    config = IngestionConfig(
        provider=INGEST_PROVIDER,
        feed=INGEST_FEED,
        timeframe=INGEST_TIMEFRAME,
        adjustment=INGEST_ADJUSTMENT,
        asof=INGEST_ASOF,
        symbol_validation_rules=SYMBOL_VALIDATION_RULES,
        universe_fingerprint=fingerprint,
        pipeline_version=PIPELINE_VERSION,
        config_fingerprint=config_fingerprint,
    )
    _record_fingerprints(store, symbols, config)
    return symbols, config


def refresh_universe(provider: MarketDataProvider, store: DuckDBStore) -> int:
    return store.upsert_instruments(provider.list_instruments(status="active"))


def refresh_historical_universe(provider: MarketDataProvider, store: DuckDBStore) -> int:
    return refresh_historical_universe_details(provider, store).deduped_instruments


def refresh_historical_universe_details(
    provider: MarketDataProvider,
    store: DuckDBStore,
) -> HistoricalUniverseRefreshResult:
    instruments = []
    for status in ("active", "inactive"):
        instruments.extend(provider.list_instruments(status=status))
    deduped_count = _deduped_instrument_count(instruments)
    upserted = store.upsert_instruments(instruments)
    return HistoricalUniverseRefreshResult(
        source_population=len(instruments),
        deduped_instruments=upserted,
        duplicates_removed=len(instruments) - deduped_count,
        deduped_symbols=tuple(sorted({instrument.symbol for instrument in instruments})),
    )


def preflight_historical_universe(
    provider: MarketDataProvider,
    store: DuckDBStore,
    *,
    probe_session: date,
    batch_size: int = 200,
    max_retries: int = 5,
    base_delay_seconds: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
    source_population: int | None = None,
    duplicates_removed: int = 0,
    source_symbols: Iterable[str] | None = None,
) -> UniversePreflightResult:
    initial_symbols = store.historical_symbols()
    rejected: dict[str, str] = {}
    for symbols in batched(initial_symbols, batch_size):
        try:
            _with_retries(
                lambda symbols=symbols: provider.get_daily_bars(symbols, probe_session, probe_session),
                max_retries=max_retries,
                base_delay_seconds=base_delay_seconds,
                sleep=sleep,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            _confirm_control_request(provider, probe_session, max_retries, base_delay_seconds, sleep)
            rejected.update(_bisect_bad_symbols(provider, symbols, probe_session, max_retries, base_delay_seconds, sleep))
    if rejected:
        for symbol, reason in rejected.items():
            store.mark_symbols_not_sip_queryable([symbol], reason)
    reconciliation = store.historical_universe_reconciliation(
        source_count=source_population,
        duplicates_removed=duplicates_removed,
        source_symbols=source_symbols,
    )
    if reconciliation["included"] != len(store.historical_symbols()):
        raise ValueError("historical universe reconciliation included count does not match final symbols")
    return UniversePreflightResult(
        initial_symbols=len(initial_symbols),
        accepted_symbols=len(store.historical_symbols()),
        rejected_symbols=tuple(sorted(rejected)),
        probe_session=probe_session,
        reconciliation=reconciliation,
    )


class RequestRateLimiter:
    def __init__(
        self,
        *,
        requests_per_minute: int = 180,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if requests_per_minute <= 0:
            raise ValueError("requests_per_minute must be positive")
        self.min_interval_seconds = 60 / requests_per_minute
        self.clock = clock
        self.sleep = sleep
        self.last_request_at: float | None = None
        self.requests = 0

    def wait(self) -> None:
        now = self.clock()
        if self.last_request_at is not None:
            delay = self.min_interval_seconds - (now - self.last_request_at)
            if delay > 0:
                self.sleep(delay)
                now = self.clock()
        self.last_request_at = now
        self.requests += 1


def is_market_session(day: date) -> bool:
    if day.weekday() >= 5:
        return False
    return day not in _market_holidays(day.year)


def market_sessions(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        if is_market_session(current):
            yield current
        current += timedelta(days=1)


def backfill_sessions(
    provider: MarketDataProvider,
    store: DuckDBStore,
    start: date,
    end: date,
    *,
    batch_size: int = 200,
    max_retries: int = 5,
    base_delay_seconds: float = 2.0,
    session_chunk_size: int = 35,
    rate_limiter: RequestRateLimiter | None = None,
    sleep: Callable[[float], None] = time.sleep,
    emit: Callable[[dict[str, object]], None] | None = None,
    preflight_session: date | None = None,
    stop_on_error: bool = False,
    source_population: int | None = None,
    duplicates_removed: int = 0,
    source_symbols: Iterable[str] | None = None,
) -> dict[str, int]:
    if end < start:
        raise ValueError("end date must be on or after start date")
    if session_chunk_size < 1:
        raise ValueError("session_chunk_size must be positive")
    if session_chunk_size * batch_size > 9_000:
        raise ValueError("session_chunk_size * batch_size must stay below the 10,000-bar page limit")

    sessions = list(market_sessions(start, end))
    session_set = set(sessions)
    skipped_non_market = 0
    completed = 0
    failed = 0
    skipped_completed = 0
    bars = 0
    issues = 0
    pending_chunks: list[list[date]] = []
    current_chunk: list[date] = []
    if preflight_session is not None:
        preflight_historical_universe(
            provider,
            store,
            probe_session=preflight_session,
            batch_size=batch_size,
            max_retries=max_retries,
            base_delay_seconds=base_delay_seconds,
            sleep=sleep,
            source_population=source_population,
            duplicates_removed=duplicates_removed,
            source_symbols=source_symbols,
        )
    symbols, config = historical_ingestion_config(store)

    for day in _date_range(start, end):
        if day in session_set:
            continue
        skipped_non_market += 1
        _record_skipped(store, day, "non-market day", config)

    total_sessions = len(sessions)
    for index, session in enumerate(sessions, start=1):
        remaining = total_sessions - index
        if _session_completed(store, session, config.config_fingerprint):
            if current_chunk:
                pending_chunks.append(current_chunk)
                current_chunk = []
            skipped_completed += 1
            _record_skipped(store, session, "already completed", config)
            if emit:
                emit(_progress(
                    store, session, "skipped", remaining, 0, bars, 0, failures=failed,
                    requests=rate_limiter.requests if rate_limiter else 0,
                    total_symbols=len(symbols),
                ))
            continue
        current_chunk.append(session)
        if len(current_chunk) == session_chunk_size:
            pending_chunks.append(current_chunk)
            current_chunk = []
    if current_chunk:
        pending_chunks.append(current_chunk)

    for chunk in pending_chunks:
        remaining_after_chunk = sum(1 for session in sessions if session > chunk[-1])
        try:
            result = _ingest_session_chunk(
                provider,
                store,
                chunk,
                symbols=symbols,
                config=config,
                batch_size=batch_size,
                max_retries=max_retries,
                base_delay_seconds=base_delay_seconds,
                sleep=sleep,
            )
        except Exception as exc:
            failed += len(chunk)
            remaining = remaining_after_chunk
            for session in chunk:
                if emit:
                    emit(_progress(
                        store, session, "failed", remaining, 0, bars, 0, failures=failed,
                        detail=str(exc)[:300],
                        requests=rate_limiter.requests if rate_limiter else 0,
                        total_symbols=len(symbols),
                    ))
                remaining += 1
            if stop_on_error:
                raise
            continue
        completed += len(chunk)
        bars += int(result["bars"])
        issues += int(result["issues"])
        remaining = remaining_after_chunk
        for session in reversed(chunk):
            session_bars = int(result["bars_by_session"].get(session, 0))  # type: ignore[union-attr]
            session_issues = int(result["issues_by_session"].get(session, 0))  # type: ignore[union-attr]
            if emit:
                emit(_progress(
                    store, session, "completed", remaining, session_bars, bars, session_issues,
                    failures=failed,
                    requests=rate_limiter.requests if rate_limiter else 0,
                    total_symbols=len(symbols),
                ))
            remaining += 1

    return {
        "sessions": total_sessions,
        "completed": completed,
        "failed": failed,
        "skipped_completed": skipped_completed,
        "skipped_non_market": skipped_non_market,
        "bars": bars,
        "issues": issues,
    }


def ingest_session(
    provider: MarketDataProvider,
    store: DuckDBStore,
    session: date,
    *,
    batch_size: int = 200,
    max_retries: int = 0,
    base_delay_seconds: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int | str]:
    symbols, config = historical_ingestion_config(store)
    run_id = str(uuid4())
    store.connection.execute(
        """
        INSERT INTO data_ingest_runs (
          run_id, provider, session_date, status, universe_fingerprint, config_fingerprint
        ) VALUES (?, ?, ?, 'running', ?, ?)
        """,
        [run_id, RUN_PROVIDER, session, config.universe_fingerprint, config.config_fingerprint],
    )
    bar_count = 0
    issue_count = 0
    try:
        for batch_symbols in batched(symbols, batch_size):
            bars = _with_retries(
                lambda symbols=batch_symbols: provider.get_daily_bars(symbols, session, session),
                max_retries=max_retries,
                base_delay_seconds=base_delay_seconds,
                sleep=sleep,
            )
            issues = validate_bars(bars, session)
            rejected = {(row.symbol, row.session_date) for row in issues}
            ready = [row for row in bars if (row.symbol, row.session_date) not in rejected]
            bar_count += store.upsert_bars(ready)
            issue_count += store.write_issues(run_id, issues)
        store.connection.execute(
            """
            UPDATE data_ingest_runs SET completed_at=current_timestamp, status='completed',
              instrument_count=?, bar_count=?, issue_count=? WHERE run_id=?
            """,
            [len(symbols), bar_count, issue_count, run_id],
        )
    except Exception as exc:
        store.connection.execute(
            "UPDATE data_ingest_runs SET completed_at=current_timestamp, status='failed', detail=? WHERE run_id=?",
            [str(exc)[:2_000], run_id],
        )
        raise
    return {"run_id": run_id, "bars": bar_count, "issues": issue_count}


def _ingest_session_chunk(
    provider: MarketDataProvider,
    store: DuckDBStore,
    sessions: list[date],
    *,
    symbols: list[str],
    config: IngestionConfig,
    batch_size: int,
    max_retries: int,
    base_delay_seconds: float,
    sleep: Callable[[float], None],
) -> dict[str, object]:
    bars_by_session = {session: 0 for session in sessions}
    issues_by_session = {session: 0 for session in sessions}
    session_set = set(sessions)
    run_ids: dict[date, str] = {}
    try:
        store.begin()
        run_ids = _start_session_runs(store, sessions, config)
        for batch_symbols in batched(symbols, batch_size):
            bars = _with_retries(
                lambda symbols=batch_symbols: provider.get_daily_bars(symbols, sessions[0], sessions[-1]),
                max_retries=max_retries,
                base_delay_seconds=base_delay_seconds,
                sleep=sleep,
            )
            _ensure_bars_in_range(bars, session_set)
            ready_bars = []
            for session in sessions:
                session_bars = [bar for bar in bars if bar.session_date == session]
                issues = validate_bars(session_bars, session)
                rejected = {(row.symbol, row.session_date) for row in issues}
                ready = [row for row in session_bars if (row.symbol, row.session_date) not in rejected]
                ready_bars.extend(ready)
                bars_by_session[session] += len(ready)
                issues_by_session[session] += store.write_issues(run_ids[session], issues)
            store.upsert_bars(ready_bars)
        _finish_session_runs(store, run_ids, "completed", bars_by_session, issues_by_session, instrument_count=len(symbols))
        store.commit()
        store.checkpoint()
    except Exception:
        store.rollback()
        _record_failed_session_runs(store, sessions, config, len(symbols), _exception_detail())
        store.checkpoint()
        raise
    return {
        "bars": sum(bars_by_session.values()),
        "issues": sum(issues_by_session.values()),
        "bars_by_session": bars_by_session,
        "issues_by_session": issues_by_session,
    }


def print_progress(event: dict[str, object]) -> None:
    print(json.dumps(event), flush=True)


def _with_retries(
    operation: Callable[[], list[T]],
    *,
    max_retries: int,
    base_delay_seconds: float,
    sleep: Callable[[float], None],
) -> list[T]:
    attempt = 0
    while True:
        try:
            return operation()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            retryable = status_code == 429 or 500 <= status_code <= 599
            if not retryable or attempt >= max_retries:
                raise
            delay = _retry_delay(exc, base_delay_seconds, attempt)
            sleep(delay)
            attempt += 1
        except httpx.TransportError:
            if attempt >= max_retries:
                raise
            sleep(_jittered(base_delay_seconds * (2 ** attempt)))
            attempt += 1


def _confirm_control_request(
    provider: MarketDataProvider,
    probe_session: date,
    max_retries: int,
    base_delay_seconds: float,
    sleep: Callable[[float], None],
) -> None:
    try:
        _with_retries(
            lambda: provider.get_daily_bars(["AAPL"], probe_session, probe_session),
            max_retries=max_retries,
            base_delay_seconds=base_delay_seconds,
            sleep=sleep,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 400:
            raise RuntimeError("systemic Alpaca request failure: AAPL control request also returned HTTP 400") from exc
        raise


def _bisect_bad_symbols(
    provider: MarketDataProvider,
    symbols: list[str],
    probe_session: date,
    max_retries: int,
    base_delay_seconds: float,
    sleep: Callable[[float], None],
) -> dict[str, str]:
    try:
        _with_retries(
            lambda: provider.get_daily_bars(symbols, probe_session, probe_session),
            max_retries=max_retries,
            base_delay_seconds=base_delay_seconds,
            sleep=sleep,
        )
        return {}
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 400:
            raise
        if len(symbols) == 1:
            return {symbols[0]: _sanitized_provider_reason(exc)}
        midpoint = len(symbols) // 2
        return (
            _bisect_bad_symbols(provider, symbols[:midpoint], probe_session, max_retries, base_delay_seconds, sleep)
            | _bisect_bad_symbols(provider, symbols[midpoint:], probe_session, max_retries, base_delay_seconds, sleep)
        )


def _sanitized_provider_reason(exc: httpx.HTTPStatusError) -> str:
    body = exc.response.text.strip()
    return f"Alpaca SIP bars HTTP {exc.response.status_code}: {body}"[:2_000]


def _deduped_instrument_count(instruments: Iterable[Instrument]) -> int:
    by_symbol: dict[str, Instrument] = {}
    for instrument in instruments:
        existing = by_symbol.get(instrument.symbol)
        if existing is None or (existing.status != "active" and instrument.status == "active"):
            by_symbol[instrument.symbol] = instrument
    return len(by_symbol)


def _retry_delay(exc: httpx.HTTPStatusError, base_delay_seconds: float, attempt: int) -> float:
    retry_after = exc.response.headers.get("retry-after")
    if retry_after:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            try:
                return max(0.0, parsedate_to_datetime(retry_after).timestamp() - time.time())
            except (TypeError, ValueError):
                pass
    reset = exc.response.headers.get("x-ratelimit-reset")
    remaining = exc.response.headers.get("x-ratelimit-remaining")
    if reset and remaining == "0":
        try:
            reset_value = float(reset)
            if reset_value > 1_000_000_000:
                return max(0.0, reset_value - time.time())
            return max(0.0, reset_value)
        except ValueError:
            try:
                return max(0.0, parsedate_to_datetime(reset).timestamp() - time.time())
            except (TypeError, ValueError):
                pass
    return _jittered(base_delay_seconds * (2 ** attempt))


def _jittered(delay: float) -> float:
    return delay * (1 + random.uniform(0, 0.25))


def _ensure_bars_in_range(bars: list[object], sessions: set[date]) -> None:
    outside = [bar for bar in bars if getattr(bar, "session_date") not in sessions]
    if outside:
        raise ValueError(f"provider returned {len(outside)} bars outside requested session range")


def _date_range(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _record_fingerprints(store: DuckDBStore, symbols: list[str], config: IngestionConfig) -> None:
    store.record_universe_membership(config.universe_fingerprint, symbols)
    fields = asdict(config)
    fields.pop("config_fingerprint")
    store.record_ingestion_config(config_fingerprint=config.config_fingerprint, **fields)


def _session_completed(store: DuckDBStore, session: date, config_fingerprint: str) -> bool:
    row = store.connection.execute(
        """
        SELECT count(*) FROM data_ingest_runs
        WHERE provider = ? AND session_date = ? AND status = 'completed'
          AND config_fingerprint = ?
        """,
        [RUN_PROVIDER, session, config_fingerprint],
    ).fetchone()
    return bool(row and row[0])


def _record_skipped(store: DuckDBStore, session: date, detail: str, config: IngestionConfig) -> None:
    store.connection.execute(
        """
        INSERT INTO data_ingest_runs (
          run_id, provider, session_date, completed_at, status, detail,
          universe_fingerprint, config_fingerprint
        )
        VALUES (?, ?, ?, current_timestamp, 'skipped', ?, ?, ?)
        """,
        [str(uuid4()), RUN_PROVIDER, session, detail, config.universe_fingerprint, config.config_fingerprint],
    )


def _record_failed_session_runs(
    store: DuckDBStore,
    sessions: list[date],
    config: IngestionConfig,
    instrument_count: int,
    detail: str,
) -> None:
    store.begin()
    try:
        for session in sessions:
            store.connection.execute(
                """
                INSERT INTO data_ingest_runs (
                  run_id, provider, session_date, completed_at, status,
                  universe_fingerprint, config_fingerprint, instrument_count, detail
                ) VALUES (?, ?, ?, current_timestamp, 'failed', ?, ?, ?, ?)
                """,
                [
                    str(uuid4()),
                    RUN_PROVIDER,
                    session,
                    config.universe_fingerprint,
                    config.config_fingerprint,
                    instrument_count,
                    detail[:2_000],
                ],
            )
        store.commit()
    except Exception:
        store.rollback()
        raise


def _exception_detail() -> str:
    import traceback

    return traceback.format_exc()


def _start_session_runs(store: DuckDBStore, sessions: list[date], config: IngestionConfig) -> dict[date, str]:
    run_ids = {session: str(uuid4()) for session in sessions}
    for session, run_id in run_ids.items():
        store.connection.execute(
            """
            INSERT INTO data_ingest_runs (
              run_id, provider, session_date, status, universe_fingerprint, config_fingerprint
            ) VALUES (?, ?, ?, 'running', ?, ?)
            """,
            [run_id, RUN_PROVIDER, session, config.universe_fingerprint, config.config_fingerprint],
        )
    return run_ids


def _finish_session_runs(
    store: DuckDBStore,
    run_ids: dict[date, str],
    status: str,
    bars_by_session: dict[date, int],
    issues_by_session: dict[date, int],
    *,
    instrument_count: int,
    detail: str | None = None,
) -> None:
    for session, run_id in run_ids.items():
        store.connection.execute(
            """
            UPDATE data_ingest_runs SET completed_at=current_timestamp, status=?,
              instrument_count=?, bar_count=?, issue_count=?, detail=? WHERE run_id=?
            """,
            [status, instrument_count, bars_by_session[session], issues_by_session[session], detail, run_id],
        )


def _progress(
    store: DuckDBStore,
    session: date,
    status: str,
    remaining: int,
    session_bar_count: int,
    total_bar_count: int,
    issue_count: int,
    *,
    failures: int,
    requests: int,
    total_symbols: int | None = None,
    detail: str | None = None,
) -> dict[str, object]:
    total_symbols = total_symbols if total_symbols is not None else len(store.historical_symbols())
    loaded_symbols = _loaded_symbol_count(store, session)
    historical_density = (loaded_symbols / total_symbols * 100) if total_symbols else 0.0
    live_symbols = len(store.live_scan_symbols())
    live_loaded_symbols = _loaded_live_symbol_count(store, session)
    live_coverage = (live_loaded_symbols / live_symbols * 100) if live_symbols else 0.0
    event: dict[str, object] = {
        "session": session.isoformat(),
        "status": status,
        "remaining_sessions": remaining,
        "session_bars": session_bar_count,
        "total_bars": total_bar_count,
        "historical_response_density_percent": round(historical_density, 2),
        "live_universe_coverage_percent": round(live_coverage, 2),
        "issues": issue_count,
        "failures": failures,
        "requests": requests,
        "database_size_bytes": store.path.stat().st_size if store.path.exists() else 0,
    }
    if detail:
        event["detail"] = detail
    return event


def _active_tradable_count(store: DuckDBStore) -> int:
    return len(store.historical_symbols())


def _loaded_symbol_count(store: DuckDBStore, session: date) -> int:
    return store.connection.execute(
        "SELECT count(DISTINCT symbol) FROM daily_bars WHERE session_date = ?",
        [session],
    ).fetchone()[0]


def _loaded_live_symbol_count(store: DuckDBStore, session: date) -> int:
    live_symbols = store.live_scan_symbols()
    if not live_symbols:
        return 0
    values_sql = ", ".join(_sql_value(symbol) for symbol in live_symbols)
    return store.connection.execute(
        f"""
        WITH live_symbols(symbol) AS (VALUES {values_sql})
        SELECT count(DISTINCT daily_bars.symbol)
        FROM daily_bars
        JOIN live_symbols USING (symbol)
        WHERE session_date = ?
        """,
        [session],
    ).fetchone()[0]


def _sql_value(value: str) -> str:
    return "('" + value.replace("'", "''") + "')"


def _market_holidays(year: int) -> set[date]:
    return {
        _observed(date(year, 1, 1)),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _good_friday(year),
        _last_weekday(year, 5, 0),
        _observed(date(year, 6, 19)),
        _observed(date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4),
        _observed(date(year, 12, 25)),
    }


def _observed(day: date) -> date:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    day = date(year, month, 1)
    offset = (weekday - day.weekday()) % 7
    return day + timedelta(days=offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    next_month = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    day = next_month - timedelta(days=1)
    return day - timedelta(days=(day.weekday() - weekday) % 7)


def _good_friday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day) - timedelta(days=2)
