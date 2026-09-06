# Research UI with optional LEAN comparison

The current engine remains the default. In Strategies → Research Runs, select the **EP-2x-rvol95 / November 12–December 11, 2025** pilot and choose **View LEAN comparison**. The integrated job was started from the local UI and completed successfully. Other strategies and larger date/universe selections display Unsupported with a reason.

## Result

The same deterministic 20-symbol subset, all-adjusted SIP bars and warm-up from January 2, 2024 produced one GMED setup in both implementations. Nineteen symbols have bars; FCB has no ready bars. The current engine reproduced the immutable saved ledger and recorded source measurements before LEAN ran.

| Observation | Current engine | LEAN |
|---|---:|---:|
| Setup | November 12, 2025 | November 12, 2025 |
| Entry / exit | November 13 / November 14 | November 13 / November 14 |
| Entry | 84.31 USD | 84.31 USD |
| Exit | 81.1291919376 USD | 81.13 USD |
| Recorded round-trip costs per share | 0.1654391919 USD | 0.16876 USD |
| Net outcome | −1.0520116866 R | −1.0528016574 R |

Six field differences are classified, with **zero unresolved discrepancies**: exit rounding, costs, the reconciled net-R difference, and three unavailable native fields (ambiguity flag, conservative MFE and MAE). Unavailable native flags never imply zero ambiguous trades. The normalized aggregate formulas use the complete applicable ledger.

Source run: `7e8bfcfab47ff7cd911f2631811e0a2a9832da79f272499e5711eed63ffe0c8d`.

Comparison: `db4c78845f39902d41091584158d222e21438fc3289db017e3f887f38af45420`.

Native result: `138d0f3942f22acb1af2e82fbb75af4e494bcdf5fda36e5176cf5f56accf3ade`.

The complete normalized evidence is in [research-dual-engine-evidence.json](research-dual-engine-evidence.json). Original objects and exports were not rewritten.

## Interface and execution

- `FrozenInput` supplies the manifest, authoritative sessions, symbol bars and benchmark history to both adapters. Both return signals, trades, coverage, execution policy, timing and engine provenance. Native LEAN output remains alongside its normalized ledger.
- The saved data fingerprint, deterministic universe, configuration and warm-up are checked against read-only database inputs. Current trades and recorded scan measurements must reproduce before native execution proceeds. Changed input evidence fails explicitly.
- LEAN revision is pinned to `23b735d99a357807dc0df9f4c51d30f05fe0d277`; modified tracked LEAN source is rejected. The custom C# assembly is rebuilt from current source. No paid CLI, data download or portfolio migration is involved.
- Discovery runs the independent C# signal rules without orders. Each discovered signal then replays in its own account. Overlapping signals therefore cannot net together. No end-of-window liquidation is synthesized.
- `GET /v1/research/runs/{id}/lean-comparison` returns Not run, Running, Completed, Failed or Unsupported. GET never starts a job.
- `POST` to the same route starts an eligible job or reuses a matching result. It requires the explicit local-app header, a permitted origin when supplied, and a loopback client. The local development origins support POST through CORS.
- `GET /v1/research/comparisons/{id}` returns the immutable comparison. Existing run export routes also export the native result and comparison objects.
- Source run ID, pinned revision and implementation fingerprints determine reuse. The source ID already commits its strategy, execution and data fingerprints. Changes require a new comparison; older completed evidence remains immutable.
- Persisted job files and logs live under `services/eod/data/research/comparison-jobs`. A process lock prevents simultaneous native jobs. On service restart, unfinished jobs become Failed with an interruption reason. An old worker retains the process lock while finishing and checks status before publication; retry after it releases the lock.
- LEAN artifacts use `engine_result`, not the default `backtest` registry kind. The current-engine registry remains primary; LEAN evidence is reached through the comparison panel. Historical engine labels are read-time projections.

## UI and metrics

Research retains the original visual language, saved layouts, adjustable columns, four headline metrics, trade inspection and complete-ledger summaries. Engine comparison has Overview, Signals & trades, Metrics, and Assumptions & provenance sections. The native ledger and report are downloadable; raw records remain collapsed.

