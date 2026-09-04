"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

type Bar = CandlestickData<Time> & { volume: number };
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "Max";
type SymbolKey = "NVDA" | "MRNA" | "CRCL";
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
  { id: "rectangle", glyph: "▭", label: "Rectangle" },
  { id: "circle", glyph: "○", label: "Circle" },
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
        time: date.toISOString().slice(0, 10),
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
    return [{ time: bar.time, value }];
  });
}

function rangeSize(range: RangeKey) {
  return range === "1M" ? 22 : range === "3M" ? 66 : range === "6M" ? 132 : range === "1Y" ? 252 : 9999;
}

function formatVolume(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
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
      return <g key={String(bar.time)} className={up ? "fallback-up" : "fallback-down"}>
        <line x1={posX} x2={posX} y1={y(bar.high)} y2={y(bar.low)} className="fallback-wick"/>
        <rect x={posX - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx=".4" className="fallback-body"/>
        <rect x={posX - candleWidth / 2} y={volumeBottom - volumeHeight} width={candleWidth} height={volumeHeight} className="fallback-volume"/>
      </g>;
    })}
    {[0, 1, 2, 3, 4].map((tick) => {
      const price = maxPrice - (tick / 4) * (maxPrice - minPrice);
      return <text key={tick} x="1127" y={y(price) + 3} className="fallback-axis">{price.toFixed(0)}</text>;
    })}
    {rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 5)) === 0).map((bar, index) => <text key={String(bar.time)} x={x(index * Math.max(1, Math.floor(rows.length / 5)))} y="696" className="fallback-date">{String(bar.time).slice(5)}</text>)}
  </svg>;
}

