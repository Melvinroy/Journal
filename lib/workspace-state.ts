export type MarketContext = { symbol: string; mode: "sample" | "local"; adjustment: string; asOf?: string; signalId?: string; strategyId?: string; tradeDraft?: { side:"Long"; entry:number; stop:number; targets:number[] } };
export type WatchItem = { symbol: string; note: string };
export const WATCH_KEY = "brontide-watchlist-v1";
export function validWatchlist(value:unknown):value is WatchItem[] {
  return Array.isArray(value)&&value.every(item=>item&&typeof item.symbol==="string"&&/^[A-Z][A-Z0-9./-]{0,31}$/.test(item.symbol)&&typeof item.note==="string")&&new Set(value.map(item=>item.symbol)).size===value.length;
}
export function normalizeTicker(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9./-]{0,31}$/.test(symbol)) throw new Error("Enter a valid ticker.");
  return symbol;
}
export function updateWatchlist(items: WatchItem[], symbol: string, action: "add" | "remove" | "up"): WatchItem[] {
  symbol = normalizeTicker(symbol);
  const index = items.findIndex(item => item.symbol === symbol);
  if (action === "remove") return items.filter(item => item.symbol !== symbol);
  if (action === "add") return index < 0 ? [...items, { symbol, note: "" }] : items;
  const next = [...items];
  if (index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}
export function readStored<T>(storage: Pick<Storage, "getItem">, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  const record = JSON.parse(raw);
  if (record?.version !== 1 || !("value" in record)) throw new Error("Saved data has an unsupported format. It has not been overwritten.");
  return record.value as T;
}
export function writeStored<T>(storage: Pick<Storage, "setItem">, key: string, value: T): void {
  storage.setItem(key, JSON.stringify({ version: 1, value }));
}
export function chartStorageKey(context: MarketContext) {
  return `brontide-drawings-v2:${context.mode}:${encodeURIComponent(normalizeTicker(context.symbol))}:${context.adjustment}`;
}
export function legacyChartStorageKey(context: MarketContext) {
  return `brontide-drawings-v1:${context.mode}:${normalizeTicker(context.symbol)}:1Day:${context.adjustment}`;
}
export type DrawingStorageContext = {
  symbol: string; mode: "sample" | "local"; adjustment: string;
  adjustmentBasis: "raw" | "split-dividend-adjusted";
};
export type DrawingDocumentV2<T> = {
  version: 2; kind: "manual-drawings"; context: DrawingStorageContext;
  timeframeVisibility: "all"; savedAt: number; value: T;
};
export function drawingStorageContext(key: string): DrawingStorageContext {
  const match = /^brontide-drawings-v2:(sample|local):([^:]+):(all|raw)$/.exec(key);
  if (!match) throw new Error("Invalid drawing storage key");
  const symbol = normalizeTicker(decodeURIComponent(match[2])), adjustment = match[3];
  return { symbol, mode: match[1] as "sample" | "local", adjustment,
    adjustmentBasis: adjustment === "raw" ? "raw" : "split-dividend-adjusted" };
}
export function legacyKeyForDrawingKey(key: string) {
  const context = drawingStorageContext(key);
  return legacyChartStorageKey(context);
}
export function serializeDrawingDocument<T>(key: string, value: T, savedAt = Date.now()) {
  const document: DrawingDocumentV2<T> = { version: 2, kind: "manual-drawings", context: drawingStorageContext(key), timeframeVisibility: "all", savedAt, value };
  return JSON.stringify(document);
}
export function readDrawingDocument<T>(storage: Pick<Storage, "getItem">, key: string, fallback: T): { value: T; raw: string | null; migrated: boolean } {
  const raw = storage.getItem(key);
  if (raw === null) {
    const legacyKey = legacyKeyForDrawingKey(key), legacyRaw = storage.getItem(legacyKey);
    return legacyRaw === null ? { value: fallback, raw: null, migrated: false }
      : { value: readStored(storage, legacyKey, fallback), raw: null, migrated: true };
  }
  const document = JSON.parse(raw) as DrawingDocumentV2<T>;
  const expected = drawingStorageContext(key);
  if (document?.version !== 2 || document.kind !== "manual-drawings" || document.timeframeVisibility !== "all" || !("value" in document) ||
      document.context?.symbol !== expected.symbol || document.context?.mode !== expected.mode || document.context?.adjustment !== expected.adjustment ||
      document.context?.adjustmentBasis !== expected.adjustmentBasis || !Number.isFinite(document.savedAt))
    throw new Error("Saved drawings have an unsupported or mismatched format. They have not been overwritten.");
  return { value: document.value, raw, migrated: false };
}
export function writeDrawingDocument<T>(storage: Pick<Storage, "setItem" | "getItem">, key: string, value: T, savedAt = Date.now()) {
  const raw = serializeDrawingDocument(key, value, savedAt);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Drawing storage write could not be verified.");
  return raw;
}
export function movingAverageByTime(rows: {timestamp:number;close:number}[], periods: number[]): Map<number, Record<string, number>> {
  const sums = periods.map(() => 0);
  const result = new Map<number, Record<string, number>>();
  rows.forEach((row, i) => {
    const values: Record<string, number> = {};
    periods.forEach((period, j) => {
      sums[j] += row.close;
      if (i >= period) sums[j] -= rows[i - period].close;
      if (i >= period - 1) values[`ma${j + 1}`] = sums[j] / period;
    });
    result.set(row.timestamp, values);
  });
  return result;
}
