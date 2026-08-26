"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Trade = {
  id: number;
  symbol: string;
  side: "Long" | "Short";
  setup: string;
  date: string;
  pnl: number;
  r: number;
  grade: "A" | "B" | "C";
};

const seedTrades: Trade[] = [
  { id: 1, symbol: "NVDA", side: "Long", setup: "Earnings gap", date: "Aug 24", pnl: 1240, r: 3.2, grade: "A" },
  { id: 2, symbol: "MDB", side: "Long", setup: "EP breakout", date: "Aug 23", pnl: 680, r: 2.1, grade: "A" },
  { id: 3, symbol: "PLTR", side: "Long", setup: "10/20 pullback", date: "Aug 22", pnl: -310, r: -1, grade: "B" },
  { id: 4, symbol: "MSTR", side: "Short", setup: "Failed breakout", date: "Aug 21", pnl: 890, r: 2.8, grade: "A" },
];

const nav = [
  ["Overview", "grid"],
  ["Trades", "candles"],
  ["Daily journal", "note"],
  ["Playbook", "book"],
  ["Insights", "spark"],
] as const;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    candles: <path d="M7 3v3m0 8v7M4 6h6v8H4zM17 3v7m0 8v3m-3-11h6v8h-6z"/>,
    note: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22z"/></>,
    spark: <><path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>, check: <path d="m5 12 4 4L19 6"/>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function formatMoney(value: number) {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(value).toLocaleString()}`;
}

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [trades, setTrades] = useState<Trade[]>(seedTrades);
  const [modal, setModal] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [todayLabel, setTodayLabel] = useState("Trading overview");
  const [greeting, setGreeting] = useState("Welcome back, Melvin");

  useEffect(() => {
    const saved = window.localStorage.getItem("journal-trades");
    if (saved) try { setTrades(JSON.parse(saved)); } catch { /* keep demo data */ }
    const now = new Date();
    setTodayLabel(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now));
    setGreeting(`${now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"}, Melvin`);
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) window.localStorage.setItem("journal-trades", JSON.stringify(trades)); }, [trades, hydrated]);

  const stats = useMemo(() => {
    const pnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
    const wins = trades.filter((trade) => trade.pnl > 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
    return { pnl, winRate: Math.round((wins.length / trades.length) * 100), profitFactor: grossLoss ? (grossWin / grossLoss).toFixed(2) : "—" };
  }, [trades]);

  function addTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pnl = Number(data.get("pnl"));
    setTrades((current) => [{
      id: Date.now(), symbol: String(data.get("symbol") || "NEW").toUpperCase(), side: data.get("side") as "Long" | "Short",
      setup: String(data.get("setup") || "Unclassified"), date: "Today", pnl,
      r: Number(data.get("r")) || (pnl >= 0 ? 1 : -1), grade: data.get("grade") as "A" | "B" | "C",
    }, ...current]);
    setModal(false);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">J</span><span>Journal</span></div>
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(([label, icon]) => <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => setActive(label)}><Icon name={icon}/><span>{label}</span>{label === "Daily journal" && <i>3</i>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="weekly-card"><div className="weekly-icon"><Icon name="target" size={17}/></div><p>Weekly focus</p><strong>Respect the stop</strong><div className="progress"><span style={{ width: "72%" }}/></div><small>5 of 7 sessions reviewed</small></div>
        <button className="profile"><span className="avatar">MR</span><span><b>Melvin Roy</b><small>Momentum trader</small></span><Icon name="more" size={16}/></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{todayLabel}</p><h1>{active === "Overview" ? greeting : active}</h1></div>
          <div className="header-actions"><button className="date-button"><Icon name="calendar" size={16}/> This month</button><button className="primary-button" onClick={() => setModal(true)}><Icon name="plus" size={17}/> Log trade</button></div>
        </header>

        <div className="content-grid">
          <div className="main-column">
            <section className="stat-grid" aria-label="Trading statistics">
              <article className="stat-card hero-stat"><div className="stat-top"><span>Net P&amp;L</span><span className="trend up">↗ 12.8%</span></div><strong>{formatMoney(stats.pnl)}</strong><p>vs. +$3,795 last month</p></article>
              <article className="stat-card"><div className="stat-top"><span>Win rate</span><span className="trend up">↗ 4.2%</span></div><strong>{stats.winRate}%</strong><p>{trades.filter(t => t.pnl > 0).length} wins · {trades.filter(t => t.pnl <= 0).length} losses</p></article>
              <article className="stat-card"><div className="stat-top"><span>Profit factor</span><span className="trend">Top 18%</span></div><strong>{stats.profitFactor}</strong><p>Target above 2.00</p></article>
              <article className="stat-card discipline-card"><div className="stat-top"><span>Discipline</span><span className="trend up">Strong</span></div><strong>87<small>/100</small></strong><p>Best streak: 6 days</p></article>
            </section>

            <section className="panel performance-panel">
              <div className="panel-heading"><div><p className="section-kicker">Performance</p><h2>Equity curve</h2></div><div className="period-tabs"><button>1W</button><button className="selected">1M</button><button>3M</button><button>YTD</button></div></div>
              <div className="chart-summary"><strong>+$4,280</strong><span>+$1,335 this week</span></div>
              <div className="chart-wrap" aria-label="Rising monthly equity curve chart">
                <svg viewBox="0 0 760 220" role="img"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#26a97b" stopOpacity=".22"/><stop offset="1" stopColor="#26a97b" stopOpacity="0"/></linearGradient></defs>{[30,80,130,180].map(y => <line key={y} x1="0" y1={y} x2="760" y2={y} className="gridline"/>)}<path className="area" d="M0 190 C55 182 75 168 110 174 S170 150 215 157 S270 118 315 126 S380 139 430 105 S495 119 540 84 S615 96 660 55 S720 52 760 25 L760 220 L0 220 Z"/><path className="line" d="M0 190 C55 182 75 168 110 174 S170 150 215 157 S270 118 315 126 S380 139 430 105 S495 119 540 84 S615 96 660 55 S720 52 760 25"/><circle cx="660" cy="55" r="5" className="point"/><circle cx="760" cy="25" r="6" className="point current"/></svg>
                <div className="chart-labels"><span>Aug 1</span><span>Aug 8</span><span>Aug 15</span><span>Aug 22</span><span>Today</span></div>
              </div>
            </section>

            <section className="panel trades-panel">
              <div className="panel-heading"><div><p className="section-kicker">Journal</p><h2>Recent trades</h2></div><button className="text-button" onClick={() => setActive("Trades")}>View all <Icon name="arrow" size={15}/></button></div>
              <div className="trade-table">
                <div className="trade-row table-head"><span>Trade</span><span>Setup</span><span>Result</span><span>R multiple</span><span>Grade</span></div>
                {trades.slice(0, 4).map((trade) => <div className="trade-row" key={trade.id}><span className="ticker-cell"><b>{trade.symbol}</b><small>{trade.side} · {trade.date}</small></span><span>{trade.setup}</span><span className={trade.pnl >= 0 ? "positive" : "negative"}>{formatMoney(trade.pnl)}</span><span className={trade.r >= 0 ? "positive" : "negative"}>{trade.r > 0 ? "+" : ""}{trade.r.toFixed(1)}R</span><span><i className={`grade grade-${trade.grade.toLowerCase()}`}>{trade.grade}</i></span></div>)}
              </div>
            </section>
          </div>

          <aside className="right-column">
            <section className="review-card"><div className="review-top"><span className="review-orb">✦</span><span className="status-dot">Ready to review</span></div><p className="section-kicker">Today’s reflection</p><h2>Turn today’s trades into tomorrow’s edge.</h2><p>Three focused prompts. About four minutes.</p><button>Start daily review <Icon name="arrow" size={16}/></button></section>
            <section className="panel edge-panel"><div className="panel-heading"><div><p className="section-kicker">Your edge</p><h2>Setup performance</h2></div><button className="icon-button"><Icon name="more"/></button></div><div className="setup-list"><div><span><i className="setup-dot green"/>EP breakout</span><b>+3.1R</b></div><div><span><i className="setup-dot blue"/>Earnings gap</span><b>+2.4R</b></div><div><span><i className="setup-dot gold"/>10/20 pullback</span><b>+1.6R</b></div><div><span><i className="setup-dot red"/>Anticipation</span><b className="negative">−0.8R</b></div></div><p className="insight"><span>✦</span><span><b>Pattern spotted</b>Your EP breakouts work best before 11:00 AM.</span></p></section>
          </aside>
        </div>
      </section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="section-kicker">New entry</p><h2 id="modal-title">Log a trade</h2></div><button className="icon-button" aria-label="Close" onClick={() => setModal(false)}><Icon name="close"/></button></div><form onSubmit={addTrade}><div className="form-row"><label>Symbol<input name="symbol" placeholder="NVDA" required autoFocus/></label><label>Side<select name="side"><option>Long</option><option>Short</option></select></label></div><label>Setup<select name="setup"><option>EP breakout</option><option>Earnings gap</option><option>10/20 pullback</option><option>Failed breakout</option><option>Anticipation</option></select></label><div className="form-row"><label>P&amp;L ($)<input name="pnl" type="number" placeholder="450" required/></label><label>R multiple<input name="r" type="number" step="0.1" placeholder="2.5"/></label></div><label>Execution grade<select name="grade"><option value="A">A · Followed every rule</option><option value="B">B · Minor deviation</option><option value="C">C · Broke the plan</option></select></label><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setModal(false)}>Cancel</button><button type="submit" className="primary-button"><Icon name="check" size={16}/> Save trade</button></div></form></section></div>}
    </main>
  );
}
