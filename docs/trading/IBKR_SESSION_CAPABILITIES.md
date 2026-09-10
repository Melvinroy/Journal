# IBKR TWS paper session capability boundary

Status: implementation and deterministic verification only. TWS Read-Only and Brontide submissions remain locked. A TWS control appearing in the UI is not treated as socket-API support.

## Verified local surface

- Official Python `ibapi` installed in `services/eod/.venv`: **10.30.1**. Its `Order` object exposes `tif`, `outsideRth`, `parentId`, `ocaGroup`, `transmit`, `goodAfterTime` and `goodTillDate`. `ContractDetails` exposes `orderTypes`, `validExchanges`, `tradingHours`, `liquidHours` and `timeZoneId`.
- Brontide now captures those contract fields, the TWS server version and the exact qualified route with each read-only instrument snapshot. Eligibility is resolved per contract rather than inferred from `DAY`, `GTC`, a port or a UI preset.
- `America/New_York` coverage and DAY expiry are derived from the broker's returned schedule. That preserves DST offsets, `CLOSED` holidays and early closes. The immutable execution timestamp and broker trade date remain separate fields.
- Read-only checkpoint on 10 September 2026: the verified paper session reported TWS server version **187** for F. SMART advertised LMT/MIDPX/STP/STPLMT/TRAIL plus DAY/GTC, while OVERNIGHT advertised LMT/DAY but no STP, STPLMT or TRAIL. The broker returned ordinary SMART total/liquid windows of 04:00–20:00 / 09:30–16:00 America/New_York and OVERNIGHT windows of 20:00–03:50. The SMART quote was complete market-data type 1; the off-session OVERNIGHT quote was incomplete. This is capability and quote evidence only, not order or execution validation.

## Supported combinations

| Brontide selection | Entry | Duration | Route / `outsideRth` | Initial protection | Submission status |
| --- | --- | --- | --- | --- | --- |
| Regular hours | Existing `MIDPRICE`; supported stop-limit entry remains separate | DAY or GTC | SMART / false | Explicit STP by default; STP LMT only with explicit trigger and limit | Eligible only when the qualified contract advertises every selected type and the current liquid-hours schedule is present |
| Regular + extended | Explicit LMT only | DAY or GTC | SMART / true | Explicit STP LMT with its own trigger, limit and `outsideRth=true` | Eligible only when the qualified contract advertises LMT and STPLMT and returns a current total-trading-hours schedule |
| Overnight only | Explicit LMT planning | DAY only | OVERNIGHT venue | No verified supported broker-held stop protection | **Blocked for submission**; planning remains available |
| Overnight + following day | Explicit LMT planning | DAY only in Brontide | No verified socket-API representation | No verified continuous supported protection | **Blocked for submission**; Web API `OVT`/`OND` values are not copied into TWS API orders |

Every parent and child carries its own `outsideRth` value. Parent eligibility is never inherited by a child. A stop-limit trigger does not guarantee a fill; Brontide distinguishes requested, broker acknowledged, currently session-eligible, triggered-but-unfilled, inactive and unknown protection. Sizing continues to use the technical stop and is not represented as a guaranteed loss cap.

Bracket transmission continues to use explicit parent/child IDs and transmit sequencing. OCA/replace logic remains quantity-reconciled; an expired order is never recreated or rerouted without a new explicit intent. Application-managed breakeven and trailing rules pause when disconnected and require a fresh executable-side quote in the rule's eligible session.

## Official sources

- [TWS API Order object](https://interactivebrokers.github.io/tws-api/classIBApi_1_1Order.html) — `tif`, `outsideRth`, parent, transmit and order price fields.
- [TWS API ContractDetails](https://interactivebrokers.github.io/tws-api/classIBApi_1_1ContractDetails.html) — route-specific trading/liquid hours, timezone, valid exchanges and order types.
- [IBKR TWS API overnight routing](https://ibkrcampus.com/campus/ibkr-quant-news/api-overnight-trading/) — the socket API uses `exchange=OVERNIGHT` and matching OVERNIGHT market data.
- [IBKR overnight limit-order lesson](https://ibkrcampus.com/campus/trading-lessons/overnight-trading-using-limit-order/) — overnight is a distinct venue, limit/Adaptive only, one session, 20:00–03:50 ET; the UI's Overnight + Day behavior is described separately.
- [Web API overnight submission](https://ibkrcampus.com/docs/web-api/v1/endpoints/orders/overnight-order-submission) — `OVT` and `OND` are documented for Web API, not reused by this TWS socket adapter.
- [Outside-RTH eligibility](https://ibkrcampus.com/campus/trading-lessons/trading-outside-regular-trading-hours-rth/) — outside-RTH activation/trigger/fill applies only where available for the product.
- [TWS API bracket transmission](https://ibkrcampus.com/docs/general/order-types/complex-orders/bracket-orders) — attached-order parent IDs and transmit sequencing.
- [IBKR paper-account limitations](https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/) — simulated stops/complex orders and unsupported Auction/VWAP/RFQ/Pegged-to-Market behavior.

## Evidence limits

Deterministic tests verify combination rejection, independent leg fields, tick/direction rules, partial-entry expiry, inactive/triggered-unfilled protection, reconnect state, DST, early close and overnight trade-date derivation. No premarket, postmarket or overnight paper order has been submitted. Quote availability, acknowledgements, fills, child activation and paper-simulator behavior remain Blocked until each actual session receives its own separately approved numeric batch.
