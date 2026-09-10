import { calculateWilderAtr14 } from "./trading-domain";
import { getLocalJson, toChartBars, type ChartResponse } from "./chart-data";

export type PlanningDataStatus = "fresh" | "stale" | "unknown" | "sample";

export type PlanningMarketSnapshot = {
  atr14: number;
  close: number;
  dayHigh: number;
  dayLow: number;
  expectedSession?: string | null;
  observedAt: string;
  sessionDate: string;
  source: string;
  status: PlanningDataStatus;
};

export function planningSnapshotFromChart(response: ChartResponse): PlanningMarketSnapshot {
  const bars = toChartBars(response);
  const latest = response.bars.at(-1);
  if (!latest || !response.status.last_session || latest.session_date !== response.status.last_session) {
    throw new Error("The local EOD response has no identifiable latest completed session.");
  }
  return {
    atr14: calculateWilderAtr14(bars.map(({ high, low, close }) => ({ high, low, close }))),
    close: latest.close,
    dayHigh: latest.high,
    dayLow: latest.low,
    expectedSession: response.status.expected_session,
    observedAt: response.status.checked_at ?? new Date().toISOString(),
    sessionDate: latest.session_date,
    source: `Local EOD · ${response.series.source}`,
    status: response.status.freshness,
  };
}

export async function loadPlanningMarketSnapshot(symbol: string, signal: AbortSignal) {
  const response = await getLocalJson<ChartResponse>(
    `/v1/chart/${encodeURIComponent(symbol)}?limit=260&adjustment=all&source=alpaca_sip`,
    signal,
  );
  return planningSnapshotFromChart(response);
}

const sampleDates = [
  "2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
  "2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
  "2026-08-28", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
];
const sampleBars = sampleDates.map((session_date) => ({
  session_date,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1_000_000,
}));

const sampleResponse: ChartResponse = {
  schema_version: 1,
  instrument: { symbol: "NVDA", name: "Synthetic NVDA planning fixture", exchange: "DEMO", status: "sample" },
  bars: sampleBars,
  series: { source: "synthetic-planner-fixture", adjustment: "all", timeframe: "1Day", returned: sampleBars.length, limit: sampleBars.length },
  status: { freshness: "fresh", last_session: "2026-09-03", expected_session: "2026-09-03", calendar_covered: true, checked_at: "2026-09-03T20:15:00Z" },
};

export function demoPlanningMarketSnapshot(symbol: string): PlanningMarketSnapshot | null {
  if (symbol !== "NVDA") return null;
  return { ...planningSnapshotFromChart(sampleResponse), source: "Simulated fixture", status: "sample" };
}
