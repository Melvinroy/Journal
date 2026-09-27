"""Prepare artificial records in an explicitly selected verification profile.

Run with the repository EOD interpreter. No server, broker, or HTTP fixture-write
endpoint is used. Existing unrelated records and normal profiles are preserved.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import json

from brontide_eod.local_verification import VerificationProfileStore
from brontide_eod.local_journal import LEDGER
from brontide_eod.paper_store import PaperStore

CAMPAIGN_ID = "phase2-artificial-position"


def prepare(verification_id: str, state: str) -> dict:
    if state not in {"empty", "open", "closed", "late-fee"}:
        raise ValueError("Unknown qualification state")
    profile_store = VerificationProfileStore(verification_id)
    profile = profile_store.load_or_create()
    profile_store.initialize_journal(profile.profile_id)
    with profile_store._exclusive():
        source = profile_store.journal_source(profile.profile_id)
        previous = source.read(profile.profile_id)
        if state == "empty":
            if previous["records"]:
                raise ValueError("Existing history is preserved; use a new verification UUID for an empty case.")
            return previous
        campaign = {
            "id": CAMPAIGN_ID, "profileId": profile.profile_id,
            "accountBinding": profile_store.binding, "environment": "paper", "syntheticOnly": True,
            "ticket": {"direction": "Long", "stopPrice": 98, "symbol": "TEST",
                       "planId": "phase2-artificial-plan", "quantity": 2,
                       "planningPrice": 100, "hardCap": 100,
                       "exitPlan": {"schemaVersion": 1, "legs": [
                           {"id": "target-1", "role": "Target", "allocationPercent": 100,
                            "target": {"mode": "R", "multipleR": 1}}],
                           "breakeven": {"activationR": 1, "favorableOffset": {"unit": "Dollar", "value": 0}}}},
            "contract": {"conId": 42, "currency": "USD"}, "state": "Open",
            "createdAt": "2026-09-26T10:00:00Z",
            "executions": [{"executionId": "phase2-entry", "orderId": 101, "effect": "entry",
                            "role": "entry", "quantity": 2, "price": 100, "commission": .2,
                            "occurredAt": "2026-09-26T10:01:00Z"}],
        }
        if state in {"closed", "late-fee"}:
            campaign["state"] = "Closed"
            campaign["executions"].append({"executionId": "phase2-exit", "orderId": 102,
                "effect": "exit", "role": "target", "quantity": 2, "price": 103,
                "commission": None, "occurredAt": "2026-09-26T10:02:00Z"})
        if state == "late-fee":
            campaign["executions"][0]["commission"] = .4
            campaign["executions"][1]["commission"] = .3
        store = PaperStore(profile_store.journal_directory / LEDGER)
        with store.transaction() as db:
            existing = db.execute("SELECT body FROM objects WHERE kind='campaign' AND id=?", (CAMPAIGN_ID,)).fetchone()
            if existing:
                old = json.loads(existing[0])
                if old != campaign:
                    # Permit only append-only closure and the explicit late fee correction.
                    comparable = deepcopy(campaign)
                    comparable["state"] = old["state"]
                    comparable["executions"] = comparable["executions"][:len(old["executions"])]
                    for new_fill, old_fill in zip(comparable["executions"], old["executions"]):
                        if state == "late-fee":
                            new_fill["commission"] = old_fill["commission"]
                    if comparable != old or len(campaign["executions"]) < len(old["executions"]):
                        raise ValueError("Existing artificial history differs; it was preserved.")
            store.put(db, "campaign", CAMPAIGN_ID, campaign)
            store.event(db, "qualification:" + state, {"syntheticOnly": True, "state": state})
        return source.read(profile.profile_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verification-profile", required=True)
    parser.add_argument("--state", choices=["empty", "open", "closed", "late-fee"], required=True)
    options = parser.parse_args()
    result = prepare(options.verification_profile, options.state)
    print(json.dumps({"source": result["source"], "executionEnabled": result["executionEnabled"],
                      "historyStatus": result["historyStatus"], "records": result["records"]}, sort_keys=True))
