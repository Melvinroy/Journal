/** Browser-safe interpretation of the authenticated local service's remembered choice. */
export type RememberedChoiceStatus = { kind: "unbound" | "remembered"; accountMask: string | null };

export function rememberedChoiceFromResponse(value: unknown): RememberedChoiceStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.executionEnabled !== false || item.connectionVerified !== false ||
      item.reconciliationRequired !== true || typeof item.remembered !== "boolean") return null;
  if (item.remembered) {
    if (item.environment !== "paper" || typeof item.accountMask !== "string" ||
        !/^[A-Z0-9]{2}•{2,28}[A-Z0-9]{2}$/.test(item.accountMask)) return null;
    return { kind: "remembered", accountMask: item.accountMask };
  }
  if (item.environment !== null || item.accountMask !== null) return null;
  return { kind: "unbound", accountMask: null };
}
