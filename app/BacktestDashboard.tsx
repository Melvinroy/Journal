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

const rows: BacktestRow[] = [
  { id: "EP-016", variant: "2× ADV20 EP + quality contraction + 1 ATR stop", status: "Primary", trades: 660, wins: 134, winRate: .2030, totalReturn: 18.7314, expectancy: .4950, drawdown: 64.77, losingStreak: 34, result: "Best opportunity generator. The 2026 holdout returned +613.0% across 106 independent fixed-size trades, with 0.99R expectancy." },
  { id: "EP-003", variant: "3× ADV20 EP + quality contraction + 1 ATR stop", status: "Promising", trades: 363, wins: 71, winRate: .1956, totalReturn: 7.6485, expectancy: .3847, drawdown: 37.73, losingStreak: 20, result: "Highest-quality benchmark. The 2026 holdout returned +308.7% with lower drawdown than the 2× version." },
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

type Filter = "All" | "Leading" | "Research" | "Rejected";

function pct(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

export function BacktestDashboard() {
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<BacktestRow>(rows[0]);
  const visible = useMemo(() => rows.filter((row) => {
    if (filter === "Leading") return ["Primary", "Promising", "Validate"].includes(row.status);
    if (filter === "Research") return row.status === "Research";
    if (filter === "Rejected") return ["Rejected", "Negative"].includes(row.status);
    return true;
  }), [filter]);

  return (
    <div className="research-dashboard backtest-dashboard">
      <header className="research-commandbar">
        <div><p className="eyebrow">Strategy evidence</p><h1>Backtest</h1><p>One registry for every tested rule change and its practical trade-off.</p></div>
        <span className="research-rule-badge">Data through Sep 3, 2026</span>
      </header>

      <section className="backtest-hero">
        <div className="backtest-verdict"><span className="status-pill primary">Current primary</span><h2>2× EP volume expansion</h2><p>The broader trigger nearly preserved per-trade edge while materially increasing opportunity count. The 3× benchmark remains the cleaner, lower-drawdown scan.</p></div>
        <div className="backtest-hero-stat"><span>2026 trades</span><strong>106</strong><small>61 with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Expectancy</span><strong>+0.99R</strong><small>+1.04R with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Fixed-position return</span><strong className="positive">+613.0%</strong><small>+308.7% with 3× benchmark</small></div>
        <div className="backtest-hero-stat"><span>Max drawdown</span><strong>19.58R</strong><small>9.57R with 3× benchmark</small></div>
      </section>

      <section className="backtest-layout">
        <article className="research-panel backtest-registry-panel">
          <div className="research-toolbar">
            <div><h2>Backtest registry</h2><p>Full-sample results; select a row for interpretation.</p></div>
            <div className="backtest-filters">{(["All", "Leading", "Research", "Rejected"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
          </div>
          <div className="research-table-wrap">
            <table className="research-table backtest-table">
              <thead><tr><th>Run</th><th>Variant</th><th>Status</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>Expectancy</th><th>Total return</th><th>Max DD</th></tr></thead>
              <tbody>{visible.map((row) => <tr key={row.id} className={selected.id === row.id ? "selected" : ""} onClick={() => setSelected(row)}>
                <td><b>{row.id}</b></td><td>{row.variant}</td><td><span className={`status-pill ${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.trades.toLocaleString()}</td><td>{row.wins}</td><td>{(row.winRate * 100).toFixed(1)}%</td><td className={row.expectancy >= 0 ? "metric-good" : "metric-bad"}>{row.expectancy >= 0 ? "+" : ""}{row.expectancy.toFixed(3)}R</td><td className={row.totalReturn >= 0 ? "metric-good" : "metric-bad"}>{pct(row.totalReturn)}</td><td>{row.drawdown.toFixed(2)}R</td>
              </tr>)}</tbody>
            </table>
          </div>
        </article>

        <aside className="backtest-side">
          <article className="research-panel backtest-detail">
            <p className="eyebrow">Selected test · {selected.id}</p>
            <h2>{selected.variant}</h2>
            <p>{selected.result}</p>
            <dl><div><dt>Losses</dt><dd>{(selected.trades - selected.wins).toLocaleString()}</dd></div><div><dt>Longest losing streak</dt><dd>{selected.losingStreak}</dd></div></dl>
          </article>
          <article className="research-panel conditions-panel">
            <div><p className="eyebrow">Live scan definition</p><h2>Current conditions</h2></div>
            <div className="conditions-list">{conditions.map(([label, value]) => <div key={label}><strong>{label}</strong><span>{value}</span></div>)}</div>
            <p className="condition-caveat">The `RVOL &lt; 0.95` relaxation is active in Scans but still needs its own full historical outcome run. Registry performance for EP-016 uses the previously tested `RVOL &lt; 0.75` setup rule.</p>
          </article>
        </aside>
      </section>

      <p className="research-footnote">Returns are arithmetic sums from a fresh equal-sized position per trade, not compounded portfolio returns. Overlapping positions require separate capital.</p>
    </div>
  );
}
