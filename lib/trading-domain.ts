export const TRADING_DOMAIN_VERSION = 1 as const;

export type TradeDirection = "Long" | "Short";
export type StopMethod = "ATR" | "LoD" | "HoD" | "Manual";
export type LifecycleStatus =
  | "Draft"
  | "Saved"
  | "Pending entry"
  | "Partially filled"
  | "Open"
  | "Unprotected"
  | "Closing"
  | "Closed"
  | "Cancelled"
  | "Expired"
  | "Rejected"
  | "Sync pending"
  | "Needs Review";

export type PriceSource = {
  source: "IBKR" | "Local EOD" | "Manual" | "Legacy";
  observedAt: string;
  sessionDate?: string;
};

export const EXIT_PLAN_SCHEMA_VERSION = 1 as const;

export type FrozenRiskReference = Readonly<{
  basis: "Planned" | "Execution";
  direction: TradeDirection;
  entryPrice: number;
  fixedStopPrice: number;
  riskPerShare: number;
  frozenAt: string;
}>;

export type TargetInput =
  | Readonly<{ mode: "R"; multipleR: number }>
  | Readonly<{ mode: "Price"; price: number }>;

export type TrailingRule =
  | Readonly<{ mode: "SMA"; period: 10 | 20 | 50 }>
  | Readonly<{ mode: "Day extreme" }>
  | Readonly<{ mode: "Dollar"; distance: number }>
  | Readonly<{ mode: "Percentage"; percent: number }>
  | Readonly<{ mode: "Manual"; stopPrice: number }>;

export type ExitPlanLeg =
  | Readonly<{
      id: string;
      role: "Target";
      allocationPercent: number;
      target: TargetInput;
    }>
  | Readonly<{
      id: string;
      role: "Runner";
      allocationPercent: number;
      activationR: number;
      trailing: TrailingRule;
    }>;

export type BreakevenRule = Readonly<{
  activationR: number;
  favorableOffset: Readonly<{ unit: "Dollar" | "R"; value: number }>;
}>;

export type ExitPlanDefinition = Readonly<{
  schemaVersion: typeof EXIT_PLAN_SCHEMA_VERSION;
  breakeven: BreakevenRule;
  legs: readonly ExitPlanLeg[];
}>;

export type PlanRecord = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  kind: "trade-plan";
  planId: string;
  revisionId: string;
  revision: number;
  symbol: string;
  contractId?: string;
  direction: TradeDirection;
  setup: string;
  capturedEntry: number;
  capturedPriceSource: PriceSource;
  stop: {
    method: StopMethod;
    price: number;
    atr14?: number;
    atrMultiplier?: number;
    dayLow?: number;
    dayHigh?: number;
    source?: PriceSource;
    dataStatus?: "fresh" | "stale" | "unknown" | "sample";
  };
  sizing: {
    accountBase: number;
    ibkrEquity?: number;
    manualPlanningBalance: number;
    riskPercent: number;
    allocationPercent: number;
    plannedQuantity: number;
    plannedRisk: number;
  };
  targets: Array<{ multipleR: number; percent: number }>;
  runner?: { percent: number; rule: string };
  /** Optional additive model. Legacy targets/runner remain authoritative when absent. */
  exitPlan?: ExitPlanDefinition;
  /** Session/routing snapshot selected for this saved plan. Legacy plans omit it. */
  sessionPolicy?: import("./ibkr-paper-adapter").ExecutionSessionPolicy;
  createdAt: string;
  savedAt: string;
};

export type BrokerOrderIntent = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  intentId: string;
  idempotencyKey: string;
  accountId: string;
  sessionId: string;
  planId?: string;
  campaignId?: string;
  role: "entry" | "protection" | "target" | "runner" | "close";
  quantity: number;
  requestedPrice?: number;
  triggerPrice?: number;
  timeInForce: string;
  sessionPolicy: string;
  sessionSnapshot?: import("./ibkr-paper-adapter").ExecutionSessionPolicy;
  state: string;
};

export type Execution = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  accountId: string;
  sessionId: string;
  executionId: string;
  orderId: string;
  campaignId: string;
  effect: "entry" | "exit";
  role: "entry" | "target" | "stop" | "runner" | "manual";
  quantity: number;
  price: number;
  fee: number;
  occurredAt: string;
  /** Broker trade date is preserved separately from the immutable execution timestamp. */
  brokerTradeDate?: string;
  protectionStopAtFill?: number;
  provenance: "IBKR" | "manual-import" | "legacy";
};

export type TradeCampaign = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  campaignId: string;
  accountId: string;
  planId?: string;
  journalTradeId?: string;
  symbol: string;
  direction: TradeDirection;
  lifecycle: LifecycleState;
  executions: Execution[];
  /** Immutable planning context copied when the first execution opens the journal row. */
  journalSnapshot?: JournalCampaignSnapshot;
  /** Cost adjustments received after executions (for example, finalized commissions). */
  feeAdjustments?: FeeAdjustment[];
  /** Auditable, confirmed position changes only. Unapplied drafts are stored elsewhere. */
  confirmedAmendments?: ConfirmedAmendment[];
  /**
   * A reconciled broker-position snapshot may establish current quantity and
   * average cost without establishing any historical executions or risk basis.
   */
  positionSnapshot?: PositionCampaignSnapshot;
};

export type JournalCampaignSnapshot = Readonly<{
  instrumentId?: string;
  currency: string;
  setup?: string;
  provenance: "Linked plan" | "IBKR import" | "Manual" | "Legacy";
  plannedEntry?: number;
  plannedQuantity?: number;
  originalStop?: number;
  plannedInitialRisk?: number;
  plannedTargets?: readonly Readonly<{
    label: string;
    allocationPercent: number;
    multipleR?: number;
    price?: number;
  }>[];
  plannedRunners?: readonly Readonly<{
    label: string;
    allocationPercent: number;
    rule: string;
  }>[];
  capturedAt?: string;
  costsComplete?: boolean;
  riskComplete?: boolean;
  currentConfirmedStop?: number;
  sessionPolicy?: import("./ibkr-paper-adapter").ExecutionSessionPolicy;
}>;

export type FeeAdjustment = Readonly<{
  adjustmentId: string;
  amount: number;
  occurredAt: string;
  provenance: "IBKR" | "manual-import";
  note?: string;
}>;

export type ConfirmedAmendment = Readonly<{
  amendmentId: string;
  occurredAt: string;
  description: string;
  provenance: "IBKR" | "manual-import";
}>;

export type PositionCampaignSnapshot = Readonly<{
  accountId: string;
  instrumentId: string;
  brokerPositionId: string;
  positionRevision: string;
  confirmedOpenQuantity: number;
  averageEntry?: number;
  observedAt: string;
}>;

export type ExitAllocation = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  allocationId: string;
  campaignId: string;
  role: "target" | "protection" | "runner";
  intendedQuantity: number;
  workingQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  linkedGroup?: string;
};

export type JournalReview = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  campaignId: string;
  setup?: string;
  tags: string[];
  answers: Partial<
    Record<
      "environment" | "setup" | "entry" | "risk" | "exits",
      "Yes" | "Partly" | "No" | "N/A"
    >
  >;
  emotionalState?: "Calm" | "Hesitant" | "FOMO" | "Frustrated" | "Other";
  lesson?: string;
  updatedAt: string;
};

