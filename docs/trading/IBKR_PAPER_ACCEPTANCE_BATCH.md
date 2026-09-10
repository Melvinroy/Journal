# Proposed IBKR paper acceptance batch — R2

Batch identifier: **BRONTIDE-RTH-20260910-R2**.

Status: **R2's exact F/SOFI tickets and cleanup were user-approved against source `42628c2e+d.ea58ce5f`; its attempted preflight was Blocked before execution and no order was submitted.** TWS Read-Only and Brontide submission lock remain enabled. The exact account binding stays private. Existing external positions in PL and AMD (100 shares each) and every unrelated order are excluded from entry, amendment, cancellation, association and cleanup by exact broker instrument identity. Any newer source identity requires a new explicit binding before another run; the numeric R2 tickets themselves remain unchanged.

The machine-readable package and read-only preflight/evidence commands are documented in [IBKR_PAPER_ACCEPTANCE_TOOLING.md](IBKR_PAPER_ACCEPTANCE_TOOLING.md). The manifest preserves every R2 ticket and bound below unchanged; it does not broaden the existing approval.

## Conservative batch limits

These are one-time QC limits, not trading defaults:

- New isolated campaigns only: F long MIDPRICE and SOFI long STP LMT. The proposed CSCO short MIDPRICE ticket is Blocked as described below. No symbol may be used if a position or working order appears before submission. The F quantity is explicitly revised from two to **three** shares so one actual campaign can exercise a target plus two separately allocated runners; the superseded two-share F ticket is not also valid.
- Up to three shares per campaign (three only for QC-F-LONG; two for the other executable tickets). Maximum two campaigns working/open simultaneously.
- Maximum simultaneous entry notional: USD 500. Maximum planned stop risk: USD 10 per campaign and USD 20 total.
- Regular trading hours only. Required data: one verified paper session, exact managed-account match, current account summary, qualified US-stock contract, minimum tick and live (market-data type 1) bid/ask no older than 15 seconds.
- The displayed hard cap, stop and trigger must be tick-valid and revalidated immediately before submission. A cap crossing, quantity reduction, stale/incomplete/delayed/frozen quote, account/configuration change, unexpected position/order, connection loss or reconciliation-needed state stops the batch.

## Exact proposed tickets

The numeric values below were derived from read-only market-data-type 1 snapshots on 10 September 2026 around 05:22 UTC. That was outside the required regular session, so the values are proposals, not fresh execution authorization. Immediately before submission Brontide must obtain a new regular-session live quote within 15 seconds and fail closed if the quote crosses the fixed cap/floor or any other prerequisite changes. It must not silently rewrite these approved numbers.

| Campaign | Side/type | Quantity | Exact ticket values once quote is captured | Protection and exits | Fixed cleanup sell floor |
| --- | --- | ---: | --- | --- | ---: |
| QC-F-LONG | Buy F, SMART `MIDPRICE`, DAY | 3 | Hard cap USD 13.54; initial stop USD 12.54; maximum notional USD 40.62; planned stop risk USD 3.00 | Full 3-share GTC sell stop in the transmitted bracket. After final entry: 1 share target at +1R, 1 share Runner A activated at +1R with USD 0.50 trail, 1 share Runner B activated at +2R with 5% trail; breakeven at +1R, USD 0 offset. | **USD 12.54** for A1 and A2; never lowered automatically |
| QC-CSCO-SHORT | Sell short CSCO, SMART `MIDPRICE`, DAY | 2 | Minimum admissible entry USD 109.16; upper admissible entry USD 110.15, one tick below the USD 110.16 stop. **Blocked:** the fresh bid must be inside that interval before submission, but this is only a submission gate. A sell MIDPRICE limit can receive price improvement above USD 110.15, so the existing order cannot enforce both fill bounds and has no valid maximum-notional claim. | No submission is permitted in R2. A buy-side replacement cannot validate short behavior; P02 actual short evidence remains pending until a separately approved bounded short mechanism exists. | Not authorized |
| QC-SOFI-BREAKOUT | Buy SOFI, SMART `STP LMT`, DAY | 2 | Trigger USD 17.47; hard cap USD 17.52; initial stop USD 16.97; maximum notional USD 35.04; worst-case planned stop risk **USD 1.10** (`2 × (17.52 − 16.97)`) | Full 2-share GTC sell stop. After final entry: 1 share target at +1R, 1 share Runner A activated at +1R with 5% trail; breakeven at +1R, USD 0 offset. A gap beyond cap must remain unfilled. | **USD 16.97** for A1 and A2; never lowered automatically |
| QC-OPG-CONSTRUCTION | Buy an otherwise eligible non-overlapping stock, `LMT` + `OPG` | 1 | Construction-only numeric limit from the captured quote | **Must not be submitted.** P08 remains Blocked because IBKR documents Auction orders as unsupported in paper. | Not authorized |

