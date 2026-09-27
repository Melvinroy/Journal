"""Local SDK inventory must remain diagnostic and session-scoped."""

from importlib.metadata import PackageNotFoundError
from types import SimpleNamespace

from brontide_eod.local_sdk import inspect_sdk_metadata


def test_missing_sdk_does_not_claim_execution_readiness():
    def missing(_name):
        raise PackageNotFoundError("ibapi")

    result = inspect_sdk_metadata(missing)
    assert result == {
        "metadataStatus": "not-found-in-runtime",
        "reportedVersion": None,
        "reportedProtobufPin": None,
        "knownDependencyAdvisory": None,
        "officialOriginVerified": False,
        "dependencyCompatible": None,
        "executionEnabled": False,
    }


def test_installed_metadata_is_sanitized_and_never_treated_as_provenance():
    package = SimpleNamespace(
        version="10.50.2",
        requires=["protobuf (==5.29.5)", "secret-package @ file:///private/token"],
        location="C:/private/operator-path",
    )
    requested = []
    result = inspect_sdk_metadata(lambda name: requested.append(name) or package)
    assert requested == ["ibapi"]
    assert result["metadataStatus"] == "metadata-present-unverified"
    assert result["reportedVersion"] == "10.50.2"
    assert result["reportedProtobufPin"] == "5.29.5"
    assert result["knownDependencyAdvisory"] == "GHSA-7gcm-g887-7qv7"
    assert result["officialOriginVerified"] is False
    assert result["dependencyCompatible"] is None
    assert result["executionEnabled"] is False
    assert "private" not in str(result)


def test_broken_metadata_fails_closed_without_leaking_errors():
    result = inspect_sdk_metadata(lambda _name: SimpleNamespace(
        version="operator@example.test/private", requires=["protobuf >=5.0"],
    ))
    assert result["metadataStatus"] == "metadata-present-unverified"
    assert result["reportedVersion"] is None
    assert result["reportedProtobufPin"] is None
    assert result["knownDependencyAdvisory"] is None
    assert result["executionEnabled"] is False
    assert "operator" not in str(result)

    def unavailable(_name):
        raise RuntimeError("C:/private/operator-path")

    result = inspect_sdk_metadata(unavailable)
    assert result["metadataStatus"] == "unavailable"
    assert "private" not in str(result)


def test_other_reported_pin_is_unverified_not_declared_secure():
    result = inspect_sdk_metadata(lambda _name: SimpleNamespace(
        version="10.50.3", requires=["protobuf (==5.29.6)"],
    ))
    assert result["reportedProtobufPin"] == "5.29.6"
    assert result["knownDependencyAdvisory"] is None
    assert result["officialOriginVerified"] is False
    assert result["dependencyCompatible"] is None
    assert result["executionEnabled"] is False


def test_diagnostic_identifies_all_numeric_pins_in_the_documented_advisory_ranges():
    for pin, affected in [
        ("5.29.3", True), ("5.29.5", True), ("5.29.6", False),
        ("6.29.9", False), ("6.30.0", True), ("6.33.4", True),
        ("6.33.5", False),
    ]:
        result = inspect_sdk_metadata(lambda _name: SimpleNamespace(
            version="10.50.2", requires=[f"protobuf (=={pin})"],
        ))
        assert result["reportedProtobufPin"] == pin
        assert (result["knownDependencyAdvisory"] == "GHSA-7gcm-g887-7qv7") is affected
        assert result["dependencyCompatible"] is None
        assert result["executionEnabled"] is False
