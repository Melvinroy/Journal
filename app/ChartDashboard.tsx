"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart, Crosshair, KLineData } from "klinecharts";
import {
  ArrowUpRight, ArrowsOutLineHorizontal, ArrowsVertical, CalendarDots, CaretRight, ChartLine,
  ChartLineDown, ChartLineUp, Crosshair as CrosshairIcon, Cursor, Flag, Function as FunctionIcon, LineSegment,
  Minus, NotePencil, Path, PencilSimple, Rectangle, Rows, Ruler, Selection, Strategy, Tag, TextT,
  Trash, TrendUp, WaveSine, type Icon,
} from "@phosphor-icons/react";

import { getLocalJson, toChartBars, type ChartResponse, type Instrument } from "../lib/chart-data";
import { Watchlist } from "./Watchlist";
import { chartStorageKey, movingAverageByTime, readStored, writeStored, type MarketContext } from "../lib/workspace-state";
import { findAutoTrends, projectTrendPoints, restoreTrendPoints, EMPTY_TRENDS, validTrendSettings, AUTO_TREND_VERSION } from "../lib/auto-trendlines";
import { useBrowserStore } from "../lib/use-browser-store";
import { extraOverlays } from "../lib/chart-overlays";

const localBuild = process.env.NEXT_PUBLIC_BRONTIDE_LOCAL === "1";

type Bar = KLineData & { volume: number };
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "Max";
type SymbolKey = "NVDA" | "MRNA" | "CRCL";
type ChartTheme = "light" | "dark";
type DrawingTool =
  | "box" | "ellipse"
  | "cursor" | "trend" | "ray" | "segment" | "extended" | "arrow"
  | "horizontal" | "horizontalRay" | "horizontalSegment" | "vertical" | "verticalRay" | "verticalSegment" | "priceLine"
  | "parallelChannel" | "priceChannel" | "regressionChannel" | "pitchfork"
  | "fibRetracement" | "fibExtension" | "fibChannel" | "fibTime"
  | "brush" | "priceLabel" | "textNote" | "callout" | "flag"
  | "longPosition" | "shortPosition" | "rangeMeasure" | "dateMarker" | "crosshairMeasure";
type ToolDefinition = { id: DrawingTool; label: string; icon: Icon; overlay?: string };
type ToolGroup = { id: string; label: string; icon: Icon; tools: ToolDefinition[] };
const symbols: Record<SymbolKey, { name: string; seed: number; start: number; drift: number }> = {
  NVDA: { name: "NVIDIA Corporation", seed: 17, start: 118, drift: .0031 },
  MRNA: { name: "Moderna, Inc.", seed: 41, start: 92, drift: .0015 },
  CRCL: { name: "Circle Internet Group", seed: 73, start: 63, drift: .0042 },
};

