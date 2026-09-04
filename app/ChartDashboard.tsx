"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart, Crosshair, KLineData } from "klinecharts";

type Bar = KLineData & { volume: number };
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "Max";
type SymbolKey = "NVDA" | "MRNA" | "CRCL";
type ChartTheme = "light" | "dark";
type DrawingTool = "cursor" | "horizontal" | "vertical" | "trend" | "ray" | "channel" | "fib" | "rectangle" | "circle" | "label" | "note";

const symbols: Record<SymbolKey, { name: string; seed: number; start: number; drift: number }> = {
  NVDA: { name: "NVIDIA Corporation", seed: 17, start: 118, drift: .0031 },
  MRNA: { name: "Moderna, Inc.", seed: 41, start: 92, drift: .0015 },
  CRCL: { name: "Circle Internet Group", seed: 73, start: 63, drift: .0042 },
};

const tools: Array<{ id: DrawingTool; glyph: string; label: string }> = [
  { id: "cursor", glyph: "↖", label: "Cursor" },
  { id: "horizontal", glyph: "—", label: "Horizontal line" },
  { id: "vertical", glyph: "↕", label: "Vertical line" },
  { id: "trend", glyph: "╱", label: "Trend line" },
  { id: "ray", glyph: "↗", label: "Ray" },
  { id: "channel", glyph: "≋", label: "Parallel channel" },
  { id: "fib", glyph: "≡", label: "Fibonacci retracement" },
  { id: "rectangle", glyph: "▭", label: "Price channel" },
  { id: "label", glyph: "⊣", label: "Price label" },
  { id: "note", glyph: "□", label: "Note" },
];

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
  const [logScale, setLogScale] = useState(false);
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [theme, setTheme] = useState<ChartTheme>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const allBars = useMemo(() => makeBars(symbols[symbol]), [symbol]);
  const bars = useMemo(() => allBars.slice(-rangeSize(range)), [allBars, range]);
  const latest = bars.at(-1)!;
  const previous = bars.at(-2)!;
  const change = ((latest.close / previous.close) - 1) * 100;
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
      chart.setBarSpace(range === "1M" ? 18 : range === "3M" ? 10 : range === "6M" ? 6 : 4);
      chart.setOffsetRightDistance(38);
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

  const clearDrawings = () => {
    chartRef.current?.removeOverlay();
  };

  const selectTool = (tool: DrawingTool) => {
    setActiveTool(tool);
    const overlayNames: Partial<Record<DrawingTool, string>> = {
      horizontal: "horizontalStraightLine", vertical: "verticalStraightLine", trend: "straightLine", ray: "rayLine",
      channel: "parallelStraightLine", fib: "fibonacciLine", rectangle: "priceChannelLine", label: "simpleTag", note: "simpleAnnotation",
    };
    const overlay = overlayNames[tool];
    if (overlay) chartRef.current?.createOverlay({ name: overlay, groupId: "brontide-drawings" });
  };

  return (
    <section className={`chart-dashboard theme-${theme}`}>
      <header className="chart-commandbar">
        <div className="chart-sequence"><button aria-label="Back" onClick={onExit}>‹</button><button className="chart-stage">EP contractions⌄</button><button aria-label="Previous">‹</button><span>1 of 14</span><button aria-label="Next">›</button></div>
        <label className="chart-symbol-select"><span>{symbols[symbol].name}</span><b>{symbol}</b><select value={symbol} onChange={(event) => setSymbol(event.target.value as SymbolKey)} aria-label="Stock"><option value="NVDA">NVIDIA Corporation</option><option value="MRNA">Moderna, Inc.</option><option value="CRCL">Circle Internet Group</option></select></label>
        <div className="chart-header-actions"><span className="chart-data-state"><i/> Sample data</span><button className="chart-accent">Analyze setup</button><button className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><span aria-hidden="true">{theme === "light" ? "Dark" : "Light"}</span></button></div>
      </header>

      <div className="chart-subbar">
        <div className="chart-ranges">{(["1M", "3M", "6M", "1Y", "Max"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}<button className="chart-select-button">Daily⌄</button></div>
        <div className="chart-display-controls"><details><summary>Indicators</summary><div className="indicator-popover"><label><input type="checkbox" checked={show20} onChange={(e) => setShow20(e.target.checked)}/>20 SMA</label><label><input type="checkbox" checked={show50} onChange={(e) => setShow50(e.target.checked)}/>50 SMA</label><label><input type="checkbox" checked={show200} onChange={(e) => setShow200(e.target.checked)}/>200 SMA</label></div></details><span>SCALE</span><button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>Lin</button><button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>Log</button><div className="chart-viewport-controls" role="group" aria-label="Chart viewport"><button onClick={() => chartRef.current?.zoomAtCoordinate(.8, undefined, 120)} aria-label="Zoom out" title="Zoom out">−</button><button onClick={() => chartRef.current?.zoomAtCoordinate(1.25, undefined, 120)} aria-label="Zoom in" title="Zoom in">+</button><button onClick={() => chartRef.current?.scrollByDistance(-120, 160)} aria-label="Move backward" title="Move backward">‹</button><button onClick={() => chartRef.current?.scrollToRealTime(180)} aria-label="Move to latest" title="Move to latest">Latest</button></div></div>
      </div>

      <div className="chart-stage-area">
        <aside className="drawing-rail" aria-label="Drawing tools">
          {tools.map((tool, index) => <button key={tool.id} className={`${activeTool === tool.id ? "active" : ""} ${[1, 7, 9].includes(index) ? "separated" : ""}`} title={tool.label} aria-label={tool.label} onClick={() => selectTool(tool.id)}>{tool.glyph}</button>)}
          <button className="drawing-clear" title="Clear drawings" onClick={clearDrawings}>⌫</button>
        </aside>

        <div className="chart-canvas-shell">
          <div className="chart-ohlc"><span>{formatDate(hovered.timestamp)}</span><span>O <b>{hovered.open.toFixed(2)}</b></span><span>H <b>{hovered.high.toFixed(2)}</b></span><span>L <b>{hovered.low.toFixed(2)}</b></span><span>C <b>{hovered.close.toFixed(2)}</b></span><strong className={hovered.close >= hovered.open ? "up" : "down"}>{((hovered.close / hovered.open - 1) * 100).toFixed(2)}%</strong><span>Vol <b>{formatVolume(hovered.volume)}</b></span></div>
          <div className="chart-legend">{show20 && <span className="ma20">MA20: {movingAverage(bars, 20).at(-1)?.value.toFixed(2) ?? "—"}</span>}{show50 && <span className="ma50">MA50: {movingAverage(bars, 50).at(-1)?.value.toFixed(2) ?? "—"}</span>}{show200 && <span className="ma200">MA200: {movingAverage(bars, 200).at(-1)?.value.toFixed(2) ?? "—"}</span>}</div>
          {!chartReady && <SampleChartFallback rows={bars}/>}<div ref={containerRef} className={`market-chart ${chartReady ? "ready" : ""}`}/>
          {activeTool === "horizontal" && <p className="drawing-hint">Click the chart to place a price level</p>}
        </div>
      </div>

      <footer className="chart-footer"><span>Daily candles</span><span>Volume</span><strong>KLineChart · Open-source rendering</strong></footer>
    </section>
  );
}
