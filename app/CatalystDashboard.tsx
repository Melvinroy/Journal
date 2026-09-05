"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { MarketContext } from "../lib/workspace-state";

type WindowDays = 1 | 3 | 5;
type Direction = "bullish" | "bearish" | "neutral";
type DirectionFilter = "all" | Direction;

type RawCatalystRow = {
  report_id: string;
  report_type: string;
  generated_at_sgt: string;
  row_order: number;
  ticker: string;
  catalyst_event_date: string | null;
  catalyst_quality_direction: string;
  primary_catalyst_category: string;
  catalyst_tags: string;
  catalyst_summary: string;
  sector: string;
  theme: string;
  direct_sympathy_sector_move: string;
  sympathy_related_tickers: string;
  catalyst_release_session: string;
  reaction_date: string | null;
  move_already_done: string;
  volume_liquidity_confirmation: string;
  freshness_catalyst_age: string;
  source_confidence: "High" | "Medium" | "Low" | string;
  primary_source_evidence: string;
  trade_read: string;
  risk_invalidator: string;
  action_priority: string;
  trading_date_checked: string;
};

type CatalystRow = RawCatalystRow & {
  appearances: number;
  direction: Direction;
  importance_score: number;
};

type CatalystReport = {
  id: string;
  report_type: string;
  generated_at_sgt: string;
  market_summary: string | null;
  themes_summary: string | null;
  best_focus: string | null;
  trading_date_checked: string;
};

type CatalystData = {
  asOfDate: string;
  rows: CatalystRow[];
  reports: CatalystReport[];
};

const WINDOWS: { label: string; value: WindowDays }[] = [
  { label: "Today", value: 1 },
  { label: "3 days", value: 3 },
  { label: "5 days", value: 5 },
];

const ROW_COLUMNS = [
  "report_id", "report_type", "generated_at_sgt", "row_order", "ticker",
  "catalyst_event_date", "catalyst_quality_direction", "primary_catalyst_category",
  "catalyst_tags", "catalyst_summary", "sector", "theme",
  "direct_sympathy_sector_move", "sympathy_related_tickers",
  "catalyst_release_session", "reaction_date", "move_already_done",
  "volume_liquidity_confirmation", "freshness_catalyst_age", "source_confidence",
  "primary_source_evidence", "trade_read", "risk_invalidator", "action_priority",
  "trading_date_checked",
].join(",");

function directionFor(grade: string): Direction {
  if (grade.includes("Bullish")) return "bullish";
  if (grade.includes("Bearish")) return "bearish";
  return "neutral";
}

function importanceFor(row: RawCatalystRow) {
  const weights: Record<string, number> = {
    "A+ Bullish": 100, "A+ Bearish": 100, "A Bullish": 86, "A Bearish": 86,
    "B Bullish": 66, "B Bearish": 66, "Sympathy / Continuation": 46,
    "N / Neutral": 38, "No Fresh Catalyst": 18,
  };
  let score = weights[row.catalyst_quality_direction] ?? 35;
  if (row.source_confidence === "High") score += 4;
  else if (row.source_confidence === "Low") score -= 8;
  if (row.direct_sympathy_sector_move === "Direct") score += 4;
  if (row.action_priority === "High-Conviction Watch") score += 4;
  else if (row.action_priority === "Short Watch") score += 2;
  if (row.freshness_catalyst_age.toLowerCase().includes("same-day")) score += 2;
  return Math.max(10, Math.min(100, score));
}

function gradeLabel(value: string) {
  if (value.startsWith("A+")) return "A+";
  if (value.startsWith("A ")) return "A";
  if (value.startsWith("B ")) return "B";
  if (value === "No Fresh Catalyst") return "NFC";
  if (value === "Sympathy / Continuation") return "CONT";
  return "N";
}

function importanceBand(score: number) {
  if (score >= 96) return "critical";
  if (score >= 82) return "high";
  if (score >= 62) return "medium";
  return "low";
}

