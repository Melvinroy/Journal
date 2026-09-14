from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


TC2000_ADR_FORMULA = "100*((" + "+".join(f"H{index}/L{index}" for index in range(21)) + ")/20-1)"
TC2000_SOURCE_CATEGORIES = (
    "US Common Stocks",
    "American Depositary Receipts - ADR",
    "Exchange Traded Funds",
)
TC2000_SCANNER_DEFINITION = {
    "name": "B2 - Biggest One Month",
    "candidate_universe": "Universal",
    "rank_universe": "US Stocks",
    "all_conditions_must_pass": True,
    "formulas": {
        "dollar_volume": "C*V/100",
        "growth_score": "C/MinL22",
        "adr_percent": TC2000_ADR_FORMULA,
    },
    "thresholds": {
        "dollar_volume_scaled_strictly_greater_than": 890000,
        "dollar_volume_raw_strictly_greater_than": 89000000,
        "adr_percent_strictly_greater_than": 5,
        "growth_rank_minimum_inclusive": 93.77,
        "growth_rank_maximum_inclusive": 100,
    },
}


def _symbols(values: Iterable[object]) -> tuple[str, ...]:
    symbols = tuple(dict.fromkeys(str(value).strip().upper() for value in values if str(value).strip()))
    if not symbols:
        raise ValueError("TC2000 universe export contains no symbols")
    invalid = [symbol for symbol in symbols if not symbol.replace("-", "").replace(".", "").isalnum()]
    if invalid:
        raise ValueError(f"TC2000 universe export contains invalid symbols: {', '.join(invalid[:5])}")
    return symbols


def fingerprint(symbols: Iterable[str]) -> str:
    return hashlib.sha256("\n".join(sorted(set(symbols))).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TC2000Universes:
    evaluation_session: date
    captured_at: datetime
    tc2000_version: str
    candidate_symbols: tuple[str, ...]
    rank_symbols: tuple[str, ...]
    result_symbols: tuple[str, ...]
    source_categories: tuple[str, ...]
    source_memberships: tuple[tuple[str, tuple[str, ...]], ...]

    @property
    def candidate_fingerprint(self) -> str:
        return fingerprint(self.candidate_symbols)

    @property
    def rank_fingerprint(self) -> str:
        return fingerprint(self.rank_symbols)

    @property
    def result_fingerprint(self) -> str:
        return fingerprint(self.result_symbols)

    def age_in_sessions(self, sessions: Iterable[date], target: date) -> int:
        return sum(1 for session in sessions if self.evaluation_session < session <= target)


def load_tc2000_universes(path: Path) -> TC2000Universes:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError("Unsupported TC2000 universe export schema_version")
    candidate = payload.get("candidate_universe") or {}
    ranking = payload.get("rank_universe") or {}
    results = payload.get("result_list") or {}
    captured = datetime.fromisoformat(str(payload["captured_at"]).replace("Z", "+00:00"))
    if captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)
    if payload.get("scanner_definition") != TC2000_SCANNER_DEFINITION:
        raise ValueError("TC2000 export scanner_definition does not match the captured B2 configuration")
    sources = candidate.get("sources") or []
    source_memberships = tuple(
        (str(source.get("name") or ""), _symbols(source.get("symbols") or []))
        for source in sources
    )
    loaded = TC2000Universes(
        evaluation_session=date.fromisoformat(str(payload["evaluation_session"])),
        captured_at=captured,
        tc2000_version=str(payload.get("tc2000_version") or "unknown"),
        candidate_symbols=_symbols(candidate.get("symbols") or []),
        rank_symbols=_symbols(ranking.get("symbols") or []),
        result_symbols=_symbols(results.get("symbols") or []),
        source_categories=tuple(str(value) for value in candidate.get("source_categories") or []),
        source_memberships=source_memberships,
    )
    for label, section, symbols in (
        ("candidate", candidate, loaded.candidate_symbols),
        ("rank", ranking, loaded.rank_symbols),
        ("result", results, loaded.result_symbols),
    ):
        supplied = section.get("fingerprint")
        if supplied and supplied != fingerprint(symbols):
            raise ValueError(f"TC2000 {label} fingerprint does not match its symbols")
    if not set(loaded.result_symbols).issubset(loaded.candidate_symbols):
        raise ValueError("TC2000 result list contains symbols outside the candidate universe")
    if loaded.source_categories != TC2000_SOURCE_CATEGORIES:
        raise ValueError("TC2000 Universal source categories do not match the captured configuration")
    if not loaded.tc2000_version or loaded.tc2000_version == "unknown":
        raise ValueError("TC2000 version is required")
    if source_memberships:
        source_union = set().union(*(set(symbols) for _, symbols in source_memberships))
        if source_union != set(loaded.candidate_symbols):
            raise ValueError("TC2000 Universal membership does not match its source-category union")
        for source, section in zip(source_memberships, sources, strict=True):
            supplied = section.get("fingerprint")
            if supplied and supplied != fingerprint(source[1]):
                raise ValueError(f"TC2000 source fingerprint does not match its symbols: {source[0]}")
    return loaded


def read_symbol_export(path: Path) -> tuple[str, ...]:
    text = path.read_text(encoding="utf-8-sig")
    rows = list(csv.reader(text.splitlines()))
    if not rows:
        raise ValueError(f"TC2000 export is empty: {path.name}")
    header = [cell.strip().lower() for cell in rows[0]]
    symbol_index = header.index("symbol") if "symbol" in header else 0
    start = 1 if "symbol" in header else 0
    return _symbols(row[symbol_index] for row in rows[start:] if len(row) > symbol_index)


def write_tc2000_universe_export(
    output: Path,
    *,
    evaluation_session: date,
    tc2000_version: str,
    common_stocks: Path,
    adrs: Path,
    etfs: Path,
    rank_universe: Path,
    result_list: Path,
) -> dict[str, object]:
    common = read_symbol_export(common_stocks)
    adr = read_symbol_export(adrs)
    etf = read_symbol_export(etfs)
    candidate = _symbols((*common, *adr, *etf))
    ranking = read_symbol_export(rank_universe)
    results = read_symbol_export(result_list)
    payload = {
        "schema_version": 1,
        "evaluation_session": evaluation_session.isoformat(),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "tc2000_version": tc2000_version,
        "scanner_definition": TC2000_SCANNER_DEFINITION,
        "candidate_universe": {
            "name": "Universal",
            "source_categories": list(TC2000_SOURCE_CATEGORIES),
            "sources": [
                {"name": "US Common Stocks", "symbols": list(common), "fingerprint": fingerprint(common)},
                {"name": "American Depositary Receipts - ADR", "symbols": list(adr), "fingerprint": fingerprint(adr)},
                {"name": "Exchange Traded Funds", "symbols": list(etf), "fingerprint": fingerprint(etf)},
            ],
            "symbols": list(candidate),
            "fingerprint": fingerprint(candidate),
        },
        "rank_universe": {"name": "US Stocks", "symbols": list(ranking), "fingerprint": fingerprint(ranking)},
        "result_list": {"name": "B2 - Biggest One Month", "symbols": list(results), "fingerprint": fingerprint(results)},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        load_tc2000_universes(temporary)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {"output": str(output), "candidate_symbols": len(candidate), "rank_symbols": len(ranking),
            "result_symbols": len(results), "candidate_fingerprint": fingerprint(candidate),
            "rank_fingerprint": fingerprint(ranking), "result_fingerprint": fingerprint(results)}
