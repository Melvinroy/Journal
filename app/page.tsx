"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase, supabaseConfig } from "../lib/supabase";
import {
  isLegacyDemoDataset,
  LOCAL_TRADE_STORAGE_KEY,
} from "../lib/local-trade-migration";
import { CatalystDashboard } from "./CatalystDashboard";
import { ScansDashboard } from "./ScansDashboard";
import { BacktestDashboard } from "./BacktestDashboard";
import { ResearchWorkspace } from "./ResearchWorkspace";
import {
  TradingWorkspace,
  type UnlinkedPositionInput,
} from "./TradingWorkspace";
import { useBrowserStore } from "../lib/use-browser-store";
import { ChartDashboard } from "./ChartDashboard";
import { withAuthTimeout } from "../lib/auth-ready";
import type { MarketContext } from "../lib/workspace-state";
import { demoStorageKey } from "../lib/review-demo";
import { demoJournalRows, journalRowFromCampaign } from "../lib/trading-demo";
import {
  createSnapshotCampaign,
  rollupCampaign,
  type Execution,
  type FeeAdjustment,
  type JournalCampaignSnapshot,
  type JournalReview,
  type TradeCampaign,
} from "../lib/trading-domain";
import { useModalAccessibility } from "./useModalAccessibility";
import { calculateJournalStatistics } from "../lib/journal-analytics";
import {
  journalSemanticClass,
  journalSemanticTone,
} from "../lib/journal-presentation";
import { MetricCard } from "./MetricCard";

type Grade = "A" | "B" | "C";
type RangeKey = "30" | "90" | "ytd" | "all";
type EquityMode = "dollar" | "r";
type EquityView = "equity" | "drawdown";
type StatusFilter = "all" | "open" | "closed";

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
  status?: string;
  executions?: Execution[];
  openQuantity?: number;
  simulated?: true;
  initialRiskAvailable?: boolean;
  realizedAvailable?: boolean;
  historyStatus?: string;
  campaignId?: string;
  planId?: string;
  provenance?: string;
  currency?: string;
  fixedTargetCoverage?: number;
  finalRAvailable?: boolean;
  costsComplete?: boolean;
  grossRealized?: number;
  costs?: number;
  enteredQuantity?: number;
  exitedQuantity?: number;
  weightedEntry?: number;
  weightedExit?: number;
  firstFillAt?: string;
  closedAt?: string;
  journalSnapshot?: JournalCampaignSnapshot;
  feeAdjustments?: FeeAdjustment[];
  confirmedAmendments?: TradeCampaign["confirmedAmendments"];
};

const EMPTY_REVIEWS: Record<string, JournalReview> = {};
const validReviews = (value: unknown): value is Record<string, JournalReview> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const EMPTY_POSITION_CAMPAIGNS: TradeCampaign[] = [];
const validJournalCampaigns = (value: unknown): value is TradeCampaign[] => {
  if (!Array.isArray(value)) return false;
  try {
    value.forEach((campaign: TradeCampaign) => {
      if (!campaign.campaignId || !campaign.journalTradeId || !campaign.accountId)
        throw new Error("Incomplete campaign identity");
      rollupCampaign(campaign);
    });
    return true;
  } catch {
    return false;
  }
};
const validSnapshotCampaigns = (value: unknown) => {
  if (!Array.isArray(value)) return false;
  try {
    value.forEach((campaign: TradeCampaign) => {
      if (!campaign.positionSnapshot || campaign.executions?.length)
        throw new Error("Snapshot campaigns cannot contain inferred executions.");
      createSnapshotCampaign({
        campaignId: campaign.campaignId,
        journalTradeId: campaign.journalTradeId ?? "",
        symbol: campaign.symbol,
        direction: campaign.direction,
        snapshot: campaign.positionSnapshot,
      });
    });
    return true;
  } catch {
    return false;
  }
};

const setups = [
  "Momentum breakout",
  "EP breakout",
  "Earnings gap",
  "10/20 pullback",
  "VWAP rejection",
];