export type ReconciliationCheckpoint = {
  schemaVersion: typeof TRADING_DOMAIN_VERSION;
  checkpointId: string;
  accountId: string;
  sessionId: string;
  cursor?: string;
  reconciledAt: string;
  brokerOpenQuantity: number;
  brokerProtectionQuantity: number;
  brokerWorkingExitQuantity: number;
};

const positive = (value: number) => Number.isFinite(value) && value > 0;
const nonNegative = (value: number) => Number.isFinite(value) && value >= 0;

export function validateStopDirection(
  direction: TradeDirection,
  entry: number,
  stop: number,
): void {
  if (!positive(entry) || !positive(stop))
    throw new Error("Entry and stop must be positive finite prices.");
  if (direction === "Long" ? stop >= entry : stop <= entry) {
    throw new Error(
      direction === "Long"
        ? "A long stop must be below entry."
        : "A short stop must be above entry.",
    );
  }
}

export function sizingAccountBase(
  ibkrEquity: number | null | undefined,
  manualPlanningBalance: number,
) {
  if (!positive(manualPlanningBalance))
    throw new Error("Manual planning balance must be positive.");
  if (ibkrEquity == null)
    return {
      accountBase: manualPlanningBalance,
      source: "Manual planning balance" as const,
    };
  if (!positive(ibkrEquity))
    throw new Error("IBKR equity must be positive when supplied.");
  return ibkrEquity <= manualPlanningBalance
    ? { accountBase: ibkrEquity, source: "IBKR equity" as const }
    : {
        accountBase: manualPlanningBalance,
        source: "Manual planning balance" as const,
      };
}

export type PositionSizeInputs = {
  accountBase: number;
  riskPercent: number;
  allocationPercent: number;
  entryPrice: number;
  stopPrice: number;
  direction: TradeDirection;
  existingPositionRisk?: number;
  existingHoldingValue?: number;
  pendingEntryValue?: number;
};

export function calculatePositionSize(input: PositionSizeInputs) {
  const {
    accountBase,
    riskPercent,
    allocationPercent,
    entryPrice,
    stopPrice,
    direction,
  } = input;
  if (
    ![accountBase, riskPercent, allocationPercent, entryPrice].every(positive)
  )
    throw new Error("Sizing inputs must be positive.");
  validateStopDirection(direction, entryPrice, stopPrice);
  const existingPositionRisk = input.existingPositionRisk ?? 0;
  const existingHoldingValue = input.existingHoldingValue ?? 0;
  const pendingEntryValue = input.pendingEntryValue ?? 0;
  if (
    ![existingPositionRisk, existingHoldingValue, pendingEntryValue].every(
      nonNegative,
    )
  )
    throw new Error("Existing exposure cannot be negative.");
  const riskBudget = (accountBase * riskPercent) / 100;
  const availableRisk = Math.max(0, riskBudget - existingPositionRisk);
  const symbolAllocationBudget = (accountBase * allocationPercent) / 100;
  const remainingAllocationValue = Math.max(
    0,
    symbolAllocationBudget - existingHoldingValue - pendingEntryValue,
  );
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  const sharesByRisk = Math.floor(availableRisk / riskPerShare);
  const sharesByAllocation = Math.floor(remainingAllocationValue / entryPrice);
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByAllocation));
  const positionValue = shares * entryPrice;
  const plannedRisk = shares * riskPerShare;
  return {
    shares,
    riskBudget,
    availableRisk,
    symbolAllocationBudget,
    remainingAllocationValue,
    riskPerShare,
    sharesByRisk,
    sharesByAllocation,
    positionValue,
    plannedRisk,
    accountUsePercent: (positionValue / accountBase) * 100,
    actualRiskPercent: (plannedRisk / accountBase) * 100,
    limitingConstraint:
      sharesByRisk <= sharesByAllocation
        ? ("Risk" as const)
        : ("Allocation" as const),
  };
}

export type DailyBar = { high: number; low: number; close: number };

export function calculateWilderAtr14(bars: DailyBar[]): number {
  if (bars.length < 15)
    throw new Error(
      "Wilder ATR14 requires a prior close plus 14 valid daily true ranges.",
    );
  bars.forEach((bar, index) => {
    if (
      ![bar.high, bar.low, bar.close].every(positive) ||
      bar.high < Math.max(bar.low, bar.close) ||
      bar.low > bar.close
    ) {
      throw new Error(`Invalid daily bar at index ${index}.`);
    }
  });
  const trueRanges = bars
    .slice(1)
    .map((bar, index) =>
      Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - bars[index].close),
        Math.abs(bar.low - bars[index].close),
      ),
    );
  let atr = trueRanges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
  for (const trueRange of trueRanges.slice(14))
    atr = (13 * atr + trueRange) / 14;
  return atr;
}

export function deriveStop(input: {
  method: StopMethod;
  direction: TradeDirection;
  capturedEntry: number;
  atr14?: number;
  atrMultiplier?: number;
  dayLow?: number;
  dayHigh?: number;
  manualStop?: number;
}) {
  const { method, direction, capturedEntry } = input;
  if (!positive(capturedEntry))
    throw new Error("Captured entry must be positive.");
  let stop: number;
  if (method === "ATR") {
    if (!positive(input.atr14 ?? 0) || !positive(input.atrMultiplier ?? 0))
      throw new Error("ATR stops require a positive ATR14 and multiplier.");
    stop =
      capturedEntry +
      (direction === "Long" ? -1 : 1) * input.atr14! * input.atrMultiplier!;
  } else if (method === "LoD") {
    if (direction !== "Long" || !positive(input.dayLow ?? 0))
      throw new Error("LoD is available for longs and requires a day low.");
    stop = input.dayLow!;
  } else if (method === "HoD") {
    if (direction !== "Short" || !positive(input.dayHigh ?? 0))
      throw new Error("HoD is available for shorts and requires a day high.");
    stop = input.dayHigh!;
  } else {
    if (!positive(input.manualStop ?? 0))
      throw new Error("Manual stops require a positive price.");
    stop = input.manualStop!;
  }
  validateStopDirection(direction, capturedEntry, stop);
  return stop;
}

export function weightedAverageEntry(
  fills: Array<{ quantity: number; price: number }>,
): number | null {
  if (!fills.length) return null;
  if (
    fills.some(
      (fill) =>
        !Number.isSafeInteger(fill.quantity) ||
        fill.quantity <= 0 ||
        !positive(fill.price),
    )
  )
    throw new Error(
      "Entry fills require positive whole-share quantities and prices.",
    );
  const quantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  return (
    fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / quantity
  );
}

export function initialRisk(
  fills: Array<{
    quantity: number;
    entryPrice: number;
    protectionStop: number;
  }>,
  direction: TradeDirection,
) {
  return fills.reduce((sum, fill) => {
    if (!Number.isSafeInteger(fill.quantity) || fill.quantity <= 0)
      throw new Error(
        "Risk snapshots require positive whole-share quantities.",
      );
    validateStopDirection(direction, fill.entryPrice, fill.protectionStop);
    return (
      sum + fill.quantity * Math.abs(fill.entryPrice - fill.protectionStop)
    );
  }, 0);
}

