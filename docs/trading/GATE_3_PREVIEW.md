# Gate 3 simulated UI preview

Branch: `codex/trading-plan-position-journal`

Status: **Ready for operator UI review; not accepted.** Stage 3 uses isolated simulated records while actual IBKR paper testing remains blocked. This preview is not broker evidence and does not change the Gate 2 actual-paper matrix in `GATE_2_QC.md`.

Manual monitor evidence retained: the operator confirmed that moving the Chrome review from the larger monitor to the laptop display rendered correctly after opening a fresh tab for the accepted pre-harness source state `42628c2e+d.45eb7df7` at `http://localhost:3000/Journal/?demo=1`. This is manual evidence for that exact identifier only. It does not validate later source identifiers, and browser viewport/device-scale simulation is not a substitute for repeating the physical transition.

## Implemented surface

- Four workspaces: Discover, Charts, Strategies and Trading.
- Exactly two Trading tabs: Plan & Position and Journal.
- The compact planner, risk settings, calculator and sizing result now use the shared trading-domain calculation functions.
- Saved plans, working entries, positions, protection, targets, runner state and unlinked simulated IBKR positions share the Plan & Position surface.
- The Journal keeps one row per campaign and expands entry/exit details from the shared execution model.
- Legacy planner/recovery navigation was removed only after its useful destinations were mapped to the four workspaces. Existing storage keys and record paths were retained.
- Demo records use demo-only browser keys and account ID `SIMULATED-ONLY`; every execution surface is visibly labelled as simulation.

## Earlier Stage 3 verification evidence

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
| Unprotected position | Pass — TSLA remains visibly Unprotected with unavailable valuation and no automatic broker action | Blocked — no broker stop rejection observed |
| Persistence failure | Pass — corrupt browser state fails closed without overwriting records | Blocked — broker/database persistence was not exercised |

## Review screenshots

Generated locally under `output/playwright/`:

- `stage3-plan-position-desktop.png`
- `stage3-plan-position-mobile.png`
- `stage3-journal-desktop.png`
- `stage3-journal-mobile.png`
- `stage3-plan-details-desktop.png`

The desktop and mobile images were opened and visually inspected. The responsive review corrected the planner side-control accessible name and replaced horizontally clipped mobile execution fields with a complete two-column detail layout.

## Positions package completion checkpoint — 2026-09-10

Status remains **pending operator UI acceptance**. The accepted After-fill controls were reused without changing their trading behavior. Evidence below is simulated and does not advance the actual-paper matrix.

| Requirement | Simulated result | Actual paper result |
| --- | --- | --- |
| Wide/compact layout | Pass — positions sit beside the planner at 1800 × 900 and stack on the same loaded page at 1280 × 760 and 390 × 844 | Blocked — UI-only requirement |
| Position quantities and risk | Pass — AAPL records 40 filled, a 5-share manual exit, 35 open and 35/35 confirmed protection; partial protection reports only confirmed-stop downside and leaves total downside unavailable | Blocked — no connected paper state |
| Profit, loss, closure and replay | Pass — MRNA shows one profitable target exit and one losing manual exit; its duplicate replay produces only three unique executions; AMD is closed with zero open shares | Blocked — no connected paper fills or callbacks |
| Price honesty | Pass — fresh values are timestamped; stale NVDA is dated; disconnected TSLA reports unavailable and no valuation price | Blocked — no connected broker quote evidence |
| Exit allocations | Pass — 37 shares at 35/35/30 allocate 13/13/11 with two independent runner rules | Blocked — no submitted exits |
| Unlinked association and creation | Pass — exact account/instrument matching is required, duplicate association is rejected, and both linking and Journal-record creation persist and navigate to the exact row | Blocked — simulated identity only |
| Snapshot-only campaign | Pass — the shared campaign stores identified current quantity/average cost with zero invented executions; historical fills, exits, realized P&L, fixed initial stop and initial risk remain explicitly unavailable | Blocked — no connected broker history or reconciliation |
| Amendment drafts | Pass — save/reopen/discard, retained edits after failure and revision/quantity conflict rejection; confirmed protection remains unchanged | Blocked — drafts are explicitly unapplied |
| Accessibility and resizing | Pass — keyboard-openable rows, modal focus/Escape behavior, contained detail drawers, stable tabs and wide → narrow → wide behavior | Unverified — physical monitor/DPI transition has not been repeated for this identifier |

