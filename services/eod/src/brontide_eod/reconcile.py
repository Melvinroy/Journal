from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

from brontide_eod.scanner import DEFAULT_MIN_ADR_PERCENT, DEFAULT_MIN_GROWTH_RANK


def reconcile_fixture(
    database: Path,
    fixture: Path,
    *,
    dollar_threshold: float,
    output: Path | None = None,
) -> dict[str, object]:
    reference = json.loads(fixture.read_text(encoding="utf-8"))
    session = date.fromisoformat(reference["evaluation_session"])
    baseline = list(dict.fromkeys(str(symbol).upper() for symbol in reference["symbols"]))
    connection = duckdb.connect(str(database), read_only=True)
    try:
        publication = connection.execute(
            """
            SELECT publication_id,formula_version,universe_fingerprint,calendar_fingerprint
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
        and row["growth_rank"] >= DEFAULT_MIN_GROWTH_RANK
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
            if row["growth_rank"] is None or row["growth_rank"] < DEFAULT_MIN_GROWTH_RANK:
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

    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_session": session.isoformat(),
        "threshold_label": "$9M product" if dollar_threshold == 9_000_000 else "$89M screenshot literal",
        "thresholds": {"min_dollar_volume": dollar_threshold, "min_adr_percent": DEFAULT_MIN_ADR_PERCENT,
                       "min_growth_rank": DEFAULT_MIN_GROWTH_RANK},
        "baseline_count": len(baseline), "generated_count": len(generated),
        "overlap_count": len(generated_set & baseline_set),
        "missing_from_generated": sorted(baseline_set - generated_set),
        "additional_generated": sorted(generated_set - baseline_set),
        "unresolved_symbols": sorted(baseline_set - resolved),
        "publication": {"publication_id": str(publication[0]), "formula_version": publication[1],
                        "universe_fingerprint": publication[2], "calendar_fingerprint": publication[3]},
        "assumptions": [
            "TC2000 Rank Against universe is unknown; Brontide ranks the full eligible supported universe.",
            "Growth uses split-only 21-session return; dividend treatment may differ from TC2000.",
            "ADR20% uses mean(high/low - 1); TC2000 screenshot does not establish this normalization.",
        ],
        "baseline_symbols": detail,
    }
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
        temporary.replace(output)
    return result