export function targetPrice(
  actualAverageEntry: number,
  fixedStop: number,
  multipleR: number,
  direction: TradeDirection,
) {
  validateStopDirection(direction, actualAverageEntry, fixedStop);
  if (!positive(multipleR))
    throw new Error("Target multiple must be positive.");
  return (
    actualAverageEntry +
    (direction === "Long" ? 1 : -1) *
      Math.abs(actualAverageEntry - fixedStop) *
      multipleR
  );
}

export function allocateExitShares(
  total: number,
  percentages: number[],
): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !percentages.length ||
    percentages.some((value) => !nonNegative(value)) ||
    Math.abs(percentages.reduce((a, b) => a + b, 0) - 100) > 1e-9
  ) {
    throw new Error("Exit percentages must be non-negative and total 100%.");
  }
  const result = percentages.map((value) => Math.floor((total * value) / 100));
  const order = percentages
    .map((value, index) => ({
      index,
      remainder: (total * value) / 100 - result[index],
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = total - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index += 1)
    result[order[index].index] += 1;
  return result;
}

const validTimestamp = (value: string) =>
  Boolean(value) && Number.isFinite(Date.parse(value));
const symbolPattern = /^[A-Z][A-Z0-9./-]{0,31}$/;

export function freezeRiskReference(input: {
  basis: FrozenRiskReference["basis"];
  direction: TradeDirection;
  entryPrice: number;
  fixedStopPrice: number;
  frozenAt: string;
}): FrozenRiskReference {
  validateStopDirection(
    input.direction,
    input.entryPrice,
    input.fixedStopPrice,
  );
  if (!validTimestamp(input.frozenAt))
    throw new Error("A frozen R reference requires a valid timestamp.");
  return Object.freeze({
    ...input,
    riskPerShare: Math.abs(input.entryPrice - input.fixedStopPrice),
  });
}

function validateTrailingRule(rule: TrailingRule): void {
  if (rule.mode === "SMA" && ![10, 20, 50].includes(rule.period))
    throw new Error("Runner SMA period must be 10, 20 or 50.");
  if (rule.mode === "Dollar" && !positive(rule.distance))
    throw new Error("Dollar trails require a positive distance.");
  if (rule.mode === "Percentage" && !positive(rule.percent))
    throw new Error("Percentage trails require a positive percentage.");
  if (rule.mode === "Manual" && !positive(rule.stopPrice))
    throw new Error("Manual runner stops require a positive price.");
}

export function validateExitPlan(plan: ExitPlanDefinition): ExitPlanDefinition {
  if (
    !plan ||
    plan.schemaVersion !== EXIT_PLAN_SCHEMA_VERSION ||
    !Array.isArray(plan.legs)
  )
    throw new Error("Unsupported exit-plan version.");
  if (!positive(plan.breakeven?.activationR))
    throw new Error("Breakeven activation must be a positive R value.");
  if (
    !plan.breakeven.favorableOffset ||
    !["Dollar", "R"].includes(plan.breakeven.favorableOffset.unit) ||
    !nonNegative(plan.breakeven.favorableOffset.value)
  )
    throw new Error(
      "Breakeven offset must be a non-negative dollar or R value.",
    );
  const targets = plan.legs.filter((leg) => leg.role === "Target");
  const runners = plan.legs.filter((leg) => leg.role === "Runner");
  if (targets.length < 1 || targets.length > 2 || runners.length > 2)
    throw new Error(
      "An exit plan requires one or two targets and no more than two runners.",
    );
  if (
    new Set(plan.legs.map((leg) => leg.id)).size !== plan.legs.length ||
    plan.legs.some((leg) => !leg.id.trim())
  )
    throw new Error("Exit leg IDs must be unique and non-empty.");
  if (
    plan.legs.some((leg) => !positive(leg.allocationPercent)) ||
    Math.abs(
      plan.legs.reduce((sum, leg) => sum + leg.allocationPercent, 0) - 100,
    ) > 1e-9
  )
    throw new Error("Active exit allocations must be positive and total 100%.");
  for (const leg of targets) {
    if (
      leg.target.mode === "R"
        ? !positive(leg.target.multipleR)
        : !positive(leg.target.price)
    )
      throw new Error(
        "Targets require a positive authoritative R or price value.",
      );
  }
  for (const leg of runners) {
    if (!positive(leg.activationR))
      throw new Error("Runner activation must be a positive R value.");
    validateTrailingRule(leg.trailing);
  }
  return plan;
}

export function exitLegQuantities(
  totalQuantity: number,
  plan: ExitPlanDefinition,
) {
  validateExitPlan(plan);
  if (totalQuantity < plan.legs.length)
    throw new Error(
      "The confirmed quantity is too small to allocate at least one share to every active exit leg.",
    );
  const quantities = allocateExitShares(
    totalQuantity,
    plan.legs.map((leg) => leg.allocationPercent),
  );
  if (
    quantities.some((quantity) => quantity < 1) ||
    quantities.reduce((sum, quantity) => sum + quantity, 0) !== totalQuantity
  )
    throw new Error(
      "Exit allocation did not conserve the confirmed whole-share quantity.",
    );
  return plan.legs.map((leg, index) => ({
    legId: leg.id,
    role: leg.role,
    quantity: quantities[index],
  }));
}

export function resolvedTarget(
  input: TargetInput,
  reference: FrozenRiskReference,
) {
  const price =
    input.mode === "R"
      ? targetPrice(
          reference.entryPrice,
          reference.fixedStopPrice,
          input.multipleR,
          reference.direction,
        )
      : input.price;
  const direction = reference.direction === "Long" ? 1 : -1;
  if (!positive(price) || direction * (price - reference.entryPrice) <= 0)
    throw new Error(
      "Target price must be on the favorable side of the frozen R entry.",
    );
  return {
    authoritativeMode: input.mode,
    price,
    multipleR: Math.abs(price - reference.entryPrice) / reference.riskPerShare,
  } as const;
}

export type BrokerTriggerQuote = Readonly<{
  source: "IBKR" | "Local EOD" | "Other";
  status: "fresh" | "stale" | "missing";
  observedAt: string;
  bid?: number;
  ask?: number;
}>;

function triggerQuote(
  direction: TradeDirection,
  quote: BrokerTriggerQuote,
): { ok: true; price: number } | { ok: false; reason: string } {
  if (quote.source !== "IBKR")
    return {
      ok: false,
      reason:
        "Only a fresh IBKR quote may trigger an execution rule; EOD and other sources are non-executable.",
    };
  if (quote.status !== "fresh" || !validTimestamp(quote.observedAt))
    return {
      ok: false,
      reason: "A fresh, timestamped broker quote is required.",
    };
  const selected = direction === "Long" ? quote.bid : quote.ask;
  if (!positive(selected ?? 0))
    return {
      ok: false,
      reason: `A fresh broker ${direction === "Long" ? "bid" : "ask"} is required.`,
    };
  return { ok: true, price: selected! };
}

export type ThresholdTouch = Readonly<{
  thresholdR: number;
  referenceBasis: "Planned";
  observedPrice: number;
  observedAt: string;
}>;

function thresholdPrice(reference: FrozenRiskReference, multipleR: number) {
  if (!positive(multipleR))
    throw new Error("Activation threshold must be a positive R value.");
  return (
    reference.entryPrice +
    (reference.direction === "Long" ? 1 : -1) *
      reference.riskPerShare *
      multipleR
  );
}

function reached(
  direction: TradeDirection,
  observed: number,
  threshold: number,
) {
  return direction === "Long" ? observed >= threshold : observed <= threshold;
}

export function observePartialEntryThreshold(input: {
  plannedReference: FrozenRiskReference;
  quote: BrokerTriggerQuote;
  thresholdR: number;
  confirmedFilledQuantity: number;
  confirmedProtectionQuantity: number;
}):
  | { state: "Blocked"; reason: string }
  | { state: "Not reached" }
  | { state: "Deferred touch"; touch: ThresholdTouch } {
  if (input.plannedReference.basis !== "Planned")
    return {
      state: "Blocked",
      reason: "Partial-entry touches require the frozen Planned R reference.",
    };
  if (
    !Number.isSafeInteger(input.confirmedFilledQuantity) ||
    input.confirmedFilledQuantity <= 0 ||
    input.confirmedProtectionQuantity !== input.confirmedFilledQuantity
  )
    return {
      state: "Blocked",
      reason:
        "Every confirmed partial-entry share must retain broker-confirmed initial protection.",
    };
  const quote = triggerQuote(input.plannedReference.direction, input.quote);
  if (!quote.ok) return { state: "Blocked", reason: quote.reason };
  const threshold = thresholdPrice(input.plannedReference, input.thresholdR);
  if (!reached(input.plannedReference.direction, quote.price, threshold))
    return { state: "Not reached" };
  return {
    state: "Deferred touch",
    touch: {
      thresholdR: input.thresholdR,
      referenceBasis: "Planned",
      observedPrice: quote.price,
      observedAt: input.quote.observedAt,
    },
  };
}

export type ProtectionAdvancement =
  | Readonly<{ state: "Blocked"; reason: string }>
  | Readonly<{ state: "Not reached"; thresholdPrice: number }>
  | Readonly<{
      state: "Already tighter";
      stopPrice: number;
      thresholdPrice: number;
    }>
  | Readonly<{ state: "Advance"; stopPrice: number; thresholdPrice: number }>;

function safeStopAdvance(
  direction: TradeDirection,
  currentStop: number,
  proposedStop: number,
  marketPrice: number,
  threshold: number,
): ProtectionAdvancement {
  if (![currentStop, proposedStop, marketPrice].every(positive))
    return {
      state: "Blocked",
      reason: "Current, proposed and market prices must be positive.",
    };
  const marketValid =
    direction === "Long"
      ? proposedStop < marketPrice
      : proposedStop > marketPrice;
  if (!marketValid)
    return {
      state: "Blocked",
      reason: `The proposed ${direction === "Long" ? "sell" : "buy"} stop is invalid relative to the current executable market.`,
    };
  const tighter =
    direction === "Long"
      ? proposedStop > currentStop
      : proposedStop < currentStop;
  if (!tighter)
    return {
      state: "Already tighter",
      stopPrice: currentStop,
      thresholdPrice: threshold,
    };
  return {
    state: "Advance",
    stopPrice: proposedStop,
    thresholdPrice: threshold,
  };
}

export function evaluateBreakevenAdvancement(input: {
  executionReference: FrozenRiskReference;
  quote: BrokerTriggerQuote;
  rule: BreakevenRule;
  currentStopPrice: number;
  confirmedOpenQuantity: number;
  confirmedProtectionQuantity: number;
}): ProtectionAdvancement {
  if (input.executionReference.basis !== "Execution")
    return {
      state: "Blocked",
      reason: "Advanced protection requires a frozen Execution R reference.",
    };
  if (
    !Number.isSafeInteger(input.confirmedOpenQuantity) ||
    input.confirmedOpenQuantity <= 0 ||
    input.confirmedProtectionQuantity !== input.confirmedOpenQuantity
  )
    return {
      state: "Blocked",
      reason:
        "Advanced rules require complete broker-confirmed protection for the final open quantity.",
    };
  if (
    !positive(input.rule.activationR) ||
    !nonNegative(input.rule.favorableOffset.value)
  )
    return { state: "Blocked", reason: "Breakeven rule values are invalid." };
  const quote = triggerQuote(input.executionReference.direction, input.quote);
  if (!quote.ok) return { state: "Blocked", reason: quote.reason };
  const threshold = thresholdPrice(
    input.executionReference,
    input.rule.activationR,
  );
  if (!reached(input.executionReference.direction, quote.price, threshold))
    return { state: "Not reached", thresholdPrice: threshold };
  const offset =
    input.rule.favorableOffset.unit === "R"
      ? input.executionReference.riskPerShare * input.rule.favorableOffset.value
      : input.rule.favorableOffset.value;
  const proposed =
    input.executionReference.entryPrice +
    (input.executionReference.direction === "Long" ? 1 : -1) * offset;
  return safeStopAdvance(
    input.executionReference.direction,
    input.currentStopPrice,
    proposed,
    quote.price,
    threshold,
  );
}

export function evaluateRunnerAdvancement(input: {
  executionReference: FrozenRiskReference;
  quote: BrokerTriggerQuote;
  runner: Extract<ExitPlanLeg, { role: "Runner" }>;
  currentStopPrice: number;
  confirmedOpenQuantity: number;
  confirmedProtectionQuantity: number;
  sma10?: number;
  sma20?: number;
  sma50?: number;
  dayLow?: number;
  dayHigh?: number;
}): ProtectionAdvancement {
  if (input.executionReference.basis !== "Execution")
    return {
      state: "Blocked",
      reason: "Runner rules require a frozen Execution R reference.",
    };
  if (
    input.confirmedProtectionQuantity !== input.confirmedOpenQuantity ||
    input.confirmedOpenQuantity <= 0
  )
    return {
      state: "Blocked",
      reason:
        "Runner rules require complete broker-confirmed protection for the final open quantity.",
    };
  const quote = triggerQuote(input.executionReference.direction, input.quote);
  if (!quote.ok) return { state: "Blocked", reason: quote.reason };
  try {
    validateTrailingRule(input.runner.trailing);
  } catch (error) {
    return { state: "Blocked", reason: (error as Error).message };
  }
  const threshold = thresholdPrice(
    input.executionReference,
    input.runner.activationR,
  );
  if (!reached(input.executionReference.direction, quote.price, threshold))
    return { state: "Not reached", thresholdPrice: threshold };
  const rule = input.runner.trailing;
  let proposed: number | undefined;
  if (rule.mode === "SMA")
    proposed =
      rule.period === 10
        ? input.sma10
        : rule.period === 20
          ? input.sma20
          : input.sma50;
  else if (rule.mode === "Day extreme")
    proposed =
      input.executionReference.direction === "Long"
        ? input.dayLow
        : input.dayHigh;
  else if (rule.mode === "Dollar")
    proposed =
      quote.price +
      (input.executionReference.direction === "Long" ? -1 : 1) * rule.distance;
  else if (rule.mode === "Percentage")
    proposed =
      quote.price *
      (1 +
        ((input.executionReference.direction === "Long" ? -1 : 1) *
          rule.percent) /
          100);
  else proposed = rule.stopPrice;
  if (!positive(proposed ?? 0))
    return {
      state: "Blocked",
      reason: `${rule.mode} trailing data is missing or invalid; no substitute action was selected.`,
    };
  return safeStopAdvance(
    input.executionReference.direction,
    input.currentStopPrice,
    proposed!,
    quote.price,
    threshold,
  );
}

export type ExitPlanPreset = Readonly<{
  schemaVersion: typeof EXIT_PLAN_SCHEMA_VERSION;
  presetId: string;
  name: string;
  scope: "General" | "Symbol";
  symbol?: string;
  definition: ExitPlanDefinition;
  createdAt: string;
  updatedAt: string;
}>;

export type ExitPlanPresetStore = Readonly<{
  schemaVersion: typeof EXIT_PLAN_SCHEMA_VERSION;
  presets: readonly ExitPlanPreset[];
}>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function validateExitPlanPreset(preset: ExitPlanPreset): ExitPlanPreset {
  if (
    !preset ||
    preset.schemaVersion !== EXIT_PLAN_SCHEMA_VERSION ||
    !preset.presetId?.trim() ||
    !preset.name?.trim() ||
    !validTimestamp(preset.createdAt) ||
    !validTimestamp(preset.updatedAt)
  )
    throw new Error("Preset identity, name and timestamps are required.");
  validateExitPlan(preset.definition);
  if (preset.scope === "General") {
    if (preset.symbol)
      throw new Error("General presets cannot be symbol-specific.");
    if (
      preset.definition.legs.some(
        (leg) => leg.role === "Target" && leg.target.mode === "Price",
      )
    )
      throw new Error("General presets may store only R-based targets.");
  } else if (preset.scope === "Symbol") {
    if (!preset.symbol || !symbolPattern.test(preset.symbol))
      throw new Error("Symbol presets require an exact normalized ticker.");
  } else throw new Error("Preset scope is invalid.");
  return preset;
}

export function saveExitPlanPreset(
  existing: readonly ExitPlanPreset[],
  preset: ExitPlanPreset,
): ExitPlanPreset[] {
  validateExitPlanPreset(preset);
  if (
    existing.some(
      (item) =>
        item.presetId !== preset.presetId &&
        item.name.trim().toLowerCase() === preset.name.trim().toLowerCase(),
    )
  )
    throw new Error("Preset names must be unique.");
  const next = existing.map((item) =>
    item.presetId === preset.presetId ? clone(preset) : clone(item),
  );
  if (!existing.some((item) => item.presetId === preset.presetId))
    next.push(clone(preset));
  return next;
}

export function renameExitPlanPreset(
  existing: readonly ExitPlanPreset[],
  presetId: string,
  name: string,
  updatedAt: string,
) {
  const found = existing.find((item) => item.presetId === presetId);
  if (!found) throw new Error("Preset was not found.");
  return saveExitPlanPreset(existing, { ...clone(found), name, updatedAt });
}

export function deleteExitPlanPreset(
  existing: readonly ExitPlanPreset[],
  presetId: string,
) {
  if (!existing.some((item) => item.presetId === presetId))
    throw new Error("Preset was not found.");
  return existing.filter((item) => item.presetId !== presetId).map(clone);
}

export function loadExitPlanPreset(preset: ExitPlanPreset): ExitPlanDefinition {
  validateExitPlanPreset(preset);
  return clone(preset.definition);
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readExitPlanPresetStore(
  storage: StorageLike,
  key: string,
):
  | { ok: true; raw: string | null; store: ExitPlanPresetStore }
  | { ok: false; error: string } {
  try {
    const raw = storage.getItem(key);
    if (raw == null)
      return {
        ok: true,
        raw,
        store: { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, presets: [] },
      };
    const parsed = JSON.parse(raw) as ExitPlanPresetStore;
    if (
      !parsed ||
      parsed.schemaVersion !== EXIT_PLAN_SCHEMA_VERSION ||
      !Array.isArray(parsed.presets)
    )
      throw new Error("Unsupported preset store.");
    parsed.presets.forEach(validateExitPlanPreset);
    if (
      new Set(parsed.presets.map((item) => item.presetId)).size !==
      parsed.presets.length
    )
      throw new Error("Preset IDs must be unique.");
    return { ok: true, raw, store: clone(parsed) };
  } catch {
    return {
      ok: false,
      error:
        "Preset storage is unavailable or invalid; existing data was not overwritten.",
    };
  }
}

export function writeExitPlanPresetStore(
  storage: StorageLike,
  key: string,
  expectedRaw: string | null,
  store: ExitPlanPresetStore,
): { ok: true; raw: string } | { ok: false; error: string } {
  try {
    if (storage.getItem(key) !== expectedRaw)
      return {
        ok: false,
        error: "Presets changed in another view; reload before saving.",
      };
    if (
      !store ||
      store.schemaVersion !== EXIT_PLAN_SCHEMA_VERSION ||
      !Array.isArray(store.presets)
    )
      throw new Error("Unsupported preset store.");
    store.presets.forEach(validateExitPlanPreset);
    if (
      new Set(store.presets.map((item) => item.presetId)).size !==
        store.presets.length ||
      new Set(store.presets.map((item) => item.name.trim().toLowerCase()))
        .size !== store.presets.length
    )
      throw new Error("Preset IDs and names must be unique.");
    const raw = JSON.stringify(store);
    storage.setItem(key, raw);
    return { ok: true, raw };
  } catch {
    return {
      ok: false,
      error: "Preset save failed; existing presets were not replaced.",
    };
  }
}

export type ExitPlanAmendment = Readonly<{
  amendmentId: string;
  campaignId: string;
  sourcePlanRevisionId: string;
  state: "Draft";
  confirmedOpenQuantity: number;
  requestedDefinition: ExitPlanDefinition;
  requestedQuantities: readonly {
    legId: string;
    role: ExitPlanLeg["role"];
    quantity: number;
  }[];
  filledQuantitySnapshot: Readonly<Record<string, number>>;
  sessionPolicy?: import("./ibkr-paper-adapter").ExecutionSessionPolicy;
  createdAt: string;
}>;

export type PositionSnapshot = Readonly<{
  accountId: string;
  campaignId: string;
  instrumentId: string;
  positionRevision: string;
  confirmedOpenQuantity: number;
}>;

export type PositionAssociation = Readonly<{
  associationId: string;
  accountId: string;
  instrumentId: string;
  brokerPositionId: string;
  journalTradeId: string;
  linkedAt: string;
}>;

export function createExitPlanAmendment(input: {
  amendmentId: string;
  campaignId: string;
  sourcePlanRevisionId: string;
  confirmedOpenQuantity: number;
  requestedDefinition: ExitPlanDefinition;
  filledQuantitySnapshot: Readonly<Record<string, number>>;
  sessionPolicy?: import("./ibkr-paper-adapter").ExecutionSessionPolicy;
  createdAt: string;
}): ExitPlanAmendment {
  if (
    !input.amendmentId.trim() ||
    !input.campaignId.trim() ||
    !input.sourcePlanRevisionId.trim() ||
    !validTimestamp(input.createdAt)
  )
    throw new Error("Amendment identity and timestamp are required.");
  if (
    Object.values(input.filledQuantitySnapshot).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error(
      "Filled-leg history must contain non-negative whole shares.",
    );
  const definition = clone(validateExitPlan(input.requestedDefinition));
  return Object.freeze({
    amendmentId: input.amendmentId,
    campaignId: input.campaignId,
    sourcePlanRevisionId: input.sourcePlanRevisionId,
    state: "Draft",
    confirmedOpenQuantity: input.confirmedOpenQuantity,
    requestedDefinition: definition,
    requestedQuantities: exitLegQuantities(
      input.confirmedOpenQuantity,
      definition,
    ),
    filledQuantitySnapshot: Object.freeze({ ...input.filledQuantitySnapshot }),
    ...(input.sessionPolicy ? { sessionPolicy: Object.freeze({ ...input.sessionPolicy }) } : {}),
    createdAt: input.createdAt,
  });
}

export function assertAmendmentMatchesPosition(
  amendment: ExitPlanAmendment,
  position: PositionSnapshot,
) {
  if (amendment.campaignId !== position.campaignId)
    throw new Error("Amendment does not belong to this position.");
  if (
    amendment.sourcePlanRevisionId !== position.positionRevision ||
    amendment.confirmedOpenQuantity !== position.confirmedOpenQuantity
  ) {
    throw new Error(
      "The confirmed position changed. Reopen the latest position before saving this amendment.",
    );
  }
  return amendment;
}

export function createPositionAssociation(input: {
  associationId: string;
  accountId: string;
  instrumentId: string;
  brokerPositionId: string;
  journalTradeId: string;
  journalAccountId: string;
  journalInstrumentId: string;
  linkedAt: string;
  existing: readonly PositionAssociation[];
}): PositionAssociation {
  if (
    ![
      input.associationId,
      input.accountId,
      input.instrumentId,
      input.brokerPositionId,
      input.journalTradeId,
    ].every((value) => value.trim()) ||
    !validTimestamp(input.linkedAt)
  ) {
    throw new Error(
      "Position and Journal identities are required for linking.",
    );
  }
  if (
    input.accountId !== input.journalAccountId ||
    input.instrumentId !== input.journalInstrumentId
  ) {
    throw new Error(
      "Account and instrument identity must match; ticker alone is not enough.",
    );
  }
  if (
    input.existing.some(
      (item) =>
        item.brokerPositionId === input.brokerPositionId ||
        item.journalTradeId === input.journalTradeId,
    )
  ) {
    throw new Error("This position or Journal trade is already linked.");
  }
  return Object.freeze({
    associationId: input.associationId,
    accountId: input.accountId,
    instrumentId: input.instrumentId,
    brokerPositionId: input.brokerPositionId,
    journalTradeId: input.journalTradeId,
    linkedAt: input.linkedAt,
  });
}

export function createSnapshotCampaign(input: {
  campaignId: string;
  journalTradeId: string;
  symbol: string;
  direction: TradeDirection;
  snapshot: PositionCampaignSnapshot;
}): TradeCampaign {
  if (
    ![
      input.campaignId,
      input.journalTradeId,
      input.symbol,
      input.snapshot.accountId,
      input.snapshot.instrumentId,
      input.snapshot.brokerPositionId,
      input.snapshot.positionRevision,
    ].every((value) => value.trim()) ||
    !Number.isSafeInteger(input.snapshot.confirmedOpenQuantity) ||
    input.snapshot.confirmedOpenQuantity <= 0 ||
    (input.snapshot.averageEntry != null && !positive(input.snapshot.averageEntry)) ||
    !validTimestamp(input.snapshot.observedAt)
  ) {
    throw new Error("A valid identified position snapshot is required.");
  }
  return Object.freeze({
    schemaVersion: TRADING_DOMAIN_VERSION,
    campaignId: input.campaignId,
    accountId: input.snapshot.accountId,
    journalTradeId: input.journalTradeId,
    symbol: input.symbol.trim().toUpperCase(),
    direction: input.direction,
    lifecycle: { status: "Needs Review" as const },
    executions: [],
    positionSnapshot: Object.freeze({ ...input.snapshot }),
  });
}

export function realizedPnl(input: {
  direction: TradeDirection;
  averageEntry: number;
  exits: Array<{ quantity: number; price: number }>;
  fees: number;
}) {
  if (!positive(input.averageEntry) || !nonNegative(input.fees))
    throw new Error("Realized P&L inputs are invalid.");
  const direction = input.direction === "Long" ? 1 : -1;
  const gross = input.exits.reduce((sum, exit) => {
    if (
      !Number.isSafeInteger(exit.quantity) ||
      exit.quantity <= 0 ||
      !positive(exit.price)
    )
      throw new Error(
        "Exit fills require positive whole-share quantities and prices.",
      );
    return sum + direction * (exit.price - input.averageEntry) * exit.quantity;
  }, 0);
  return { gross, fees: input.fees, net: gross - input.fees };
}

export function remainingRisk(input: {
  direction: TradeDirection;
  openQuantity: number;
  averageEntry: number;
  protectionStop?: number;
  brokerConfirmed: boolean;
}) {
  if (
    !Number.isSafeInteger(input.openQuantity) ||
    input.openQuantity < 0 ||
    !positive(input.averageEntry)
  )
    throw new Error("Remaining-risk inputs are invalid.");
  if (input.openQuantity === 0) return { protected: true, risk: 0 };
  if (!input.brokerConfirmed || input.protectionStop == null)
    return { protected: false, risk: null };
  if (!positive(input.protectionStop))
    throw new Error("Protection stop must be positive.");
  const lossPerShare =
    input.direction === "Long"
      ? Math.max(0, input.averageEntry - input.protectionStop)
      : Math.max(0, input.protectionStop - input.averageEntry);
  return { protected: true, risk: lossPerShare * input.openQuantity };
}

export function positionRiskBreakdown(input: {
  direction: TradeDirection;
  openQuantity: number;
  averageEntry: number;
  confirmedProtectionQuantity: number;
  confirmedStopPrice?: number;
}) {
  if (
    !Number.isSafeInteger(input.openQuantity) ||
    input.openQuantity < 0 ||
    !Number.isSafeInteger(input.confirmedProtectionQuantity) ||
    input.confirmedProtectionQuantity < 0 ||
    input.confirmedProtectionQuantity > input.openQuantity ||
    !positive(input.averageEntry)
  ) {
    throw new Error("Position protection quantities are invalid.");
  }
  const unprotectedQuantity =
    input.openQuantity - input.confirmedProtectionQuantity;
  if (input.openQuantity === 0)
    return {
      confirmedProtectionQuantity: 0,
      unprotectedQuantity: 0,
      confirmedStopRisk: 0,
      totalRemainingRisk: 0,
    };
  if (input.confirmedProtectionQuantity === 0)
    return {
      confirmedProtectionQuantity: 0,
      unprotectedQuantity,
      confirmedStopRisk: 0,
      totalRemainingRisk: null,
    };
  if (!positive(input.confirmedStopPrice ?? 0))
    throw new Error("A confirmed stop price is required for protected shares.");
  const lossPerShare =
    input.direction === "Long"
      ? Math.max(0, input.averageEntry - input.confirmedStopPrice!)
      : Math.max(0, input.confirmedStopPrice! - input.averageEntry);
  const confirmedStopRisk = lossPerShare * input.confirmedProtectionQuantity;
  return {
    confirmedProtectionQuantity: input.confirmedProtectionQuantity,
    unprotectedQuantity,
    confirmedStopRisk,
    totalRemainingRisk: unprotectedQuantity === 0 ? confirmedStopRisk : null,
  };
}

export type CampaignRollup = {
  executions: Execution[];
  openQuantity: number;
  actualAverageEntry: number | null;
  positionAverageEntry: number | null;
  enteredQuantity: number;
  exitedQuantity: number;
  actualInitialRisk: number;
  grossRealizedPnl: number;
  fees: number;
  realizedNetPnl: number;
  finalNetPnl: number | null;
  finalNetR: number | null;
};

export function executionIdentity(
  execution: Pick<Execution, "accountId" | "sessionId" | "executionId">,
) {
  return `${execution.accountId}\u001f${execution.sessionId}\u001f${execution.executionId}`;
}

function sameExecution(left: Execution, right: Execution) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.accountId === right.accountId &&
    left.sessionId === right.sessionId &&
    left.executionId === right.executionId &&
    left.orderId === right.orderId &&
    left.campaignId === right.campaignId &&
    left.effect === right.effect &&
    left.role === right.role &&
    left.quantity === right.quantity &&
    left.price === right.price &&
    left.fee === right.fee &&
    left.occurredAt === right.occurredAt &&
    left.protectionStopAtFill === right.protectionStopAtFill &&
    left.provenance === right.provenance
  );
}

function validateExecution(
  execution: Execution,
  campaign: Pick<TradeCampaign, "accountId" | "campaignId">,
) {
  if (
    execution.schemaVersion !== TRADING_DOMAIN_VERSION ||
    execution.accountId !== campaign.accountId ||
    execution.campaignId !== campaign.campaignId
  )
    throw new Error("Execution identity does not match the campaign.");
  if (
    !execution.executionId ||
    !execution.orderId ||
    !execution.sessionId ||
    !Number.isSafeInteger(execution.quantity) ||
    execution.quantity <= 0 ||
    !positive(execution.price) ||
    !nonNegative(execution.fee) ||
    !Number.isFinite(Date.parse(execution.occurredAt))
  )
    throw new Error("Invalid execution.");
}

export function rollupCampaign(
  campaign: Pick<
    TradeCampaign,
    "accountId" | "campaignId" | "direction" | "executions"
  >,
): CampaignRollup {
  const executions = [...campaign.executions].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      executionIdentity(a).localeCompare(executionIdentity(b)),
  );
  const seen = new Map<string, Execution>();
  let openQuantity = 0;
  let positionAverageEntry: number | null = null;
  let enteredQuantity = 0;
  let entryNotional = 0;
  let exitedQuantity = 0;
  let actualInitialRisk = 0;
  let grossRealizedPnl = 0;
  let fees = 0;
  const multiplier = campaign.direction === "Long" ? 1 : -1;
  for (const execution of executions) {
    validateExecution(execution, campaign);
    const identity = executionIdentity(execution);
    const previousExecution = seen.get(identity);
    if (previousExecution) {
      if (!sameExecution(previousExecution, execution))
        throw new Error("Conflicting executions share one broker identity.");
      continue;
    }
    seen.set(identity, execution);
    fees += execution.fee;
    if (execution.effect === "entry") {
      if (execution.role !== "entry")
        throw new Error("Entry executions must use the entry role.");
      const previousCost: number = (positionAverageEntry ?? 0) * openQuantity;
      openQuantity += execution.quantity;
      positionAverageEntry =
        (previousCost + execution.quantity * execution.price) / openQuantity;
      enteredQuantity += execution.quantity;
      entryNotional += execution.quantity * execution.price;
      if (execution.protectionStopAtFill == null)
        throw new Error(
          "Entry executions require their protection stop risk snapshot.",
        );
      validateStopDirection(
        campaign.direction,
        execution.price,
        execution.protectionStopAtFill,
      );
      actualInitialRisk +=
        execution.quantity *
        Math.abs(execution.price - execution.protectionStopAtFill);
    } else {
      if (
        execution.role === "entry" ||
        execution.quantity > openQuantity ||
        positionAverageEntry == null
      )
        throw new Error("Exit execution exceeds the confirmed open position.");
      grossRealizedPnl +=
        multiplier *
        (execution.price - positionAverageEntry) *
        execution.quantity;
      openQuantity -= execution.quantity;
      exitedQuantity += execution.quantity;
      if (openQuantity === 0) positionAverageEntry = null;
    }
  }
  const actualAverageEntry = enteredQuantity
    ? entryNotional / enteredQuantity
    : null;
  const realizedNetPnl = grossRealizedPnl - fees;
  const closed = enteredQuantity > 0 && openQuantity === 0;
  return {
    executions: [...seen.values()],
    openQuantity,
    actualAverageEntry,
    positionAverageEntry,
    enteredQuantity,
    exitedQuantity,
    actualInitialRisk,
    grossRealizedPnl,
    fees,
    realizedNetPnl,
    finalNetPnl: closed ? realizedNetPnl : null,
    finalNetR:
      closed && actualInitialRisk > 0
        ? realizedNetPnl / actualInitialRisk
        : null,
  };
}

