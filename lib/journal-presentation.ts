export type JournalSemanticTone =
  | "positive"
  | "negative"
  | "neutral"
  | "unavailable";

export function journalSemanticTone(
  value: number | null | undefined,
  available = value != null && Number.isFinite(value),
): JournalSemanticTone {
  if (!available || value == null || !Number.isFinite(value)) return "unavailable";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function journalSemanticClass(tone: JournalSemanticTone) {
  return `journal-semantic-${tone}`;
}
