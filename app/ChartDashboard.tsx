"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart, Crosshair, KLineData } from "klinecharts";
import {
  ArrowUpRight, ArrowsOutLineHorizontal, ArrowsVertical, CalendarDots, CaretRight, ChartLine,
  ChartLineDown, ChartLineUp, Crosshair as CrosshairIcon, Cursor, Flag, Function as FunctionIcon, LineSegment,
  Minus, NotePencil, Path, PencilSimple, Rectangle, Rows, Ruler, Selection, Strategy, Tag, TextT,
  Trash, TrendUp, WaveSine, type Icon,
} from "@phosphor-icons/react";

type Bar = KLineData & { volume: number };
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "Max";
type SymbolKey = "NVDA" | "MRNA" | "CRCL";
type ChartTheme = "light" | "dark";
type DrawingTool =
  | "cursor" | "trend" | "ray" | "segment" | "extended" | "arrow"
  | "horizontal" | "horizontalRay" | "horizontalSegment" | "vertical" | "verticalRay" | "verticalSegment" | "priceLine"
  | "parallelChannel" | "priceChannel" | "regressionChannel" | "pitchfork"
  | "fibRetracement" | "fibExtension" | "fibChannel" | "fibTime"
  | "brush" | "priceLabel" | "textNote" | "callout" | "flag"
  | "longPosition" | "shortPosition" | "rangeMeasure" | "dateMarker" | "crosshairMeasure";
type ToolDefinition = { id: DrawingTool; label: string; icon: Icon; overlay?: string };
type ToolGroup = { id: string; label: string; icon: Icon; tools: ToolDefinition[] };
type AutoTrendKind = "support" | "resistance";
type AutoTrend = {
  kind: AutoTrendKind;
  start: Bar;
  end: Bar;
  touches: number;
  confidence: number;
  direction: "rising" | "falling" | "flat";
};

const symbols: Record<SymbolKey, { name: string; seed: number; start: number; drift: number }> = {
  NVDA: { name: "NVIDIA Corporation", seed: 17, start: 118, drift: .0031 },
  MRNA: { name: "Moderna, Inc.", seed: 41, start: 92, drift: .0015 },
  CRCL: { name: "Circle Internet Group", seed: 73, start: 63, drift: .0042 },
};