function formatGenerated(value: string) {
  try {
    return new Intl.DateTimeFormat("en-SG", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "Asia/Singapore",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function rowIsNewer(candidate: RawCatalystRow, current: RawCatalystRow) {
  return candidate.trading_date_checked > current.trading_date_checked
    || (candidate.trading_date_checked === current.trading_date_checked
      && candidate.generated_at_sgt > current.generated_at_sgt)
    || (candidate.trading_date_checked === current.trading_date_checked
      && candidate.generated_at_sgt === current.generated_at_sgt
      && candidate.row_order < current.row_order);
}

function SignalCard({ row, rank }: { row: CatalystRow; rank: number }) {
  return (
    <article className={`catalyst-signal-card signal-${row.direction}`}>
      <span className="catalyst-signal-rank">{String(rank).padStart(2, "0")}</span>
      <div className="catalyst-signal-main">
        <div className="catalyst-signal-line">
          <strong>{row.ticker}</strong>
          <span className={`catalyst-grade grade-${row.direction}`}>{gradeLabel(row.catalyst_quality_direction)}</span>
          <span className="catalyst-score">{row.importance_score}</span>
        </div>
        <p className="catalyst-signal-title">{row.primary_catalyst_category} · {row.theme}</p>
        <p className="catalyst-trade-read">{row.trade_read}</p>
        <div className="catalyst-signal-meta">
          <span>{row.move_already_done}</span>
          <span>{row.source_confidence} confidence</span>
          {row.appearances > 1 && <span>{row.appearances}× in window</span>}
        </div>
      </div>
    </article>
  );
}

export function CatalystDashboard({onChart}:{onChart?:(context:MarketContext)=>void}) {
  const [days, setDays] = useState<WindowDays>(1);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CatalystData | null>(null);
  const [selected, setSelected] = useState<CatalystRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function loadCatalysts() {
      if (!supabase) return;
      setLoading(true);
      setError("");
      setData(null);

      const { data: latest, error: latestError } = await supabase
        .from("catalyst_dashboard_rows")
        .select("trading_date_checked")
        .order("trading_date_checked", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!current) return;
      if (latestError) {
        setError(latestError.code === "42P01" || latestError.code === "42501"
          ? "Catalyst data is not connected to this journal yet."
          : latestError.message);
        setLoading(false);
        return;
      }
      if (!latest?.trading_date_checked) {
        setData({ asOfDate: "", rows: [], reports: [] });
        setLoading(false);
        return;
      }

      const asOfDate = String(latest.trading_date_checked);
      const fromDate = subtractDays(asOfDate, days - 1);
      const [rowsResult, reportsResult] = await Promise.all([
        supabase.from("catalyst_dashboard_rows").select(ROW_COLUMNS)
          .gte("trading_date_checked", fromDate).lte("trading_date_checked", asOfDate)
          .order("trading_date_checked", { ascending: false })
          .order("generated_at_sgt", { ascending: false })
          .order("row_order", { ascending: true }).limit(1000),
        supabase.from("catalyst_reports")
          .select("id,report_type,generated_at_sgt,market_summary,themes_summary,best_focus,trading_date_checked")
          .gte("trading_date_checked", fromDate).lte("trading_date_checked", asOfDate)
          .order("generated_at_sgt", { ascending: false }).limit(12),
      ]);

      if (!current) return;
      if (rowsResult.error) {
        setError(rowsResult.error.message);
        setLoading(false);
        return;
      }

      const rawRows = (rowsResult.data ?? []) as unknown as RawCatalystRow[];
      const byTicker = new Map<string, { row: RawCatalystRow; appearances: number }>();
      rawRows.forEach((row) => {
        const ticker = row.ticker.trim().toUpperCase();
        const found = byTicker.get(ticker);
        if (!found) byTicker.set(ticker, { row: { ...row, ticker }, appearances: 1 });
        else {
          found.appearances += 1;
          if (rowIsNewer(row, found.row)) found.row = { ...row, ticker };
        }
      });
      const rows = [...byTicker.values()].map(({ row, appearances }) => ({
        ...row,
        appearances,
        direction: directionFor(row.catalyst_quality_direction),
        importance_score: importanceFor(row),
      }));

      setData({ asOfDate, rows, reports: (reportsResult.data ?? []) as CatalystReport[] });
      setSelected((active) => active ? rows.find((row) => row.ticker === active.ticker) ?? null : null);
      if (reportsResult.error) setError("Signal rows loaded, but the report summary is temporarily unavailable.");
      setLoading(false);
    }
    void loadCatalysts();
    return () => { current = false; };
  }, [days]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const ranked = useMemo(() => [...rows].sort((a, b) => b.importance_score - a.importance_score || b.appearances - a.appearances), [rows]);
  const bullish = ranked.filter((row) => row.direction === "bullish");
  const bearish = ranked.filter((row) => row.direction === "bearish");
  const highConviction = rows.filter((row) => row.catalyst_quality_direction.startsWith("A") && row.source_confidence === "High").length;
  const directCount = rows.filter((row) => row.direct_sympathy_sector_move === "Direct").length;
  const latestReport = data?.reports[0] ?? null;

  const filtered = useMemo(() => {
    const query = search.trim().toUpperCase();
    return ranked.filter((row) => {
      if (direction !== "all" && row.direction !== direction) return false;
      return !query || [row.ticker, row.theme, row.sector, row.primary_catalyst_category, row.catalyst_tags]
        .some((value) => value.toUpperCase().includes(query));
    });
  }, [direction, ranked, search]);

  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => counts.set(row.theme, (counts.get(row.theme) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [rows]);

  return (
    <div className="catalyst-dashboard">
      <header className="catalyst-commandbar">
        <div><p className="eyebrow">Catalyst intelligence</p><h1>Executive signal board</h1><p>Ranked, de-duplicated signals from the canonical Catalyst_Table_v2 workflow.</p></div>
        <div className="catalyst-command-actions">
          <div className="catalyst-window-switch" aria-label="Catalyst date range">
            {WINDOWS.map((window) => <button key={window.value} type="button" className={days === window.value ? "active" : ""} onClick={() => setDays(window.value)}>{window.label}</button>)}
          </div>
          <span className="catalyst-asof">As of <strong>{data?.asOfDate || "—"}</strong></span>
        </div>
      </header>

      {error && <div className="catalyst-banner" role="status">{error} Journal remains fully operational.</div>}

      <section className="catalyst-kpi-grid" aria-label="Catalyst statistics">
        <article className="catalyst-kpi"><span>Active names</span><strong>{rows.length}</strong><small>{days === 1 ? "Latest trading day" : `Latest ${days} calendar days`}</small></article>
        <article className="catalyst-kpi positive-card"><span>Bullish</span><strong>{bullish.length}</strong><small>{bullish.filter((row) => row.catalyst_quality_direction.startsWith("A")).length} A-tier</small></article>
        <article className="catalyst-kpi negative-card"><span>Bearish</span><strong>{bearish.length}</strong><small>{bearish.filter((row) => row.catalyst_quality_direction.startsWith("A")).length} A-tier</small></article>
        <article className="catalyst-kpi"><span>High conviction</span><strong>{highConviction}</strong><small>High confidence · A-tier</small></article>
        <article className="catalyst-kpi"><span>Direct</span><strong>{directCount}</strong><small>{rows.length ? Math.round((directCount / rows.length) * 100) : 0}% of inventory</small></article>
      </section>

      <section className="catalyst-leadership-grid">
        <article className="catalyst-panel catalyst-leader-panel">
          <div className="catalyst-panel-head"><div><p className="eyebrow">Leadership</p><h2>Bullish priority</h2></div><span className="catalyst-count positive">{bullish.length}</span></div>
          <div className="catalyst-signal-stack">{bullish.slice(0, 4).map((row, index) => <SignalCard key={row.ticker} row={row} rank={index + 1}/>)}</div>
        </article>
        <article className="catalyst-panel catalyst-leader-panel">
          <div className="catalyst-panel-head"><div><p className="eyebrow">Risk board</p><h2>Bearish priority</h2></div><span className="catalyst-count negative">{bearish.length}</span></div>
          <div className="catalyst-signal-stack">{bearish.slice(0, 4).map((row, index) => <SignalCard key={row.ticker} row={row} rank={index + 1}/>)}</div>
        </article>
        <article className="catalyst-panel catalyst-context-panel">
          <div className="catalyst-panel-head"><div><p className="eyebrow">Tape context</p><h2>Theme concentration</h2></div></div>
          <div className="catalyst-theme-list">{themeCounts.map(([theme, count]) => <div className="catalyst-theme-row" key={theme}><div><strong>{theme}</strong><span>{count} name{count === 1 ? "" : "s"}</span></div><div className="catalyst-theme-bar"><i style={{ width: `${Math.max(12, (count / Math.max(1, themeCounts[0]?.[1] ?? 1)) * 100)}%` }}/></div></div>)}</div>
          {latestReport && <div className="catalyst-latest-report"><span>Latest brief · {formatGenerated(latestReport.generated_at_sgt)} SGT</span><strong>{latestReport.report_type}</strong><p>{latestReport.best_focus || latestReport.market_summary || "No focus note."}</p></div>}
        </article>
      </section>

      <section className="catalyst-panel catalyst-table-panel">
        <div className="catalyst-table-toolbar">
          <div><p className="eyebrow">Canonical inventory</p><h2>Signal scanner</h2></div>
          <div className="catalyst-filterbar">
            {(["all", "bullish", "bearish", "neutral"] as DirectionFilter[]).map((item) => <button type="button" key={item} className={direction === item ? "active" : ""} onClick={() => setDirection(item)}>{item}</button>)}
            <input aria-label="Search catalyst inventory" placeholder="Ticker, theme or sector" value={search} onChange={(event) => setSearch(event.target.value)}/>
          </div>
        </div>
        <div className="catalyst-table-wrap">
          <table className="catalyst-table">
            <thead><tr><th>Signal</th><th>Ticker</th><th>Grade</th><th>Catalyst</th><th>Theme</th><th>Move</th><th>Freshness</th><th>Confidence</th><th>Action</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={row.ticker} className={`row-${row.direction}`} onClick={() => setSelected(row)}>
              <td><span className={`importance-dot importance-${importanceBand(row.importance_score)}`}/><b>{row.importance_score}</b></td>
              <td><strong className="catalyst-ticker">{row.ticker}</strong>{row.appearances > 1 && <small>{row.appearances}×</small>}</td>
              <td><span className={`catalyst-grade grade-${row.direction}`}>{gradeLabel(row.catalyst_quality_direction)}</span></td>
              <td><strong>{row.primary_catalyst_category}</strong><small>{row.direct_sympathy_sector_move}</small></td>
              <td>{row.theme}</td><td>{row.move_already_done}</td><td>{row.freshness_catalyst_age}</td><td>{row.source_confidence}</td><td>{row.action_priority}</td>
            </tr>)}</tbody>
          </table>
          {loading && <div className="catalyst-empty">Loading catalyst intelligence…</div>}
          {!loading && !filtered.length && <div className="catalyst-empty">{error ? "Catalyst feed unavailable." : "No catalysts match this view."}</div>}
        </div>
      </section>

      {selected && <div className="catalyst-detail-backdrop" role="presentation" onClick={() => setSelected(null)}><aside className="catalyst-detail" role="dialog" aria-modal="true" aria-label={`${selected.ticker} catalyst detail`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="catalyst-detail-close" aria-label="Close catalyst detail" onClick={() => setSelected(null)}>×</button>
        <div className="catalyst-detail-top"><span className={`catalyst-grade grade-${selected.direction}`}>{selected.catalyst_quality_direction}</span><span>{selected.importance_score}/100</span></div>
        <h2>{selected.ticker}</h2><h3>{selected.primary_catalyst_category} · {selected.theme}</h3>
        <p>Report generated {selected.generated_at_sgt} SGT · event date {selected.catalyst_event_date??"not supplied"}. Report generation is not the source publication time.</p>
        {onChart&&<button onClick={()=>onChart({symbol:selected.ticker,mode:process.env.NEXT_PUBLIC_BRONTIDE_LOCAL==="1"?"local":"sample",adjustment:"all",asOf:selected.trading_date_checked})}>Open chart at report session</button>}
        {(selected.primary_source_evidence.match(/https?:\/\/[^\s<>"\)]+/g)??[]).map((url,i)=><p key={`${url}-${i}`}><a href={url} target="_blank" rel="noopener noreferrer">Source evidence {i+1}</a></p>)}
        <div className="catalyst-detail-section"><span>Catalyst</span><p>{selected.catalyst_summary}</p></div>
        <div className="catalyst-detail-section"><span>Trade read</span><p>{selected.trade_read}</p></div>
        <div className="catalyst-detail-section risk"><span>Risk / invalidator</span><p>{selected.risk_invalidator}</p></div>
        <dl className="catalyst-detail-grid"><div><dt>Move</dt><dd>{selected.move_already_done}</dd></div><div><dt>Liquidity</dt><dd>{selected.volume_liquidity_confirmation}</dd></div><div><dt>Freshness</dt><dd>{selected.freshness_catalyst_age}</dd></div><div><dt>Source</dt><dd>{selected.primary_source_evidence}</dd></div><div><dt>Session</dt><dd>{selected.catalyst_release_session}</dd></div><div><dt>Related</dt><dd>{selected.sympathy_related_tickers}</dd></div></dl>
      </aside></div>}
    </div>
  );
}
