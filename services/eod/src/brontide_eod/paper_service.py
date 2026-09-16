"""Serialized, durable, account-bound paper execution. No endpoint enables live trading."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid

from .ibkr_execution import prepare_paper_intent, broker_session_phase
from .ibkr_readonly import IbkrReadOnlyService
from .ibkr_tws import PaperSafetyError, mask_account_id, verify_connected_account
from .paper_domain import validate_exit_plan, allocations, next_stop, summarize, positive
from .paper_store import PaperStore, canonical
from .paper_transport import transport_from_environment

TERMINAL = {"Filled", "Cancelled", "ApiCancelled", "Inactive"}
WORKING = {"Submitted", "PreSubmitted"}


def utcnow(): return datetime.now(timezone.utc)
def stamp(): return utcnow().isoformat()
def parsed(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None: raise PaperSafetyError("A timezone-qualified timestamp is required.")
    return result


def execution_time(value):
    """Preserve economic fills; ambiguous broker clock values remain unavailable."""
    from zoneinfo import ZoneInfo
    try:
        return parsed(value).astimezone(timezone.utc).isoformat()
    except (ValueError, PaperSafetyError):
        try:
            date, clock, zone = value.split()
            return datetime.strptime(date + " " + clock, "%Y%m%d %H:%M:%S").replace(tzinfo=ZoneInfo(zone)).astimezone(timezone.utc).isoformat()
        except (ValueError, KeyError):
            return ""


def source_identity():
    root = Path(__file__).resolve().parents[4]
    result = subprocess.run(["node", "--input-type=module", "-e",
        "import {getPreviewIdentity} from './scripts/preview-identity.mjs'; console.log(getPreviewIdentity().identifier)"],
        cwd=root, capture_output=True, text=True, timeout=10,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    identity = result.stdout.strip()
    manifest = root / "out" / "brontide-preview-identity.json"
    if result.returncode or not manifest.exists() or json.loads(manifest.read_text())["identifier"] != identity:
        raise PaperSafetyError("Build and serve the current source before preparing a paper batch.")
    return identity


class CaptureIntent:
    def upsert(self, record):
        self.record = record
        return record


class PaperService:
    def __init__(self, store=None, factory=transport_from_environment, source=source_identity):
        self.store = store or PaperStore()
        self.factory = factory
        self.source = source
        self.client = None
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.armed = None
        self.connection_id = None
        self.error = None
        self.snapshot = None
        self.last_reconciled = None
        self.daily_cache = {}
        self.pending_events = []
        self.operator_id = None
        self.operator_deadline = None
        self.broker_view = None
        self.last_quote = None
        self.management_only = False
        self.reviewed_campaigns = set()
        self.authorized_batches = set()

    def authenticated(self, user_id):
        with self.lock:
            if self.operator_id and (self.operator_id != user_id or not self.operator_deadline or utcnow() >= self.operator_deadline):
                self.disarm()
            self.operator_id = user_id
            self.operator_deadline = utcnow() + timedelta(seconds=60)

    def readiness(self, connected, campaigns):
        if any(c["state"] in {"Unprotected", "Needs reconciliation"} for c in campaigns):
            return {"state": "error", "message": "Position or protection needs review."}
        if not connected: return {"state": "disconnected", "message": "Open and sign into the linked paper TWS on this computer."}
        if self.error: return {"state": "blocked", "message": self.error}
        if not self.last_reconciled or (utcnow() - parsed(self.last_reconciled)).total_seconds() > 20:
            return {"state": "blocked", "message": "Broker reconciliation is stale."}
        if not self.last_quote or not self.last_quote["executable"] or self.last_quote["quote"].get("marketDataType") != 1 or (utcnow() - parsed(self.last_quote["observedAt"])).total_seconds() > 15:
            codes = getattr(self.client, "_api_error_codes", [])
            return {"state": "blocked", "message": "Paper quotes blocked by a competing live session (IBKR 10197)." if 10197 in codes else "A fresh live executable quote is required for the selected instrument."}
        if not self.client.config.submissions_enabled:
            return {"state": "blocked", "message": "Connected; server paper submissions are locked."}
        if any(c["state"] not in {"Closed", "Cancelled"} and (c["id"] not in self.reviewed_campaigns if self.operator_id else not self.armed) for c in campaigns):
            return {"state": "blocked", "message": "Reconnected. Review the position before resuming managed exits."}
        return {"state": "ready", "message": "Paper connection and data ready. Each order still requires exact review."}

    def status(self):
        with self.lock:
            connected = bool(self.client and self.client.isConnected() and self.client.authorized_account)
            campaigns = self.store.all("campaign")
            return {"mode": "paper", "connected": connected, "armedBatch": self.armed,
                    "submissionsEnabled": bool(connected and self.client.config.submissions_enabled),
                    "accountBinding": self.client.config.binding() if connected else None,
                    "account": mask_account_id(self.client.authorized_account) if connected else None,
                    "connectionId": self.connection_id, "lastReconciled": self.last_reconciled,
                    "error": self.error, "readiness": self.readiness(connected, campaigns),
                    "broker": self.broker_view, "quote": self.last_quote,
                    "campaigns": [self.public_campaign(c) for c in campaigns],
                    "batches": [self.public_batch(b) for b in self.store.all("batch")],
                    "blocked": ["Short entry fill bounds", "Opening auction", "Overnight sessions"],
                    "limits": {"sharesPerCampaign": 3, "campaigns": 2, "entryNotional": 500, "plannedRiskPerCampaign": 10, "totalPlannedRisk": 20}}

    @staticmethod
    def public_batch(batch):
        return {k: deepcopy(batch[k]) for k in ("id", "digest", "sourceIdentity", "validUntil", "tickets", "createdAt")}

    @staticmethod
    def public_campaign(c):
        return {"id": c["id"], "batchId": c["batchId"], "revision": c["revision"],
                "symbol": c["ticket"]["symbol"], "direction": c["ticket"]["direction"],
                "state": c["state"], "message": c.get("message"), "ticket": c["ticket"],
                "contract": c["contract"], "accountBinding": c["accountBinding"],
                "createdAt": c["createdAt"], "activeExitPlan": c.get("activeExitPlan", c["ticket"]["exitPlan"]),
                "summary": summarize(c), "automation": c.get("automation", "Paused"),
                "executions": [{k: v for k, v in e.items() if k not in {"account", "clientId"}} for e in c["executions"]],
                "slots": [{"id": s["id"], "entryStatus": s["entry"]["status"],
                           "stopStatus": s["stop"]["status"], "confirmedStop": s["stop"].get("confirmed", {}).get("auxPrice"),
                           "exitStatus": s.get("exit", {}).get("status"), "leg": s.get("leg"),
                           "open": s.get("open", 0), "whyHeld": s["stop"].get("whyHeld", ""),
                           "exitPrice": s.get("exit", {}).get("confirmed", {}).get("lmtPrice"),
                           "protectionAttempts": s.get("protectionAttempts", 0)} for s in c["slots"]],
                "draft": c.get("draft"), "amendments": c.get("amendments", [])}

    def _connected(self):
        if not self.client or not self.client.isConnected(): raise PaperSafetyError("Connect and verify TWS paper first.")
        account = verify_connected_account(self.client.config, self.client.verification, self.client._managed_accounts)
        if account != self.client.authorized_account: raise PaperSafetyError("Paper account changed.")
        return account

    def connect(self):
        with self.lock:
            if self.client and self.client.isConnected(): return self.status()
            self.armed = None
            self.reviewed_campaigns.clear()
            self.authorized_batches.clear()
            self.client = self.factory()
            try:
                self.client.connect_verified()
                self.connection_id = str(uuid.uuid4())
                self.reconcile()
            except Exception:
                self.client.disconnect()
                self.client = None
                raise
            self.error = None
            if self.thread is None or not self.thread.is_alive():
                self.stop_event.clear()
                self.thread = threading.Thread(target=self._worker, daemon=True, name="brontide-paper")
                self.thread.start()
            return self.status()

    def disconnect(self):
        with self.lock:
            self.armed = None
            if self.client: self.client.disconnect()
            self.last_reconciled = None
            for c in self.store.all("campaign"):
                if c["state"] in {"Closed", "Cancelled"}: continue
                c["automation"] = "Offline — broker-held stops remain at TWS"
                self._save(c)
            return self.status()

    def _save(self, c, db=None):
        if db is None:
            with self.store.transaction() as tx: self._save(c, tx)
            return
        old = self.store.get(db, "campaign", c["id"])
        if {k: v for k, v in old.items() if k != "revision"} == {k: v for k, v in c.items() if k != "revision"}:
            c["revision"] = old["revision"]
            return
        c["revision"] = old["revision"] + 1
        self.store.put(db, "campaign", c["id"], c)

    def _instrument(self, symbol):
        self._connected()
        self.last_quote = IbkrReadOnlyService._instrument_view(self.client.read_only_instrument_snapshot(symbol))
        return self.last_quote

    def approve(self, batch_id, digest, command_id):
        with self.lock:
            batch = self._batch(batch_id)
            self._connected()
            if not self.operator_id or self.operator_deadline <= utcnow():
                raise PaperSafetyError("Sign in again before approving this exact order.")
            if batch["digest"] != digest or batch["sourceIdentity"] != self.source() or utcnow() >= parsed(batch["validUntil"]):
                raise PaperSafetyError("The order review is stale; prepare a new review.")
            if batch.get("connectionId") != self.connection_id or batch["accountBinding"] != self.client.config.binding():
                raise PaperSafetyError("Connection changed after order review.")
            receipt = {"batchId": batch_id, "ticketDigest": digest, "sourceIdentity": batch["sourceIdentity"],
                       "accountBinding": batch["accountBinding"], "connectionId": self.connection_id,
                       "userId": self.operator_id, "approvedAt": stamp(), "approvedAmendmentDigests": []}
            with self.store.transaction() as db:
                if self.store.command(db, command_id, batch_id, {"action": "approve", "digest": digest}):
                    self.store.put(db, "approval", batch_id, receipt)
            return self.arm(batch_id)

    def review_action(self, campaign_id, revision, command_id, action, payload=None):
        with self.lock:
            with self.store.transaction() as db:
                prior = db.execute("SELECT request, campaign FROM commands WHERE id=?", (command_id,)).fetchone()
            if prior:
                return self.action(campaign_id, revision, command_id, action, payload)
            self._connected()
            self.reconcile()
            with self.store.transaction() as db: c = self.store.get(db, "campaign", campaign_id)
            if c["revision"] != revision: raise PaperSafetyError("Position changed. Review the current revision.")
            if c["state"] == "Needs reconciliation": raise PaperSafetyError("Resolve reconciliation before a broker action.")
            batch = self._batch(c["batchId"])
            if self.source() != batch["sourceIdentity"]: raise PaperSafetyError("The reviewed execution source changed; operator reconciliation is required.")
            if not self.client.config.submissions_enabled: raise PaperSafetyError("Server paper submissions are locked.")
            if not self.operator_id or self.operator_deadline <= utcnow(): raise PaperSafetyError("Sign in to review the position.")
            if action == "apply-amendment":
                if not c.get("draft") or payload != {"digest": c["draft"]["digest"]}: raise PaperSafetyError("Review the exact saved amendment.")
                with self.store.transaction() as db:
                    self.store.put(db, "amendment-approval", c["draft"]["digest"], {"userId": self.operator_id, "connectionId": self.connection_id})
            self.armed = c["batchId"]
            self.authorized_batches.add(c["batchId"])
            self.management_only = True
            try:
                result = self.action(campaign_id, revision, command_id, action, payload)
                if action in {"resume", "apply-amendment", "cleanup"}:
                    self.reviewed_campaigns.add(campaign_id)
                return result
            except Exception:
                self.disarm()
                raise

    def quote(self, symbol):
        with self.lock: return self._instrument(symbol)

    def _validate_ticket(self, ticket):
        account = self._connected()
        ticket = deepcopy(ticket)
        if self.operator_id and ticket.get("planningSource") not in {"Manual", "Local EOD close"}:
            raise PaperSafetyError("Simulation and legacy pricing cannot enter paper execution; capture a new plan.")
        if self.operator_id and any(not isinstance(ticket.get(k), str) or not ticket[k].strip() or len(ticket[k]) > 128 for k in ("planId", "planRevision")):
            raise PaperSafetyError("Save the planner revision before reviewing an order.")
        ticket["symbol"] = str(ticket.get("symbol", "")).strip().upper()
        if ticket["symbol"] in {"PL", "AMD"}: raise PaperSafetyError("PL and AMD are excluded from paper QC.")
        if ticket.get("direction") != "Long": raise PaperSafetyError("Short entry remains blocked: both fill bounds cannot be enforced.")
        quantity = ticket.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 3:
            raise PaperSafetyError("Paper QC permits one to three whole shares per campaign.")
        if ticket.get("duration", "DAY") != "DAY": raise PaperSafetyError("This bounded acceptance batch uses DAY entries only.")
        ticket["exitPlan"] = validate_exit_plan(ticket.get("exitPlan"))
        if any(leg["quantity"] < 1 for leg in allocations(quantity, ticket["exitPlan"])):
            raise PaperSafetyError("Each active exit leg needs at least one share; simplify the exit plan.")
        floor = positive(ticket.get("cleanupFloor"), "Fixed cleanup floor")
        if floor > positive(ticket.get("stopPrice"), "Initial stop"):
            raise PaperSafetyError("Cleanup floor must not exceed the initial protective stop.")
        current = self.client.read_only_snapshot()
        excluded = {str(x.get("symbol", "")).upper() for x in [*current.position_rows, *current.open_order_rows]
                    if x.get("quantity", 0) != 0}
        instrument = self._instrument(ticket["symbol"])
        if instrument["contract"]["currency"] != "USD": raise PaperSafetyError("This paper batch requires USD stocks.")
        if "OCA" not in instrument["contract"]["orderTypes"]:
            raise PaperSafetyError("The contract must advertise OCA for protected exits.")
        phase = broker_session_phase(instrument, utcnow())
        mode = ticket.get("sessionMode", "Regular")
        if phase["phase"] not in ({"RTH"} if mode == "Regular" else {"Premarket", "RTH", "Postmarket"}):
            raise PaperSafetyError("The selected broker session is not currently open.")
        if ticket["stopPrice"] >= positive(instrument["quote"].get("bid"), "Fresh bid"):
            raise PaperSafetyError("The initial stop must be below the fresh executable bid.")
        capture = CaptureIntent()
        identifiers = {key: "preparation" for key in ("intentId", "idempotencyKey", "planId", "campaignId")}
        prepare_paper_intent({**ticket, **identifiers}, account_id=account, account_binding=self.client.config.binding(),
                             instrument=instrument, existing_symbols=excluded, store=capture)
        if quantity * ticket["hardCap"] > 500 or quantity * (ticket["hardCap"] - ticket["stopPrice"]) > 10:
            raise PaperSafetyError("Ticket exceeds paper notional or planned-stop-risk limits.")
        if abs(floor / instrument["contract"]["minimumTick"] - round(floor / instrument["contract"]["minimumTick"])) > 1e-7:
            raise PaperSafetyError("Cleanup floor is not tick-valid.")
        return ticket, capture.record["package"], instrument, phase

    def prepare_batch(self, tickets):
        with self.lock:
            if not isinstance(tickets, list) or not 1 <= len(tickets) <= 2: raise PaperSafetyError("A batch needs one or two tickets.")
            identity = self.source()
            validated = [self._validate_ticket(t) for t in tickets]
            frozen = [v[0] for v in validated]
            if len({t["symbol"] for t in frozen}) != len(frozen): raise PaperSafetyError("Batch symbols must be distinct.")
            if sum(t["quantity"] * t["hardCap"] for t in frozen) > 500 or sum(t["quantity"] * (t["hardCap"] - t["stopPrice"]) for t in frozen) > 20:
                raise PaperSafetyError("Combined paper limits exceeded.")
            batch = {"id": str(uuid.uuid4()), "sourceIdentity": identity, "connectionId": self.connection_id,
                     "accountBinding": self.client.config.binding(), "createdAt": stamp(),
                     "validUntil": min(v[3]["windowEnd"] for v in validated), "tickets": frozen,
                     "contracts": [v[1]["contract"] for v in validated]}
            batch["digest"] = sha256(canonical(batch).encode()).hexdigest()
            with self.store.transaction() as db: self.store.put(db, "batch", batch["id"], batch)
            return self.public_batch(batch)

    def _batch(self, batch_id):
        with self.store.transaction() as db: return self.store.get(db, "batch", batch_id)

    def arm(self, batch_id):
        with self.lock:
            batch = self._batch(batch_id)
            self._connected()
            if not self.client.config.submissions_enabled: raise PaperSafetyError("Server paper submissions are disabled.")
            if self.operator_id:
                with self.store.transaction() as db: receipt = self.store.get(db, "approval", batch_id)
                if receipt.get("userId") != self.operator_id: raise PaperSafetyError("Approval belongs to another user.")
            else:
                path = os.environ.get("BRONTIDE_PAPER_APPROVAL_FILE")
                if not path: raise PaperSafetyError("An exact-ticket approval receipt is required; preparing a batch does not approve it.")
                try: receipt = json.loads(Path(path).read_text(encoding="utf-8"))
                except (OSError, ValueError) as exc: raise PaperSafetyError("Paper approval receipt is unavailable.") from exc
            expected = {"batchId": batch_id, "ticketDigest": batch["digest"], "sourceIdentity": self.source(),
                        "accountBinding": self.client.config.binding(), "connectionId": self.connection_id}
            if any(receipt.get(k) != v for k, v in expected.items()) or batch["sourceIdentity"] != expected["sourceIdentity"]:
                raise PaperSafetyError("Approval does not match this exact batch, source, account and connection.")
            if not parsed(batch["createdAt"]) <= parsed(receipt["approvedAt"]) <= utcnow() < parsed(batch["validUntil"]):
                raise PaperSafetyError("Batch approval is expired or has an invalid timestamp.")
            self.reconcile()
            if any(c["state"] == "Needs reconciliation" for c in self.store.all("campaign")):
                raise PaperSafetyError("Resolve outstanding campaign reconciliation before arming.")
            self.armed = batch_id
            self.authorized_batches.add(batch_id)
            self.management_only = False
            self.error = None
            return self.status()

    def disarm(self):
        with self.lock:
            self.armed = None
            self.reviewed_campaigns.clear()
            self.authorized_batches.clear()
            if self.operator_id: self.connection_id = str(uuid.uuid4())
            for c in self.store.all("campaign"):
                if c["state"] not in {"Closed", "Cancelled"}:
                    c["automation"] = "Paused — submissions locked"
                    self._save(c)
            return self.status()

    def _authority(self, batch, entry=False):
        self._connected()
        if self.operator_id and (not self.operator_deadline or utcnow() >= self.operator_deadline):
            self.disarm()
            raise PaperSafetyError("Brontide sign-in lease expired; review before resuming.")
        if entry and self.management_only: raise PaperSafetyError("Position review cannot approve a new entry.")
        if (batch["id"] not in self.authorized_batches if self.operator_id else self.armed != batch["id"]) or batch["accountBinding"] != self.client.config.binding():
            raise PaperSafetyError("This exact paper batch is not armed for this connection.")
        if not self.client.config.submissions_enabled or self.source() != batch["sourceIdentity"]:
            self.armed = None
            raise PaperSafetyError("Submission lock or reviewed source changed.")
        if entry and utcnow() >= parsed(batch["validUntil"]): raise PaperSafetyError("The entry approval window has expired.")

    def submit(self, batch_id, ticket_index, command_id):
        with self.lock:
            batch = self._batch(batch_id)
            self._authority(batch, entry=True)
            if not isinstance(ticket_index, int) or not 0 <= ticket_index < len(batch["tickets"]): raise PaperSafetyError("Invalid ticket index.")
            campaign_id = f"{batch_id}:{ticket_index}"
            with self.store.transaction() as db:
                existing = db.execute("SELECT body FROM objects WHERE kind='campaign' AND id=?", (campaign_id,)).fetchone()
                if existing:
                    c = json.loads(existing[0])
                    if c["submissionCommand"] != command_id: raise PaperSafetyError("This ticket already has an economic action.")
                    return self.public_campaign(c)
            self.reconcile()
            active = [c for c in self.store.all("campaign") if c["state"] not in {"Closed", "Cancelled"}]
            if len(active) >= 2 or any(c["state"] in {"Needs reconciliation", "Unprotected"} for c in active):
                raise PaperSafetyError("Existing paper campaigns block a new entry.")
            ticket, package, instrument, _ = self._validate_ticket(batch["tickets"][ticket_index])
            if package["contract"] != batch["contracts"][ticket_index]: raise PaperSafetyError("Qualified contract changed after review.")
            if sum(c["ticket"]["quantity"] * c["ticket"]["hardCap"] for c in active) + ticket["quantity"] * ticket["hardCap"] > 500:
                raise PaperSafetyError("Simultaneous paper notional exceeded.")
            if sum(c["ticket"]["quantity"] * (c["ticket"]["hardCap"] - c["ticket"]["stopPrice"]) for c in active) + ticket["quantity"] * (ticket["hardCap"] - ticket["stopPrice"]) > 20:
                raise PaperSafetyError("Simultaneous planned risk exceeded.")
            slots = []
            for i in range(ticket["quantity"]):
                parent, child = self.client.reserve(2)
                group = f"B-{uuid.uuid4().hex[:20]}"
                ref = f"B-{uuid.uuid4().hex[:20]}"
                entry = {**package["entry"], "totalQuantity": 1, "orderRef": ref}
                stop = {**package["protection"], "totalQuantity": 1, "orderRef": ref + "-S",
                        "parentId": parent, "ocaGroup": group, "ocaType": 1}
                slots.append({"id": str(i), "group": group, "entry": {"orderId": parent, "fields": entry, "status": "Unknown"},
                              "stop": {"orderId": child, "fields": stop, "status": "Unknown"}})
            c = {"id": campaign_id, "batchId": batch_id, "submissionCommand": command_id, "ticket": ticket,
                 "contract": package["contract"], "tick": instrument["contract"]["minimumTick"], "revision": 1,
                 "state": "Pending entry", "message": None, "slots": slots, "executions": [],
                 "createdAt": stamp(), "accountBinding": batch["accountBinding"], "automation": "Waiting for confirmed fills"}
            request = {"action": "submit", "batchId": batch_id, "ticketIndex": ticket_index}
            with self.store.transaction() as db:
                self.store.command(db, command_id, campaign_id, request)
                self.store.put(db, "campaign", campaign_id, c)
            # Each command is durable before its first socket write. Unknown writes are never retried blindly.
            try:
                for slot in slots:
                    self._write(c, slot["entry"], "entry", command_id + ":" + slot["id"] + ":E")
                    self._write(c, slot["stop"], "protection", command_id + ":" + slot["id"] + ":S")
            except Exception:
                c["state"] = "Needs reconciliation"
                c["message"] = "Bracket transmission outcome unknown; reconcile before any further entry."
                self._save(c)
                raise
            self.reviewed_campaigns.add(campaign_id)
            return self.public_campaign(c)

    def _write(self, c, order, role, command_id, cancel=False):
        self._authority(self._batch(c["batchId"]), entry=role in {"entry", "protection"} and not cancel)
        if order["fields"]["account"] != self.client.authorized_account: raise PaperSafetyError("Order account mismatch.")
        if cancel or role not in {"entry", "protection"}:
            snapshot = self.client.read_only_snapshot()
            quantity = sum(p["quantity"] for p in snapshot.position_rows if p["conId"] == c["contract"]["conId"])
            if quantity != summarize(c)["openQuantity"]:
                raise PaperSafetyError("Fresh broker quantity changed; reconcile before another order operation.")
            owned = {o["fields"]["orderRef"] for s in c["slots"] for key in ("entry", "stop", "exit") if (o := s.get(key))}
            if any(o["conId"] == c["contract"]["conId"] and o.get("orderRef") not in owned for o in snapshot.open_order_rows):
                raise PaperSafetyError("An unrelated working order appeared on the campaign instrument.")
        request = {"role": role, "orderId": order["orderId"], "fields": order["fields"], "cancel": cancel}
        with self.store.transaction() as db:
            if not self.store.command(db, command_id, c["id"], request): return
            order["pendingCommand"] = command_id
            order["pendingCancel"] = cancel
            self._save(c, db)
        if cancel: self.client.cancel_owned(order["orderId"])
        else: self.client.write(order["orderId"], c["contract"], order["fields"])

    def _find_order(self, campaigns, order_id):
        for c in campaigns:
            for slot in c["slots"]:
                for role in ("entry", "stop", "exit"):
                    if role in slot and slot[role]["orderId"] == order_id: return c, slot, role, slot[role]
                for retired in slot.get("retired", []):
                    if retired["order"]["orderId"] == order_id: return c, slot, retired["role"], retired["order"]
        return None

    def _events(self):
        self.pending_events.extend(self.client.drain())
        events = self.pending_events
        if not events: return
        with self.store.transaction() as db:
            campaigns = [json.loads(r[0]) for r in db.execute("SELECT body FROM objects WHERE kind='campaign'")]
            for e in events:
                found = self._find_order(campaigns, e.get("orderId"))
                if e["kind"] == "commission":
                    # Fees can precede execution replay; retain them without inventing fills.
                    if math.isfinite(e["commission"]) and abs(e["commission"]) < 1_000_000:
                        self.store.put(db, "fee", e["executionId"], e)
                        self.store.event(db, "callback:" + e.setdefault("eventId", str(uuid.uuid4())), e)
                    continue
                if not found: continue  # Never bind or amend an unrelated order.
                self.store.event(db, "callback:" + e.setdefault("eventId", str(uuid.uuid4())), e)
                c, slot, role, order = found
                if e.get("clientId", self.client.config.client_id) != self.client.config.client_id: continue
                if e["kind"] == "execution":
                    if e["account"] != self.client.authorized_account or e["conId"] != c["contract"]["conId"] or e["orderRef"] != order["fields"]["orderRef"]:
                        c["state"] = "Needs reconciliation"; c["message"] = "Execution identity mismatch."; continue
                    quantity, price = e["quantity"], e["price"]
                    if quantity != 1 or not math.isfinite(price) or price <= 0 or e["side"] != ("BOT" if order["fields"]["action"] == "BUY" else "SLD"):
                        c["state"] = "Needs reconciliation"; c["message"] = "Unexpected execution quantity, price or side."; continue
                    economic = {k: v for k, v in e.items() if k not in {"eventId", "observedAt"}}
                    if not self.store.event(db, "exec:" + e["executionId"], economic): continue
                    c["executions"].append({"executionId": e["executionId"], "orderId": order["orderId"],
                        "slotId": slot["id"], "effect": "entry" if role == "entry" else "exit", "role": order.get("role", role),
                        "quantity": 1, "price": price, "occurredAt": execution_time(e["executedAt"]), "commission": None})
                    order["status"] = "Filled"
                    order["filled"] = 1
                elif e["kind"] == "open-order":
                    fields = e["fields"]
                    if fields.get("account") != self.client.authorized_account or fields.get("clientId") != self.client.config.client_id or fields.get("orderRef") != order["fields"]["orderRef"] or e["conId"] != c["contract"]["conId"]:
                        c["state"] = "Needs reconciliation"; c["message"] = "Broker order identity mismatch."; continue
                    if fields.get("totalQuantity") != 1 or fields.get("action") != order["fields"]["action"] or (role != "entry" and (fields.get("ocaGroup") != slot["group"] or fields.get("ocaType") != 1)):
                        c["state"] = "Needs reconciliation"; c["message"] = "Changed in IBKR: quantity or protection relationship differs."; continue
                    old = order.get("confirmed")
                    invariant_fields = {"action", "orderType", "outsideRth", "tif", "parentId", "ocaGroup", "ocaType"}
                    if any(fields.get(k) != order["fields"].get(k) for k in invariant_fields if k in order["fields"]):
                        c["state"] = "Needs reconciliation"; c["message"] = "Changed in IBKR: order type, session or parent relationship differs."; continue
                    if role == "stop" and old and fields.get("auxPrice") != old.get("auxPrice") and not order.get("pendingCommand"):
                        if fields["auxPrice"] < old["auxPrice"]:
                            c["state"] = "Needs reconciliation"; c["message"] = "Changed in IBKR: stop was loosened."
                        else: c["message"] = "Changed in IBKR: tighter stop retained."
                    order["confirmed"] = fields
                    if order.get("status") not in TERMINAL: order["status"] = e["status"]
                elif e["kind"] == "order-status":
                    if order.get("status") not in TERMINAL or e["status"] == "Filled": order["status"] = e["status"]
                    order["filled"] = max(order.get("filled", 0), e["filled"])
                    order["whyHeld"] = e.get("whyHeld", "")
                elif e["kind"] == "broker-error":
                    if e["code"] == 201: order["status"] = "Inactive"
                    elif e["code"] not in {202, 2104, 2106, 2158}:
                        c["state"] = "Needs reconciliation"; c["message"] = f"Broker code {e['code']}; action outcome requires reconciliation."
                pending = order.get("pendingCommand")
                confirmed = order.get("confirmed", {})
                matches = all(confirmed.get(k) == v for k, v in order["fields"].items()
                              if k in {"auxPrice", "lmtPrice", "totalQuantity", "outsideRth", "tif", "parentId", "ocaGroup", "ocaType"})
                if pending and ((order.get("pendingCancel") and order["status"] in TERMINAL) or (not order.get("pendingCancel") and (matches or order["status"] in TERMINAL))):
                    db.execute("UPDATE commands SET state='confirmed' WHERE id=?", (pending,))
                    order.pop("pendingCommand", None)
                    order.pop("pendingCancel", None)
            for c in campaigns:
                for execution in c["executions"]:
                    row = db.execute("SELECT body FROM objects WHERE kind='fee' AND id=?", (execution["executionId"],)).fetchone()
                    if row:
                        fee = json.loads(row[0])
                        if fee["currency"] == c["contract"]["currency"]: execution["commission"] = fee["commission"]
                self._derive(c)
                self._save(c, db)
        # Clear only after commit. A failed transaction must retain status/error callbacks
        # as well as executions, which may otherwise be absent from the next snapshot.
        self.pending_events = []

    def _derive(self, c):
        if c["state"] == "Needs reconciliation": return
        total = summarize(c)
        if total["openQuantity"] < 0 or total["entered"] > c["ticket"]["quantity"]:
            c["state"] = "Needs reconciliation"; c["message"] = "Broker execution quantity conflict."; return
        for slot in c["slots"]:
            entered = [e for e in c["executions"] if e["slotId"] == slot["id"] and e["effect"] == "entry"]
            exited = [e for e in c["executions"] if e["slotId"] == slot["id"] and e["effect"] == "exit"]
            slot["open"] = len(entered) - len(exited)
            if len(entered) > 1 or len(exited) > 1 or slot["open"] < 0:
                c["state"] = "Needs reconciliation"; c["message"] = "One-share tranche was filled more than once."; return
        if any(s["entry"].get("filled", 0) > len([e for e in c["executions"] if e["slotId"] == s["id"] and e["effect"] == "entry"]) for s in c["slots"]):
            c["state"] = "Sync pending"; return
        final = all(s["entry"]["status"] in TERMINAL for s in c["slots"])
        c["entryFinal"] = final
        if final and total["entered"] and not c.get("executionRisk"):
            risk = total["averageEntry"] - c["ticket"]["stopPrice"]
            if risk <= 0:
                c["state"] = "Needs reconciliation"; c["message"] = "Filled entry is inconsistent with the initial stop."; return
            c["executionRisk"] = risk
            allocated = allocations(total["entered"], c["ticket"]["exitPlan"])
            c["allocationPending"] = any(leg["quantity"] < 1 for leg in allocated)
            legs = [] if c["allocationPending"] else [leg for leg in allocated for _ in range(leg["quantity"])]
            if c["allocationPending"]:
                c["automation"] = "Exit allocation needs an amendment for the actual filled quantity; broker stops retained"
            filled_slots = [s for s in c["slots"] if any(e["slotId"] == s["id"] and e["effect"] == "entry" for e in c["executions"])]
            for slot, leg in zip(filled_slots, legs): slot["leg"] = leg
        if final and total["entered"] == total["exited"]:
            cleared = all(o["status"] in TERMINAL for s in c["slots"] for role in ("entry", "stop", "exit") if (o := s.get(role)))
            c["state"] = ("Closed" if total["entered"] else "Cancelled") if cleared else "Closing"
        elif any(s.get("open") and (s["stop"]["status"] not in WORKING or not s["stop"].get("confirmed") or s["stop"].get("whyHeld")) for s in c["slots"]): c["state"] = "Unprotected"
        elif total["entered"]: c["state"] = "Open" if final else "Partially filled"
        else: c["state"] = "Pending entry"

    def reconcile(self):
        with self.lock:
            self._connected()
            self.snapshot = self.client.read_only_snapshot()
            if hasattr(self.snapshot, "observed_at"):
                view_builder = IbkrReadOnlyService()
                view_builder._last_success = self.broker_view
                self.broker_view = view_builder._build_success(self.client.authorized_account, self.snapshot)
            self.client.execution_snapshot()
            self._events()
            positions = {p["conId"]: p["quantity"] for p in self.snapshot.position_rows}
            open_ids = {o["orderId"] for o in self.snapshot.open_order_rows if o.get("clientId") == self.client.config.client_id}
            for c in self.store.all("campaign"):
                if c["accountBinding"] != self.client.config.binding():
                    c["state"] = "Needs reconciliation"; c["message"] = "Stored campaign belongs to another connection configuration."
                elif c["state"] not in {"Closed", "Cancelled"} and positions.get(c["contract"]["conId"], 0) != summarize(c)["openQuantity"]:
                    c["state"] = "Needs reconciliation"; c["message"] = "Changed in IBKR: position differs from recorded executions. No closure was inferred."
                else:
                    missing = [o for s in c["slots"] for role in ("entry", "stop", "exit") if (o := s.get(role)) and o["status"] not in TERMINAL and o["orderId"] not in open_ids]
                    if missing:
                        c["state"] = "Needs reconciliation"; c["message"] = "Order absent from open snapshot without terminal evidence; no retry is allowed."
                    elif c["state"] == "Needs reconciliation" and c.get("message", "").startswith(("Bracket transmission", "Order absent", "Changed in IBKR: position differs", "Broker execution quantity conflict")):
                        c["state"] = "Sync pending"
                        self._derive(c)
                self._save(c)
            self.last_reconciled = stamp()
            return self.status()

    def action(self, campaign_id, revision, command_id, action, payload=None):
        with self.lock:
            with self.store.transaction() as db:
                c = self.store.get(db, "campaign", campaign_id)
                prior = db.execute("SELECT request, campaign FROM commands WHERE id=?", (command_id,)).fetchone()
                request = {"action": action, "revision": revision, "payload": payload}
                if prior:
                    if prior[0] != canonical(request) or prior[1] != campaign_id: raise PaperSafetyError("Command key was reused for a different action.")
                    return self.public_campaign(c)
                if c["revision"] != revision: raise PaperSafetyError("Campaign changed; refresh before applying the action.")
            if action == "save-amendment":
                plan = validate_exit_plan(payload)
                if any(leg["quantity"] < 1 for leg in allocations(summarize(c)["openQuantity"], plan)):
                    raise PaperSafetyError("Each amended exit leg needs at least one confirmed open share.")
                c["draft"] = {"exitPlan": plan, "basedOn": c["revision"], "quantity": summarize(c)["openQuantity"]}
                c["draft"]["digest"] = sha256(canonical({"campaignId": c["id"], **c["draft"]}).encode()).hexdigest()
                with self.store.transaction() as db:
                    self.store.command(db, command_id, campaign_id, request)
                    self._save(c, db)
                return self.public_campaign(c)
            self._authority(self._batch(c["batchId"]))
            if c["state"] == "Needs reconciliation": raise PaperSafetyError("Reconcile the campaign before a broker action.")
            # Flush actual callbacks before checking the optimistic revision again.
            self._events()
            with self.store.transaction() as db:
                fresh = self.store.get(db, "campaign", campaign_id)
                if fresh["revision"] != revision: raise PaperSafetyError("Broker state changed; review the current revision.")
                self.store.command(db, command_id, campaign_id, request)
            if action == "cancel-entry":
                for s in c["slots"]:
                    if s["entry"]["status"] not in TERMINAL and not s["entry"].get("pendingCommand"):
                        self._write(c, s["entry"], "entry", command_id + ":" + s["id"], cancel=True)
            elif action == "cleanup":
                if not c.get("entryFinal"): raise PaperSafetyError("Cancel and reconcile the entry remainder before cleanup.")
                c["cleanup"] = True
                c["automation"] = "Bounded cleanup requested"
                self._save(c)
            elif action == "apply-amendment":
                draft = c.get("draft")
                if not draft or draft["quantity"] != summarize(c)["openQuantity"] or c["revision"] != draft["basedOn"] + 1:
                    raise PaperSafetyError("The saved amendment is stale; save a new draft against current state.")
                if self.operator_id:
                    with self.store.transaction() as db: receipt = self.store.get(db, "amendment-approval", draft["digest"])
                    approved = receipt.get("userId") == self.operator_id and receipt.get("connectionId") == self.connection_id
                else:
                    approval_path = os.environ.get("BRONTIDE_PAPER_APPROVAL_FILE")
                    receipt = json.loads(Path(approval_path).read_text()) if approval_path else {}
                    approved = draft["digest"] in receipt.get("approvedAmendmentDigests", [])
                if not approved: raise PaperSafetyError("This exact saved amendment needs approval before application.")
                if any(s.get("exit") and s["exit"]["status"] not in TERMINAL for s in c["slots"]):
                    raise PaperSafetyError("Cancel and reconcile working target/cleanup orders before reallocating exits.")
                c["activeExitPlan"] = draft["exitPlan"]
                c["allocationPending"] = False
                legs = [leg for leg in allocations(draft["quantity"], draft["exitPlan"]) for _ in range(leg["quantity"])]
                for slot, leg in zip([s for s in c["slots"] if s.get("open")], legs): slot["leg"] = leg
                c.setdefault("amendments", []).append({"at": stamp(), "state": "Applied to automation; stop changes await broker confirmation", "exitPlan": draft["exitPlan"]})
                c["draft"] = None
                self._save(c)
            elif action == "cancel-exits":
                for s in c["slots"]:
                    if s.get("exit") and s["exit"]["status"] not in TERMINAL and not s["exit"].get("pendingCommand"):
                        self._write(c, s["exit"], "exit", command_id + ":" + s["id"], cancel=True)
                c["automation"] = "Paused"
                c["paused"] = True
                self._save(c)
            elif action == "resume":
                c["paused"] = False
                self._save(c)
            else: raise PaperSafetyError("Unsupported campaign action.")
            return self.public_campaign(c)

    def _automate(self, c):
        if self.operator_id and c["id"] not in self.reviewed_campaigns: return
        if c["state"] in {"Needs reconciliation", "Closed", "Cancelled", "Closing", "Sync pending"}: return
        self._authority(self._batch(c["batchId"]))
        instrument = self._instrument(c["ticket"]["symbol"])
        if not instrument["executable"] or instrument["quote"].get("marketDataType") != 1 or not utcnow() - timedelta(seconds=15) <= parsed(instrument["observedAt"]) <= utcnow():
            raise PaperSafetyError("Automation paused: executable quote unavailable.")
        if instrument["contract"]["conId"] != c["contract"]["conId"] or instrument["contract"]["currency"] != c["contract"]["currency"]:
            raise PaperSafetyError("Automation paused: qualified contract changed.")
        if positive(instrument["quote"].get("bid"), "Bid") > positive(instrument["quote"].get("ask"), "Ask"):
            raise PaperSafetyError("Automation paused: crossed quote.")
        phase = broker_session_phase(instrument, utcnow())["phase"]
        if phase not in ({"RTH"} if c["ticket"].get("sessionMode", "Regular") == "Regular" else {"Premarket", "RTH", "Postmarket"}):
            c["automation"] = "Outside eligible session"; self._save(c); return
        bid = instrument["quote"]["bid"]
        references = None
        if any(s.get("leg", {}).get("trailing", {}).get("mode") in {"SMA", "Day extreme"} for s in c["slots"]):
            cached = self.daily_cache.get(c["contract"]["conId"])
            if cached is None or time.monotonic() - cached[0] > 60:
                try:
                    references = self.client.daily_references(c["contract"])
                    self.daily_cache[c["contract"]["conId"]] = (time.monotonic(), references)
                except PaperSafetyError: references = None
            else: references = cached[1]
        for slot in c["slots"]:
            if not slot.get("open"): continue
            stop = slot["stop"]
            if stop.get("pendingCommand"): continue
            if stop["status"] == "Inactive" and slot.get("protectionAttempts", 0) < 1:
                if stop["fields"]["auxPrice"] >= bid: continue
                slot["protectionAttempts"] = 1
                slot.setdefault("retired", []).append({"role": "stop", "order": deepcopy(stop)})
                stop = {"orderId": self.client.reserve(1)[0], "fields": {**stop["fields"], "parentId": 0,
                        "orderRef": "B-" + uuid.uuid4().hex[:20]}, "status": "Unknown"}
                slot["stop"] = stop
                self._write(c, stop, "protection-retry", str(uuid.uuid4()))
                continue
            if stop["status"] not in WORKING or not stop.get("confirmed") or stop.get("whyHeld"):
                c["automation"] = "Unprotected — operator reconciliation required"; continue
            if not c.get("entryFinal"): continue
            current = stop["confirmed"]["auxPrice"]
            if c.get("cleanup"):
                self._cleanup_slot(c, slot, bid)
                continue
            if c.get("paused"): continue
            if c.get("allocationPending") or "leg" not in slot: continue
            avg = summarize(c)["averageEntry"]
            slot["favorable"] = max(slot.get("favorable", bid), bid)
            leg = slot["leg"]
            if leg["role"] == "Runner" and (bid - avg) / c["executionRisk"] >= leg["activationR"]:
                slot["runnerActive"] = True
            proposed = next_stop("Long", avg, c["executionRisk"], current, bid, slot["favorable"], leg,
                                 c.get("activeExitPlan", c["ticket"]["exitPlan"])["breakeven"], c["tick"], references, slot.get("runnerActive", False))
            if proposed:
                stop["fields"]["auxPrice"] = proposed
                if stop["fields"]["orderType"] == "STP LMT":
                    distance = c["ticket"]["stopPrice"] - c["ticket"]["protectionLimitPrice"]
                    stop["fields"]["lmtPrice"] = round(proposed - distance, 8)
                self._write(c, stop, "tighten-stop", str(uuid.uuid4()))
            if leg["role"] == "Target" and "exit" not in slot:
                target = leg["target"]
                price = target["price"] if target["mode"] == "Price" else avg + c["executionRisk"] * target["multipleR"]
                price = math.ceil((price - 1e-9) / c["tick"]) * c["tick"]
                if bid > current: self._exit(c, slot, max(price, current), "target")
            c["automation"] = "Active" if references is not None or leg["role"] != "Runner" or leg["trailing"]["mode"] not in {"SMA", "Day extreme"} else "Daily reference unavailable — trailing rule paused; broker stop retained"
        self._save(c)

    def _exit(self, c, slot, price, role):
        fields = {"account": self.client.authorized_account, "action": "SELL", "totalQuantity": 1,
                  "orderType": "LMT", "tif": "DAY", "lmtPrice": round(price, 8),
                  "outsideRth": c["ticket"].get("sessionMode") == "RegularExtended", "transmit": True,
                  "ocaGroup": slot["group"], "ocaType": 1, "orderRef": "B-" + uuid.uuid4().hex[:20]}
        if slot.get("exit"): slot.setdefault("retired", []).append({"role": "exit", "order": deepcopy(slot["exit"])})
        slot["exit"] = {"orderId": self.client.reserve(1)[0], "fields": fields, "status": "Unknown", "role": role, "createdAt": stamp()}
        self._write(c, slot["exit"], role, str(uuid.uuid4()))

    def _cleanup_slot(self, c, slot, bid):
        order = slot.get("exit")
        if order and order.get("pendingCommand"): return
        if order and order["status"] not in TERMINAL:
            if order["role"] != "cleanup" or (utcnow() - parsed(order["createdAt"])).total_seconds() >= 60:
                self._write(c, order, "cancel-exit", str(uuid.uuid4()), cancel=True)
            return
        if order and order["status"] == "Filled": return  # Await execution, never recreate an economic close.
        if slot.get("cleanupAttempts", 0) >= 2:
            c["automation"] = "Cleanup unresolved — two attempts exhausted; protective stop retained"; return
        floor = max(c["ticket"]["cleanupFloor"], slot["stop"]["confirmed"]["auxPrice"])
        if bid < floor:
            c["automation"] = "Cleanup blocked below its fixed floor; protective stop retained"; return
        slot["cleanupAttempts"] = slot.get("cleanupAttempts", 0) + 1
        price = math.floor((bid + 1e-9) / c["tick"]) * c["tick"]
        if price < floor: return
        self._exit(c, slot, price, "cleanup")

    def _worker(self):
        while not self.stop_event.wait(2):
            with self.lock:
                if self.operator_id and self.operator_deadline and utcnow() >= self.operator_deadline:
                    if self.armed: self.disarm()
                if not self.client or not self.client.isConnected():
                    if self.armed: self.disarm()
                    continue
                try:
                    self._events()
                    if self.last_reconciled is None or (utcnow() - parsed(self.last_reconciled)).total_seconds() > 10:
                        self.reconcile()
                    if self.armed:
                        for c in self.store.all("campaign"):
                            if (c["id"] in self.reviewed_campaigns if self.operator_id else c["batchId"] == self.armed): self._automate(c)
                except Exception as exc:
                    self.error = str(exc) if isinstance(exc, PaperSafetyError) else "Paper service failed; reconcile before resuming."
                    self.disarm()

    def shutdown(self):
        self.stop_event.set()
        with self.lock:
            self.armed = None
            if self.client: self.client.disconnect()