const cursorTool: ToolDefinition = { id: "cursor", label: "Cursor", icon: Cursor };
const toolGroups: ToolGroup[] = [
  { id: "trend", label: "Trend tools", icon: TrendUp, tools: [
    { id: "trend", label: "Trend line", icon: TrendUp, overlay: "straightLine" },
    { id: "ray", label: "Ray", icon: ArrowUpRight, overlay: "rayLine" },
    { id: "segment", label: "Line segment", icon: LineSegment, overlay: "segment" },
    { id: "extended", label: "Extended line", icon: ArrowsOutLineHorizontal, overlay: "straightLine" },
    { id: "arrow", label: "Arrow", icon: Path, overlay: "rayLine" },
  ] },
  { id: "levels", label: "Level tools", icon: Minus, tools: [
    { id: "horizontal", label: "Horizontal line", icon: Minus, overlay: "horizontalStraightLine" },
    { id: "horizontalRay", label: "Horizontal ray", icon: ArrowUpRight, overlay: "horizontalRayLine" },
    { id: "horizontalSegment", label: "Horizontal segment", icon: LineSegment, overlay: "horizontalSegment" },
    { id: "vertical", label: "Vertical line", icon: ArrowsVertical, overlay: "verticalStraightLine" },
    { id: "verticalRay", label: "Vertical ray", icon: ArrowsVertical, overlay: "verticalRayLine" },
    { id: "verticalSegment", label: "Vertical segment", icon: Rows, overlay: "verticalSegment" },
    { id: "priceLine", label: "Price line", icon: CrosshairIcon, overlay: "priceLine" },
  ] },
  { id: "channels", label: "Channel tools", icon: Rows, tools: [
    { id: "parallelChannel", label: "Parallel channel", icon: Rows, overlay: "parallelStraightLine" },
    { id: "priceChannel", label: "Price channel", icon: Rectangle, overlay: "priceChannelLine" },
    { id: "regressionChannel", label: "Regression channel", icon: ChartLine, overlay: "parallelStraightLine" },
    { id: "pitchfork", label: "Pitchfork", icon: Strategy, overlay: "priceChannelLine" },
  ] },
  { id: "fibonacci", label: "Fibonacci tools", icon: FunctionIcon, tools: [
    { id: "fibRetracement", label: "Fib retracement", icon: FunctionIcon, overlay: "fibonacciLine" },
    { id: "fibExtension", label: "Fib extension", icon: ChartLineUp, overlay: "fibonacciLine" },
    { id: "fibChannel", label: "Fib channel", icon: WaveSine, overlay: "fibonacciLine" },
    { id: "fibTime", label: "Fib time zones", icon: CalendarDots, overlay: "verticalSegment" },
  ] },
  { id: "annotation", label: "Annotation tools", icon: PencilSimple, tools: [
    { id: "brush", label: "Brush", icon: PencilSimple, overlay: "brush" },
    { id: "priceLabel", label: "Price label", icon: Tag, overlay: "simpleTag" },
    { id: "textNote", label: "Text note", icon: TextT, overlay: "simpleAnnotation" },
    { id: "callout", label: "Callout", icon: NotePencil, overlay: "simpleAnnotation" },
    { id: "flag", label: "Flag marker", icon: Flag, overlay: "simpleTag" },
  ] },
  { id: "measure", label: "Position and measure", icon: Ruler, tools: [
    { id: "longPosition", label: "Long position", icon: ChartLineUp, overlay: "priceChannelLine" },
    { id: "shortPosition", label: "Short position", icon: ChartLineDown, overlay: "priceChannelLine" },
    { id: "rangeMeasure", label: "Price range", icon: Ruler, overlay: "priceChannelLine" },
    { id: "dateMarker", label: "Date marker", icon: CalendarDots, overlay: "verticalStraightLine" },
    { id: "crosshairMeasure", label: "Crosshair measure", icon: Selection, overlay: "parallelStraightLine" },
  ] },
];
const drawingTools = [cursorTool, ...toolGroups.flatMap((group) => group.tools)];

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeBars(config: typeof symbols[SymbolKey]): Bar[] {
  const random = seeded(config.seed);
  const date = new Date("2025-09-15T12:00:00Z");
  const end = new Date("2026-09-03T12:00:00Z");
  const rows: Bar[] = [];
  let close = config.start;
  let index = 0;

  while (date <= end) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      const cycle = Math.sin(index / 17) * .006 + Math.sin(index / 43) * .004;
      const shock = index === 92 ? .11 : index === 164 ? .075 : index === 205 ? -.065 : 0;
      const change = config.drift + cycle + (random() - .5) * .034 + shock;
      const open = close * (1 + (random() - .5) * .012);
      close = Math.max(8, open * (1 + change));
      const high = Math.max(open, close) * (1 + random() * .018);
      const low = Math.min(open, close) * (1 - random() * .018);
      const eventBoost = shock ? 4.4 : 1;
      const volume = Math.round((28_000_000 + random() * 44_000_000) * eventBoost);
      rows.push({
        timestamp: date.getTime(),
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume,
      });
      index += 1;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return rows;
}

function movingAverage(rows: Bar[], period: number) {
  return rows.flatMap((bar, index) => {
    if (index < period - 1) return [];
    const value = rows.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period;
    return [{ timestamp: bar.timestamp, value }];
  });
}

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

function rangeSize(range: RangeKey) {
  return range === "1M" ? 22 : range === "3M" ? 66 : range === "6M" ? 132 : range === "1Y" ? 252 : 9999;
}

