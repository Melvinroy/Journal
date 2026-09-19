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


class CoverageValidationError(ValueError):
    def __init__(self, message: str, diagnostics: dict[str, object]) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        # os.kill(pid, 0) terminates a process on Windows. A zero-time wait on
        # a synchronization-only handle observes its state without signalling it.
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            # Only an invalid PID proves absence; access/inspection errors
            # must retain the lock rather than risk concurrent writers.
            return ctypes.get_last_error() != 87  # ERROR_INVALID_PARAMETER
        try:
            return kernel.WaitForSingleObject(handle, 0) != 0  # WAIT_OBJECT_0
        finally:
            kernel.CloseHandle(handle)
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


def inspect_update_lock(path: Path, *, now: datetime | None = None) -> dict[str, object]:
    now = now or datetime.now(timezone.utc)
    if not path.exists():
        return {"present": False, "owner_alive": False, "recoverable": False, "recoverable_at": None}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        created = datetime.fromisoformat(str(payload.get("created_at")))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        owner_alive = _pid_alive(int(payload.get("pid", -1)))
        recoverable_at = created.astimezone(timezone.utc) + LOCK_STALE_AFTER
        return {
            "present": True,
            "owner_alive": owner_alive,
            "recoverable": not owner_alive and now >= recoverable_at,
            "recoverable_at": recoverable_at,
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {"present": True, "owner_alive": False, "recoverable": False, "recoverable_at": None}


def lock_is_owned(path: Path) -> bool:
    return bool(inspect_update_lock(path)["owner_alive"])


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


def _target_coverage(
    eligible: Sequence[str],
    target_by_adjustment: dict[str, set[str]],
) -> tuple[set[str], list[str], dict[str, object]]:
    eligible_set = set(eligible)
    observed = set().union(*(target_by_adjustment[key] for key in ADJUSTMENTS))
    complete = set.intersection(*(target_by_adjustment[key] for key in ADJUSTMENTS))
    observed_eligible = eligible_set & observed
    complete_eligible = eligible_set & complete
    no_target_symbols = sorted(eligible_set - observed)
    adjustment_percent = 100.0 * len(complete_eligible) / len(observed_eligible) if observed_eligible else 0.0
    continuity_percent = 100.0 * len(observed_eligible) / len(eligible_set) if eligible_set else 0.0
    diagnostics = {
        "prior_active_symbols": len(eligible_set),
        "observed_symbols": len(observed_eligible),
        "complete_symbols": len(complete_eligible),
        "no_target_bar_count": len(no_target_symbols),
        "no_target_bar_sample": no_target_symbols[:25],
        "session_continuity_percent": round(continuity_percent, 6),
        "adjustment_coverage_percent": round(adjustment_percent, 6),
        "adjustments": {
            key: len(target_by_adjustment[key] & eligible_set)
            for key in ADJUSTMENTS
        },
    }
    return complete_eligible, no_target_symbols, diagnostics


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


def _scanner_publication_matches_configuration(settings: Settings, publication_id: object | None) -> bool:
    """A current bar date is not enough when Scanner formulas or membership changed."""
    if publication_id is None or not settings.db_path.is_file():
        return False
    connection = duckdb.connect(str(settings.db_path), read_only=True)
    try:
        row = connection.execute(
            "SELECT formula_version,manifest_json FROM eod_publications WHERE publication_id=?",
            [publication_id],
        ).fetchone()
    except duckdb.Error:
        return False
    finally:
        connection.close()
    if not row or row[0] != BIGGEST_ONE_MONTH_FORMULA_VERSION:
        return False
    try:
        scanner_universe = (json.loads(row[1]) if row[1] else {}).get("scanner_universe") or {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    if settings.tc2000_universe_path is None:
        return scanner_universe.get("source") == "alpaca-fallback"
    if not settings.tc2000_universe_path.is_file():
        return False
    exported = load_tc2000_universes(settings.tc2000_universe_path)
    expected_source = (
        "tc2000-derived-approximate"
        if settings.tc2000_rank_mode == "approximate"
        else "tc2000-export"
    )
    return (
        scanner_universe.get("source") == expected_source
        and scanner_universe.get("candidate_fingerprint") == exported.candidate_fingerprint
        and scanner_universe.get("rank_fingerprint") == exported.rank_fingerprint
        and scanner_universe.get("effective_rank_cutoff") == settings.scanner_min_growth_rank
    )


def _record_failure(settings: Settings, run_id: str, expected: date | None, mode: str, exc: BaseException) -> None:
    explanation = _sanitize_error(exc)
    diagnostics = getattr(exc, "diagnostics", {})
    now = datetime.now(timezone.utc)
    with DuckDBStore(settings.db_path) as store:
        previous = _existing_publication(store.connection) or {}
        attempt = min(int(previous.get("retry_attempt") or 0) + 1, len(UPDATE_RETRY_MINUTES))
        retry_at = now + timedelta(minutes=UPDATE_RETRY_MINUTES[max(0, attempt - 1)])
        store.connection.execute(
            """
            INSERT OR REPLACE INTO eod_update_runs
              (run_id,mode,started_at,completed_at,status,expected_session,candidate_sessions,
               retry_attempt,explanation,diagnostics_json)
            VALUES (?, ?, ?, ?, 'failed', ?, '[]', ?, ?, ?)
            """,
            [run_id, mode, now, now, expected, attempt, explanation,
             json.dumps(diagnostics, separators=(",", ":"))],
        )
        store.connection.execute(
            """
            INSERT OR REPLACE INTO eod_update_state (
              singleton_id,state,expected_session,published_session,publication_id,last_success_at,
              retry_at,retry_attempt,coverage_percent,expected_symbols,loaded_symbols,
              adjustment_coverage,explanation,updated_at
            ) VALUES (1,'failed',?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            [expected, previous.get("published_session"), previous.get("publication_id"),
             previous.get("last_success_at"), retry_at, attempt,
             diagnostics.get("adjustment_coverage_percent"), diagnostics.get("observed_symbols"),
             diagnostics.get("complete_symbols"), json.dumps(diagnostics.get("adjustments", {})),
             explanation, now],
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


def read_update_history(path: Path, limit: int = 8) -> list[dict[str, object]]:
    if not path.is_file():
        return []
    connection = duckdb.connect(str(path), read_only=True)
    try:
        columns = {row[0] for row in connection.execute("DESCRIBE eod_update_runs").fetchall()}
        diagnostics_column = "diagnostics_json" if "diagnostics_json" in columns else "NULL"
        rows = connection.execute(
            f"""
            SELECT run_id,mode,started_at,completed_at,status,expected_session,retry_attempt,
                   explanation,{diagnostics_column}
            FROM eod_update_runs ORDER BY started_at DESC LIMIT ?
            """,
            [max(1, min(limit, 20))],
        ).fetchall()
        return [
            {
                "run_id": str(row[0]), "mode": row[1], "started_at": row[2],
                "completed_at": row[3], "status": row[4], "expected_session": row[5],
                "retry_attempt": row[6], "explanation": row[7],
                "diagnostics": json.loads(row[8]) if row[8] else {},
            }
            for row in rows
        ]
    except duckdb.CatalogException:
        return []
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
        if (
            not force
            and existing.get("published_session") == expected
            and existing.get("state") == "current"
            and _scanner_publication_matches_configuration(settings, existing.get("publication_id"))
        ):
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
        complete_eligible, no_target_symbols, coverage_diagnostics = _target_coverage(
            eligible, target_by_adjustment
        )
        loaded = len(complete_eligible)
        coverage = float(coverage_diagnostics["adjustment_coverage_percent"])
        continuity = float(coverage_diagnostics["session_continuity_percent"])
        observed_symbols = int(coverage_diagnostics["observed_symbols"])
        adjustment_coverage = dict(coverage_diagnostics["adjustments"])
        if continuity < settings.eod_minimum_session_continuity_percent:
            raise CoverageValidationError(
                f"Candidate session continuity {continuity:.2f}% is below the configured "
                f"{settings.eod_minimum_session_continuity_percent:.2f}% minimum",
                coverage_diagnostics,
            )
        if coverage < settings.eod_minimum_coverage_percent:
            raise CoverageValidationError(
                f"Candidate adjustment coverage {coverage:.2f}% is below the configured "
                f"{settings.eod_minimum_coverage_percent:.2f}% minimum",
                coverage_diagnostics,
            )
        existing_scanner = _existing_scanner_bars(settings.db_path, sessions)
        staged_keys = {(bar.symbol, bar.session_date, bar.adjustment) for bar in bars}
        measurement_input = [
            bar for bar in existing_scanner
            if (bar.symbol, bar.session_date, bar.adjustment) not in staged_keys
        ] + bars
        data_eligible = sorted(complete_eligible)
        scanner_candidate_symbols = list(data_eligible)
        scanner_rank_symbols = list(data_eligible)
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
            eligible_set = set(data_eligible)
            scanner_candidate_symbols = [symbol for symbol in exported.candidate_symbols if symbol in eligible_set]
            scanner_rank_symbols = [symbol for symbol in exported.rank_symbols if symbol in eligible_set]
            age_sessions = exported.age_in_sessions((row.session_date for row in calendar), expected)
            scanner_universe = {
                "source": (
                    "tc2000-derived-approximate"
                    if settings.tc2000_rank_mode == "approximate"
                    else "tc2000-export"
                ),
                "ranking_mode": settings.tc2000_rank_mode,
                "effective_rank_cutoff": settings.scanner_min_growth_rank,
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
        exclusions.extend(
            ScannerExclusion(symbol, "no_target_bar", "No bar was returned by any target-session adjustment")
            for symbol in no_target_symbols
        )
        scanner_universe["candidate_measured"] = len(measurements)
        scanner_universe["rank_measured"] = rank_measured
        scanner_universe["candidate_excluded"] = len(scanner_candidate_symbols) - len(measurements)
        publication_id = str(uuid.uuid4())
        completed = datetime.now(timezone.utc)
        universe_hash = str(scanner_universe["candidate_fingerprint"])
        calendar_hash = calendar_fingerprint(calendar)
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
            "expected_symbols": observed_symbols,
            "loaded_symbols": loaded,
            "coverage_diagnostics": coverage_diagnostics,
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
                    """INSERT INTO eod_update_runs
                    (run_id,mode,started_at,completed_at,status,expected_session,candidate_sessions,
                     retry_attempt,explanation,diagnostics_json)
                    VALUES (?, ?, ?, ?, 'succeeded', ?, ?, 0, NULL, ?)""",
                    [run_id, mode, started, completed, expected,
                     json.dumps([day.isoformat() for day in sessions]),
                     json.dumps(coverage_diagnostics, separators=(",", ":"))],
                )
                store.connection.execute(
                    """INSERT INTO eod_publications VALUES (?, ?, ?, ?, ?, 'sip', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [publication_id, run_id, completed, expected, expected, json.dumps(adjustment_coverage),
                     universe_hash, calendar_hash, BIGGEST_ONE_MONTH_FORMULA_VERSION, observed_symbols, loaded,
                     coverage, len(exclusions), json.dumps(manifest, separators=(",", ":"))],
                )
                if measurements:
                    store.connection.executemany(
                        """INSERT INTO scanner_measurements
                        (publication_id,scanner_key,formula_version,symbol,session_date,dollar_volume,
                         growth_percent,adr_percent,growth_rank,day_percent)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        [(publication_id, SCANNER_KEY, BIGGEST_ONE_MONTH_FORMULA_VERSION, row.symbol,
                          row.session_date, row.dollar_volume, row.growth_percent, row.adr_percent,
                          row.growth_rank, row.day_percent) for row in measurements],
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
                    [expected, expected, publication_id, completed, coverage, observed_symbols, loaded,
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
            "expected_symbols": observed_symbols, "loaded_symbols": loaded,
            "measurements": len(measurements), "excluded_symbols": len(exclusions),
            "adjustment_coverage": adjustment_coverage,
            "coverage_diagnostics": coverage_diagnostics,
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


def run_scheduled_update(
    settings: Settings,
    provider: MarketDataProvider,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    emit: Callable[[dict[str, object]], None] | None = None,
) -> dict[str, object]:
    """Run one due update with only the persisted bounded full-attempt retries."""
    emit = emit or (lambda _event: None)
    for attempt_index in range(len(UPDATE_RETRY_MINUTES) + 1):
        started = clock()
        emit({"event": "scheduled-attempt", "started_at": started.isoformat(), "attempt": attempt_index + 1})
        try:
            result = run_update(settings, provider, now=started, sleep=sleep)
        except BaseException:
            status = read_update_status(settings.db_path)
            emit({"event": "scheduled-attempt-failed", "attempt": attempt_index + 1,
                  "state": status.get("state"), "explanation": status.get("explanation")})
            if attempt_index >= len(UPDATE_RETRY_MINUTES):
                raise
            retry_at = status.get("retry_at")
            delay = max(0.0, (retry_at - clock()).total_seconds()) if isinstance(retry_at, datetime) else 0.0
            emit({"event": "scheduled-retry", "attempt": attempt_index + 2,
                  "retry_at": retry_at, "delay_seconds": round(delay, 3)})
            sleep(delay)
            continue
        emit({"event": "scheduled-complete", **result})
        return result
    raise AssertionError("unreachable")