Review URL: `http://localhost:3000/?demo=1`

The exact final served identity, checkout, automated results and screenshot
filenames are recorded in
`artifacts/positions-review/final-verification.json`. That generated evidence is
excluded from preview hashing so recording the identifier cannot invalidate the
identifier itself.

Directly inspected screenshots (generated evidence, excluded from preview identity):

- `artifacts/positions-review/positions-desktop.png`
- `artifacts/positions-review/aapl-detail-desktop.png`
- `artifacts/positions-review/positions-mobile.png`
- `artifacts/positions-review/nvda-detail-mobile.png`

The linked MSFT snapshot campaign can open an unapplied amendment draft, but
Execution R-dependent price conversions and trigger evaluation remain unavailable
until genuine historical fills and a fixed initial stop are reconciled. No broker
order or protection change is implied. Overall Stage 3 acceptance remains with the
operator, and actual-paper testing remains blocked.

## Journal package checkpoint — 2026-09-10

Status remains **pending operator UI acceptance**. This checkpoint uses simulated
campaign events and local browser persistence only; it is not IBKR paper evidence.

| Requirement | Local/simulated result | Actual paper result |
| --- | --- | --- |
| One row per campaign | Pass — first confirmed entry creates the row; reordered further entries/exits and exact duplicate events update the same campaign identity | Blocked — no connected broker callbacks |
| Accounting and closure | Pass — 40 @ $100 with $98 protection records $80 initial risk; exits 10 @ $104 and 30 @ $99 produce $10 gross, $2 costs, $8 net and +0.10R | Blocked — no paper fills or finalized broker commissions |
| Long/short symmetry | Pass — deterministic shared-domain tests cover equivalent long and short campaigns | Blocked — no paper executions |
| Late costs and eligibility | Pass — late fee adjustments change the closed result and aggregates; missing risk excludes only R metrics, while incomplete fees exclude final dollar metrics | Blocked — no broker fee reconciliation |
| Dashboard definitions | Pass — closed, complete-cost cohorts drive net P&L, win rate, expectancy, profit factor, secondary statistics, setup analysis and closure-ordered curves; currencies remain separate | Blocked — simulated records only |
| Table and expanded detail | Pass — full-width table has the approved default columns; detail exposes plan/actual values, protection, exit intent, amendments, every fill, weighted prices, costs, timestamps and completeness | Blocked — simulated provenance clearly labelled |
| Filters and review | Pass — closure-date/setup/direction cohort filters remain separate from row status; optional review answers and lesson survive local reload without blocking synchronization | Not applicable to broker validation |
| Snapshot-only imports | Pass — current position identity/quantity remain visible while fills, initial risk, fees and historical P&L stay unavailable | Blocked — no connected history query |
| Responsive/accessibility | Pass — contained table scrolling, keyboard access, expanded mobile details, chart resizing and wide → narrow → wide without reload are automated | Unverified — physical monitor/DPI movement was not repeated for this revision |

The final exact source/served identifier, URL and screenshots for this checkpoint
are recorded under `artifacts/journal-review/`; that generated evidence is excluded
from preview hashing. No broker connection, submission or deployment was performed.

## Paper execution package checkpoint — 2026-09-10

Stage 3 remains pending operator acceptance and Gate 2 execution remains Blocked. The planner now shows a compact paper-intent readiness panel: Save plan remains local intent, validation separately checks the qualified contract, minimum tick and fresh executable-side quote, and Submit paper order remains disabled until a reviewed batch is explicitly approved. Actual prepared intents are written to private local state before any future submission; demo validation is labelled simulated and remains isolated.

Deterministic coverage includes every requested lifecycle label, durable idempotency, unknown-submission reconciliation, partial-entry protection/threshold deferral, final Execution R, quantity-conserving exits, one stop retry then persistent Unprotected, offline automation, amendment revision conflicts, duplicate/reordered events, recovery and the fixed $80-risk Journal example. These checks are simulation/local evidence, not paper execution evidence.

The connected paper session remains read-only. Account summary, two existing 100-share positions and a completed-empty open-order snapshot are actual read-only evidence; neither position is eligible for automatic association or QC actions. The approval-ready batch and its conservative boundaries are in `IBKR_PAPER_ACCEPTANCE_BATCH.md`. Exact numeric tickets remain blocked until TWS supplies an entitled live bid/ask; delayed, frozen, missing or stale prices cannot be promoted into executable limits.
