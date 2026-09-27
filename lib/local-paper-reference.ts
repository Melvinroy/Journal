/** An owner-entered paper reference is not a TWS connection or permission to trade. */
export type LocalPaperReferenceStatus =
  | { kind: "missing"; accountMask: null }
  | { kind: "recorded"; accountMask: string };

export function localPaperReferenceFromResponse(value: unknown): LocalPaperReferenceStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.paperIdentityVerified !== false || item.executionEnabled !== false ||
      typeof item.recorded !== "boolean") return null;
  if (item.recorded) {
    if (item.environment !== "paper" || typeof item.accountMask !== "string" ||
        !/^[A-Z0-9]{2}•{2,28}[A-Z0-9]{2}$/.test(item.accountMask)) return null;
    return { kind: "recorded", accountMask: item.accountMask };
  }
  if (item.environment !== null || item.accountMask !== null) return null;
  return { kind: "missing", accountMask: null };
}
