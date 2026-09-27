"""Read-only SDK metadata inventory for the locked standalone candidate.

Installed package metadata is not proof that a user accepted IBKR's terms,
that code came from the official download, or that it is safe to execute.
This module never imports ibapi or connects to TWS.
"""

from __future__ import annotations

import re
from importlib.metadata import PackageNotFoundError, distribution
from typing import Callable


_VERSION = re.compile(r"^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$", re.ASCII)
_PIN = re.compile(
    r"^protobuf\s*(?:\(\s*==\s*(\d{1,3}\.\d{1,3}\.\d{1,3})\s*\)"
    r"|==\s*(\d{1,3}\.\d{1,3}\.\d{1,3}))$",
    re.IGNORECASE | re.ASCII,
)


def _known_protobuf_advisory(pin: str | None) -> bool:
    """Match only numeric exact pins covered by the published GHSA ranges."""
    if pin is None:
        return False
    version = tuple(int(part) for part in pin.split("."))
    return version < (5, 29, 6) or (6, 30, 0) <= version <= (6, 33, 4)


def inspect_sdk_metadata(lookup: Callable = distribution) -> dict[str, object]:
    """Report sanitized claims from this Python runtime, never capability."""
    state = "unavailable"
    version: str | None = None
    protobuf_pin: str | None = None
    try:
        package = lookup("ibapi")
    except PackageNotFoundError:
        state = "not-found-in-runtime"
    except Exception:
        pass
    else:
        state = "metadata-present-unverified"
        try:
            claimed_version = getattr(package, "version", None)
            if isinstance(claimed_version, str) and _VERSION.fullmatch(claimed_version):
                version = claimed_version
            for requirement in getattr(package, "requires", None) or ():
                if isinstance(requirement, str) and (match := _PIN.fullmatch(requirement)):
                    protobuf_pin = match.group(1) or match.group(2)
                    break
        except Exception:
            pass  # Broken metadata cannot make this runtime execution-ready.
    return {
        "metadataStatus": state,
        "reportedVersion": version,
        "reportedProtobufPin": protobuf_pin,
        # This reports only one known issue in a declared exact numeric pin;
        # it does not prove installed provenance, compatibility, or safety.
        "knownDependencyAdvisory": (
            "GHSA-7gcm-g887-7qv7" if _known_protobuf_advisory(protobuf_pin) else None),
        "officialOriginVerified": False,
        "dependencyCompatible": None,
        "executionEnabled": False,
    }
