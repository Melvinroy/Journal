# Consolidated paper-acceptance QC coverage

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
