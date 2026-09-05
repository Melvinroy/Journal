"use client";

import { useEffect, useMemo, useState } from "react";

type ScanRow = {
  symbol: string;
  event_date: string;
  setup_date: string;
  age: number;
  close: number;
  relvol: number;
  ep_volume_ratio: number;
  body_atr: number;
  range_atr: number;
  distance_atr: number;
};

const DATA_AS_OF = "2026-09-03";
const DEFAULT_FROM = "2026-08-05";

function parseCsv(text: string): ScanRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return {
      symbol: row.symbol,
      event_date: row.event_date,
      setup_date: row.setup_date,
      age: Number(row.age),
      close: Number(row.close),
      relvol: Number(row.relvol),
      ep_volume_ratio: Number(row.ep_volume_ratio),
      body_atr: Number(row.body_atr),
      range_atr: Number(row.range_atr),
      distance_atr: Number(row.distance_atr),
    };
  });
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export function ScansDashboard() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DATA_AS_OF);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("./data/scan_2x_rvol95.csv")
      .then((response) => {
        if (!response.ok) throw new Error("Scan history could not be loaded.");
        return response.text();
      })
      .then((text) => setRows(parseCsv(text)))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => rows.filter((row) => (
    row.setup_date >= from
    && row.setup_date <= to
    && (!search || row.symbol.includes(search.trim().toUpperCase()))
  )), [rows, from, to, search]);

  const signalDays = new Set(filtered.map((row) => row.setup_date)).size;
  const newest = filtered[0];

  function setWindow(days: number) {
    setTo(DATA_AS_OF);
    setFrom(shiftDate(DATA_AS_OF, -(days - 1)));
  }

  function moveWindow(direction: -1 | 1) {
    const span = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1);
    setFrom(shiftDate(from, direction * span));
    setTo(shiftDate(to, direction * span));
  }

  return (
    <div className="research-dashboard scan-dashboard">
      <header className="research-commandbar">
        <div>
          <p className="eyebrow">EP contraction scanner</p>
          <h1>Scans</h1>
          <p>Static research snapshot. Candidates have not been reproduced on the final frozen historical universe.</p>
        </div>
        <span className="research-rule-badge">2× EP · RVOL &lt; 0.95</span>
      </header>

      <section className="research-kpis" aria-label="Scan summary">
        <article><span>Candidates</span><strong>{filtered.length}</strong><small>{displayDate(from)} – {displayDate(to)}</small></article>
        <article><span>Signal days</span><strong>{signalDays}</strong><small>{signalDays ? (filtered.length / signalDays).toFixed(1) : "0.0"} average per active day</small></article>
        <article><span>Latest signal</span><strong>{newest?.symbol || "None"}</strong><small>{newest ? displayDate(newest.setup_date) : "No match in range"}</small></article>
        <article><span>Snapshot through</span><strong>Sep 3, 2026</strong><small>Static CSV · not a live scan</small></article>
      </section>

      <section className="research-panel scan-table-panel">
        <div className="research-toolbar">
          <div>
            <h2>Candidate history</h2>
            <p>Archived first qualifying setups. Date shortcuts currently use calendar days.</p>
          </div>
          <div className="scan-controls">
            <div className="scan-quick-range" aria-label="Quick calendar-day date ranges">
              {[15, 30, 60, 90].map((days) => <button key={days} className={from === shiftDate(DATA_AS_OF, -(days - 1)) && to === DATA_AS_OF ? "active" : ""} onClick={() => setWindow(days)} title={`${days} calendar days`}>{days}D</button>)}
            </div>
            <button className="scan-step" onClick={() => moveWindow(-1)} aria-label="Previous date window">←</button>
            <label>From<input type="date" value={from} min="2024-02-06" max={to} onChange={(event) => setFrom(event.target.value)}/></label>
            <label>To<input type="date" value={to} min={from} max={DATA_AS_OF} onChange={(event) => setTo(event.target.value)}/></label>
            <button className="scan-step" disabled={to >= DATA_AS_OF} onClick={() => moveWindow(1)} aria-label="Next date window">→</button>
            <input className="scan-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ticker" aria-label="Search ticker"/>
          </div>
        </div>

        {error ? <p className="research-empty">{error}</p> : loading ? <p className="research-empty">Loading scan history…</p> : (
          <div className="research-table-wrap">
            <table className="research-table scan-table">
              <thead><tr><th>Setup date</th><th>Ticker</th><th>EP date</th><th>EP age</th><th>Close</th><th>Setup RVOL</th><th>Setup / EP vol</th><th>Body / ATR</th><th>Range / ATR</th><th>From high</th></tr></thead>
              <tbody>
                {filtered.map((row) => <tr key={`${row.symbol}-${row.event_date}-${row.setup_date}`}>
                  <td>{displayDate(row.setup_date)}</td>
                  <td className="research-ticker">{row.symbol}</td>
                  <td>{displayDate(row.event_date)}</td>
                  <td>{row.age} sessions</td>
                  <td>${row.close.toFixed(2)}</td>
                  <td><span className={row.relvol >= .75 ? "metric-warn" : "metric-good"}>{row.relvol.toFixed(2)}×</span></td>
                  <td>{(row.ep_volume_ratio * 100).toFixed(1)}%</td>
                  <td>{row.body_atr.toFixed(2)}</td>
                  <td>{row.range_atr.toFixed(2)}</td>
                  <td>{row.distance_atr.toFixed(2)} ATR</td>
                </tr>)}
              </tbody>
            </table>
            {!filtered.length && <p className="research-empty">No candidates in this date range.</p>}
          </div>
        )}
      </section>

      <p className="research-footnote">Screening research only. The table uses the first signal per EP, not repeated qualifying days. A candidate is not an automatic trade recommendation.</p>
    </div>
  );
}
