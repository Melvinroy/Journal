"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ComponentType } from "react";
import { Icon } from "./WorkspaceIcon";
import type { Session } from "@supabase/supabase-js";
import type { AuthMode, CloudTradeGateway, CloudTradeRow as TradeRow } from "../lib/cloud-trade-contract";
import { cloudWritesAcknowledged, createCloudRequestScope } from "../lib/cloud-write-acknowledgment";
import { readCloudDraft, saveCloudDraft, clearCloudDraft, type CloudDraft } from "../lib/cloud-trade-draft";
import {
  isLegacyDemoDataset,
  LOCAL_TRADE_STORAGE_KEY,
} from "../lib/local-trade-migration";
import { usePaperExecution } from "./usePaperExecution";
import "./trading-refinement.css";
import "./standalone-connect.css";
import { paperJournalRow } from "../lib/paper-execution";
import { adaptRecordedJournal, adaptSyntheticJournal, type RecordedJournalView, type SyntheticJournalView, type SyntheticJournalRow } from "../lib/local-journal";
import { rememberedChoiceFromResponse } from "../lib/local-account-status";
import { readLocalPlanScope } from "../lib/local-private-plan";
import {
  TradingWorkspace,
  type UnlinkedPositionInput,
} from "./TradingWorkspace";
import { useBrowserStore } from "../lib/use-browser-store";
// The standalone entry imports this workspace too. Cloud-only views are
// supplied by CloudHome, so this module has no runtime import path to them.
export type CloudComponents = {
  AuthScreen: ComponentType<{ mode: AuthMode; setMode: (mode: AuthMode) => void; onRecovered: () => void }>;
  SetupScreen: ComponentType<{ onClose?: () => void; forceUnconfigured?: boolean }>;
  CatalystDashboard: ComponentType<ComponentProps<typeof import("./CatalystDashboard").CatalystDashboard>>;
  ScannerDashboard: ComponentType<ComponentProps<typeof import("./ScannerDashboard").ScannerDashboard>>;
  ResearchWorkspace: ComponentType<ComponentProps<typeof import("./ResearchWorkspace").ResearchWorkspace>>;
  ChartDashboard: ComponentType<ComponentProps<typeof import("./ChartDashboard").ChartDashboard>>;
};
const CloudScreenUnavailable = () => <main className="loading-shell">Cloud workspace is unavailable.</main>;
const CloudViewUnavailable = () => null;
import type { MarketContext } from "../lib/workspace-state";
import { demoStorageKey, standaloneSampleScope, standaloneSampleStorageKey } from "../lib/review-demo";
import { demoJournalRows, journalRowFromCampaign } from "../lib/trading-demo";
import {
  createSnapshotCampaign,
  executionRoleLabel,
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
import { Disclosure, MissingValue } from "./WorkspacePresentation";
import { MetricCard } from "./MetricCard";
import { StandaloneConnect, connectionFixtureFromStatus } from "./StandaloneConnect";
import type { ConnectionFixture } from "./StandaloneConnect";
import { localModuleStatusFromResponse, profileViewFromStandalone, standaloneModules, standaloneViewEnabled, standaloneViewFromProfile } from "./standalone-module";
import type { OptionalStandaloneView } from "./standalone-module";

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
  executions?: (Execution | SyntheticJournalRow["executions"][number])[];
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
  journalSnapshot?: JournalCampaignSnapshot | SyntheticJournalRow["journalSnapshot"];
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

function formatMoney(value: number, showPlus = true) {
  const sign = value < 0 ? "−" : showPlus ? "+" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

function isLedgerRecord(id: string) {
  return /^(paper|recorded|fixture):/.test(id);
}

function recordMoney(id: string, value: number, showPlus = true, maximumFractionDigits = 2) {
  if (!isLedgerRecord(id)) return formatMoney(value, showPlus);
  const sign = value < 0 ? "−" : showPlus ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits})}`;
}

function formatR(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(value % 1 === 0 ? 1 : 2)}R`;
}

function shortDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
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

function useJournalChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 760, height: 260 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function EquityChart({ trades, mode, view }: { trades: Trade[]; mode: EquityMode; view: EquityView }) {
  const { ref, width, height } = useJournalChartSize();
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

  const left = 64;
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
    (cumulative.length === 1 ? 0.5 : index / (cumulative.length - 1)) * (width - left - right);
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
    <div className="equity-chart" ref={ref}>
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
                ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(tick)
                : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(tick)}R`}
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
        {cumulative.length > 1 && <polygon points={area} fill="url(#equity-area)" />}
        {cumulative.length > 1 && <polyline points={points} className="equity-line" />}
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
        {ordered.length > 1 && <text x={left} y={height - 8} className="axis-label">
          {shortDate(ordered[0].date)}
        </text>}
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          className="axis-label"
        >
          {shortDate(ordered[Math.floor(ordered.length / 2)].date)}
        </text>
        {ordered.length > 1 && <text
          x={width - right}
          y={height - 8}
          textAnchor="end"
          className="axis-label"
        >
          {shortDate(ordered[ordered.length - 1].date)}
        </text>}
      </svg>
    </div>
  );
}

function DistributionChart({ trades }: { trades: Trade[] }) {
  const { ref, width, height } = useJournalChartSize();
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

  const left = 32;
  const right = 18;
  const top = 40;
  const chartBottom = height - 100;
  const rugTop = height - 42;
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
    <div className="distribution-chart" ref={ref}>
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
          y={Math.abs(xValue(mean) - xValue(med)) < 90 ? 35 : 23}
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

export default function WorkspaceApp({ standalone = false, cloud = null, cloudComponents = null }: {
  standalone?: boolean; cloud?: CloudTradeGateway | null; cloudComponents?: CloudComponents | null;
}) {
  const AuthScreen: CloudComponents["AuthScreen"] = cloudComponents?.AuthScreen ?? CloudScreenUnavailable;
  const SetupScreen: CloudComponents["SetupScreen"] = cloudComponents?.SetupScreen ?? CloudScreenUnavailable;
  const CatalystDashboard: CloudComponents["CatalystDashboard"] = cloudComponents?.CatalystDashboard ?? CloudViewUnavailable;
  const ScannerDashboard: CloudComponents["ScannerDashboard"] = cloudComponents?.ScannerDashboard ?? CloudViewUnavailable;
  const ResearchWorkspace: CloudComponents["ResearchWorkspace"] = cloudComponents?.ResearchWorkspace ?? CloudViewUnavailable;
  const ChartDashboard: CloudComponents["ChartDashboard"] = cloudComponents?.ChartDashboard ?? CloudViewUnavailable;
  const previewIdentity = process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID;
  type View =
    "Connect" | "Journal" | "Catalyst" | "Trade" | "Charts" | "Scans" | "Scanner" | "Backtest";
  const [active, setActive] = useState<View>(standalone ? "Connect" : "Charts");
  const [localProfile, setLocalProfile] = useState<{ profileId: string; csrf: string; verificationBinding?: string } | null>(null);
  // Keep the warning after a session expires; expiration must never look like normal mode.
  const [verificationMode, setVerificationMode] = useState(false);
  const [localModules, setLocalModules] = useState<
    { kind: "checking" | "sample" | "unavailable" } |
    { kind: "ready"; profileId: string; enabledViews: OptionalStandaloneView[]; canHideTrading: boolean }
  >({ kind: "checking" });
  const [localJournal, setLocalJournal] = useState<{
    profileId: string | null;
    kind: "checking" | "sample" | "recorded" | "unavailable";
    view: RecordedJournalView | SyntheticJournalView | null;
  }>({ profileId: null, kind: "checking", view: null });
  const [localJournalReload, setLocalJournalReload] = useState(0);
  const [localPlanScope, setLocalPlanScope] = useState<{
    profileId: string | null; kind: "checking" | "sample" | "ready" | "unavailable";
    scopeId: string | null;
  }>({ profileId: null, kind: "checking", scopeId: null });
  const [connectionFixture, setConnectionFixture] = useState<ConnectionFixture | null>(null);
  const localProfileRef = useRef<{ profileId: string; csrf: string; verificationBinding?: string } | null>(null);
  const navigationEpoch = useRef(0);
  const initialStandaloneViewRef = useRef<View | null>(null);
  const profileWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const navigation = useBrowserStore<{ active: View }>(
    standalone ? "brontide-standalone-navigation-v2" : "brontide-navigation-v2",
    { active: standalone ? "Connect" : "Charts" },
    (value) => {
      const item = value as { active?: string };
      return (
        !!item &&
        [
          "Connect",
          "Journal",
          "Catalyst",
          "Trade",
          "Charts",
          "Scans",
          "Scanner",
          "Backtest",
        ].includes(item.active ?? "")
      );
    },
  );
  useEffect(() => {
    if (navigation.ready) {
      const query = new URLSearchParams(window.location.search);
      if (standalone) initialStandaloneViewRef.current =
        ["Connect", "Journal", "Trade"].includes(navigation.value.active) ? navigation.value.active : "Connect";
      setActive(standalone
        ? ["Connect", "Journal", "Trade"].includes(navigation.value.active) ? navigation.value.active : "Connect"
        : query.get("paper") === "1" && query.get("demo") !== "1" ? "Trade" : navigation.value.active);
    }
  }, [navigation.ready]);
  useEffect(() => {
    if (!standalone) return;
    const controller = new AbortController();
    const startingEpoch = navigationEpoch.current;
    const headers = { "X-Brontide-Local": "1" };
    (async () => {
      const statusResponse = await fetch("/v1/local/session/status", {
        credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
      });
      if (!statusResponse.ok) {
        setLocalModules({ kind: statusResponse.status === 401 ? "sample" : "unavailable" });
        setLocalJournal({ profileId: null, kind: statusResponse.status === 401 ? "sample" : "unavailable", view: null });
        if (statusResponse.status === 401 && navigationEpoch.current === startingEpoch &&
            initialStandaloneViewRef.current) setActive(initialStandaloneViewRef.current);
        return;
      }
      const status = await statusResponse.json();
      if (status?.authenticated !== true || status?.executionEnabled !== false ||
          typeof status.profileId !== "string" || typeof status.csrf !== "string" ||
          status.brokerAccount !== null || status.environment !== null ||
          (status.verificationProfile === true &&
            (typeof status.verificationBinding !== "string" || !/^fixture-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(status.verificationBinding)))) {
        setLocalModules({ kind: "unavailable" });
        setLocalJournal({ profileId: null, kind: "unavailable", view: null });
        return;
      }
      const profileResponse = await fetch("/v1/local/profile", {
        credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
      });
      if (!profileResponse.ok) {
        setLocalModules({ kind: "unavailable" });
        setLocalJournal({ profileId: null, kind: "unavailable", view: null });
        return;
      }
      const profile = await profileResponse.json();
      const savedView = standaloneViewFromProfile(profile?.selectedView);
      if (profile?.profileId !== status.profileId || profile?.executionEnabled !== false ||
          profile?.brokerAccount !== null || !savedView) {
        setLocalModules({ kind: "unavailable" });
        setLocalJournal({ profileId: null, kind: "unavailable", view: null });
        return;
      }
      if (controller.signal.aborted) return;
      const modulesResponse = await fetch("/v1/local/modules", {
        credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
      });
      const moduleStatus = modulesResponse.ok
        ? localModuleStatusFromResponse(await modulesResponse.json()) : null;
      if (controller.signal.aborted) return;
      if (!modulesResponse.ok && [401, 403, 409].includes(modulesResponse.status)) {
        setLocalModules({ kind: "unavailable" });
        setLocalJournal({ profileId: null, kind: "unavailable", view: null });
        return;
      }
      const principal = { profileId: status.profileId, csrf: status.csrf,
        ...(status.verificationProfile === true ? { verificationBinding: status.verificationBinding as string } : {}) };
      setVerificationMode(status.verificationProfile === true);
      localProfileRef.current = principal;
      setLocalProfile(principal);
      setLocalModules(moduleStatus
        ? { kind: "ready", profileId: principal.profileId, ...moduleStatus }
        : { kind: "unavailable" });
      setLocalJournal({ profileId: principal.profileId, kind: "checking", view: null });
      // Synthetic browser fixtures are excluded from the packaged standalone build.
      if (process.env.NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL === "1" &&
          process.env.NEXT_PUBLIC_BRONTIDE_STANDALONE_BUILD !== "1") {
        setConnectionFixture(connectionFixtureFromStatus(status.connectionFixture));
      }
      if (navigationEpoch.current === startingEpoch) {
        const restoredView = moduleStatus && standaloneViewEnabled(savedView, moduleStatus.enabledViews)
          ? savedView : "Connect";
        setActive(restoredView);
        navigation.save({ active: restoredView });
      }
    })().catch(() => { if (!controller.signal.aborted) {
      setLocalModules({ kind: "unavailable" });
      setLocalJournal({ profileId: null, kind: "unavailable", view: null });
    } });
    return () => { controller.abort(); localProfileRef.current = null; setConnectionFixture(null); };
  }, [standalone]);
  const enabledStandaloneViews: OptionalStandaloneView[] = localModules.kind === "sample"
    ? ["trading", "journal"] : localModules.kind === "ready" && localModules.profileId === localProfile?.profileId
      ? localModules.enabledViews : [];
  const visibleStandaloneViews = standaloneModules[0].views.filter(view =>
    standaloneViewEnabled(view.id, enabledStandaloneViews));
  useEffect(() => {
    if (!standalone || active === "Connect" ||
        visibleStandaloneViews.some(view => view.id === active)) return;
    // A stored view may have been hidden on a previous launch. Its content
    // must not remain visible while local preferences are checked.
    setActive("Connect");
    if (localModules.kind !== "checking") navigation.save({ active: "Connect" });
  }, [standalone, active, localModules, localProfile]);
  useEffect(() => {
    if (!standalone || !localProfile ||
        (active !== "Journal" && active !== "Trade") ||
        !enabledStandaloneViews.includes(active === "Journal" ? "journal" : "trading")) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && localProfileRef.current === localProfile;
    const sessionLost = () => {
      if (!current()) return;
      localProfileRef.current = null;
      setLocalProfile(null);
      setLocalModules({ kind: "unavailable" });
      setLocalJournal({ profileId: null, kind: "unavailable", view: null });
      setLocalPlanScope({ profileId: null, kind: "unavailable", scopeId: null });
    };
    const headers = { "X-Brontide-Local": "1" };
    setLocalJournal({ profileId: localProfile.profileId, kind: "checking", view: null });
    setLocalPlanScope(previous => ({
      profileId: localProfile.profileId, kind: "checking",
      scopeId: previous.profileId === localProfile.profileId ? previous.scopeId : null,
    }));
    let scopeMismatch = false;
    (async () => {
      if (localProfile.verificationBinding) {
        const response = await fetch("/v1/local/journal/verification", {
          credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
        });
        if (!current()) return;
        if (!response.ok) {
          if (response.status === 401) sessionLost();
          throw new Error("Artificial history is unavailable.");
        }
        const view = adaptSyntheticJournal(await response.json(), localProfile.verificationBinding);
        if (!current()) return;
        setLocalJournal({ profileId: localProfile.profileId, kind: "recorded", view });
        setLocalPlanScope({ profileId: localProfile.profileId, kind: "unavailable", scopeId: null });
        return;
      }
      const binding = await fetch("/v1/local/binding", {
        credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
      });
      if (!current()) return;
      if (!binding.ok) {
        if (binding.status === 401) sessionLost();
        throw new Error("Local account choice is unavailable.");
      }
      const choice = rememberedChoiceFromResponse(await binding.json());
      if (!current()) return;
      if (!choice) throw new Error("Local account choice is inconsistent.");
      if (choice.kind === "unbound") {
        setLocalJournal({ profileId: localProfile.profileId, kind: "sample", view: null });
        setLocalPlanScope({ profileId: localProfile.profileId, kind: "sample", scopeId: null });
        return;
      }
      const response = await fetch("/v1/local/journal/recorded", {
        credentials: "same-origin", cache: "no-store", headers, signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        if (response.status === 401) sessionLost();
        throw new Error("Recorded history is unavailable.");
      }
      const view = adaptRecordedJournal(await response.json());
      if (!current()) return;
      const scope = await readLocalPlanScope(localProfile.csrf, controller.signal);
      if (!current()) return;
      if (scope.scopeId !== view.scopeId) {
        scopeMismatch = true;
        throw new Error("Recorded history and private plan refer to different paper scopes.");
      }
      setLocalJournal({ profileId: localProfile.profileId, kind: "recorded", view });
      setLocalPlanScope({ profileId: localProfile.profileId,
        kind: "ready", scopeId: scope.scopeId });
    })().catch(() => {
      if (current()) {
        setLocalJournal({ profileId: localProfile.profileId, kind: "unavailable", view: null });
        setLocalPlanScope(previous => ({
          profileId: localProfile.profileId, kind: "unavailable",
          scopeId: !scopeMismatch && previous.profileId === localProfile.profileId
            ? previous.scopeId : null,
        }));
      }
    });
    return () => controller.abort();
  }, [standalone, localProfile, localJournalReload, active, localModules]);
  useEffect(() => {
    if (!standalone || (active !== "Journal" && active !== "Trade") ||
        !enabledStandaloneViews.includes(active === "Journal" ? "journal" : "trading")) return;
    const refreshOnReturn = () => {
      if (!localProfileRef.current) return;
      setLocalJournal({ profileId: localProfileRef.current.profileId, kind: "checking", view: null });
      setLocalJournalReload(value => value + 1);
    };
    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
  }, [standalone, active, localModules]);
  useEffect(() => {
    if (!standalone || !localProfile || !navigation.ready) return;
    const view = profileViewFromStandalone(active);
    if (!view) return;
    const invalidateLocalProfile = () => {
      if (localProfileRef.current !== localProfile) return;
      localProfileRef.current = null;
      setLocalProfile(null);
      setConnectionFixture(null);
      setLocalModules({ kind: "unavailable" });
      setLocalJournal({ profileId: null, kind: "unavailable", view: null });
      setLocalPlanScope({ profileId: null, kind: "unavailable", scopeId: null });
    };
    // Serialize writes so rapid navigation cannot persist an older view last.
    profileWriteQueue.current = profileWriteQueue.current.catch(() => {}).then(async () => {
      if (localProfileRef.current !== localProfile) return;
      const response = await fetch("/v1/local/profile/view", {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Brontide-Local": "1", "X-Brontide-CSRF": localProfile.csrf },
        body: JSON.stringify({ view }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          invalidateLocalProfile();
        }
        return;
      }
      const saved = await response.json();
      if (saved?.selectedView !== view || saved?.executionEnabled !== false) {
        invalidateLocalProfile();
      }
    }).catch(() => { /* The view stays usable with sample data if the local service disappears. */ });
  }, [active, localProfile, navigation.ready, standalone]);
  const selectView = (next: View) => {
    if (standalone && (next !== "Connect" &&
        !visibleStandaloneViews.some(view => view.id === next))) return;
    navigationEpoch.current += 1;
    if (standalone && (next === "Journal" || next === "Trade") && localProfileRef.current) {
      setLocalJournal({ profileId: localProfileRef.current.profileId, kind: "checking", view: null });
      // Re-selecting the active tab also refreshes its saved history. Without
      // this, the tab can remain on "Checking" because active did not change.
      if (active === next) setLocalJournalReload(value => value + 1);
    }
    setActive(next);
    navigation.save({ active: next });
  };
  const saveLocalModules = async (enabledViews: OptionalStandaloneView[]): Promise<boolean> => {
    const principal = localProfileRef.current;
    if (!principal || localModules.kind !== "ready" ||
        localModules.profileId !== principal.profileId) return false;
    try {
      const response = await fetch("/v1/local/modules", {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Brontide-Local": "1",
                   "X-Brontide-CSRF": principal.csrf },
        body: JSON.stringify({ enabledViews }),
      });
      if (localProfileRef.current !== principal) return false;
      const saved = response.ok ? localModuleStatusFromResponse(await response.json()) : null;
      if (!saved) {
        setLocalModules({ kind: "unavailable" });
        return false;
      }
      setLocalModules({ kind: "ready", profileId: principal.profileId, ...saved });
      return true;
    } catch {
      if (localProfileRef.current === principal) setLocalModules({ kind: "unavailable" });
      return false;
    }
  };
  const [chartContext, setChartContext] = useState<MarketContext>();
  const [chartReturnView, setChartReturnView] = useState<View>("Scans");
  const [planContext, setPlanContext] = useState<MarketContext>();
  const primary =
    active === "Scans" || active === "Scanner" || active === "Catalyst"
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
    if (standalone) {
      setStandaloneMessage("Charts are not enabled in this Trading preview.");
      return;
    }
    setChartReturnView(active);
    setChartContext(context);
    selectView("Charts");
  };
  const localWorkspace =
    process.env.NEXT_PUBLIC_BRONTIDE_LOCAL === "1" ||
    process.env.NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL === "1";
  const [standaloneMessage, setStandaloneMessage] = useState("");
  const [tradeBucket, setTradeBucket] = useState<{ owner: string; rows: Trade[] }>({ owner: "signed-out", rows: [] });
  const [modal, setModal] = useState(false);
  const journalModalRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [recovering, setRecovering] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudReload, setCloudReload] = useState(0);
  const [cloudSessionRevision, setCloudSessionRevision] = useState(0);
  const cloudSessionKey = useRef<string | null>(null);
  const [cloudDraft, setCloudDraft] = useState<CloudDraft | null>(null);
  const cloudDraftReceipt = useRef<string | null | undefined>(undefined);
  const [importTrades, setImportTrades] = useState<Trade[]>([]);
  const importBackup = useRef<string | null>(null);
  const [importUncertain, setImportUncertain] = useState(false);
  const [importDismissed, setImportDismissed] = useState(false);
  const [range, setRange] = useState<RangeKey>("30");
  const [equityMode, setEquityMode] = useState<EquityMode>("dollar");
  const [equityView, setEquityView] = useState<EquityView>("equity");
  const [setupFilter, setSetupFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [journalSource, setJournalSource] = useState("all");
  const [journalSearch, setJournalSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [todayLabel, setTodayLabel] = useState("Trading overview");
  const [reportingTimezone, setReportingTimezone] = useState("Local timezone");
  const [greeting, setGreeting] = useState("Welcome back, Melvin");
  const [demoMode, setDemoMode] = useState(standalone);
  const sampleScope = standaloneSampleScope(localProfile?.profileId ?? null);
  const journalState = standalone && localJournal.profileId !== (localProfile?.profileId ?? null)
    ? { profileId: localProfile?.profileId ?? null, kind: "checking" as const, view: null }
    : localJournal;
  const tradeOwner = standalone ? sampleScope : demoMode ? "demo" : session?.user.id ?? "signed-out";
  const importRecoveryKey = `brontide-cloud-import-pending-v1:${encodeURIComponent(tradeOwner)}`;
  const currentTradeOwner = useRef(tradeOwner);
  const cloudRequests = useRef(createCloudRequestScope());
  if (currentTradeOwner.current !== tradeOwner) cloudRequests.current.advance();
  currentTradeOwner.current = tradeOwner;
  useEffect(() => {
    // A response from the previous account must not leave the new account's
    // cloud controls stuck in a busy or error state.
    setCloudBusy(false);
    setCloudError("");
    setModal(false);
    try { setImportUncertain(window.localStorage.getItem(importRecoveryKey) !== null); }
    catch { setImportUncertain(true); }
  }, [tradeOwner]);
  const trades = tradeBucket.owner === tradeOwner ? tradeBucket.rows : [];
  function setTrades(update: Trade[] | ((previous: Trade[]) => Trade[])) {
    if (currentTradeOwner.current !== tradeOwner) return;
    setTradeBucket(previous => ({ owner: tradeOwner, rows: typeof update === "function"
      ? update(previous.owner === tradeOwner ? previous.rows : []) : update }));
  }
  const paper = usePaperExecution(session?.access_token, !standalone && localWorkspace && !demoMode);
  const tradingScope = standalone ? sampleScope : demoMode ? "demo" : paper.enabled ? `paper:${paper.identity?.userId ?? `pending-${session?.user.id ?? "signed-out"}`}:${paper.identity?.accountBinding ?? "unlinked"}` : `planning:${session?.user.id ?? "signed-out"}`;
  const tradingStorageKey = (key: string) => standalone ? standaloneSampleStorageKey(key, sampleScope) : demoMode ? demoStorageKey(key, true) : `${key}:scope:${tradingScope}`;
  const positionCampaignStore = useBrowserStore<TradeCampaign[]>(
    tradingStorageKey("brontide-position-campaigns-v1"),
    EMPTY_POSITION_CAMPAIGNS,
    validSnapshotCampaigns,
  );
  const journalCampaignStore = useBrowserStore<TradeCampaign[]>(
    tradingStorageKey("brontide-journal-campaigns-v1"),
    EMPTY_POSITION_CAMPAIGNS,
    validJournalCampaigns,
  );
  const reviewStore = useBrowserStore<Record<string, JournalReview>>(
    tradingStorageKey("brontide-journal-reviews-v1"),
    EMPTY_REVIEWS,
    validReviews,
  );
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, JournalReview>>({});
  const [reviewMessage, setReviewMessage] = useState<Record<string, string>>({});
  const [reviewScope, setReviewScope] = useState(tradingScope);
  const scopedReviewDrafts = reviewScope === tradingScope ? reviewDrafts : {};
  const scopedReviewMessage = reviewScope === tradingScope ? reviewMessage : {};
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupPreview, setSetupPreview] = useState(false);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const scopedExpandedTrade = reviewScope === tradingScope ? expandedTrade : null;
  const scopedModal = modal && reviewScope === tradingScope;
  useModalAccessibility(scopedModal, journalModalRef, () => setModal(false));
  useEffect(() => {
    setReviewDrafts({}); setReviewMessage({}); setExpandedTrade(null); setReviewScope(tradingScope);
    setModal(false); setSettingsOpen(false); setJournalSearch("");
  }, [tradingScope]);
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
    if (active !== "Journal" || !scopedExpandedTrade) return;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-journal-trade-id="${CSS.escape(scopedExpandedTrade)}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, scopedExpandedTrade, trades]);

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
      standalone || new URLSearchParams(window.location.search).get("demo") === "1";
    setSetupPreview(!standalone &&
      new URLSearchParams(window.location.search).get("setup") === "1",
    );
    if (isDemo) {
      setDemoMode(true);
      if (!standalone) setTradeBucket({ owner: "demo", rows: [...demoJournalRows(), ...demoTrades] });
    }
    if (!isDemo) {
      const saved = window.localStorage.getItem(LOCAL_TRADE_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Trade[];
          if (isLegacyDemoDataset(parsed))
            window.localStorage.removeItem(LOCAL_TRADE_STORAGE_KEY);
          else if (Array.isArray(parsed) && parsed.length)
          {
            importBackup.current = saved;
            setImportTrades(
              parsed.map((trade) => ({ ...trade, id: String(trade.id) })),
            );
          }
        } catch {
          /* ignore unreadable local backup */
        }
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
    if (isDemo || !cloud?.configured) {
      setAuthReady(true);
      return;
    }
    return cloud.subscribeSession((nextSession, recovery) => {
      const nextKey = nextSession ? `${nextSession.user.id}:${nextSession.access_token}` : null;
      // Supabase repeats SIGNED_IN on focus. Only an actual session transition
      // invalidates work; the revision also catches A -> B -> A in one render.
      if (cloudSessionKey.current !== nextKey) {
        cloudSessionKey.current = nextKey;
        cloudRequests.current.advance();
        setCloudSessionRevision(value => value + 1);
        setCloudBusy(false);
        setCloudError("");
        setModal(false);
      }
      if (recovery) {
        setRecovering(true);
        setAuthMode("recovery");
      }
      setSession(nextSession);
      setAuthReady(true);
    });
  }, [cloud, standalone]);

  useEffect(() => {
    if (standalone) setTradeBucket({ owner: sampleScope, rows: [...demoJournalRows(), ...demoTrades] });
  }, [standalone, sampleScope]);

  useEffect(() => {
    if (
      demoMode ||
      new URLSearchParams(window.location.search).get("demo") === "1"
    )
      return;
    if (!session || !cloud) {
      setTrades([]);
      return;
    }
    const gateway = cloud;
    let current = true;
    const sameSession = cloudRequests.current.capture();
    const isCurrent = () => current && sameSession();
    async function loadTrades() {
      setCloudBusy(true);
      setCloudError("");
      try {
      const { data, error } = await gateway.loadTrades(isCurrent);
      if (!isCurrent()) return;
      if (error)
        setCloudError(
          error.message.includes("schema cache")
            ? "The secure trade table still needs to be activated in Supabase."
            : error.message,
        );
      else setTrades((data ?? []).map(fromRow));
      } catch {
        if (isCurrent()) setCloudError("Cloud history is unavailable. Your recorded paper trades remain separate; try again when connected.");
      } finally { if (isCurrent()) setCloudBusy(false); }
    }
    loadTrades();
    return () => {
      current = false;
    };
  }, [session?.user.id, session?.access_token, cloudSessionRevision, cloudReload, cloud]);

  const journalTrades = useMemo<Trade[]>(() => {
    if (standalone) {
      if (journalState.kind === "recorded") return journalState.view?.rows ?? [];
      return journalState.kind === "sample" ? trades : [];
    }
    const campaignRows = [
      ...journalCampaignStore.value.map(journalRowFromCampaign),
      ...positionCampaignStore.value.map(journalRowFromCampaign),
    ];
    const keyed = new Map<string, Trade>();
    [...campaignRows, ...trades, ...(paper.status?.campaigns ?? []).filter(c => c.summary.entered > 0).map(paperJournalRow)].forEach((trade) =>
      keyed.set(trade.campaignId ?? trade.id, trade),
    );
    return [...keyed.values()];
  }, [journalCampaignStore.value, positionCampaignStore.value, trades, paper.status, standalone, journalState]);

  const filteredTrades = useMemo(() => {
    const cutoff = getCutoff(range);
    return journalTrades.filter((trade) => {
      const reportingDate = trade.closedAt ?? `${trade.date}T23:59:59`;
      return (
        (!cutoff || !trade.date || new Date(reportingDate) >= cutoff) &&
        (setupFilter === "all" || trade.setup === setupFilter) &&
        (directionFilter === "all" || trade.side === directionFilter) &&
        (journalSource === "all" || (journalSource === "paper" ? trade.id.startsWith("paper:") || trade.id.startsWith("recorded:") : !trade.id.startsWith("paper:") && !trade.id.startsWith("recorded:"))) &&
        trade.symbol.toUpperCase().includes(journalSearch.trim().toUpperCase())
      );
    });
  }, [journalTrades, range, setupFilter, directionFilter, journalSource, journalSearch]);

  const journalMoney = (value: number) => standalone && journalState.kind === "recorded"
    ? recordMoney("recorded:summary", value) : formatMoney(value);
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

  function openTradeModal() {
    setCloudDraft(null);
    cloudDraftReceipt.current = undefined;
    setCloudError("");
    if (!demoMode && session) {
      try {
        const saved = readCloudDraft(window.localStorage, session.user.id);
        setCloudDraft(saved.draft);
        cloudDraftReceipt.current = saved.raw;
      } catch {
        setCloudError("Your saved draft could not be read. Cloud saving is unavailable until browser storage is accessible; existing data has been preserved.");
      }
    }
    setModal(true);
  }

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
    if (!cloud || !session || cloudBusy) return;
    let receipt: string;
    try {
      receipt = saveCloudDraft(window.localStorage, session.user.id, toRow(trade), cloudDraftReceipt.current);
      cloudDraftReceipt.current = receipt;
      setCloudDraft(toRow(trade));
    } catch {
      setCloudError("A recovery copy could not be saved, or the saved draft changed in another window. Nothing was submitted. Close and reopen this form to review the saved draft.");
      return;
    }
    const sameSession = cloudRequests.current.capture();
    setCloudBusy(true);
    setCloudError("");
    try {
      const { data: saved, error } = await cloud.addTrade(toRow(trade));
      if (!sameSession()) return;
      if (error) setCloudError(`Cloud save was not confirmed: ${error.message}. Your draft is preserved; check cloud history before trying again.`);
      else if (!saved || !cloudWritesAcknowledged([toRow(trade)], [saved])) {
        setCloudError("Cloud save was not fully acknowledged. Your draft is preserved; check cloud history before trying again.");
      } else {
        setTrades((current) => [fromRow(saved), ...current]);
        if (!clearCloudDraft(window.localStorage, session.user.id, receipt)) {
          setCloudError("Trade saved. A local recovery draft remains; check cloud history before submitting it again.");
        }
        setModal(false);
      }
    } catch {
      if (sameSession()) {
        setCloudError("Cloud save outcome is unknown. Check cloud history before trying again.");
      }
    } finally {
      if (sameSession()) setCloudBusy(false);
    }
  }

  async function importLocalTrades() {
    if (!importTrades.length || !cloud || !session || cloudBusy) return;
    const sameSession = cloudRequests.current.capture();
    const backupBefore = importBackup.current;
    try {
      if (!backupBefore || window.localStorage.getItem(LOCAL_TRADE_STORAGE_KEY) !== backupBefore) throw new Error("Backup changed.");
      window.localStorage.setItem(importRecoveryKey, backupBefore);
    } catch {
      setCloudError("The local backup changed or browser storage is unavailable. Nothing was imported. Reload to review your saved records.");
      return;
    }
    setImportUncertain(true);
    setCloudBusy(true);
    setCloudError("");
    const rows = importTrades.map(({ id: _id, ...trade }) => toRow(trade));
    let acknowledged = false;
    try {
      const { data, error } = await cloud.importTrades(rows);
      if (!sameSession()) return;
      if (error) setCloudError(`Cloud import was not confirmed: ${error.message}. Your local backup is preserved; check cloud history before trying again.`);
      else if (!data || !cloudWritesAcknowledged(rows, data)) {
        setCloudError("Cloud import was not fully acknowledged. Your local backup is preserved; check your records before trying again.");
      } else {
        acknowledged = true;
        setTrades((current) => [
          ...data.map(fromRow),
          ...current,
        ]);
        if (window.localStorage.getItem(LOCAL_TRADE_STORAGE_KEY) === backupBefore) {
          window.localStorage.removeItem(LOCAL_TRADE_STORAGE_KEY);
        } else {
          setCloudError("Import acknowledged. A newer local backup was preserved; reload to review it.");
        }
        if (window.localStorage.getItem(importRecoveryKey) === backupBefore) {
          window.localStorage.removeItem(importRecoveryKey);
          setImportUncertain(false);
        }
      }
    } catch {
      if (sameSession()) {
        setCloudError(acknowledged
          ? "Import confirmed. Local backup cleanup could not be completed. Check cloud history before importing anything again."
          : "Cloud import outcome is unknown. Your local backup is preserved; check cloud history before trying again.");
      }
    } finally {
      if (sameSession()) {
        setCloudBusy(false);
        if (acknowledged) {
          setImportTrades([]);
          setImportDismissed(true);
        }
      }
    }
  }

  function updateReview(
    tradeId: string,
    update: (review: JournalReview) => JournalReview,
  ) {
    const current = scopedReviewDrafts[tradeId] ?? reviewStore.value[tradeId] ?? {
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
    const draft = scopedReviewDrafts[tradeId];
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
    if (!cloud) return;
    if (paper.enabled && session) {
      try { await paper.request("signout", {}); } catch { /* Server lease expires within 60 seconds when unreachable. */ }
    }
    await cloud.signOut();
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
    (b.closedAt ?? b.date).localeCompare(a.closedAt ?? a.date),
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
        table.style.setProperty("--journal-detail-width", `${table.clientWidth}px`);
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
          scopedExpandedTrade ? `${Math.max(headerHeight + rowsHeight, viewportHeight * .7)}px` : `${headerHeight + rowsHeight}px`,
        );
        table.dataset.visibleRows = String(rows.length);
      });
    };
    const observer = new ResizeObserver(sizeTableViewport);
    observer.observe(header);
    observer.observe(row);
    observer.observe(table);
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
  }, [latestTrades.length, scopedExpandedTrade]);

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
  if ((!localWorkspace || active === "Trade" || active === "Journal") && !demoMode && !cloud?.configured)
    return <SetupScreen />;
  if ((!localWorkspace || active === "Trade" || active === "Journal") && !demoMode && (!session || recovering))
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
          {standalone ? (
            visibleStandaloneViews.map(view => <button key={view.id} className={`nav-item ${active === view.id ? "active" : ""}`} aria-current={active === view.id ? "page" : undefined} onClick={() => selectView(view.id)}><Icon name={view.icon} /><span>{view.label}</span></button>)
          ) : nav.map(([label, icon]) => (
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
        {!demoMode && !standalone && (
          <div className="utility-nav">
            <button className="nav-item" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" />
              <span>Cloud settings</span>
            </button>
            {session && (
              <button className="nav-item" onClick={signOut}>
                <Icon name="arrow" />
                <span>Sign out</span>
              </button>
            )}
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
        {demoMode && !standalone && (
          <aside className="demo-access-banner" aria-label="Demo mode">
            <div><strong>Demo data</strong><span>Fictional reports and sample records are isolated from your account.</span></div>
            <button type="button" className="secondary-button" onClick={signOut}>Leave demo and sign in</button>
          </aside>
        )}
        <nav className="mobile-workspace-tabs" aria-label="Workspace tabs">
          {standalone ? (
            visibleStandaloneViews.map(view => <button key={view.id} className={active === view.id ? "active" : ""} onClick={() => selectView(view.id)}>{view.label}</button>)
          ) : nav.map(([label]) => (
            <button
              key={label}
              className={primary === label ? "active" : ""}
              onClick={() => navigate(label)}
            >
              {label}
            </button>
          ))}
        </nav>
        {standalone && (
          <aside className="demo-access-banner" aria-label="Standalone preview status">
            <div><strong>{verificationMode ? "Verification profile — artificial records — execution locked" : "Trading module preview"}</strong><span>{verificationMode ? "Isolated local records for application checks. No broker identity or trading authority." : "Sample data only. Broker connection and order submission are locked until local setup is verified."}</span></div>
          </aside>
        )}
        {standaloneMessage && <p className="workspace-notice" role="status">{standaloneMessage}</p>}
        {!standalone && primary === "Discover" && (
          <nav className="workspace-subtabs" aria-label="Discover views">
            <button
              className={active === "Scans" ? "active" : ""}
              onClick={() => selectView("Scans")}
            >
              Scans
            </button>
            <button
              className={active === "Scanner" ? "active" : ""}
              onClick={() => selectView("Scanner")}
            >
              Scanner
            </button>
            <button
              className={active === "Catalyst" ? "active" : ""}
              onClick={() => selectView("Catalyst")}
            >
              Catalysts
            </button>
          </nav>
        )}
        {primary === "Trading" && (!standalone || active !== "Connect") && (
          <nav
            className="workspace-subtabs trading-tabs"
            aria-label="Trading views"
          >
            {(!standalone || enabledStandaloneViews.includes("trading")) && <button
              className={active === "Trade" ? "active" : ""}
              onClick={() => selectView("Trade")}
            >
              Plan &amp; Position
            </button>}
            {(!standalone || enabledStandaloneViews.includes("journal")) && <button
              className={active === "Journal" ? "active" : ""}
              onClick={() => selectView("Journal")}
            >
              Journal
            </button>}
          </nav>
        )}
        {!standalone && <div hidden={active !== "Catalyst"}>
          <CatalystDashboard demo={demoMode} onChart={openChart} />
        </div>}
        {standalone && active === "Connect" && <StandaloneConnect localSessionActive={!!localProfile} localProfileId={localProfile?.profileId} localCsrf={localProfile?.csrf} fixtureReadiness={connectionFixture} moduleSelection={localModules} onSaveModules={saveLocalModules} canOpenTrading={enabledStandaloneViews.includes("trading")} canOpenJournal={enabledStandaloneViews.includes("journal")} onAccountConfirmed={profileId => {
          if (!localProfile || localProfile.profileId !== profileId || localProfileRef.current !== localProfile) return;
          setLocalModules(previous => previous.kind === "ready" && previous.profileId === profileId
            ? { ...previous, canHideTrading: false } : previous);
          setLocalJournal({ profileId, kind: "unavailable", view: null });
          setLocalPlanScope({ profileId, kind: "unavailable", scopeId: null });
        }} onLocalSessionInvalid={() => {
          if (!localProfile || localProfileRef.current !== localProfile) return;
          localProfileRef.current = null;
          setLocalProfile(null);
          setLocalModules({ kind: "unavailable" });
          setConnectionFixture(null);
          setLocalJournal({ profileId: null, kind: "unavailable", view: null });
          setLocalPlanScope({ profileId: null, kind: "unavailable", scopeId: null });
        }} onOpenTrading={() => selectView("Trade")} onOpenJournal={() => selectView("Journal")} />}
        {(!standalone || enabledStandaloneViews.includes("trading")) && <div hidden={active !== "Trade"}>
          <TradingWorkspace key={tradingScope} storageScope={tradingScope}
            demo={demoMode}
            paper={localWorkspace && !demoMode ? paper : undefined}
            privatePlan={standalone && localProfile &&
              localPlanScope.profileId === localProfile.profileId && localPlanScope.scopeId
              ? { scopeId: localPlanScope.scopeId, csrf: localProfile.csrf,
                  ready: localPlanScope.kind === "ready" && journalState.kind === "recorded" }
              : null}
            localHistory={standalone && localModules.kind !== "sample"
              ? localProfile ? journalState : { kind: "unavailable", view: null }
              : undefined}
            context={planContext}
            onChart={openChart}
            onOpenJournalTrade={!standalone || enabledStandaloneViews.includes("journal") ? openJournalTrade : undefined}
            onCreateJournalTrade={createJournalTrade}
            positionCampaigns={positionCampaignStore.value}
          />
        </div>}
        {!standalone && active === "Charts" && (
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
            onExit={() => selectView(chartReturnView)}
            onPlan={(context) => {
              setPlanContext({ ...context });
              selectView("Trade");
            }}
          />
        )}
        {!standalone && <div hidden={active !== "Scans"}>
          <ResearchWorkspace
            originalRequest={0}
            demo={demoMode}
            kind="scan"
            onChart={openChart}
          />
        </div>}
        {!standalone && <div hidden={active !== "Scanner"}>
          <ScannerDashboard
            local={localWorkspace}
            onChart={(symbol) => openChart({ symbol, mode: "local", adjustment: "all" })}
          />
        </div>}
        {!standalone && <div hidden={active !== "Backtest"}>
          <ResearchWorkspace
            originalRequest={0}
            demo={demoMode}
            kind="backtest"
            onChart={openChart}
          />
        </div>}
        <div className="journal-content" hidden={active !== "Journal" ||
          (standalone && !enabledStandaloneViews.includes("journal"))}>
          {localWorkspace && !session && !demoMode && (
            <p className="workspace-notice">
              Cloud Journal is not connected in local mode. Local plans and
              fills remain in Trading; existing cloud records are unchanged.
            </p>
          )}
          <header className="topbar">
            <div>
              <p className="eyebrow">{todayLabel}</p>
              <h1>Trading journal</h1>
              <small className="reporting-timezone">Reporting timezone: {reportingTimezone}</small>
            </div>
            <div className="header-actions">
              <span className={`sync-state ${cloudError ? "has-error" : ""}`}>
                <i />
                {standalone
                  ? journalState.kind === "recorded" ? verificationMode ? "Artificial verification history" : "Recorded paper history · disconnected" : journalState.kind === "sample" ? "Sample trades" : journalState.kind === "checking" ? "Checking local history…" : "History unavailable"
                  : demoMode
                    ? "Sample trades"
                  : cloudBusy
                    ? "Syncing…"
                    : cloudError
                      ? "Sync issue"
                      : paper.enabled ? "Cloud history synced · paper local" : "Cloud synced"}
              </span>
              {!standalone && <button
                className="secondary-button auth-button"
                onClick={signOut}
              >
                {demoMode ? "Exit demo" : "Sign out"}
              </button>}
              <button
                className="primary-button"
                disabled={(standalone && journalState.kind !== "sample") || (localWorkspace && !session && !demoMode) || (!demoMode && cloudBusy)}
                title={standalone && journalState.kind !== "sample" ? "Recorded paper history is read-only; manual logging is not available." : undefined}
                onClick={openTradeModal}
              >
                <Icon name="plus" size={17} /> Log trade
              </button>
            </div>
          </header>

          {standalone && journalState.kind === "recorded" && <p className="workspace-notice" role="status">
            {journalState.view?.lastRecordedAt
              ? `Latest recorded campaign or fill: ${new Date(journalState.view.lastRecordedAt).toLocaleString()}. Later fee updates may change these saved results.`
              : "No recorded campaign yet."}
            TWS is disconnected here; current positions, stop protection and open orders are unverified.
            {(journalState.view?.uncertainCommandCount ?? 0) > 0 && ` ${journalState.view?.uncertainCommandCount} command outcomes need reconciliation.`}
          </p>}
          {standalone && journalState.kind === "unavailable" && <div className="cloud-notice error" role="alert">
            <div><strong>Recorded history unavailable</strong><span>The local app could not verify this account’s saved history. No sample records or zero exposure are substituted.</span></div>
            <div className="cloud-notice-actions"><button type="button" onClick={() => setLocalJournalReload(value => value + 1)}>Retry local history</button></div>
          </div>}
          {standalone && journalState.kind === "checking" && <p className="workspace-notice" role="status">Checking the local account and saved history…</p>}

          {(cloudError || (importTrades.length > 0 && !importDismissed)) && (
            <section className={`cloud-notice ${cloudError ? "error" : ""}`}>
              <div>
                <strong>
                  {cloudError
                    ? "Cloud journal needs attention"
                    : `${importTrades.length} browser trades found`}
                </strong>
                <span>
                  {cloudError ||
                    (importUncertain ? "A previous import has no confirmed result on this device. Your backup is preserved. Check cloud history for all records before importing again." : "Import them once into your private cloud journal. Review first if these are demonstration trades.")}
                </span>
              </div>
              {cloudError ? (
                <div className="cloud-notice-actions">
                  <button disabled={cloudBusy} onClick={() => setCloudReload(value => value + 1)}>
                    {cloudBusy ? "Retrying…" : "Retry cloud history"}
                  </button>
                </div>
              ) : (
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

          {(!standalone || journalState.kind === "sample" || journalState.kind === "recorded") && <>
          <div className="journal-record-controls" aria-label="Journal filters">              <label className="range-control">
                <Icon name="calendar" size={16} />
                <span>Date range</span>
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
                <span>Setup cohort</span>
                <select value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
                  <option value="all">All setups</option>
                  {[...new Set(journalTrades.map(trade => trade.setup))].sort().map(setup => <option key={setup}>{setup}</option>)}
                </select>
              </label>
              <label className="range-control compact-filter">
                <span>Direction cohort</span>
                <select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value)}>
                  <option value="all">Long + short</option>
                  <option value="Long">Long</option>
                  <option value="Short">Short</option>
                </select>
              </label>

            <label>Find symbol<input type="search" aria-label="Find Journal symbol" placeholder="Symbol" value={journalSearch} onChange={e => setJournalSearch(e.target.value)} /></label>
            <label>Record source<select aria-label="Journal record source" value={journalSource} onChange={e => setJournalSource(e.target.value)}><option value="all">All sources</option><option value="paper">IBKR paper · local</option><option value="history">Historical / manual</option></select></label>
            <button type="button" className="secondary-button" onClick={() => { setRange("30"); setSetupFilter("all"); setDirectionFilter("all"); setJournalSearch(""); setJournalSource("all"); setStatusFilter("all"); }}>Clear filters</button><span>{filteredTrades.length} records{paper.enabled ? " · Paper executions stay on this computer" : ""}</span>
          </div>
          {paper.enabled && !paper.status && <p className="workspace-notice" role="status">Local paper records are unavailable. Totals include loaded records only.</p>}
          {measuredTrades.length === 0 && (!standalone || journalState.kind === "sample" || journalState.kind === "recorded") && !(paper.enabled && !paper.status && journalTrades.length === 0) && <div className="journal-empty-state" role="status"><strong>{journalTrades.length === 0 ? standalone && journalState.kind === "recorded" ? "No saved records" : "No records yet" : filteredTrades.length === 0 ? "No records match these filters" : "No eligible closed trades"}</strong><p>{journalTrades.length === 0 ? standalone && journalState.kind === "recorded" ? "No trade was found in this account’s verified local history. Current broker exposure is still unknown." : "Log a trade or review a confirmed paper execution to begin." : filteredTrades.length === 0 ? "Clear or adjust filters to see your records." : "Your records are below. Performance requires completed trades with execution history and known costs; R metrics also require initial risk."}</p></div>}
          <section className="journal-metric-grid" aria-label="Trading statistics">
            <MetricCard label="Net P&amp;L" title="Sum of eligible closed-campaign net results." value={measuredTrades.length ? journalMoney(stats.pnl) : "Unavailable"} tone={journalSemanticTone(stats.pnl, measuredTrades.length > 0)} detail={`${measuredTrades.length} eligible closed trades`} />
            <MetricCard label="Win rate" value={measuredTrades.length ? `${stats.winRate.toFixed(2)}%` : "Unavailable"} tone={measuredTrades.length ? "neutral" : "unavailable"} detail={`${stats.wins} wins · ${stats.losses} losses · ${stats.breakevens} flat`} />
            <MetricCard label="Expectancy in R" title="Mean final net result divided by frozen initial dollar risk." value={stats.rEligible.length ? formatR(stats.avgR) : "Unavailable"} tone={journalSemanticTone(stats.avgR, stats.rEligible.length > 0)} detail={`${stats.rEligible.length} closed trades with valid risk`} />
            <MetricCard label="Profit factor" value={stats.profitFactor == null ? "Unavailable" : stats.profitFactor === "No losses" ? stats.profitFactor : stats.profitFactor.toFixed(2)} tone={stats.profitFactor == null ? "unavailable" : "neutral"} detail={`${measuredTrades.length} eligible closed trades`} />
            <MetricCard label="Max drawdown" title="Largest peak-to-trough decline in the selected closed-trade dollar curve; not account equity or intraday drawdown." value={measuredTrades.length ? journalMoney(-secondaryStats.maxDrawdown) : "Unavailable"} tone={journalSemanticTone(-secondaryStats.maxDrawdown, measuredTrades.length > 0)} detail="Selected closed-trade curve" />
            <MetricCard label="Closed trades" title="Closed campaigns with complete execution history and known costs." value={measuredTrades.length} detail={`${stats.wins}W / ${stats.losses}L / ${stats.breakevens}BE`} />
          </section>
<Disclosure title="More statistics" name="journal-statistics" scope={standalone ? sampleScope : demoMode ? "demo" : session?.user.id ?? "account"}><section className="journal-metric-grid" aria-label="Additional statistics">            <MetricCard label="Avg planned R:R" value={stats.plannedEligible.length ? `1:${stats.avgPlanned.toFixed(1)}` : "Unavailable"} tone={stats.plannedEligible.length ? "neutral" : "unavailable"} detail={`${stats.plannedEligible.length} complete fixed-target plans`} />
            <MetricCard label="Avg result" title="Net result divided by eligible closed trade count." value={measuredTrades.length ? journalMoney(stats.averageResult) : "Unavailable"} tone={journalSemanticTone(stats.averageResult, measuredTrades.length > 0)} detail="Per eligible closed trade" />
            <MetricCard label="Avg win" value={stats.averageWin == null ? "Unavailable" : journalMoney(stats.averageWin)} tone={journalSemanticTone(stats.averageWin)} detail={`${stats.wins} winning trades`} />
            <MetricCard label="Avg loss" value={stats.averageLoss == null ? "Unavailable" : journalMoney(stats.averageLoss)} tone={journalSemanticTone(stats.averageLoss)} detail={`${stats.losses} losing trades`} />
            <MetricCard label="Payoff" value={secondaryStats.payoff == null ? "Unavailable" : secondaryStats.payoff.toFixed(2)} tone={secondaryStats.payoff == null ? "unavailable" : "neutral"} detail="Average win ÷ average loss" />
            <MetricCard label="Longest loss streak" value={measuredTrades.length ? secondaryStats.longestLosingStreak : "Unavailable"} tone={measuredTrades.length ? "neutral" : "unavailable"} detail="Consecutive losing trades" /></section></Disclosure>
          <p className="journal-eligibility-summary" aria-label="Journal eligibility summary">
            Eligibility: {measuredTrades.length} measured · {filteredTrades.length} recorded · {filteredTrades.length - measuredTrades.length} excluded as open or incomplete · {stats.multipleCurrencies ? "currencies separated" : stats.currency ?? "no currency cohort"}
          </p>

          <section className="analytics-grid">
            <article className={`panel equity-panel ${(equityMode === "r" ? rMeasuredTrades : measuredTrades).length ? "" : "is-empty"}`}>
              <div className="panel-heading">
                <div>
                  <h2>{equityView === "equity" ? "Equity curve" : "Drawdown"}</h2>
                  <p>{equityView === "equity" ? "Cumulative closed-trade performance" : "Within selected period · starts at zero"} · {rangeLabel}</p>
                </div>
                <div className="journal-chart-controls">
                  <label>View<select aria-label="Equity chart view" value={equityView} onChange={event => { setEquityView(event.target.value as EquityView); if (event.target.value === "drawdown") setEquityMode("dollar"); }}><option value="equity">Equity curve</option><option value="drawdown">Drawdown</option></select></label>
                  {equityView === "equity" && <label>Unit<select aria-label="Equity chart unit" value={equityMode} onChange={event => setEquityMode(event.target.value as EquityMode)}><option value="dollar">Dollars</option><option value="r">Risk units (R)</option></select></label>}
                </div>
              </div>
              {equityView === "drawdown" ? <p className="journal-chart-explanation">Decline from the highest cumulative closed-trade profit in this period, in dollars.</p> : equityMode === "r" ? <p className="journal-chart-explanation">1R equals a trade’s initial planned risk. This curve adds the eligible trades’ net R results.</p> : null}
              <div className="chart-summary">
                <strong>
                  {(equityMode === "r" ? rMeasuredTrades : measuredTrades).length === 0 ? "Unavailable" : equityView === "drawdown"
                    ? journalMoney(-secondaryStats.maxDrawdown)
                    : equityMode === "dollar"
                      ? journalMoney(stats.pnl)
                    : formatR(
                        rMeasuredTrades.reduce((sum, trade) => sum + trade.r, 0),
                      )}
                </strong>
                <span>{(equityMode === "r" ? rMeasuredTrades : measuredTrades).length} measured trades in view</span>
              </div>
              {(equityMode === "r" ? rMeasuredTrades : measuredTrades).length ? <EquityChart trades={equityMode === "r" ? rMeasuredTrades : measuredTrades} mode={equityMode} view={equityView} /> : <p className="chart-empty-note">{filteredTrades.length ? "No eligible completed trades for this measurement." : "No records in this selection."}</p>}
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
                  <b className={journalSemanticClass(journalSemanticTone(stats.avgR, rMeasuredTrades.length > 0))}>
                    {rMeasuredTrades.length ? formatR(stats.avgR) : <MissingValue reason="No eligible closed trades with known initial risk" />}
                  </b>
                </span>
                <span>
                  Median{" "}
                  <b>
                    {rMeasuredTrades.length ? formatR(median(rMeasuredTrades.map((trade) => trade.r))) : <MissingValue reason="No eligible closed trades with known initial risk" />}
                  </b>
                </span>
              </div>
              {rMeasuredTrades.length ? <DistributionChart trades={rMeasuredTrades} /> : <p className="chart-empty-note">No completed trades with known initial risk.</p>}
            </article>
          </section>

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
                    <span className={item.netPnl >= 0 ? "positive" : "negative"}>{journalMoney(item.netPnl)}</span>
                    <span>{item.winRate.toFixed(1)}%</span>
                    <b className={item.avgR >= 0 ? "positive" : "negative"}>
                      {formatR(item.avgR)} <small>({item.rCount})</small>
                    </b>
                  </div>
                ))}
              </div>
            </article>

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
                Scroll across for all columns. Open a symbol for execution details and review.
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
                  <span>Setup / source</span>
                  <span>Initial risk $</span>
                  <span title="Planned reward/risk">Planned R:R</span>
                  <span>Realized P&amp;L $</span>
                  <span>Final Net R</span>
                  <span>Review</span>
                </div>
                {latestTrades.length === 0 && <p className="position-empty">No trades match these filters.</p>}
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
                          aria-expanded={scopedExpandedTrade === trade.id}
                          onClick={() => setExpandedTrade(scopedExpandedTrade === trade.id ? null : trade.id)}
                        >
                          {trade.symbol}
                        </button>
                      </span>
                      <span>
                        <i className={`side-pill ${trade.side.toLowerCase()}`}>
                          {trade.side}
                        </i>
                      </span>
                      <span><i className="status-pill">{trade.status ?? "Closed"}</i></span>
                      <span className="journal-setup-source" title={`${trade.setup} · ${trade.provenance ?? "Manual"}${trade.simulated ? " · Simulation" : ""}`}>{trade.setup} · {trade.provenance ?? "Manual"}{trade.simulated ? " · Simulation" : ""}</span>
                      <span>{trade.initialRiskAvailable === false ? <MissingValue reason="Initial risk unavailable" /> : recordMoney(trade.id, trade.risk, false)}</span>
                      <span>{trade.fixedTargetCoverage === 100 ? `1:${trade.plannedR.toFixed(1)}` : `${trade.fixedTargetCoverage ?? 0}% fixed · incomplete`}</span>
                      <span
                        className={journalSemanticClass(journalSemanticTone(trade.pnl, trade.realizedAvailable !== false))}
                      >
                        {trade.realizedAvailable === false ? <MissingValue reason="Realized P&L unavailable" /> : `${recordMoney(trade.id, trade.pnl)}${trade.costsComplete === false ? " provisional" : ""}`}
                      </span>
                      <span className={journalSemanticClass(journalSemanticTone(trade.r, trade.finalRAvailable !== false && trade.status === "Closed"))}>
                        {trade.finalRAvailable === false || trade.status !== "Closed" ? <MissingValue reason="Final Net R unavailable until eligible closure" /> : formatR(trade.r)}
                      </span>
                      <span>
                        {reviewStore.value[trade.id] ? "Reviewed" : isLedgerRecord(trade.id) ? "Not reviewed" : `Grade ${trade.grade}`}
                      </span>
                    </div>
                    {scopedExpandedTrade === trade.id && (
                      <section
                        className="journal-execution-details"
                        aria-label={`${trade.symbol} entry and exit details`}
                      >
                        <header>
                          <div>
                            <strong>{trade.symbol} execution detail</strong>
                            <span>{trade.setup} · {trade.provenance ?? "Manual"}{trade.simulated ? " · Simulation" : ""}</span>
                            <span>
                              {trade.status ?? "Closed"} · {trade.openQuantity ?? 0} shares open
                            </span>
                          </div>
                          <i>{trade.id.startsWith("fixture:") ? "ARTIFICIAL VERIFICATION RECORD · NOT BROKER CONFIRMED" : trade.id.startsWith("recorded:") ? "RECORDED IBKR PAPER HISTORY · LAST KNOWN" : trade.id.startsWith("paper:") ? "BROKER-CONFIRMED PAPER EXECUTIONS" : trade.simulated ? "SIMULATED · NOT BROKER CONFIRMED" : "HISTORICAL / MANUAL RECORD"}</i>
                        </header>
                        {trade.historyStatus && (
                          <p className="workspace-notice">{trade.historyStatus}</p>
                        )}
                        <div className="journal-detail-grid">
                          <span><small>Planned entry / size</small><b>{trade.journalSnapshot?.plannedEntry ? `${recordMoney(trade.id, trade.journalSnapshot.plannedEntry, false, 6)} · ${trade.journalSnapshot.plannedQuantity ?? "—"} sh` : <MissingValue reason="Planned entry unavailable" />}</b></span>
                          <span><small>Actual weighted entry</small><b>{trade.weightedEntry ? recordMoney(trade.id, trade.weightedEntry, false, 6) : <MissingValue reason="Entry execution history unavailable" />}</b></span>
                          <span><small>Original / current stop</small><b>{trade.journalSnapshot?.originalStop ? <>{recordMoney(trade.id, trade.journalSnapshot.originalStop, false, 6)} / {trade.journalSnapshot.currentConfirmedStop ? recordMoney(trade.id, trade.journalSnapshot.currentConfirmedStop, false, 6) : <MissingValue reason="Current confirmed stop unavailable" />}</> : <MissingValue reason="Original stop unavailable" />}</b></span>
                          <span><small>Initial dollar risk</small><b>{trade.initialRiskAvailable === false ? <MissingValue reason="Initial risk unavailable" /> : recordMoney(trade.id, trade.risk, false)}</b></span>
                          <span><small>Entered / exited / remaining</small><b>{trade.enteredQuantity ?? "—"} / {trade.exitedQuantity ?? "—"} / {trade.openQuantity ?? "—"}</b></span>
                          <span><small>Weighted exit</small><b>{trade.weightedExit ? recordMoney(trade.id, trade.weightedExit, false, 6) : <MissingValue reason="Exit execution history unavailable" />}</b></span>
                          <span><small>Gross / costs / net</small><b className={journalSemanticClass(journalSemanticTone(trade.pnl, trade.grossRealized != null && (trade.status === "Closed" || (isLedgerRecord(trade.id) && trade.realizedAvailable !== false)) && trade.costs != null))}>{trade.grossRealized == null ? <MissingValue reason="Gross result unavailable" /> : `${recordMoney(trade.id, trade.grossRealized)} / ${trade.costs == null ? "provisional" : recordMoney(trade.id, trade.costs)} / ${(trade.status === "Closed" || (isLedgerRecord(trade.id) && trade.realizedAvailable !== false)) && trade.costs != null ? recordMoney(trade.id, trade.pnl) : "Unavailable"}`}</b></span>
                          <span><small>Entry / closure / duration</small><b>{trade.firstFillAt ? new Date(trade.firstFillAt).toLocaleString() : "Unavailable"}<br />{trade.closedAt ? new Date(trade.closedAt).toLocaleString() : trade.status === "Closed" ? "Closure time unavailable" : "Open"}<br />{holdingDuration(trade.firstFillAt, trade.closedAt)}</b></span>
                        </div>
                        <div className="journal-plan-detail">
                          <div><strong>Planned exits</strong><p>{trade.journalSnapshot?.plannedTargets?.map(target => `${target.label} ${target.allocationPercent}%${target.multipleR ? ` @ ${target.multipleR}R` : target.price ? ` @ ${recordMoney(trade.id, target.price, false)}` : ""}`).join(" · ") || "Unavailable"}</p><p>{trade.journalSnapshot?.plannedRunners?.map(runner => `${runner.label} ${runner.allocationPercent}% · ${runner.rule}`).join(" · ") || "No planned runners"}</p>{trade.planId && <button className="text-button" onClick={() => selectView("Trade")}>Open linked Plan &amp; Position</button>}</div>
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
                              · {executionRoleLabel(execution.role)}
                            </span>
                            <span data-label="Shares">
                              {execution.quantity}
                            </span>
                            <span data-label="Price">
                              {recordMoney(trade.id, execution.price, false, 6)}
                            </span>
                            <span data-label="Fee">
                              {execution.feeAvailable === false ? <MissingValue reason="Fee unavailable" /> : recordMoney(trade.id, execution.fee, false)}
                            </span>
                            <span data-label="Time">
                              {execution.occurredAt ? new Date(execution.occurredAt).toLocaleString() : "Broker time unavailable"}
                            </span>
                            <span data-label="Source">
                              {execution.provenance === "manual-import"
                                ? "Changed in IBKR"
                                : execution.provenance}
                            </span>
                          </div>
                        ))}
                        {standalone && (trade.id.startsWith("recorded:") || trade.id.startsWith("fixture:")) ?
                          <p className="workspace-notice">Personal review editing for saved paper trades is not available yet.</p> :
                        <div className="journal-review-form" aria-label={`${trade.symbol} personal review`}>
                          <strong>Personal review <i>{trade.id.startsWith("paper:") ? "optional" : `optional · Grade ${trade.grade}`}</i></strong>
                          {([
                            ["environment", "Market suitable?"],
                            ["entry", "Entry followed?"],
                            ["risk", "Risk respected?"],
                            ["exits", "Exit rules followed?"],
                          ] as const).map(([key, label]) => (
                            <label key={key}>{label}<select aria-label={`${trade.symbol} ${label}`} value={(scopedReviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.answers[key] ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, answers: { ...review.answers, [key]: event.target.value as "Yes" | "Partly" | "No" } }))}><option value="">Unanswered</option><option>Yes</option><option>Partly</option><option>No</option></select></label>
                          ))}
                          <label>Emotional state<select aria-label={`${trade.symbol} Emotional state`} value={(scopedReviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.emotionalState ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, emotionalState: (event.target.value || undefined) as JournalReview["emotionalState"] }))}><option value="">Unanswered</option><option>Calm</option><option>Hesitant</option><option>FOMO</option><option>Frustrated</option><option>Other</option></select></label>
                          <label className="review-lesson">One lesson<input aria-label={`${trade.symbol} One lesson`} maxLength={180} value={(scopedReviewDrafts[trade.id] ?? reviewStore.value[trade.id])?.lesson ?? ""} onChange={(event) => updateReview(trade.id, review => ({ ...review, lesson: event.target.value }))} /></label>
                          <button className="secondary-button" onClick={() => saveReview(trade.id)} disabled={!scopedReviewDrafts[trade.id]}>Save review</button>
                          <span role="status">{scopedReviewMessage[trade.id]}</span>
                        </div>}
                      </section>
                    )}
                  </div>
                ))}
              </div>
            </article>


          </section>
          </>}
        </div>
      </section>

      {scopedModal && (
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
              {cloudError && <p role="alert" className="modal-validation">{cloudError}</p>}
              {cloudDraft && <p className="form-help">A recovery draft is saved on this device for this account. Check cloud history before submitting it again; an earlier attempt may already have succeeded.</p>}
              <div className="form-row">
                <label>
                  Symbol
                  <input
                    name="symbol"
                    disabled={!demoMode && cloudBusy}
                    defaultValue={cloudDraft?.symbol}
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
                    disabled={!demoMode && cloudBusy}
                    type="date"
                    defaultValue={cloudDraft?.trade_date ?? isoDate()}
                    required
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Side
                  <select name="side" defaultValue={cloudDraft?.side} disabled={!demoMode && cloudBusy}>
                    <option>Long</option>
                    <option>Short</option>
                  </select>
                </label>
                <label>
                  Setup
                  <select name="setup" defaultValue={cloudDraft?.setup} disabled={!demoMode && cloudBusy}>
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
                    disabled={!demoMode && cloudBusy}
                    defaultValue={cloudDraft?.dollar_risk}
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
                    disabled={!demoMode && cloudBusy}
                    defaultValue={cloudDraft?.planned_r}
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
                  <input name="pnl" type="number" placeholder="750" required defaultValue={cloudDraft?.pnl} disabled={!demoMode && cloudBusy} />
                </label>
                <label>
                  Execution grade
                  <select name="grade" defaultValue={cloudDraft?.grade} disabled={!demoMode && cloudBusy}>
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
                <button type="submit" className="primary-button" disabled={!demoMode && (cloudBusy || cloudDraftReceipt.current === undefined)}>
                  <Icon name="check" size={16} /> {cloudBusy ? "Saving…" : "Save trade"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {settingsOpen && reviewScope === tradingScope && <SetupScreen onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
