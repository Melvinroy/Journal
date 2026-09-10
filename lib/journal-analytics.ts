import {
  executionIdentity,
  rollupCampaign,
  type Execution,
  type JournalCampaignSnapshot,
  type TradeCampaign,
} from "./trading-domain";

export type JournalStatus =
  | "Open"
  | "Partially exited"
  | "Closed"
  | "Incomplete";

export type JournalRecord = {
  campaignId: string;
  journalTradeId: string;
  accountId: string;
  instrumentId?: string;
  symbol: string;
  direction: "Long" | "Short";
  currency: string;
  setup: string;
  provenance: string;
  status: JournalStatus;
  executions: Execution[];
  snapshot?: JournalCampaignSnapshot;
  firstFillAt?: string;
  closedAt?: string;
  enteredQuantity: number;
  exitedQuantity: number;
  remainingQuantity: number;
  weightedEntry: number | null;
  weightedExit: number | null;
  initialRisk: number | null;
  grossRealized: number | null;
  costs: number | null;
  netResult: number | null;
  finalNetR: number | null;
  plannedRewardRisk: number | null;
  fixedTargetCoveragePercent: number;
  isClosed: boolean;
  dollarEligible: boolean;
  rEligible: boolean;
  exclusions: string[];
  holdingDurationMs: number | null;
  confirmedAmendments: TradeCampaign["confirmedAmendments"];
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => (values.length ? sum(values) / values.length : null);

function uniqueExecutions(campaign: TradeCampaign) {
  const unique = new Map<string, Execution>();
  for (const execution of campaign.executions) {
    const key = executionIdentity(execution);
    const existing = unique.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(execution))
      throw new Error("Conflicting executions share one broker identity.");
    if (!existing) unique.set(key, execution);
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      executionIdentity(a).localeCompare(executionIdentity(b)),
  );
}

export function buildJournalRecord(campaign: TradeCampaign): JournalRecord {
  const executions = uniqueExecutions(campaign);
  const snapshot = campaign.journalSnapshot;
  if (!executions.length) {
    return {
      campaignId: campaign.campaignId,
      journalTradeId: campaign.journalTradeId ?? campaign.campaignId,
      accountId: campaign.accountId,
      instrumentId: snapshot?.instrumentId ?? campaign.positionSnapshot?.instrumentId,
      symbol: campaign.symbol,
      direction: campaign.direction,
      currency: snapshot?.currency ?? "USD",
      setup: snapshot?.setup || "Unclassified",
      provenance: snapshot?.provenance ?? "IBKR import",
      status: "Incomplete",
      executions,
      snapshot,
      enteredQuantity: 0,
      exitedQuantity: 0,
      remainingQuantity: campaign.positionSnapshot?.confirmedOpenQuantity ?? 0,
      weightedEntry: campaign.positionSnapshot?.averageEntry ?? null,
      weightedExit: null,
      initialRisk: null,
      grossRealized: null,
      costs: null,
      netResult: null,
      finalNetR: null,
      plannedRewardRisk: null,
      fixedTargetCoveragePercent: 0,
      isClosed: false,
      dollarEligible: false,
      rEligible: false,
      exclusions: ["Execution history, initial risk, fees and historical P&L are unavailable."],
      holdingDurationMs: null,
      confirmedAmendments: campaign.confirmedAmendments,
    };
  }

  const rollup = rollupCampaign({ ...campaign, executions });
  const exits = executions.filter((execution) => execution.effect === "exit");
  const feeAdjustments = campaign.feeAdjustments ?? [];
  const adjustments = sum(feeAdjustments.map((adjustment) => adjustment.amount));
  const costsComplete = snapshot?.costsComplete !== false;
  const riskComplete = snapshot?.riskComplete !== false && rollup.actualInitialRisk > 0;
  const isClosed = rollup.enteredQuantity > 0 && rollup.openQuantity === 0;
  const costs = costsComplete ? rollup.fees + adjustments : null;
  const netResult = costs == null ? null : rollup.grossRealizedPnl - costs;
  const fixedTargets = snapshot?.plannedTargets?.filter(
    (target) => target.multipleR != null,
  ) ?? [];
  const fixedTargetCoveragePercent = sum(
    fixedTargets.map((target) => target.allocationPercent),
  );
  const plannedRewardRisk =
    fixedTargetCoveragePercent === 100
      ? sum(
          fixedTargets.map(
            (target) => target.allocationPercent * (target.multipleR ?? 0),
          ),
        ) / 100
      : null;
  const closedAt = isClosed ? executions.at(-1)?.occurredAt : undefined;
  const exclusions: string[] = [];
  if (!isClosed) exclusions.push("Campaign is not closed.");
  if (!costsComplete) exclusions.push("Final costs are incomplete.");
  if (!riskComplete) exclusions.push("Frozen initial dollar risk is unavailable.");
  if (plannedRewardRisk == null)
    exclusions.push("Fixed targets do not cover the whole planned quantity.");
  const status: JournalStatus = isClosed
    ? "Closed"
    : rollup.exitedQuantity > 0
      ? "Partially exited"
      : "Open";
  return {
    campaignId: campaign.campaignId,
    journalTradeId: campaign.journalTradeId ?? campaign.campaignId,
    accountId: campaign.accountId,
    instrumentId: snapshot?.instrumentId,
    symbol: campaign.symbol,
    direction: campaign.direction,
    currency: snapshot?.currency ?? "USD",
    setup: snapshot?.setup || "Unclassified",
    provenance: snapshot?.provenance ?? (campaign.planId ? "Linked plan" : "IBKR import"),
    status,
    executions,
    snapshot,
    firstFillAt: executions[0]?.occurredAt,
    closedAt,
    enteredQuantity: rollup.enteredQuantity,
    exitedQuantity: rollup.exitedQuantity,
    remainingQuantity: rollup.openQuantity,
    weightedEntry: rollup.actualAverageEntry,
    weightedExit: exits.length
      ? sum(exits.map((execution) => execution.quantity * execution.price)) /
        sum(exits.map((execution) => execution.quantity))
      : null,
    initialRisk: riskComplete ? rollup.actualInitialRisk : null,
    grossRealized: rollup.grossRealizedPnl,
    costs,
    netResult,
    finalNetR:
      isClosed && netResult != null && riskComplete
        ? netResult / rollup.actualInitialRisk
        : null,
    plannedRewardRisk,
    fixedTargetCoveragePercent,
    isClosed,
    dollarEligible: isClosed && netResult != null,
    rEligible: isClosed && netResult != null && riskComplete,
    exclusions,
    holdingDurationMs:
      closedAt && executions[0]
        ? Date.parse(closedAt) - Date.parse(executions[0].occurredAt)
        : null,
    confirmedAmendments: campaign.confirmedAmendments,
  };
}