export function ingestExecutions(
  campaign: TradeCampaign,
  incoming: Execution[],
) {
  const byIdentity = new Map(
    campaign.executions.map((execution) => [
      executionIdentity(execution),
      execution,
    ]),
  );
  let ignoredDuplicateCount = 0;
  const conflicts: string[] = [];
  for (const execution of incoming) {
    validateExecution(execution, campaign);
    const identity = executionIdentity(execution);
    const existing = byIdentity.get(identity);
    if (!existing) byIdentity.set(identity, execution);
    else if (sameExecution(existing, execution)) ignoredDuplicateCount += 1;
    else conflicts.push(identity);
  }
  const next = { ...campaign, executions: [...byIdentity.values()] };
  if (conflicts.length)
    next.lifecycle = {
      status: "Needs Review",
      resumeStatus: campaign.lifecycle.status,
    };
  return {
    campaign: next,
    rollup: rollupCampaign(next),
    ignoredDuplicateCount,
    conflicts,
  };
}

export function upsertJournalCampaignFromExecution(input: {
  campaigns: TradeCampaign[];
  execution: Execution;
  symbol: string;
  direction: TradeDirection;
  journalTradeId: string;
  planId?: string;
  journalSnapshot?: JournalCampaignSnapshot;
}) {
  const existingIndex = input.campaigns.findIndex(
    (campaign) => campaign.campaignId === input.execution.campaignId,
  );
  if (existingIndex < 0) {
    if (input.execution.effect !== "entry")
      throw new Error("A Journal campaign cannot begin with an exit execution.");
    const created: TradeCampaign = {
      schemaVersion: TRADING_DOMAIN_VERSION,
      campaignId: input.execution.campaignId,
      accountId: input.execution.accountId,
      journalTradeId: input.journalTradeId,
      planId: input.planId,
      symbol: input.symbol.toUpperCase(),
      direction: input.direction,
      lifecycle: { status: "Partially filled" },
      executions: [input.execution],
      journalSnapshot: input.journalSnapshot,
    };
    rollupCampaign(created);
    return { campaigns: [...input.campaigns, created], campaign: created, created: true };
  }
  const existing = input.campaigns[existingIndex];
  if (
    existing.accountId !== input.execution.accountId ||
    existing.symbol !== input.symbol.toUpperCase() ||
    existing.direction !== input.direction
  )
    throw new Error("Execution identity conflicts with the existing Journal campaign.");
  const ingested = ingestExecutions(existing, [input.execution]);
  const campaign = {
    ...ingested.campaign,
    lifecycle: {
      status:
        ingested.rollup.openQuantity === 0
          ? "Closed"
          : ingested.rollup.exitedQuantity > 0
            ? "Closing"
            : existing.lifecycle.status,
    } as LifecycleState,
  };
  const campaigns = [...input.campaigns];
  campaigns[existingIndex] = campaign;
  return {
    campaigns,
    campaign,
    created: false,
    ignoredDuplicateCount: ingested.ignoredDuplicateCount,
    conflicts: ingested.conflicts,
  };
}

