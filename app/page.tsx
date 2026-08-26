"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Grade = "A" | "B" | "C";
type RangeKey = "30" | "90" | "ytd" | "all";
type EquityMode = "dollar" | "r";

type Trade = {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  setup: string;
  date: string;
  pnl: number;
  r: number;
  risk: number;
  plannedR: number;
  grade: Grade;
};

const setups = ["Momentum breakout", "EP breakout", "Earnings gap", "10/20 pullback", "VWAP rejection"];

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const nav = [
  ["Dashboard", "grid"],
] as const;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    candles: <path d="M7 3v3m0 8v7M4 6h6v8H4zM17 3v7m0 8v3m-3-11h6v8h-6z"/>,
    note: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22z"/></>,
    spark: <><path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 19h14"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function formatMoney(value: number, showPlus = true) {
  const sign = value < 0 ? "−" : showPlus ? "+" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

function formatR(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(value % 1 === 0 ? 1 : 2)}R`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getCutoff(range: RangeKey) {
  if (range === "all") return null;
  const now = new Date();
  if (range === "ytd") return new Date(now.getFullYear(), 0, 1);
  now.setDate(now.getDate() - Number(range));
  return now;
}

type TradeRow = {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  setup: string;
  trade_date: string;
  pnl: number | string;
  realized_r: number | string;
  dollar_risk: number | string;
  planned_r: number | string;
  grade: Grade;
};

function fromRow(row: TradeRow): Trade {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    setup: row.setup,
    date: row.trade_date,
    pnl: Number(row.pnl),
    r: Number(row.realized_r),
    risk: Number(row.dollar_risk),
    plannedR: Number(row.planned_r),
    grade: row.grade,
  };
}

function toRow(trade: Omit<Trade, "id">) {
  return {
    symbol: trade.symbol,
    side: trade.side,
    setup: trade.setup,
    trade_date: trade.date,
    pnl: trade.pnl,
    realized_r: trade.r,
    dollar_risk: trade.risk,
    planned_r: trade.plannedR,
    grade: trade.grade,
  };
}

type AuthMode = "signin" | "signup" | "forgot" | "recovery";

function AuthScreen({ mode, setMode, onRecovered }: { mode: AuthMode; setMode: (mode: AuthMode) => void; onRecovered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    let result: { error: { message: string } | null };

    if (mode === "signup") {
      result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (!result.error) setMessage("If this email is new, check your inbox to confirm it. If you already have an account, return to sign in or reset your password.");
    } else if (mode === "forgot") {
      result = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (!result.error) setMessage("Password-reset link sent. Please check your email.");
    } else if (mode === "recovery") {
      result = await supabase.auth.updateUser({ password });
      if (!result.error) {
        setMessage("Password updated securely.");
        onRecovered();
      }
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }

    if (result.error) setError(result.error.message);
    setBusy(false);
  }

  const title = mode === "signup" ? "Create your journal" : mode === "forgot" ? "Reset your password" : mode === "recovery" ? "Choose a new password" : "Welcome back";
  const subtitle = mode === "signup" ? "Your trades stay private and synchronized across devices." : mode === "forgot" ? "We’ll send a secure recovery link to your email." : mode === "recovery" ? "Use at least eight characters for your new password." : "Sign in to open your private trading workspace.";

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span className="brand-mark"><Icon name="spark" size={19}/></span><span>Journal</span></div>
        <div className="auth-brand-copy"><p className="eyebrow">Asymmetric Edge Labs</p><h1>Review clearly.<br/>Trade deliberately.</h1><p>A private decision cockpit for measuring risk, execution and the outcomes that build your edge.</p></div>
        <div className="auth-proof"><span>Secure cloud journal</span><span>Multi-device sync</span><span>Private by design</span></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-card">
          <p className="eyebrow">Trading Journal</p>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          <form onSubmit={submit}>
            {mode !== "recovery" && <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required autoFocus/></label>}
            {mode !== "forgot" && <label>{mode === "recovery" ? "New password" : "Password"}<input name="password" type="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="At least 8 characters" required autoFocus={mode === "recovery"}/></label>}
            {error && <p className="auth-message error" role="alert">{error}</p>}
            {message && <p className="auth-message success" role="status">{message}</p>}
            <button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "recovery" ? "Update password" : "Sign in"}</button>
          </form>
          {mode === "signin" && <div className="auth-links"><button onClick={() => setMode("forgot")}>Forgot password?</button><button onClick={() => setMode("signup")}>Create account</button></div>}
          {mode !== "signin" && mode !== "recovery" && <button className="auth-back" onClick={() => setMode("signin")}>← Back to sign in</button>}
        </div>
      </section>
    </main>
  );
}

function EquityChart({ trades, mode }: { trades: Trade[]; mode: EquityMode }) {
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const cumulative: number[] = [];
  ordered.reduce((running, trade) => {
    const next = running + (mode === "dollar" ? trade.pnl : trade.r);
    cumulative.push(next);
    return next;
  }, 0);
  if (!cumulative.length) return <div className="empty-chart">No trades in this period.</div>;

  const width = 760;
  const height = 220;
  const left = 46;
  const right = 14;
  const top = 15;
  const bottom = 30;
  const min = Math.min(0, ...cumulative);
  const max = Math.max(0, ...cumulative);
  const spread = Math.max(max - min, 1);
  const paddedMin = min - spread * .12;
  const paddedMax = max + spread * .12;
  const x = (index: number) => left + (index / Math.max(cumulative.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((paddedMax - value) / (paddedMax - paddedMin)) * (height - top - bottom);
  const points = cumulative.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `${left},${height - bottom} ${points} ${width - right},${height - bottom}`;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => paddedMax - (paddedMax - paddedMin) * ratio);

  return (
    <div className="equity-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative ${mode === "dollar" ? "dollar P and L" : "R multiple"} equity curve`}>
        <defs><linearGradient id="equity-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#11834f" stopOpacity=".18"/><stop offset="1" stopColor="#11834f" stopOpacity=".01"/></linearGradient></defs>
        {ticks.map((tick) => <g key={tick}><line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} className="chart-grid"/><text x={left - 8} y={y(tick) + 3} textAnchor="end" className="axis-label">{mode === "dollar" ? `$${Math.round(tick / 100) / 10}k` : `${tick.toFixed(0)}R`}</text></g>)}
        <line x1={left} y1={y(0)} x2={width - right} y2={y(0)} className="zero-line"/>
        <polygon points={area} fill="url(#equity-area)"/>
        <polyline points={points} className="equity-line"/>
        {cumulative.map((value, index) => <circle key={ordered[index].id} cx={x(index)} cy={y(value)} r={index === cumulative.length - 1 ? 4 : 2} className={index === cumulative.length - 1 ? "equity-point current" : "equity-point"}><title>{ordered[index].symbol} · {shortDate(ordered[index].date)} · {mode === "dollar" ? formatMoney(value) : formatR(value)}</title></circle>)}
        <text x={left} y={height - 8} className="axis-label">{shortDate(ordered[0].date)}</text>
        <text x={(left + width - right) / 2} y={height - 8} textAnchor="middle" className="axis-label">{shortDate(ordered[Math.floor(ordered.length / 2)].date)}</text>
        <text x={width - right} y={height - 8} textAnchor="end" className="axis-label">{shortDate(ordered[ordered.length - 1].date)}</text>
      </svg>
    </div>
  );
}

