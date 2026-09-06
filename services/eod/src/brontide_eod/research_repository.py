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
from collections import OrderedDict
from copy import deepcopy
from threading import RLock
from typing import Protocol
from brontide_eod.scan_engine import fingerprint

# Cache verified content, never caller-owned dictionaries. Limits are serialized
# bytes and object count; file signatures are checked before every reuse.
_objects=OrderedDict()
_lock=RLock()
_budget=32*1024*1024


def signature(path):
    s=path.stat()
    return (s.st_size,s.st_mtime_ns,s.st_ctime_ns)


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
            self.indexed(target)
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
        self.indexed(target)
        return run_id

    def get(self, run_id: str) -> dict:
        if not re.fullmatch(r"[0-9a-f]{64}",run_id):
            raise ValueError("Invalid run identifier")
        path=self.root/f"{run_id}.json.gz"
        stamp=signature(path);key=(str(path.resolve()),stamp)
        with _lock:
            if key in _objects:
                _objects.move_to_end(key)
                return deepcopy(_objects[key][0])
            with gzip.open(path,"rb") as stream:raw=stream.read()
            payload=json.loads(raw)
            if fingerprint(payload)!=run_id or signature(path)!=stamp:
                raise ValueError("Research object fingerprint mismatch")
            result={**payload,"run_id":run_id}
            if len(raw)<=_budget:
                for old in [k for k in _objects if k[0]==key[0]]:_objects.pop(old)
                _objects[key]=(result,len(raw))
                while len(_objects)>16 or sum(v[1] for v in _objects.values())>_budget:_objects.popitem(last=False)
            return deepcopy(result)

    def stamp(self,run_id):
        if not re.fullmatch(r"[0-9a-f]{64}",run_id):raise ValueError("Invalid run identifier")
        return (str(self.root.resolve()),run_id,signature(self.root/f"{run_id}.json.gz"))

    def indexed(self,path):
        """Rebuildable summaries; malformed/stale sidecars are never authoritative."""
        from brontide_eod.research_analytics import analytics,VERSION
        run_id=path.name.removesuffix(".json.gz");stamp=list(signature(path))
        sidecar=self.root/".registry"/f"{run_id}.json"
        try:
            entry=json.loads(sidecar.read_text(encoding="utf-8"));checksum=entry.pop("checksum")
            if entry["stamp"]==stamp and entry["version"]==VERSION and fingerprint(entry)==checksum:return entry["row"]
        except (OSError,ValueError,KeyError,TypeError):pass
        run=self.get(run_id)
        row={"run_id":run_id,"kind":run.get("kind"),"manifest":run.get("manifest",{}),"summary":run.get("summary",{})}
        if run.get("kind")=="backtest":row["analytics"]=analytics(run)
        entry={"stamp":stamp,"version":VERSION,"row":row};entry["checksum"]=fingerprint(entry)
        sidecar.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=sidecar.parent,delete=False,mode="w",encoding="utf-8") as f:
            temporary=Path(f.name);json.dump(entry,f,separators=(",",":"));f.flush();os.fsync(f.fileno())
        os.replace(temporary,sidecar)
        return row

    def initialize_index(self):
        for path in self.root.glob("*.json.gz"):self.indexed(path)

    def list(self, kind: str, limit: int = 100) -> list[dict]:
        if not self.root.exists(): return []
        rows=[]
        # Directory discovery notices new offline publications without stale TTLs.
        for path in sorted(self.root.glob("*.json.gz"),key=lambda path:path.stat().st_mtime,reverse=True):
            if len(rows)>=limit: break
            run=self.indexed(path)
            if run.get("kind")==kind:
                rows.append(run)
        return rows
