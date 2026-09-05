"use client";

import { useMemo, useState } from "react";

type BacktestRow = {
  id: string;
  variant: string;
  status: "Primary" | "Promising" | "Validate" | "Research" | "Rejected" | "Negative";
  trades: number;
  wins: number;
  winRate: number;
  totalReturn: number;
  expectancy: number;
  drawdown: number;
  losingStreak: number;
  result: string;
};

type TradeDetail = {
  strategy_id: string;
  symbol: string;
  result: "Winner" | "Loser";
  event_date: string;
  event_return: number;
  event_volume: number;
  event_rvol: number;
  setup_date: string;
  entry_date: string;
  entry: number;
  stop: number;
  exit_date: string;
  exit_reason: string;
  net_R: number;
  net_return: number;
  stopped: number;
  hit_10R: number;
};

const rows: BacktestRow[] = [
  { id: "EP-016", variant: "2× ADV20 EP + quality contraction + 1 ATR stop", status: "Primary", trades: 660, wins: 134, winRate: .2030, totalReturn: 18.7314, expectancy: .4950, drawdown: 64.77, losingStreak: 34, result: "Earlier 2× EP / setup RVOL < 0.75 experiment. These results require reproduction on the final frozen historical universe." },
  { id: "EP-003", variant: "3× ADV20 EP + quality contraction + 1 ATR stop", status: "Promising", trades: 363, wins: 71, winRate: .1956, totalReturn: 7.6485, expectancy: .3847, drawdown: 37.73, losingStreak: 20, result: "Earlier strict benchmark. These results require reproduction on the final frozen historical universe." },
  { id: "EP-001", variant: "Loose contraction + setup-day-low stop", status: "Negative", trades: 2174, wins: 220, winRate: .1012, totalReturn: -.0774, expectancy: -.3373, drawdown: 790.95, losingStreak: 68, result: "Large right tails did not offset the very high stop rate." },
  { id: "EP-002", variant: "Quality contraction + setup-day-low stop", status: "Negative", trades: 342, wins: 51, winRate: .1491, totalReturn: .0179, expectancy: -.1280, drawdown: 140.11, losingStreak: 25, result: "Positive fixed-position dollars, but negative expectancy under equal-R sizing." },
  { id: "EP-004", variant: "A+ event shock + quality + 1 ATR", status: "Promising", trades: 147, wins: 32, winRate: .2177, totalReturn: 4.4031, expectancy: .5362, drawdown: 23.23, losingStreak: 13, result: "Strongest event-quality cohort, but with fewer opportunities." },
  { id: "EP-005", variant: "A+ plus bullish QQQ short and long trends", status: "Validate", trades: 75, wins: 18, winRate: .24, totalReturn: 2.9146, expectancy: .7178, drawdown: 14.68, losingStreak: 15, result: "Stronger per trade, but the market filters were examined after seeing the main result." },
  { id: "MOM-001", variant: "30% monthly-gainer common-breakout proxy", status: "Research", trades: 506, wins: 57, winRate: .1126, totalReturn: 3.1887, expectancy: .6947, drawdown: 85.92, losingStreak: 60, result: "Positive, but extremely dependent on rare 20R tail winners." },
  { id: "EP-006", variant: "Strict setup + within 2 ATR of post-EP high", status: "Validate", trades: 635, wins: 115, winRate: .1811, totalReturn: 7.7414, expectancy: .2036, drawdown: 59.28, losingStreak: 39, result: "More frequency, but expectancy nearly halves versus the 1 ATR benchmark." },
  { id: "EP-007", variant: "Strict setup + within 3 ATR of post-EP high", status: "Research", trades: 810, wins: 148, winRate: .1827, totalReturn: 8.3485, expectancy: .2298, drawdown: 68.93, losingStreak: 49, result: "High headline arithmetic return, but weaker holdout behaviour." },
  { id: "EP-008", variant: "Strict setup + within 4 ATR of post-EP high", status: "Rejected", trades: 911, wins: 161, winRate: .1767, totalReturn: .0897, expectancy: .1663, drawdown: 81.68, losingStreak: 55, result: "No practical improvement; the fixed-position result is near flat." },
  { id: "EP-009", variant: "Strict setup + within 5 ATR of post-EP high", status: "Rejected", trades: 976, wins: 168, winRate: .1721, totalReturn: -.0435, expectancy: .1294, drawdown: 94.08, losingStreak: 62, result: "Negative fixed-position return; added distance dilutes the edge." },
  { id: "EP-010", variant: "Strict setup + no post-EP-high limit", status: "Rejected", trades: 1079, wins: 177, winRate: .1640, totalReturn: -.2075, expectancy: .0561, drawdown: 111.28, losingStreak: 73, result: "Removing proximity produces too many weak setups." },
  { id: "EP-011", variant: "A+ quality + within 2 ATR of post-EP high", status: "Validate", trades: 294, wins: 56, winRate: .1905, totalReturn: 3.8736, expectancy: .2725, drawdown: 51.15, losingStreak: 23, result: "Frequency fallback with lower tail robustness than A+ within 1 ATR." },
  { id: "EP-012", variant: "A+ quality + within 3 ATR of post-EP high", status: "Research", trades: 417, wins: 78, winRate: .1871, totalReturn: 4.6154, expectancy: .3080, drawdown: 72.56, losingStreak: 31, result: "Positive overall R expectancy, but weak 2026 fixed-position results." },
  { id: "EP-013", variant: "A+ quality + within 4 ATR of post-EP high", status: "Rejected", trades: 494, wins: 86, winRate: .1741, totalReturn: -.0379, expectancy: .1610, drawdown: 75.58, losingStreak: 35, result: "Negative fixed-position returns overall and in the 2026 holdout." },
  { id: "EP-014", variant: "A+ quality + within 5 ATR of post-EP high", status: "Rejected", trades: 553, wins: 91, winRate: .1646, totalReturn: -.1164, expectancy: .0788, drawdown: 93.43, losingStreak: 42, result: "Proximity relaxation is too loose." },
  { id: "EP-015", variant: "A+ quality + no post-EP-high limit", status: "Rejected", trades: 647, wins: 99, winRate: .1530, totalReturn: -.2670, expectancy: -.0259, drawdown: 143.69, losingStreak: 53, result: "No proximity limit removes the A+ edge in both full and holdout samples." },
];

