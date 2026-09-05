export const AUTO_TREND_VERSION = "atr-pivots-v1";
export type TrendBar = { timestamp: number; open: number; high: number; low: number; close: number };
export type TrendKind = "support" | "resistance";
export type TrendPoint = { timestamp: number; value: number };
export type Pivot = { index: number; confirmedAt: number; value: number; kind: TrendKind };
export type AutoTrend = {
  id: string; kind: TrendKind; points: [TrendPoint, TrendPoint]; touches: number;
  violations: number; fitATR: number; latestTouch: number; evaluatedAt: number;
};
export type TrendSettings = { enabled: boolean; edits: Record<string, [TrendPoint, TrendPoint] | null> };
export const EMPTY_TRENDS: TrendSettings = { enabled: false, edits: {} };

// Off-screen timestamp extrapolation in the renderer counts calendar days.
// Supply trading-session indices instead, so weekends cannot tilt a ray.
export function projectTrendPoints(points: TrendPoint[], rows: TrendBar[], visibleCount: number) {
  return points.map(p => {
    const index = rows.findIndex(row=>row.timestamp===p.timestamp);
    if (index < 0) throw new Error("Saved trend anchor is outside the loaded history.");
    return {dataIndex:index-(rows.length-visibleCount),value:p.value};
  });
}

export function restoreTrendPoints(points: {dataIndex?: number; value?: number}[], rows: TrendBar[], visibleCount: number): [TrendPoint,TrendPoint] {
  if (points.length !== 2) throw new Error("Two anchors required.");
  const result = points.map(p=>{
    const row = rows[(p.dataIndex ?? NaN)+rows.length-visibleCount];
    if (!row || !Number.isFinite(p.value) || p.value! <= 0) throw new Error("Keep trend anchors within loaded sessions and above zero.");
    return {timestamp:row.timestamp,value:p.value!};
  }) as [TrendPoint,TrendPoint];
  if(result[0].timestamp>=result[1].timestamp)throw new Error("Keep the first trend anchor before the second.");
  return result;
}

export function validTrendSettings(input: unknown): input is TrendSettings {
  if (!input || typeof input !== "object") return false;
  const row = input as TrendSettings;
  return typeof row.enabled === "boolean" && !!row.edits && typeof row.edits === "object" && !Array.isArray(row.edits)
    && Object.entries(row.edits).every(([id, points]) => id.startsWith(AUTO_TREND_VERSION + ":") && (points === null ||
      (Array.isArray(points) && points.length === 2 && points.every(p => p && Number.isFinite(p.timestamp) && Number.isFinite(p.value) && p.value > 0) && points[0].timestamp < points[1].timestamp)));
}

/** Completed, chronological input only. Do not repair bad bars silently. */
function checkedBars(input: TrendBar[], asOf: number): TrendBar[] {
  const rows = input.filter(row => row.timestamp <= asOf);
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i];
    if (![b.timestamp,b.open,b.high,b.low,b.close].every(Number.isFinite) || b.low <= 0 ||
      b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close) ||
      (i > 0 && b.timestamp <= rows[i-1].timestamp)) throw new Error("Auto Trend requires valid chronological daily bars.");
  }
  return rows;
}

export function trendATR(rows: TrendBar[]): number[] {
  let sum = 0;
  return rows.map((b, i, all) => {
    const tr = i === 0 ? b.high-b.low : Math.max(b.high-b.low, Math.abs(b.high-all[i-1].close), Math.abs(b.low-all[i-1].close));
    if (i < 14) { sum += tr; return i === 13 ? sum/14 : NaN; }
    // sum holds the seed total until the first recursive observation.
    sum = i === 14 ? ((sum/14)*13+tr)/14 : (sum*13+tr)/14;
    return sum;
  });
}

export function confirmedPivots(rows: TrendBar[], atr = trendATR(rows)): Pivot[] {
  const pivots: Pivot[] = [], first = Math.max(3, rows.length-120);
  for (let i = first; i < rows.length-3; i++) {
    if (!(atr[i] > 0)) continue;
    const left = rows.slice(i-3,i), right = rows.slice(i+1,i+4);
    for (const kind of ["support","resistance"] as const) {
      const high = kind === "resistance", value = high ? rows[i].high : rows[i].low;
      const extreme = left.every(b => high ? b.high < value : b.low > value) && right.every(b => high ? b.high <= value : b.low >= value);
      const prominence = high ? Math.min(value-Math.min(...left.map(b=>b.low)),value-Math.min(...right.map(b=>b.low)))
        : Math.min(Math.max(...left.map(b=>b.high))-value,Math.max(...right.map(b=>b.high))-value);
      if (extreme && prominence >= .75*atr[i]) pivots.push({index:i,confirmedAt:rows[i+3].timestamp,value,kind});
    }
  }
  return pivots;
}

export function findAutoTrends(input: TrendBar[], options: { asOf?: number; logarithmic?: boolean } = {}): AutoTrend[] {
  const rows = checkedBars(input, options.asOf ?? Infinity);
  if (rows.length < 20) return [];
  const atr = trendATR(rows), pivots = confirmedPivots(rows,atr), last = rows.length-1;
  const transform = options.logarithmic ? Math.log : (v:number)=>v;
  const inverse = options.logarithmic ? Math.exp : (v:number)=>v;
  const result: AutoTrend[] = [];
  for (const kind of ["resistance","support"] as const) {
    const points = pivots.filter(p=>p.kind===kind), candidates: (AutoTrend & {first:number;second:number})[] = [];
    for (let a = 0; a < points.length; a++) for (let b = a+1; b < points.length; b++) {
      const start = points[a], end = points[b];
      if (end.index-start.index < 6) continue;
      const slope = (transform(end.value)-transform(start.value))/(end.index-start.index);
      const at = (i:number)=>inverse(transform(start.value)+slope*(i-start.index));
      if (Math.abs(at(last)-rows[last].close) > 5*atr[last] || at(last) <= 0) continue;
      const touches = points.filter(p=>p.index>=start.index && Math.abs(p.value-at(p.index)) <= .35*atr[p.index]);
      if (touches.length < 3 || last-touches[touches.length-1].index > 30) continue;
      let violations = 0, streak = 0, broken = false;
      for (let i = start.index; i <= last; i++) {
        const beyond = kind === "resistance" ? rows[i].close-at(i) : at(i)-rows[i].close;
        if (beyond > .35*atr[i]) {violations++;streak++;} else streak = 0;
        if (streak >= 3) {broken=true;break;}
      }
      if (broken) continue;
      candidates.push({id:`${AUTO_TREND_VERSION}:${kind}:${rows[start.index].timestamp}:${rows[end.index].timestamp}`,
        kind,points:[{timestamp:rows[start.index].timestamp,value:start.value},{timestamp:rows[end.index].timestamp,value:end.value}],
        touches:touches.length,violations,fitATR:touches.reduce((sum,p)=>sum+Math.abs(p.value-at(p.index))/atr[p.index],0)/touches.length,
        latestTouch:rows[touches[touches.length-1].index].timestamp,evaluatedAt:rows[last].timestamp,first:start.index,second:end.index});
    }
    candidates.sort((a,b)=>b.touches-a.touches || a.violations-b.violations || b.latestTouch-a.latestTouch || a.fitATR-b.fitATR || a.first-b.first || a.second-b.second);
    if (candidates[0]) { const {first,second,...line} = candidates[0]; void first; void second; result.push(line); }
  }
  return result;
}
