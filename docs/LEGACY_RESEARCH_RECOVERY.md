# Legacy research recovery — 2026-09-05

Status: methodology and result workbooks recovered; original executable engine
not located. None of these results validates a strategy on the final Alpaca
frozen historical universe. Do not merge rules from different studies.

## Original artifacts inspected

| Workbook | Source tabs | Recovered evidence |
| --- | --- | --- |
| Delayed_9M_EP_Backtest.xlsx | Methodology, Sources | EP volume uses an inclusive 20-day average; setup dry-up uses a prior 20-day average. Monitoring resets to the most recent EP. Major distribution is a down close on increasing volume with a decline of at least 0.75 prior ATR. This earlier study uses the SMA10/20/50 stack and several entry/stop policies. |
| Catalyst_Contraction_Research.xlsx | Decision Summary, Sources & Method, audit ledger | Refined SMA10/20 contraction study; next-open execution, stop-first daily-bar ambiguity, 10 bps per side; setup dollar ADV20 at least $5M. Historical universe was current-listed common stocks/ADRs, not the new frozen universe. |
| Delayed_9M_EP_Loose_Contraction_Audit.xlsx | Methodology, rows indexed 3–16 | Most-recent-EP monitoring for sessions 1–15; first qualifying setup per episode; inclusive EP ADV20, prior setup dollar ADV20, Wilder-style EWM alpha 1/14, next-open entry, 1 ATR stop, 10R target, 60-session limit, 10 bps per side. |

The loose-contraction workbook explicitly states that the earlier strict
composite used a **different event cooldown**. Its episode-reset policy must
not be assumed to reproduce the strict benchmark. Its “loose” title does not
establish the later 2x EP / 0.95 setup-RVOL candidate: its documented EP
threshold remains 3x.

## Still unresolved

- Original Python source and exact mapping of registry IDs to executable versions.
- Strict-composite event cooldown and its relationship to newer EP episodes.
- Exact ATR initialization/EWM options; alpha alone is not a complete definition.
- Complete provenance of the later 2x / 0.95 candidate.
- Whether a OneDrive copy contains additional registry metadata. No OneDrive
  file has been accessed or its contents verified in this recovery.

Any reconstruction must mark these unknowns explicitly, retain each source
definition separately, and receive a new version/fingerprint. The current
uncommitted research-engine draft is not a verified legacy reproduction.

## Implementation checkpoint

E2–E5 now have an integrated implementation checkpoint. The user authorized
retrying dependency installation, which succeeded; backend and frontend tests
subsequently passed. See `RESEARCH_AND_TRADING.md` for current evidence and
remaining Windows/browser release gates. No new implementation changes have
been pushed, and no final-database backtest has run in this environment.