function DistributionChart({ trades }: { trades: Trade[] }) {
  if (!trades.length) return <div className="empty-chart">No outcomes in this period.</div>;
  const values = trades.map((trade) => trade.r);
  const binSize = .5;
  const domainMin = Math.min(0, Math.floor(Math.min(...values) / binSize) * binSize);
  const domainMax = Math.max(domainMin + binSize, Math.ceil(Math.max(...values) / binSize) * binSize);
  const binCount = Math.round((domainMax - domainMin) / binSize);
  const bins = Array.from({ length: binCount }, (_, index) => ({ start: domainMin + index * binSize, count: 0 }));
  values.forEach((value) => {
    const raw = Math.floor((Math.min(value, domainMax - .001) - domainMin) / binSize);
    bins[Math.max(0, Math.min(raw, bins.length - 1))].count += 1;
  });

  const width = 560;
  const height = 300;
  const left = 24;
  const right = 4;
  const top = 28;
  const chartBottom = 182;
  const rugTop = 238;
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const plotWidth = width - left - right;
  const xValue = (value: number) => left + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
  const barWidth = plotWidth / bins.length;
  const yCount = (count: number) => chartBottom - (count / maxCount) * (chartBottom - top);
  const mean = average(values);
  const med = median(values);
  const labelValues = [-1, 0, 1, 3, 5, 8].filter((value) => value >= domainMin && value <= domainMax);

  return (
    <div className="distribution-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Histogram of realized R multiple outcomes with individual trade markers">
        {[0, .5, 1].map((ratio) => {
          const count = Math.round(maxCount * ratio);
          return <g key={ratio}><line x1={left} y1={yCount(count)} x2={width - right} y2={yCount(count)} className="chart-grid"/><text x={left - 7} y={yCount(count) + 3} textAnchor="end" className="axis-label">{count}</text></g>;
        })}
        <text x={left} y={15} className="axis-title">Number of trades</text>
        {bins.map((bin, index) => {
          const end = bin.start + binSize;
          const positive = end > 0;
          return <rect key={bin.start} x={left + index * barWidth + 1} y={yCount(bin.count)} width={Math.max(barWidth - 2, 1)} height={chartBottom - yCount(bin.count)} rx="1.5" className={positive ? "hist-bar positive-bar" : "hist-bar negative-bar"}><title>{bin.start.toFixed(1)}R to {end.toFixed(1)}R · {bin.count} trade{bin.count === 1 ? "" : "s"}</title></rect>;
        })}
        <line x1={xValue(0)} y1={top - 5} x2={xValue(0)} y2={chartBottom} className="hist-zero"/>
        <line x1={xValue(mean)} y1={top - 5} x2={xValue(mean)} y2={chartBottom} className="reference-line"/>
        <line x1={xValue(med)} y1={top - 5} x2={xValue(med)} y2={chartBottom} className="reference-line median-line"/>
        <text x={Math.min(xValue(mean) + 4, width - 66)} y={23} className="reference-label">Avg {formatR(mean)}</text>
        <text x={Math.max(xValue(med) - 4, 48)} y={23} textAnchor="end" className="reference-label">Med {formatR(med)}</text>
        {labelValues.map((value) => <g key={value}><line x1={xValue(value)} y1={chartBottom} x2={xValue(value)} y2={chartBottom + 4} className="axis-tick"/><text x={xValue(value)} y={chartBottom + 18} textAnchor="middle" className="axis-label">{value > 0 ? "+" : ""}{value}R</text></g>)}
        <text x={(left + width - right) / 2} y={chartBottom + 36} textAnchor="middle" className="axis-title">Realized R multiple</text>
        <text x={left} y={rugTop - 9} className="axis-title">Individual trades</text>
        {trades.map((trade, index) => <line key={trade.id} x1={xValue(trade.r)} y1={rugTop + (index % 3) * 4} x2={xValue(trade.r)} y2={rugTop + 24 + (index % 3) * 4} className={trade.r < 0 ? "rug negative-rug" : "rug positive-rug"}><title>{trade.symbol} · {formatR(trade.r)} · {formatMoney(trade.pnl)}</title></line>)}
      </svg>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [modal, setModal] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [recovering, setRecovering] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [importTrades, setImportTrades] = useState<Trade[]>([]);
  const [importDismissed, setImportDismissed] = useState(false);
  const [range, setRange] = useState<RangeKey>("30");
  const [equityMode, setEquityMode] = useState<EquityMode>("dollar");
  const [todayLabel, setTodayLabel] = useState("Trading overview");
  const [greeting, setGreeting] = useState("Welcome back, Melvin");

  useEffect(() => {
    const saved = window.localStorage.getItem("journal-trades-v2");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Trade[];
        if (Array.isArray(parsed) && parsed.length) setImportTrades(parsed.map((trade) => ({ ...trade, id: String(trade.id) })));
      } catch { /* ignore unreadable local backup */ }
    }
    const now = new Date();
    setTodayLabel(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now));
    setGreeting(`${now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"}, Melvin`);
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
        setAuthMode("recovery");
      }
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setTrades([]);
      return;
    }
    let current = true;
    async function loadTrades() {
      setCloudBusy(true);
      setCloudError("");
      const { data, error } = await supabase.from("trades").select("*").order("trade_date", { ascending: false }).order("created_at", { ascending: false });
      if (!current) return;
      if (error) setCloudError(error.message.includes("schema cache") ? "The secure trade table still needs to be activated in Supabase." : error.message);
      else setTrades((data as TradeRow[]).map(fromRow));
      setCloudBusy(false);
    }
    loadTrades();
    return () => { current = false; };
  }, [session?.user.id]);

  const filteredTrades = useMemo(() => {
    const cutoff = getCutoff(range);
    return trades.filter((trade) => !cutoff || new Date(`${trade.date}T23:59:59`) >= cutoff);
  }, [trades, range]);

  const stats = useMemo(() => {
    const pnl = filteredTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const wins = filteredTrades.filter((trade) => trade.r > 0);
    const losses = filteredTrades.filter((trade) => trade.r <= 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    return {
      pnl,
      winRate: filteredTrades.length ? Math.round((wins.length / filteredTrades.length) * 100) : 0,
      avgPlanned: average(filteredTrades.map((trade) => trade.plannedR)),
      avgR: average(filteredTrades.map((trade) => trade.r)),
      profitFactor: grossLoss ? grossWin / grossLoss : 0,
      wins: wins.length,
      losses: losses.length,
    };
  }, [filteredTrades]);

  const setupPerformance = useMemo(() => {
    const grouped = new Map<string, number[]>();
    filteredTrades.forEach((trade) => grouped.set(trade.setup, [...(grouped.get(trade.setup) || []), trade.r]));
    return [...grouped.entries()].map(([setup, values]) => ({ setup, count: values.length, avgR: average(values) })).sort((a, b) => b.avgR - a.avgR);
  }, [filteredTrades]);

  async function addTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const risk = Math.max(Number(data.get("risk")) || 0, 1);
    const pnl = Number(data.get("pnl")) || 0;
    const trade: Omit<Trade, "id"> = {
      symbol: String(data.get("symbol") || "NEW").toUpperCase(),
      side: data.get("side") as "Long" | "Short",
      setup: String(data.get("setup") || "Unclassified"),
      date: String(data.get("date") || isoDate()),
      pnl,
      r: pnl / risk,
      risk,
      plannedR: Number(data.get("plannedR")) || 1,
      grade: data.get("grade") as Grade,
    };
    setCloudBusy(true);
    setCloudError("");
    const { data: saved, error } = await supabase.from("trades").insert(toRow(trade)).select().single();
    if (error) setCloudError(error.message);
    else {
      setTrades((current) => [fromRow(saved as TradeRow), ...current]);
      setModal(false);
    }
    setCloudBusy(false);
  }

  async function importLocalTrades() {
    if (!importTrades.length) return;
    setCloudBusy(true);
    setCloudError("");
    const rows = importTrades.map(({ id: _id, ...trade }) => toRow(trade));
    const { data, error } = await supabase.from("trades").insert(rows).select();
    if (error) setCloudError(error.message);
    else {
      setTrades((current) => [...(data as TradeRow[]).map(fromRow), ...current]);
      window.localStorage.removeItem("journal-trades-v2");
      setImportTrades([]);
      setImportDismissed(true);
    }
    setCloudBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setAuthMode("signin");
  }

  const rangeLabel = range === "30" ? "Last 30 days" : range === "90" ? "Last 90 days" : range === "ytd" ? "This year" : "All time";
  const latestTrades = [...filteredTrades].sort((a, b) => b.date.localeCompare(a.date));

  if (!authReady) return <main className="loading-shell"><span className="loading-mark"><Icon name="spark" size={21}/></span><p>Opening your journal…</p></main>;
  if (!session || recovering) return <AuthScreen mode={authMode} setMode={setAuthMode} onRecovered={() => { setRecovering(false); setAuthMode("signin"); }}/>;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="spark" size={17}/></span><span>Journal</span></div>
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(([label, icon]) => <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => setActive(label)}><Icon name={icon}/><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-spacer"/>
        <div className="profile"><span className="avatar">M</span><span><b>Melvin Roy</b><small>{session.user.email}</small></span><Icon name="check" size={16}/></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{todayLabel}</p><h1>{greeting}</h1></div>
          <div className="header-actions">
            <span className={`sync-state ${cloudError ? "has-error" : ""}`}><i/>{cloudBusy ? "Syncing…" : cloudError ? "Sync issue" : "Cloud synced"}</span>
            <label className="range-control"><Icon name="calendar" size={16}/><span className="sr-only">Date range</span><select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="ytd">This year</option><option value="all">All time</option></select></label>
            <button className="secondary-button auth-button" onClick={signOut}>Sign out</button>
            <button className="primary-button" onClick={() => setModal(true)}><Icon name="plus" size={17}/> Log trade</button>
          </div>
        </header>

        {(cloudError || (importTrades.length > 0 && !importDismissed)) && <section className={`cloud-notice ${cloudError ? "error" : ""}`}>
          <div><strong>{cloudError ? "Cloud setup required" : `${importTrades.length} browser trades found`}</strong><span>{cloudError || "Import them once into your private cloud journal. Review first if these are demonstration trades."}</span></div>
          {!cloudError && <div className="cloud-notice-actions"><button onClick={() => setImportDismissed(true)}>Not now</button><button className="import-button" onClick={importLocalTrades} disabled={cloudBusy}>Import browser trades</button></div>}
        </section>}

        <section className="stat-grid" aria-label="Trading statistics">
          <article className="stat-card"><span>Net P&amp;L</span><strong className={stats.pnl >= 0 ? "positive" : "negative"}>{formatMoney(stats.pnl)}</strong><small>{filteredTrades.length} recorded trades</small></article>
          <article className="stat-card"><span>Win rate</span><strong>{stats.winRate}%</strong><small>{stats.wins} wins · {stats.losses} losses</small></article>
          <article className="stat-card"><span>Avg planned R:R</span><strong>1:{stats.avgPlanned.toFixed(1)}</strong><small>Defined before entry</small></article>
          <article className="stat-card"><span>Avg realized R</span><strong className={stats.avgR >= 0 ? "positive" : "negative"}>{formatR(stats.avgR)}</strong><small>Across all outcomes</small></article>
          <article className="stat-card"><span>Profit factor</span><strong>{stats.profitFactor.toFixed(2)}</strong><small>Gross wins ÷ losses</small></article>
        </section>

        <section className="analytics-grid">
          <article className="panel equity-panel">
            <div className="panel-heading">
              <div><h2>Equity curve</h2><p>Cumulative performance · {rangeLabel}</p></div>
              <div className="segmented-control" aria-label="Equity chart unit"><button className={equityMode === "dollar" ? "selected" : ""} onClick={() => setEquityMode("dollar")}>$</button><button className={equityMode === "r" ? "selected" : ""} onClick={() => setEquityMode("r")}>R</button></div>
            </div>
            <div className="chart-summary"><strong>{equityMode === "dollar" ? formatMoney(stats.pnl) : formatR(filteredTrades.reduce((sum, trade) => sum + trade.r, 0))}</strong><span>{filteredTrades.length} trades in view</span></div>
            <EquityChart trades={filteredTrades} mode={equityMode}/>
          </article>

          <article className="panel distribution-panel">
            <div className="panel-heading"><div><h2>Realized R distribution</h2><p>Where trades finished</p></div><span className="trade-count">{filteredTrades.length} trades</span></div>
            <div className="distribution-summary"><span>Average <b className={stats.avgR >= 0 ? "positive" : "negative"}>{formatR(stats.avgR)}</b></span><span>Median <b>{formatR(median(filteredTrades.map((trade) => trade.r)))}</b></span></div>
            <DistributionChart trades={filteredTrades}/>
            <p className="chart-insight"><span>✓</span> Losses stay controlled while the positive right tail produces the edge.</p>
          </article>
        </section>

        <section className="lower-grid">
          <article className="panel trades-panel">
            <div className="panel-heading"><div><h2>Recent trades</h2><p>Risk, execution and realized outcome</p></div><span className="panel-meta">{filteredTrades.length} trades</span></div>
            <div className="trade-table">
              <div className="trade-row table-head"><span>Date</span><span>Symbol</span><span>Side</span><span>Risk</span><span>Planned R:R</span><span>Realized R</span><span>P&amp;L</span><span>Grade</span></div>
              {latestTrades.map((trade) => <div className="trade-row" key={trade.id}><span>{shortDate(trade.date)}</span><span className="symbol-cell">{trade.symbol}<small>{trade.setup}</small></span><span><i className={`side-pill ${trade.side.toLowerCase()}`}>{trade.side}</i></span><span>{formatMoney(trade.risk, false)}</span><span>1:{trade.plannedR.toFixed(1)}</span><span className={trade.r >= 0 ? "positive" : "negative"}>{formatR(trade.r)}</span><span className={trade.pnl >= 0 ? "positive" : "negative"}>{formatMoney(trade.pnl)}</span><span><i className={`grade grade-${trade.grade.toLowerCase()}`}>{trade.grade}</i></span></div>)}
            </div>
          </article>

          <article className="panel setup-panel">
            <div className="panel-heading"><div><h2>Setup performance</h2><p>Average realized R</p></div><span className="panel-meta">{setupPerformance.length} setups</span></div>
            <div className="setup-table"><div className="setup-row setup-head"><span>Setup</span><span>Trades</span><span>Avg R</span></div>{setupPerformance.map((item) => <div className="setup-row" key={item.setup}><span>{item.setup}</span><span>{item.count}</span><b className={item.avgR >= 0 ? "positive" : "negative"}>{formatR(item.avgR)}</b></div>)}</div>
          </article>
        </section>
      </section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">New journal entry</p><h2 id="modal-title">Log a trade</h2></div><button className="icon-button" aria-label="Close" onClick={() => setModal(false)}><Icon name="close"/></button></div><form onSubmit={addTrade}><div className="form-row"><label>Symbol<input name="symbol" placeholder="NVDA" required autoFocus/></label><label>Trade date<input name="date" type="date" defaultValue={isoDate()} required/></label></div><div className="form-row"><label>Side<select name="side"><option>Long</option><option>Short</option></select></label><label>Setup<select name="setup">{setups.map((setup) => <option key={setup}>{setup}</option>)}</select></label></div><div className="form-row"><label>Dollar risk<input name="risk" type="number" min="1" placeholder="150" required/></label><label>Planned reward<input name="plannedR" type="number" min=".1" step=".1" placeholder="5.0" required/></label></div><div className="form-row"><label>Final P&amp;L<input name="pnl" type="number" placeholder="750" required/></label><label>Execution grade<select name="grade"><option value="A">A · Followed every rule</option><option value="B">B · Minor deviation</option><option value="C">C · Broke the plan</option></select></label></div><p className="form-help">Realized R is calculated automatically as final P&amp;L ÷ dollar risk.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button type="submit" className="primary-button"><Icon name="check" size={16}/> Save trade</button></div></form></section></div>}
    </main>
  );
}