function formatVolume(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function SampleChartFallback({ rows }: { rows: Bar[] }) {
  const width = 1200;
  const height = 700;
  const plotTop = 58;
  const plotBottom = 585;
  const volumeBottom = 678;
  const maxPrice = Math.max(...rows.map((bar) => bar.high)) * 1.035;
  const minPrice = Math.min(...rows.map((bar) => bar.low)) * .965;
  const maxVolume = Math.max(...rows.map((bar) => bar.volume));
  const x = (index: number) => 22 + (index / Math.max(rows.length - 1, 1)) * 1092;
  const y = (price: number) => plotTop + ((maxPrice - price) / (maxPrice - minPrice)) * (plotBottom - plotTop);
  const maPath = (period: number) => movingAverage(rows, period).map((point, index) => {
    const sourceIndex = index + period - 1;
    return `${index ? "L" : "M"}${x(sourceIndex).toFixed(1)},${y(point.value).toFixed(1)}`;
  }).join(" ");

  return <svg className="chart-fallback" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {[.15, .35, .55, .75, .95].map((ratio) => <line key={ratio} x1="0" x2="1200" y1={plotTop + ratio * (plotBottom - plotTop)} y2={plotTop + ratio * (plotBottom - plotTop)} className="fallback-grid"/>)}
    {[.12, .32, .52, .72, .92].map((ratio) => <line key={ratio} y1="0" y2="700" x1={ratio * 1115} x2={ratio * 1115} className="fallback-grid"/>)}
    <path d={maPath(20)} className="fallback-ma fallback-ma20"/>
    <path d={maPath(50)} className="fallback-ma fallback-ma50"/>
    {rows.length >= 200 && <path d={maPath(200)} className="fallback-ma fallback-ma200"/>}
    {rows.map((bar, index) => {
      const posX = x(index);
      const up = bar.close >= bar.open;
      const candleWidth = Math.max(2.2, Math.min(5.5, 690 / rows.length));
      const bodyTop = y(Math.max(bar.open, bar.close));
      const bodyHeight = Math.max(1.7, Math.abs(y(bar.open) - y(bar.close)));
      const volumeHeight = (bar.volume / maxVolume) * 78;
      return <g key={bar.timestamp} className={up ? "fallback-up" : "fallback-down"}>
        <line x1={posX} x2={posX} y1={y(bar.high)} y2={y(bar.low)} className="fallback-wick"/>
        <rect x={posX - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx=".4" className="fallback-body"/>
        <rect x={posX - candleWidth / 2} y={volumeBottom - volumeHeight} width={candleWidth} height={volumeHeight} className="fallback-volume"/>
      </g>;
    })}
    {[0, 1, 2, 3, 4].map((tick) => {
      const price = maxPrice - (tick / 4) * (maxPrice - minPrice);
      return <text key={tick} x="1127" y={y(price) + 3} className="fallback-axis">{price.toFixed(0)}</text>;
    })}
    {rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 5)) === 0).map((bar, index) => <text key={bar.timestamp} x={x(index * Math.max(1, Math.floor(rows.length / 5)))} y="696" className="fallback-date">{formatDate(bar.timestamp).slice(5)}</text>)}
  </svg>;
}

