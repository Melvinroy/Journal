"""Local asynchronous comparison jobs; saved research remains immutable."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import uuid
from brontide_eod.research_repository import FileResearchRepository
from brontide_eod.research_engines import (CurrentEngine, LeanEngine, Timing, eligibility, implementation_identity, load_frozen, PILOT)
from brontide_eod.research_comparison import compare_results, key, same
from brontide_eod.scan_engine import fingerprint


def now(): return datetime.now(timezone.utc).isoformat()


def write_state(path, data):
    tmp = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


@contextmanager
def exclusive(path):
    """OS lock survives API restarts while an old worker finishes, preventing overlap."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as file:
        file.seek(0); file.write(b"0"); file.flush(); file.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try: yield
        finally:
            file.seek(0)
            if os.name == "nt": msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(file.fileno(), fcntl.LOCK_UN)


class ComparisonJobs:
    def __init__(self, repository, db_path):
        self.repository, self.db_path = repository, Path(db_path).resolve()
        self.root = repository.root / "comparison-jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.children = {}
        for path in self.root.glob("*/state.json"):
            state = json.loads(path.read_text())
            if state["status"] == "Running":
                write_state(path, {**state, "status": "Failed", "reason": "Interrupted by local service restart; retry explicitly.", "updated_at": now()})

    def status(self, run):
        reason = eligibility(run)
        if reason: return {"status": "Unsupported", "reason": reason}
        cache_key = fingerprint({"source_run_id": run["run_id"], **implementation_identity()})
        found = []
        for path in self.root.glob("*/state.json"):
            state = json.loads(path.read_text())
            if state.get("cache_key") == cache_key: found.append(state)
        if found: return max(found, key=lambda s: s["created_at"])
        return {"status": "Not run", "reason": "Compare independent signals and native execution on the same frozen 20-symbol inputs."}

    def start(self, run):
        with self.lock:
            status = self.status(run)
            if status["status"] == "Unsupported": raise ValueError(status["reason"])
            if status["status"] in ("Running", "Completed"): return status
            if any(json.loads(p.read_text())["status"] == "Running" for p in self.root.glob("*/state.json")):
                raise RuntimeError("A LEAN comparison is already running. Try again when it finishes.")
            required = [PILOT / "dotnet/dotnet.exe", PILOT / "Lean/Launcher/bin/Release/QuantConnect.Lean.Launcher.dll"]
            if not all(p.is_file() for p in required): raise ValueError("Local pinned LEAN runtime is unavailable; follow scripts/lean-pilot/README.md.")
            job_id = uuid.uuid4().hex
            folder = self.root / job_id; folder.mkdir()
            state = {"job_id": job_id, "source_run_id": run["run_id"], "status": "Running", "reason": "Verifying inputs, then running independent LEAN discovery and trade replay.",
                     "cache_key": fingerprint({"source_run_id": run["run_id"], **implementation_identity()}),
                     "implementation": implementation_identity(), "created_at": now(), "updated_at": now()}
            write_state(folder / "state.json", state)
            try:
                with (folder / "worker.log").open("w") as log:
                    child = subprocess.Popen([sys.executable, "-m", "brontide_eod.research_comparison_jobs", "--repository", str(self.repository.root.resolve()), "--db", str(self.db_path), "--job", job_id],
                                             stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                self.children[job_id] = child
                threading.Thread(target=self._watch, args=(job_id, child), daemon=True).start()
            except OSError:
                state = {**state, "status": "Failed", "reason": "Could not start local comparison worker.", "updated_at": now()}
                write_state(folder / "state.json", state)
            return state

    def _watch(self, job_id, child):
        child.wait()
        path = self.root / job_id / "state.json"
        with self.lock:
            state = json.loads(path.read_text())
            if state["status"] == "Running": write_state(path, {**state, "status": "Failed", "reason": "Comparison worker stopped unexpectedly; inspect its local worker log.", "updated_at": now()})
            self.children.pop(job_id, None)


def work(repo_root, db_path, job_id):
    repository = FileResearchRepository(repo_root)
    root = repo_root / "comparison-jobs"; folder = root / job_id; path = folder / "state.json"
    state = json.loads(path.read_text())
    try:
        with exclusive(root / "engine.lock"):
            source = repository.get(state["source_run_id"])
            if eligibility(source): raise ValueError(eligibility(source))
            timer = Timing(); spec = load_frozen(source, db_path, timer)
            inputs = {"manifest": spec.manifest, "sessions_fingerprint": fingerprint(spec.sessions), "benchmark_fingerprint": fingerprint(spec.benchmark),
                      "data_fingerprint": fingerprint(spec.bars), "symbols": list(spec.bars), "warmup_start": spec.sessions[0]}
            current = CurrentEngine().run(spec, folder)
            # Earlier source trades must reproduce before native results are compared.
            old, new = {key(t): t for t in source["trades"]}, {key(t): t for t in current["trades"]}
            if old.keys() != new.keys() or any(not same(t.get(field), new[k].get(field)) for k,t in old.items() for field in t):
                raise ValueError("Current engine no longer reproduces the saved trade ledger; comparison stopped.")
            scan = repository.get(source["manifest"]["scan_run_id"])
            source_signals = {s["signal_id"]: s for s in scan["signals"]}
            for signal in current["signals"]:
                recorded = source_signals.get(signal["signal_id"])
                if not recorded or any(not same(v, recorded.get("measurements", {}).get(k)) for k,v in signal["measurements"].items()):
                    raise ValueError("Current features differ from the recorded source scan; comparison stopped.")
            lean = LeanEngine().run(spec, folder)
            current["manifest"] = source["manifest"]
            lean["manifest"] = {**source["manifest"], "engine": lean["engine"], "parent_run_id": source["run_id"],
                                "scan_run_id": None, "execution_fingerprint": fingerprint(lean["execution"])}
            result = compare_results(current, lean)
            # A restart or source edit invalidates in-flight publication.
            if json.loads(path.read_text())["status"] != "Running": return
            if state["implementation"] != implementation_identity(): raise ValueError("Engine implementation changed during the job; retry with stable sources.")
            lean_id = timer.measure("lean_publication", lambda: repository.publish({"kind": "engine_result", **lean, "shared_inputs": inputs}))
            report = {"kind": "engine_comparison", "source_run_id": source["run_id"], "lean_run_id": lean_id, "implementation": state["implementation"],
                      "shared_inputs": inputs, **result, "timing": {"preparation": timer.phases, "current": current["timing"], "lean": lean["timing"]},
                      "execution": {"current": current["execution"], "lean": lean["execution"]},
                      "limitations": ["30 days and one observed real trade do not establish strategy reliability.", "Custom pre-adjusted OHLC does not validate corporate actions or point-in-time eligibility.", "Native discovery and separate replay include repeated warm-up; their total time is not a like-for-like speed benchmark."]}
            report_id = repository.publish(report)
            write_state(path, {**state, "status": "Completed", "reason": "Comparison saved. Review classified differences and any unresolved discrepancies.", "report_id": report_id, "lean_run_id": lean_id, "updated_at": now()})
    except Exception as error:
        # Preserve details locally; never return local filesystem paths or subprocess commands to the browser.
        import traceback
        traceback.print_exc()
        existing = json.loads(path.read_text())
        if existing["status"] == "Running":
            reason = str(error) if isinstance(error, ValueError) else "Local comparison failed; inspect worker.log and native launcher logs, then retry."
            write_state(path, {**state, "status": "Failed", "reason": reason, "updated_at": now()})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True); parser.add_argument("--db", type=Path, required=True); parser.add_argument("--job", required=True)
    args = parser.parse_args()
    if len(args.job) != 32 or any(c not in "0123456789abcdef" for c in args.job): raise ValueError("Invalid job identifier")
    work(args.repository, args.db, args.job)
