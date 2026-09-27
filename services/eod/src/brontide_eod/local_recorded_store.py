"""Prepare a new, explicitly scoped paper ledger for a future connected app.

This is an internal, unmounted operation. It never opens TWS, adopts a legacy
ledger, changes an installed service, or grants submission authority. Production
use still requires the operator's private-storage and broker gates.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .ibkr_tws import PaperGatewayConfig
from .local_binding import BrokerAccountObservation, LocalBindingStore
from .local_discovery import DiscoveryEndpoint
from .local_journal import (LEDGER, RECORDED_DIRECTORY, RECORDED_MARKER,
                            LocalRecordedJournalSource)
from .local_paper_reference import LocalPaperReferenceStore
from .local_profile import LocalProfileStore, _reject_reparse
from .paper_store import PaperStore


class LocalRecordedStorePreparation:
    """Prepare or read one exact new ledger without ever switching its owner."""

    def __init__(self, profile_store: LocalProfileStore,
                 binding_store: LocalBindingStore,
                 paper_reference: LocalPaperReferenceStore) -> None:
        if (binding_store.profile_store is not profile_store
                or paper_reference.profile_store is not profile_store):
            raise ValueError("The private profile, account choice and paper reference must share one owner.")
        self.profile_store = profile_store
        self.binding_store = binding_store
        self.paper_reference = paper_reference

    def prepare(self, profile_id: str, observation: BrokerAccountObservation,
                discovery_endpoint: DiscoveryEndpoint,
                gateway_config: PaperGatewayConfig) -> LocalRecordedJournalSource:
        if (not isinstance(gateway_config, PaperGatewayConfig)
                or gateway_config.submissions_enabled is not False):
            raise ValueError("Paper submissions must remain locked during ledger preparation.")
        with self.profile_store._exclusive():
            profile = self.profile_store._read()
            if profile is None or profile.profile_id != profile_id:
                raise ValueError("Local profile changed; preserve private records for review.")
            reference = self.paper_reference.load(profile_id)
            if reference is None or not reference.matches(
                    self.binding_store.matched_account_for_reconciliation(
                        profile_id, observation)):
                raise ValueError("The owner-confirmed paper account reference does not match.")
            scope = self.binding_store.candidate_ledger_scope(
                profile_id, observation, discovery_endpoint, gateway_config)
            directory = self.profile_store.root / RECORDED_DIRECTORY
            _reject_reparse(directory)
            if directory.exists():
                # Existing contents are never rewritten or silently adopted.
                existing = LocalRecordedJournalSource.from_private_directory(
                    ledger_directory=directory, profile_id=profile_id,
                    remembered_account_binding=scope.remembered_account_binding)
                if existing._ledger_binding != scope.paper_ledger_binding:
                    raise ValueError("Existing paper ledger belongs to a different configuration.")
                existing.read(profile_id)
                return existing
            directory.mkdir(mode=0o700)
            # Marker publication is last. A crash before it leaves an
            # incomplete directory that later attempts refuse and preserve.
            ledger = directory / LEDGER
            with PaperStore(ledger).transaction():
                pass
            marker = directory / RECORDED_MARKER
            document = {"schemaVersion": 1, "syntheticOnly": False,
                        "profileId": scope.profile_id,
                        "accountBinding": scope.remembered_account_binding,
                        "paperLedgerBinding": scope.paper_ledger_binding,
                        "environment": "paper"}
            descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                json.dump(document, target, sort_keys=True, separators=(",", ":"))
                target.write("\n")
                target.flush()
                os.fsync(target.fileno())
            source = LocalRecordedJournalSource.from_private_directory(
                ledger_directory=directory, profile_id=profile_id,
                remembered_account_binding=scope.remembered_account_binding)
            source.read(profile_id)
            return source
