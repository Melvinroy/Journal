"""Revision-aware instrument feature materialization, separate from EP contexts.

Unchanged instruments reuse immutable snapshots. A changed bar, calendar,
benchmark or formula invalidates that instrument and recomputes its history.
This deliberately preserves the ATR seed; it is not a streaming O(1) updater.
"""
from pathlib import Path
from brontide_eod.features import FEATURE_VERSION, features
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.scan_engine import fingerprint


class FeatureCache:
    def __init__(self, root: Path):
        self.root=Path(root)
        self.hits=0
        self.misses=0
        self.formula=fingerprint(Path(__file__).with_name("features.py").read_text())

    def compute(self, symbol, bars, sessions, benchmark=None):
        inputs={"symbol":symbol,"bars":fingerprint(bars),"calendar":fingerprint(sessions),
                "benchmark":fingerprint(benchmark),"feature_version":FEATURE_VERSION,"formula":self.formula}
        key=fingerprint(inputs)
        repository=FileResearchRepository(self.root/key)
        paths=list(repository.root.glob("*.json.gz")) if repository.root.exists() else []
        if paths:
            if len(paths)!=1:raise ValueError("Ambiguous feature snapshot")
            snapshot=repository.get(paths[0].name.removesuffix(".json.gz"))
            if snapshot["manifest"]!=inputs:raise ValueError("Feature input fingerprint mismatch")
            self.hits+=1
            return snapshot["rows"]
        rows=features(bars,sessions,benchmark)
        repository.publish({"kind":"features","manifest":inputs,"rows":rows})
        self.misses+=1
        return rows
