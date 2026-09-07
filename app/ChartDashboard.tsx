"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart, Crosshair, KLineData } from "klinecharts";
import {
  AlignTop, ArrowClockwise, ArrowCounterClockwise, ArrowLineRight, ArrowUpRight, ArrowsOutLineHorizontal,
  ArrowsVertical, CalendarBlank, CalendarDots, CaretRight, ChartLine, ChartLineDown, ChartLineUp,
  ChatCenteredDots, Circle, Cursor, Eraser, Function as FunctionIcon, HighlighterCircle, Info, LineSegment,
  Magnet, MathOperations, Minus, NotePencil, PaintBrush, Parallelogram, Path, Rectangle, Ruler, Stack,
  Star, Strategy, Tag, TextT, type Icon,
} from "@phosphor-icons/react";

import { getLocalJson, toChartBars, type ChartResponse, type Instrument } from "../lib/chart-data";
import { ChartMenu } from "./ChartMenu";
import { ArrowLeft, CaretDown, DotsThree, List, MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import "./chart-workspace.css";
import { chartStorageKey, movingAverageByTime, readStored, writeStored, type MarketContext } from "../lib/workspace-state";
import { findAutoTrends, projectTrendPoints, restoreTrendPoints, EMPTY_TRENDS, validTrendSettings, AUTO_TREND_VERSION } from "../lib/auto-trendlines";
import { useBrowserStore } from "../lib/use-browser-store";
import { findRecentTrends } from "../lib/recent-trendlines";
import { extraOverlays, workflowOverlays } from "../lib/chart-overlays";
import { useDrawingController } from "../lib/use-drawing-controller";
import { DrawingContextToolbar } from "./DrawingContextToolbar";
import { DrawingObjectsPanel } from "./DrawingObjectsPanel";
import {
  DRAWING_GROUPS, DRAWING_TOOL_BY_ID, drawingToolLabelForOverlay, toolsForGroup,
  type DrawingIconKey, type DrawingToolId, type SnapPreference,
} from "../lib/drawing-tools";
import { useDrawingPreferences } from "../lib/use-drawing-preferences";
import { aggregateWeeklyBars, rangeSizeForTimeframe, type ChartTimeframe } from "../lib/chart-timeframe";

const localBuild = process.env.NEXT_PUBLIC_BRONTIDE_LOCAL === "1";
const phase2AutomationVisible = false;

type Bar = KLineData & { volume: number };
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "Max";
type SymbolKey = "NVDA" | "MRNA" | "CRCL";
type ChartTheme = "light" | "dark";
const symbols: Record<SymbolKey, { name: string; seed: number; start: number; drift: number }> = {
  NVDA: { name: "NVIDIA Corporation", seed: 17, start: 118, drift: .0031 },
  MRNA: { name: "Moderna, Inc.", seed: 41, start: 92, drift: .0015 },
  CRCL: { name: "Circle Internet Group", seed: 73, start: 63, drift: .0042 },
};

const DRAWING_ICONS: Record<DrawingIconKey, Icon> = {
  AlignTop, ArrowLineRight, ArrowUpRight, ArrowsOutLineHorizontal, ArrowsVertical, CalendarBlank, CalendarDots,
  ChartLine, ChartLineDown, ChartLineUp, ChatCenteredDots, Circle, Cursor, Eraser, Function: FunctionIcon,
  HighlighterCircle, Info, LineSegment, MathOperations, Minus, NotePencil, PaintBrush, Parallelogram, Path,
  Rectangle, Ruler, Strategy, Tag, TextT,
};

const toolHints: Partial<Record<DrawingToolId, string>> = {
  longRiskReward: "Click entry, stop, then target. Keep stop below entry and target above entry.",
  dateRange: "Click the first and last loaded sessions, from left to right.",
  manualContraction: "Click high 1, low 1, high 2, low 2, high 3, low 3 in date order.",
  anchoredVwap: "Click a session to anchor VWAP through the latest loaded bar.",
  regressionChannel: "Click two sessions at least three bars apart to fit closing prices.",
};

const nextSnapPreference = (value: SnapPreference): SnapPreference => value === "off" ? "weak" : value === "weak" ? "strong" : "off";

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

export function ChartDashboard({ onExit, context, onPlan, navigation }: { onExit?: () => void; context?: MarketContext; onPlan?: (context:MarketContext)=>void; navigation?: {label: string; onSelect: () => void}[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const fitViewportRef = useRef<(() => void) | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<string>("NVDA");
  const [range, setRange] = useState<RangeKey>("6M");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1Day");
  const [activeTool, setActiveTool] = useState<DrawingToolId>("select");
  const [openToolGroup, setOpenToolGroup] = useState<string | null>(null);
  const [mobileDrawOpen, setMobileDrawOpen] = useState(false);
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
  const [note, setNote] = useState("Note");
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([]);
  const [drawingPropertiesOpen, setDrawingPropertiesOpen] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [asOf, setAsOf] = useState<string | undefined>(context?.asOf);
  const sampleSymbol = (symbol in symbols ? symbol : "NVDA") as SymbolKey;
  const sampleBars = useMemo(() => makeBars(symbols[sampleSymbol]), [sampleSymbol]);
  const sourceBars = mode === "sample" ? sampleBars : localBars;
  const allBars = useMemo(()=>asOf ? sourceBars.filter(row=>new Date(row.timestamp).toISOString().slice(0,10)<=asOf) : sourceBars,[sourceBars,asOf]);
  const displayAllBars = useMemo(() => timeframe === "1Day" ? allBars : aggregateWeeklyBars(allBars), [allBars, timeframe]);
  const bars = useMemo(() => displayAllBars.slice(-rangeSizeForTimeframe(range, timeframe)), [displayAllBars, range, timeframe]);
  const drawingPreferences = useDrawingPreferences();
  const drawings = useDrawingController({ chartRef, generation: chartGeneration,
    storageKey: chartStorageKey({ symbol, mode, adjustment }), bars: allBars, displayBars: displayAllBars, visibleCount: bars.length, timeframe,
    snap: drawingPreferences.ready ? drawingPreferences.value.snap : "off", keepDrawing: drawingPreferences.value.keepDrawing, eraserMode: activeTool === "eraser",
    onSelect: id => { setSelectedDrawing(id); setSelectedDrawingIds(id ? [id] : []); if (!id) setDrawingPropertiesOpen(false); },
    onFinish: () => setActiveTool("select"), onContextMenu: () => setDrawingPropertiesOpen(false),
    onProperties: () => setDrawingPropertiesOpen(true) });
  const selectedManual = drawings.drawings.find(row => row.id === selectedDrawing);
  const selectedManuals = selectedDrawingIds.map(id => drawings.drawings.find(row => row.id === id)).filter((row): row is NonNullable<typeof row> => !!row);
  const drawingContextPosition = (() => {
    const chart = chartRef.current, width = containerRef.current?.clientWidth ?? 900;
    if (!chart || !selectedManuals.length) return undefined;
    const coordinates = selectedManuals.flatMap(row => chart.convertToPixel(row.points, { paneId: "candle_pane" }) as Array<{ x?: number; y?: number }>).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!coordinates.length) return undefined;
    const left = Math.max(220, Math.min(width - 220, coordinates.reduce((sum, point) => sum + point.x!, 0) / coordinates.length));
    const topAnchor = Math.min(...coordinates.map(point => point.y!)), bottomAnchor = Math.max(...coordinates.map(point => point.y!));
    return { left, top: topAnchor > 86 ? topAnchor - 48 : bottomAnchor + 18 };
  })();
  const drawingLabel = drawingToolLabelForOverlay;
  const latestAverages = useMemo(() => Object.fromEntries([20, 50, 200].map((period) => [period,
    displayAllBars.length >= period ? displayAllBars.slice(-period).reduce((total, bar) => total + bar.close, 0) / period : undefined,
  ])), [displayAllBars]);
  const trendStore = useBrowserStore(`brontide-auto:${AUTO_TREND_VERSION}:${mode}:${symbol}:${adjustment}:${logScale?"log":"linear"}:${asOf??"latest"}`, EMPTY_TRENDS, validTrendSettings);
  const recentStore=useBrowserStore(`brontide-recent-v1:${mode}:${symbol}:${adjustment}:${logScale?"log":"linear"}:${asOf??"latest"}`,false,value=>typeof value==="boolean");
  const recentResult=useMemo(()=>{try{return {lines:findRecentTrends(allBars,logScale),error:""};}catch{return {lines:[],error:"Recent Trend cannot analyze these bars."};}},[allBars,logScale]);
  // Phase 2 preserves automation settings but does not present or render these unvalidated controls.
  const autoTrend = phase2AutomationVisible && trendStore.ready && trendStore.value.enabled;
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
  const issues = [storageError, drawings.error, drawingPreferences.error].filter(Boolean);
  const previousClose = displayAllBars.at(-2)?.close;
  const dailyChange = latest && previousClose ? (latest.close / previousClose - 1) * 100 : undefined;
  const menuProps = (id: string) => ({ open: openMenu === id, onToggle: () => { setSearchOpen(false); setOpenToolGroup(null); setOpenMenu(value => value === id ? null : id); }, onClose: () => setOpenMenu(value => value === id ? null : value) });

  useEffect(() => {
    if (!selectedDrawing) setOpenMenu(value => value === "drawing" ? null : value);
  }, [selectedDrawing]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (searchOpen) { setSearchOpen(false); document.querySelector<HTMLButtonElement>(".chart-search-trigger")?.focus(); }
      if (openToolGroup) { document.querySelector<HTMLButtonElement>(`.drawing-tool-group button[aria-expanded="true"]`)?.focus(); setOpenToolGroup(null); }
      else if (mobileDrawOpen) { setMobileDrawOpen(false); queueMicrotask(() => document.querySelector<HTMLButtonElement>(".mobile-draw-trigger")?.focus()); }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".chart-symbol-search")) setSearchOpen(false);
      if (!target.closest(".drawing-tool-group")) setOpenToolGroup(null);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, [searchOpen, openToolGroup, mobileDrawOpen]);

  useEffect(() => setHovered(latest), [latest]);

  useEffect(() => {
    try {
      const saved=readStored<{symbol?:string;range?:RangeKey;timeframe?:ChartTimeframe;show20?:boolean;show50?:boolean;show200?:boolean;logScale?:boolean;adjustment?:string}>(window.localStorage,"brontide-layout-v1",{});
      if (saved.symbol && (localBuild || saved.symbol in symbols)) setSymbol(saved.symbol);
      if (saved.range && ["1M","3M","6M","1Y","Max"].includes(saved.range)) setRange(saved.range);
      if (saved.timeframe === "1Day" || saved.timeframe === "1Week") setTimeframe(saved.timeframe);
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
    try {writeStored(window.localStorage,"brontide-layout-v1",{symbol,range,timeframe,show20,show50,show200,logScale,adjustment});}
    catch {setStorageError("Layout could not be saved. Browser storage may be full.");}
  },[symbol,range,timeframe,show20,show50,show200,logScale,adjustment,layoutReady]);

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
      [...extraOverlays, ...workflowOverlays].forEach(registerOverlay);
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
      const interactiveSurface = chartContainer.querySelector<HTMLElement>("[tabindex]");
      if (interactiveSurface) { interactiveSurface.tabIndex = 0; interactiveSurface.setAttribute("role", "application"); interactiveSurface.setAttribute("aria-label", `${symbol} interactive price chart. Use chart viewport controls for keyboard navigation.`); }
      chart.overrideYAxis({ paneId: "candle_pane", name: logScale ? "logarithm" : "normal" });
      chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod({ span: 1, type: timeframe === "1Day" ? "day" : "week" });
      chart.setDataLoader({ getBars: ({ type, callback }) => callback(type === "init" ? bars : [], false) });
      let followingSelectedRange = true;
      const applyDefaultViewport = () => {
        const chartWidth = containerRef.current?.clientWidth ?? 1200;
        const rightSpace = Math.min(30, Math.max(8, (chartWidth - 64) / Math.max(bars.length, 1) * 3));
        const usableWidth = Math.max(1, chartWidth - rightSpace - 58);
        const fittedBarSpace = Math.max(.05, usableWidth / Math.max(bars.length, 1));
        const rightVisibleBars = Math.ceil(rightSpace / Math.max(fittedBarSpace, .05));
        chart.setRightMinVisibleBarCount(rightVisibleBars);
        chart.setMaxOffsetRightDistance(rightSpace);
        chart.setBarSpace(Number(fittedBarSpace.toFixed(2)));
        chart.setOffsetRightDistance(rightSpace);
        followingSelectedRange = true;
      };
      applyDefaultViewport();
      fitViewportRef.current = applyDefaultViewport;
      const markCustomViewport = () => { followingSelectedRange = false; };
      chart.subscribeAction("onZoom", markCustomViewport);
      chart.subscribeAction("onScroll", markCustomViewport);
      // Keep a fitted range fitted, but preserve intentional pan/zoom on resize.
      const resizeObserver = new ResizeObserver(() => {
        chart.resize();
        if (followingSelectedRange) applyDefaultViewport();
      });
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
          const values = movingAverageByTime(displayAllBars, visibleAverages.map(([period])=>period));
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
      setChartReady(true);
      setChartGeneration(value=>value+1);
      disposeChart = () => {
        resizeObserver.disconnect();
        chart.unsubscribeAction("onZoom", markCustomViewport);
        chart.unsubscribeAction("onScroll", markCustomViewport);
        chart.unsubscribeAction("onCrosshairChange", crosshairHandler);
        dispose(chartContainer);
      };
    }).catch(() => { if (!cancelled) setRenderError(true); });
    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
      fitViewportRef.current = null;
      setChartReady(false);
    };
  }, [allBars, displayAllBars, bars, range, timeframe, retry, show20, show50, show200, symbol, logScale, theme, mode, adjustment]);

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

  useEffect(()=>{
    const chart=chartRef.current;
    if(!chart||!chartReady)return;
    chart.removeOverlay({groupId:"brontide-recent-trends"});
    if(!phase2AutomationVisible||!recentStore.ready||!recentStore.value)return;
    for(const line of recentResult.lines)chart.createOverlay({
      id:`recent-v1:${line.kind}`,name:"rayLine",groupId:"brontide-recent-trends",lock:true,zLevel:5,
      points:projectTrendPoints(line.points,allBars,bars.length),
      styles:{line:{color:line.kind==="support"?"#168aaf":"#b16e22",size:2,style:"dashed",dashedValue:[6,4]}},
    });
  },[recentStore.ready,recentStore.value,recentResult,chartReady,chartGeneration,allBars,bars,logScale]);
  const deleteSelectedDrawing = () => {
    if (!selectedDrawing) return;
    if (selectedDrawing.startsWith(AUTO_TREND_VERSION+":")) {
      if (!trendStore.save({...trendStore.value,edits:{...trendStore.value.edits,[selectedDrawing]:null}})) return;
    } else {
      drawings.removeMany(selectedDrawingIds.length ? selectedDrawingIds : [selectedDrawing]);
    }
    setSelectedDrawing(null);
    setSelectedDrawingIds([]);
  };

  const rememberTool = (tool: DrawingToolId) => {
    const definition = DRAWING_TOOL_BY_ID.get(tool);
    if (!definition || !drawingPreferences.ready) return;
    drawingPreferences.save({
      ...drawingPreferences.value,
      lastUsed: { ...drawingPreferences.value.lastUsed, [definition.groupId]: tool },
      recent: [tool, ...drawingPreferences.value.recent.filter(id => id !== tool)].slice(0, 10),
    });
  };
  const selectTool = (tool: DrawingToolId) => {
    drawings.cancel(); setSelectedDrawing(null); setSelectedDrawingIds([]); setDrawingPropertiesOpen(false); setOpenMenu(null);
    setOpenToolGroup(null);
    const definition = DRAWING_TOOL_BY_ID.get(tool);
    if (!definition || (tool !== "select" && !definition.overlay)) return;
    if (tool === "select") { setActiveTool("select"); setMobileDrawOpen(false); rememberTool(tool); return; }
    if (tool === "eraser") { setActiveTool("eraser"); setMobileDrawOpen(false); rememberTool(tool); return; }
    if (definition.overlay && drawings.start(definition.overlay, note)) { setActiveTool(tool); setMobileDrawOpen(false); rememberTool(tool); }
  };
  const toggleFavorite = (tool: DrawingToolId) => {
    if (!drawingPreferences.ready) return;
    const pinned = drawingPreferences.value.favorites.includes(tool);
    drawingPreferences.save({ ...drawingPreferences.value,
      favorites: pinned ? drawingPreferences.value.favorites.filter(id => id !== tool) : [...drawingPreferences.value.favorites, tool] });
  };

  const drawingActions = useRef({ drawings, deleteSelectedDrawing });
  drawingActions.current = { drawings, deleteSelectedDrawing };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input, select, textarea, [contenteditable=true]")) return;
      const { drawings: controls, deleteSelectedDrawing: remove } = drawingActions.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); if (event.shiftKey) controls.redo(); else controls.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); controls.redo(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
      else if (event.key === "Escape") {
        if (!controls.cancel()) { setActiveTool("select"); setSelectedDrawing(null); setSelectedDrawingIds([]); setDrawingPropertiesOpen(false); }
      }
    };
    document.addEventListener("keydown", keys); return () => document.removeEventListener("keydown", keys);
  }, []);

  return (
    <section className={`chart-dashboard chart-layout-v1 theme-${theme}`}>
      <header className="chart-commandbar" aria-label="Chart commands">
        <ChartMenu label={<List size={20}/>} title="Workspace navigation" className="chart-navigation-menu" {...menuProps("navigation")}>
          <strong>Brontide</strong>
          {onExit && <button onClick={onExit}><ArrowLeft size={16}/> Back to workspace</button>}
          {navigation?.map(item => <button key={item.label} onClick={item.onSelect}>{item.label}</button>)}
        </ChartMenu>
        <div className="chart-symbol-search">
          {mode === "sample" ? <label className="chart-sample-symbol"><span className="sr-only">Stock</span><select value={sampleSymbol} onChange={event => changeSymbol(event.target.value)} aria-label="Stock"><option value="NVDA">NVDA</option><option value="MRNA">MRNA</option><option value="CRCL">CRCL</option></select></label> : <button className="chart-search-trigger" onClick={() => { setOpenMenu(null); setOpenToolGroup(null); setSearchOpen(value => !value); }} aria-expanded={searchOpen} aria-label={`Search stock, selected ${symbol}`}><MagnifyingGlass size={16}/><b>{symbol}</b></button>}
          {searchOpen && <div className="chart-search-popover"><label>Find an instrument<input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Ticker or company" aria-label="Search instruments"/></label><p role="status">{searchStatus}</p>{matches.map(item => <button key={item.symbol} onClick={() => changeSymbol(item.symbol)}><b>{item.symbol}</b><span>{item.name}</span><small>{item.exchange} · {item.status}</small></button>)}<button onClick={() => setSearchOpen(false)}>Close search</button></div>}
        </div>
        <div className="chart-quote" title={name}><span className="chart-company">{name}</span><b>{latest?.close.toFixed(2) ?? "—"}</b>{dailyChange !== undefined && <span className={dailyChange >= 0 ? "up" : "down"}>{dailyChange >= 0 ? "+" : ""}{dailyChange.toFixed(2)}%</span>}</div>
        <ChartMenu label={<>{timeframe === "1Day" ? "D" : "W"} · {range}<CaretDown size={12}/></>} title="Time interval and range" {...menuProps("time")}>
          <label>Interval<select aria-label="Candle interval" value={timeframe} onChange={event => setTimeframe(event.target.value as ChartTimeframe)}><option value="1Day">Daily</option><option value="1Week">Weekly</option></select></label>
          <label>Visible range<select aria-label="Visible range" value={range} onChange={event => setRange(event.target.value as RangeKey)}>{(["1M", "3M", "6M", "1Y", "Max"] as RangeKey[]).map(item => <option key={item} value={item}>{item === "Max" ? "All available history" : item}</option>)}</select></label>
        </ChartMenu>
        <ChartMenu label={<>Studies<CaretDown size={12}/></>} title="Studies" className="chart-studies-menu" {...menuProps("studies")}>
          <strong>Moving averages</strong>
          <label><input type="checkbox" checked={show20} onChange={e => setShow20(e.target.checked)}/>20 SMA</label>
          <label><input type="checkbox" checked={show50} onChange={e => setShow50(e.target.checked)}/>50 SMA</label>
          <label><input type="checkbox" checked={show200} onChange={e => setShow200(e.target.checked)}/>200 SMA</label>
          <p>Volume is shown below price. Drag its divider to resize.</p>
        </ChartMenu>
        <ChartMenu label={<><span className={`chart-status-dot${issues.length || loadState === "error" || payload?.status.freshness !== "fresh" ? " attention" : ""}`}/><span>{issues.length ? "Check" : asOf ? "As of" : mode === "sample" ? "Demo" : "EOD"}</span></>} title="Data and chart status" className="chart-data-menu" {...menuProps("data")}>
          <strong role="status">{statusLabel}</strong>
          {localBuild && <label>Data mode<select aria-label="Data mode" value={mode} onChange={event => changeMode(event.target.value as "local" | "sample")}><option value="local">Local EOD</option><option value="sample">Sample demo</option></select></label>}
          {mode === "local" ? <><label>Price adjustment<select aria-label="Price adjustment" value={adjustment} onChange={event => { setLocalBars([]); setPayload(null); setLoadState("loading"); setAdjustment(event.target.value); }}><option value="all">All adjusted</option><option value="raw">Raw</option></select></label><p>{payload ? `${payload.series.source} · ${payload.status.last_session ?? "No sessions"}${payload.status.freshness === "stale" ? ` · Missing through ${payload.status.expected_session}` : payload.status.freshness === "unknown" ? " · Calendar coverage needs updating" : ""}` : statusLabel}</p><button onClick={() => setRetry(value => value + 1)}>Refresh data</button></> : <p><strong>DEMO · SIMULATED PRICES</strong><br/>These candles do not represent {sampleSymbol} market history. Real EOD data is available in local mode.</p>}
          {asOf && <div className="chart-evidence"><p>Historical view through {asOf}. Later bars are hidden.</p><button onClick={() => setAsOf(undefined)}>Review later bars</button></div>}
          {issues.map((issue, index) => <p role="alert" key={index}>{issue}</p>)}
          {error && mode === "local" && <p role="alert">{error}</p>}
        </ChartMenu>
        {onPlan && <button className="chart-command chart-plan" onClick={() => onPlan({symbol,mode,adjustment,asOf,...(context?.signalId && context.symbol === symbol ? {signalId:context.signalId,strategyId:context.strategyId} : {})})}>Create plan</button>}
        <ChartMenu label={<DotsThree size={22}/>} title="More chart options" className="chart-more-menu" {...menuProps("more")}>
          <button onClick={() => setTheme(value => value === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "Dark" : "Light"} theme</button>
          <div className="chart-studies-overflow">
            <strong>Studies</strong>
            <label><input type="checkbox" checked={show20} onChange={e => setShow20(e.target.checked)}/>20 SMA</label>
            <label><input type="checkbox" checked={show50} onChange={e => setShow50(e.target.checked)}/>50 SMA</label>
            <label><input type="checkbox" checked={show200} onChange={e => setShow200(e.target.checked)}/>200 SMA</label>
          </div>
          <label>Drawing note<input aria-label="Drawing note" value={note} maxLength={120} onChange={event => setNote(event.target.value)}/></label>
          {selectedManual && <button onClick={() => { setDrawingPropertiesOpen(true); setOpenMenu(null); }}>Edit selected drawing</button>}
          <button disabled={!selectedDrawing || selectedManual?.lock} onClick={deleteSelectedDrawing}>Delete selected drawing</button>
          <p>Drawings save automatically. Ctrl/⌘ Z to undo; Shift Z to redo. Escape cancels a drawing. Locked drawings are protected from deletion.</p>
          {onPlan && <button className="chart-plan-overflow" onClick={() => onPlan({symbol,mode,adjustment,asOf,...(context?.signalId && context.symbol === symbol ? {signalId:context.signalId,strategyId:context.strategyId} : {})})}>Create plan</button>}
          <p>KLineChart · Open-source rendering</p>
        </ChartMenu>
        <span className="sr-only" role="status">{issues.length ? issues.join(". ") : asOf ? `Historical view through ${asOf}` : statusLabel}</span>
      </header>

      <div className="chart-analysis-body"><div className="chart-stage-area">
        <button className="mobile-draw-trigger" aria-expanded={mobileDrawOpen} aria-controls="mobile-drawing-tools" onClick={() => setMobileDrawOpen(value => !value)}><PaintBrush size={18}/><span>{activeTool === "select" ? "Draw" : DRAWING_TOOL_BY_ID.get(activeTool)?.label}</span></button>
        <aside id="mobile-drawing-tools" className={`drawing-rail${mobileDrawOpen ? " mobile-open" : ""}`} aria-label="Drawing tools">
          <div className="mobile-drawing-sheet-header"><strong>Drawing tools</strong><button onClick={() => { setMobileDrawOpen(false); setOpenToolGroup(null); }}>Done</button></div>
          {DRAWING_GROUPS.map((group) => {
            const lastUsedId = drawingPreferences.value.lastUsed[group.id] ?? group.defaultTool;
            const lastUsed = DRAWING_TOOL_BY_ID.get(lastUsedId) ?? DRAWING_TOOL_BY_ID.get(group.defaultTool)!;
            const GroupIcon = DRAWING_ICONS[lastUsed.icon];
            const groupActive = DRAWING_TOOL_BY_ID.get(activeTool)?.groupId === group.id;
            const isOpen = openToolGroup === group.id;
            const groupTools = toolsForGroup(group.id, drawingPreferences.value.favorites);
            const groupTooltip = `${lastUsed.label} · ${group.label}${lastUsed.shortcut ? ` · ${lastUsed.shortcut}` : ""}`;
            const flyoutTooltip = `Open ${group.label} tools`;
            return <div className="drawing-tool-group" key={group.id}>
              <div className="drawing-group-slot">
                <button disabled={!chartReady || !drawings.ready || !drawingPreferences.ready} className={groupActive ? "active" : ""} title={groupTooltip} aria-label={groupTooltip} onClick={() => selectTool(lastUsed.id)}><GroupIcon size={17}/></button>
                <button className="drawing-group-open" title={flyoutTooltip} aria-label={flyoutTooltip} aria-expanded={isOpen} onClick={() => { setOpenMenu(null); setSearchOpen(false); setOpenToolGroup(isOpen ? null : group.id); }}><CaretRight size={8}/></button>
              </div>
              {isOpen && <div className="drawing-tool-menu" role="region" aria-label={`${group.label} drawing tools`}><div className="drawing-tool-menu-title"><span>{group.label}</span><small>{groupTools.length} available</small></div><label className="drawing-keep"><input type="checkbox" checked={drawingPreferences.value.keepDrawing} onChange={event => drawingPreferences.save({ ...drawingPreferences.value, keepDrawing: event.target.checked })}/>Keep Drawing</label>{groupTools.map((tool) => {
                const ToolIcon = DRAWING_ICONS[tool.icon];
                const pinned = drawingPreferences.value.favorites.includes(tool.id);
                const tooltip = `${tool.label} · ${group.label}${tool.shortcut ? ` · ${tool.shortcut}` : ""}`;
                const favoriteTooltip = `${pinned ? "Remove" : "Add"} ${tool.label} ${pinned ? "from" : "to"} favourites`;
                return <div className="drawing-tool-choice" key={tool.id}><button disabled={!chartReady || !drawings.ready || !drawingPreferences.ready} className={activeTool === tool.id ? "active" : ""} title={tooltip} aria-label={tooltip} onClick={() => selectTool(tool.id)}><ToolIcon size={16}/><span>{tool.label}</span></button><button disabled={!drawingPreferences.ready} aria-label={favoriteTooltip} aria-pressed={pinned} title={favoriteTooltip} onClick={() => toggleFavorite(tool.id)}><Star size={15} weight={pinned ? "fill" : "regular"}/></button></div>;
              })}</div>}
            </div>;
          })}
          <div className="drawing-actions">
            {(() => { const next = nextSnapPreference(drawingPreferences.value.snap); const tooltip = `Magnet snapping: ${drawingPreferences.value.snap}. Activate for ${next}`; return <button aria-label={tooltip} title={tooltip} aria-pressed={drawingPreferences.value.snap !== "off"} className={drawingPreferences.value.snap !== "off" ? "active" : ""} disabled={!drawingPreferences.ready} onClick={() => drawingPreferences.save({ ...drawingPreferences.value, snap: next })}><Magnet size={17}/><span className="drawing-utility-state" aria-hidden="true">{drawingPreferences.value.snap.slice(0, 1).toUpperCase()}</span></button>; })()}
            <button aria-label="Undo drawing change · Ctrl/⌘ Z" title="Undo drawing change · Ctrl/⌘ Z" disabled={!drawings.canUndo} onClick={drawings.undo}><ArrowCounterClockwise size={17}/></button>
            <button aria-label="Redo drawing change · Ctrl/⌘ Shift Z or Ctrl+Y" title="Redo drawing change · Ctrl/⌘ Shift Z or Ctrl+Y" disabled={!drawings.canRedo} onClick={drawings.redo}><ArrowClockwise size={17}/></button>
            <ChartMenu label={<Stack size={17}/>} title="Drawing objects" className="drawing-objects-menu" {...menuProps("objects")}>
              <DrawingObjectsPanel symbol={symbol} adjustment={adjustment} timeframe={timeframe} saveStatus={drawings.saveStatus} drawings={drawings.drawings} selected={selectedDrawingIds} unavailable={drawings.unavailable} label={drawingLabel}
                select={ids => { setSelectedDrawingIds(ids); setSelectedDrawing(ids.at(-1) ?? null); setDrawingPropertiesOpen(false); }}
                locate={drawings.locate} update={drawings.update} updateMany={drawings.updateMany} duplicate={drawings.duplicate} reorder={drawings.reorder} remove={drawings.remove} removeMany={drawings.removeMany}/>
            </ChartMenu>
          </div>
        </aside>

        <div className={`chart-canvas-shell${activeTool !== "select" ? " drawing-active" : ""}`}>
          {mode === "sample" && <span className="chart-demo-watermark" aria-hidden="true">SIMULATED DATA</span>}
          {hovered && <div className="chart-ohlc"><span>{mode === "sample" ? "Demo session · " : ""}{formatDate(hovered.timestamp)}</span><span>O <b>{hovered.open.toFixed(2)}</b></span><span>H <b>{hovered.high.toFixed(2)}</b></span><span>L <b>{hovered.low.toFixed(2)}</b></span><span>C <b>{hovered.close.toFixed(2)}</b></span><strong className={hovered.close >= hovered.open ? "up" : "down"}>{((hovered.close / hovered.open - 1) * 100).toFixed(2)}%</strong><span>Vol <b>{formatVolume(hovered.volume)}</b></span></div>}
          <div className="chart-legend">{show20 && <span className="ma20">MA20: {latestAverages[20]?.toFixed(2) ?? "—"}</span>}{show50 && <span className="ma50">MA50: {latestAverages[50]?.toFixed(2) ?? "—"}</span>}{show200 && <span className="ma200">MA200: {latestAverages[200]?.toFixed(2) ?? "—"}</span>}</div>
          {!chartReady && bars.length > 0 && <SampleChartFallback rows={bars}/>}
          {!bars.length && <div className="chart-message" role={loadState === "error" ? "alert" : "status"}><strong>{loadState === "loading" ? "Loading daily bars…" : loadState === "empty" ? "No stored bars for this price series" : "Local data unavailable"}</strong><p>{loadState === "error" ? error : loadState === "empty" ? "Choose another instrument or price adjustment." : "Reading your local EOD data."}</p>{loadState === "error" && <button onClick={() => setRetry((value) => value + 1)}>Retry</button>}</div>}
          {renderError && <div className="drawing-hint" role="alert">Interactive chart unavailable · Static preview <button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}<div ref={containerRef} className={`market-chart ${chartReady ? "ready" : ""}`}/>
          <DrawingContextToolbar drawings={selectedManuals} bars={allBars} unavailable={drawings.unavailable} position={drawingContextPosition} propertiesOpen={drawingPropertiesOpen}
            close={() => { setSelectedDrawing(null); setSelectedDrawingIds([]); setDrawingPropertiesOpen(false); }} more={() => setDrawingPropertiesOpen(value => !value)}
            updateMany={drawings.updateMany} update={drawings.update} duplicate={drawings.duplicate} removeMany={drawings.removeMany} remove={drawings.remove}
            sendToPlan={onPlan ? draft => onPlan({symbol,mode,adjustment,asOf,tradeDraft:{side:"Long",...draft}}) : undefined}/>
          {drawings.error && <p className="drawing-hint" role="alert">{drawings.error}</p>}
          {activeTool !== "select" && <p className="drawing-hint" role="status">{toolHints[activeTool] ?? `Place ${DRAWING_TOOL_BY_ID.get(activeTool)?.label.toLowerCase()} anchors on the chart.`} Escape to cancel.</p>}
          <div className="chart-corner-controls">
            <ChartMenu label={<SlidersHorizontal size={16}/>} title="Chart viewport" className="chart-view-menu" {...menuProps("view")}>
              <button disabled={!chartReady} onClick={() => chartRef.current?.zoomAtCoordinate(1.25, undefined, 120)}>Zoom in</button>
              <button disabled={!chartReady} onClick={() => chartRef.current?.zoomAtCoordinate(.8, undefined, 120)}>Zoom out</button>
              <button disabled={!chartReady} onClick={() => chartRef.current?.scrollByDistance(-120, 160)}>Move backward</button>
              <button disabled={!chartReady} onClick={() => chartRef.current?.scrollToRealTime(180)}>Move to latest</button>
              <button disabled={!chartReady} onClick={() => fitViewportRef.current?.()}>Fit selected range</button>
            </ChartMenu>
            <button className="chart-scale-toggle" aria-label={`Price scale: ${logScale ? "Logarithmic" : "Linear"}. Switch to ${logScale ? "linear" : "logarithmic"}`} aria-pressed={logScale} onClick={() => setLogScale(value => !value)}>{logScale ? "Log" : "Lin"}</button>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
