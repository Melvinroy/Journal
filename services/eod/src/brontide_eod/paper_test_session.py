"""Durable, authenticated paper acceptance sessions; never a second broker client."""
from copy import deepcopy
from datetime import datetime, timezone
import math
import json
import uuid

from .ibkr_tws import PaperSafetyError
from .paper_domain import summarize

SYMBOLS = ("F", "SOFI", "INTC", "BAC", "XLF", "T", "PFE", "C", "UBER")
from .paper_policy import LIMITS
SCENARIOS = ("Limit", "Normal", "Breakout", "one target", "two targets", "one runner", "two runners", "breakeven", "amendment", "entry cancellation", "bounded closure", "reconnection")
CAP_REJECTION = "The refreshed executable quote crossed the saved hard cap."


def now(): return datetime.now(timezone.utc)
def age(value): return (now() - datetime.fromisoformat(value)).total_seconds()


def session_ticket(instrument, index, session_id):
    """Fixed approval policy. Every resulting exact ticket is separately persisted."""
    q, contract = instrument["quote"], instrument["contract"]
    bid, ask, tick = q.get("bid"), q.get("ask"), contract["minimumTick"]
    if not instrument["executable"] or q.get("marketDataType") != 1 or not 0 <= age(instrument["observedAt"]) <= 15:
        raise PaperSafetyError("Fresh executable session quotes are unavailable.")
    if not bid or not ask or bid <= 0 or ask < bid or ask - bid > max(.02, ask * .001):
        raise PaperSafetyError("Candidate spread exceeds the approved test bound.")
    up = lambda n: round(math.ceil((n - 1e-9) / tick) * tick, 8)
    down = lambda n: round(math.floor((n + 1e-9) / tick) * tick, 8)
    cap = up(ask + 2 * tick)
    stop = down(bid - max(10 * tick, bid * .005))
    target = {"id": "T1", "role": "Target", "allocationPercent": 100, "target": {"mode": "R", "multipleR": .5}}
    modes = [{"mode": "Dollar", "distance": max(tick, round(bid * .002, 2))}, {"mode": "Percentage", "percent": .2},
             {"mode": "SMA", "period": 10}, {"mode": "SMA", "period": 20}, {"mode": "SMA", "period": 50},
             {"mode": "Day extreme"}, {"mode": "Manual", "stopPrice": stop}]
    runner = {"id": "A", "role": "Runner", "allocationPercent": 50, "activationR": .5, "trailing": modes[(index // 5) % len(modes)]}
    shape = index % 5
    legs = [target]
    if shape == 1: legs = [dict(target, allocationPercent=50), dict(target, id="T2", allocationPercent=50, target={"mode": "R", "multipleR": 1})]
    if shape == 2: legs = [dict(target, allocationPercent=50), runner]
    if shape == 3: legs = [dict(target, allocationPercent=35), dict(target, id="T2", allocationPercent=35), dict(runner, allocationPercent=30)]
    if shape == 4: legs = [dict(target, allocationPercent=35), dict(runner, allocationPercent=35), dict(runner, id="B", allocationPercent=30, trailing=modes[((index // 5) + 1) % len(modes)])]
    quantity = len(legs)
    if stop <= 0 or quantity * cap > 245 or quantity * (cap - stop) > 10:
        raise PaperSafetyError("Candidate cannot fit the approved quantity, notional and stop-risk bounds.")
    method = ("Limit", "Normal", "Breakout")[index % 3]
    cancellation = index > 0 and index % 11 == 0
    if cancellation:
        method = "Breakout"
        cap = up(ask + max(3 * tick, ask * .001) + 2 * tick)
        if quantity * cap > 245 or quantity * (cap - stop) > 10:
            raise PaperSafetyError("Cancellation ticket exceeds the approved bounds.")
    result = {"planId": session_id, "planRevision": str(index), "planningSource": "IBKR TWS snapshot",
              "symbol": contract["symbol"], "direction": "Long", "method": method, "quantity": quantity,
              "planningPrice": ask, "hardCap": cap, "stopPrice": stop, "cleanupFloor": stop,
              "sessionMode": "Regular", "duration": "DAY", "protectionOrderType": "STP",
              "exitPlan": {"schemaVersion": 1, "legs": legs, "breakeven": {"activationR": .5, "favorableOffset": {"unit": "Dollar", "value": 0}}}}
    if method == "Breakout": result["triggerPrice"] = up(cap - 2 * tick) if cancellation else up(ask + tick)
    return result, cancellation


class PaperTestSessions:
    def __init__(self, service): self.s = service

    def save(self, session):
        with self.s.store.transaction() as db: self.s.store.put(db, "test-session", session["id"], session)

    def status(self):
        sessions = self.s.store.all("test-session")
        if not sessions: return None
        session = deepcopy(sessions[-1])
        session.pop("userId", None)
        return session

    def reject_unsent(self, session, attempt, reason):
        """Record a known validation rejection, never classify a socket failure."""
        if reason != CAP_REJECTION: raise PaperSafetyError("Uncertain submission cannot be classified as a price rejection.")
        s = self.s
        with s.store.transaction() as db:
            batch = s.store.get(db, "batch", attempt["batchId"])
            if batch["accountBinding"] != session["accountBinding"] or batch["sourceIdentity"] != session["sourceIdentity"]:
                raise PaperSafetyError("Rejected ticket identity differs from the approved session.")
            if db.execute("SELECT 1 FROM objects WHERE kind='campaign' AND id=?", (attempt["campaignId"],)).fetchone() or db.execute(
                "SELECT 1 FROM commands WHERE id=? OR campaign=?", (attempt["commandId"], attempt["campaignId"])).fetchone():
                raise PaperSafetyError("Durable submission evidence exists; reconcile instead of rejecting or retrying.")
            receipt = {"sessionId": session["id"], "batchId": attempt["batchId"], "commandId": attempt["commandId"],
                       "reason": reason, "at": now().isoformat(), "reviewedSource": s.source(), "userId": s.operator_id}
            s.store.event(db, "preflight-rejection:" + attempt["commandId"], receipt)
            s.store.put(db, "entry-rejection", attempt["batchId"], receipt)
            attempt["result"] = {"state": "rejected before transmission", "reason": reason}
            s.store.put(db, "test-session", session["id"], session)

    def rejected(self, attempt):
        with self.s.store.transaction() as db:
            return db.execute("SELECT 1 FROM objects WHERE kind='entry-rejection' AND id=?", (attempt["batchId"],)).fetchone() is not None

    def amend_target(self, session_id, target, command_id):
        s = self.s
        scope = s.snapshot_scope()
        if not scope or not s.operator_deadline or now() >= s.operator_deadline:
            raise PaperSafetyError("A current authenticated paper operator is required.")
        with s.store.transaction() as db:
            session = s.store.get(db, "test-session", session_id)
            if session["userId"] != s.operator_id or session["accountBinding"] != scope["accountBinding"]:
                raise PaperSafetyError("Session owner or account differs.")
            request = {"action": "reduce-target", "target": target, "userId": s.operator_id}
            prior = db.execute("SELECT request FROM commands WHERE id=?", (command_id,)).fetchone()
            if prior:
                s.store.command(db, command_id, session_id, request)
                return {"id": session_id, "target": session["target"], "state": session["state"]}
            owned = {a["campaignId"] for a in session.get("attempts", [])}
            historical = [json.loads(row[0]) for row in db.execute("SELECT body FROM objects WHERE kind='campaign'")]
            baseline = sum(c["id"] not in owned and c["accountBinding"] == session["accountBinding"] and c["state"] == "Closed" and summarize(c)["entered"] > 0 and summarize(c)["costsComplete"] for c in historical)
            total = session["completed"] - session.get("baselineCompleted", 0) + baseline
            if session["state"] not in {"Halted", "Paused"} or isinstance(target, bool) or not isinstance(target, int) or not max(1, total) <= target <= min(30, session["target"]):
                raise PaperSafetyError("Only a halted or paused session may reduce its target, to at most 30 and no less than completed trades.")
            receipt = {**request, "sessionId": session_id, "previousTarget": session["target"], "at": now().isoformat(), "accountBinding": scope["accountBinding"]}
            s.store.command(db, command_id, session_id, request)
            s.store.event(db, "session-target-amendment:" + command_id, receipt)
            session.setdefault("approvalAmendments", []).append(receipt)
            session.update(target=target, baselineCompleted=baseline, completed=total)
            s.store.put(db, "test-session", session_id, session)
        return self.status()

    def start(self, command_id, target=30):
        s = self.s
        s._connected()
        if not s.operator_id or not s.operator_deadline or now() >= s.operator_deadline:
            raise PaperSafetyError("A current authenticated paper operator is required.")
        for prior in s.store.all("test-session"):
            if prior["id"] == command_id:
                if prior["userId"] != s.operator_id or prior["target"] != target:
                    raise PaperSafetyError("Session command identity was reused.")
                return self.status()
            if prior["state"] != "Complete": raise PaperSafetyError("An existing test session must be reconciled before creating another.")
        if not s.client.config.submissions_enabled: raise PaperSafetyError("Server paper submissions are locked.")
        s.reconcile()
        if any(c["state"] not in {"Closed", "Cancelled"} for c in s.store.all("campaign")):
            raise PaperSafetyError("Recover and close the existing pilot before starting a test session.")
        if any(not q.get("resolved") for q in s.store.all("quarantine")):
            raise PaperSafetyError("Quarantined broker evidence blocks a test session.")
        if not isinstance(target, int) or not 1 <= target <= 30: raise PaperSafetyError("Session target must be 1–30 completed round trips.")
        session = {"id": command_id, "userId": s.operator_id, "accountBinding": s.client.config.binding(), "sourceIdentity": s.source(),
                   "approvedAt": now().isoformat(), "target": target, "state": "Running", "message": "Approved; waiting for first protected campaign",
                   "limits": LIMITS, "scenarios": SCENARIOS, "symbols": SYMBOLS, "attempts": [], "completed": 0, "checkpoints": [], "connectionId": s.connection_id}
        with s.store.transaction() as db:
            s.store.event(db, "session-approval:" + command_id, deepcopy(session))
            s.store.put(db, "test-session", command_id, session)
        return self.status()

    def pause(self):
        sessions = self.s.store.all("test-session")
        if sessions:
            session = sessions[-1]
            if session["state"] == "Running":
                session["state"] = "Draining"; session["message"] = "New entries paused; finishing owned cleanup"
                self.save(session)
        return self.status()

    def resume(self):
        s = self.s
        sessions = s.store.all("test-session")
        if not sessions: raise PaperSafetyError("No approved test session exists.")
        session = sessions[-1]
        if session["target"] > 30: raise PaperSafetyError("Record an authenticated target reduction to at most 30 before resuming.")
        s._connected()
        if s.operator_id != session["userId"] or not s.operator_deadline or now() >= s.operator_deadline:
            raise PaperSafetyError("Sign into the approved operator account.")
        if session["accountBinding"] != s.client.config.binding():
            raise PaperSafetyError("Session account binding changed.")
        if not s.client.config.submissions_enabled: raise PaperSafetyError("Server paper submissions are locked.")
        if session["state"] == "Complete": return self.status()
        s.reconcile()
        # Recover the captured preflight failure only under its precise reason,
        # with durable proof that transmission was never reached.
        if session["state"] == "Halted" and session["message"] == CAP_REJECTION and session["attempts"]:
            attempt = session["attempts"][-1]
            if not self.rejected(attempt): self.reject_unsent(session, attempt, CAP_REJECTION)
        if session["sourceIdentity"] != s.source():
            # Explicit authenticated resume can renew the source approval only
            # after every old campaign is economically complete and cleared.
            campaigns = {c["id"]: c for c in s.store.all("campaign")}
            if any(c["state"] not in {"Closed", "Cancelled"} or
                   (c["state"] == "Closed" and not summarize(c)["costsComplete"]) for c in campaigns.values()):
                raise PaperSafetyError("Close and reconcile every campaign before approving the repaired source.")
            if any((a["campaignId"] not in campaigns and not self.rejected(a)) or any(v["state"] == "pending" for v in a.get("actions", {}).values()) for a in session["attempts"]):
                raise PaperSafetyError("Uncertain session operations block source approval.")
            if any(not q.get("resolved") for q in s.store.all("quarantine")):
                raise PaperSafetyError("Quarantined evidence blocks source approval.")
            if session["limits"] != LIMITS or list(session["scenarios"]) != list(SCENARIOS) or list(session["symbols"]) != list(SYMBOLS):
                raise PaperSafetyError("Session policy changed; its original approval cannot be reused.")
            receipt = {"sessionId": session["id"], "userId": s.operator_id, "accountBinding": session["accountBinding"],
                       "previousSource": session["sourceIdentity"], "sourceIdentity": s.source(), "at": now().isoformat()}
            session.setdefault("sourceReviews", []).append(receipt)
            session["sourceIdentity"] = receipt["sourceIdentity"]
            with s.store.transaction() as db:
                s.store.event(db, "session-source-review:" + str(uuid.uuid4()), receipt)
                s.store.put(db, "test-session", session["id"], session)
        session["state"] = "Running"; session["message"] = "Resuming approved session after fresh reconciliation"
        self.save(session)
        return self.status()

    def halt(self, session, reason):
        session["state"] = "Halted"; session["message"] = reason
        self.save(session)
        self.s.disarm()

    def act(self, session, attempt, campaign, action, payload=None):
        key = action + (":" + str(campaign["revision"]) if action in {"save-amendment", "apply-amendment"} else "")
        if key in attempt.setdefault("actions", {}): return
        command = str(uuid.uuid4())
        attempt["actions"][key] = {"commandId": command, "revision": campaign["revision"], "state": "pending"}
        self.save(session)  # No retry if interruption leaves this operation uncertain.
        operation = self.s.action if action == "save-amendment" else self.s.review_action
        operation(campaign["id"], campaign["revision"], command, action, payload)
        attempt["actions"][key]["state"] = "accepted"
        self.save(session)

    def step(self):
        s = self.s
        sessions = s.store.all("test-session")
        if not sessions or sessions[-1]["state"] not in {"Running", "Draining"}: return
        session = sessions[-1]
        if not s.operator_id or not s.operator_deadline or now() >= s.operator_deadline: return
        try:
            if session["target"] > 30: raise PaperSafetyError("Historical target requires an authenticated reduction to 30 before execution.")
            s._connected()
            if session["userId"] != s.operator_id or session["accountBinding"] != s.client.config.binding() or session["sourceIdentity"] != s.source():
                raise PaperSafetyError("Session user, account or verified source changed.")
            if not s.client.config.submissions_enabled: raise PaperSafetyError("Server submissions are locked.")
            if any(not q.get("resolved") for q in s.store.all("quarantine")): raise PaperSafetyError("Broker callback conflict requires reconciliation.")
            s.reconcile()
            campaigns = {c["id"]: c for c in s.store.all("campaign")}
            owned_ids = {a["campaignId"] for a in session["attempts"]}
            if any(c["state"] not in {"Closed", "Cancelled"} and c["id"] not in owned_ids for c in campaigns.values()):
                raise PaperSafetyError("Another campaign requires attention before session continuation.")
            completed, active = session.get("baselineCompleted", 0), []
            for attempt in session["attempts"]:
                if self.rejected(attempt): continue
                c = campaigns.get(attempt["campaignId"])
                if c is None: raise PaperSafetyError("Persisted submission has no confirmed campaign; no retry is permitted.")
                result = summarize(c)
                if c["state"] in {"Needs reconciliation", "Unprotected"}: raise PaperSafetyError(c.get("message") or "Campaign protection failed.")
                if any(a["state"] == "pending" for a in attempt.get("actions", {}).values()): raise PaperSafetyError("Session action outcome requires reconciliation.")
                if c["state"] == "Closed":
                    if not result["costsComplete"]:
                        raise PaperSafetyError("Closed campaign is missing accounting evidence; await fees before continuing.")
                    if result["entered"] > 0 and result["entered"] == result["exited"] and result["openQuantity"] == 0:
                        completed += 1
                        attempt["result"] = {"state": "broker-observed round trip", "executionIds": [e["executionId"] for e in c["executions"]], "summary": result}
                    continue
                if c["state"] == "Cancelled":
                    attempt["result"] = {"state": "cancelled entry; not a round trip"}; continue
                active.append((attempt, c))
            session["completed"] = completed
            for checkpoint in (1, 10, 20, 30):
                if completed >= checkpoint and checkpoint not in session["checkpoints"]: session["checkpoints"].append(checkpoint)
            if completed >= session["target"] or session["state"] == "Draining":
                if not active:
                    session["state"] = "Complete" if completed >= session["target"] else "Paused"
                    session["message"] = "Owned campaigns flat and cleared; submissions locked"
                    self.save(session); s.disarm(); return
            if session["connectionId"] != s.connection_id:
                # Standing approval covers only this session's exact owned campaigns.
                for attempt, c in active:
                    s.review_action(c["id"], c["revision"], str(uuid.uuid4()), "resume")
                session["connectionId"] = s.connection_id
                session.setdefault("reconciledConnections", []).append({"at": now().isoformat(), "connectionId": s.connection_id})
            self.save(session)
            for attempt, c in active:
                if age(c["createdAt"]) > 180: raise PaperSafetyError("Campaign exceeded its bounded completion window; inspect protected exposure.")
                if not c.get("entryFinal") and age(c["createdAt"]) > 20:
                    self.act(session, attempt, c, "cancel-entry"); return
                if c.get("entryFinal") and summarize(c)["openQuantity"]:
                    if age(c["createdAt"]) > 45 or session["state"] == "Draining":
                        self.act(session, attempt, c, "cleanup"); return
                    if attempt["index"] % 7 == 6 and not c.get("cleanup"):
                        if not any(key.startswith("save-amendment") for key in attempt["actions"]):
                            if summarize(c)["openQuantity"] < len(c["ticket"]["exitPlan"]["legs"]): continue
                            amendment = deepcopy(c["ticket"]["exitPlan"])
                            amendment["breakeven"]["activationR"] = .75
                            self.act(session, attempt, c, "save-amendment", amendment); return
                        if c.get("draft"):
                            self.act(session, attempt, c, "apply-amendment", {"digest": c["draft"]["digest"]}); return
                        if "resume" not in attempt["actions"]:
                            self.act(session, attempt, c, "resume"); return
            capacity = 1 if completed == 0 else 2
            if session["state"] != "Running" or len(active) >= capacity or completed + len(active) >= session["target"]: return
            if len(session["attempts"]) >= session["target"] * 3: raise PaperSafetyError("Attempt limit reached; unfilled entries do not count as completed tests.")
            index = len(session["attempts"])
            unavailable = {str(p.get("symbol", "")).upper() for p in [*s.snapshot.position_rows, *s.snapshot.open_order_rows]}
            reasons = []
            for symbol in SYMBOLS[index % len(SYMBOLS):] + SYMBOLS[:index % len(SYMBOLS)]:
                if symbol in unavailable: continue
                try:
                    ticket, cancellation = session_ticket(s.quote(symbol), index, session["id"])
                    batch = s.prepare_batch([ticket])
                except PaperSafetyError as exc:
                    reasons.append(f"{symbol}: {exc}"); continue
                attempt = {"index": index, "batchId": batch["id"], "campaignId": batch["id"] + ":0", "ticket": ticket,
                           "cancellationCase": cancellation, "commandId": str(uuid.uuid4()), "createdAt": now().isoformat(), "actions": {}}
                session["attempts"].append(attempt); self.save(session)
                try:
                    s.approve(batch["id"], batch["digest"], str(uuid.uuid4()))
                    s.submit(batch["id"], 0, attempt["commandId"])
                except PaperSafetyError as exc:
                    if str(exc) != CAP_REJECTION: raise
                    self.reject_unsent(session, attempt, str(exc))
                    session["message"] = "Price moved beyond the exact cap; ticket rejected without transmission"
                    self.save(session); return
                session["message"] = f"{completed}/{session['target']} completed; exact protected ticket submitted"
                self.save(session); return
            raise PaperSafetyError("No eligible candidate: " + "; ".join(reasons))
        except Exception as exc:
            self.halt(session, str(exc) if isinstance(exc, PaperSafetyError) else "Session operation failed; reconcile before any retry.")
