import type { OverlayCreate } from "klinecharts";

export type DrawingPoint = { timestamp?: number; value?: number };
export type Drawing = Pick<OverlayCreate, "name" | "styles" | "extendData"> & {
  id: string; points: DrawingPoint[]; lock: boolean; visible: boolean; displayName?: string;
};
export type History = { past: Drawing[][]; present: Drawing[]; future: Drawing[][] };
export type StudyBar = { timestamp: number; high: number; low: number; close: number; volume?: number };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Additive migration of the original version-1 drawing array. Never discard unknown tools.
export function decodeDrawings(value: unknown): Drawing[] {
  if (!Array.isArray(value)) throw new Error("Invalid drawing collection");
  const ids = new Set<string>();
  return value.map((row, index) => {
    if (!row || typeof row.name !== "string" || !Array.isArray(row.points) || !row.points.length ||
      row.points.some((p: DrawingPoint) => !p || typeof p !== "object" || (p.timestamp === undefined && p.value === undefined) || (p.timestamp !== undefined && !finite(p.timestamp)) ||
        (p.value !== undefined && !finite(p.value)))) throw new Error("Invalid saved drawing");
    const id = typeof row.id === "string" ? row.id : `legacy-${index}-${row.name}`;
    if (ids.has(id)) throw new Error("Duplicate drawing ID");
    ids.add(id);
    return { name: row.name, id, points: row.points.map(({ timestamp, value }: DrawingPoint) => ({ timestamp, value })),
      lock: row.lock === true, visible: row.visible !== false,
      ...(typeof row.displayName === "string" && row.displayName.trim() ? { displayName: row.displayName.trim() } : {}),
      ...(row.styles ? { styles: row.styles } : {}), ...(row.extendData !== undefined ? { extendData: row.extendData } : {}) };
  });
}
export function drawingHistory(present: Drawing[]): History { return { past: [], present, future: [] }; }
export function changeDrawings(history: History, next: Drawing[]): History {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-100), present: next, future: [] };
}
export function travelDrawings(history: History, direction: "undo" | "redo"): History {
  if (direction === "undo") {
    const previous = history.past.at(-1);
    return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
  }
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}

