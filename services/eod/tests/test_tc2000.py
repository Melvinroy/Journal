from __future__ import annotations

import json
from datetime import date

import pytest

from brontide_eod.tc2000 import (
    TC2000_SCANNER_DEFINITION,
    fingerprint,
    load_tc2000_universes,
    read_symbol_export,
    write_tc2000_universe_export,
)


def test_loads_deduplicated_role_specific_universes(tmp_path):
    path = tmp_path / "tc2000.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "evaluation_session": "2026-09-11",
        "captured_at": "2026-09-14T03:00:00Z",
        "tc2000_version": "25.0.9571.21449",
        "scanner_definition": TC2000_SCANNER_DEFINITION,
        "candidate_universe": {
            "source_categories": ["US Common Stocks", "American Depositary Receipts - ADR", "Exchange Traded Funds"],
            "symbols": ["AAA", "ETF", "AAA"],
        },
        "rank_universe": {"symbols": ["AAA", "BBB"]},
        "result_list": {"symbols": ["ETF"]},
    }), encoding="utf-8")
    result = load_tc2000_universes(path)
    assert result.evaluation_session == date(2026, 9, 11)
    assert result.candidate_symbols == ("AAA", "ETF")
    assert result.rank_symbols == ("AAA", "BBB")
    assert result.candidate_fingerprint == fingerprint(("ETF", "AAA"))
    assert result.age_in_sessions([date(2026, 9, 11), date(2026, 9, 14)], date(2026, 9, 14)) == 1


def test_rejects_empty_or_invalid_universes(tmp_path):
    path = tmp_path / "tc2000.json"
    payload = {
        "schema_version": 1, "evaluation_session": "2026-09-11", "captured_at": "2026-09-14T03:00:00Z",
        "scanner_definition": TC2000_SCANNER_DEFINITION,
        "candidate_universe": {"symbols": []}, "rank_universe": {"symbols": ["AAA"]},
        "result_list": {"symbols": ["AAA"]},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="contains no symbols"):
        load_tc2000_universes(path)


def test_builds_candidate_union_from_role_exports(tmp_path):
    files = {}
    for name, text in {
        "common": "Symbol,Name\nAAA,Alpha\nBBB,Beta\n",
        "adrs": "Symbol\nADR\n",
        "etfs": "ETF\n",
        "rank": "Symbol\nAAA\nBBB\n",
        "results": "Symbol\nETF\n",
    }.items():
        files[name] = tmp_path / f"{name}.csv"
        files[name].write_text(text, encoding="utf-8")
    output = tmp_path / "universe.json"
    result = write_tc2000_universe_export(
        output, evaluation_session=date(2026, 9, 11), tc2000_version="25",
        common_stocks=files["common"], adrs=files["adrs"], etfs=files["etfs"],
        rank_universe=files["rank"], result_list=files["results"],
    )
    loaded = load_tc2000_universes(output)
    assert result["candidate_symbols"] == 4
    assert loaded.candidate_symbols == ("AAA", "BBB", "ADR", "ETF")
    assert [name for name, _ in loaded.source_memberships] == [
        "US Common Stocks", "American Depositary Receipts - ADR", "Exchange Traded Funds",
    ]


def test_reads_native_tc2000_clipboard_export(tmp_path):
    export = tmp_path / "clipboard.txt"
    export.write_text("Symbols from TC2000\nAAA\nBRK.B\nAAA\n", encoding="utf-8")

    assert read_symbol_export(export) == ("AAA", "BRK.B")


def test_rejects_a_different_scanner_definition(tmp_path):
    path = tmp_path / "tc2000.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "evaluation_session": "2026-09-11",
        "captured_at": "2026-09-14T03:00:00Z",
        "scanner_definition": {"formulas": {"growth_score": "C/C21"}},
        "candidate_universe": {"symbols": ["AAA"]},
        "rank_universe": {"symbols": ["AAA", "BBB"]},
        "result_list": {"symbols": ["AAA"]},
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="scanner_definition"):
        load_tc2000_universes(path)


def test_import_does_not_publish_a_result_outside_universal(tmp_path):
    files = {}
    for name, text in {
        "common": "AAA\n", "adrs": "ADR\n", "etfs": "ETF\n",
        "rank": "AAA\nBBB\n", "results": "OUTSIDE\n",
    }.items():
        files[name] = tmp_path / f"{name}.csv"
        files[name].write_text(text, encoding="utf-8")
    output = tmp_path / "universe.json"
    with pytest.raises(ValueError, match="outside the candidate universe"):
        write_tc2000_universe_export(
            output, evaluation_session=date(2026, 9, 11), tc2000_version="25",
            common_stocks=files["common"], adrs=files["adrs"], etfs=files["etfs"],
            rank_universe=files["rank"], result_list=files["results"],
        )
    assert not output.exists()
