from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Sequence
from zoneinfo import ZoneInfo

import duckdb
import httpx

from brontide_eod.config import Settings
from brontide_eod.ingest import batched, calendar_fingerprint, universe_fingerprint
from brontide_eod.models import DailyBar, Instrument, MarketSession
from brontide_eod.providers.base import MarketDataProvider
from brontide_eod.scanner import (
    BIGGEST_ONE_MONTH_FORMULA_VERSION,
    ScannerExclusion,
    ScannerMeasurement,
    apply_average_growth_ranks,
    calculate_symbol_measurement,
)
from brontide_eod.tc2000 import fingerprint as tc2000_fingerprint, load_tc2000_universes
from brontide_eod.store import DuckDBStore, is_sip_symbol


UPDATE_RETRY_MINUTES = (15, 30, 60, 120)
LOCK_STALE_AFTER = timedelta(hours=6)
SCANNER_KEY = "biggest-one-month"
ADJUSTMENTS = ("all", "raw", "split")
NEW_YORK = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class LockClaim:
    path: Path
    token: str

    def release(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if payload.get("token") == self.token:
                self.path.unlink(missing_ok=True)
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
            pass


class UpdateLockedError(RuntimeError):
    pass


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def acquire_update_lock(path: Path, *, now: datetime | None = None) -> LockClaim:
    now = now or datetime.now(timezone.utc)
    path.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    payload = {"pid": os.getpid(), "token": token, "created_at": now.isoformat()}
    for _ in range(2):
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, separators=(",", ":"))
            return LockClaim(path, token)
        except FileExistsError:
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
                created = datetime.fromisoformat(str(existing.get("created_at")))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                stale = now - created.astimezone(timezone.utc) >= LOCK_STALE_AFTER
                if stale and not _pid_alive(int(existing.get("pid", -1))):
                    path.unlink(missing_ok=True)
                    continue
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass
            raise UpdateLockedError("Another EOD update owns the lock") from None
    raise UpdateLockedError("Another EOD update owns the lock")