The approval screen must show the numeric cap/floor, trigger, stop, calculated notional and risk values before enabling an eligible order. R2's executable F and SOFI tickets total **USD 4.10 worst-case planned stop risk**. No combined maximum-notional claim is made: the USD 500 simultaneous-entry policy limit still applies independently, and the blocked CSCO short has no enforceable upper fill bound. If a fresh regular-session quote is unavailable or has crossed a fixed limit, that ticket remains Blocked and no order is enabled; EOD, off-session, delayed or frozen data cannot substitute. Quote validation is a submission prerequisite, not a guaranteed fill bound.

## Allowed operations and order

1. Refresh account, positions, open orders, contract identity, minimum tick and live quote. Confirm PL/AMD and all unrelated broker orders are untouched.
2. Submit only the reviewed F bracket. Observe acknowledgement separately from fill; if unfilled, cancel only its entry remainder and wait for confirmed cancellation.
3. Reconcile entry fills and broker-confirmed stop quantity before any target/runner action. Never promise or force a partial fill.
4. Do not submit the blocked CSCO or construction-only OPG ticket and do not substitute another order type or symbol.
5. Submit only the reviewed SOFI bracket. Do not chase through its hard cap.
6. Exercise one explicit exit-plan amendment on an executable batch position only: save unapplied, preview against current quantity/orders, apply after validation, and wait for broker confirmation. One manual TWS action may tighten (never loosen) that batch position's stop; Brontide must reconcile and label it Changed in IBKR.
7. Test Brontide-client disconnect/reconnect only after broker-held initial protection is confirmed. Application-managed breakeven/trailing must visibly report offline. Do not stop TWS or disturb other clients.
8. Apply the bounded cleanup policy below. Never use an unbounded market cleanup.

At every timeout, treat the action as unknown and reconcile order reference, executions, positions and working quantities before retry. Stop immediately for an account mismatch, unexpected account, live-session ambiguity, over-close risk, unknown stop, unprotected fill, persistence failure or any effect on PL/AMD.

## Bounded cleanup policy

Cleanup applies only to the exact remaining quantity of an R2 F or SOFI campaign. It is unavailable for CSCO, OPG, PL, AMD and unrelated positions or orders.

1. Refresh executions, position quantity and every batch-owned working order. Cancel batch target/runner orders only, wait for confirmed cancellation, and reconcile fills again. Keep the valid full-remaining-quantity protective stop working.
2. A cleanup close is allowed only if the broker can place it with the existing protective stop in one broker-held OCA-with-block relationship for the same exact remaining quantity. If that cannot be established without a protection gap, cleanup is Blocked and the stop is not cancelled.
3. The immutable minimum cleanup sell prices are **USD 12.54 for F** and **USD 16.97 for SOFI**. Both A1 and A2 must use the applicable fixed floor; it is never lowered, widened or recalculated automatically. Any tighter currently confirmed protective stop also remains controlling, so the fresh bid must be at or above both the fixed cleanup floor and that tighter stop.
4. With a complete live type-1 quote no older than 15 seconds, use `QC-CLEAN-{campaign}-A1`: a DAY sell LMT for the exact reconciled remaining quantity at the current tick-valid bid, provided the bid satisfies step 3. If the bid is below either required level, cleanup is Blocked: retain valid protection, disable new batch entries and report the unresolved position. No market order or adaptive/unbounded substitute is allowed.
5. A1 expires at the broker-returned RTH close. If A1 is still unfilled after 60 seconds, cancel A1 only, wait for confirmed cancellation, reconcile the stop, fills, position and all exits, then obtain a new qualifying quote.
6. Permit at most **one replacement**, `QC-CLEAN-{campaign}-A2`, for the newly reconciled remaining quantity at the new current tick-valid bid, again subject to the unchanged fixed floor and any tighter confirmed stop. A2 is also DAY and is cancelled after 60 seconds if unfilled. Thus the maximum is two total attempts and one retry per campaign.
7. Before either attempt, total live closing quantity across cleanup, stop, target and runner orders must not exceed confirmed open quantity. A fill or partial fill requires immediate reconciliation before any replacement. The OCA relationship must cancel/reduce the competing close; cancellation acknowledgement and final quantity are verified before proceeding.
8. If A2 cannot fill or any prerequisite fails, retain the valid protective stop, disable every new batch entry, and report the position as unresolved. Do not cancel protection merely to finish the batch, and do not restore Read-Only until the position is reconciled and safely protected or closed.

