from __future__ import annotations

from datetime import date
from itertools import islice
from typing import Iterable, Iterator, TypeVar
from uuid import uuid4

from brontide_eod.providers.base import MarketDataProvider
from brontide_eod.quality import validate_bars
from brontide_eod.store import DuckDBStore

T = TypeVar("T")


def batched(values: Iterable[T], size: int) -> Iterator[list[T]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def refresh_universe(provider: MarketDataProvider, store: DuckDBStore) -> int:
    return store.upsert_instruments(provider.list_instruments())


def ingest_session(
    provider: MarketDataProvider,
    store: DuckDBStore,
    session: date,
    *,
    batch_size: int = 200,
) -> dict[str, int | str]:
    run_id = str(uuid4())
    store.connection.execute(
        "INSERT INTO data_ingest_runs (run_id, provider, session_date, status) VALUES (?, 'alpaca_sip', ?, 'running')",
        [run_id, session],
    )
    bar_count = 0
    issue_count = 0
    try:
        for symbols in batched(store.symbols(), batch_size):
            bars = provider.get_daily_bars(symbols, session, session)
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
            [len(store.symbols()), bar_count, issue_count, run_id],
        )
    except Exception as exc:
        store.connection.execute(
            "UPDATE data_ingest_runs SET completed_at=current_timestamp, status='failed', detail=? WHERE run_id=?",
            [str(exc)[:2_000], run_id],
        )
        raise
    return {"run_id": run_id, "bars": bar_count, "issues": issue_count}
