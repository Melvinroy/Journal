import type { KLineData } from 'klinecharts';

export type ChartBar = KLineData & { volume: number };
export type Instrument = { symbol: string; name: string; exchange: string; status: string };
export type ChartResponse = {
  schema_version: number;
  instrument: Instrument;
  bars: Array<{ session_date: string; open: number; high: number; low: number; close: number; volume: number }>;
  series: { source: string; adjustment: string; timeframe: string; returned: number; limit: number };
  status: { freshness: 'fresh' | 'stale' | 'unknown'; last_session: string | null; expected_session: string | null; calendar_covered: boolean };
};

export async function getLocalJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Instrument or selected series not found.');
    if (response.status === 503) throw new Error('Database unavailable. Check the local service and stop any ingestion writer, then retry.');
    throw new Error(`Local API returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export function toChartBars(response: ChartResponse): ChartBar[] {
  if (response.schema_version !== 1 || response.series.timeframe !== '1Day') throw new Error('Unsupported chart data version.');
  let previous = -Infinity;
  return response.bars.map((bar) => {
    // A session is a date, not an exchange timestamp. UTC noon avoids timezone date shifts.
    const timestamp = Date.parse(`${bar.session_date}T12:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== bar.session_date || timestamp <= previous ||
        ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
        Math.min(bar.open, bar.close, bar.low) <= 0 || bar.volume < 0 ||
        bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) {
      throw new Error('Invalid or unordered daily bars returned by the local API.');
    }
    previous = timestamp;
    return { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
  });
}
