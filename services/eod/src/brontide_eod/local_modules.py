"""Optional per-profile view selection for the built-in Trading module.

This sidecar leaves profile.json v1 intact so an older installed candidate can
still read the profile after a rollback. Hiding a view never stops accounting.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .local_binding import LocalBindingStore
from .local_profile import LocalProfileStore, _reject_reparse


MODULES_FILE = "modules.json"
MAX_MODULES_BYTES = 2048
ModuleView = Literal["trading", "journal"]
_DEFAULT = ("trading", "journal")


@dataclass(frozen=True)
class LocalModulePreferences:
    profile_id: str
    enabled_views: tuple[ModuleView, ...]

    def public_status(self) -> dict[str, object]:
        return {"enabledViews": list(self.enabled_views),
                "executionEnabled": False}


def _normalize_views(value: object) -> tuple[ModuleView, ...]:
    if (not isinstance(value, (list, tuple)) or not value
            or len(value) > len(_DEFAULT)
            or any(type(item) is not str or item not in _DEFAULT for item in value)
            or len(set(value)) != len(value)):
        raise ValueError("Select one or both built-in views.")
    return tuple(view for view in _DEFAULT if view in value)


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Module preferences contain a duplicate field.")
        result[key] = value
    return result


class LocalModulePreferencesStore:
    """Store a minimal view choice under the existing profile's private root."""

    def __init__(self, profile_store: LocalProfileStore):
        self.profile_store = profile_store
        self.path = profile_store.root / MODULES_FILE

    def _read(self, expected_profile_id: str) -> LocalModulePreferences:
        _reject_reparse(self.path)
        if not self.path.exists():
            return LocalModulePreferences(expected_profile_id, _DEFAULT)
        if not self.path.is_file() or self.path.stat().st_size > MAX_MODULES_BYTES:
            raise ValueError("Module preferences are unavailable.")
        try:
            with self.path.open("rb") as stored:
                raw = stored.read(MAX_MODULES_BYTES + 1)
            document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
            if (len(raw) > MAX_MODULES_BYTES or not isinstance(document, dict)
                    or set(document) != {"schemaVersion", "profileId", "enabledViews"}
                    or type(document["schemaVersion"]) is not int
                    or document["schemaVersion"] != 1
                    or document["profileId"] != expected_profile_id):
                raise ValueError("Module preferences do not match this profile.")
            views = _normalize_views(document["enabledViews"])
            return LocalModulePreferences(expected_profile_id, views)
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, KeyError) as exc:
            raise ValueError("Module preferences are unavailable.") from exc

    def load(self, expected_profile_id: str) -> LocalModulePreferences:
        self.profile_store.check_existing_schema()
        profile = self.profile_store._read()
        if profile is None or profile.profile_id != expected_profile_id:
            raise ValueError("Local profile changed; relaunch Brontide.")
        return self._read(expected_profile_id)

    def save(self, expected_profile_id: str, enabled_views: object) -> LocalModulePreferences:
        views = _normalize_views(enabled_views)
        with self.profile_store._exclusive():
            profile = self.profile_store._read()
            if profile is None or profile.profile_id != expected_profile_id:
                raise ValueError("Local profile changed; relaunch Brontide.")
            # The binding write uses the same profile lock. A check made before
            # acquiring it could race with account confirmation.
            if ("trading" not in views
                    and LocalBindingStore(self.profile_store)._read(expected_profile_id)
                    is not None):
                raise ValueError("Trading cannot be hidden while account exposure is unresolved.")
            current = self._read(expected_profile_id)
            if current.enabled_views == views:
                return current
            document = {"schemaVersion": 1, "profileId": expected_profile_id,
                        "enabledViews": list(views)}
            temporary: Path | None = None
            try:
                descriptor, name = tempfile.mkstemp(prefix=".modules-", suffix=".tmp",
                                                     dir=self.profile_store.root)
                temporary = Path(name)
                with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                    json.dump(document, target, sort_keys=True, separators=(",", ":"))
                    target.write("\n")
                    target.flush()
                    os.fsync(target.fileno())
                _reject_reparse(self.path)
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return LocalModulePreferences(expected_profile_id, views)