## Evidence classification

- Suitable for actual paper observation from the executable F/SOFI tickets: P01, P03–P07, P09–P17, P20–P28 and RTH session scenario P29 where the relevant event occurs safely. Acceptance/acknowledgement alone does not validate trigger, fill, child activation, cleanup fill or cancellation.
- P02 actual short evidence remains **pending/Blocked** because QC-CSCO-SHORT cannot enforce both approved fill bounds. A buy-side replacement cannot validate short behavior; its deterministic long/short construction evidence is unchanged.
- Manual TWS assistance: P24/P25 manual fill/cancellation/stop change, only on a batch campaign; the exact action is confirmed immediately beforehand.
- Controlled simulation remains authoritative for hard-to-induce transport timeout, reordered/duplicate callbacks, persistence interruption, repeated stop rejection, precise partial fill and race timing. These results must not be labelled broker evidence.
- P08 remains actual-paper **Blocked**. No live order or substituted order type may be used as a workaround.

One approval applies only to batch **BRONTIDE-RTH-20260910-R2**, its executable F/SOFI tickets and bounded cleanup policy. It does not authorize the blocked CSCO/OPG tickets, live trading, other symbols, larger quantities, changed limits, deployment or later sessions.

## Session-extension batches — deliberately separate

The RTH batch above remains independently executable and is not broadened by these rows. Its quotes and limits must not be reused for a later session.

| Batch | Exact session window | Entry and protection | Numeric ticket status | Actual-paper status |
| --- | --- | --- | --- | --- |
| Premarket | Broker-returned SMART total-hours window, normally 04:00–09:30 America/New_York; actual holiday/early-close schedule controls | F long 3, SMART LMT USD 13.60 DAY with `outsideRth=true`; full-quantity STP LMT USD 12.54 trigger / USD 12.53 limit GTC with `outsideRth=true` | Fixed separately as `BRONTIDE-EXT-PRE-20260910-P1`; maximum notional USD 40.80, worst-case planned risk USD 3.18, cleanup floor USD 12.54 | Read-only quote/capability and persisted-intent preparation observed; no order, acknowledgement or fill evidence |
| Postmarket | Broker-returned SMART total-hours window after the regular close, normally 16:00–20:00 America/New_York | Same independent-leg requirements as premarket | **Not yet fixed.** A same-session quote is required; RTH or premarket prices cannot be reused | Blocked — no postmarket broker evidence |
| Overnight only | OVERNIGHT venue, normally 20:00–03:50 America/New_York, one session | LMT DAY entry is documented; supported broker-held initial stop protection is not established | No order may be approved or submitted | Blocked by protection boundary and untested paper support |
| Overnight + following day | TWS UI describes the combined window through 16:00 the following day | Installed TWS socket API has no verified documented equivalent of Web API `OND`; no continuous supported protection path is established | No order may be approved or submitted | Blocked by API representation and protection boundary |

For an extended-hours ticket to become approval-ready, the review must show exact symbol, side, quantity (at least three shares for a target plus two runners), fixed entry limit, stop trigger, stop-limit price, notional, planned technical-stop risk, broker schedule/expiry, qualified route and every child's independent session eligibility. A triggered stop-limit may remain unfilled and planned risk is not a guaranteed maximum loss.

Session transition stop conditions are: expired parent or child, partial fill with unreconciled remainder, maintenance break, stale/non-type-1 quote, route or contract capability change, inactive/unknown protection, disconnect, duplicate/reordered callback uncertainty, or mismatch between Position and Journal quantities. Brontide retains confirmed fills, never recreates an expired order automatically, and requires reconciliation before any replacement or batch-owned cleanup.

## Latest read-only capability checkpoint

On 10 September 2026, the verified paper connection reported TWS server version 187 for F. SMART advertised `LMT`, `MIDPX`, `STP`, `STPLMT`, `TRAIL`, `DAY`, `GTC`, `OCA` and `OPG`, with a USD 0.01 minimum tick and broker schedules of 04:00–20:00 / 09:30–16:00 America/New_York for the checked ordinary sessions. OVERNIGHT advertised `LMT` and `DAY`, but not `STP`, `STPLMT` or `TRAIL`; its returned schedule was 20:00–03:50 America/New_York and its off-session quote was incomplete. This was read-only contract/quote evidence, not order, acknowledgement, protection or execution evidence, and it does not unblock either overnight mode.
