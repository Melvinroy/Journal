import {
  EXIT_PLAN_SCHEMA_VERSION,
  createSnapshotCampaign,
  rollupCampaign,
  type Execution,
  type ExitPlanDefinition,
  type TradeCampaign,
} from "./trading-domain";

export type DemoPrice = {
  price?: number;
  source: "Simulated quote" | "Disconnected source" | "IBKR snapshot";
  status: "Fresh" | "Stale" | "Unavailable";
  observedAt?: string;
};

export type DemoPosition = {
  campaignId: string;
  accountId: string;
  instrumentId: string;
  positionRevision: string;
  planId?: string;
  symbol: string;
  direction: "Long" | "Short";
  status:
    | "Working entry"
    | "Partially filled"
    | "Open"
    | "Unprotected"
    | "Closed"
    | "Needs Review";
  plannedQuantity?: number;
  filledQuantity?: number;
  openQuantity: number;
  averageEntry?: number;
  plannedEntry?: number;
  plannedRisk?: number;
  fixedInitialStop?: number;
  entryLabel: string;
  protection: {
    state:
      | "Staged"
      | "Pending"
      | "Working"
      | "Rejected"
      | "Failed"
      | "Unknown"
      | "Unprotected"
      | "Complete";
    quantity: number;
    stop?: number;
    confirmed: boolean;
    source: string;
  };
  targets: Array<{
    label: string;
    quantity: number;
    price: number;
    state: "Staged" | "Working" | "Filled";
  }>;
  runner?: { quantity: number; rule: string };
  exitPlan?: ExitPlanDefinition;
  price: DemoPrice;
  changedInIbkr?: boolean;
  stale?: boolean;
  snapshotOnly?: boolean;
  campaign?: TradeCampaign;
  simulated: boolean;
};

const oneTargetTwoRunners: ExitPlanDefinition = {
  schemaVersion: EXIT_PLAN_SCHEMA_VERSION,
  breakeven: { activationR: 2, favorableOffset: { unit: "R", value: 0.25 } },
  legs: [
    {
      id: "T1",
      role: "Target",
      allocationPercent: 35,
      target: { mode: "R", multipleR: 2 },
    },
    {
      id: "Runner A",
      role: "Runner",
      allocationPercent: 35,
      activationR: 1.5,
      trailing: { mode: "SMA", period: 20 },
    },
    {
      id: "Runner B",
      role: "Runner",
      allocationPercent: 30,
      activationR: 3,
      trailing: { mode: "Dollar", distance: 2.5 },
    },
  ],
};

export const DEMO_DEFAULT_EXIT_PLAN: ExitPlanDefinition = {
  schemaVersion: EXIT_PLAN_SCHEMA_VERSION,
  breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } },
  legs: [
    {
      id: "T1",
      role: "Target",
      allocationPercent: 35,
      target: { mode: "R", multipleR: 1 },
    },
    {
      id: "T2",
      role: "Target",
      allocationPercent: 35,
      target: { mode: "R", multipleR: 2 },
    },
    {
      id: "Runner A",
      role: "Runner",
      allocationPercent: 30,
      activationR: 1,
      trailing: { mode: "SMA", period: 10 },
    },
  ],
};

const execution = (
  value: Omit<
    Execution,
    "schemaVersion" | "accountId" | "sessionId" | "provenance"
  > & { provenance?: Execution["provenance"] },
): Execution => ({
  schemaVersion: 1,
  accountId: "SIMULATED-ONLY",
  sessionId: "stage-3-preview",
  provenance: "IBKR",
  ...value,
});

