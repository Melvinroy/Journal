/** Local SDK metadata is a diagnostic claim, never broker connection authority. */
export type LocalSdkMetadata = {
  metadataStatus: "not-found-in-runtime" | "metadata-present-unverified" | "unavailable";
  reportedVersion: string | null;
  reportedProtobufPin: string | null;
  knownDependencyAdvisory: "GHSA-7gcm-g887-7qv7" | null;
};

function hasKnownProtobufAdvisory(pin: string | null): boolean {
  if (!pin || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pin)) return false;
  const [major, minor, patch] = pin.split(".").map(Number);
  const version = major * 1_000_000 + minor * 1_000 + patch;
  return version < 5_029_006 || (version >= 6_030_000 && version <= 6_033_004);
}

export function localSdkMetadataFromResponse(value: unknown): LocalSdkMetadata | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!["not-found-in-runtime", "metadata-present-unverified", "unavailable"].includes(String(item.metadataStatus)) ||
      item.officialOriginVerified !== false || item.dependencyCompatible !== null ||
      item.executionEnabled !== false ||
      !(item.reportedVersion === null ||
        (typeof item.reportedVersion === "string" && /^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(item.reportedVersion))) ||
      !(item.reportedProtobufPin === null ||
        (typeof item.reportedProtobufPin === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(item.reportedProtobufPin))) ||
      !(item.knownDependencyAdvisory === null ||
        item.knownDependencyAdvisory === "GHSA-7gcm-g887-7qv7") ||
      hasKnownProtobufAdvisory(item.reportedProtobufPin as string | null) !==
        (item.knownDependencyAdvisory === "GHSA-7gcm-g887-7qv7")) return null;
  return item as LocalSdkMetadata;
}