export function ChartDashboard({ onExit }: { onExit?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [symbol, setSymbol] = useState<SymbolKey>("NVDA");
  const [range, setRange] = useState<RangeKey>("6M");
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [openToolGroup, setOpenToolGroup] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [autoTrend, setAutoTrend] = useState(false);
  const [theme, setTheme] = useState<ChartTheme>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const allBars = useMemo(() => makeBars(symbols[symbol]), [symbol]);
  const bars = useMemo(() => allBars.slice(-rangeSize(range)), [allBars, range]);
  const autoTrends = useMemo(() => findAutoTrends(bars), [bars]);
  const latest = bars.at(-1)!;
  const [hovered, setHovered] = useState<Bar>(latest);

  useEffect(() => setHovered(latest), [latest]);

  useEffect(() => {
    const saved = window.localStorage.getItem("brontide-chart-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    setThemeLoaded(true);
  }, []);

  useEffect(() => {
    if (themeLoaded) window.localStorage.setItem("brontide-chart-theme", theme);
  }, [theme, themeLoaded]);

  useEffect(() => {
    if (!containerRef.current) return;
    setChartReady(false);
    let cancelled = false;
    let disposeChart: (() => void) | undefined;
    const palette = theme === "light" ? {
      grid: "#e5e9e6", axis: "#d5dcd7", axisText: "#6f7a73", crosshair: "#7b8980", crosshairLabel: "#48564d",
      up: "#13945a", down: "#d94b55", neutral: "#7c8881", volumeUp: "#16905a8f", volumeDown: "#c9434d83", separator: "#d8dfda",
    } : {
      grid: "#202630", axis: "#222a35", axisText: "#697582", crosshair: "#7b8796", crosshairLabel: "#26303b",
      up: "#38c985", down: "#df4b53", neutral: "#8b95a1", volumeUp: "#197b55aa", volumeDown: "#8f3038aa", separator: "#222a35",
    };

    void import("klinecharts").then(({ dispose, init }) => {
      if (cancelled || !containerRef.current) return;
      const chart = init(containerRef.current, {
        timezone: "Etc/UTC",
        layout: { barSpaceLimit: { min: 2.5, max: 28 }, yAxis: { position: "right", inside: false, gap: { top: .08, bottom: .04 } } },
        styles: {
          grid: { horizontal: { color: palette.grid, style: "dashed", dashedValue: [2, 4] }, vertical: { color: palette.grid, style: "dashed", dashedValue: [2, 4] } },
          candle: {
            type: "candle_solid",
            bar: { compareRule: "current_open", upColor: palette.up, downColor: palette.down, noChangeColor: palette.neutral, upBorderColor: palette.up, downBorderColor: palette.down, noChangeBorderColor: palette.neutral, upWickColor: palette.up, downWickColor: palette.down, noChangeWickColor: palette.neutral },
            priceMark: { high: { show: false }, low: { show: false }, last: { line: { style: "dashed", dashedValue: [4, 4] } } },
            tooltip: { showRule: "none" },
          },
          indicator: { tooltip: { showRule: "none" } },
          xAxis: { axisLine: { color: palette.axis }, tickLine: { color: palette.axis }, tickText: { color: palette.axisText, family: "Inter, ui-sans-serif, system-ui", size: 9 } },
          yAxis: { axisLine: { color: palette.axis }, tickLine: { color: palette.axis }, tickText: { color: palette.axisText, family: "Inter, ui-sans-serif, system-ui", size: 9 } },
          crosshair: { horizontal: { line: { color: palette.crosshair, style: "dashed", dashedValue: [4, 4] }, text: { backgroundColor: "#148c50" } }, vertical: { line: { color: palette.crosshair, style: "dashed", dashedValue: [4, 4] }, text: { backgroundColor: palette.crosshairLabel } } },
          separator: { color: palette.separator, activeBackgroundColor: palette.axis },
        },
      });
      if (!chart) return;
      chart.overrideYAxis({ paneId: "candle_pane", name: logScale ? "logarithm" : "normal" });
      chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod({ span: 1, type: "day" });
      chart.setDataLoader({ getBars: ({ callback }) => callback(bars) });
      const applyDefaultViewport = () => {
        const chartWidth = containerRef.current?.clientWidth ?? 1200;
        const rightSpace = Math.round(chartWidth * .2);
        const usableWidth = Math.max(260, chartWidth - rightSpace - 58);
        const fittedBarSpace = Math.max(2.5, Math.min(48, usableWidth / Math.max(bars.length, 1)));
        chart.setBarSpace(Number(fittedBarSpace.toFixed(2)));
        chart.setOffsetRightDistance(rightSpace);
      };
      applyDefaultViewport();
      const resizeObserver = new ResizeObserver(applyDefaultViewport);
      resizeObserver.observe(containerRef.current);
      chart.createIndicator({ name: "VOL", paneId: "volume_pane", styles: { bars: [{ upColor: palette.volumeUp, downColor: palette.volumeDown, noChangeColor: palette.neutral }] } });
      chart.setPaneOptions({ id: "volume_pane", height: 92, minHeight: 58, dragEnabled: true, order: 20 });
      const averages = [[20, "#875fd2", show20], [50, "#4169ca", show50], [200, "#ba7641", show200]] as const;
      const visibleAverages = averages.filter(([, , visible]) => visible);
      if (visibleAverages.length) chart.createIndicator({
        name: "MA",
        paneId: "candle_pane",
        calcParams: visibleAverages.map(([period]) => period),
        styles: { lines: visibleAverages.map(([, color]) => ({ color, size: 1, style: "dashed", dashedValue: [5, 4] })), tooltip: { showRule: "none" } },
      });
      const crosshairHandler = (data?: unknown) => {
        const point = data as Crosshair | undefined;
        if (point?.kLineData) setHovered(point.kLineData as Bar);
      };
      chart.subscribeAction("onCrosshairChange", crosshairHandler);
      chartRef.current = chart;
      setChartReady(true);
      disposeChart = () => {
        resizeObserver.disconnect();
        chart.unsubscribeAction("onCrosshairChange", crosshairHandler);
        dispose(containerRef.current!);
      };
    });
    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
      setChartReady(false);
    };
  }, [bars, range, show20, show50, show200, symbol, logScale, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    chart.removeOverlay({ groupId: "brontide-auto-trends" });
    if (!autoTrend) return;
    const colors: Record<AutoTrendKind, string> = theme === "light"
      ? { resistance: "#d04b55", support: "#0b8f54" }
      : { resistance: "#ef6a72", support: "#38c985" };
    for (const trend of autoTrends) {
      chart.createOverlay({
        name: "rayLine",
        groupId: "brontide-auto-trends",
        lock: true,
        zLevel: 6,
        needDefaultPointFigure: false,
        needDefaultXAxisFigure: false,
        needDefaultYAxisFigure: false,
        points: [
          { timestamp: trend.start.timestamp, value: trend.kind === "resistance" ? trend.start.high : trend.start.low },
          { timestamp: trend.end.timestamp, value: trend.kind === "resistance" ? trend.end.high : trend.end.low },
        ],
        styles: { line: { color: colors[trend.kind], size: 1.35, style: "solid", dashedValue: [5, 4] } },
      });
    }
  }, [autoTrend, autoTrends, chartReady, theme]);

  const clearDrawings = () => {
    chartRef.current?.removeOverlay();
    setAutoTrend(false);
  };

  const selectTool = (tool: DrawingTool) => {
    setActiveTool(tool);
    setOpenToolGroup(null);
    const overlay = drawingTools.find((item) => item.id === tool)?.overlay;
    if (overlay) chartRef.current?.createOverlay({ name: overlay, groupId: "brontide-drawings" });
  };

  return (
    <section className={`chart-dashboard theme-${theme}`}>
      <header className="chart-commandbar">
        <div className="chart-sequence"><button aria-label="Back" onClick={onExit}>‹</button><button className="chart-stage">EP contractions⌄</button><button aria-label="Previous">‹</button><span>1 of 14</span><button aria-label="Next">›</button></div>
        <label className="chart-symbol-select"><span>{symbols[symbol].name}</span><b>{symbol}</b><select value={symbol} onChange={(event) => setSymbol(event.target.value as SymbolKey)} aria-label="Stock"><option value="NVDA">NVIDIA Corporation</option><option value="MRNA">Moderna, Inc.</option><option value="CRCL">Circle Internet Group</option></select></label>
        <div className="chart-header-actions"><button className={`auto-trend-toggle ${autoTrend ? "active" : ""}`} onClick={() => setAutoTrend((value) => !value)} aria-pressed={autoTrend} title="Detect recent support and resistance"><TrendUp size={14}/><span>Auto Trend</span></button><span className="chart-data-state"><i/> Sample data</span><button className="chart-accent">Analyze setup</button><button className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "Dark" : "Light"}</span></button></div>
      </header>

      <div className="chart-subbar">
        <div className="chart-ranges">{(["1M", "3M", "6M", "1Y", "Max"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}<button className="chart-select-button">Daily⌄</button></div>
        <div className="chart-display-controls"><details><summary>Indicators</summary><div className="indicator-popover"><label><input type="checkbox" checked={show20} onChange={(e) => setShow20(e.target.checked)}/>20 SMA</label><label><input type="checkbox" checked={show50} onChange={(e) => setShow50(e.target.checked)}/>50 SMA</label><label><input type="checkbox" checked={show200} onChange={(e) => setShow200(e.target.checked)}/>200 SMA</label></div></details><span>SCALE</span><button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>Lin</button><button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>Log</button><div className="chart-viewport-controls" role="group" aria-label="Chart viewport"><button onClick={() => chartRef.current?.zoomAtCoordinate(.8, undefined, 120)} aria-label="Zoom out" title="Zoom out">−</button><button onClick={() => chartRef.current?.zoomAtCoordinate(1.25, undefined, 120)} aria-label="Zoom in" title="Zoom in">+</button><button onClick={() => chartRef.current?.scrollByDistance(-120, 160)} aria-label="Move backward" title="Move backward">‹</button><button onClick={() => chartRef.current?.scrollToRealTime(180)} aria-label="Move to latest" title="Move to latest">Latest</button></div></div>
      </div>

      <div className="chart-stage-area">
        <aside className="drawing-rail" aria-label="Drawing tools">
          <button className={activeTool === "cursor" ? "active" : ""} title="Cursor" aria-label="Cursor" onClick={() => selectTool("cursor")}><Cursor size={17}/></button>
          {toolGroups.map((group) => {
            const GroupIcon = group.icon;
            const groupActive = group.tools.some((tool) => tool.id === activeTool);
            const isOpen = openToolGroup === group.id;
            return <div className="drawing-tool-group" key={group.id}>
              <button className={groupActive ? "active" : ""} title={group.label} aria-label={group.label} aria-expanded={isOpen} onClick={() => setOpenToolGroup(isOpen ? null : group.id)}><GroupIcon size={17}/><CaretRight className="drawing-group-caret" size={8}/></button>
              {isOpen && <div className="drawing-tool-menu" role="menu" aria-label={group.label}><div className="drawing-tool-menu-title"><span>{group.label}</span><small>{group.tools.length} tools</small></div>{group.tools.map((tool) => { const ToolIcon = tool.icon; return <button role="menuitem" key={tool.id} className={activeTool === tool.id ? "active" : ""} onClick={() => selectTool(tool.id)}><ToolIcon size={15}/><span>{tool.label}</span></button>; })}</div>}
            </div>;
          })}
          <button className="drawing-clear" aria-label="Clear drawings" title="Clear drawings" onClick={clearDrawings}><Trash size={16}/></button>
        </aside>

        <div className="chart-canvas-shell">
          <div className="chart-ohlc"><span>{formatDate(hovered.timestamp)}</span><span>O <b>{hovered.open.toFixed(2)}</b></span><span>H <b>{hovered.high.toFixed(2)}</b></span><span>L <b>{hovered.low.toFixed(2)}</b></span><span>C <b>{hovered.close.toFixed(2)}</b></span><strong className={hovered.close >= hovered.open ? "up" : "down"}>{((hovered.close / hovered.open - 1) * 100).toFixed(2)}%</strong><span>Vol <b>{formatVolume(hovered.volume)}</b></span></div>
          <div className="chart-legend">{show20 && <span className="ma20">MA20: {movingAverage(bars, 20).at(-1)?.value.toFixed(2) ?? "—"}</span>}{show50 && <span className="ma50">MA50: {movingAverage(bars, 50).at(-1)?.value.toFixed(2) ?? "—"}</span>}{show200 && <span className="ma200">MA200: {movingAverage(bars, 200).at(-1)?.value.toFixed(2) ?? "—"}</span>}{autoTrend && autoTrends.map((trend) => <span key={trend.kind} className={`auto-trend-legend ${trend.kind}`}>{trend.kind === "resistance" ? "R" : "S"}: {trend.touches} touches · {trend.confidence}%</span>)}</div>
          {!chartReady && <SampleChartFallback rows={bars}/>}<div ref={containerRef} className={`market-chart ${chartReady ? "ready" : ""}`}/>
          {activeTool === "horizontal" && <p className="drawing-hint">Click the chart to place a price level</p>}
        </div>
      </div>

      <footer className="chart-footer"><span>Daily candles</span><span>Volume</span><strong>KLineChart · Open-source rendering</strong></footer>
    </section>
  );
}