def lock_is_owned(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        created = datetime.fromisoformat(str(payload.get("created_at")))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return _pid_alive(int(payload.get("pid", -1))) or datetime.now(timezone.utc) - created < LOCK_STALE_AFTER
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return True


def expected_completed_session(
    sessions: Sequence[MarketSession],
    now: datetime,
    close_delay_minutes: int = 30,
) -> date | None:
    local_now = now.astimezone(NEW_YORK)
    completed = []
    for session in sessions:
        due = datetime.combine(session.session_date, session.close_time, NEW_YORK) + timedelta(minutes=close_delay_minutes)
        if due <= local_now:
            completed.append(session.session_date)
    return max(completed) if completed else None


def authoritative_lookback(sessions: Sequence[MarketSession], target: date, count: int = 22) -> list[date]:
    dates = sorted(session.session_date for session in sessions if session.session_date <= target)
    if len(dates) < count or dates[-1] != target:
        raise ValueError(f"Authoritative calendar does not contain {count} sessions through the target")
    return dates[-count:]


def _sanitize_error(exc: BaseException) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"Alpaca request failed with HTTP {exc.response.status_code}."
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return "Alpaca request failed because the network timed out."
    if isinstance(exc, UpdateLockedError):
        return str(exc)
    if isinstance(exc, ValueError):
        return str(exc)[:500]
    return f"EOD update failed ({type(exc).__name__})."


def _request_with_retries(
    request: Callable[[], list[DailyBar]],
    *,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = 4,
) -> list[DailyBar]:
    for attempt in range(attempts):
        try:
            return request()
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            retryable = status is None or status == 429 or 500 <= status <= 599
            if not retryable or attempt + 1 >= attempts:
                raise
            retry_after = exc.response.headers.get("retry-after") if isinstance(exc, httpx.HTTPStatusError) else None
            delay = min(30.0, float(retry_after)) if retry_after and retry_after.isdigit() else min(8.0, 2.0**attempt)
            sleep(delay)
    raise AssertionError("unreachable")


def _fetch_adjustment(
    provider: MarketDataProvider,
    symbols: Sequence[str],
    start: date,
    end: date,
    adjustment: str,
    batch_size: int,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> list[DailyBar]:
    rows: list[DailyBar] = []
    for batch in batched(symbols, batch_size):
        rows.extend(_request_with_retries(
            lambda batch=batch: provider.get_daily_bars(batch, start, end, adjustment=adjustment),
            sleep=sleep,
        ))
    return rows


def _validate_bars(bars: Sequence[DailyBar], sessions: set[date], adjustments: set[str]) -> None:
    keys: set[tuple[str, date, str]] = set()
    for bar in bars:
        key = (bar.symbol, bar.session_date, bar.adjustment)
        if key in keys:
            raise ValueError("Candidate publication contains duplicate symbol/session/adjustment bars")
        keys.add(key)
        if bar.session_date not in sessions or bar.adjustment not in adjustments:
            raise ValueError("Candidate publication contains an unexpected session or adjustment")
        values = (bar.open, bar.high, bar.low, bar.close)
        if not all(value > 0 and value == value and value not in (float("inf"), float("-inf")) for value in values):
            raise ValueError("Candidate publication contains invalid OHLC values")
        if bar.high < max(bar.open, bar.low, bar.close) or bar.low > min(bar.open, bar.high, bar.close) or bar.volume < 0:
            raise ValueError("Candidate publication contains inconsistent OHLCV values")


def _eligible_symbols(
    canonical: Path,
    instruments: Sequence[Instrument],
    prior_five_sessions: Sequence[date],
    target_symbols: set[str],
    blocked_symbols: set[str] | None = None,
) -> list[str]:
    blocked_symbols = blocked_symbols or set()
    supported = {
        item.symbol
        for item in instruments
        if item.status == "active"
        and item.exchange.upper() not in {"OTC", "OTCQX", "OTCQB", "PINK"}
        and is_sip_symbol(item.symbol)
        and item.symbol not in blocked_symbols
    }
    prior_counts: dict[str, int] = {}
    if canonical.is_file() and prior_five_sessions:
        connection = duckdb.connect(str(canonical), read_only=True)
        try:
            rows = connection.execute(
                """
                SELECT symbol, count(DISTINCT session_date)
                FROM daily_bars
                WHERE adjustment='all' AND source='alpaca_sip' AND quality_status='ready'
                  AND session_date IN (SELECT unnest(?::DATE[]))
                GROUP BY symbol
                """,
                [list(prior_five_sessions)],
            ).fetchall()
            prior_counts = {str(symbol): int(count) for symbol, count in rows}
        finally:
            connection.close()
    return sorted(symbol for symbol in supported if prior_counts.get(symbol, 0) >= 3 or symbol in target_symbols)


def _known_non_sip_queryable(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    connection = duckdb.connect(str(path), read_only=True)
    try:
        return {
            str(row[0]) for row in connection.execute(
                "SELECT symbol FROM instruments WHERE sip_queryable=false"
            ).fetchall()
        }
    finally:
        connection.close()


def _measurements(
    candidate_symbols: Sequence[str],
    rank_symbols: Sequence[str],
    sessions: Sequence[date],
    bars: Sequence[DailyBar],
) -> tuple[list[ScannerMeasurement], list[ScannerExclusion], int]:
    raw: dict[str, dict[date, dict[str, object]]] = {}
    split: dict[str, dict[date, dict[str, object]]] = {}
    for bar in bars:
        destination = raw if bar.adjustment == "raw" else split if bar.adjustment == "split" else None
        if destination is not None:
            destination.setdefault(bar.symbol, {})[bar.session_date] = asdict(bar)
    measurements: dict[str, ScannerMeasurement] = {}
    exclusions: list[ScannerExclusion] = []
    for symbol in sorted(set(candidate_symbols) | set(rank_symbols)):
        row, exclusion = calculate_symbol_measurement(symbol, sessions, raw.get(symbol, {}), split.get(symbol, {}))
        if row:
            measurements[symbol] = row
        if exclusion:
            exclusions.append(exclusion)
    population = [measurements[symbol] for symbol in rank_symbols if symbol in measurements]
    candidates = [measurements[symbol] for symbol in candidate_symbols if symbol in measurements]
    return apply_average_growth_ranks(candidates, population), exclusions, len(population)


def _existing_sessions(path: Path, adjustment: str, sessions: Sequence[date]) -> set[date]:
    if not path.is_file():
        return set()
    connection = duckdb.connect(str(path), read_only=True)
    try:
        return {
            row[0]
            for row in connection.execute(
                """
                SELECT DISTINCT session_date FROM daily_bars
                WHERE adjustment=? AND source='alpaca_sip' AND quality_status='ready'
                  AND session_date IN (SELECT unnest(?::DATE[]))
                """,
                [adjustment, list(sessions)],
            ).fetchall()
        }
    finally:
        connection.close()


def _existing_scanner_bars(path: Path, sessions: Sequence[date]) -> list[DailyBar]:
    if not path.is_file():
        return []
    connection = duckdb.connect(str(path), read_only=True)
    try:
        rows = connection.execute(
            """
            SELECT symbol,session_date,open,high,low,close,volume,trade_count,vwap,
              source_timestamp,timeframe,adjustment,source,quality_status,schema_version
            FROM daily_bars
            WHERE adjustment IN ('raw','split') AND source='alpaca_sip' AND quality_status='ready'
              AND session_date IN (SELECT unnest(?::DATE[]))
            """,
            [list(sessions)],
        ).fetchall()
        return [DailyBar(*row) for row in rows]
    finally:
        connection.close()


def _existing_publication(connection: duckdb.DuckDBPyConnection) -> dict[str, object] | None:
    row = connection.execute(
        "SELECT publication_id, published_session, last_success_at, retry_attempt FROM eod_update_state WHERE singleton_id=1"
    ).fetchone()
    if not row:
        return None
    return {"publication_id": row[0], "published_session": row[1], "last_success_at": row[2], "retry_attempt": row[3]}


def _record_failure(settings: Settings, run_id: str, expected: date | None, mode: str, exc: BaseException) -> None:
    explanation = _sanitize_error(exc)
    now = datetime.now(timezone.utc)
    with DuckDBStore(settings.db_path) as store:
        previous = _existing_publication(store.connection) or {}
        attempt = min(int(previous.get("retry_attempt") or 0) + 1, len(UPDATE_RETRY_MINUTES))
        retry_at = now + timedelta(minutes=UPDATE_RETRY_MINUTES[max(0, attempt - 1)])
        store.connection.execute(
            """
            INSERT OR REPLACE INTO eod_update_runs VALUES (?, ?, ?, ?, 'failed', ?, '[]', ?, ?)
            """,
            [run_id, mode, now, now, expected, attempt, explanation],
        )
        store.connection.execute(
            """
            INSERT OR REPLACE INTO eod_update_state (
              singleton_id,state,expected_session,published_session,publication_id,last_success_at,
              retry_at,retry_attempt,coverage_percent,expected_symbols,loaded_symbols,
              adjustment_coverage,explanation,updated_at
            ) VALUES (1,'failed',?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)
            """,
            [expected, previous.get("published_session"), previous.get("publication_id"),
             previous.get("last_success_at"), retry_at, attempt, explanation, now],
        )


def publish_snapshot(canonical: Path, published: Path, publication_id: str, *, sleep: Callable[[float], None] = time.sleep) -> None:
    published.parent.mkdir(parents=True, exist_ok=True)
    temporary = published.with_name(f".{published.name}.{uuid.uuid4().hex}.tmp")
    try:
        shutil.copy2(canonical, temporary)
        connection = duckdb.connect(str(temporary), read_only=True)
        try:
            row = connection.execute("SELECT publication_id FROM eod_update_state WHERE singleton_id=1").fetchone()
            if not row or str(row[0]) != publication_id:
                raise ValueError("Published snapshot verification failed")
            connection.execute("SELECT count(*) FROM scanner_measurements WHERE publication_id=?", [publication_id]).fetchone()
        finally:
            connection.close()
        for attempt in range(8):
            try:
                os.replace(temporary, published)
                return
            except PermissionError:
                if attempt == 7:
                    raise
                sleep(min(5.0, 0.25 * (2**attempt)))
    finally:
        temporary.unlink(missing_ok=True)


def read_update_status(path: Path) -> dict[str, object]:
    if not path.is_file():
        return {
            "state": "stale",
            "expected_session": None,
            "published_session": None,
            "last_success_at": None,
            "publication_id": None,
            "coverage": None,
            "retry_at": None,
            "explanation": "No validated EOD publication is available.",
        }
    connection = duckdb.connect(str(path), read_only=True)
    try:
        try:
            row = connection.execute(
                """
                SELECT state,expected_session,published_session,last_success_at,publication_id,
                  coverage_percent,expected_symbols,loaded_symbols,adjustment_coverage,retry_at,explanation
                FROM eod_update_state WHERE singleton_id=1
                """
            ).fetchone()
        except duckdb.CatalogException:
            row = None
        if not row:
            return {"state": "stale", "explanation": "No validated EOD publication is available."}
        return {
            "state": row[0], "expected_session": row[1], "published_session": row[2],
            "last_success_at": row[3], "publication_id": str(row[4]) if row[4] is not None else None,
            "coverage": {"percent": row[5], "expected_symbols": row[6], "loaded_symbols": row[7],
                         "adjustments": json.loads(row[8]) if row[8] else {}},
            "retry_at": row[9], "explanation": row[10],
        }
    finally:
        connection.close()


def run_update(
    settings: Settings,
    provider: MarketDataProvider,
    *,
    force: bool = False,
    now: datetime | None = None,
    sleep: Callable[[float], None] = time.sleep,
    run_id: str | None = None,
    lock_claim: LockClaim | None = None,
) -> dict[str, object]:
    started = now or datetime.now(timezone.utc)
    run_id = run_id or str(uuid.uuid4())
    mode = "forced" if force else "due"
    claim = lock_claim or acquire_update_lock(
        settings.db_path.with_suffix(settings.db_path.suffix + ".update.lock"), now=started
    )
    expected: date | None = None
    try:
        # Apply additive schema migrations before status inspection. This is the
        # only writer boundary; the API never opens the canonical file.
        with DuckDBStore(settings.db_path):
            pass
        calendar_start = started.astimezone(NEW_YORK).date() - timedelta(days=75)
        calendar_end = started.astimezone(NEW_YORK).date()
        calendar = provider.get_market_calendar(calendar_start, calendar_end)
        expected = expected_completed_session(calendar, started, settings.eod_close_delay_minutes)
        if expected is None:
            return {"run_id": run_id, "status": "noop", "reason": "No completed session is due."}
        sessions = authoritative_lookback(calendar, expected, 22)
        existing = read_update_status(settings.db_path)
        retry_at = existing.get("retry_at")
        if not force and existing.get("published_session") == expected and existing.get("state") == "current":
            return {"run_id": run_id, "status": "noop", "reason": "The published dataset is current.", "session": expected}
        if not force and retry_at and retry_at > started:
            return {"run_id": run_id, "status": "noop", "reason": "The next full-attempt retry is not due.", "retry_at": retry_at}

        instruments = provider.list_instruments(status="active")
        blocked_symbols = _known_non_sip_queryable(settings.db_path)
        candidate_symbols = sorted({item.symbol for item in instruments if is_sip_symbol(item.symbol)
                                    and item.symbol not in blocked_symbols
                                    and item.exchange.upper() not in {"OTC", "OTCQX", "OTCQB", "PINK"}})
        bars: list[DailyBar] = []
        for adjustment in ADJUSTMENTS:
            present = _existing_sessions(settings.db_path, adjustment, sessions)
            missing = [day for day in sessions if day not in present]
            overlap_start = sessions[-max(1, settings.eod_correction_overlap_sessions)]
            fetch_start = min([overlap_start, *missing]) if missing else overlap_start
            bars.extend(_fetch_adjustment(
                provider, candidate_symbols, fetch_start, expected, adjustment,
                settings.alpaca_batch_size, sleep=sleep,
            ))
        _validate_bars(bars, set(sessions), set(ADJUSTMENTS))
        target_by_adjustment = {
            adjustment: {bar.symbol for bar in bars if bar.adjustment == adjustment and bar.session_date == expected}
            for adjustment in ADJUSTMENTS
        }
        target_symbols = set().union(*target_by_adjustment.values())
        eligible = _eligible_symbols(settings.db_path, instruments, sessions[-6:-1], target_symbols, blocked_symbols)
        loaded_all = set.intersection(*(target_by_adjustment[adjustment] for adjustment in ADJUSTMENTS))
        loaded = len(set(eligible) & loaded_all)
        coverage = 100.0 * loaded / len(eligible) if eligible else 0.0
        if coverage < settings.eod_minimum_coverage_percent:
            raise ValueError(
                f"Candidate session coverage {coverage:.2f}% is below the configured {settings.eod_minimum_coverage_percent:.2f}% minimum"
            )
        existing_scanner = _existing_scanner_bars(settings.db_path, sessions)
        staged_keys = {(bar.symbol, bar.session_date, bar.adjustment) for bar in bars}
        measurement_input = [
            bar for bar in existing_scanner
            if (bar.symbol, bar.session_date, bar.adjustment) not in staged_keys
        ] + bars
        scanner_candidate_symbols = list(eligible)
        scanner_rank_symbols = list(eligible)
        scanner_universe = {
            "source": "alpaca-fallback",
            "evaluation_session": expected.isoformat(),
            "captured_at": None,
            "tc2000_version": None,
            "candidate_fingerprint": universe_fingerprint(scanner_candidate_symbols),
            "rank_fingerprint": universe_fingerprint(scanner_rank_symbols),
            "candidate_exported": len(scanner_candidate_symbols),
            "rank_exported": len(scanner_rank_symbols),
            "candidate_eligible": len(scanner_candidate_symbols),
            "rank_eligible": len(scanner_rank_symbols),
            "missing_candidate_symbols": [],
            "missing_rank_symbols": [],
            "age_sessions": 0,
            "stale": True,
        }
        if settings.tc2000_universe_path is not None:
            if not settings.tc2000_universe_path.is_file():
                raise ValueError("Configured TC2000 universe export is unavailable")
            exported = load_tc2000_universes(settings.tc2000_universe_path)
            if exported.evaluation_session > expected:
                raise ValueError("TC2000 universe export is dated after the target EOD session")
            eligible_set = set(eligible)
            scanner_candidate_symbols = [symbol for symbol in exported.candidate_symbols if symbol in eligible_set]
            scanner_rank_symbols = [symbol for symbol in exported.rank_symbols if symbol in eligible_set]
            age_sessions = exported.age_in_sessions((row.session_date for row in calendar), expected)
            scanner_universe = {
                "source": "tc2000-export",
                "evaluation_session": exported.evaluation_session.isoformat(),
                "captured_at": exported.captured_at.isoformat(),
                "tc2000_version": exported.tc2000_version,
                "source_categories": list(exported.source_categories),
                "source_memberships": [
                    {"name": name, "count": len(symbols), "fingerprint": tc2000_fingerprint(symbols)}
                    for name, symbols in exported.source_memberships
                ],
                "candidate_fingerprint": exported.candidate_fingerprint,
                "rank_fingerprint": exported.rank_fingerprint,
                "result_fingerprint": exported.result_fingerprint,
                "candidate_exported": len(exported.candidate_symbols),
                "rank_exported": len(exported.rank_symbols),
                "result_exported": len(exported.result_symbols),
                "candidate_eligible": len(scanner_candidate_symbols),
                "rank_eligible": len(scanner_rank_symbols),
                "missing_candidate_symbols": sorted(set(exported.candidate_symbols) - eligible_set),
                "missing_rank_symbols": sorted(set(exported.rank_symbols) - eligible_set),
                "age_sessions": age_sessions,
                "stale": age_sessions > settings.tc2000_universe_stale_sessions,
            }
            if len(scanner_rank_symbols) < 2:
                raise ValueError("TC2000 rank universe has fewer than two eligible symbols")
        measurements, exclusions, rank_measured = _measurements(
            scanner_candidate_symbols, scanner_rank_symbols, sessions, measurement_input
        )
        scanner_universe["candidate_measured"] = len(measurements)
        scanner_universe["rank_measured"] = rank_measured
        scanner_universe["candidate_excluded"] = len(scanner_candidate_symbols) - len(measurements)
        publication_id = str(uuid.uuid4())
        completed = datetime.now(timezone.utc)
        universe_hash = str(scanner_universe["candidate_fingerprint"])
        calendar_hash = calendar_fingerprint(calendar)
        adjustment_coverage = {key: len(value & set(eligible)) for key, value in target_by_adjustment.items()}
        manifest = {
            "publication_id": publication_id,
            "run_id": run_id,
            "data_through_session": expected.isoformat(),
            "feed": "sip",
            "adjustments": adjustment_coverage,
            "universe_fingerprint": universe_hash,
            "scanner_universe": scanner_universe,
            "calendar_fingerprint": calendar_hash,
            "formula_version": BIGGEST_ONE_MONTH_FORMULA_VERSION,
            "coverage_percent": round(coverage, 6),
            "expected_symbols": len(eligible),
            "loaded_symbols": loaded,
            "excluded_symbols": [{"symbol": row.symbol, "reason": row.reason} for row in exclusions],
        }

        with DuckDBStore(settings.db_path) as store:
            store.begin()
            try:
                store.upsert_instruments(instruments)
                store.record_market_calendar(
                    calendar_fingerprint=calendar_hash, provider="alpaca", start=calendar_start,
                    end=calendar_end, sessions=calendar,
                )
                for chunk in batched(bars, 5_000):
                    store.upsert_bars(chunk)
                store.connection.execute(
                    "INSERT INTO eod_update_runs VALUES (?, ?, ?, ?, 'succeeded', ?, ?, 0, NULL)",
                    [run_id, mode, started, completed, expected, json.dumps([day.isoformat() for day in sessions])],
                )
                store.connection.execute(
                    """INSERT INTO eod_publications VALUES (?, ?, ?, ?, ?, 'sip', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [publication_id, run_id, completed, expected, expected, json.dumps(adjustment_coverage),
                     universe_hash, calendar_hash, BIGGEST_ONE_MONTH_FORMULA_VERSION, len(eligible), loaded,
                     coverage, len(exclusions), json.dumps(manifest, separators=(",", ":"))],
                )
                if measurements:
                    store.connection.executemany(
                        """INSERT INTO scanner_measurements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        [(publication_id, SCANNER_KEY, BIGGEST_ONE_MONTH_FORMULA_VERSION, row.symbol,
                          row.session_date, row.dollar_volume, row.growth_percent, row.adr_percent,
                          row.growth_rank) for row in measurements],
                    )
                if exclusions:
                    store.connection.executemany(
                        "INSERT INTO scanner_exclusions VALUES (?, ?, ?, ?, ?)",
                        [(publication_id, SCANNER_KEY, row.symbol, row.reason, row.detail) for row in exclusions],
                    )
                store.connection.execute(
                    """
                    INSERT OR REPLACE INTO eod_update_state VALUES
                    (1,'current',?,?,?,?,NULL,0,?,?,?,?,NULL,?)
                    """,
                    [expected, expected, publication_id, completed, coverage, len(eligible), loaded,
                     json.dumps(adjustment_coverage), completed],
                )
                store.commit()
                store.checkpoint()
            except BaseException:
                store.rollback()
                raise
        publish_snapshot(settings.db_path, settings.serving_db_path, publication_id, sleep=sleep)
        return {
            "run_id": run_id, "status": "published", "publication_id": publication_id,
            "data_through_session": expected, "coverage_percent": round(coverage, 4),
            "expected_symbols": len(eligible), "loaded_symbols": loaded,
            "measurements": len(measurements), "excluded_symbols": len(exclusions),
            "adjustment_coverage": adjustment_coverage,
            "duration_seconds": round((datetime.now(timezone.utc) - started).total_seconds(), 3),
        }
    except BaseException as exc:
        try:
            _record_failure(settings, run_id, expected, mode, exc)
        except BaseException:
            pass
        raise
    finally:
        claim.release()