const campaigns: TradeCampaign[] = [
  {
    schemaVersion: 1,
    campaignId: "demo-aapl",
    accountId: "SIMULATED-ONLY",
    planId: "plan-aapl",
    journalTradeId: "journal-aapl",
    symbol: "AAPL",
    direction: "Long",
    journalSnapshot: {
      instrumentId: "US-STK-AAPL", currency: "USD", setup: "Momentum breakout",
      provenance: "Linked plan", plannedEntry: 226, plannedQuantity: 40,
      originalStop: 221.5, plannedInitialRisk: 180,
      plannedTargets: [{ label: "T1", allocationPercent: 50, multipleR: 2 }],
      plannedRunners: [{ label: "Runner", allocationPercent: 50, rule: "10 SMA trail" }],
      capturedAt: "2026-09-08T14:25:00Z", currentConfirmedStop: 221.5,
    },
    lifecycle: { status: "Partially filled" },
    executions: [
      execution({
        executionId: "aapl-entry-1",
        orderId: "sim-aapl-entry",
        campaignId: "demo-aapl",
        effect: "entry",
        role: "entry",
        quantity: 25,
        price: 226.1,
        fee: 0.35,
        occurredAt: "2026-09-08T14:31:00Z",
        protectionStopAtFill: 221.5,
      }),
      execution({
        executionId: "aapl-entry-2",
        orderId: "sim-aapl-entry",
        campaignId: "demo-aapl",
        effect: "entry",
        role: "entry",
        quantity: 15,
        price: 226.3,
        fee: 0.25,
        occurredAt: "2026-09-08T14:33:00Z",
        protectionStopAtFill: 221.5,
      }),
      execution({
        executionId: "aapl-manual-exit",
        orderId: "sim-aapl-external",
        campaignId: "demo-aapl",
        effect: "exit",
        role: "manual",
        quantity: 5,
        price: 228.0,
        fee: 0.18,
        occurredAt: "2026-09-08T15:04:00Z",
        provenance: "manual-import",
      }),
    ],
  },
  {
    schemaVersion: 1,
    campaignId: "demo-mrna",
    accountId: "SIMULATED-ONLY",
    planId: "plan-mrna",
    journalTradeId: "journal-mrna",
    symbol: "MRNA",
    direction: "Short",
    journalSnapshot: {
      instrumentId: "US-STK-MRNA", currency: "USD", setup: "VWAP rejection",
      provenance: "Linked plan", plannedEntry: 90, plannedQuantity: 20,
      originalStop: 94, plannedInitialRisk: 80,
      plannedTargets: [{ label: "T1", allocationPercent: 50, multipleR: 1.25 }],
      plannedRunners: [{ label: "Runner", allocationPercent: 50, rule: "Day-high trail" }],
      capturedAt: "2026-09-05T13:55:00Z", currentConfirmedStop: 94,
    },
    lifecycle: { status: "Open" },
    executions: [
      execution({
        executionId: "mrna-entry",
        orderId: "sim-mrna-entry",
        campaignId: "demo-mrna",
        effect: "entry",
        role: "entry",
        quantity: 20,
        price: 90,
        fee: 1,
        occurredAt: "2026-09-05T14:00:00Z",
        protectionStopAtFill: 94,
      }),
      execution({
        executionId: "mrna-profit",
        orderId: "sim-mrna-t1",
        campaignId: "demo-mrna",
        effect: "exit",
        role: "target",
        quantity: 5,
        price: 85,
        fee: 0.5,
        occurredAt: "2026-09-06T15:00:00Z",
      }),
      execution({
        executionId: "mrna-loss",
        orderId: "sim-mrna-manual",
        campaignId: "demo-mrna",
        effect: "exit",
        role: "manual",
        quantity: 3,
        price: 92,
        fee: 0.5,
        occurredAt: "2026-09-07T15:00:00Z",
        provenance: "manual-import",
      }),
      // Exact replay proves one economic effect in the view model.
      execution({
        executionId: "mrna-loss",
        orderId: "sim-mrna-manual",
        campaignId: "demo-mrna",
        effect: "exit",
        role: "manual",
        quantity: 3,
        price: 92,
        fee: 0.5,
        occurredAt: "2026-09-07T15:00:00Z",
        provenance: "manual-import",
      }),
    ],
  },
  {
    schemaVersion: 1,
    campaignId: "demo-tsla",
    accountId: "SIMULATED-ONLY",
    planId: "plan-tsla",
    journalTradeId: "journal-tsla",
    symbol: "TSLA",
    direction: "Long",
    journalSnapshot: {
      instrumentId: "US-STK-TSLA", currency: "USD", setup: "Earnings gap",
      provenance: "Linked plan", plannedEntry: 347.5, plannedQuantity: 18,
      originalStop: 338, plannedInitialRisk: 171,
      plannedTargets: [{ label: "T1", allocationPercent: 100, multipleR: 2 }],
      capturedAt: "2026-09-04T13:55:00Z", currentConfirmedStop: undefined,
    },
    lifecycle: { status: "Unprotected" },
    executions: [
      execution({
        executionId: "tsla-entry",
        orderId: "sim-tsla-entry",
        campaignId: "demo-tsla",
        effect: "entry",
        role: "entry",
        quantity: 18,
        price: 347.5,
        fee: 0.65,
        occurredAt: "2026-09-04T14:00:00Z",
        protectionStopAtFill: 338,
      }),
    ],
  },
  {
    schemaVersion: 1,
    campaignId: "demo-amd",
    accountId: "SIMULATED-ONLY",
    planId: "plan-amd",
    journalTradeId: "journal-amd",
    symbol: "AMD",
    direction: "Long",
    journalSnapshot: {
      instrumentId: "US-STK-AMD", currency: "USD", setup: "EP breakout",
      provenance: "Linked plan", plannedEntry: 164, plannedQuantity: 20,
      originalStop: 160, plannedInitialRisk: 80,
      plannedTargets: [
        { label: "T1", allocationPercent: 50, multipleR: 2 },
        { label: "T2", allocationPercent: 50, multipleR: 1 },
      ],
      capturedAt: "2026-09-01T13:55:00Z", currentConfirmedStop: 164,
    },
    feeAdjustments: [{
      adjustmentId: "amd-late-fee", amount: 0.2,
      occurredAt: "2026-09-03T16:00:00Z", provenance: "IBKR",
      note: "Final commission adjustment",
    }],
    confirmedAmendments: [{
      amendmentId: "amd-be", occurredAt: "2026-09-02T15:02:00Z",
      description: "Protection confirmed at breakeven after target fill.", provenance: "IBKR",
    }],
    lifecycle: { status: "Closed" },
    executions: [
      execution({
        executionId: "amd-entry",
        orderId: "sim-amd-entry",
        campaignId: "demo-amd",
        effect: "entry",
        role: "entry",
        quantity: 20,
        price: 164,
        fee: 0.5,
        occurredAt: "2026-09-01T14:00:00Z",
        protectionStopAtFill: 160,
      }),
      execution({
        executionId: "amd-target",
        orderId: "sim-amd-target",
        campaignId: "demo-amd",
        effect: "exit",
        role: "target",
        quantity: 10,
        price: 172,
        fee: 0.4,
        occurredAt: "2026-09-02T15:00:00Z",
      }),
      execution({
        executionId: "amd-stop",
        orderId: "sim-amd-stop",
        campaignId: "demo-amd",
        effect: "exit",
        role: "stop",
        quantity: 10,
        price: 164,
        fee: 0.4,
        occurredAt: "2026-09-03T15:00:00Z",
      }),
    ],
  },
  createSnapshotCampaign({
    campaignId: "review-msft",
    journalTradeId: "journal-msft-review",
    symbol: "MSFT",
    direction: "Long",
    snapshot: {
      accountId: "SIMULATED-ONLY",
      instrumentId: "US-STK-MSFT",
      brokerPositionId: "unlinked-msft",
      positionRevision: "msft-snapshot-r1",
      confirmedOpenQuantity: 12,
      averageEntry: 507.4,
      observedAt: "2026-09-08T15:12:00Z",
    },
  }),
];

