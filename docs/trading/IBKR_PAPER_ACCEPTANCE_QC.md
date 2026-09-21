# Consolidated paper-acceptance QC coverage

> **Current status:** P01–P38 and the narrative below are historical September 16 evidence, including references to “today.” Read the [September 21 current normal-control overlay](#current-normal-control-acceptance-overlay--september-21-2026-coord-03) for later NVDA/F/SOFI observations, the requested 30 ceiling and the independent submission-policy block. No historical ticket or approval authorizes current execution.

Latest QC and consolidation plan: [16 September product and execution review](TRADING_QC_2026_09_16.md). Additional deterministic coverage includes 200 sequential campaigns / 880 unique executions, replay, late commissions, restart, order-ID allocation above unrelated observed orders, conservative stop precision, fixed-target validation, Journal closure dates and source/search filters. This does not promote any of P01–P38 to an actual broker pass. The retained three-share cap cannot cover four nonzero exit legs in one broker campaign.

September 16 implementation continuation: [Connected paper lifecycle](PAPER_LIFECYCLE.md) adds the server ledger, paper UI, owned command transport and deterministic integration tests. It does not change any historical actual-paper result below into a pass. Fresh exact-batch execution evidence remains a separate gate.

This matrix separates actual paper observations from deterministic evidence. Construction, acknowledgement and simulation never prove a fill, protection trigger, protection fill or exit. PL long 100 and AMD short 100 are excluded throughout.

| ID | Scenario | Classification | Evidence / remaining requirement |
| --- | --- | --- | --- |
| P01 | Capped RTH long MIDPRICE + full stop | Simulated pass; pending actual RTH | Construction/lifecycle tests pass; no paper order acknowledgement or fill |
| P02 | RTH short symmetry and invalid stop | Simulated pass; unsupported/blocked actual | Long/short calculations pass. Existing sell MIDPRICE/LMT cannot enforce both CSCO bounds; no buy ticket substitutes |
| P03 | Unfilled midpoint remains working | Simulated pass; pending actual RTH | No market fallback; no observed paper working order |
| P04 | Small quote change within immutable cap | Simulated pass; pending actual RTH | Preflight permits only qualifying fresh quote; no paper submission observation |
| P05 | Quote crosses immutable cap | Simulated pass; actual read-only preflight observed | F R2 and first premarket candidate failed closed on cap crossings; these were preflight blocks, not execution failures |
| P06 | Breakout STP LMT trigger + worst price | Simulated pass; pending actual RTH | R2 SOFI exact ticket; no trigger/fill observed |
| P07 | Gap beyond breakout cap | Simulated pass; pending actual RTH | Must remain unfilled; no actual gap event observed |
| P08 | LMT + OPG | Simulated pass; unsupported/blocked | Construction only; IBKR paper documents Auction limitations; submission disabled |
| P09 | RTH session/order combinations | Simulated pass; pending actual RTH | Contract order types and liquid-hours phase enforced in preflight |
| P10 | Partial entry and equal protection | Simulated pass; pending actual | Confirmed shares alone receive protection; targets remain staged |
| P11 | Cancelled/expired remainder finalizes entry | Simulated pass; pending actual | No automatic recreation; no broker boundary event observed |
| P12 | Edited target/runner allocation | Simulated pass; pending actual | Whole-share conservation passes |
| P13 | 35/35/30 rounding | Simulated pass; pending actual | 37 shares allocate 13/13/11 exactly |
| P14 | Threshold touch during partial entry | Simulated pass; pending actual | Touch recorded/deferred; historical touch alone cannot advance stop |
| P15 | Fresh qualifying quote after final entry | Simulated pass; pending actual | Execution R freezes; bid long/ask short required |
| P16 | Tighter stop never loosened / invalid market stop | Simulated pass; pending actual | Direction-aware fail-closed tests pass |
| P17 | Independent runner modes | Simulated pass; pending actual | Long/short SMA, day extreme, dollar, percent and manual rules pass |
| P18 | First protection rejection | Simulated pass; pending actual | Exactly one reconciled retry action |
| P19 | Repeated protection rejection | Simulated pass; pending actual | Persists Unprotected; no unbounded auto-close |
| P20 | Duplicate submission identity | Simulated pass; pending actual | Idempotency prevents a second economic action |
| P21 | Submission timeout | Simulated pass; pending actual | Unknown action blocks retry until broker-reference reconciliation |
| P22 | Disconnect/reconnect reconstruction | Simulated pass; pending actual | Rebuilds from cumulative broker truth; no actual order reconnect observed |
| P23 | Cancellation/replacement race | Simulated pass; pending actual | Broker quantity wins and over-close is rejected |
| P24 | External liquidation | Simulated pass; pending actual | Imported once; absent snapshot alone never fabricates closure |
| P25 | External quantity/stop change | Simulated pass; pending actual | Changed-in-IBKR semantics; no manual batch change observed |
| P26 | Stale/missing quote and EOD fallback | Simulated pass; actual read-only observation | Live type-1 premarket quote observed; EOD remains non-executable |
| P27 | Exact account equity binding | Simulated pass; actual read-only observation | Verified masked account summary completed; wrong/stale connection rejected |
| P28 | Precautionary warning | Simulated pass; pending actual | Requires explicit operator decision; no broker warning induced |
| P29 | RTH default/session cutoff | Simulated pass; pending actual RTH | R2 preflight outside RTH was Blocked, not an execution failure |
| P30 | Premarket LMT + independent STP LMT | Simulated pass; actual read-only preparation; pending actual order | Live type-1 quote, SMART capabilities and exact F intent observed/persisted; no acknowledgement/fill/protection event |
| P31 | Postmarket LMT + independent STP LMT | Simulated pass; pending actual session | Independent fields and 20:00 schedule construction pass; same-session quote/ticket still required |
| P32 | Unsupported session/order combinations | Simulated pass | MIDPRICE/STP extended combinations and invalid durations fail before persistence; no broker rejection is needed or claimed |
| P33 | Partial entry at session expiry | Simulated pass; pending actual session | Keeps protected confirmed shares and finalizes remainder without recreation |
| P34 | Stop-limit triggers but remains unfilled | Simulated pass; pending actual session | Exposure remains open and state does not claim a protection fill |
| P35 | Inactive protection / offline application rules | Simulated pass; pending actual session | Broker protection and application automation are reported separately |
| P36 | Overnight protection boundary | Unsupported/blocked | OVERNIGHT LMT/DAY planning exists; broker-held initial protection not established |
| P37 | DST, holiday/early close and trade date | Simulated pass; pending actual special session | Broker schedule parser covers DST, CLOSED and early expiry |
| P38 | Reordered/duplicate callbacks and cross-boundary equality | Simulated pass; pending actual | Idempotent campaign/event accounting keeps Position and Journal identity/quantity aligned |

## Cross-cutting lifecycle evidence

The repository suites additionally cover partial/full exits, target allocation, separate runners, configurable breakeven, frozen Execution R, late fee adjustments, persistence failures, explicit amendments, and Position/Journal agreement for campaign identity, executions, confirmed/open quantities, fees, gross/net realized P&L and Final Net R. Snapshot-only campaigns retain missing fills, initial risk, Execution R, exits and realized results as unavailable.

Actual broker coverage today is limited to verified paper binding, completed account/position/open-order snapshots, contract/capability data, live premarket quotes, and intent validation/persistence with submissions disabled. Every order acknowledgement, fill, protection and exit behavior remains pending an exact approved batch and eligible session.


## Unified planner implementation — 16 September 2026

The separate paper workspace is retired. New authenticated flow evidence is tracked in `test_paper_auth.py`, `paper-projection.test.mjs` and `paper-ui.spec.ts`; the existing 38-scenario classification remains unchanged. Browser network fixtures prove UI behavior, not broker acknowledgement or fills. Actual session-specific quote eligibility, exact ticket approval, protection, fills, exits and cleanup remain unobserved for this revision. The previously reported 10197 competing-session blocker must be checked afresh after user sign-in and the operator-confirmed account link. No old approval or September 10 ticket is reused.

Automated verification for the unified implementation passed `npm run verify`: 197 Node tests passed (2 pre-existing gated skips), 214 backend tests passed, TypeScript passed, 41 browser regressions passed, and the production build passed. No screenshot baselines were changed. Direct browser inspection found and corrected a medium-width sign-in overflow; the repaired page was inspected at desktop, 765px and 390px widths with keyboard focus. Authenticated execution UI tests use controlled responses. Actual user sign-in/account linking, current TWS quotes and connected economic lifecycle evidence remain pending; no batch or campaign was created in the private execution ledger during implementation.

## Current normal-control acceptance overlay — September 21, 2026 (COORD-03)

The P01–P38 table and narrative above record their dated historical source. They do not describe fresh broker state or supersede later observations: NVDA completed one historical round trip; F completed one after failed protection and recovery; SOFI was cancelled without fills. Total historical completions are **two**. F remains a failed protection scenario until a separate repaired-path observation passes. The Verification page already preserves these distinctions.

**Execution remains blocked.** This is an operator preparation matrix, not permission to connect, restart, unlock, amend a target or place orders. A legitimate external resolution of the submission-policy rejection is required independently of user standing paper approval. Old manifests, prices, review digests and approvals must never be reused for a new source/session. The persisted historical session remains halted at 200; an authenticated audited amendment retaining approval history must enforce the requested ceiling of 30 before any permitted future execution. Include the historical outside-session NVDA completion in that ceiling; checkpoints are 1, 10, 20 and 30.

All future cases use ordinary Plan, Positions and Journal controls and the shared execution service. Prerequisites: valid authenticated owner, exact verified paper account/environment, current reviewed source, fresh broker quotes/funds and eligible session, and supported server capabilities. Limits remain 3 shares/campaign, 2 campaigns, $500 entry notional, $10 planned campaign risk/$20 total; exclude PL and AMD and preserve all unrelated positions/orders. For each future observation retain source, UTC time, exact owned identities and raw callbacks privately, then publish only sanitized references. Stop new entries/managed rules on protection failure, stale data, conflicting events or incomplete accounting; retain broker protection and never retry uncertain submissions.

| Case / historical IDs | Normal controls and prerequisites | Required observations / evidence | Current classification / stopping rule |
| --- | --- | --- | --- |
| Save versus submit; P20/P27 | Enter symbol/Long, edit entry and exits, Save plan/Save exits; change one saved value; Review order only after fresh prerequisites | Saving creates no broker order; changed revision invalidates prior review; exact account, quantity, bounds, protection and allocation shown in confirmation; duplicate confirmation has one command identity | Deterministic; fresh broker acceptance unobserved. Reject mismatched/stale/expired review before transmission |
| Supported entries; P01/P03–P07/P09/P29–P31 | Choose each server-supported entry/session combination in Plan; save then review/confirm exact ticket | Acknowledgement, entry fill, working remainder and equal protection are separate callback observations; cap respected; no fallback order | Unobserved/blocked execution. Wrong session/capability/quote is a block, not a failed fill |
| Allocations, both runners and breakeven; P10–P17/P35 | Save exits using supported whole-share allocation, select each runner independently and breakeven; inspect Positions after eligible fill | Quantity conserved, targets wait for final entry, activation uses fresh executable-side quote, confirmed stop never loosened; each exercised runner mode recorded separately | Deterministic; broker path unobserved. Three shares cannot cover four nonzero legs; P13's 37-share arithmetic is deterministic-only. Do not claim every combination |
| Allowed amendments; P12/P16/P23 | Use existing Position review/amendment controls only for server-allowed changes | Revision/acknowledgement and unchanged protection tracked; pending change is not confirmed protection; allocation restriction remains enforced | Unobserved/blocked. Reject unsupported or stale amendment; no forced race |
| Cancellation and bounded closure; P11/P18–P21/P23/P28/P33–P34 | Cancel an owned unfilled entry; use existing reviewed bounded-close action for owned exposure when permitted | Terminal cancellation versus fill kept separate; race resolved by fills; protection retained throughout closure; unknown transmission reconciled, never resent | SOFI cancellation historical; repaired path unobserved. Do not induce protection rejection, warning, gap or race; deterministic evidence remains distinct |
| Two concurrent campaigns; P20/P25/P38 | Two distinct eligible nonexcluded symbols, ordinary saved/reviewed plans, within aggregate limits | Commands/positions/fees attributable to exact campaigns; one campaign action leaves other and unrelated holdings unchanged | Unobserved/blocked. Any unknown exposure or conflicting identity stops new entries |
| Disconnect/recovery; P21/P22/P26/P35/P38 | Future separately authorized operational interruption only; inspect stale Positions/Journal and recovery through ordinary controls | Broker-held protection verified independently; full snapshots/executions/fees reconciled; no duplicate commands; managed rules require review before resumption | Synthetic restore/replay covered by COORD-03; real reconnect unobserved. No restart or network interruption authorized by this document |
| Final Position/Journal agreement; P24/P38 | Open corresponding Position and Journal records after confirmed closure; refresh after late fee | Same identity, entered/exited/remaining, weighted prices, gross/net, fees and Execution R; missing fee stays unknown; flat, orders cleared and accounting complete are separate proofs | Shared-projection deterministic evidence; fresh broker-backed final reconciliation unobserved. Never infer closure from position absence alone |

Shorts, auctions, overnight and four-leg execution remain unsupported/blocked. Invalid inputs, expiry, duplicate/reordered callbacks, rejected protection, exact race timing and inaccessible market events stay deterministic where unsafe or impractical to induce. Cancellation without fill does not add a round trip. At 30, require exact owned flat positions, cleared orders and complete accounting plus restored submission locks; report actual coverage and residual gaps rather than live readiness.