const cursorTool: ToolDefinition = { id: "cursor", label: "Cursor", icon: Cursor };
const toolGroups: ToolGroup[] = [
  { id: "trend", label: "Trend tools", icon: TrendUp, tools: [
    { id: "trend", label: "Extended line", icon: TrendUp, overlay: "straightLine" },
    { id: "ray", label: "Ray", icon: ArrowUpRight, overlay: "rayLine" },
    { id: "segment", label: "Line segment", icon: LineSegment, overlay: "segment" },
    { id: "arrow", label: "Arrow", icon: Path, overlay: "brontide-arrow" },
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
    { id: "box", label: "Rectangle", icon: Rectangle, overlay: "brontide-box" },
    { id: "ellipse", label: "Ellipse", icon: WaveSine, overlay: "brontide-ellipse" },
  ] },
  { id: "fibonacci", label: "Fibonacci tools", icon: FunctionIcon, tools: [
    { id: "fibRetracement", label: "Fib retracement", icon: FunctionIcon, overlay: "fibonacciLine" },
  ] },
  { id: "annotation", label: "Annotation tools", icon: PencilSimple, tools: [
    { id: "brush", label: "Brush", icon: PencilSimple, overlay: "brush" },
    { id: "priceLabel", label: "Price label", icon: Tag, overlay: "simpleTag" },
    { id: "textNote", label: "Text note", icon: TextT, overlay: "simpleAnnotation" },
  ] },
  { id: "measure", label: "Position and measure", icon: Ruler, tools: [
    { id: "rangeMeasure", label: "Price / percentage range", icon: Ruler, overlay: "brontide-measure" },
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
  const x = (index: number) => 22 + (index / Math.max(rows.length - 1, 1)) * 860;
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

export function ChartDashboard({ onExit, context, onPlan }: { onExit?: () => void; context?: MarketContext; onPlan?: (context:MarketContext)=>void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [symbol, setSymbol] = useState<string>("NVDA");
  const [range, setRange] = useState<RangeKey>("6M");
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [openToolGroup, setOpenToolGroup] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [theme, setTheme] = useState<ChartTheme>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [chartGeneration, setChartGeneration] = useState(0);
  const [mode, setMode] = useState<"local" | "sample">(localBuild ? "local" : "sample");
  const [adjustment, setAdjustment] = useState("all");
  const [payload, setPayload] = useState<ChartResponse | null>(null);
  const [localBars, setLocalBars] = useState<Bar[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<Instrument[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [storageError, setStorageError] = useState("");
  const drawingsWritable = useRef(false);
  const [note, setNote] = useState("Note");
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(context?.asOf);
  const sampleSymbol = (symbol in symbols ? symbol : "NVDA") as SymbolKey;
  const sampleBars = useMemo(() => makeBars(symbols[sampleSymbol]), [sampleSymbol]);
  const sourceBars = mode === "sample" ? sampleBars : localBars;
  const allBars = useMemo(()=>asOf ? sourceBars.filter(row=>new Date(row.timestamp).toISOString().slice(0,10)<=asOf) : sourceBars,[sourceBars,asOf]);
  const bars = useMemo(() => allBars.slice(-rangeSize(range)), [allBars, range]);
  const latestAverages = useMemo(() => Object.fromEntries([20, 50, 200].map((period) => [period,
    allBars.length >= period ? allBars.slice(-period).reduce((total, bar) => total + bar.close, 0) / period : undefined,
  ])), [allBars]);
  const trendStore = useBrowserStore(`brontide-auto:${AUTO_TREND_VERSION}:${mode}:${symbol}:${adjustment}:${logScale?"log":"linear"}:${asOf??"latest"}`, EMPTY_TRENDS, validTrendSettings);
  const autoTrend = trendStore.ready && trendStore.value.enabled;
  const trendResult = useMemo(() => {
    try { return {lines:findAutoTrends(allBars,{logarithmic:logScale}),error:""}; }
    catch { return {lines:[],error:"Auto Trend cannot analyze these bars. Check the data source."}; }
  }, [allBars,logScale]);
  const autoTrends = trendResult.lines;
  const displayedTrends = useMemo(() => {
    const generated = autoTrends.filter(line=>!(line.id in trendStore.value.edits)).map(line=>({...line,edited:false}));
    const edited = Object.entries(trendStore.value.edits).flatMap(([id,points])=>points ? [{
      id,kind:id.includes(":resistance:")?"resistance" as const:"support" as const,points,edited:true,
      touches:0,violations:0,fitATR:0,evaluatedAt:0,latestTouch:0,
    }] : []);
    return [...generated,...edited];
  },[autoTrends,trendStore.value]);
  // Overlay callbacks read the current store rather than a stale render closure.
  const trendStoreRef = useRef(trendStore);
  trendStoreRef.current = trendStore;
  const latest = bars.at(-1);
  const [hovered, setHovered] = useState<Bar | undefined>(latest);
  const [renderError, setRenderError] = useState(false);
  const name = mode === "sample" ? symbols[sampleSymbol].name : payload?.instrument.name ?? symbol;
  const statusLabel = mode === "sample" ? "Simulated prices" : loadState === "loading" ? "Loading EOD" : loadState === "error" ? "API error" : loadState === "empty" ? "No bars" : payload?.status.freshness === "stale" ? "Stale EOD" : payload?.status.freshness === "unknown" ? "EOD · check freshness" : "Local EOD";

  useEffect(() => setHovered(latest), [latest]);

  useEffect(() => {
    try {
      const saved=readStored<{symbol?:string;range?:RangeKey;show20?:boolean;show50?:boolean;show200?:boolean;logScale?:boolean;adjustment?:string}>(window.localStorage,"brontide-layout-v1",{});
      if (saved.symbol && (localBuild || saved.symbol in symbols)) setSymbol(saved.symbol);
      if (saved.range && ["1M","3M","6M","1Y","Max"].includes(saved.range)) setRange(saved.range);
      if (typeof saved.show20==="boolean") setShow20(saved.show20);
      if (typeof saved.show50==="boolean") setShow50(saved.show50);
      if (typeof saved.show200==="boolean") setShow200(saved.show200);
      if (typeof saved.logScale==="boolean") setLogScale(saved.logScale);
      if (["all","raw"].includes(saved.adjustment??"")) setAdjustment(saved.adjustment!);
      setLayoutReady(true);
    } catch { setStorageError("Saved layout could not be read. It has not been overwritten."); }
  },[]);
  useEffect(()=>{
    if (!context) return;
    if (context.mode==="local" && !localBuild) {setStorageError("This instrument context requires the local service.");return;}
    if (context.mode==="sample" && !(context.symbol in symbols)) {setStorageError("No simulated chart exists for this ticker. Open local mode for real bars.");return;}
    setSymbol(context.symbol);setMode(context.mode);setAdjustment(context.adjustment);setAsOf(context.asOf);
  },[context]);
  useEffect(()=>{
    if (!layoutReady) return;
    try {writeStored(window.localStorage,"brontide-layout-v1",{symbol,range,show20,show50,show200,logScale,adjustment});}
    catch {setStorageError("Layout could not be saved. Browser storage may be full.");}
  },[symbol,range,show20,show50,show200,logScale,adjustment,layoutReady]);

  useEffect(() => {
    if (mode !== "local") return;
    const controller = new AbortController();
    let expired = false;
    const timeout = setTimeout(() => { expired = true; controller.abort(); }, 15000);
    setLoadState("loading"); setLocalBars([]); setPayload(null); setError("");
    getLocalJson<ChartResponse>(`/v1/chart/${encodeURIComponent(symbol)}?limit=5000&adjustment=${adjustment}`, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const rows = toChartBars(result);
        setPayload(result); setLocalBars(rows); setLoadState(rows.length ? "ready" : "empty");
      }).catch((cause: unknown) => {
        if (controller.signal.aborted && !expired) return;
        setError(expired ? "Local API timed out. Retry when the service is ready." : cause instanceof Error ? cause.message : "Could not reach the local API.");
        setLoadState("error");
      }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [mode, symbol, adjustment, retry]);

  useEffect(() => {
    if (!searchOpen || mode !== "local") return;
    const controller = new AbortController();
    setMatches([]); setSearchStatus("Searching…");
    const timer = setTimeout(() => {
      getLocalJson<Instrument[]>(`/v1/instruments?q=${encodeURIComponent(query.trim())}&limit=20`, controller.signal)
        .then((items) => { if (!controller.signal.aborted) { setMatches(items); setSearchStatus(items.length ? "" : "No matching instruments"); } })
        .catch(() => { if (!controller.signal.aborted) setSearchStatus("Search unavailable. Check the local API."); }).finally(() => clearTimeout(timeout));
    }, 200);
    const timeout = setTimeout(() => { setSearchStatus("Search timed out. Try again."); controller.abort(); }, 15000);
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, searchOpen, mode]);

  const changeSymbol = (value: string) => {
    setLocalBars([]); setPayload(null); setLoadState("loading"); setHovered(undefined);
    setSymbol(value); setRetry((value) => value + 1); setSearchOpen(false); setQuery("");
  };

  const changeMode = (value: "local" | "sample") => {
    changeSymbol("NVDA"); setMode(value);
  };

  useEffect(() => {
    try { const saved = window.localStorage.getItem("brontide-chart-theme");
    if (saved === "dark" || saved === "light") setTheme(saved); } catch {setStorageError("Theme storage is unavailable.");}
    setThemeLoaded(true);
  }, []);

  useEffect(() => {
    if (themeLoaded) {try {window.localStorage.setItem("brontide-chart-theme", theme);} catch {setStorageError("Theme could not be saved.");}}
  }, [theme, themeLoaded]);

  useEffect(() => {
    if (!containerRef.current || !bars.length) return;
    const chartContainer = containerRef.current;
    setRenderError(false);
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

    void import("klinecharts").then(({ dispose, init, registerOverlay }) => {
      if (cancelled || !containerRef.current) return;
      extraOverlays.forEach(registerOverlay);
      const chart = init(containerRef.current, {
        timezone: "Etc/UTC",
        layout: { barSpaceLimit: { min: .05, max: 1000 }, yAxis: { position: "right", inside: false, gap: { top: .08, bottom: .04 } } },
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
      if (!chart) { setRenderError(true); return; }
      chart.overrideYAxis({ paneId: "candle_pane", name: logScale ? "logarithm" : "normal" });
      chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod({ span: 1, type: "day" });
      chart.setDataLoader({ getBars: ({ type, callback }) => callback(type === "init" ? bars : [], false) });
      const applyDefaultViewport = () => {
        const chartWidth = containerRef.current?.clientWidth ?? 1200;
        const rightSpace = Math.round(Math.max(1, chartWidth - 58) * .2);
        const usableWidth = Math.max(1, chartWidth - rightSpace - 58);
        const fittedBarSpace = Math.max(.05, usableWidth / Math.max(bars.length, 1));
        const rightVisibleBars = Math.ceil(rightSpace / Math.max(fittedBarSpace, .05));
        chart.setRightMinVisibleBarCount(rightVisibleBars);
        chart.setMaxOffsetRightDistance(rightSpace);
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
        calc: data => {
          const values = movingAverageByTime(allBars, visibleAverages.map(([period])=>period));
          return data.map(row=>values.get(row.timestamp) ?? {});
        },
        styles: { lines: visibleAverages.map(([, color]) => ({ color, size: 1, style: "dashed", dashedValue: [5, 4] })), tooltip: { showRule: "none" } },
      });
      const crosshairHandler = (data?: unknown) => {
        const point = data as Crosshair | undefined;
        if (point?.kLineData) setHovered(point.kLineData as Bar);
      };
      chart.subscribeAction("onCrosshairChange", crosshairHandler);
      chartRef.current = chart;
      setSelectedDrawing(null);
      drawingsWritable.current = false;
      try {
        const saved=readStored<import("klinecharts").OverlayCreate[]>(window.localStorage,chartStorageKey({symbol,mode,adjustment}),[]);
        if (!Array.isArray(saved) || saved.some(row=>!row || typeof row.name!=="string" || !Array.isArray(row.points))) throw new Error("Invalid drawings");
        for (const drawing of saved) chart.createOverlay({...drawing,groupId:"brontide-drawings",onSelected:({overlay})=>setSelectedDrawing(overlay.id),onPressedMoveEnd:()=>persistDrawings()});
        drawingsWritable.current = true;
      } catch {setStorageError("Saved drawings could not be restored. Existing storage was retained.");}
      setChartReady(true);
      setChartGeneration(value=>value+1);
      disposeChart = () => {
        resizeObserver.disconnect();
        chart.unsubscribeAction("onCrosshairChange", crosshairHandler);
        dispose(chartContainer);
      };
    }).catch(() => { if (!cancelled) setRenderError(true); });
    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
      setChartReady(false);
    };
  }, [allBars, bars, range, retry, show20, show50, show200, symbol, logScale, theme, mode, adjustment]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    chart.removeOverlay({ groupId: "brontide-auto-trends" });
    if (!autoTrend) return;
    const colors = theme === "light"
      ? { resistance: "#d04b55", support: "#0b8f54" }
      : { resistance: "#ef6a72", support: "#38c985" };
    for (const trend of displayedTrends) {
      let projected;
      try {projected=projectTrendPoints(trend.points,allBars,bars.length);}
      catch {setStorageError("A saved trend anchor is outside loaded history. Load more history or reset auto lines.");continue;}
      chart.createOverlay({
        id:trend.id, name:"rayLine", groupId:"brontide-auto-trends", lock:false, zLevel:6,
        needDefaultPointFigure:true, needDefaultXAxisFigure:false, needDefaultYAxisFigure:false,
        points:projected,
        onSelected:({overlay})=>setSelectedDrawing(overlay.id),
        onRightClick:({preventDefault})=>{
          preventDefault?.();
          const current=trendStoreRef.current;
          if(current.save({...current.value,edits:{...current.value.edits,[trend.id]:null}}))setSelectedDrawing(null);
        },
        onPressedMoveEnd:({overlay})=>{
          const current=trendStoreRef.current;
          try {
            const points=restoreTrendPoints(overlay.points,allBars,bars.length);
            if (!current.save({...current.value,edits:{...current.value.edits,[trend.id]:points}}))
              chart.overrideOverlay({id:trend.id,points:projected});
          } catch {setStorageError("Keep trend anchors in chronological order within loaded sessions and above zero.");chart.overrideOverlay({id:trend.id,points:projected});}
        },
        styles:{line:{color:colors[trend.kind],size:1.5,style:trend.edited?"dashed":"solid",dashedValue:[5,4]}},
      });
    }
  }, [autoTrend, displayedTrends, chartReady, chartGeneration, theme, allBars, bars, logScale]);

  const deleteSelectedDrawing = () => {
    if (!selectedDrawing) return;
    if (selectedDrawing.startsWith(AUTO_TREND_VERSION+":")) {
      if (!trendStore.save({...trendStore.value,edits:{...trendStore.value.edits,[selectedDrawing]:null}})) return;
    } else {
      chartRef.current?.removeOverlay({id:selectedDrawing});
      persistDrawings();
    }
    setSelectedDrawing(null);
  };

  const clearDrawings = () => {
    if (!window.confirm("Remove saved drawings for this instrument and price basis?")) return;
    chartRef.current?.removeOverlay({groupId:"brontide-drawings"});
    persistDrawings();
    trendStore.save({...trendStore.value,enabled:false});
  };

  const persistDrawings = () => {
    if (!drawingsWritable.current) {setStorageError("Saving disabled: saved drawings could not be read safely.");return;}
    const chart=chartRef.current;
    if (!chart) return;
    try {
      const drawings=chart.getOverlays({groupId:"brontide-drawings"}).filter(row=>row.currentStep===-1).map(row=>({name:row.name,id:row.id,points:row.points.map(({timestamp,value})=>({timestamp,value})),extendData:row.extendData,lock:row.lock}));
      writeStored(window.localStorage,chartStorageKey({symbol,mode,adjustment}),drawings);
    } catch {setStorageError("Drawings could not be saved. Keep this view open and retry.");}
  };

  const selectTool = (tool: DrawingTool) => {
    setActiveTool(tool);
    setOpenToolGroup(null);
    const overlay = drawingTools.find((item) => item.id === tool)?.overlay;
    if (overlay) chartRef.current?.createOverlay({ name: overlay, extendData:tool==="textNote"?note:undefined,groupId: "brontide-drawings",onDrawEnd:()=>{persistDrawings();setActiveTool("cursor");},onPressedMoveEnd:()=>persistDrawings(),onSelected:({overlay})=>setSelectedDrawing(overlay.id) });
  };

  return (
    <section className={`chart-dashboard theme-${theme}`}>
      <header className="chart-commandbar">
        <div className="chart-sequence">{onExit && <button aria-label="Back" onClick={onExit}>‹</button>}<span>Chart workspace</span></div>
        {mode === "sample" ? <label className="chart-symbol-select"><span>Demo · {name}</span><b>{sampleSymbol}</b><select value={sampleSymbol} onChange={(event) => changeSymbol(event.target.value)} aria-label="Stock"><option value="NVDA">NVIDIA Corporation</option><option value="MRNA">Moderna, Inc.</option><option value="CRCL">Circle Internet Group</option></select></label> :
          <div className="chart-symbol-search"><button className="chart-search-trigger" onClick={() => setSearchOpen((value) => !value)} aria-expanded={searchOpen} aria-label={`Search stock, selected ${symbol}`}><b>{symbol}</b><span>{name}</span></button>
            {searchOpen && <div className="chart-search-popover" onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }}><label>Find an instrument<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or company" aria-label="Search instruments"/></label><p role="status">{searchStatus}</p>{matches.map((item) => <button key={item.symbol} onClick={() => changeSymbol(item.symbol)}><b>{item.symbol}</b><span>{item.name}</span><small>{item.exchange} · {item.status}</small></button>)}<button onClick={() => setSearchOpen(false)}>Close search</button></div>}
          </div>}
        <div className="chart-header-actions"><button className={`auto-trend-toggle${autoTrend?" active":""}`} aria-label="Auto Trendline" disabled={!chartReady || !trendStore.ready || !!trendResult.error} aria-pressed={autoTrend} title="Confirmed pivots · latest 120 sessions · minimum 3 touches" onClick={()=>trendStore.save({...trendStore.value,enabled:!autoTrend})}><TrendUp size={14}/><span>Auto Trendline</span></button><span className="chart-data-state" role="status"><i/>{statusLabel}</span>{onPlan && <button className="chart-accent" onClick={()=>onPlan({symbol,mode,adjustment,asOf,...(context?.signalId && context.symbol===symbol?{signalId:context.signalId,strategyId:context.strategyId}:{})})}>Create trade plan</button>}<button className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "Dark" : "Light"}</span></button></div>
      </header>

      <div className="chart-sourcebar">
        {localBuild && <label>Data <select aria-label="Data mode" value={mode} onChange={(event) => changeMode(event.target.value as "local" | "sample")}><option value="local">Local EOD</option><option value="sample">Sample demo</option></select></label>}
        {mode === "local" ? <><label>Prices <select aria-label="Price adjustment" value={adjustment} onChange={(event) => { setLocalBars([]); setPayload(null); setLoadState("loading"); setAdjustment(event.target.value); }}><option value="all">All adjusted</option><option value="raw">Raw</option></select></label><span>{payload ? `Alpaca SIP · ${payload.status.last_session ?? "No sessions"}${payload.status.freshness === "stale" ? ` · Missing through ${payload.status.expected_session}` : payload.status.freshness === "unknown" ? " · Calendar coverage needs updating" : ""}` : statusLabel}</span><button onClick={() => setRetry((value) => value + 1)}>Refresh</button></> : <span className="chart-demo-disclosure"><strong>DEMO · SIMULATED PRICES</strong><span>These candles do not represent {sampleSymbol} market history. Real EOD data is available in local mode.</span></span>}
      </div>
      {asOf && <p className="workspace-notice">Historical view through {asOf}. Later bars are hidden. <button onClick={()=>setAsOf(undefined)}>Review later bars</button></p>}
      {trendStore.error && <p className="workspace-notice" role="alert">{trendStore.error}</p>}
      {trendResult.error && <p className="workspace-notice" role="alert">{trendResult.error}</p>}
      {storageError && <p className="workspace-notice" role="alert">{storageError}</p>}
      <div className="chart-sourcebar"><label>Drawing note <input value={note} maxLength={120} onChange={event=>setNote(event.target.value)}/></label><button onClick={persistDrawings} disabled={!chartReady}>Save drawings</button><button disabled={!selectedDrawing} onClick={deleteSelectedDrawing}>Delete selected drawing</button></div>
      {autoTrend && <div className="chart-sourcebar" aria-label="Auto trendline evidence">
        <span>Recent trend · {logScale?"log-price":"linear price"} · 120 sessions</span>
        {displayedTrends.length===0 && <span role="status">No qualifying lines (3 confirmed touches required).</span>}
        {displayedTrends.map(line=><span key={line.id} title={line.edited?"User-edited geometry; original qualification no longer applies.":`Evaluated ${formatDate(line.evaluatedAt)} · mean fit ${line.fitATR.toFixed(2)} ATR`}>
          {line.kind==="support"?"Support":"Resistance"}: {line.edited?"edited":`${line.touches} touches · ${line.violations} violations`}
        </span>)}
        <span>Drag to edit · select a line to delete · edits save automatically</span>
        <button onClick={()=>{if(window.confirm("Reset automatic line edits and deletions for this chart context?")){trendStore.save({enabled:true,edits:{}});setSelectedDrawing(null);}}}>Reset auto lines</button>
      </div>}
      <div className="chart-subbar">
        <div className="chart-ranges">{(["1M", "3M", "6M", "1Y", "Max"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}<span>Daily</span></div>
        <div className="chart-display-controls"><details><summary>Indicators</summary><div className="indicator-popover"><label><input type="checkbox" checked={show20} onChange={(e) => setShow20(e.target.checked)}/>20 SMA</label><label><input type="checkbox" checked={show50} onChange={(e) => setShow50(e.target.checked)}/>50 SMA</label><label><input type="checkbox" checked={show200} onChange={(e) => setShow200(e.target.checked)}/>200 SMA</label></div></details><span>SCALE</span><button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>Lin</button><button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>Log</button><div className="chart-viewport-controls" role="group" aria-label="Chart viewport"><button onClick={() => chartRef.current?.zoomAtCoordinate(.8, undefined, 120)} aria-label="Zoom out" title="Zoom out">−</button><button onClick={() => chartRef.current?.zoomAtCoordinate(1.25, undefined, 120)} aria-label="Zoom in" title="Zoom in">+</button><button onClick={() => chartRef.current?.scrollByDistance(-120, 160)} aria-label="Move backward" title="Move backward">‹</button><button onClick={() => chartRef.current?.scrollToRealTime(180)} aria-label="Move to latest" title="Move to latest">Latest</button></div></div>
      </div>

      <div className="chart-analysis-body"><div className="chart-stage-area">
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
          {mode === "sample" && <span className="chart-demo-watermark" aria-hidden="true">SIMULATED DATA</span>}
          {hovered && <div className="chart-ohlc"><span>{mode === "sample" ? "Demo session · " : ""}{formatDate(hovered.timestamp)}</span><span>O <b>{hovered.open.toFixed(2)}</b></span><span>H <b>{hovered.high.toFixed(2)}</b></span><span>L <b>{hovered.low.toFixed(2)}</b></span><span>C <b>{hovered.close.toFixed(2)}</b></span><strong className={hovered.close >= hovered.open ? "up" : "down"}>{((hovered.close / hovered.open - 1) * 100).toFixed(2)}%</strong><span>Vol <b>{formatVolume(hovered.volume)}</b></span></div>}
          <div className="chart-legend">{show20 && <span className="ma20">MA20: {latestAverages[20]?.toFixed(2) ?? "—"}</span>}{show50 && <span className="ma50">MA50: {latestAverages[50]?.toFixed(2) ?? "—"}</span>}{show200 && <span className="ma200">MA200: {latestAverages[200]?.toFixed(2) ?? "—"}</span>}</div>
          {!chartReady && bars.length > 0 && <SampleChartFallback rows={bars}/>}
          {!bars.length && <div className="chart-message" role={loadState === "error" ? "alert" : "status"}><strong>{loadState === "loading" ? "Loading daily bars…" : loadState === "empty" ? "No stored bars for this price series" : "Local data unavailable"}</strong><p>{loadState === "error" ? error : loadState === "empty" ? "Choose another instrument or price adjustment." : "Reading your local EOD data."}</p>{loadState === "error" && <button onClick={() => setRetry((value) => value + 1)}>Retry</button>}</div>}
          {renderError && <div className="drawing-hint" role="alert">Interactive chart unavailable · Static preview <button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}<div ref={containerRef} className={`market-chart ${chartReady ? "ready" : ""}`}/>
          {activeTool === "horizontal" && <p className="drawing-hint">Click the chart to place a price level</p>}
        </div>
      </div>
      <Watchlist symbol={symbol} onSelect={changeSymbol} sample={mode==="sample"}/></div>
      <footer className="chart-footer"><span>Daily candles</span><span>Volume</span><strong>KLineChart · Open-source rendering</strong></footer>
    </section>
  );
}