export const DEMO_CAMPAIGNS = campaigns;

export const DEMO_POSITIONS: DemoPosition[] = [
  {
    campaignId: "demo-pltr",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-PLTR",
    positionRevision: "pltr-r3",
    planId: "plan-pltr",
    symbol: "PLTR",
    direction: "Long",
    status: "Working entry",
    plannedQuantity: 60,
    filledQuantity: 0,
    openQuantity: 0,
    plannedEntry: 161.2,
    plannedRisk: 384,
    fixedInitialStop: 154.8,
    entryLabel: "MIDPRICE · cap $161.20",
    protection: {
      state: "Pending",
      quantity: 0,
      stop: 154.8,
      confirmed: false,
      source: "Simulated adapter",
    },
    targets: [
      { label: "1R", quantity: 21, price: 167.6, state: "Staged" },
      { label: "2R", quantity: 21, price: 174, state: "Staged" },
    ],
    runner: { quantity: 18, rule: "SMA10" },
    exitPlan: DEMO_DEFAULT_EXIT_PLAN,
    price: { source: "Disconnected source", status: "Unavailable" },
    simulated: true,
  },
  {
    campaignId: "demo-aapl",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-AAPL",
    positionRevision: "aapl-r8",
    planId: "plan-aapl",
    symbol: "AAPL",
    direction: "Long",
    status: "Partially filled",
    plannedQuantity: 100,
    filledQuantity: 40,
    openQuantity: 35,
    averageEntry: 226.18,
    plannedEntry: 226,
    plannedRisk: 450,
    fixedInitialStop: 221.5,
    entryLabel: "40 / 100 filled",
    protection: {
      state: "Working",
      quantity: 35,
      stop: 221.5,
      confirmed: true,
      source: "Simulated adapter record",
    },
    targets: [
      { label: "1R", quantity: 12, price: 230.86, state: "Staged" },
      { label: "2R", quantity: 12, price: 235.54, state: "Staged" },
    ],
    runner: { quantity: 11, rule: "SMA20" },
    exitPlan: DEMO_DEFAULT_EXIT_PLAN,
    price: {
      price: 229.4,
      source: "Simulated quote",
      status: "Fresh",
      observedAt: "2026-09-08T15:12:00Z",
    },
    changedInIbkr: true,
    simulated: true,
  },
  {
    campaignId: "demo-nvda-protection",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-NVDA",
    positionRevision: "nvda-r4",
    planId: "plan-nvda",
    symbol: "NVDA",
    direction: "Long",
    status: "Unprotected",
    plannedQuantity: 37,
    filledQuantity: 37,
    openQuantity: 37,
    averageEntry: 120,
    plannedEntry: 120,
    plannedRisk: 74,
    fixedInitialStop: 118,
    entryLabel: "Entry complete",
    protection: {
      state: "Unknown",
      quantity: 30,
      stop: 118,
      confirmed: true,
      source: "Simulated reconciliation",
    },
    targets: [{ label: "2R", quantity: 13, price: 124, state: "Working" }],
    runner: { quantity: 24, rule: "Two independent rules" },
    exitPlan: oneTargetTwoRunners,
    price: {
      price: 123.2,
      source: "Simulated quote",
      status: "Stale",
      observedAt: "2026-09-08T14:30:00Z",
    },
    simulated: true,
  },
  {
    campaignId: "demo-mrna",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-MRNA",
    positionRevision: "mrna-r11",
    planId: "plan-mrna",
    symbol: "MRNA",
    direction: "Short",
    status: "Open",
    plannedQuantity: 20,
    filledQuantity: 20,
    openQuantity: 12,
    averageEntry: 90,
    plannedEntry: 90,
    plannedRisk: 80,
    fixedInitialStop: 94,
    entryLabel: "Entry complete",
    protection: {
      state: "Working",
      quantity: 12,
      stop: 90,
      confirmed: true,
      source: "Simulated adapter record",
    },
    targets: [
      { label: "1R", quantity: 5, price: 86, state: "Filled" },
      { label: "2R", quantity: 3, price: 82, state: "Working" },
    ],
    runner: { quantity: 4, rule: "Day high" },
    exitPlan: DEMO_DEFAULT_EXIT_PLAN,
    price: {
      price: 88.5,
      source: "Simulated quote",
      status: "Stale",
      observedAt: "2026-09-07T15:00:00Z",
    },
    changedInIbkr: true,
    simulated: true,
  },
  {
    campaignId: "demo-tsla",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-TSLA",
    positionRevision: "tsla-r2",
    planId: "plan-tsla",
    symbol: "TSLA",
    direction: "Long",
    status: "Unprotected",
    plannedQuantity: 18,
    filledQuantity: 18,
    openQuantity: 18,
    averageEntry: 347.5,
    plannedEntry: 347.5,
    plannedRisk: 171,
    fixedInitialStop: 338,
    entryLabel: "Entry complete",
    protection: {
      state: "Rejected",
      quantity: 0,
      stop: 338,
      confirmed: false,
      source: "Simulated rejected stop",
    },
    targets: [],
    runner: { quantity: 18, rule: "Manual" },
    exitPlan: {
      ...DEMO_DEFAULT_EXIT_PLAN,
      legs: [
        {
          id: "Runner A",
          role: "Runner",
          allocationPercent: 100,
          activationR: 1,
          trailing: { mode: "Manual", stopPrice: 338 },
        },
      ],
    },
    price: { source: "Disconnected source", status: "Unavailable" },
    simulated: true,
  },
  {
    campaignId: "demo-amd",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-AMD",
    positionRevision: "amd-r9",
    planId: "plan-amd",
    symbol: "AMD",
    direction: "Long",
    status: "Closed",
    plannedQuantity: 20,
    filledQuantity: 20,
    openQuantity: 0,
    averageEntry: 164,
    plannedEntry: 164,
    plannedRisk: 80,
    fixedInitialStop: 160,
    entryLabel: "Closed",
    protection: {
      state: "Complete",
      quantity: 0,
      confirmed: true,
      source: "Simulated adapter record",
    },
    targets: [{ label: "1R", quantity: 10, price: 172, state: "Filled" }],
    price: {
      price: 164,
      source: "Simulated quote",
      status: "Fresh",
      observedAt: "2026-09-03T15:00:00Z",
    },
    simulated: true,
  },
];

