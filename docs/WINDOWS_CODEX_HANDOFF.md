# Windows Codex handoff — Brontide

Use this as the prompt for the Codex session running on the Windows laptop. The execution plan in `docs/EXECUTION_PLAN.md` is authoritative. Execute only the requested phase; do not rebuild completed components.

## Initial instructions

You are working in `C:\Users\melvi\Projects\Journal`, public repository `Melvinroy/Journal`. The database is `services/eod/data/brontide.duckdb`. Read AGENTS.md if present, README.md, docs/EXECUTION_PLAN.md, docs/EXECUTION_E1_VALIDATION.md and services/eod/README.md. Inspect status and history before modifying anything.

The cloud implementation and Windows validation must use the same reviewed commit. Fetch main read-only, report the current HEAD, and check for uncommitted or unpublished work. Fast-forward only when safe. Never reset, overwrite, delete or stash unrelated work automatically. If the requested commit is unavailable, report that exact limitation; do not recreate an approximation. A cloud-local commit will not be fetchable until its approved push or an explicitly supplied patch/bundle.

Required historical ancestry includes bac8d38df4f1efb714208d8d4701b2d43c036050, 34920792316ccf1a2148f54fe940fb323262d71f and ccec3890e272d83c6f7abad12980f7f4bafd31bd. The last is the selected chart-range/right-whitespace fix; preserve it.

Never push without Melvin's exact approval sentence naming the actual commit SHA. Never commit .env, DuckDB, WAL, credentials, backups or private exports. Do not rerun the historical ingestion backfill. The article is outside this project task.

## Validation assignment

Validate the phase specified by Melvin or the accompanying implementation report. If no phase is specified, inspect and report readiness; do not start E2–E6 on an assumption.

For chart/local-data changes:

1. Install the lockfile dependencies with npm ci. Report npm audit findings; no force upgrade.
2. Run npm run test:chart and npm run build. Run backend tests using the documented EOD environment.
3. Start npm run local in a separate terminal. Use the documented `python -m brontide_eod.verify_chart` command from the configured EOD environment to compare AAPL/MSFT/NVDA/SPY against the real database. Do not download bars to fix a discrepancy without diagnosing it.
4. Check local versus sample labeling, symbol search, adjustment selection, loading/empty/error/retry/stale states, ranges, right whitespace, theme, keyboard and desktop/mobile layouts.
5. For E2 specifically, compare the same dated moving average across chart ranges, with sufficient warm-up. Verify each tool's actual behavior, saved drawings/layouts, watchlist persistence and navigation context.

For scan/backtest phases, run deterministic fixture tests first, then the requested feature/scan/backtest job on existing bars. Record input fingerprints, definition versions, run IDs, exact date/universe coverage, exclusions and real timings. Never report earlier static CSV results as reproduced.

For Trading, test multiple stops and targets, partial fills/exits, aggregate risk and share conservation, persistence, long/short handling and separation of plans from actual Journal P&L. Saving is not broker execution.

## Return format

- Exact branch and HEAD tested; clean/dirty state and any unrelated files preserved.
- Phase scope implemented versus validation-only.
- Commands and concise pass/fail results, with failures explained.
- Database comparisons and fingerprints when relevant; no credential output.
- Desktop/mobile checks actually performed; distinguish not tested from pass.
- Remaining gates, including dependency findings.
- Changed files and new local commit SHA if you fixed something; do not push.

Bring that report back to this chat. The cloud agent will reconcile the exact patch and continue the next phase only after the current gate is satisfied.
