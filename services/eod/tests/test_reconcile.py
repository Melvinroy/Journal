from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

from brontide_eod.models import Instrument
from brontide_eod.reconcile import reconcile_fixture
from brontide_eod.scanner import BIGGEST_ONE_MONTH_FORMULA_VERSION
from brontide_eod.store import DuckDBStore
from brontide_eod.tc2000 import TC2000_SCANNER_DEFINITION, TC2000_SOURCE_CATEGORIES


def test_reconcile_complete_export_reports_precision_recall_and_reasons(tmp_path):
    database = tmp_path / "published.duckdb"
    publication_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session = date(2026, 9, 11)
    now = datetime(2026, 9, 12, tzinfo=timezone.utc)
    with DuckDBStore(database) as store:
        store.upsert_instruments([
            Instrument(symbol, symbol, "NASDAQ", "us_equity", "active", True, False, symbol)
            for symbol in ("AAA", "BBB", "CCC")
        ])
        store.connection.execute(
            "INSERT INTO eod_update_runs VALUES (?, 'forced', ?, ?, 'succeeded', ?, '[]', 0, NULL)",
            [run_id, now, now, session],
        )
        manifest = json.dumps({"scanner_universe": {"source": "tc2000-export", "stale": False}})
        store.connection.execute(
            "INSERT INTO eod_publications VALUES (?, ?, ?, ?, ?, 'sip', '{}', 'universe', 'calendar', ?, 3, 3, 100, 0, ?)",
            [publication_id, run_id, now, session, session, BIGGEST_ONE_MONTH_FORMULA_VERSION, manifest],
        )
        store.connection.executemany(
            "INSERT INTO scanner_measurements VALUES (?, 'biggest-one-month', ?, ?, ?, ?, ?, ?, ?)",
            [
                (publication_id, BIGGEST_ONE_MONTH_FORMULA_VERSION, "AAA", session, 100_000_000, 20, 6, 99),
                (publication_id, BIGGEST_ONE_MONTH_FORMULA_VERSION, "BBB", session, 80_000_000, 30, 7, 99),
                (publication_id, BIGGEST_ONE_MONTH_FORMULA_VERSION, "CCC", session, 100_000_000, 25, 6, 99),
            ],
        )

    reference = tmp_path / "tc2000.json"
    reference.write_text(json.dumps({
        "schema_version": 1,
        "evaluation_session": session.isoformat(),
        "captured_at": "2026-09-12T00:00:00Z",
        "tc2000_version": "25.0.9571.21449",
        "scanner_definition": TC2000_SCANNER_DEFINITION,
        "candidate_universe": {"source_categories": list(TC2000_SOURCE_CATEGORIES),
                               "symbols": ["AAA", "BBB", "CCC"]},
        "rank_universe": {"symbols": ["AAA", "BBB", "CCC"]},
        "result_list": {"symbols": ["AAA", "BBB"]},
    }), encoding="utf-8")

    result = reconcile_fixture(database, reference, dollar_threshold=89_000_000)
    assert result["baseline"]["kind"] == "complete_tc2000_export"
    assert result["full_list_count"] == 2
    assert result["precision"] == 0.5
    assert result["recall"] == 0.5
    assert result["missing_from_generated"] == ["BBB"]
    assert result["additional_generated"] == ["CCC"]
    reasons = {item["symbol"]: item["reasons"] for item in result["differences"]}
    assert reasons["BBB"] == ["dollar_volume", "provider_data_difference"]
    assert reasons["CCC"] == ["provider_data_difference"]
