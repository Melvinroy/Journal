"""Owned-client TWS callbacks and command transport for the durable paper service."""
from collections import deque
from datetime import datetime, timezone, timedelta
import threading
import uuid

from .ibkr_tws import (TwsPaperClient, PaperSafetyError, authorize_connection,
                       validate_order_fields, PaperGatewayConfig, OperatorVerification)


class PaperTransport(TwsPaperClient):
    def __init__(self, config, verification):
        super().__init__(config, verification)
        self.events = deque()
        self.event_lock = threading.Lock()
        self.execution_end = threading.Event()
        self.execution_ids = set()
        self.completed_end = threading.Event()
        self.history_end = threading.Event()
        self.daily_bars = []
        self.order_id_lock = threading.Lock()
        self.observed_order_id_floor = 0

    def nextValidId(self, order_id):
        with self.order_id_lock:
            super().nextValidId(max(order_id, self._next_order_id or 0, self.observed_order_id_floor))

    def observe_order_id(self, order_id):
        if order_id < 0:
            return
        with self.order_id_lock:
            # reqAllOpenOrders can expose IDs higher than nextValidId, including
            # unrelated orders. Advance the allocator without adopting ownership.
            self.observed_order_id_floor = max(self.observed_order_id_floor, order_id + 1)

    def emit(self, kind, **fields):
        with self.event_lock:
            self.events.append({"eventId": str(uuid.uuid4()), "kind": kind,
                                "observedAt": datetime.now(timezone.utc).isoformat(), **fields})

    def drain(self):
        with self.event_lock:
            result = list(self.events)
            self.events.clear()
            return result

    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId,
                    parentId, lastFillPrice, clientId, whyHeld, mktCapPrice=0):
        self.observe_order_id(orderId)
        self.emit("order-status", orderId=orderId, status=status, filled=float(filled),
                  remaining=float(remaining), clientId=clientId, whyHeld=whyHeld, permId=permId, parentId=parentId)

    def openOrder(self, order_id, contract, order, order_state):
        self.observe_order_id(order_id)
        super().openOrder(order_id, contract, order, order_state)
        fields = {key: getattr(order, key, None) for key in
                  ("account", "action", "orderType", "lmtPrice", "auxPrice", "parentId",
                   "ocaGroup", "ocaType", "orderRef", "clientId", "outsideRth", "tif", "permId")}
        fields["totalQuantity"] = float(order.totalQuantity)
        self.emit("open-order", orderId=order_id, conId=int(contract.conId),
                  status=order_state.status, fields=fields)
        if self._open_orders:
            self._open_orders[-1].update(orderRef=getattr(order, "orderRef", ""),
                                         clientId=getattr(order, "clientId", -1))

    def execDetails(self, reqId, contract, execution):
        self.execution_ids.add(execution.execId)
        self.emit("execution", executionId=execution.execId, orderId=execution.orderId,
                  clientId=execution.clientId, account=execution.acctNumber,
                  conId=int(contract.conId), side=execution.side,
                  quantity=float(execution.shares), price=float(execution.price),
                  executedAt=execution.time, orderRef=execution.orderRef, permId=execution.permId)

    def execDetailsEnd(self, reqId):
        if reqId == 9301: self.execution_end.set()

    def completedOrder(self, contract, order, orderState):
        # This SDK's completed-order wire message does not carry API order/client IDs.
        # Do not present their default zero values as broker identity evidence.
        self.emit("completed-order", conId=int(contract.conId), status=orderState.status,
                  fields={key: getattr(order, key, None) for key in
                          ("account", "orderRef", "permId", "action", "orderType", "lmtPrice", "auxPrice", "tif")},
                  quantity=float(order.totalQuantity), filledQuantity=float(order.filledQuantity))

    def completedOrdersEnd(self):
        self.completed_end.set()

    def completed_order_snapshot(self, timeout=10):
        self.completed_end.clear()
        self.reqCompletedOrders(True)
        if not self.completed_end.wait(timeout):
            raise PaperSafetyError("Completed-order identity reconciliation did not complete.")

    def commissionReport(self, report):
        self.emit("commission", executionId=report.execId, commission=float(report.commission),
                  currency=report.currency)

    def commissionAndFeesReport(self, report):
        # Current official SDK replaces commissionReport with this callback.
        self.emit("commission", executionId=report.execId,
                  commission=float(report.commissionAndFees), currency=report.currency)

    def historicalData(self, reqId, bar):
        if reqId == 9401:
            self.daily_bars.append({"date": bar.date, "high": float(bar.high), "low": float(bar.low), "close": float(bar.close)})

    def historicalDataEnd(self, reqId, start, end):
        if reqId == 9401: self.history_end.set()

    def daily_references(self, contract, timeout=10):
        from zoneinfo import ZoneInfo
        self.history_end.clear()
        self.daily_bars.clear()
        self.reqHistoricalData(9401, self._contract(contract), "", "6 M", "1 day", "TRADES", 1, 1, False, [])
        try:
            if not self.history_end.wait(timeout): raise PaperSafetyError("Daily trailing reference request timed out.")
            bars = sorted(self.daily_bars, key=lambda b: b["date"])
            today = datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")
            if not bars or bars[-1]["date"] != today:
                raise PaperSafetyError("Current-session daily trailing references are unavailable.")
            return {"low": bars[-1]["low"], "high": bars[-1]["high"],
                    **{f"SMA{n}": sum(b["close"] for b in bars[-n:]) / n for n in (10, 20, 50) if len(bars) >= n}}
        finally:
            self.cancelHistoricalData(9401)

    def error(self, req_id, *details):
        super().error(req_id, *details)
        # Both supported SDK callback signatures are normalized by the base client.
        self.emit("broker-error", orderId=req_id, code=self._api_error_codes[-1])

    def connectionClosed(self):
        super().connectionClosed()
        self.emit("disconnected")

    def reserve(self, count):
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise PaperSafetyError("Order ID count must be a positive integer.")
        with self.order_id_lock:
            if self._next_order_id is None or not self._order_id_ready.is_set():
                raise PaperSafetyError("Broker order IDs are unavailable.")
            start = max(self._next_order_id, self.observed_order_id_floor)
            self._next_order_id = start + count
            return list(range(start, start + count))

    def write(self, order_id, contract, fields):
        account = authorize_connection(self.config, self.verification, self._managed_accounts)
        if not self.isConnected() or account != self.authorized_account:
            raise PaperSafetyError("The verified paper connection is unavailable.")
        order = self._order(validate_order_fields(account, fields))
        for key in ("parentId", "ocaGroup", "ocaType", "goodTillDate"):
            if key in fields: setattr(order, key, fields[key])
        self.placeOrder(order_id, self._contract(contract), order)

    def cancel_owned(self, order_id):
        authorize_connection(self.config, self.verification, self._managed_accounts)
        if not self.isConnected(): raise PaperSafetyError("Disconnected: cancellation is not confirmed.")
        from ibapi.order_cancel import OrderCancel
        self.cancelOrder(order_id, OrderCancel())

    def execution_snapshot(self, timeout=10):
        from ibapi.execution import ExecutionFilter
        request = ExecutionFilter()
        request.acctCode = self.authorized_account
        request.clientId = self.config.client_id
        # Current TWS needs an explicit day window; the old date filter alone
        # returned no prior-local-day executions even with Trade Log open.
        if hasattr(request, "lastNDays") and (self.serverVersion() or 0) >= 200:
            request.lastNDays = 7
        # Explicit UTC history avoids losing an open campaign at local midnight.
        request.time = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y%m%d-%H:%M:%S")
        self.execution_end.clear()
        self.execution_ids.clear()
        self.reqExecutions(9301, request)
        if not self.execution_end.wait(timeout):
            raise PaperSafetyError("Execution reconciliation did not complete.")
        return set(self.execution_ids)


def transport_from_environment():
    import os
    from pathlib import Path
    config = PaperGatewayConfig.from_environment()
    if config.host not in {"127.0.0.1", "localhost", "::1"}:
        raise PaperSafetyError("Paper execution requires a loopback TWS endpoint.")
    path = os.environ.get("BRONTIDE_IBKR_VERIFICATION_FILE")
    if not path: raise PaperSafetyError("Operator paper verification is required.")
    verification = OperatorVerification.load(Path(path))
    verification.validate_for(config)
    return PaperTransport(config, verification)