const demoTrades: Trade[] = [
  ["NVDA", "Long", "Momentum breakout", 2, 920, 4.6, 200, 5, "A"],
  ["TSLA", "Short", "VWAP rejection", 3, -180, -0.9, 200, 3, "A"],
  ["PLTR", "Long", "EP breakout", 4, 250, 1.25, 200, 4, "B"],
  ["META", "Long", "10/20 pullback", 5, -200, -1, 200, 4, "A"],
  ["AMD", "Long", "Momentum breakout", 6, 160, 0.8, 200, 3, "B"],
  ["COIN", "Long", "Earnings gap", 7, 1240, 6.2, 200, 6, "A"],
  ["AMZN", "Long", "10/20 pullback", 8, -190, -0.95, 200, 4, "A"],
  ["MSTR", "Short", "VWAP rejection", 9, 80, 0.4, 200, 3, "B"],
  ["SNOW", "Long", "EP breakout", 10, -200, -1, 200, 5, "A"],
  ["NFLX", "Long", "Earnings gap", 11, 680, 3.4, 200, 5, "A"],
  ["AVGO", "Long", "Momentum breakout", 12, 220, 1.1, 200, 4, "B"],
  ["CRWD", "Short", "VWAP rejection", 13, -210, -1.05, 200, 3, "B"],
  ["HOOD", "Long", "EP breakout", 14, 1560, 7.8, 200, 8, "A"],
  ["GOOGL", "Long", "10/20 pullback", 15, 100, 0.5, 200, 3, "B"],
  ["MDB", "Long", "Earnings gap", 16, -200, -1, 200, 5, "A"],
  ["MU", "Long", "Momentum breakout", 17, 360, 1.8, 200, 4, "A"],
  ["SHOP", "Long", "EP breakout", 18, -180, -0.9, 200, 5, "B"],
  ["ARM", "Short", "VWAP rejection", 19, 140, 0.7, 200, 3, "A"],
  ["RDDT", "Long", "Momentum breakout", 20, -200, -1, 200, 5, "A"],
  ["APP", "Long", "EP breakout", 21, 1060, 5.3, 200, 6, "A"],
  ["DELL", "Long", "Earnings gap", 22, 240, 1.2, 200, 4, "B"],
  ["SMCI", "Short", "VWAP rejection", 23, -190, -0.95, 200, 3, "A"],
  ["ORCL", "Long", "10/20 pullback", 24, 120, 0.6, 200, 3, "B"],
  ["SNDK", "Long", "Momentum breakout", 25, 840, 4.2, 200, 5, "A"],
  ["HIMS", "Long", "EP breakout", 26, -200, -1, 200, 4, "A"],
].map(
  ([symbol, side, setup, daysAgo, pnl, r, risk, plannedR, grade], index) => ({
    id: `demo-${index + 1}`,
    symbol: String(symbol),
    side: side as "Long" | "Short",
    setup: String(setup),
    date: isoDate(Number(daysAgo)),
    pnl: Number(pnl),
    r: Number(r),
    risk: Number(risk),
    plannedR: Number(plannedR),
    grade: grade as Grade,
    status: "Closed",
    campaignId: `legacy-demo-${index + 1}`,
    provenance: "Legacy",
    currency: "USD",
    fixedTargetCoverage: 100,
    finalRAvailable: true,
    costsComplete: true,
    initialRiskAvailable: true,
    realizedAvailable: true,
    enteredQuantity: 1,
    exitedQuantity: 1,
    openQuantity: 0,
    firstFillAt: `${isoDate(Number(daysAgo))}T14:30:00Z`,
    closedAt: `${isoDate(Number(daysAgo))}T20:00:00Z`,
  }),
);

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function holdingDuration(start?: string, end?: string) {
  if (!start || !end) return "Open";
  const hours = Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000);
  return hours < 24 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`;
}

const nav = [
  ["Discover", "scan"],
  ["Charts", "candles"],
  ["Strategies", "flask"],
  ["Trading", "target"],
] as const;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    candles: <path d="M7 3v3m0 8v7M4 6h6v8H4zM17 3v7m0 8v3m-3-11h6v8h-6z" />,
    note: (
      <>
        <path d="M5 3h11l3 3v15H5z" />
        <path d="M15 3v4h4M8 11h8M8 15h6" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22z" />
      </>
    ),
    spark: (
      <>
        <path d="M4 18l5-6 4 3 7-9" />
        <path d="M15 6h5v5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4m8-4v4M3 10h18" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
      </>
    ),
    export: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4" />
        <path d="M5 19h14" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    shield: <path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z" />,
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      </>
    ),
    scan: (
      <>
        <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
        <path d="M3 19h18" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
        <path d="M7.5 16h9" />
      </>
    ),
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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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

function AuthScreen({
  mode,
  setMode,
  onRecovered,
}: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  onRecovered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("This journal has not been connected to Supabase yet.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    let result: { error: { message: string } | null };

    if (mode === "signup") {
      result = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (!result.error)
        setMessage(
          "If this email is eligible, we’ll send a confirmation link. Please check your inbox and spam folder.",
        );
    } else if (mode === "forgot") {
      result = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (!result.error)
        setMessage("Password-reset link sent. Please check your email.");
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

  const title =
    mode === "signup"
      ? "Create your journal"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "recovery"
          ? "Choose a new password"
          : "Welcome back";
  const subtitle =
    mode === "signup"
      ? "Your trades stay private and synchronized across devices."
      : mode === "forgot"
        ? "We’ll send a secure recovery link to your email."
        : mode === "recovery"
          ? "Use at least eight characters for your new password."
          : "Sign in to open your private trading workspace.";

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span>Brontide</span>
        </div>
        <div className="auth-brand-copy">
          <p className="eyebrow">Asymmetric Edge Labs</p>
          <h1>
            Review clearly.
            <br />
            Trade deliberately.
          </h1>
          <p>
            A private decision cockpit for measuring risk, execution and the
            outcomes that build your edge.
          </p>
        </div>
        <div className="auth-proof">
          <span>Secure cloud journal</span>
          <span>Multi-device sync</span>
          <span>Private by design</span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-card">
          <p className="eyebrow">Brontide</p>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          <form onSubmit={submit}>
            {mode !== "recovery" && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                {mode === "recovery" ? "New password" : "Password"}
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder="At least 8 characters"
                  required
                  autoFocus={mode === "recovery"}
                />
              </label>
            )}
            {error && (
              <p className="auth-message error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="auth-message success" role="status">
                {message}
              </p>
            )}
            <button
              type="submit"
              className="primary-button auth-submit"
              disabled={busy}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "recovery"
                      ? "Update password"
                      : "Sign in"}
            </button>
          </form>
          {mode === "signin" && (
            <div className="auth-links">
              <button onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
              <button onClick={() => setMode("signup")}>Create account</button>
            </div>
          )}
          {mode !== "signin" && mode !== "recovery" && (
            <button className="auth-back" onClick={() => setMode("signin")}>
              ← Back to sign in
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function SetupScreen({
  onClose,
  forceUnconfigured = false,
}: {
  onClose?: () => void;
  forceUnconfigured?: boolean;
}) {
  const [copied, setCopied] = useState("");
  const [siteUrl, setSiteUrl] = useState(
    "https://your-name.github.io/your-repository/",
  );
  const [variablesUrl, setVariablesUrl] = useState(
    "https://github.com/settings",
  );
  const configured = supabaseConfig.isConfigured && !forceUnconfigured;

  useEffect(() => {
    if (forceUnconfigured) {
      setSiteUrl("https://your-name.github.io/Journal/");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}`;
    setSiteUrl(url.endsWith("/") ? url : `${url}/`);
    if (window.location.hostname.endsWith("github.io")) {
      const owner = window.location.hostname.split(".")[0];
      const repository = window.location.pathname.split("/").filter(Boolean)[0];
      if (owner && repository)
        setVariablesUrl(
          `https://github.com/${owner}/${repository}/settings/variables/actions`,
        );
    }
  }, [forceUnconfigured]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }

  async function copyInstaller() {
    const response = await fetch("supabase-setup.sql");
    await copy(await response.text(), "installer");
  }

  return (
    <main className={onClose ? "setup-overlay" : "setup-shell"}>
      <section className="setup-rail">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span>Brontide</span>
        </div>
        <div className="setup-rail-copy">
          <p className="eyebrow">Self-hosted by design</p>
          <h1>
            Your journal.
            <br />
            Your database.
          </h1>
          <p>
            A guided, private installation that keeps every trade under your
            control.
          </p>
        </div>
        <div className="setup-trust">
          <Icon name="shield" size={17} />
          <span>
            No database passwords or privileged keys are ever stored in the
            journal.
          </span>
        </div>
      </section>

      <section className="setup-workspace">
        <header className="setup-header">
          <div>
            <p className="eyebrow">Owner setup</p>
            <h2>
              {configured ? "Cloud connection" : "Let’s connect your journal"}
            </h2>
            <p>
              {configured
                ? "This installation has a valid Supabase configuration."
                : "Four short steps. Most people finish in about five minutes."}
            </p>
          </div>
          {onClose && (
            <button
              className="icon-button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
          {!onClose && (
            <a className="demo-link" href="?demo=1">
              Preview dashboard <Icon name="arrow" size={15} />
            </a>
          )}
        </header>

        <div className="setup-progress" aria-label="Setup progress">
          <span className={configured ? "done" : "active"} />
          <span className={configured ? "done" : ""} />
          <span className={configured ? "done" : ""} />
          <span className={configured ? "done" : ""} />
        </div>

        <div className="setup-steps">
          <article className="setup-step">
            <span className="step-number">01</span>
            <div>
              <h3>Create your cloud</h3>
              <p>
                Create a free Supabase project in the region closest to you.
                Keep the database password private.
              </p>
            </div>
            <a
              className="step-action"
              href="https://supabase.com/dashboard/new"
              target="_blank"
              rel="noreferrer"
            >
              Open Supabase <Icon name="external" size={14} />
            </a>
          </article>

          <article className="setup-step">
            <span className="step-number">02</span>
            <div>
              <h3>Install the secure database</h3>
              <p>
                Copy the prepared installer, paste it into Supabase SQL Editor
                and select Run once.
              </p>
              <small>
                Creates the trades table, index and user-isolation policies.
              </small>
            </div>
            <div className="step-actions">
              <button className="step-action" onClick={copyInstaller}>
                <Icon
                  name={copied === "installer" ? "check" : "copy"}
                  size={14}
                />
                {copied === "installer" ? "Copied" : "Copy installer"}
              </button>
              <a
                className="step-action quiet"
                href="https://supabase.com/dashboard/project/_/sql/new"
                target="_blank"
                rel="noreferrer"
              >
                SQL Editor <Icon name="external" size={14} />
              </a>
            </div>
          </article>

          <article className="setup-step">
            <span className="step-number">03</span>
            <div>
              <h3>Connect the deployment</h3>
              <p>
                Add these repository variables, then run the GitHub Pages
                workflow again.
              </p>
              <div className="variable-list">
                <code>NEXT_PUBLIC_SUPABASE_URL</code>
                <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
              </div>
            </div>
            <a
              className="step-action"
              href={variablesUrl}
              target="_blank"
              rel="noreferrer"
            >
              GitHub variables <Icon name="external" size={14} />
            </a>
          </article>

          <article className="setup-step">
            <span className="step-number">04</span>
            <div>
              <h3>Allow secure sign-in</h3>
              <p>
                Use this address as the Supabase Site URL and add the same
                address followed by <code>**</code> as a Redirect URL.
              </p>
              <button
                className="copy-value"
                onClick={() => copy(siteUrl, "url")}
              >
                <span>{siteUrl}</span>
                <Icon name={copied === "url" ? "check" : "copy"} size={14} />
              </button>
            </div>
            <a
              className="step-action"
              href="https://supabase.com/dashboard/project/_/auth/url-configuration"
              target="_blank"
              rel="noreferrer"
            >
              Auth settings <Icon name="external" size={14} />
            </a>
          </article>
        </div>

        <footer className="setup-footer">
          <div
            className={`connection-state ${configured ? "ready" : "waiting"}`}
          >
            <span>
              <Icon name={configured ? "check" : "database"} size={16} />
            </span>
            <div>
              <strong>
                {configured
                  ? "Configuration detected"
                  : "Waiting for deployment configuration"}
              </strong>
              <small>
                {configured
                  ? new URL(supabaseConfig.url).hostname
                  : "The journal will unlock automatically after GitHub Pages redeploys."}
              </small>
            </div>
          </div>
          <a
            href="https://github.com/Melvinroy/Journal/blob/main/docs/SELF_HOSTING.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the full guide <Icon name="arrow" size={14} />
          </a>
        </footer>
      </section>
    </main>
  );
}

function EquityChart({ trades, mode, view }: { trades: Trade[]; mode: EquityMode; view: EquityView }) {
  const ordered = [...trades].sort(
    (a, b) =>
      (a.closedAt ?? a.date).localeCompare(b.closedAt ?? b.date) ||
      (a.campaignId ?? a.id).localeCompare(b.campaignId ?? b.id),
  );
  const cumulative: number[] = [];
  ordered.reduce((running, trade) => {
    const next = running + (mode === "dollar" ? trade.pnl : trade.r);
    cumulative.push(next);
    return next;
  }, 0);
  if (view === "drawdown") {
    let peak = 0;
    cumulative.forEach((value, index) => {
      peak = Math.max(0, peak, value);
      cumulative[index] = value - peak;
    });
  }
  if (!cumulative.length)
    return <div className="empty-chart">No trades in this period.</div>;

  const width = 760;
  const height = 220;
  const left = 46;
  const right = 14;
  const top = 15;
  const bottom = 30;
  const min = Math.min(0, ...cumulative);
  const max = Math.max(0, ...cumulative);
  const spread = Math.max(max - min, 1);
  const paddedMin = min - spread * 0.12;
  const paddedMax = max + spread * 0.12;
  const x = (index: number) =>
    left +
    (index / Math.max(cumulative.length - 1, 1)) * (width - left - right);
  const y = (value: number) =>
    top +
    ((paddedMax - value) / (paddedMax - paddedMin)) * (height - top - bottom);
  const points = cumulative
    .map((value, index) => `${x(index)},${y(value)}`)
    .join(" ");
  const area = `${left},${height - bottom} ${points} ${width - right},${height - bottom}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => paddedMax - (paddedMax - paddedMin) * ratio,
  );

  return (
    <div className="equity-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={view === "drawdown" ? "Closed-trade drawdown within selected period" : `Cumulative ${mode === "dollar" ? "dollar P and L" : "R multiple"} closed-trade curve`}
      >
        <defs>
          <linearGradient id="equity-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#11834f" stopOpacity=".18" />
            <stop offset="1" stopColor="#11834f" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y(tick)}
              x2={width - right}
              y2={y(tick)}
              className="chart-grid"
            />
            <text
              x={left - 8}
              y={y(tick) + 3}
              textAnchor="end"
              className="axis-label"
            >
              {mode === "dollar"
                ? `$${Math.round(tick / 100) / 10}k`
                : `${tick.toFixed(0)}R`}
            </text>
          </g>
        ))}
        <line
          x1={left}
          y1={y(0)}
          x2={width - right}
          y2={y(0)}
          className="zero-line"
        />
        <polygon points={area} fill="url(#equity-area)" />
        <polyline points={points} className="equity-line" />
        {cumulative.map((value, index) => (
          <circle
            key={ordered[index].id}
            cx={x(index)}
            cy={y(value)}
            r={index === cumulative.length - 1 ? 4 : 2}
            className={
              index === cumulative.length - 1
                ? "equity-point current"
                : "equity-point"
            }
          >
            <title>
              {ordered[index].symbol} · {shortDate(ordered[index].date)} ·{" "}
              {mode === "dollar" ? formatMoney(value) : formatR(value)}
            </title>
          </circle>
        ))}
        <text x={left} y={height - 8} className="axis-label">
          {shortDate(ordered[0].date)}
        </text>
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          className="axis-label"
        >
          {shortDate(ordered[Math.floor(ordered.length / 2)].date)}
        </text>
        <text
          x={width - right}
          y={height - 8}
          textAnchor="end"
          className="axis-label"
        >
          {shortDate(ordered[ordered.length - 1].date)}
        </text>
      </svg>
    </div>
  );
}

function DistributionChart({ trades }: { trades: Trade[] }) {
  if (!trades.length)
    return <div className="empty-chart">No outcomes in this period.</div>;
  const values = trades.map((trade) => trade.r);
  const binSize = 0.5;
  const domainMin = Math.min(
    0,
    Math.floor(Math.min(...values) / binSize) * binSize,
  );
  const domainMax = Math.max(
    domainMin + binSize,
    Math.ceil(Math.max(...values) / binSize) * binSize,
  );
  const binCount = Math.round((domainMax - domainMin) / binSize);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: domainMin + index * binSize,
    count: 0,
  }));
  values.forEach((value) => {
    const raw = Math.floor(
      (Math.min(value, domainMax - 0.001) - domainMin) / binSize,
    );
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
  const xValue = (value: number) =>
    left + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
  const barWidth = plotWidth / bins.length;
  const yCount = (count: number) =>
    chartBottom - (count / maxCount) * (chartBottom - top);
  const mean = average(values);
  const med = median(values);
  const labelValues = [-1, 0, 1, 3, 5, 8].filter(
    (value) => value >= domainMin && value <= domainMax,
  );

  return (
    <div className="distribution-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Histogram of realized R multiple outcomes with individual trade markers"
      >
        {[0, 0.5, 1].map((ratio) => {
          const count = Math.round(maxCount * ratio);
          return (
            <g key={ratio}>
              <line
                x1={left}
                y1={yCount(count)}
                x2={width - right}
                y2={yCount(count)}
                className="chart-grid"
              />
              <text
                x={left - 7}
                y={yCount(count) + 3}
                textAnchor="end"
                className="axis-label"
              >
                {count}
              </text>
            </g>
          );
        })}
        <text x={left} y={15} className="axis-title">
          Number of trades
        </text>
        {bins.map((bin, index) => {
          const end = bin.start + binSize;
          const positive = end > 0;
          return (
            <rect
              key={bin.start}
              x={left + index * barWidth + 1}
              y={yCount(bin.count)}
              width={Math.max(barWidth - 2, 1)}
              height={chartBottom - yCount(bin.count)}
              rx="1.5"
              className={
                positive ? "hist-bar positive-bar" : "hist-bar negative-bar"
              }
            >
              <title>
                {bin.start.toFixed(1)}R to {end.toFixed(1)}R · {bin.count} trade
                {bin.count === 1 ? "" : "s"}
              </title>
            </rect>
          );
        })}
        <line
          x1={xValue(0)}
          y1={top - 5}
          x2={xValue(0)}
          y2={chartBottom}
          className="hist-zero"
        />
        <line
          x1={xValue(mean)}
          y1={top - 5}
          x2={xValue(mean)}
          y2={chartBottom}
          className="reference-line"
        />
        <line
          x1={xValue(med)}
          y1={top - 5}
          x2={xValue(med)}
          y2={chartBottom}
          className="reference-line median-line"
        />
        <text
          x={Math.min(xValue(mean) + 4, width - 66)}
          y={23}
          className="reference-label"
        >
          Avg {formatR(mean)}
        </text>
        <text
          x={Math.max(xValue(med) - 4, 48)}
          y={23}
          textAnchor="end"
          className="reference-label"
        >
          Med {formatR(med)}
        </text>
        {labelValues.map((value) => (
          <g key={value}>
            <line
              x1={xValue(value)}
              y1={chartBottom}
              x2={xValue(value)}
              y2={chartBottom + 4}
              className="axis-tick"
            />
            <text
              x={xValue(value)}
              y={chartBottom + 18}
              textAnchor="middle"
              className="axis-label"
            >
              {value > 0 ? "+" : ""}
              {value}R
            </text>
          </g>
        ))}
        <text
          x={(left + width - right) / 2}
          y={chartBottom + 36}
          textAnchor="middle"
          className="axis-title"
        >
          Realized R multiple
        </text>
        <text x={left} y={rugTop - 9} className="axis-title">
          Individual trades
        </text>
        {trades.map((trade, index) => (
          <line
            key={trade.id}
            x1={xValue(trade.r)}
            y1={rugTop + (index % 3) * 4}
            x2={xValue(trade.r)}
            y2={rugTop + 24 + (index % 3) * 4}
            className={trade.r < 0 ? "rug negative-rug" : "rug positive-rug"}
          >
            <title>
              {trade.symbol} · {formatR(trade.r)} · {formatMoney(trade.pnl)}
            </title>
          </line>
        ))}
      </svg>
    </div>
  );
}

export default function Home() {
  const previewIdentity = process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID;
  type View =
    "Journal" | "Catalyst" | "Trade" | "Charts" | "Scans" | "Backtest";
  const [active, setActive] = useState<View>("Charts");
  const navigation = useBrowserStore<{ active: View }>(
    "brontide-navigation-v2",
    { active: "Charts" },
    (value) => {
      const item = value as { active?: string };
      return (
        !!item &&
        [
          "Journal",
          "Catalyst",
          "Trade",
          "Charts",
          "Scans",
          "Backtest",
        ].includes(item.active ?? "")
      );
    },
  );
  useEffect(() => {
    if (navigation.ready) setActive(navigation.value.active);
  }, [navigation.ready]);
  const selectView = (next: View) => {
    setActive(next);
    navigation.save({ active: next });
  };
  const [chartContext, setChartContext] = useState<MarketContext>();
  const [planContext, setPlanContext] = useState<MarketContext>();
  const primary =
    active === "Scans" || active === "Catalyst"
      ? "Discover"
      : active === "Backtest"
        ? "Strategies"
        : active === "Charts"
          ? "Charts"
          : "Trading";
  const navigate = (tab: (typeof nav)[number][0]) =>
    selectView(
      tab === "Discover"
        ? "Scans"
        : tab === "Strategies"
          ? "Backtest"
          : tab === "Trading"
            ? "Trade"
            : "Charts",
    );
  const openChart = (context: MarketContext) => {
    setChartContext(context);
    selectView("Charts");
  };
  const localWorkspace =
    process.env.NEXT_PUBLIC_BRONTIDE_LOCAL === "1" ||
    process.env.NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL === "1";
  const [trades, setTrades] = useState<Trade[]>([]);
  const [modal, setModal] = useState(false);
  const journalModalRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  useModalAccessibility(modal, journalModalRef, () => setModal(false));
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
  const [equityView, setEquityView] = useState<EquityView>("equity");
  const [setupFilter, setSetupFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [todayLabel, setTodayLabel] = useState("Trading overview");
  const [reportingTimezone, setReportingTimezone] = useState("Local timezone");
  const [greeting, setGreeting] = useState("Welcome back, Melvin");
  const [demoMode, setDemoMode] = useState(false);
  const positionCampaignStore = useBrowserStore<TradeCampaign[]>(
    demoStorageKey("brontide-position-campaigns-v1", demoMode),
    EMPTY_POSITION_CAMPAIGNS,
    validSnapshotCampaigns,
  );
  const journalCampaignStore = useBrowserStore<TradeCampaign[]>(
    demoStorageKey("brontide-journal-campaigns-v1", demoMode),
    EMPTY_POSITION_CAMPAIGNS,
    validJournalCampaigns,
  );
  const reviewStore = useBrowserStore<Record<string, JournalReview>>(
    demoStorageKey("brontide-journal-reviews-v1", demoMode),
    EMPTY_REVIEWS,
    validReviews,
  );
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, JournalReview>>({});
  const [reviewMessage, setReviewMessage] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupPreview, setSetupPreview] = useState(false);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const tradeTableRef = useRef<HTMLDivElement>(null);
  const tradeHeaderRef = useRef<HTMLDivElement>(null);
  const tradeRowMeasureRef = useRef<HTMLDivElement>(null);

  const openJournalTrade = (tradeId: string) => {
    setExpandedTrade(tradeId);
    selectView("Journal");
  };
  const createJournalTrade = (item: UnlinkedPositionInput) => {
    if (
      item.associationEligible === false ||
      item.averageEntry == null ||
      !Number.isSafeInteger(item.quantity)
    )
      throw new Error(
        "A complete whole-share position snapshot is required before creating a Journal record.",
      );
    const tradeId = `journal-${item.id}-${crypto.randomUUID()}`;
    const campaign = createSnapshotCampaign({
      campaignId: `campaign-${item.id}-${crypto.randomUUID()}`,
      journalTradeId: tradeId,
      symbol: item.symbol,
      direction: item.direction,
      snapshot: {
        accountId: item.accountId,
        instrumentId: item.instrumentId,
        brokerPositionId: item.id,
        positionRevision: item.positionRevision ?? `${item.id}:${item.changedAt}`,
        confirmedOpenQuantity: item.quantity,
        averageEntry: item.averageEntry,
        observedAt: item.changedAt,
      },
    });
    if (!positionCampaignStore.save([...positionCampaignStore.value, campaign]))
      throw new Error(
        "Journal record save failed. No association was created and existing records were not changed.",
      );
    return tradeId;
  };

  useEffect(() => {
    if (!demoMode || !positionCampaignStore.ready || !journalCampaignStore.ready) return;
    const campaignRows = [
      ...demoJournalRows(),
      ...journalCampaignStore.value.map(journalRowFromCampaign),
      ...positionCampaignStore.value.map(journalRowFromCampaign),
    ];
    const oneRowPerCampaign = [...new Map(campaignRows.map(row => [row.campaignId, row])).values()];
    setTrades([
      ...oneRowPerCampaign,
      ...demoTrades,
    ]);
  }, [demoMode, journalCampaignStore.ready, journalCampaignStore.value, positionCampaignStore.ready, positionCampaignStore.value]);

  useEffect(() => {
    if (active !== "Journal" || !expandedTrade) return;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-journal-trade-id="${CSS.escape(expandedTrade)}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, expandedTrade, trades]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let frame = 0;
    const synchronizeInlineSize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inlineSize = workspace.clientWidth;
        if (inlineSize <= 0) return;
        workspace.style.setProperty(
          "--workspace-inline-size",
          `${inlineSize}px`,
        );
        workspace.dataset.layoutInlineSize = String(inlineSize);
      });
    };
    const observer = new ResizeObserver(synchronizeInlineSize);
    observer.observe(workspace);
    window.addEventListener("resize", synchronizeInlineSize, { passive: true });
    window.visualViewport?.addEventListener("resize", synchronizeInlineSize, {
      passive: true,
    });
    synchronizeInlineSize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", synchronizeInlineSize);
      window.visualViewport?.removeEventListener(
        "resize",
        synchronizeInlineSize,
      );
    };
  }, [authReady, demoMode, session]);

  useEffect(() => {
    const isDemo =
      new URLSearchParams(window.location.search).get("demo") === "1";
    setSetupPreview(
      new URLSearchParams(window.location.search).get("setup") === "1",
    );
    if (isDemo) {
      setDemoMode(true);
      setTrades([...demoJournalRows(), ...demoTrades]);
    }
    const saved = window.localStorage.getItem(LOCAL_TRADE_STORAGE_KEY);
    if (saved && !isDemo) {
      try {
        const parsed = JSON.parse(saved) as Trade[];
        if (isLegacyDemoDataset(parsed))
          window.localStorage.removeItem(LOCAL_TRADE_STORAGE_KEY);
        else if (Array.isArray(parsed) && parsed.length)
          setImportTrades(
            parsed.map((trade) => ({ ...trade, id: String(trade.id) })),
          );
      } catch {
        /* ignore unreadable local backup */
      }
    }
    const now = new Date();
    setTodayLabel(
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now),
    );
    setGreeting(
      `${now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"}, Trader`,
    );
    setReportingTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Local timezone");
    if (isDemo || localWorkspace || !supabase) {
      setAuthReady(true);
      return;
    }
    withAuthTimeout(supabase.auth.getSession(), 5000, {
      data: { session: null },
      error: null,
    }).then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, nextSession: Session | null) => {
        if (event === "PASSWORD_RECOVERY") {
          setRecovering(true);
          setAuthMode("recovery");
        }
        setSession(nextSession);
        setAuthReady(true);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (
      demoMode ||
      new URLSearchParams(window.location.search).get("demo") === "1"
    )
      return;
    const client = supabase;
    if (!session || !client) {
      setTrades([]);
      return;
    }
    let current = true;
    async function loadTrades() {
      setCloudBusy(true);
      setCloudError("");
      const { data, error } = await client!
        .from("trades")
        .select("*")
        .order("trade_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!current) return;
      if (error)
        setCloudError(
          error.message.includes("schema cache")
            ? "The secure trade table still needs to be activated in Supabase."
            : error.message,
        );
      else setTrades((data as TradeRow[]).map(fromRow));
      setCloudBusy(false);
    }
    loadTrades();
    return () => {
      current = false;
    };
  }, [session?.user.id]);

  const journalTrades = useMemo(() => {
    const campaignRows = [
      ...journalCampaignStore.value.map(journalRowFromCampaign),
      ...positionCampaignStore.value.map(journalRowFromCampaign),
    ];
    const keyed = new Map<string, Trade>();
    [...campaignRows, ...trades].forEach((trade) =>
      keyed.set(trade.campaignId ?? trade.id, trade),
    );
    return [...keyed.values()];
  }, [journalCampaignStore.value, positionCampaignStore.value, trades]);

  const filteredTrades = useMemo(() => {
    const cutoff = getCutoff(range);
    return journalTrades.filter((trade) => {
      const reportingDate = trade.closedAt ?? `${trade.date}T23:59:59`;
      return (
        (!cutoff || new Date(reportingDate) >= cutoff) &&
        (setupFilter === "all" || trade.setup === setupFilter) &&
        (directionFilter === "all" || trade.side === directionFilter)
      );
    });
  }, [journalTrades, range, setupFilter, directionFilter]);

  const measuredTrades = useMemo(
    () => filteredTrades.filter(
      (trade) =>
        trade.status === "Closed" &&
        trade.realizedAvailable !== false &&
        trade.costsComplete !== false,
    ),
    [filteredTrades],
  );
  const tableTrades = useMemo(
    () => filteredTrades.filter((trade) =>
      statusFilter === "all" ||
      (statusFilter === "closed" ? trade.status === "Closed" : trade.status !== "Closed"),
    ),
    [filteredTrades, statusFilter],
  );
  const rMeasuredTrades = useMemo(
    () => measuredTrades.filter(trade => trade.finalRAvailable !== false && trade.initialRiskAvailable !== false),
    [measuredTrades],
  );

  const stats = useMemo(() => {
    const result = calculateJournalStatistics(filteredTrades.map(trade => ({
      campaignId: trade.campaignId ?? trade.id,
      currency: trade.currency ?? "USD",
      closedAt: trade.closedAt,
      isClosed: trade.status === "Closed",
      dollarEligible: trade.status === "Closed" && trade.realizedAvailable !== false && trade.costsComplete !== false,
      rEligible: trade.status === "Closed" && trade.realizedAvailable !== false && trade.costsComplete !== false && trade.finalRAvailable !== false && trade.initialRiskAvailable !== false,
      netResult: trade.pnl,
      finalNetR: trade.r,
      plannedRewardRisk: trade.fixedTargetCoverage === 100 ? trade.plannedR : null,
    })));
    const currency = result.currencies.length === 1 ? result.currencies[0] : undefined;
    return {
      pnl: currency?.netPnl ?? 0,
      currency: currency?.currency,
      multipleCurrencies: result.currencies.length > 1,
      winRate: currency?.winRate ?? 0,
      plannedEligible: measuredTrades.filter(trade => trade.fixedTargetCoverage === 100),
      avgPlanned: result.averagePlannedRewardRisk ?? 0,
      rEligible: measuredTrades.filter(trade => trade.finalRAvailable !== false && trade.initialRiskAvailable !== false),
      avgR: result.expectancyR ?? 0,
      profitFactor: currency?.profitFactor ?? null,
      wins: currency?.wins ?? 0,
      losses: currency?.losses ?? 0,
      breakevens: currency?.breakevens ?? 0,
      averageResult: currency?.averageResult ?? 0,
      averageWin: currency?.averageWin ?? null,
      averageLoss: currency?.averageLoss ?? null,
      maxDrawdown: currency?.maxDrawdown ?? 0,
      longestLosingStreak: currency?.longestLosingStreak ?? 0,
      payoff: currency?.payoffRatio ?? null,
    };
  }, [filteredTrades, measuredTrades]);

  const secondaryStats = useMemo(() => {
    return {
      maxDrawdown: stats.maxDrawdown,
      longestLosingStreak: stats.longestLosingStreak,
      payoff: stats.payoff,
    };
  }, [stats.maxDrawdown, stats.longestLosingStreak, stats.payoff]);

  const setupPerformance = useMemo(() => {
    const grouped = new Map<string, Trade[]>();
    measuredTrades.forEach((trade) => grouped.set(trade.setup || "Unclassified", [...(grouped.get(trade.setup || "Unclassified") || []), trade]));
    return [...grouped.entries()]
      .map(([setup, values]) => ({
        setup,
        count: values.length,
        netPnl: values.reduce((sum, trade) => sum + trade.pnl, 0),
        winRate: values.filter(trade => trade.pnl >= .01).length / values.length * 100,
        rCount: values.filter(trade => trade.finalRAvailable !== false && trade.initialRiskAvailable !== false).length,
        avgR: average(values.filter(trade => trade.finalRAvailable !== false && trade.initialRiskAvailable !== false).map(trade => trade.r)),
      }))
      .sort((a, b) => b.avgR - a.avgR);
  }, [measuredTrades]);

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
    if (demoMode) {
      setTrades((current) => [
        { ...trade, id: `demo-new-${Date.now()}` },
        ...current,
      ]);
      setModal(false);
      return;
    }
    if (!supabase) return;
    setCloudBusy(true);
    setCloudError("");
    const { data: saved, error } = await supabase
      .from("trades")
      .insert(toRow(trade))
      .select()
      .single();
    if (error) setCloudError(error.message);
    else {
      setTrades((current) => [fromRow(saved as TradeRow), ...current]);
      setModal(false);
    }
    setCloudBusy(false);
  }

  async function importLocalTrades() {
    if (!importTrades.length || !supabase) return;
    setCloudBusy(true);
    setCloudError("");
    const rows = importTrades.map(({ id: _id, ...trade }) => toRow(trade));
    const { data, error } = await supabase.from("trades").insert(rows).select();
    if (error) setCloudError(error.message);
    else {
      setTrades((current) => [
        ...(data as TradeRow[]).map(fromRow),
        ...current,
      ]);
      window.localStorage.removeItem(LOCAL_TRADE_STORAGE_KEY);
      setImportTrades([]);
      setImportDismissed(true);
    }
    setCloudBusy(false);
  }

  function updateReview(
    tradeId: string,
    update: (review: JournalReview) => JournalReview,
  ) {
    const current = reviewDrafts[tradeId] ?? reviewStore.value[tradeId] ?? {
      schemaVersion: 1,
      campaignId: tradeId,
      tags: [],
      answers: {},
      updatedAt: new Date(0).toISOString(),
    };
    setReviewDrafts((drafts) => ({ ...drafts, [tradeId]: update(current) }));
    setReviewMessage((messages) => ({ ...messages, [tradeId]: "Unsaved review edits" }));
  }

  function saveReview(tradeId: string) {
    const draft = reviewDrafts[tradeId];
    if (!draft) return;
    const saved = { ...draft, updatedAt: new Date().toISOString() };
    if (!reviewStore.save({ ...reviewStore.value, [tradeId]: saved })) {
      setReviewMessage((messages) => ({ ...messages, [tradeId]: "Review save failed. Your edits remain available; existing notes were not overwritten." }));
      return;
    }
    setReviewDrafts((drafts) => {
      const next = { ...drafts };
      delete next[tradeId];
      return next;
    });
    setReviewMessage((messages) => ({ ...messages, [tradeId]: "Review saved locally" }));
  }

  async function signOut() {
    if (demoMode) {
      window.location.assign(window.location.pathname);
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setAuthMode("signin");
  }

  const rangeLabel =
    range === "30"
      ? "Last 30 days"
      : range === "90"
        ? "Last 90 days"
        : range === "ytd"
          ? "This year"
          : "All time";
  const latestTrades = [...tableTrades].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  useEffect(() => {
    const table = tradeTableRef.current;
    const header = tradeHeaderRef.current;
    const row = tradeRowMeasureRef.current;
    if (!table || !header || !row) return;
    let frame = 0;
    const sizeTableViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const visibleRows =
          viewportWidth <= 480 || viewportHeight < 620
            ? 5
            : viewportWidth <= 680 || viewportHeight < 780
              ? 7
              : 10;
        const headerHeight = header.getBoundingClientRect().height;
        const rows = Array.from(
          table.querySelectorAll<HTMLElement>(".trade-row:not(.table-head)"),
        ).slice(0, visibleRows);
        const rowsHeight = rows.reduce(
          (total, item) => total + item.getBoundingClientRect().height,
          0,
        );
        if (headerHeight <= 0 || rowsHeight <= 0) return;
        table.style.setProperty(
          "--journal-table-viewport-height",
          `${headerHeight + rowsHeight}px`,
        );
        table.dataset.visibleRows = String(rows.length);
      });
    };
    const observer = new ResizeObserver(sizeTableViewport);
    observer.observe(header);
    observer.observe(row);
    window.addEventListener("resize", sizeTableViewport, { passive: true });
    window.visualViewport?.addEventListener("resize", sizeTableViewport, {
      passive: true,
    });
    sizeTableViewport();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sizeTableViewport);
      window.visualViewport?.removeEventListener("resize", sizeTableViewport);
    };
  }, [latestTrades.length]);

  const accountLabel = demoMode
    ? "Demo Trader"
    : session?.user.email
        ?.split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Trader";
  const accountEmail = demoMode
    ? "Sample data · no account required"
    : session?.user.email || "Private account";

  if (!authReady)
    return (
      <main className="loading-shell">
        <span className="loading-mark">
          <Icon name="spark" size={21} />
        </span>
        <p>Opening your journal…</p>
      </main>
    );
  if (setupPreview) return <SetupScreen forceUnconfigured />;
  if (!localWorkspace && !demoMode && !supabaseConfig.isConfigured)
    return <SetupScreen />;
  if (!localWorkspace && !demoMode && (!session || recovering))
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        onRecovered={() => {
          setRecovering(false);
          setAuthMode("signin");
        }}
      />
    );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="spark" size={17} />
          </span>
          <span>Brontide</span>
        </div>
        {previewIdentity && (
          <output
            className="preview-identity"
            data-preview-identifier={previewIdentity}
            aria-label={`Preview revision ${previewIdentity}`}
          >
            Preview {previewIdentity}
          </output>
        )}
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(([label, icon]) => (
            <button
              key={label}
              className={`nav-item ${primary === label ? "active" : ""}`}
              aria-current={primary === label ? "page" : undefined}
              onClick={() => navigate(label)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        {!demoMode && (
          <div className="utility-nav">
            <button className="nav-item" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" />
              <span>Cloud settings</span>
            </button>
          </div>
        )}
        <div className="profile">
          <span className="avatar">{accountLabel.slice(0, 1)}</span>
          <span>
            <b>{accountLabel}</b>
            <small>{accountEmail}</small>
          </span>
          <Icon name={demoMode ? "spark" : "check"} size={16} />
        </div>
      </aside>

      <section
        ref={workspaceRef}
        className={`workspace ${active === "Catalyst" ? "catalyst-workspace" : primary === "Trading" ? "trade-workspace" : active === "Charts" ? "chart-workspace" : active === "Scans" || active === "Backtest" ? "research-container" : ""}`}
      >
        <nav className="mobile-workspace-tabs" aria-label="Workspace tabs">
          {nav.map(([label]) => (
            <button
              key={label}
              className={primary === label ? "active" : ""}
              onClick={() => navigate(label)}
            >
              {label}
            </button>
          ))}
        </nav>
        {primary === "Discover" && (
          <nav className="workspace-subtabs" aria-label="Discover views">
            <button
              className={active === "Scans" ? "active" : ""}
              onClick={() => selectView("Scans")}
            >
              Scans
            </button>
            <button
              className={active === "Catalyst" ? "active" : ""}
              onClick={() => selectView("Catalyst")}
            >
              Catalysts
            </button>
          </nav>
        )}
        {primary === "Trading" && (
          <nav
            className="workspace-subtabs trading-tabs"
            aria-label="Trading views"
          >
            <button
              className={active === "Trade" ? "active" : ""}
              onClick={() => selectView("Trade")}
            >
              Plan &amp; Position
            </button>
            <button
              className={active === "Journal" ? "active" : ""}
              onClick={() => selectView("Journal")}
            >
              Journal
            </button>
          </nav>
        )}
        <div hidden={active !== "Catalyst"}>
          <CatalystDashboard demo={demoMode} onChart={openChart} />
        </div>
        <div hidden={active !== "Trade"}>
          <TradingWorkspace
            demo={demoMode}
            context={planContext}
            onChart={openChart}
            onOpenJournalTrade={openJournalTrade}
            onCreateJournalTrade={createJournalTrade}
            positionCampaigns={positionCampaignStore.value}
          />
        </div>
        {active === "Charts" && (
          <ChartDashboard
            navigation={[
              ...nav.map(([label]) => ({
                label,
                onSelect: () => navigate(label),
              })),
              ...(!demoMode
                ? [
                    {
                      label: "Cloud settings",
                      onSelect: () => setSettingsOpen(true),
                    },
                  ]
                : []),
            ]}
            context={chartContext}
            onExit={() => selectView("Scans")}
            onPlan={(context) => {
              setPlanContext({ ...context });
              selectView("Trade");
            }}
          />
        )}
        <div hidden={active !== "Scans"}>
          <ResearchWorkspace
            originalRequest={0}
            demo={demoMode}
            kind="scan"
            onChart={openChart}
          />
        </div>
        <div hidden={active !== "Backtest"}>
          <ResearchWorkspace
            originalRequest={0}
            demo={demoMode}
            kind="backtest"
            onChart={openChart}
          />
        </div>
        <div className="journal-content" hidden={active !== "Journal"}>
          {localWorkspace && !session && !demoMode && (
            <p className="workspace-notice">
              Cloud Journal is not connected in local mode. Local plans and
              fills remain in Trading; existing cloud records are unchanged.
            </p>
          )}
          <header className="topbar">
            <div>
              <p className="eyebrow">{todayLabel}</p>
              <h1>{greeting}</h1>
              <small className="reporting-timezone">Reporting timezone: {reportingTimezone}</small>
            </div>
            <div className="header-actions">
              <span className={`sync-state ${cloudError ? "has-error" : ""}`}>
                <i />
                {demoMode
                  ? "Sample trades"
                  : cloudBusy
                    ? "Syncing…"
                    : cloudError
                      ? "Sync issue"
                      : "Cloud synced"}
              </span>
              <label className="range-control">
                <Icon name="calendar" size={16} />
                <span className="sr-only">Date range</span>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as RangeKey)}
                >
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="ytd">This year</option>
                  <option value="all">All time</option>
                </select>
              </label>
              <label className="range-control compact-filter">
                <span className="sr-only">Setup cohort</span>
                <select value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
                  <option value="all">All setups</option>
                  {[...new Set(trades.map(trade => trade.setup))].sort().map(setup => <option key={setup}>{setup}</option>)}
                </select>
              </label>
              <label className="range-control compact-filter">
                <span className="sr-only">Direction cohort</span>
                <select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value)}>
                  <option value="all">Long + short</option>
                  <option value="Long">Long</option>
                  <option value="Short">Short</option>
                </select>
              </label>
              <button
                className="secondary-button auth-button"
                onClick={signOut}
              >
                {demoMode ? "Exit demo" : "Sign out"}
              </button>
              <button
                className="primary-button"
                disabled={localWorkspace && !session && !demoMode}
                onClick={() => setModal(true)}
              >
                <Icon name="plus" size={17} /> Log trade
              </button>
            </div>
          </header>

          {(cloudError || (importTrades.length > 0 && !importDismissed)) && (
            <section className={`cloud-notice ${cloudError ? "error" : ""}`}>
              <div>
                <strong>
                  {cloudError
                    ? "Cloud setup required"
                    : `${importTrades.length} browser trades found`}
                </strong>
                <span>
                  {cloudError ||
                    "Import them once into your private cloud journal. Review first if these are demonstration trades."}
                </span>
              </div>
              {!cloudError && (
                <div className="cloud-notice-actions">
                  <button onClick={() => setImportDismissed(true)}>
                    Not now
                  </button>
                  <button
                    className="import-button"
                    onClick={importLocalTrades}
                    disabled={cloudBusy}
                  >
                    Import browser trades
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="journal-metric-grid" aria-label="Trading statistics">
            <MetricCard label="Net P&amp;L" title="Sum of eligible closed-campaign net results." value={measuredTrades.length ? formatMoney(stats.pnl) : "Unavailable"} tone={journalSemanticTone(stats.pnl, measuredTrades.length > 0)} detail={`${measuredTrades.length} eligible closed trades`} />
            <MetricCard label="Win rate" value={`${stats.winRate.toFixed(2)}%`} detail={`${stats.wins} wins · ${stats.losses} losses · ${stats.breakevens} flat`} />
            <MetricCard label="Avg planned R:R" value={`1:${stats.avgPlanned.toFixed(1)}`} detail={`${stats.plannedEligible.length} complete fixed-target plans`} />
            <MetricCard label="Expectancy in R" title="Mean final net result divided by frozen initial dollar risk." value={stats.rEligible.length ? formatR(stats.avgR) : "Unavailable"} tone={journalSemanticTone(stats.avgR, stats.rEligible.length > 0)} detail={`${stats.rEligible.length} closed trades with valid risk`} />
            <MetricCard label="Profit factor" value={stats.profitFactor == null ? "Unavailable" : stats.profitFactor === "No losses" ? stats.profitFactor : stats.profitFactor.toFixed(2)} tone={stats.profitFactor == null ? "unavailable" : "neutral"} detail={`${measuredTrades.length} eligible closed trades`} />
            <MetricCard label="Closed" title="Closed campaigns with complete execution history and known costs." value={measuredTrades.length} detail={`${stats.wins}W / ${stats.losses}L / ${stats.breakevens}BE`} />
            <MetricCard label="Avg result" title="Net result divided by eligible closed trade count." value={measuredTrades.length ? formatMoney(stats.averageResult) : "Unavailable"} tone={journalSemanticTone(stats.averageResult, measuredTrades.length > 0)} detail="Per eligible closed trade" />
            <MetricCard label="Avg win" value={stats.averageWin == null ? "Unavailable" : formatMoney(stats.averageWin)} tone={journalSemanticTone(stats.averageWin)} detail={`${stats.wins} winning trades`} />
            <MetricCard label="Avg loss" value={stats.averageLoss == null ? "Unavailable" : formatMoney(stats.averageLoss)} tone={journalSemanticTone(stats.averageLoss)} detail={`${stats.losses} losing trades`} />
            <MetricCard label="Payoff" value={secondaryStats.payoff == null ? "Unavailable" : secondaryStats.payoff.toFixed(2)} tone={secondaryStats.payoff == null ? "unavailable" : "neutral"} detail="Average win ÷ average loss" />
            <MetricCard label="Max drawdown" title="Largest peak-to-trough decline in the selected closed-trade dollar curve; not account equity or intraday drawdown." value={formatMoney(-secondaryStats.maxDrawdown)} tone={journalSemanticTone(-secondaryStats.maxDrawdown)} detail="Selected closed-trade curve" />
            <MetricCard label="Longest loss streak" value={secondaryStats.longestLosingStreak} detail="Consecutive losing trades" />
          </section>
          <p className="journal-eligibility-summary" aria-label="Journal eligibility summary">
            Eligibility: {measuredTrades.length} measured · {filteredTrades.length} recorded · {filteredTrades.length - measuredTrades.length} excluded as open or incomplete · {stats.multipleCurrencies ? "currencies separated" : stats.currency ?? "no currency cohort"}
          </p>

          <section className="analytics-grid">
            <article className="panel equity-panel">
              <div className="panel-heading">
                <div>
                  <h2>{equityView === "equity" ? "Equity curve" : "Drawdown"}</h2>
                  <p>{equityView === "equity" ? "Cumulative closed-trade performance" : "Within selected period · starts at zero"} · {rangeLabel}</p>
                </div>
                <div
                  className="segmented-control"
                  aria-label="Equity chart view and unit"
                >
                  <button className={equityView === "equity" ? "selected" : ""} onClick={() => setEquityView("equity")}>Curve</button>
                  <button className={equityView === "drawdown" ? "selected" : ""} onClick={() => { setEquityView("drawdown"); setEquityMode("dollar"); }}>Drawdown</button>
                  <button
                    className={equityMode === "dollar" ? "selected" : ""}
                    onClick={() => setEquityMode("dollar")}
                  >
                    $
                  </button>
                  <button
                    className={equityMode === "r" ? "selected" : ""}
                    onClick={() => { setEquityMode("r"); setEquityView("equity"); }}
                  >
                    R
                  </button>
                </div>
              </div>
              <div className="chart-summary">
                <strong>
                  {equityView === "drawdown"
                    ? formatMoney(-secondaryStats.maxDrawdown)
                    : equityMode === "dollar"
                      ? formatMoney(stats.pnl)
                    : formatR(
                        rMeasuredTrades.reduce((sum, trade) => sum + trade.r, 0),
                      )}
                </strong>
                <span>{measuredTrades.length} measured trades in view</span>
              </div>
              <EquityChart trades={equityMode === "r" ? rMeasuredTrades : measuredTrades} mode={equityMode} view={equityView} />
            </article>

            <article className="panel distribution-panel">
              <div className="panel-heading">
                <div>
                  <h2>Realized R distribution</h2>
                  <p>Where trades finished</p>
                </div>
                <span className="trade-count">
                  {rMeasuredTrades.length} measured trades
                </span>
              </div>
              <div className="distribution-summary">
                <span>
                  Average{" "}
                  <b className={stats.avgR >= 0 ? "positive" : "negative"}>
                    {formatR(stats.avgR)}
                  </b>
                </span>
                <span>
                  Median{" "}
                  <b>
                    {formatR(median(rMeasuredTrades.map((trade) => trade.r)))}
                  </b>
                </span>
              </div>
              <DistributionChart trades={rMeasuredTrades} />
            </article>
          </section>

          <section className="lower-grid journal-flow">
            <article className="panel trades-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent trades</h2>
                  <p>Risk, execution and realized outcome</p>
                </div>
                <label className="compact-status-filter">
                  <span className="sr-only">Trade row status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                    <option value="all">All records</option>
                    <option value="open">Open records</option>
                    <option value="closed">Closed records</option>
                  </select>
                </label>
              </div>
              <p className="table-scroll-hint">
                Swipe horizontally to review all trade metrics.
              </p>
              <div
                className="trade-table"
                ref={tradeTableRef}
                tabIndex={0}
                role="region"
                aria-label="Recent trades; scroll vertically for more records and horizontally for all metrics"
              >
                <div className="trade-row table-head" ref={tradeHeaderRef}>
                  <span>Date</span>
                  <span>Symbol</span>
                  <span>Side</span>
                  <span>Status</span>
                  <span>Initial risk $</span>
                  <span>Planned reward/risk</span>
                  <span>Realized P&amp;L $</span>
                  <span>Final Net R</span>
                  <span>Review</span>
                </div>
                {latestTrades.map((trade, index) => (
                  <div className="journal-trade-group" key={trade.id}>
                    <div
                      className={`trade-row ${trade.simulated ? "simulated" : ""}`}
                      data-journal-trade-id={trade.id}
                      ref={index === 0 ? tradeRowMeasureRef : undefined}
                      tabIndex={-1}
                    >
                      <span>{shortDate(trade.date)}</span>
                      <span className="symbol-cell">
                        <button
                          className="journal-expand"
                          aria-expanded={expandedTrade === trade.id}
                          onClick={() =>
                            setExpandedTrade((current) =>
                              current === trade.id ? null : trade.id,
                            )
                          }
                        >
                          {trade.symbol}
                        </button>
                        <small>
                          {trade.setup}
                          {trade.simulated ? " · Simulation" : ""}
                        </small>
                        <small>{trade.provenance ?? "Manual"}</small>
                      </span>
                      <span>
                        <i className={`side-pill ${trade.side.toLowerCase()}`}>
                          {trade.side}
                        </i>
                      </span>
                      <span><i className="status-pill">{trade.status ?? "Closed"}</i></span>
                      <span>{trade.initialRiskAvailable === false ? "Unavailable" : formatMoney(trade.risk, false)}</span>
                      <span>{trade.fixedTargetCoverage === 100 ? `1:${trade.plannedR.toFixed(1)}` : `${trade.fixedTargetCoverage ?? 0}% fixed · incomplete`}</span>
                      <span
                        className={journalSemanticClass(journalSemanticTone(trade.pnl, trade.realizedAvailable !== false))}
                      >
                        {trade.realizedAvailable === false ? "Unavailable" : `${formatMoney(trade.pnl)}${trade.costsComplete === false ? " provisional" : ""}`}
                      </span>
                      <span className={journalSemanticClass(journalSemanticTone(trade.r, trade.finalRAvailable !== false && trade.status === "Closed"))}>
                        {trade.finalRAvailable === false || trade.status !== "Closed" ? "Unavailable" : formatR(trade.r)}
                      </span>
                      <span>
                        {reviewStore.value[trade.id] ? "Reviewed" : `Grade ${trade.grade}`}
                      </span>
                    </div>
                    {expandedTrade === trade.id && (
                      <section
                        className="journal-execution-details"
                        aria-label={`${trade.symbol} entry and exit details`}
                      >
                        <header>
                          <div>
                            <strong>{trade.symbol} execution detail</strong>
                            <span>
                              {trade.status ?? "Closed"} · {trade.openQuantity ?? 0} shares open
                            </span>
                          </div>
                          <i>SIMULATED · NOT BROKER CONFIRMED</i>
                        </header>
                        {trade.historyStatus && (
                          <p className="workspace-notice">{trade.historyStatus}</p>
                        )}
                        <div className="journal-detail-grid">
                          <span><small>Planned entry / size</small><b>{trade.journalSnapshot?.plannedEntry ? `${formatMoney(trade.journalSnapshot.plannedEntry, false)} · ${trade.journalSnapshot.plannedQuantity ?? "—"} sh` : "Unavailable"}</b></span>
                          <span><small>Actual weighted entry</small><b>{trade.weightedEntry ? formatMoney(trade.weightedEntry, false) : "Unavailable"}</b></span>
                          <span><small>Original / current stop</small><b>{trade.journalSnapshot?.originalStop ? `${formatMoney(trade.journalSnapshot.originalStop, false)} / ${trade.journalSnapshot.currentConfirmedStop ? formatMoney(trade.journalSnapshot.currentConfirmedStop, false) : "Unavailable"}` : "Unavailable"}</b></span>
                          <span><small>Initial dollar risk</small><b>{trade.initialRiskAvailable === false ? "Unavailable" : formatMoney(trade.risk, false)}</b></span>
                          <span><small>Entered / exited / remaining</small><b>{trade.enteredQuantity ?? "—"} / {trade.exitedQuantity ?? "—"} / {trade.openQuantity ?? "—"}</b></span>
                          <span><small>Weighted exit</small><b>{trade.weightedExit ? formatMoney(trade.weightedExit, false) : "Unavailable"}</b></span>
                          <span><small>Gross / costs / net</small><b className={journalSemanticClass(journalSemanticTone(trade.pnl, trade.grossRealized != null && trade.status === "Closed" && trade.costs != null))}>{trade.grossRealized == null ? "Unavailable" : `${formatMoney(trade.grossRealized)} / ${trade.costs == null ? "provisional" : formatMoney(trade.costs)} / ${trade.status === "Closed" && trade.costs != null ? formatMoney(trade.pnl) : "Unavailable"}`}</b></span>
                          <span><small>Entry / closure / duration</small><b>{trade.firstFillAt ? new Date(trade.firstFillAt).toLocaleString() : "Unavailable"}<br />{trade.closedAt ? new Date(trade.closedAt).toLocaleString() : "Open"}<br />{holdingDuration(trade.firstFillAt, trade.closedAt)}</b></span>
                        </div>
                        <div className="journal-plan-detail">
                          <div><strong>Planned exits</strong><p>{trade.journalSnapshot?.plannedTargets?.map(target => `${target.label} ${target.allocationPercent}%${target.multipleR ? ` @ ${target.multipleR}R` : target.price ? ` @ ${formatMoney(target.price, false)}` : ""}`).join(" · ") || "Unavailable"}</p><p>{trade.journalSnapshot?.plannedRunners?.map(runner => `${runner.label} ${runner.allocationPercent}% · ${runner.rule}`).join(" · ") || "No planned runners"}</p>{trade.planId && <button className="text-button" onClick={() => selectView("Trade")}>Open linked Plan &amp; Position</button>}</div>
                          <div><strong>Confirmed amendments</strong><p>{trade.confirmedAmendments?.map(item => item.description).join(" · ") || "None confirmed"}</p><p>{trade.feeAdjustments?.length ? `${trade.feeAdjustments.length} late fee adjustment included` : "No late fee adjustments"}</p></div>
                        </div>
                        <div className="journal-fill-head">
                          <span>Type</span>
                          <span>Shares</span>
                          <span>Price</span>
                          <span>Fee</span>
                          <span>Time</span>
                          <span>Source</span>
                        </div>
                        {(trade.executions ?? []).map((execution) => (
                          <div
                            className="journal-fill-row"
                            key={`${execution.sessionId}:${execution.executionId}`}
                          >
                            <span data-label="Type">
                              <b className={execution.effect}>
                                {execution.effect}
                              </b>{" "}
                              · {execution.role}
                            </span>
                            <span data-label="Shares">
                              {execution.quantity}
                            </span>
                            <span data-label="Price">
                              {formatMoney(execution.price, false)}
                            </span>
                            <span data-label="Fee">
                              {formatMoney(execution.fee, false)}
                            </span>
                            <span data-label="Time">
                              {new Date(execution.occurredAt).toLocaleString()}
                            </span>
                            <span data-label="Source">
                              {execution.provenance === "manual-import"
                                ? "Changed in IBKR"
                                : execution.provenance}
                            </span>
                          </div>
                        ))}
                        <div className="journal-review-form" aria-label={`${trade.symbol} personal review`}>
                          <strong>Personal review <i>optional · Grade {trade.grade}</i></strong>
                          {([
                            ["environment", "Market suitable?"],
                            ["entry", "Entry followed?"],
                            ["risk", "Risk respected?"],
                            ["exits", "Exit rules followed?"],
                          ] as const).map(([key, label]) => (
                            <label key={key}>{label}<select aria-label={`${trade.symbol} ${label}`} value={(reviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.answers[key] ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, answers: { ...review.answers, [key]: event.target.value as "Yes" | "Partly" | "No" } }))}><option value="">Unanswered</option><option>Yes</option><option>Partly</option><option>No</option></select></label>
                          ))}
                          <label>Emotional state<select aria-label={`${trade.symbol} Emotional state`} value={(reviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.emotionalState ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, emotionalState: (event.target.value || undefined) as JournalReview["emotionalState"] }))}><option value="">Unanswered</option><option>Calm</option><option>Hesitant</option><option>FOMO</option><option>Frustrated</option><option>Other</option></select></label>
                          <label className="review-lesson">One lesson<input aria-label={`${trade.symbol} One lesson`} maxLength={180} value={(reviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.lesson ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, lesson: event.target.value }))} /></label>
                          <button className="secondary-button" onClick={() => saveReview(trade.id)} disabled={!reviewDrafts[trade.id]}>Save review</button>
                          <span role="status">{reviewMessage[trade.id]}</span>
                        </div>
                      </section>
                    )}
                  </div>
                ))}
              </div>
            </article>

            <article className="panel setup-panel">
              <div className="panel-heading">
                <div>
                  <h2>Setup performance</h2>
                  <p>Average realized R</p>
                </div>
                <span className="panel-meta">
                  {setupPerformance.length} setups
                </span>
              </div>
              <div className="setup-table">
                <div className="setup-row setup-head">
                  <span>Setup</span>
                  <span>Closed</span>
                  <span>Net P&amp;L</span>
                  <span>Win rate</span>
                  <span>Avg Net R</span>
                </div>
                {setupPerformance.map((item) => (
                  <div className="setup-row" key={item.setup}>
                    <span>{item.setup}</span>
                    <span>{item.count}</span>
                    <span className={item.netPnl >= 0 ? "positive" : "negative"}>{formatMoney(item.netPnl)}</span>
                    <span>{item.winRate.toFixed(1)}%</span>
                    <b className={item.avgR >= 0 ? "positive" : "negative"}>
                      {formatR(item.avgR)} <small>({item.rCount})</small>
                    </b>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </section>

      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setModal(false)}
        >
          <section
            ref={journalModalRef}
            tabIndex={-1}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">New journal entry</p>
                <h2 id="modal-title">Log a trade</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setModal(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <form onSubmit={addTrade}>
              <div className="form-row">
                <label>
                  Symbol
                  <input
                    name="symbol"
                    placeholder="NVDA"
                    required
                    autoFocus
                    data-modal-initial-focus
                  />
                </label>
                <label>
                  Trade date
                  <input
                    name="date"
                    type="date"
                    defaultValue={isoDate()}
                    required
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Side
                  <select name="side">
                    <option>Long</option>
                    <option>Short</option>
                  </select>
                </label>
                <label>
                  Setup
                  <select name="setup">
                    {setups.map((setup) => (
                      <option key={setup}>{setup}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Dollar risk
                  <input
                    name="risk"
                    type="number"
                    min="1"
                    placeholder="150"
                    required
                  />
                </label>
                <label>
                  Planned reward
                  <input
                    name="plannedR"
                    type="number"
                    min=".1"
                    step=".1"
                    placeholder="5.0"
                    required
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Final P&amp;L
                  <input name="pnl" type="number" placeholder="750" required />
                </label>
                <label>
                  Execution grade
                  <select name="grade">
                    <option value="A">A · Followed every rule</option>
                    <option value="B">B · Minor deviation</option>
                    <option value="C">C · Broke the plan</option>
                  </select>
                </label>
              </div>
              <p className="form-help">
                Realized R is calculated automatically as final P&amp;L ÷ dollar
                risk.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  <Icon name="check" size={16} /> Save trade
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {settingsOpen && <SetupScreen onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