The shared [metric catalog](RESEARCH_METRICS.md) is the rendering contract. R statistics remain independent-trade observations. The panel explains native LEAN's treatment of breakeven, no-loss profit factor, signed drawdown and trade-level risk ratios. Portfolio CAGR, portfolio Sharpe/Sortino, equity drawdown, exposure and related metrics remain unavailable with their required inputs. Missing ambiguity flags now produce an unavailable aggregate rather than a false zero.

## Measured performance

These are observations from this local UI-triggered run, not normalized engine benchmarks. LEAN discovery and each independent replay include startup and historical warm-up.

| Phase | Wall seconds | Process CPU seconds |
|---|---:|---:|
| Database reads / frozen input preparation | 0.766 | 1.234 |
| Feature recomputation | 0.167 | 0.156 |
| Cold feature cache | 1.562 | 1.531 |
| Warm feature cache | 0.932 | 0.672 |
| Current scanning | 0.101 | 0.094 |
| Current simulation | 0.007 | below reported resolution |
| Native result publication | 0.011 | below reported resolution |
| Custom C# build | 3.326 | not separately measured |
| LEAN discovery including warm-up | 8.628 | included in native total |
| LEAN independent GMED replay | 9.070 | included in native total |

Native CPU total was 31.313 seconds across discovery and replay; peak native process memory was approximately 259.5 MiB. Current preparation high-water memory was approximately 162.0 MiB. Memory values are process high-water readings, not per-phase allocation measurements. Native replay timing includes scanning and execution; it is not pure fill-engine time. Publication timing covers the native artifact, excluding the final small comparison/status writes.

Cache hashing, validation and storage cost more than direct recomputation on this small sample. Existing defaults remain unchanged. These results do not establish that either engine is faster for full-universe or portfolio workloads.

## Validation and boundaries

- Known GMED signal, ATR, dates and accounting reconciliation passed through the actual UI-triggered job.
- Nine native fixtures passed: stop, gap, target, same-bar ambiguity, missing entry, missing holding data, incomplete trade, 60-session hold and future-only perturbation. Hand-calculated statistics and causal checkpoints passed.
- `scripts/lean-pilot/validate-overlap.py` confirmed two overlapping signals in one symbol become two separate one-share accounts; both remain open at the cutoff. Native discovery has no trades.
- Backend tests cover eligible scope, native missing fields, empty samples, classified versus unresolved differences, input-change failure without publication, job reuse/invalidation, restart recovery, mutual exclusion, local POST protection, read-only GET and unchanged exports. Existing analytics tests cover breakeven, no losses, missing fields, same-day exits and sorting/aggregation across pages.
- Final checks passed: **89 backend tests**, **34 frontend tests**, TypeScript and the local production build. Backend output contains two existing upstream deprecation warnings.
- Browser checks confirmed the local launch, Running → Completed transition, saved-result reuse after reload, metric availability, and Escape restoring focus to View LEAN comparison. At 390px width, both metric columns fit inside the 337px content area; matched prices, fees and dates remain readable. The default desktop viewport was also visually checked.
- A 720×500 CSS viewport verified reflow equivalent to a 1440×1000 display at 200% zoom. Native browser zoom controls were not independently verified. This is a reflow check, not a claim that a native zoom setting was exercised.
- A separate design review of desktop, mobile overview and mobile trade screenshots found no blocking layout/readability issues. Original Backtest was opened and its legacy registry/results remained intact; unsupported research strategies displayed an explicit reason and disabled comparison action.

Native maximum-hold orders can execute at the following open rather than the current engine's session-60 close. Daily bars cannot establish true intrabar order. Pre-adjusted custom data does not validate corporate actions or historical eligibility. Thirty days and one real trade cannot validate the strategy.

Maintain both engines now. Broader strategy coverage, execution-policy decisions, representative historical validation and a funded portfolio model remain prerequisites for LEAN-only migration.
