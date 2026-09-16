# Trading and Journal QC — 16 September 2026

## Decision and delivery plan

Production release and a 50–200-trade broker run are NOT approved by automated tests alone. Complete the corrections below, verify one consolidated local source, then run a small exact-ticket-approved pilot. Expand to sequential real paper trades only after pilot evidence passes. Retain 3 shares/campaign, 2 simultaneous campaigns, $500 simultaneous notional, $10 planned risk/campaign and $20 total. Preserve PL/AMD and unrelated broker identities.

## Five whys

1. Why is the screen difficult to operate? Low-contrast 7–10px metadata, oversized empty account space, repeated explanations and draft records competing with active exposure.
2. Why do users need so many explanations? Planning, supported execution and confirmed broker state share controls without enough local eligibility feedback.
3. Why does a valid-looking plan fail later? Raw derived stop precision, unsupported DAY/GTC/session/direction combinations and too few shares for exit legs reach server review before being explained.
4. Why can a test pass while reporting is still wrong? Component tests verify values but omitted cross-session closure timestamps and real broker lifecycle evidence.
5. Why is it not ready for a large run? No completed connected pilot, recovery/cleanup evidence or source-frozen session; several combinations remain deliberately unsupported. Volume cannot replace coverage.

## Findings and corrections

| Priority | Finding | Action |
| --- | --- | --- |
| High | ATR-derived stops show raw precision and may fail tick validation | Round derived US-stock planning stops conservatively to cents before sizing/saving; preserve full ATR calculation and explicit manual prices; retain qualified broker tick validation |
| High | Paper Journal closure timestamps absent | Derive first fill and closure from confirmed timestamped executions, never wall clock; unknown timestamps remain unavailable |
| High | Fixed-price exits can request prices below the maximum entry | Reject unsuitable/tick-invalid fixed targets before approval; never silently turn them into another target |
| High | Broker eligibility appears too late | Show local blockers for shorts, unsupported sessions/durations, quantity, leg allocation and dollar limits before review; server remains authoritative |
| High | Reserved broker IDs could overlap higher IDs observed on unrelated orders | Advance a locked allocator above callback IDs; preserve the floor through reconnect and require broker readiness; never adopt those orders |
| Medium | Account summary is sparse; status repeats | Compact full-width summary, readable metrics and expandable details; retain stale/unavailable text |
| Medium | Active exposure competes with draft plans | Put working/open positions first, followed by recent closures and saved plans; preserve every control; add symbol search and empty states |
| Medium | Tiny text and small targets | Scoped planner/Journal typography, stronger secondary contrast, keyboard focus and larger controls; preserve chart styles |
| Medium | Journal source is unclear and hard to search at scale | Add record-source and symbol filters; identify paper records as local rather than cloud synced |
| Medium | Unreviewed paper trades inherited a default grade, and missing local records could make totals look complete | Show “Not reviewed” and disclose incomplete totals while local records are unavailable |
| Medium | Empty Journal cohorts displayed zero win rate and 1:0 planned reward/risk | Display unavailable performance metrics when their required sample is empty; retain the actual zero record count |
| Medium | Mobile runner method labels were clipped | Give exit fields two usable columns and a separate leg heading; retain all runner choices |
| Medium | A one-trade Journal cohort shaded a fabricated decline toward the baseline | Show a single centered observation without a line/area; separate nearby distribution reference labels |
| Medium | Old preview remains the user entrypoint | Consolidate verified source into local main and hand off exact identifiers/URLs; do not alter unrelated data |

## Verification gates

1. Domain/Node tests: rounded stop direction and consistent sizing, local eligibility, first-fill/closure dates and incomplete fees.
2. Backend: existing auth/ownership/command identity/persistence/restart/race tests, added fixed-target validation and sequential ledger stress with duplicate replay, late fees and restart. Stress is simulated transport, never broker-observed evidence.
3. UI: settings and errors, preserved options, search/filter empty states, read-only/unavailable/stale status, save versus review, confirmation invalidation, desktop/mobile and keyboard. Run npm run verify; no automatic baseline changes.
4. Direct inspect current-source screenshots for Plan & Position and Journal, wide/narrow/wide, details, dialogs and scrolling. Report real-account/native-DPI/other-engine limits separately.
5. Commit only scoped source/tests/docs. Fast-forward local main after checking preserved files. No push, branch deletion, chat deletion, merge conflict resolution or deployment without applicable approval.

## Connected pilot and scale plan

- User signs into Brontide and confirms the one-time verified paper-account link. TWS credentials stay in TWS. Resolve current data/session errors from fresh observations (10197 was previously observed; not assumed current).
- Freeze source for the session; qualify current contracts and quotes; prepare exact DAY long tickets. Review/approve exact tickets before enabling submission. Begin with one campaign, then two simultaneously within existing limits.
- Capture separately: request identity, acknowledgement, execution IDs, protection acknowledgement, target/runner changes, fees, bounded exit, flat position and sibling-order cleanup. Compare Position, Journal and broker statement.
- Stop on mismatch, rejected/unconfirmed protection, uncertain command, missing commissions, stale quotes/reconciliation or exhausted cleanup. Keep broker stops; reconcile before any new ticket.
- After a passed pilot, run reviewed batches sequentially: 10, then 50, then 100/200 cumulative if each checkpoint reconciles. Two open campaigns maximum; no automatic blind resubmission or limit increase. A count target does not authorize arbitrary tickets.
- Shorts without enforceable bounds, auctions, overnight and unsupported GTC entry remain blocked. Four nonzero exit legs cannot be broker-tested with the retained three-share cap; verify their math deterministically and report the limitation.
- Real paper fills are simulator observations, not proof of live-market fill behavior. IBKR documents top-of-book simulated fills and complex-order limitations: https://www.ibkrguides.com/clientportal/aboutpapertradingaccounts.htm

