"""Account-scoped, immutable planner drafts in a prepared local paper ledger.

Saving a draft is not an order review or a broker command. This store never
connects to TWS, archives a submission ticket, or enables execution.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path

from .ibkr_tws import PaperSafetyError
from .local_binding import LocalBindingStore
from .local_paper_reference import LocalPaperReferenceStore
from .local_journal import (LEDGER, RECORDED_DIRECTORY,
                            LocalRecordedJournalSource)
from .local_profile import LocalProfileStore
from .paper_plan import REQUIRED_FIELDS, validate_saved_plan
from .paper_store import PaperStore, canonical


class LocalPlanUnavailable(ValueError):
    """The local draft cannot be safely saved or read in this account scope."""


_HEX = re.compile(r"^[0-9a-f]{64}$", re.ASCII)


def _uuid4(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    return parsed.version == 4 and str(parsed) == value


def _validated_plan(saved: object) -> tuple[dict, str]:
    if not isinstance(saved, dict) or set(saved) - (REQUIRED_FIELDS | {
            "triggerPrice", "protectionLimitPrice"}):
        raise LocalPlanUnavailable("A complete planner revision is required.")
    if (saved.get("schemaVersion") != 2 or "origin" in saved
            or not _uuid4(saved.get("planId"))
            or not _uuid4(saved.get("planRevision"))):
        raise LocalPlanUnavailable("A new, non-sample planner revision is required.")
    source = saved.get("capturedEntrySource")
    if (not isinstance(source, dict)
            or source.get("source") not in {
                "Manual", "Local EOD close", "IBKR TWS snapshot"}):
        raise LocalPlanUnavailable("Sample or unknown pricing cannot be saved for a paper account.")
    snapshot = saved.get("marketSnapshot")
    if isinstance(snapshot, dict) and (
            snapshot.get("status") == "sample"
            or snapshot.get("source") == "Simulated fixture"):
        raise LocalPlanUnavailable("Sample market data cannot be saved for a paper account.")
    ticket = {
        "planId": saved["planId"], "planRevision": saved["planRevision"],
        "symbol": saved.get("symbol"), "direction": saved.get("side"),
        "planningPrice": saved.get("entryPrice"), "stopPrice": saved.get("stopPrice"),
        "method": saved.get("executionMethod"),
        "sessionMode": saved.get("sessionMode"), "duration": saved.get("duration"),
        "protectionOrderType": saved.get("protectionOrderType"),
        "exitPlan": saved.get("exitPlan"), "cleanupFloor": saved.get("stopPrice"),
        "planningSource": source["source"], "quantity": saved.get("executionQuantity"),
        "hardCap": saved.get("hardCap") or saved.get("entryPrice"),
        "savedPlan": saved,
    }
    for key in ("triggerPrice", "protectionLimitPrice"):
        if key in saved:
            ticket[key] = saved[key]
    try:
        validate_saved_plan(ticket)
        serialized = canonical(saved)
    except (PaperSafetyError, ValueError, TypeError, OverflowError) as exc:
        raise LocalPlanUnavailable("The saved planner revision is invalid.") from exc
    if len(serialized.encode("utf-8")) > 65536:
        raise LocalPlanUnavailable("The saved planner revision is too large.")
    return saved, hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class LocalSavedPlanStore:
    """Persist revisions only under a verified local binding and ledger marker."""

    def __init__(self, profile_store: LocalProfileStore,
                 binding_store: LocalBindingStore) -> None:
        if binding_store.profile_store is not profile_store:
            raise ValueError("Plan storage and account choice must share one private profile.")
        self.profile_store = profile_store
        self.binding_store = binding_store

    def _source(self, profile_id: str) -> LocalRecordedJournalSource:
        profile = self.profile_store._read()
        if profile is None or profile.profile_id != profile_id:
            raise LocalPlanUnavailable("Local profile changed; relaunch Brontide.")
        remembered = self.binding_store.load(profile_id)
        if remembered is None:
            raise LocalPlanUnavailable("Confirm a paper account before saving a private plan.")
        try:
            reference = LocalPaperReferenceStore(self.profile_store).load(profile_id)
        except (OSError, ValueError) as exc:
            raise LocalPlanUnavailable("The owner paper reference is unavailable.") from exc
        if not remembered.matches_reference(reference):
            raise LocalPlanUnavailable("The saved paper choice no longer matches its owner reference.")
        source = LocalRecordedJournalSource.from_private_directory(
            ledger_directory=self.profile_store.root / RECORDED_DIRECTORY,
            profile_id=profile_id,
            remembered_account_binding=remembered.account_binding,
        )
        source.read(profile_id)
        return source

    @staticmethod
    def _head_id(source: LocalRecordedJournalSource, plan_id: str) -> str:
        scope = {"profileId": source.profile_id,
                 "accountBinding": source.account_binding,
                 "ledgerBinding": source._ledger_binding,
                 "environment": "paper", "planId": plan_id}
        return hashlib.sha256(canonical(scope).encode("utf-8")).hexdigest()

    @staticmethod
    def _active_id(source: LocalRecordedJournalSource) -> str:
        return source.scope_id()

    @staticmethod
    def _head(row: object) -> dict | None:
        if row is None:
            return None
        try:
            value = json.loads(row["body"])
        except (TypeError, ValueError, KeyError) as exc:
            raise LocalPlanUnavailable("Saved plan state is unavailable.") from exc
        if (not isinstance(value, dict) or set(value) != {"revision", "digest"}
                or not _uuid4(value["revision"])
                or not isinstance(value["digest"], str)
                or not _HEX.fullmatch(value["digest"])):
            raise LocalPlanUnavailable("Saved plan state is invalid.")
        return value

    @staticmethod
    def _revision_id(head_id: str, revision: str) -> str:
        return hashlib.sha256(canonical({
            "head": head_id, "revision": revision}).encode("utf-8")).hexdigest()

    def save(self, profile_id: str, saved_plan: object,
             expected_revision: str | None,
             expected_scope_id: str | None = None,
             expected_active_revision: str | None = None) -> dict[str, object]:
        plan, digest = _validated_plan(saved_plan)
        if expected_revision is not None and not _uuid4(expected_revision):
            raise LocalPlanUnavailable("The expected planner revision is invalid.")
        if expected_active_revision is not None and not _uuid4(expected_active_revision):
            raise LocalPlanUnavailable("The expected active plan revision is invalid.")
        if expected_scope_id is not None and not _HEX.fullmatch(expected_scope_id):
            raise LocalPlanUnavailable("The expected private account scope is invalid.")
        with self.profile_store._exclusive():
            source = self._source(profile_id)
            if expected_scope_id is not None and self._active_id(source) != expected_scope_id:
                raise LocalPlanUnavailable("The private account scope changed; save again.")
            head_id = self._head_id(source, plan["planId"])
            revision_id = self._revision_id(head_id, plan["planRevision"])
            archive = {"profileId": profile_id,
                       "accountBinding": source.account_binding,
                       "ledgerBinding": source._ledger_binding,
                       "environment": "paper", "planId": plan["planId"],
                       "revision": plan["planRevision"], "contentDigest": digest,
                       "savedPlan": plan}
            ledger = PaperStore(Path(source.directory) / LEDGER)
            with ledger.transaction() as db:
                latest = self._read_latest(db, source)
                if latest is None:
                    # A missing active pointer is normal only for a scope with
                    # no saved revisions. An orphan head with no revision has
                    # no recoverable scope, so it blocks new saves as damaged
                    # private history instead of being silently buried.
                    rows = db.execute(
                        "SELECT body FROM objects WHERE kind='local-plan-revision'"
                    ).fetchall()
                    known_head_ids = set()
                    for row in rows:
                        try:
                            archived = json.loads(row["body"])
                        except (TypeError, ValueError, KeyError) as exc:
                            raise LocalPlanUnavailable(
                                "Saved plan history is unavailable; review private history."
                            ) from exc
                        if (not isinstance(archived, dict)
                                or not all(isinstance(archived.get(key), str) for key in (
                                    "profileId", "accountBinding", "ledgerBinding",
                                    "environment", "planId"))):
                            raise LocalPlanUnavailable(
                                "Saved plan history is unavailable; review private history.")
                        known_head_ids.add(hashlib.sha256(canonical({
                            "profileId": archived["profileId"],
                            "accountBinding": archived["accountBinding"],
                            "ledgerBinding": archived["ledgerBinding"],
                            "environment": archived["environment"],
                            "planId": archived["planId"],
                        }).encode("utf-8")).hexdigest())
                        if (archived["profileId"] == profile_id
                                and archived.get("accountBinding") == source.account_binding
                                and archived.get("ledgerBinding") == source._ledger_binding
                                and archived.get("environment") == "paper"):
                            raise LocalPlanUnavailable(
                                "Saved plan active pointer is missing; review private history."
                            )
                    heads = db.execute(
                        "SELECT id FROM objects WHERE kind='local-plan-head'"
                    ).fetchall()
                    if any(row["id"] not in known_head_ids for row in heads):
                        raise LocalPlanUnavailable(
                            "Saved plan history has an orphan head; review private history.")
                head_row = db.execute(
                    "SELECT body FROM objects WHERE kind='local-plan-head' AND id=?",
                    (head_id,),
                ).fetchone()
                head = self._head(head_row)
                if head is not None and head["revision"] == plan["planRevision"]:
                    if head["digest"] != digest:
                        raise LocalPlanUnavailable("A planner revision already has different content.")
                    archive_row = db.execute(
                        "SELECT body FROM objects WHERE kind='local-plan-revision' AND id=?",
                        (revision_id,),
                    ).fetchone()
                    try:
                        if archive_row is None or json.loads(archive_row["body"]) != archive:
                            raise LocalPlanUnavailable("Saved plan revision is unavailable.")
                    except (TypeError, ValueError, KeyError) as exc:
                        raise LocalPlanUnavailable("Saved plan revision is unavailable.") from exc
                    if (latest is None or latest["planId"] != plan["planId"]
                            or latest["planRevision"] != head["revision"]
                            or latest["contentDigest"] != digest):
                        raise LocalPlanUnavailable(
                            "A different plan became active; reopen its latest revision.")
                    return {"planId": plan["planId"], "planRevision": head["revision"],
                            "contentDigest": digest, "scopeId": self._active_id(source),
                            "executionEnabled": False,
                            "reviewEligible": False}
                if (latest is None) != (expected_active_revision is None):
                    raise LocalPlanUnavailable(
                        "The active plan changed; reopen its latest revision.")
                if (latest is not None
                        and latest["planRevision"] != expected_active_revision):
                    raise LocalPlanUnavailable(
                        "The active plan changed; reopen its latest revision.")
                if (head is None and expected_revision is not None) or (
                        head is not None and head["revision"] != expected_revision):
                    raise LocalPlanUnavailable("The plan changed; reopen its latest revision.")
                if head is not None and (latest is None
                                         or latest["planId"] != plan["planId"]
                                         or latest["planRevision"] != head["revision"]
                                         or latest["contentDigest"] != head["digest"]):
                    raise LocalPlanUnavailable(
                        "A different plan became active; reopen its latest revision.")
                old_row = db.execute(
                    "SELECT body FROM objects WHERE kind='local-plan-revision' AND id=?",
                    (revision_id,),
                ).fetchone()
                if old_row is not None:
                    try:
                        if json.loads(old_row["body"]) != archive:
                            raise LocalPlanUnavailable("A planner revision already has different content.")
                    except (TypeError, ValueError, KeyError) as exc:
                        raise LocalPlanUnavailable("Saved plan revision is unavailable.") from exc
                    raise LocalPlanUnavailable(
                        "An archived planner revision cannot replace a newer head; create a new revision.")
                if old_row is None:
                    ledger.put(db, "local-plan-revision", revision_id, archive)
                ledger.put(db, "local-plan-head", head_id,
                           {"revision": plan["planRevision"], "digest": digest})
                ledger.put(db, "local-plan-active", self._active_id(source),
                           {"planId": plan["planId"],
                            "revision": plan["planRevision"], "digest": digest})
            return {"planId": plan["planId"], "planRevision": plan["planRevision"],
                    "contentDigest": digest, "scopeId": self._active_id(source),
                    "executionEnabled": False,
                    "reviewEligible": False}

    def _read_plan(self, db, source: LocalRecordedJournalSource,
                   plan_id: str) -> dict[str, object] | None:
        head_id = self._head_id(source, plan_id)
        row = db.execute(
                    "SELECT body FROM objects WHERE kind='local-plan-head' AND id=?",
                    (head_id,),
                ).fetchone()
        head = self._head(row)
        if head is None:
            return None
        archive_row = db.execute(
                    "SELECT body FROM objects WHERE kind='local-plan-revision' AND id=?",
                    (self._revision_id(head_id, head["revision"]),),
                ).fetchone()
        if archive_row is None:
            raise LocalPlanUnavailable("Saved plan revision is missing.")
        try:
            archive = json.loads(archive_row["body"])
            if (not isinstance(archive, dict)
                    or set(archive) != {"profileId", "accountBinding",
                                        "ledgerBinding", "environment", "planId",
                                        "revision", "contentDigest", "savedPlan"}
                    or archive["profileId"] != source.profile_id
                    or archive["accountBinding"] != source.account_binding
                    or archive["ledgerBinding"] != source._ledger_binding
                    or archive["environment"] != "paper"
                    or archive["planId"] != plan_id
                    or archive["revision"] != head["revision"]
                    or archive["contentDigest"] != head["digest"]):
                raise LocalPlanUnavailable("Saved plan scope is invalid.")
            plan, digest = _validated_plan(archive["savedPlan"])
            if digest != head["digest"] or plan["planId"] != plan_id \
                    or plan["planRevision"] != head["revision"]:
                raise LocalPlanUnavailable("Saved plan content changed.")
        except (TypeError, ValueError, KeyError) as exc:
            raise LocalPlanUnavailable("Saved plan revision is unavailable.") from exc
        return {"planId": plan_id, "planRevision": head["revision"],
                "contentDigest": digest, "scopeId": self._active_id(source),
                "savedPlan": plan,
                "executionEnabled": False, "reviewEligible": False}

    def load_current(self, profile_id: str, plan_id: str) -> dict[str, object] | None:
        """Return one account-scoped saved draft, never a broker-ready ticket."""
        if not _uuid4(plan_id):
            raise LocalPlanUnavailable("A valid local plan identity is required.")
        with self.profile_store._exclusive():
            source = self._source(profile_id)
            ledger = PaperStore(Path(source.directory) / LEDGER)
            with ledger.transaction() as db:
                return self._read_plan(db, source, plan_id)

    def _read_latest(self, db, source: LocalRecordedJournalSource) -> dict[str, object] | None:
        row = db.execute(
                    "SELECT body FROM objects WHERE kind='local-plan-active' AND id=?",
                    (self._active_id(source),),
                ).fetchone()
        if row is None:
            return None
        try:
            active = json.loads(row["body"])
            if (not isinstance(active, dict)
                    or set(active) != {"planId", "revision", "digest"}
                    or not _uuid4(active["planId"])
                    or not _uuid4(active["revision"])
                    or not isinstance(active["digest"], str)
                    or not _HEX.fullmatch(active["digest"])):
                raise LocalPlanUnavailable("Last saved plan identity is invalid.")
        except (TypeError, ValueError, KeyError) as exc:
            raise LocalPlanUnavailable("Last saved plan identity is unavailable.") from exc
        result = self._read_plan(db, source, active["planId"])
        if (result is None or result["planRevision"] != active["revision"]
                or result["contentDigest"] != active["digest"]):
            raise LocalPlanUnavailable("Last saved plan changed.")
        return result

    def load_latest(self, profile_id: str) -> dict[str, object] | None:
        """Return the last saved draft in this exact private account scope."""
        with self.profile_store._exclusive():
            source = self._source(profile_id)
            ledger = PaperStore(Path(source.directory) / LEDGER)
            with ledger.transaction() as db:
                return self._read_latest(db, source)

    def scope_status(self, profile_id: str) -> dict[str, object]:
        """Opaque UI key for this account; never an authentication credential."""
        with self.profile_store._exclusive():
            source = self._source(profile_id)
            ledger = PaperStore(Path(source.directory) / LEDGER)
            with ledger.transaction() as db:
                last = self._read_latest(db, source)
            return {"scopeId": self._active_id(source),
                    "hasSavedPlan": last is not None,
                    "environment": "paper", "executionEnabled": False,
                    "reviewEligible": False}