export type LifecycleState = {
  status: LifecycleStatus;
  resumeStatus?: LifecycleStatus;
};
export type LifecycleEvent =
  | "save"
  | "submit"
  | "partial-fill"
  | "filled"
  | "protection-missing"
  | "begin-close"
  | "closed"
  | "cancel"
  | "expire"
  | "reject"
  | "sync-start"
  | "sync-resolved"
  | "review-required";

const transitions: Partial<
  Record<LifecycleStatus, Partial<Record<LifecycleEvent, LifecycleStatus>>>
> = {
  Draft: { save: "Saved", cancel: "Cancelled" },
  Saved: { submit: "Pending entry", cancel: "Cancelled", expire: "Expired" },
  "Pending entry": {
    "partial-fill": "Partially filled",
    filled: "Open",
    cancel: "Cancelled",
    expire: "Expired",
    reject: "Rejected",
    "protection-missing": "Unprotected",
  },
  "Partially filled": {
    "partial-fill": "Partially filled",
    filled: "Open",
    "protection-missing": "Unprotected",
    "begin-close": "Closing",
  },
  Open: {
    "protection-missing": "Unprotected",
    "begin-close": "Closing",
    closed: "Closed",
  },
  Unprotected: { filled: "Open", "begin-close": "Closing", closed: "Closed" },
  Closing: { closed: "Closed", "partial-fill": "Closing" },
};