## Consolidation inventory

Fetched origin. Every local and remote branch tip is already an ancestor of codex/ibkr-paper-lifecycle at c15a2ea. Main at 6da65a8 lacks six Scanner/Trading commits. No conflicts found in the merge-tree check. Preserve original Journal untracked CLAUDE.md/output/tmp; Scanner output; detached Trading generated next-env.d.ts; all chat history. These are not separate missing product features.

## Evidence

Current audit captured and inspected output/trading-qc/before-planner.png and before-journal.png from http://127.0.0.1:8766/?demo=1, source c15a2ea5+d.17407ab6 at 1600x1000. User-open old preview 8765 was confirmed at 04bfb71e and displayed stop 205.4431827154619. Final evidence and results will be appended after verification.

### Automated results

- `npm run verify` passed all five stages in 502 seconds: 200 Node tests passed, two existing gated skips, 217 backend tests passed, TypeScript passed, 44 browser tests passed, production build passed. Log: `C:\Users\melvi\Projects\Journal-paper-lifecycle\output\trading-qc\verify-final.log`. No screenshot baselines were changed.
- A preceding run had one new test-navigation failure (the test did not open the chart workspace menu), with 43 other browser passes. The corrected test passed in the full run.
- The subsequent small Journal chart correction was followed by eight passing focused Journal/browser checks, including the one-observation/no-fabricated-area assertion. Final preview builds recheck TypeScript. Log: `output/trading-qc/chart-followup.log`.
- The 200-campaign test exercised five allocation shapes, 880 unique executions, duplicate replay, late commissions, restart and flat/owned-order cleanup through an isolated fake transport. It is bookkeeping/recovery evidence, not 200 real paper trades or a performance benchmark.
- Runtimes: Windows, Node 22.22.2, repository Python 3.11.9, pytest 8.4.2, Playwright Chromium 153.0.8010.12. Two dependency deprecation warnings remain; lint is not configured.

### Direct browser observations

Inspected and saved screenshots from the in-app Chromium browser at `http://127.0.0.1:8766/?demo=1`, source `c15a2ea5+d.957e666c`, through 1600×1000 → 390×844 → 1600×1000. Checked compact account summary, aligned columns, stacked positions, readable target/runner selectors, normal page scrolling, protection details, settings validation (zero equity rejected), Escape/focus restoration, symbol/source filters and truthful empty metrics. Checked `http://127.0.0.1:8766/?paper=1` at mobile width: actual sign-in remains required and contained. Screenshots were opened and visually inspected, not merely listed. The independent exploration found and corrected the mobile runner clipping, empty metric values and single-observation chart issue.

The final commit/served identifier and post-commit screenshots are recorded in `output/trading-qc/HANDOFF.md` in the Trading checkout; they must be checked against the live preview before a later session. Evidence files are local and are not committed as brokerage data.

The final chart correction was also directly inspected at `http://127.0.0.1:8766/?demo=1`, source `c15a2ea5+d.5d44f8d3`: a HOOD-only cohort renders one centered observation, no fabricated shaded slope, and separated average/median labels. Saved and viewed `output/trading-qc/single-record-chart-fixed.png`. The production preview build and its TypeScript check passed on that source.

### Remaining gates and limits

- No orders were sent, no account was linked, and no fresh broker market-data session was tested in this QC. The private default execution ledger contained zero objects at inspection. Submission locks stayed enabled. Historical 10197 is not a current diagnosis.
- Correct-user live authentication, actual TWS account/quote readiness, order acknowledgements, fills, stop activation, OCA cancellation, fees, amendments, reconnect with exposure and cleanup remain the connected-pilot gate. Mocked account/stale/error/approval tests do not establish those outcomes.
- Native monitor/DPI movement, physical phones, other browser engines, and real-account confirmation dialogs were not directly tested. Browser viewport/DPI emulation is recorded separately from physical-device evidence.
- At the 10/50/100/200 checkpoints, record status/reconciliation latency and confirm fresh-data guards continue to hold. The status API currently returns the full local campaign history; archive/pagination and long-running performance are future production-hardening work, not proven by this functional stress test.
- The product is ready for operator setup and a bounded reviewed pilot after those prerequisites. It is not signed off for live-money production or an unattended 200-trade run.

### Changed areas

Planner/account/position components and scoped styles; Journal filtering/metrics/charts; shared stop and paper projections; qualified fixed-target validation and broker-ID allocation; focused domain/backend/browser tests; the acceptance-matrix addendum and fresh-start guide. Authentication, account ownership rules, execution limits, order approval and unrelated checkouts were preserved.

The broker-ID correction follows IBKR's requirement that new order IDs exceed observed order IDs: [official order submission documentation](https://interactivebrokers.github.io/tws-api/order_submission.html).
