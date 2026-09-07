import type { StudyBar } from "./drawing-workspace";

export type ChartTimeframe = "1Day" | "1Week";
export type OhlcvBar = StudyBar & { open: number; volume: number };

const weekStart = (timestamp: number) => {
  const date = new Date(timestamp), day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

export function aggregateWeeklyBars<T extends OhlcvBar>(rows: T[]): T[] {
  const result: Array<T & { _bucket: number }> = [];
  for (const row of rows) {
    const bucket = weekStart(row.timestamp), previous = result.at(-1);
    if (!previous || previous._bucket !== bucket) result.push({ ...row, _bucket: bucket });
    else Object.assign(previous, { timestamp: row.timestamp, high: Math.max(previous.high, row.high), low: Math.min(previous.low, row.low), close: row.close, volume: previous.volume + row.volume });
  }
  return result.map(({ _bucket: _ignored, ...row }) => row as unknown as T);
}

export function rangeSizeForTimeframe(range: "1M" | "3M" | "6M" | "1Y" | "Max", timeframe: ChartTimeframe) {
  const daily = range === "1M" ? 22 : range === "3M" ? 66 : range === "6M" ? 132 : range === "1Y" ? 252 : 9999;
  return timeframe === "1Day" ? daily : range === "Max" ? daily : Math.ceil(daily / 5);
}

export function displayIndexForTimestamp(timestamp: number, displayBars: StudyBar[], timeframe: ChartTimeframe) {
  if (timeframe === "1Day") return displayBars.findIndex(bar => bar.timestamp === timestamp);
  const bucket = weekStart(timestamp);
  return displayBars.findIndex(bar => weekStart(bar.timestamp) === bucket);
}
