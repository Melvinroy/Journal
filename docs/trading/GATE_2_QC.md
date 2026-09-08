# Gate 2 QC status

Branch: `codex/trading-plan-position-journal`

Status: **Blocked for complete Gate 2 passage.** Deterministic adapter/failure simulations are implemented; no TWS/IB Gateway paper session was connected and no broker order was submitted. Every actual-paper result therefore remains Blocked. A simulated Pass is not broker evidence.

Evidence command: `node --test tests/ibkr-paper-adapter.test.mjs`

Repository verification on 2026-09-09:

- Pass — 132 Node tests, including 28 Stage 2 adapter/safety tests.
- Pass — 100 isolated backend tests, including 8 official-SDK boundary tests; two existing dependency deprecation warnings remain.
- Pass — TypeScript.
- Pass — four existing locked Chromium regressions.
- Pass — production build.
- Evidence directory: `C:\Users\melvi\Projects\Journal-trading-gate2-evidence\candidate-verify`.
- Blocked — official `ibapi` SDK import and connected transport execution were not exercised because the SDK and paper gateway are not installed/running.

| ID | Simulated result | Actual paper result |
| --- | --- | --- |
| P01 | Pass — capped long MIDPRICE and full-share stop constructed | Blocked — no paper gateway/order evidence |
| P02 | Pass — short entry/protection mirrored; invalid stop rejected | Blocked — no paper gateway, permission or borrow evidence |
| P03 | Pass — MIDPRICE ticket has no market fallback | Blocked — no observed working paper order |
| P04 | Pass — cent changes within cap remain eligible | Blocked — no live paper quote/submission evidence |
| P05 | Pass — quote crossing cap becomes ineligible | Blocked — no broker submission observation |
| P06 | Pass — STP LMT trigger and separate worst price constructed | Blocked — no paper trigger/fill evidence |
| P07 | Pass — gap beyond cap is ineligible; no market conversion | Blocked — no paper gap observation |
| P08 | Pass — exact `LMT` + `OPG` construction; submission fails closed | Blocked — IBKR documents Auction as unsupported in paper; unvalidated auction submission disabled |
| P09 | Pass — every Gate 2 entry/protection ticket is RTH-only | Blocked — no broker rejection/compatibility evidence |
| P10 | Pass — cumulative fills require equal stop coverage; targets staged | Blocked — no fragmented broker fills |
| P11 | Pass — final protected partial quantity alone activates exits | Blocked — no broker cancel/expire evidence |
| P12 | Pass — edited one-target + runner allocation conserves shares | Blocked — no paper target execution |
| P13 | Pass — 35/35/30 allocation and rounding conserve shares | Blocked — no paper target execution |
| P14 | Pass — price touch without confirmed fill leaves stop unchanged | Blocked — no broker touch/unfilled evidence |
| P15 | Pass — confirmed 1R fill calculation moves stop to breakeven | Blocked — no confirmed paper fill/modify evidence |
| P16 | Pass — tighter long/short stops are never loosened | Blocked — no broker modification evidence |
| P17 | Pass — SMA10/20/50, day extreme, dollar, percentage and manual rules tested | Blocked — no working paper runner orders |
| P18 | Pass — first stop rejection produces exactly one retry action | Blocked — no broker reject/accept evidence |
| P19 | Pass — second rejection persists Unprotected; no auto-market-close | Blocked — no repeated broker rejection evidence |
| P20 | Pass — duplicate idempotency key submits once | Blocked — no duplicate-click broker order comparison |
| P21 | Pass — timeout reconciles broker reference before retry | Blocked — no accepted-then-timeout broker evidence |
| P22 | Pass — reconnect state reconstructs cumulative fill/protection | Blocked — no gateway disconnect/restart evidence |
| P23 | Pass — broker quantity wins race and delta is imported once | Blocked — no broker cancel/replace race evidence |
| P24 | Pass — external liquidation reaches zero and closes campaign | Blocked — no manual paper liquidation evidence |
| P25 | Pass — external quantity delta receives Changed in IBKR semantics | Blocked — no manual paper modification evidence |
| P26 | Pass — EOD fallback is dated/non-executable; absence is not fabricated | Blocked — no connected stale/missing data observation |
| P27 | Pass — equity accepted only for exact active connection; stale connection rejected | Blocked — no paper account-value stream/failure evidence |
| P28 | Pass — warning remains pending until explicit confirm/cancel | Blocked — no IBKR precautionary warning evidence |

P08 sources: IBKR's API order-type documentation specifies Limit-on-Open as a limit order with `orderType=LMT`, `tif=OPG`, quantity and limit price. IBKR's paper-account guide says some order types, including Auction, are unsupported. These simulated checks do not prove opening-auction execution.
