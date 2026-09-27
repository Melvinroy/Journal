/** Masked, short-lived account review from the authenticated local service. */
export type LocalAccountReview = {
  selectionId: string;
  candidates: { index: number; mask: string }[];
};

export function localAccountReviewFromResponse(value: unknown): LocalAccountReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.selectionId !== "string" ||
      !/^[A-Za-z0-9_-]{32}$/.test(item.selectionId) ||
      item.paperIdentityVerified !== false ||
      item.reconciliationRequired !== true ||
      item.executionEnabled !== false ||
      !Array.isArray(item.candidates) ||
      item.candidates.length < 1 || item.candidates.length > 8) return null;
  const candidates: LocalAccountReview["candidates"] = [];
  for (const candidate of item.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    if (row.index !== candidates.length || typeof row.mask !== "string" ||
        !/^[A-Z0-9]{2}•{2,28}[A-Z0-9]{2}$/.test(row.mask)) return null;
    candidates.push({ index: row.index, mask: row.mask });
  }
  return { selectionId: item.selectionId, candidates };
}

export function maskTypedAccount(value: string): string | null {
  return /^[A-Z][A-Z0-9]{5,31}$/.test(value)
    ? value.slice(0, 2) + "•".repeat(value.length - 4) + value.slice(-2)
    : null;
}

export type ExactSavedAccountCheck = { remembered: boolean; exactMatch: boolean };

export function exactSavedAccountCheckFromResponse(value: unknown): ExactSavedAccountCheck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.remembered !== "boolean" || typeof item.exactMatch !== "boolean" ||
      (item.exactMatch && !item.remembered) || item.connectionVerified !== false ||
      item.reconciliationRequired !== true || item.executionEnabled !== false) return null;
  return { remembered: item.remembered, exactMatch: item.exactMatch };
}
