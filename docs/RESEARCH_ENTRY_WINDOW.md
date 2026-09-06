# Entry-containing 30-day backtest

Follow-up requested September 7, 2026. Strategy: **EP-2x-rvol95**.

The latest recorded entry among the original deterministic 20 symbols was GMED on **November 13, 2025**, following its November 12 setup (EP on November 7). The test window was moved to **November 12–December 11, 2025**, keeping all 20 symbols unchanged and loading earlier frozen bars for warm-up. Selection used the existence/date of an entry, not whether it won. This is deliberately an entry-containing engineering check, not an unbiased strategy-performance sample.

| Result | Current engine | Pinned LEAN |
|---|---:|---:|
| Qualifying signals | 1 | 1 |
| Symbol | GMED | GMED |
| Setup | 2025-11-12 | 2025-11-12 |
| Entry | 2025-11-13 | 2025-11-13 |
| Entry price | $84.31 | $84.31 |
| Exit | 2025-11-14 | 2025-11-14 |
| Exit reason | Stop | Stop |
| Exit price | $81.12919194 | $81.13 |
| Modeled costs per share | $0.16543919 | $0.16876 |
| Net R | -1.05201169R | -1.05280166R |

Both engines independently identified the same setup and ATR and agreed on entry and exit dates. The **0.00078997R** difference is fully explained by native cent rounding and fee basis: LEAN's declared fee model uses the contemporaneous security price; the current simulator uses the actual modeled fill price. All position activity in this window belongs to one independent trade, so there is no netting/overlap conflict in this comparison.

Current-engine window statistics: 1 entered/closed trade, 0 winners, 1 loser, 0 open/unresolved trades, 0% win rate, -1.0520R expectancy and total R, and 1.0520R closed-trade drawdown. One of 20 symbols (FCB) has no ready bars. No forced end-window exits. One losing observation is not a strategy-quality conclusion.

Preparation including both cache paths and fixtures took 3.777 seconds; the direct native launcher took 10.369 seconds, including startup and warm-up. These are different work scopes and are not a throughput comparison.

The current-engine result is saved as a new immutable run in **Research Runs**, dated November 12–December 11. Its recorded source scan was joined only after the recalculated signal identity and every measurement matched the original source (numeric tolerance 1e-9). Original runs and the frozen market database were not rewritten.

Run ID: `7e8bfcfab47ff7cd911f2631811e0a2a9832da79f272499e5711eed63ffe0c8d`.

[Machine-readable comparison](research-entry-window-evidence.json). Raw input files and native events: `output/lean-pilot/entry-window-2025-11-12/`.

Recompute into a fresh output directory from `services/eod`:

```powershell
.venv/Scripts/python.exe -m brontide_eod.research_pilot --end 2025-12-11 --output ../../output/lean-pilot/entry-window-reproduction
```

Then from the project root:

```powershell
services/eod/.venv/Scripts/python.exe scripts/lean-pilot/run.py --evidence output/lean-pilot/entry-window-reproduction --case real
```

The original fixed-latest-window result remains documented separately. This follow-up adds one real-trade execution check and supports the same recommendation: retain the current engine, using LEAN as an independent validator.