export function duplicateDrawing(rows: Drawing[], id: string, newId: string, baseName?: string): Drawing[] {
  const index = rows.findIndex(row => row.id === id);
  if (index < 0 || rows.some(row => row.id === newId)) return rows;
  const source = rows[index];
  const copy: Drawing = JSON.parse(JSON.stringify({ ...source, id: newId,
    displayName: `${source.displayName ?? baseName ?? source.name} copy`, lock: false }));
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}
export function reorderDrawing(rows: Drawing[], id: string, direction: -1 | 1): Drawing[] {
  const index = rows.findIndex(row => row.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return rows;
  const next = [...rows]; [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function updateDrawings(rows: Drawing[], ids: string[], patch: Partial<Drawing>): Drawing[] {
  const selected = new Set(ids); let changed = false;
  const next = rows.map(row => {
    if (!selected.has(row.id)) return row;
    const safePatch = { ...patch }; delete safePatch.id; delete safePatch.name;
    const candidate = { ...row, ...safePatch, id: row.id, name: row.name };
    if (JSON.stringify(candidate) === JSON.stringify(row)) return row;
    changed = true; return candidate;
  });
  return changed ? next : rows;
}

export function riskReward(points: DrawingPoint[]) {
  const [entry, stop, target] = points.map(p => p.value);
  if (![entry, stop, target].every(v => finite(v) && v > 0) || !(stop! < entry! && entry! < target!))
    throw new Error("Long position needs stop < entry < target, all above zero.");
  return { risk: entry! - stop!, reward: target! - entry!, ratio: (target! - entry!) / (entry! - stop!) };
}
function sessionRange(points: DrawingPoint[], bars: StudyBar[]) {
  const indices = points.map(p => bars.findIndex(b => b.timestamp === p.timestamp));
  if (indices.length < 2 || indices.some(i => i < 0) || indices[0] >= indices[1])
    throw new Error("Choose two loaded sessions in chronological order.");
  return [indices[0], indices[1]];
}
export function dateMeasurement(points: DrawingPoint[], bars: StudyBar[]) {
  const [start, end] = sessionRange(points, bars);
  return { sessions: end - start + 1, intervals: end - start,
    days: (bars[end].timestamp - bars[start].timestamp) / 86400000 };
}
export function contractions(points: DrawingPoint[], bars: StudyBar[]) {
  if (points.length !== 6) throw new Error("Mark three high-to-low contractions (six anchors).");
  const indices = points.map(p => bars.findIndex(b => b.timestamp === p.timestamp));
  if (indices.some((v, i) => v < 0 || (i > 0 && v <= indices[i - 1])))
    throw new Error("Place all six anchors on successive loaded sessions.");
  const depths = [0, 2, 4].map(i => {
    const high = points[i].value, low = points[i + 1].value;
    if (!finite(high) || !finite(low) || low <= 0 || high <= low) throw new Error("Each contraction needs a high followed by a lower, positive price.");
    return 100 * (high - low) / high;
  });
  return { depths, tightening: depths[0] > depths[1] && depths[1] > depths[2] };
}
export function anchoredVWAP(timestamp: number | undefined, bars: StudyBar[]) {
  const start = bars.findIndex(b => b.timestamp === timestamp);
  if (start < 0) throw new Error("Anchor session is outside loaded history.");
  let volume = 0, weighted = 0;
  return bars.slice(start).map(bar => {
    if (!finite(bar.volume) || bar.volume < 0 || ![bar.high, bar.low, bar.close].every(v => finite(v) && v > 0))
      throw new Error("VWAP unavailable: complete price and volume data is required.");
    volume += bar.volume;
    weighted += (bar.high + bar.low + bar.close) / 3 * bar.volume;
    return { timestamp: bar.timestamp, value: volume ? weighted / volume : undefined };
  });
}
// OLS on closes in session order. Population residual deviation, fixed +/-2 sigma.
// Price-space calculation remains identical on a logarithmic display.
export function regressionChannel(points: DrawingPoint[], bars: StudyBar[]) {
  const [start, end] = sessionRange(points, bars);
  const rows = bars.slice(start, end + 1), n = rows.length;
  if (n < 3 || rows.some(b => !finite(b.close) || b.close <= 0)) throw new Error("Regression needs at least three valid closing prices.");
  const meanX = (n - 1) / 2, meanY = rows.reduce((s, b) => s + b.close, 0) / n;
  const denominator = rows.reduce((s, _, i) => s + (i - meanX) ** 2, 0);
  const slope = rows.reduce((s, b, i) => s + (i - meanX) * (b.close - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const sigma = Math.sqrt(rows.reduce((s, b, i) => s + (b.close - intercept - slope * i) ** 2, 0) / n);
  return { slope, sigma, series: rows.map((b, i) => ({ timestamp: b.timestamp, value: intercept + slope * i })) };
}
export function drawingEvidence(drawing: Pick<Drawing, "name" | "points">, bars: StudyBar[]): string {
  try {
    if (drawing.name === "brontide-position") { const r = riskReward(drawing.points); return `Risk ${r.risk.toFixed(2)} · Reward ${r.reward.toFixed(2)} · ${r.ratio.toFixed(2)}R`; }
    if (drawing.name === "brontide-date") { const r = dateMeasurement(drawing.points, bars); return `${r.sessions} sessions (inclusive) · ${r.intervals} intervals · ${r.days.toFixed(0)} calendar days`; }
    if (drawing.name === "brontide-contraction") { const r = contractions(drawing.points, bars); return `${r.depths.map(d => d.toFixed(1) + "%").join(" → ")} · ${r.tightening ? "Contracting" : "Not contracting"} · manual markup`; }
    if (drawing.name === "brontide-vwap") { const r = anchoredVWAP(drawing.points[0]?.timestamp, bars).at(-1); return r?.value === undefined ? "Unavailable: cumulative volume is zero." : `Anchored VWAP ${r.value.toFixed(2)} · typical price × volume`; }
    if (drawing.name === "brontide-regression") { const r = regressionChannel(drawing.points, bars); return `Close regression · ±2σ (${(2 * r.sigma).toFixed(2)}) · slope ${r.slope.toFixed(3)}/session`; }
    if (drawing.name === "brontide-measure") {
      const [a, b] = drawing.points.map(p => p.value);
      return finite(a) && a !== 0 && finite(b) ? `${(b - a).toFixed(2)} · ${((b / a - 1) * 100).toFixed(2)}%` : "Unavailable: a nonzero start price is required.";
    }
    return "Anchors save by session and price. Drag handles or edit values below.";
  } catch (error) { return `Unavailable: ${(error as Error).message}`; }
}
