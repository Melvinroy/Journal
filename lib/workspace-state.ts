export type MarketContext = { symbol: string; mode: "sample" | "local"; adjustment: string; asOf?: string; signalId?: string; strategyId?: string };
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
  return `brontide-drawings-v1:${context.mode}:${context.symbol}:1Day:${context.adjustment}`;
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