const conditions = [
  ["EP trigger", "Close ≥ 4%; volume ≥ 8.9M; volume ≥ 2× inclusive ADV20; price > $3"],
  ["Setup window", "3–15 trading sessions after EP"],
  ["Trend", "Close > SMA10 > SMA20"],
  ["Compression", "Body < 0.25 ATR14 and full range < 0.75 ATR14"],
  ["Volume dry-up", "Setup volume < 0.95× prior ADV20 and < 50% of EP-day volume"],
  ["Quality gates", "No major distribution day; within 1 ATR of the post-EP high"],
  ["Execution", "Next open; stop = entry − setup-day ATR14; 10R target or 60 sessions"],
];

type Filter = "All" | "Legacy shortlist" | "Research" | "Rejected";
type ResultFilter = "All" | "Winners" | "Losers";

const detailIds = new Set(["EP-016", "EP-003", "EP-004"]);

function parseTrades(text: string): TradeDetail[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    const item = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return {
      strategy_id: item.strategy_id,
      symbol: item.symbol,
      result: item.result as "Winner" | "Loser",
      event_date: item.event_date,
      event_return: Number(item.event_return),
      event_volume: Number(item.event_volume),
      event_rvol: Number(item.event_rvol),
      setup_date: item.setup_date,
      entry_date: item.entry_date,
      entry: Number(item.entry),
      stop: Number(item.stop),
      exit_date: item.exit_date,
      exit_reason: item.exit_reason,
      net_R: Number(item.net_R),
      net_return: Number(item.net_return),
      stopped: Number(item.stopped),
      hit_10R: Number(item.hit_10R),
    };
  });
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function pct(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

export function BacktestDashboard() {
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<BacktestRow>(rows[0]);
  const [detailStrategy, setDetailStrategy] = useState<BacktestRow | null>(null);
  const [tradeDetails, setTradeDetails] = useState<TradeDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("All");
  const [detailSearch, setDetailSearch] = useState("");
  const [visibleRows, setVisibleRows] = useState(100);
  const visible = useMemo(() => rows.filter((row) => {
    if (filter === "Legacy shortlist") return ["Primary", "Promising", "Validate"].includes(row.status);
    if (filter === "Research") return row.status === "Research";
    if (filter === "Rejected") return ["Rejected", "Negative"].includes(row.status);
    return true;
  }), [filter]);

  const filteredDetails = useMemo(() => tradeDetails.filter((trade) => (
    (resultFilter === "All" || trade.result === resultFilter.slice(0, -1))
    && (!detailSearch || trade.symbol.includes(detailSearch.trim().toUpperCase()))
  )), [tradeDetails, resultFilter, detailSearch]);

  const detailStats = useMemo(() => ({
    winners: tradeDetails.filter((trade) => trade.result === "Winner").length,
    losers: tradeDetails.filter((trade) => trade.result === "Loser").length,
    targets: tradeDetails.filter((trade) => trade.hit_10R === 1).length,
    stops: tradeDetails.filter((trade) => trade.stopped === 1).length,
  }), [tradeDetails]);

  async function openStrategy(row: BacktestRow) {
    setSelected(row);
    if (!detailIds.has(row.id)) return;
    setDetailStrategy(row);
    setTradeDetails([]);
    setDetailError("");
    setResultFilter("All");
    setDetailSearch("");
    setVisibleRows(100);
    setDetailLoading(true);
    try {
      const response = await fetch(`./data/${row.id.toLowerCase()}_trades.csv`);
      if (!response.ok) throw new Error("Trade details could not be loaded.");
      setTradeDetails(parseTrades(await response.text()));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Trade details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="research-dashboard backtest-dashboard">
      <header className="research-commandbar">
        <div><p className="eyebrow">Strategy evidence</p><h1>Backtest</h1><p>Archived experiments. All results remain provisional until reproduced on the final frozen historical universe.</p></div>
        <span className="research-rule-badge">Legacy results · not revalidated</span>
      </header>

      <section className="backtest-hero">
        <div className="backtest-verdict"><span className="status-pill research">Provisional evidence</span><h2>2× EP volume experiment</h2><p>Earlier results predate the final historical database. They do not validate the broader RVOL &lt; 0.95 scan or establish a preferred strategy.</p></div>
        <div className="backtest-hero-stat"><span>Legacy 2026 trades</span><strong>106</strong><small>61 with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Expectancy</span><strong>+0.99R</strong><small>+1.04R with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Fixed-position return</span><strong className="positive">+613.0%</strong><small>+308.7% with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Max drawdown</span><strong>19.58R</strong><small>9.57R with 3× benchmark</small></div>
      </section>

      <section className="backtest-layout">
        <article className="research-panel backtest-registry-panel">
          <div className="research-toolbar">
            <div><h2>Backtest registry</h2><p>Legacy full-sample results; classifications reflect the earlier study only.</p></div>
            <div className="backtest-filters">{(["All", "Legacy shortlist", "Research", "Rejected"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
          </div>
          <div className="research-table-wrap">
            <table className="research-table backtest-table">
              <thead><tr><th>Run</th><th>Variant</th><th>Legacy classification</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>Expectancy</th><th>Total return</th><th>Max DD</th><th>Evidence</th></tr></thead>
              <tbody>{visible.map((row) => <tr key={row.id} className={selected.id === row.id ? "selected" : ""} onClick={() => openStrategy(row)}>
                <td><b>{row.id}</b></td><td>{row.variant}</td><td><span className={`status-pill ${row.status.toLowerCase()}`}>{row.status === "Primary" ? "Previously primary" : row.status}</span></td><td>{row.trades.toLocaleString()}</td><td>{row.wins}</td><td>{(row.winRate * 100).toFixed(1)}%</td><td className={row.expectancy >= 0 ? "metric-good" : "metric-bad"}>{row.expectancy >= 0 ? "+" : ""}{row.expectancy.toFixed(3)}R</td><td className={row.totalReturn >= 0 ? "metric-good" : "metric-bad"}>{pct(row.totalReturn)}</td><td>{row.drawdown.toFixed(2)}R</td><td><span className={detailIds.has(row.id) ? "detail-available" : "detail-summary"}>{detailIds.has(row.id) ? "View trades →" : "Summary"}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
        </article>

        <aside className="backtest-side">
          <article className="research-panel backtest-detail">
            <p className="eyebrow">Provisional test · {selected.id}</p>
            <h2>{selected.variant}</h2>
            <p>Earlier interpretation: {selected.result}</p>
            <dl><div><dt>Losses</dt><dd>{(selected.trades - selected.wins).toLocaleString()}</dd></div><div><dt>Longest losing streak</dt><dd>{selected.losingStreak}</dd></div></dl>
          </article>
          <article className="research-panel conditions-panel">
            <div><p className="eyebrow">Separate candidate definition</p><h2>Broader scan conditions</h2></div>
            <div className="conditions-list">{conditions.map(([label, value]) => <div key={label}><strong>{label}</strong><span>{value}</span></div>)}</div>
            <p className="condition-caveat">The static Scans snapshot uses RVOL &lt; 0.95. The archived EP-016 results use RVOL &lt; 0.75. Both require separate, versioned reruns on the final frozen historical universe.</p>
          </article>
        </aside>
      </section>

      <p className="research-footnote">Returns are arithmetic sums from a fresh equal-sized position per trade, not compounded portfolio returns. Overlapping positions require separate capital.</p>

      {detailStrategy && <div className="trade-detail-backdrop" onMouseDown={() => setDetailStrategy(null)}>
        <section className="trade-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="trade-detail-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="trade-detail-close" onClick={() => setDetailStrategy(null)} aria-label="Close trade details">×</button>
          <header className="trade-detail-header">
            <div><p className="eyebrow">{detailStrategy.id} · provisional legacy cohort</p><h2 id="trade-detail-title">Winners and losers</h2><p>{detailStrategy.variant} · not reproduced on the final historical database</p></div>
            <a href={`./data/${detailStrategy.id.toLowerCase()}_trades.csv`} download>Download CSV</a>
          </header>
          <div className="trade-detail-kpis">
            <div><span>Trades</span><strong>{tradeDetails.length || detailStrategy.trades}</strong></div>
            <div><span>Winners</span><strong className="positive">{detailStats.winners}</strong></div>
            <div><span>Losers</span><strong className="negative">{detailStats.losers}</strong></div>
            <div><span>10R targets</span><strong>{detailStats.targets}</strong></div>
            <div><span>Stopped</span><strong>{detailStats.stops}</strong></div>
          </div>
          <div className="trade-detail-toolbar">
            <div className="backtest-filters">{(["All", "Winners", "Losers"] as ResultFilter[]).map((item) => <button key={item} className={resultFilter === item ? "active" : ""} onClick={() => { setResultFilter(item); setVisibleRows(100); }}>{item}</button>)}</div>
            <input value={detailSearch} onChange={(event) => { setDetailSearch(event.target.value); setVisibleRows(100); }} placeholder="Search ticker" aria-label="Search trade ticker"/>
            <span>{filteredDetails.length} rows</span>
          </div>
          {detailLoading ? <p className="research-empty">Loading every trade…</p> : detailError ? <p className="research-empty">{detailError}</p> : <>
            <div className="trade-detail-table-wrap">
              <table className="trade-detail-table">
                <thead><tr><th>Ticker</th><th>Result</th><th>EP date</th><th>EP move</th><th>EP expansion</th><th>Setup trigger</th><th>Entry date</th><th>Exit date</th><th>Entry</th><th>Stop</th><th>Outcome</th><th>Exit type</th></tr></thead>
                <tbody>{filteredDetails.slice(0, visibleRows).map((trade, index) => <tr key={`${trade.symbol}-${trade.event_date}-${trade.setup_date}-${index}`}>
                  <td className="research-ticker">{trade.symbol}</td><td><span className={`trade-result-pill ${trade.result.toLowerCase()}`}>{trade.result}</span></td><td>{shortDate(trade.event_date)}</td><td>{pct(trade.event_return)}</td><td>{trade.event_rvol.toFixed(2)}×<small>{(trade.event_volume / 1_000_000).toFixed(1)}M shares</small></td><td>{shortDate(trade.setup_date)}</td><td>{shortDate(trade.entry_date)}</td><td>{shortDate(trade.exit_date)}</td><td>${trade.entry.toFixed(2)}</td><td>${trade.stop.toFixed(2)}</td><td className={trade.net_R > 0 ? "metric-good" : "metric-bad"}>{trade.net_R > 0 ? "+" : ""}{trade.net_R.toFixed(2)}R<small>{pct(trade.net_return)}</small></td><td>{trade.exit_reason}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {visibleRows < filteredDetails.length && <button className="load-more-trades" onClick={() => setVisibleRows((count) => count + 100)}>Show 100 more</button>}
          </>}
          <p className="trade-detail-note">EP expansion is event-day volume divided by inclusive ADV20. Setup trigger is the qualifying contraction day; entry is the following session’s open.</p>
        </section>
      </div>}
    </div>
  );
}