export function ChartDashboard({ onExit }: { onExit?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Array<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>>>([]);
  const [symbol, setSymbol] = useState<SymbolKey>("NVDA");
  const [range, setRange] = useState<RangeKey>("6M");
  const [bases, setBases] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [logScale, setLogScale] = useState(false);
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [chartReady, setChartReady] = useState(false);
  const allBars = useMemo(() => makeBars(symbols[symbol]), [symbol]);
  const bars = useMemo(() => allBars.slice(-rangeSize(range)), [allBars, range]);
  const latest = bars.at(-1)!;
  const previous = bars.at(-2)!;
  const change = ((latest.close / previous.close) - 1) * 100;
  const [hovered, setHovered] = useState<Bar>(latest);

  useEffect(() => setHovered(latest), [latest]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0d1117" }, textColor: "#7f8996", fontFamily: "Inter, ui-sans-serif, system-ui", fontSize: 10 },
      grid: { vertLines: { color: "#202630", style: LineStyle.Dotted }, horzLines: { color: "#202630", style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: "#222a35", scaleMargins: { top: .08, bottom: .2 }, mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: "#222a35", timeVisible: false, rightOffset: 4, barSpacing: range === "1M" ? 18 : range === "3M" ? 10 : range === "6M" ? 6 : 4, minBarSpacing: 2.5 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#7b8796", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#26303b" }, horzLine: { color: "#7b8796", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#148c50" } },
      handleScroll: true,
      handleScale: true,
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#38c985", downColor: "#df4b53", borderVisible: false, wickUpColor: "#38c985", wickDownColor: "#df4b53", priceLineVisible: true, priceLineColor: "#25a966", priceLineStyle: LineStyle.Dashed,
    });
    candles.setData(bars);

    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .83, bottom: 0 } });
    volume.setData(bars.map((bar) => ({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? "#197b55aa" : "#8f3038aa" })));

    const addAverage = (period: number, color: string, visible: boolean) => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, visible });
      line.setData(movingAverage(bars, period));
    };
    addAverage(20, "#875fd2", show20);
    addAverage(50, "#4169ca", show50);
    addAverage(200, "#ba7641", show200);

    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(candles) as CandlestickData<Time> | undefined;
      if (!point) return;
      const source = bars.find((bar) => bar.time === point.time);
      if (source) setHovered(source);
    });

    chart.subscribeClick((param) => {
      if (activeTool !== "horizontal" || !param.point) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null) return;
      const line = candles.createPriceLine({ price, color: "#d7a84a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "level" });
      priceLinesRef.current.push(line);
      setActiveTool("cursor");
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;
    candleRef.current = candles;
    setChartReady(true);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      priceLinesRef.current = [];
      setChartReady(false);
    };
  }, [bars, range, show20, show50, show200, logScale, activeTool]);

  const clearDrawings = () => {
    const series = candleRef.current;
    if (series) priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];
  };

  return (
    <section className="chart-dashboard">
      <header className="chart-commandbar">
        <div className="chart-sequence"><button aria-label="Back" onClick={onExit}>‹</button><button className="chart-stage">EP contractions⌄</button><button aria-label="Previous">‹</button><span>1 of 14</span><button aria-label="Next">›</button></div>
        <label className="chart-symbol-select"><span>{symbols[symbol].name}</span><b>{symbol}</b><select value={symbol} onChange={(event) => setSymbol(event.target.value as SymbolKey)} aria-label="Stock"><option value="NVDA">NVIDIA Corporation</option><option value="MRNA">Moderna, Inc.</option><option value="CRCL">Circle Internet Group</option></select></label>
        <div className="chart-header-actions"><button className="chart-accent">Analyze setup</button><button>Save settings</button><button>Save drawing</button><button>Details</button></div>
      </header>

      <div className="chart-subbar">
        <div className="chart-ranges">{(["1M", "3M", "6M", "1Y", "Max"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}<button className="chart-select-button">Daily⌄</button></div>
        <div className="chart-display-controls"><details><summary>ƒ Indicators</summary><div className="indicator-popover"><label><input type="checkbox" checked={show20} onChange={(e) => setShow20(e.target.checked)}/>20 SMA</label><label><input type="checkbox" checked={show50} onChange={(e) => setShow50(e.target.checked)}/>50 SMA</label><label><input type="checkbox" checked={show200} onChange={(e) => setShow200(e.target.checked)}/>200 SMA</label></div></details><span>BAR STYLE</span><button>Candles · filled⌄</button><span>SCALE</span><button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>Lin</button><button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>Log</button><button>%</button><button>Download / Share</button></div>
      </div>

      <div className="chart-stage-area">
        <aside className="drawing-rail" aria-label="Drawing tools">
          {tools.map((tool, index) => <button key={tool.id} className={`${activeTool === tool.id ? "active" : ""} ${[1, 7, 9].includes(index) ? "separated" : ""}`} title={tool.label} aria-label={tool.label} onClick={() => setActiveTool(tool.id)}>{tool.glyph}</button>)}
          <button className="drawing-clear" title="Clear drawings" onClick={clearDrawings}>⌫</button>
        </aside>

        <div className="chart-canvas-shell">
          <div className="chart-ohlc"><span>{String(hovered.time)}</span><span>O <b>{hovered.open.toFixed(2)}</b></span><span>H <b>{hovered.high.toFixed(2)}</b></span><span>L <b>{hovered.low.toFixed(2)}</b></span><span>C <b>{hovered.close.toFixed(2)}</b></span><strong className={hovered.close >= hovered.open ? "up" : "down"}>{((hovered.close / hovered.open - 1) * 100).toFixed(2)}%</strong><span>Vol <b>{formatVolume(hovered.volume)}</b></span></div>
          <div className="chart-legend"><span className="ma20">MA20: {movingAverage(bars, 20).at(-1)?.value.toFixed(2) ?? "—"}</span><span className="ma50">MA50: {movingAverage(bars, 50).at(-1)?.value.toFixed(2) ?? "—"}</span><span className="ma200">MA200: {movingAverage(bars, 200).at(-1)?.value.toFixed(2) ?? "—"}</span></div>
          <div className="bases-toggle"><button className={bases ? "on" : ""} onClick={() => setBases((value) => !value)}>Bases <i/></button></div>
          {!chartReady && <SampleChartFallback rows={bars}/>}<div ref={containerRef} className={`market-chart ${chartReady ? "ready" : ""}`}/>
          {bases && <div className="base-overlay" aria-hidden="true"><div className="base-box base-one"><span>4.1 wks</span></div><div className="base-box base-two"><span>2.8 wks</span></div><div className="base-box base-three"><span>3.4 wks</span><b>pivot {Math.max(...bars.slice(-45).map((bar) => bar.high)).toFixed(2)}</b></div></div>}
          {activeTool === "horizontal" && <p className="drawing-hint">Click the chart to place a price level</p>}
          <div className="chart-zoom"><button onClick={() => chartRef.current?.timeScale().applyOptions({barSpacing: 4})}>−</button><button onClick={() => chartRef.current?.timeScale().applyOptions({barSpacing: 10})}>+</button><button onClick={() => chartRef.current?.timeScale().scrollToPosition(8, true)}>←</button><button onClick={() => chartRef.current?.timeScale().scrollToRealTime()}>→</button><button onClick={() => chartRef.current?.timeScale().fitContent()}>⇥</button></div>
        </div>
      </div>

      <footer className="chart-footer"><span>⚑ contraction</span><span>× failed breakout</span><strong>Sample historical data · chart interactions are functional</strong><button>All detected bases (2026)⌄</button></footer>
    </section>
  );
}