export type CurrencyJournalStats = {
  currency: string;
  closedCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  netPnl: number;
  winRate: number;
  averageResult: number;
  averageWin: number | null;
  averageLoss: number | null;
  payoffRatio: number | null;
  profitFactor: number | "No losses" | null;
  maxDrawdown: number;
  longestLosingStreak: number;
};

type StatisticalRecord = Pick<
  JournalRecord,
  | "campaignId"
  | "currency"
  | "closedAt"
  | "isClosed"
  | "dollarEligible"
  | "rEligible"
  | "netResult"
  | "finalNetR"
  | "plannedRewardRisk"
>;

export function calculateJournalStatistics(records: StatisticalRecord[]) {
  const dollarRecords = records
    .filter((record) => record.dollarEligible)
    .sort(
      (a, b) =>
        (a.closedAt ?? "").localeCompare(b.closedAt ?? "") ||
        a.campaignId.localeCompare(b.campaignId),
    );
  const byCurrency = new Map<string, StatisticalRecord[]>();
  for (const record of dollarRecords)
    byCurrency.set(record.currency, [...(byCurrency.get(record.currency) ?? []), record]);
  const currencies: CurrencyJournalStats[] = [...byCurrency].map(([currency, group]) => {
    const values = group.map((record) => record.netResult!);
    const precision = 0.01;
    const wins = values.filter((value) => value >= precision);
    const losses = values.filter((value) => value <= -precision);
    const breakevens = values.length - wins.length - losses.length;
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let streak = 0;
    let longestLosingStreak = 0;
    for (const value of values) {
      running += value;
      peak = Math.max(peak, running);
      maxDrawdown = Math.max(maxDrawdown, peak - running);
      if (value <= -precision) {
        streak += 1;
        longestLosingStreak = Math.max(longestLosingStreak, streak);
      } else streak = 0;
    }
    const grossWins = sum(wins);
    const grossLosses = Math.abs(sum(losses));
    const averageWin = mean(wins);
    const averageLoss = mean(losses);
    return {
      currency,
      closedCount: values.length,
      wins: wins.length,
      losses: losses.length,
      breakevens,
      netPnl: sum(values),
      winRate: (wins.length / values.length) * 100,
      averageResult: sum(values) / values.length,
      averageWin,
      averageLoss,
      payoffRatio:
        averageWin != null && averageLoss != null
          ? averageWin / Math.abs(averageLoss)
          : null,
      profitFactor:
        !grossWins && !grossLosses
          ? null
          : grossWins && !grossLosses
            ? "No losses"
            : grossWins / grossLosses,
      maxDrawdown,
      longestLosingStreak,
    };
  });
  const rRecords = records.filter((record) => record.rEligible);
  const planned = records.filter(
    (record) => record.isClosed && record.plannedRewardRisk != null,
  );
  return {
    currencies,
    rEligibleCount: rRecords.length,
    expectancyR: mean(rRecords.map((record) => record.finalNetR!)),
    plannedEligibleCount: planned.length,
    averagePlannedRewardRisk: mean(planned.map((record) => record.plannedRewardRisk!)),
    excludedDollarCount: records.filter((record) => record.isClosed && !record.dollarEligible).length,
    excludedRCount: records.filter((record) => record.isClosed && !record.rEligible).length,
  };
}

export function closedCurve(records: JournalRecord[], mode: "dollar" | "r") {
  const eligible = records
    .filter((record) => (mode === "dollar" ? record.dollarEligible : record.rEligible))
    .sort(
      (a, b) =>
        (a.closedAt ?? "").localeCompare(b.closedAt ?? "") ||
        a.campaignId.localeCompare(b.campaignId),
    );
  let cumulative = 0;
  return eligible.map((record) => ({
    record,
    value: (cumulative += mode === "dollar" ? record.netResult! : record.finalNetR!),
  }));
}

export function drawdownCurve(records: JournalRecord[]) {
  let peak = 0;
  return closedCurve(records, "dollar").map((point) => {
    peak = Math.max(peak, point.value);
    return { ...point, value: point.value - peak };
  });
}
