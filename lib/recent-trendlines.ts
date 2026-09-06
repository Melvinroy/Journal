// Recovered from 177b033; scoring and recent-pivot rules are retained.
import type { TrendBar as Bar } from "./auto-trendlines";
type AutoTrendKind = "support" | "resistance";
type AutoTrend = {
  kind: AutoTrendKind;
  start: Bar;
  end: Bar;
  touches: number;
  confidence: number;
  direction: "rising" | "falling" | "flat";
};


function atrSeries(rows: Bar[], period = 14) {
  return rows.map((_, index) => {
    const first = Math.max(0, index - period + 1);
    let total = 0;
    let count = 0;
    for (let cursor = first; cursor <= index; cursor += 1) {
      const bar = rows[cursor];
      const previousClose = cursor > 0 ? rows[cursor - 1].close : bar.close;
      total += Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
      count += 1;
    }
    return total / Math.max(count, 1);
  });
}

function findAutoTrends(rows: Bar[], lookback = 90, pivotSpan = 5): AutoTrend[] {
  const source = rows.slice(-Math.min(rows.length, lookback));
  if (source.length < pivotSpan * 2 + 3) return [];
  const atr = atrSeries(source);
  const pivotIndexes = (kind: AutoTrendKind) => source.flatMap((bar, index) => {
    if (index < pivotSpan || index >= source.length - pivotSpan) return [];
    const value = kind === "resistance" ? bar.high : bar.low;
    const neighbors = source.slice(index - pivotSpan, index + pivotSpan + 1);
    const isPivot = kind === "resistance"
      ? neighbors.every((neighbor, offset) => offset === pivotSpan || neighbor.high <= value)
      : neighbors.every((neighbor, offset) => offset === pivotSpan || neighbor.low >= value);
    return isPivot ? [index] : [];
  });

  const bestFor = (kind: AutoTrendKind): AutoTrend | null => {
    const pivots = pivotIndexes(kind);
    let best: (AutoTrend & { score: number }) | null = null;
    for (let a = 0; a < pivots.length - 1; a += 1) {
      for (let b = a + 1; b < pivots.length; b += 1) {
        const first = pivots[a];
        const second = pivots[b];
        const length = second - first;
        const age = source.length - 1 - second;
        if (length < 6 || age > 45) continue;
        const firstValue = kind === "resistance" ? source[first].high : source[first].low;
        const secondValue = kind === "resistance" ? source[second].high : source[second].low;
        const slope = (secondValue - firstValue) / length;
        const valueAt = (index: number) => firstValue + slope * (index - first);
        let touches = 0;
        let baseViolations = 0;
        let closeStreak = 0;
        let maxCloseStreak = 0;

        for (const pivot of pivots) {
          if (pivot < first) continue;
          const pivotValue = kind === "resistance" ? source[pivot].high : source[pivot].low;
          if (Math.abs(pivotValue - valueAt(pivot)) <= atr[pivot] * .35) touches += 1;
        }
        for (let index = first; index <= second; index += 1) {
          const tolerance = atr[index] * .35;
          const breached = kind === "resistance"
            ? source[index].high > valueAt(index) + tolerance
            : source[index].low < valueAt(index) - tolerance;
          if (breached) baseViolations += 1;
        }
        for (let index = second + 1; index < source.length; index += 1) {
          const tolerance = atr[index] * .35;
          const breached = kind === "resistance"
            ? source[index].close > valueAt(index) + tolerance
            : source[index].close < valueAt(index) - tolerance;
          closeStreak = breached ? closeStreak + 1 : 0;
          maxCloseStreak = Math.max(maxCloseStreak, closeStreak);
        }
        if (touches < 2 || maxCloseStreak >= 3) continue;

        const latestIndex = source.length - 1;
        const distanceInAtr = Math.abs(source[latestIndex].close - valueAt(latestIndex)) / Math.max(atr[latestIndex], .01);
        const score = Math.min(42, touches * 12)
          + Math.max(0, 24 - baseViolations * 7)
          + Math.max(0, 19 * (1 - age / 46))
          + Math.min(15, length / 2)
          - Math.min(22, distanceInAtr * 3);
        if (!best || score > best.score) {
          best = {
            kind,
            start: source[first],
            end: source[second],
            touches,
            confidence: Math.max(1, Math.min(99, Math.round(score))),
            direction: Math.abs(slope) < atr[latestIndex] * .002 ? "flat" : slope > 0 ? "rising" : "falling",
            score,
          };
        }
      }
    }
    return best;
  };

  return [bestFor("resistance"), bestFor("support")].filter((line): line is AutoTrend => Boolean(line));
}


export function findRecentTrends(rows: Bar[], logarithmic=false) {
  if(rows.some((bar,i)=>![bar.open,bar.high,bar.low,bar.close].every(value=>Number.isFinite(value)&&value>0)||!Number.isFinite(bar.timestamp)||(i>0&&bar.timestamp<=rows[i-1].timestamp)))throw new Error("Invalid recent-trend history");
  const input=logarithmic?rows.map(bar=>({...bar,open:Math.log(bar.open),high:Math.log(bar.high),low:Math.log(bar.low),close:Math.log(bar.close)})):rows;
  return findAutoTrends(input).map(line=>({
    ...line,
    points: [line.start,line.end].map(bar=>({timestamp:bar.timestamp,value:logarithmic?Math.exp(line.kind==="support"?bar.low:bar.high):line.kind==="support"?bar.low:bar.high})),
  }));
}