export function transitionLifecycle(
  state: LifecycleState,
  event: LifecycleEvent,
): LifecycleState {
  if (event === "sync-start")
    return state.status === "Sync pending"
      ? state
      : { status: "Sync pending", resumeStatus: state.status };
  if (event === "sync-resolved") {
    if (state.status !== "Sync pending" || !state.resumeStatus)
      throw new Error("No synchronization state to resolve.");
    return { status: state.resumeStatus };
  }
  if (event === "review-required")
    return state.status === "Needs Review"
      ? state
      : { status: "Needs Review", resumeStatus: state.status };
  const next = transitions[state.status]?.[event];
  if (!next) throw new Error(`Cannot apply ${event} while ${state.status}.`);
  return { status: next };
}

export type ReconciliationState = {
  checkpoint?: ReconciliationCheckpoint;
  openQuantity: number;
  lifecycle: LifecycleState;
  discrepancies: string[];
};

export function reconcileCheckpoint(
  state: ReconciliationState,
  checkpoint: ReconciliationCheckpoint,
): ReconciliationState {
  if (
    checkpoint.schemaVersion !== TRADING_DOMAIN_VERSION ||
    !checkpoint.checkpointId ||
    !checkpoint.accountId ||
    !checkpoint.sessionId ||
    !Number.isFinite(Date.parse(checkpoint.reconciledAt)) ||
    ![
      checkpoint.brokerOpenQuantity,
      checkpoint.brokerProtectionQuantity,
      checkpoint.brokerWorkingExitQuantity,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new Error("Invalid reconciliation checkpoint.");
  }
  if (state.checkpoint?.checkpointId === checkpoint.checkpointId) {
    if (JSON.stringify(state.checkpoint) === JSON.stringify(checkpoint))
      return state;
    return {
      ...state,
      lifecycle: {
        status: "Needs Review",
        resumeStatus: state.lifecycle.status,
      },
      discrepancies: [
        ...state.discrepancies,
        "Conflicting broker snapshots share one checkpoint identity.",
      ],
    };
  }
  const discrepancies: string[] = [];
  if (checkpoint.brokerProtectionQuantity < checkpoint.brokerOpenQuantity)
    discrepancies.push(
      "Broker-confirmed protection does not cover every open share.",
    );
  if (checkpoint.brokerWorkingExitQuantity > checkpoint.brokerOpenQuantity)
    discrepancies.push("Working exits exceed broker-confirmed open quantity.");
  let lifecycle = state.lifecycle;
  if (checkpoint.brokerOpenQuantity === 0 && state.openQuantity > 0)
    lifecycle = { status: "Closed" };
  else if (
    checkpoint.brokerOpenQuantity > 0 &&
    checkpoint.brokerProtectionQuantity < checkpoint.brokerOpenQuantity
  )
    lifecycle = { status: "Unprotected" };
  else if (discrepancies.length)
    lifecycle = {
      status: "Needs Review",
      resumeStatus: state.lifecycle.status,
    };
  else if (lifecycle.status === "Sync pending")
    lifecycle = { status: lifecycle.resumeStatus ?? "Open" };
  return {
    checkpoint,
    openQuantity: checkpoint.brokerOpenQuantity,
    lifecycle,
    discrepancies,
  };
}

export function nextCampaignIdentity(input: {
  accountId: string;
  planId?: string;
  symbol: string;
  existing: Array<{
    campaignId: string;
    planId?: string;
    symbol: string;
    openQuantity: number;
  }>;
}) {
  const linkedOpen = input.existing.find(
    (campaign) =>
      campaign.openQuantity > 0 &&
      campaign.planId === input.planId &&
      campaign.symbol === input.symbol,
  );
  if (linkedOpen) return linkedOpen.campaignId;
  const prefix = `${input.accountId}:${input.planId ?? "unlinked"}:${input.symbol}:`;
  const sequence =
    Math.max(
      0,
      ...input.existing.map((campaign) =>
        campaign.campaignId.startsWith(prefix)
          ? Number(campaign.campaignId.slice(prefix.length)) || 0
          : 0,
      ),
    ) + 1;
  return `${prefix}${sequence}`;
}
