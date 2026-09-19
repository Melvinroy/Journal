from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

from brontide_eod.scanner import DEFAULT_MIN_ADR_PERCENT, DEFAULT_MIN_GROWTH_RANK
from brontide_eod.tc2000 import fingerprint, load_tc2000_universes


def reconcile_fixture(
    database: Path,
    fixture: Path,
    *,
    dollar_threshold: float,
    growth_rank_threshold: float = DEFAULT_MIN_GROWTH_RANK,
    output: Path | None = None,
) -> dict[str, object]:
    reference = json.loads(fixture.read_text(encoding="utf-8"))
    session = date.fromisoformat(reference["evaluation_session"])
    result_list = reference.get("result_list") or {}
    if result_list:
        exported = load_tc2000_universes(fixture)
        source_symbols = exported.result_symbols
        if exported.evaluation_session != session:
            raise ValueError("TC2000 export evaluation session is inconsistent")
    else:
        source_symbols = reference.get("symbols")
    if not source_symbols:
        raise ValueError("Reconciliation reference contains no result symbols")
    baseline = list(dict.fromkeys(str(symbol).upper() for symbol in source_symbols))
    baseline_kind = "complete_tc2000_export" if result_list else "historical_90_symbol_transcription"
    connection = duckdb.connect(str(database), read_only=True)
    try:
        publication = connection.execute(
            """
            SELECT publication_id,formula_version,universe_fingerprint,calendar_fingerprint,manifest_json
            FROM eod_publications WHERE data_through_session=? ORDER BY published_at DESC LIMIT 1
            """, [session],
        ).fetchone()
        if not publication:
            raise ValueError(f"No Scanner publication exists for {session.isoformat()}")
        rows = connection.execute(
            """
            SELECT symbol,dollar_volume,growth_percent,adr_percent,growth_rank
            FROM scanner_measurements WHERE publication_id=? AND scanner_key='biggest-one-month'
            ORDER BY growth_percent DESC,symbol
            """, [publication[0]],
        ).fetchall()
        metrics = {
            row[0]: {"dollar_volume": row[1], "growth_percent": row[2], "adr_percent": row[3], "growth_rank": row[4]}
            for row in rows
        }
        exclusions = {
            row[0]: {"category": row[1], "detail": row[2]}
            for row in connection.execute(
                "SELECT symbol,reason,detail FROM scanner_exclusions WHERE publication_id=? AND scanner_key='biggest-one-month'",
                [publication[0]],
            ).fetchall()
        }
        resolved = {
            row[0]
            for row in connection.execute(
                "SELECT symbol FROM instruments WHERE symbol IN (SELECT unnest(?::VARCHAR[]))", [baseline]
            ).fetchall()
        }
    finally:
        connection.close()

    generated = sorted(
        symbol for symbol, row in metrics.items()
        if row["dollar_volume"] > dollar_threshold
        and row["adr_percent"] > DEFAULT_MIN_ADR_PERCENT
        and row["growth_rank"] is not None
        and row["growth_rank"] >= growth_rank_threshold
    )
    generated_set, baseline_set = set(generated), set(baseline)
    detail: list[dict[str, object]] = []
    for symbol in baseline:
        row = metrics.get(symbol)
        if row:
            failures = []
            if row["dollar_volume"] <= dollar_threshold:
                failures.append("dollar_volume")
            if row["adr_percent"] <= DEFAULT_MIN_ADR_PERCENT:
                failures.append("adr_percent")
            if row["growth_rank"] is None or row["growth_rank"] < growth_rank_threshold:
                failures.append("growth_rank")
            category = "matched" if not failures else "actual_rule_failure"
            detail.append({"symbol": symbol, **row, "eligible": not failures, "category": category, "rule_failures": failures})
        elif symbol not in resolved:
            detail.append({"symbol": symbol, "eligible": False, "category": "unresolved_symbol", "rule_failures": []})
        else:
            excluded = exclusions.get(symbol, {"category": "unknown", "detail": "No ranked measurement is available."})
            category = "missing_data" if excluded["category"] in {"missing_data", "missing_history", "invalid_values"} else "universe_difference"
            detail.append({"symbol": symbol, "eligible": False, "category": category,
                           "exclusion": excluded, "rule_failures": []})

    overlap = len(generated_set & baseline_set)
    precision = overlap / len(generated_set) if generated_set else 0.0
    recall = overlap / len(baseline_set) if baseline_set else 0.0
    manifest = json.loads(publication[4]) if publication[4] else {}
    scanner_universe = manifest.get("scanner_universe") or {}
    missing_candidates = set(scanner_universe.get("missing_candidate_symbols") or [])
    differences: list[dict[str, object]] = []
    for symbol in sorted(baseline_set - generated_set):
        row = metrics.get(symbol)
        reasons: list[str] = []
        if symbol in missing_candidates:
            reasons.append("candidate_membership")
        if row is None:
            excluded = exclusions.get(symbol) or {}
            if excluded.get("category") in {"missing_data", "missing_history", "invalid_values"}:
                reasons.append("missing_bars")
            elif not reasons:
                reasons.append("ranking_membership" if excluded.get("category") == "rank_population" else "unknown")
        else:
            if row["dollar_volume"] <= dollar_threshold:
                reasons.append("dollar_volume")
            if row["adr_percent"] <= DEFAULT_MIN_ADR_PERCENT:
                reasons.append("adr")
            if row["growth_rank"] is None:
                reasons.append("ranking_membership")
            elif row["growth_rank"] < growth_rank_threshold:
                reasons.append("rank")
            if reasons:
                reasons.append("population_or_formula_difference")
        differences.append({"symbol": symbol, "side": "missing_from_brontide", "reasons": reasons,
                            "metrics": row, "exclusion": exclusions.get(symbol)})
    for symbol in sorted(generated_set - baseline_set):
        differences.append({"symbol": symbol, "side": "additional_in_brontide",
                            "reasons": ["population_or_formula_difference"], "metrics": metrics.get(symbol)})

    result = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_session": session.isoformat(),
        "threshold_label": f"${dollar_threshold:,.0f} comparison",
        "thresholds": {"min_dollar_volume": dollar_threshold, "min_adr_percent": DEFAULT_MIN_ADR_PERCENT,
                       "min_growth_rank": growth_rank_threshold},
        "baseline": {"kind": baseline_kind, "path": str(fixture), "count": len(baseline),
                     "fingerprint": fingerprint(baseline)},
        "baseline_count": len(baseline), "full_list_count": len(baseline), "generated_count": len(generated),
        "overlap_count": overlap,
        "precision": precision,
        "recall": recall,
        "missing_from_generated": sorted(baseline_set - generated_set),
        "additional_generated": sorted(generated_set - baseline_set),
        "unresolved_symbols": sorted(baseline_set - resolved),
        "publication": {"publication_id": str(publication[0]), "formula_version": publication[1],
                        "universe_fingerprint": publication[2], "calendar_fingerprint": publication[3],
                        "scanner_universe": scanner_universe},
        "assumptions": [
            "Growth mirrors TC2000 C/MinL22 using split-adjusted daily bars.",
            "ADR mirrors the captured 21-term expression divided by 20.",
            "TC2000 exports control candidate and rank membership when configured; Alpaca SIP controls OHLCV.",
        ],
        "differences": differences,
        "baseline_symbols": detail,
    }
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
        temporary.replace(output)
    return result