export const DEMO_SAVED_PLANS = [
  {
    id: "sample-nvda",
    symbol: "NVDA",
    name: "Sample breakout",
    revision: 1,
    entry: 120,
    stop: 116,
    quantity: 25,
    state: "Saved",
    priceSource: "Local EOD · Sep 8",
    stale: true,
  },
  {
    id: "sample-mrna",
    symbol: "MRNA",
    name: "Sample partial exit",
    revision: 1,
    entry: 90,
    stop: 94,
    quantity: 20,
    state: "Partially exited",
    priceSource: "Simulated execution ledger",
    stale: false,
  },
];

export const DEMO_UNLINKED_POSITIONS = [
  {
    id: "unlinked-msft",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-MSFT",
    symbol: "MSFT",
    direction: "Long" as const,
    quantity: 12,
    averageEntry: 507.4,
    marketValue: 6146.4,
    changedAt: "2026-09-08T15:12:00Z",
  },
];

export const DEMO_LINKABLE_JOURNAL_TRADES = [
  {
    journalTradeId: "journal-msft-review",
    accountId: "SIMULATED-ONLY",
    instrumentId: "US-STK-MSFT",
    symbol: "MSFT",
    label: "MSFT manual campaign · Needs Review",
  },
];

export function journalRowFromCampaign(campaign: TradeCampaign) {
    const rollup = rollupCampaign(campaign);
    const hasExecutions = rollup.executions.length > 0;
    const costsComplete = campaign.journalSnapshot?.costsComplete !== false;
    const lateFees = (campaign.feeAdjustments ?? []).reduce((sum, fee) => sum + fee.amount, 0);
    const totalCosts = costsComplete ? rollup.fees + lateFees : null;
    const netResult = totalCosts == null ? null : rollup.grossRealizedPnl - totalCosts;
    const closed = hasExecutions && rollup.openQuantity === 0;
    const targets = campaign.journalSnapshot?.plannedTargets ?? [];
    const fixedCoverage = targets
      .filter(target => target.multipleR != null)
      .reduce((sum, target) => sum + target.allocationPercent, 0);
    const weightedPlannedR = fixedCoverage === 100
      ? targets.reduce((sum, target) => sum + target.allocationPercent * (target.multipleR ?? 0), 0) / 100
      : null;
    return {
      id: campaign.journalTradeId!,
      campaignId: campaign.campaignId,
      planId: campaign.planId,
      symbol: campaign.symbol,
      side: campaign.direction,
      setup: campaign.journalSnapshot?.setup || "Unclassified",
      provenance: campaign.journalSnapshot?.provenance ?? (campaign.planId ? "Linked plan" : "IBKR import"),
      currency: campaign.journalSnapshot?.currency ?? "USD",
      date:
        rollup.executions[0]?.occurredAt.slice(0, 10) ??
        campaign.positionSnapshot?.observedAt.slice(0, 10) ??
        "2026-09-09",
      pnl: netResult ?? rollup.grossRealizedPnl,
      r: rollup.actualInitialRisk
        ? (netResult ?? rollup.grossRealizedPnl) /
          rollup.actualInitialRisk
        : 0,
      risk: rollup.actualInitialRisk,
      plannedR: weightedPlannedR ?? 0,
      fixedTargetCoverage: fixedCoverage,
      grade: (hasExecutions ? "A" : "C") as "A" | "C",
      status: !hasExecutions ? "Incomplete" : closed ? "Closed" : rollup.exitedQuantity ? "Partially exited" : "Open",
      executions: rollup.executions,
      openQuantity:
        campaign.positionSnapshot?.confirmedOpenQuantity ?? rollup.openQuantity,
      initialRiskAvailable: hasExecutions && rollup.actualInitialRisk > 0,
      realizedAvailable: hasExecutions,
      finalRAvailable: closed && costsComplete && rollup.actualInitialRisk > 0,
      costsComplete,
      grossRealized: hasExecutions ? rollup.grossRealizedPnl : undefined,
      costs: totalCosts ?? undefined,
      enteredQuantity: rollup.enteredQuantity,
      exitedQuantity: rollup.exitedQuantity,
      weightedEntry: rollup.actualAverageEntry ?? undefined,
      weightedExit: rollup.exitedQuantity
        ? rollup.executions.filter(item => item.effect === "exit").reduce((sum, item) => sum + item.quantity * item.price, 0) / rollup.exitedQuantity
        : undefined,
      firstFillAt: rollup.executions[0]?.occurredAt,
      closedAt: closed ? rollup.executions.at(-1)?.occurredAt : undefined,
      journalSnapshot: campaign.journalSnapshot,
      feeAdjustments: campaign.feeAdjustments,
      confirmedAmendments: campaign.confirmedAmendments,
      historyStatus: hasExecutions
        ? undefined
        : "Historical fills and initial risk are unavailable; current quantity and average entry come from the identified position snapshot.",
      simulated: true as const,
    };
}

export function demoJournalRows() {
  return campaigns.map(journalRowFromCampaign);
}
