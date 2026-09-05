"""Immutable, content-addressed research objects, separate from ingestion DuckDB.

The interface can be implemented with PostgreSQL or object storage later.
Publishing an object never changes an existing result or opens an ingestion writer.
"""
from __future__ import annotations
import gzip
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Protocol
from brontide_eod.scan_engine import fingerprint


class ResearchRepository(Protocol):
    def publish(self, payload: dict) -> str: ...
    def get(self, run_id: str) -> dict: ...
    def list(self, kind: str, limit: int = 100) -> list[dict]: ...


class FileResearchRepository:
    def __init__(self, root: Path):
        self.root=Path(root)

    def publish(self, payload: dict) -> str:
        run_id=fingerprint(payload)
        self.root.mkdir(parents=True,exist_ok=True)
        target=self.root/f"{run_id}.json.gz"
        if target.exists():
            self.get(run_id)
            return run_id
        content=json.dumps(payload,sort_keys=True,separators=(",",":"),allow_nan=False,default=str).encode()
        with tempfile.NamedTemporaryFile(dir=self.root,prefix=".pending-",delete=False) as stream:
            temp=Path(stream.name)
            stream.write(gzip.compress(content,mtime=0));stream.flush();os.fsync(stream.fileno())
        try:
            try: os.link(temp,target)  # Atomic create-if-absent; never overwrite a result.
            except FileExistsError: self.get(run_id)
        finally:
            temp.unlink(missing_ok=True)
        return run_id

    def get(self, run_id: str) -> dict:
        if not re.fullmatch(r"[0-9a-f]{64}",run_id):
            raise ValueError("Invalid run identifier")
        with gzip.open(self.root/f"{run_id}.json.gz","rt") as stream:
            payload=json.load(stream)
        if fingerprint(payload)!=run_id:
            raise ValueError("Research object fingerprint mismatch")
        return {**payload,"run_id":run_id}

    def list(self, kind: str, limit: int = 100) -> list[dict]:
        if not self.root.exists(): return []
        rows=[]
        # Each run is immutable. A future adapter can index these manifests.
        for path in sorted(self.root.glob("*.json.gz"),key=lambda path:path.stat().st_mtime,reverse=True):
            if len(rows)>=limit: break
            run=self.get(path.name.removesuffix(".json.gz"))
            if run.get("kind")==kind:
                rows.append({"run_id":run["run_id"],"kind":kind,"manifest":run["manifest"],"summary":run.get("summary",{})})
        return rows
