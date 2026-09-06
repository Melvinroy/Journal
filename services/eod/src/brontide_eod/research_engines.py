"""Shared frozen-input contract and independent engine adapters for the bounded pilot."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
import json
import subprocess
import sys
import time
import duckdb
from brontide_eod.backtest_engine import backtest
from brontide_eod.features import features
from brontide_eod.feature_cache import FeatureCache
from brontide_eod.scan_engine import definitions, scan, fingerprint
from brontide_eod.research_pilot import LEAN_REVISION, peak_memory, write_inputs
from brontide_eod.research_analytics import analytics

ROOT = Path(__file__).resolve().parents[4]
PILOT = ROOT / "output/lean-pilot"
STRATEGY = "EP-2x-rvol95"
SYMBOLS = "APH BRIE DXR EVGN FCB GMED HYLB IWX KOF NRUC NYXH PFIG SDOT SLMT SPXS URI USMV VNIE XLKI YDEC".split()
VERSION = "dual-engine-1"


@dataclass(frozen=True)
class FrozenInput:
    manifest: dict
    sessions: list[str]
    bars: dict[str, list[dict]]
    benchmark: list[dict]


class Engine(Protocol):
    def run(self, spec: FrozenInput, destination: Path) -> dict: ...


class Timing:
    def __init__(self): self.phases = {}
    def measure(self, name, operation):
        start, cpu = time.perf_counter(), time.process_time()
        result = operation()
        self.phases[name] = {"wall_seconds": time.perf_counter()-start, "cpu_seconds": time.process_time()-cpu,
                             "process_peak_bytes": peak_memory()}
        return result


def implementation_identity():
    files = [Path(__file__), Path(__file__).with_name("research_comparison.py"),
             Path(__file__).with_name("research_comparison_jobs.py"),
             *[Path(__file__).with_name(n) for n in ("features.py", "feature_cache.py", "scan_engine.py", "backtest_engine.py", "research_analytics.py", "research_metrics.json", "research_pilot.py")],
             *[ROOT / "scripts/lean-pilot" / n for n in ("PilotAlgorithm.cs", "PilotAlgorithm.csproj", "Directory.Build.props", "run.py")]]
    return {"adapter": VERSION, "lean_revision": LEAN_REVISION,
            "source_fingerprint": fingerprint({p.name: p.read_text() for p in files})}


def eligibility(run):
    m = run.get("manifest", {})
    if m.get("engine", {}).get("id", "current") != "current": return "Select a Current engine run to start a comparison."
    if m.get("strategy", {}).get("id") != STRATEGY: return "LEAN comparison currently supports EP-2x-rvol95 only."
    if (m.get("start"), m.get("end")) != ("2025-11-12", "2025-12-11") or m.get("symbols") != SYMBOLS or m.get("universe_count") != 20:
        return "Select the 20-symbol pilot dated Nov 12–Dec 11, 2025. Larger runs are outside this pilot."
    if m.get("strategy") != next(d for d in definitions(3) if d.id == STRATEGY).manifest(): return "This saved strategy definition differs from the supported pilot."
    if m.get("source") != "alpaca_sip" or m.get("adjustment") != "all" or not m.get("scan_run_id"):
        return "The pilot requires recorded source scans and frozen SIP all-adjusted data."
    return None


def load_frozen(run, db_path, timing):
    m = run["manifest"]
    def load():
        with duckdb.connect(str(db_path), read_only=True) as db:
            cfg = db.execute("SELECT calendar_fingerprint,universe_fingerprint FROM ingestion_configs WHERE config_fingerprint=?", [m["config_fingerprint"]]).fetchone()
            if not cfg or cfg[0] != m["calendar_fingerprint"] or cfg[1] != m["parent_universe_fingerprint"]:
                raise ValueError("Frozen calendar or universe configuration changed; comparison stopped.")
            universe = [r[0] for r in db.execute("SELECT symbol FROM universe_memberships WHERE universe_fingerprint=?", [cfg[1]]).fetchall()]
            chosen = sorted(sorted(universe, key=lambda s: fingerprint(["lean-pilot-1", s]))[:20])
            if chosen != SYMBOLS: raise ValueError("Deterministic universe selection changed.")
            sessions = [str(r[0]) for r in db.execute("SELECT session_date FROM market_calendar_sessions WHERE calendar_fingerprint=? AND session_date<=? ORDER BY session_date", [cfg[0], m["end"]]).fetchall()]
            def bars(symbol):
                return [dict(zip(("session_date", "open", "high", "low", "close", "volume"), r)) for r in db.execute(
                    "SELECT session_date,open,high,low,close,volume FROM daily_bars WHERE symbol=? AND source='alpaca_sip' AND timeframe='1Day' AND adjustment='all' AND quality_status='ready' AND session_date<=? ORDER BY session_date", [symbol, m["end"]]).fetchall()]
            return FrozenInput(m, sessions, {s: bars(s) for s in SYMBOLS}, bars("SPY"))
    spec = timing.measure("database_reads", load)
    if fingerprint(spec.bars) != m["data_fingerprint"] or not spec.sessions or spec.sessions[0] != m["warmup_start"]:
        raise ValueError("Saved input fingerprint or warm-up no longer matches the database; comparison stopped.")
    return spec


class CurrentEngine:
    def run(self, spec, destination):
        timer = Timing()
        definition = next(d for d in definitions(3) if d.id == STRATEGY)
        benchmark = {r["session_date"]: r.get("return20") for r in features(spec.benchmark, spec.sessions)}
        def recompute(): return {s: features(b, spec.sessions, benchmark) for s, b in spec.bars.items() if b}
        core = timer.measure("feature_recomputation", recompute)
        cache = FeatureCache(destination / "features")
        def cached(): return {s: cache.compute(s, b, spec.sessions, benchmark) for s, b in spec.bars.items() if b}
        cold = timer.measure("cold_cache", cached)
        warm = timer.measure("warm_cache", cached)
        if core != cold or core != warm: raise ValueError("Feature cache and recomputation disagree.")
        signals = timer.measure("scanning", lambda: [r for s, f in core.items() for r in scan(s, f, definition)["signals"] if spec.manifest["start"] <= r["setup_date"] <= spec.manifest["end"]])
        result = timer.measure("simulation", lambda: backtest(signals, spec.bars, spec.sessions, definition))
        return {**result, "signals": signals, "coverage": [{"symbol": s, "reason": "No ready bars"} for s, b in spec.bars.items() if not b],
                "engine": {"id": "current", "label": "Current engine", **implementation_identity()}, "timing": timer.phases}


class LeanEngine:
    def run(self, spec, destination):
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PILOT / "Lean", text=True).strip()
        dirty = subprocess.check_output(["git", "diff", "HEAD", "--name-only"], cwd=PILOT / "Lean", text=True).strip()
        if revision != LEAN_REVISION or dirty: raise ValueError("LEAN must use the clean pinned source revision.")
        started = time.perf_counter()
        with (destination / "build.log").open("w") as log:
            subprocess.run([str(PILOT / "dotnet/dotnet.exe"), "build", str(ROOT / "scripts/lean-pilot/PilotAlgorithm.csproj"), "-c", "Release", "--no-restore"],
                           stdout=log, stderr=subprocess.STDOUT, timeout=180, check=True, cwd=ROOT)
        build_seconds = time.perf_counter()-started
        def execute(case, bars, only):
            folder = destination / case
            write_inputs(folder, bars, spec.sessions, spec.manifest["start"], spec.manifest["end"])
            settings = json.loads((folder / "settings.json").read_text()); settings["execute_only"] = only
            (folder / "settings.json").write_text(json.dumps(settings))
            subprocess.run([sys.executable, str(ROOT / "scripts/lean-pilot/run.py"), "--evidence", str(destination), "--case", case],
                           check=True, timeout=200, stdout=subprocess.DEVNULL)
            return json.loads((destination / f"lean-{case}.json").read_text()), json.loads((destination / f"native-{case}/timing.json").read_text())
        discovery, discovery_time = execute("discovery", spec.bars, "none")
        if not discovery.get("closes"): raise ValueError("LEAN did not process historical bars.")
        signals = discovery["signals"]
        # Each independent signal has its own account, even if trades overlap.
        replays, trades, timings = [], [], []
        for index, signal in enumerate(signals):
            symbol, day = signal["symbol"], signal["setup_date"]
            native, timing = execute(f"trade-{index}", {symbol: spec.bars[symbol]}, f"{symbol}/{day}")
            if len(native["trades"]) != 1: raise ValueError("Independent LEAN replay did not produce one trade record.")
            replays.append(native); timings.append(timing)
            trades.append(normalize_trade(native["trades"][0], spec.sessions))
        return {"signals": [{**s, "strategy_id": STRATEGY} for s in signals], "trades": trades,
                "coverage": [{"symbol": s, "reason": "No ready bars"} for s, b in spec.bars.items() if not b],
                "engine": {"id": "lean", "label": "LEAN", **implementation_identity()},
                "execution": {"version": "lean-native-independent-1", "capital": "Separate account per signal; one share; net R normalized by setup ATR",
                              "same_bar_policy": "Native order processing and OCO cancellation; daily intrabar order unknown",
                              "fees": "10 bps of contemporaneous security price per side", "slippage": "Default native model", "price_rounding": "Native tick rounding",
                              "maximum_hold": "Market order after session-60 close; native fill may occur next open"},
                "native": {"discovery": discovery, "independent_replays": replays, "statistics_scope": "Native statistics belong to each replay; not a combined funded portfolio"},
                "timing": {"build_wall_seconds": build_seconds, "discovery": discovery_time, "replays": timings,
                           "native_cpu_seconds": discovery["cpu_seconds"]+sum(r["cpu_seconds"] for r in replays),
                           "native_peak_bytes": max([discovery["peak_working_set_bytes"]]+[r["peak_working_set_bytes"] for r in replays])}}


def normalize_trade(native, sessions):
    n = native
    entered = bool(n.get("entry_date")); closed = n["status"] == "Closed"
    entry, exit = n.get("entry_date"), n.get("exit_date")
    holding = sessions.index(exit)-sessions.index(entry)+1 if entry in sessions and exit in sessions else None
    return {"trade_id": fingerprint(["lean", n["symbol"], n["setup_date"]]), "signal_id": None,
            "strategy_id": STRATEGY, "symbol": n["symbol"], "setup_date": n["setup_date"], "status": n["status"],
            "entry_date": entry, "exit_date": exit, "entry": n["entry"] if entered else None, "exit": n["exit"] if closed else None,
            "setup_atr": n["atr"], "stop": n["stop"] if entered else None, "target": n["target"] if entered else None,
            "outcome_r": n.get("net_r") if closed else None, "fees_per_share": n["fees"] if closed else None,
            "recorded_fees_per_share": n["fees"], "hold_sessions": holding, "exit_reason": {"stop": "Stop", "target": "Target", "hold": "Maximum hold"}.get(n.get("reason"), n.get("reason")),
            "mfe_r": None, "mae_r": None, "ambiguous": None,
            "unavailable": {"mfe_r": "Conservative path bounds are not recorded by the native adapter", "mae_r": "Conservative path bounds are not recorded by the native adapter", "ambiguous": "Native execution does not establish intrabar order"}}
