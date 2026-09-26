import type { CloudTradeRow } from "./cloud-trade-contract";

type SubmittedTrade = Omit<CloudTradeRow, "id">;

/** Each authentication transition invalidates requests, including A -> B -> A. */
export function createCloudRequestScope() {
  let generation = 0;
  return {
    advance() { generation += 1; },
    capture() {
      const started = generation;
      return () => started === generation;
    },
  };
}

function fingerprint(row: SubmittedTrade): string | null {
  if (!row || typeof row !== "object" || typeof row.symbol !== "string" ||
      typeof row.setup !== "string" || typeof row.trade_date !== "string" ||
      !["Long", "Short"].includes(row.side) || !["A", "B", "C"].includes(row.grade)) return null;
  const numbers = [row.pnl, row.realized_r, row.dollar_risk, row.planned_r];
  if (numbers.some(value => (typeof value !== "number" && typeof value !== "string") ||
      String(value).trim() === "" || !Number.isFinite(Number(value)))) return null;
  return JSON.stringify([row.symbol, row.side, row.setup, row.trade_date, row.grade, ...numbers.map(Number)]);
}

/** Row count alone cannot prove an import: duplicates and wrong records fail. */
export function cloudWritesAcknowledged(expected: SubmittedTrade[], received: CloudTradeRow[] | null): boolean {
  if (!Array.isArray(received) || received.length !== expected.length) return false;
  const ids = new Set<string>();
  const pending = new Map<string, number>();
  for (const row of expected) {
    const key = fingerprint(row);
    if (key === null) return false;
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }
  for (const row of received) {
    if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) return false;
    ids.add(row.id);
    const key = fingerprint(row);
    if (key === null || !pending.get(key)) return false;
    pending.set(key, pending.get(key)! - 1);
  }
  return [...pending.values()].every(count => count === 0);
}
