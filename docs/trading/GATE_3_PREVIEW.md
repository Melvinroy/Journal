# Gate 3 simulated UI preview

Branch: `codex/trading-plan-position-journal`

Status: **Ready for operator UI review; not accepted.** Stage 3 uses isolated simulated records while actual IBKR paper testing remains blocked. This preview is not broker evidence and does not change the Gate 2 actual-paper matrix in `GATE_2_QC.md`.

## Implemented surface

- Four workspaces: Discover, Charts, Strategies and Trading.
- Exactly two Trading tabs: Plan & Position and Journal.
- The compact planner, risk settings, calculator and sizing result now use the shared trading-domain calculation functions.
- Saved plans, working entries, positions, protection, targets, runner state and unlinked simulated IBKR positions share the Plan & Position surface.
- The Journal keeps one row per campaign and expands entry/exit details from the shared execution model.
- Legacy planner/recovery navigation was removed only after its useful destinations were mapped to the four workspaces. Existing storage keys and record paths were retained.
- Demo records use demo-only browser keys and account ID `SIMULATED-ONLY`; every execution surface is visibly labelled as simulation.

## Verification evidence

Command: `npm run verify`

- Pass — 137 Node tests, including five focused Stage 3 consolidation tests.
- Pass — 100 isolated backend tests; two existing dependency deprecation warnings remain.
- Pass — TypeScript.
- Pass — four locked Chromium regressions.
- Pass — production build.
- Pass — desktop browser exercise at 1440 × 900: workspace navigation, both Trading tabs, saved-plan detail editor and Journal expansion.
- Pass — mobile browser exercise at 390 × 844: planner controls and responsive Journal execution details.
- Pass — browser console review: zero errors in the normal preview and corrupt-storage simulation.
- Pass — persistence failure simulation: malformed plan storage was rejected, export stayed disabled, the failure warning appeared, and fallback records were not overwritten.
- Blocked — actual TWS/IB Gateway paper execution and reconciliation evidence. No gateway was connected and no broker order was submitted.

## Required Stage 3 scenarios

| Scenario | Simulated result | Actual paper result |
| --- | --- | --- |
| Partial entry | Pass — AAPL shows 40/100 filled, 35 open after an external partial exit, and protection for exactly 35 | Blocked — no connected paper fills |
| Partial profit | Pass — MRNA includes a short exit below entry and retains the remaining position | Blocked — no connected paper fills |
| Partial loss | Pass — MRNA includes a short exit above entry; realized P&L and remaining quantity reconcile | Blocked — no connected paper fills |
| Full closure | Pass — AMD rolls to Closed with zero open quantity and one Journal row | Blocked — no connected paper closure |
| Manual broker change | Pass — imported AAPL/MRNA events are labelled Changed in IBKR | Blocked — no manual paper-account change observed |
| Duplicate event | Pass — replayed MRNA execution is deduplicated to one economic effect | Blocked — no duplicate broker callback observed |
| Stale data | Pass — saved NVDA plan exposes a dated stale local source | Blocked — no connected stale market-data observation |
| Unprotected position | Pass — TSLA remains visibly Unprotected with explicit retry/close actions and no automatic close | Blocked — no broker stop rejection observed |
| Persistence failure | Pass — corrupt browser state fails closed without overwriting records | Blocked — broker/database persistence was not exercised |

## Review screenshots

Generated locally under `output/playwright/`:

- `stage3-plan-position-desktop.png`
- `stage3-plan-position-mobile.png`
- `stage3-journal-desktop.png`
- `stage3-journal-mobile.png`
- `stage3-plan-details-desktop.png`

The desktop and mobile images were opened and visually inspected. The responsive review corrected the planner side-control accessible name and replaced horizontally clipped mobile execution fields with a complete two-column detail layout.
