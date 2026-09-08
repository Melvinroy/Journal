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
  stop: { method: StopMethod; price: number; atr14?: number; atrMultiplier?: number };
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
};

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
  answers: Partial<Record<"environment" | "setup" | "entry" | "risk" | "exits", "Yes" | "No" | "N/A">>;
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

export function validateStopDirection(direction: TradeDirection, entry: number, stop: number): void {
  if (!positive(entry) || !positive(stop)) throw new Error("Entry and stop must be positive finite prices.");
  if (direction === "Long" ? stop >= entry : stop <= entry) {
    throw new Error(direction === "Long" ? "A long stop must be below entry." : "A short stop must be above entry.");
  }
}

export function sizingAccountBase(ibkrEquity: number | null | undefined, manualPlanningBalance: number) {
  if (!positive(manualPlanningBalance)) throw new Error("Manual planning balance must be positive.");
  if (ibkrEquity == null) return { accountBase: manualPlanningBalance, source: "Manual planning balance" as const };
  if (!positive(ibkrEquity)) throw new Error("IBKR equity must be positive when supplied.");
  return ibkrEquity <= manualPlanningBalance
    ? { accountBase: ibkrEquity, source: "IBKR equity" as const }
    : { accountBase: manualPlanningBalance, source: "Manual planning balance" as const };
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
  const { accountBase, riskPercent, allocationPercent, entryPrice, stopPrice, direction } = input;
  if (![accountBase, riskPercent, allocationPercent, entryPrice].every(positive)) throw new Error("Sizing inputs must be positive.");
  validateStopDirection(direction, entryPrice, stopPrice);
  const existingPositionRisk = input.existingPositionRisk ?? 0;
  const existingHoldingValue = input.existingHoldingValue ?? 0;
  const pendingEntryValue = input.pendingEntryValue ?? 0;
  if (![existingPositionRisk, existingHoldingValue, pendingEntryValue].every(nonNegative)) throw new Error("Existing exposure cannot be negative.");
  const riskBudget = accountBase * riskPercent / 100;
  const availableRisk = Math.max(0, riskBudget - existingPositionRisk);
  const symbolAllocationBudget = accountBase * allocationPercent / 100;
  const remainingAllocationValue = Math.max(0, symbolAllocationBudget - existingHoldingValue - pendingEntryValue);
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
    accountUsePercent: positionValue / accountBase * 100,
    actualRiskPercent: plannedRisk / accountBase * 100,
    limitingConstraint: sharesByRisk <= sharesByAllocation ? "Risk" as const : "Allocation" as const,
  };
}

export type DailyBar = { high: number; low: number; close: number };

export function calculateWilderAtr14(bars: DailyBar[]): number {
  if (bars.length < 15) throw new Error("Wilder ATR14 requires a prior close plus 14 valid daily true ranges.");
  bars.forEach((bar, index) => {
    if (![bar.high, bar.low, bar.close].every(positive) || bar.high < Math.max(bar.low, bar.close) || bar.low > bar.close) {
      throw new Error(`Invalid daily bar at index ${index}.`);
    }
  });
  const trueRanges = bars.slice(1).map((bar, index) =>
    Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index].close), Math.abs(bar.low - bars[index].close)));
  let atr = trueRanges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
  for (const trueRange of trueRanges.slice(14)) atr = (13 * atr + trueRange) / 14;
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
  if (!positive(capturedEntry)) throw new Error("Captured entry must be positive.");
  let stop: number;
  if (method === "ATR") {
    if (!positive(input.atr14 ?? 0) || !positive(input.atrMultiplier ?? 0)) throw new Error("ATR stops require a positive ATR14 and multiplier.");
    stop = capturedEntry + (direction === "Long" ? -1 : 1) * input.atr14! * input.atrMultiplier!;
  } else if (method === "LoD") {
    if (direction !== "Long" || !positive(input.dayLow ?? 0)) throw new Error("LoD is available for longs and requires a day low.");
    stop = input.dayLow!;
  } else if (method === "HoD") {
    if (direction !== "Short" || !positive(input.dayHigh ?? 0)) throw new Error("HoD is available for shorts and requires a day high.");
    stop = input.dayHigh!;
  } else {
    if (!positive(input.manualStop ?? 0)) throw new Error("Manual stops require a positive price.");
    stop = input.manualStop!;
  }
  validateStopDirection(direction, capturedEntry, stop);
  return stop;
}

export function weightedAverageEntry(fills: Array<{ quantity: number; price: number }>): number | null {
  if (!fills.length) return null;
  if (fills.some(fill => !Number.isSafeInteger(fill.quantity) || fill.quantity <= 0 || !positive(fill.price))) throw new Error("Entry fills require positive whole-share quantities and prices.");
  const quantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  return fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / quantity;
}

export function initialRisk(fills: Array<{ quantity: number; entryPrice: number; protectionStop: number }>, direction: TradeDirection) {
  return fills.reduce((sum, fill) => {
    if (!Number.isSafeInteger(fill.quantity) || fill.quantity <= 0) throw new Error("Risk snapshots require positive whole-share quantities.");
    validateStopDirection(direction, fill.entryPrice, fill.protectionStop);
    return sum + fill.quantity * Math.abs(fill.entryPrice - fill.protectionStop);
  }, 0);
}

export function targetPrice(actualAverageEntry: number, fixedStop: number, multipleR: number, direction: TradeDirection) {
  validateStopDirection(direction, actualAverageEntry, fixedStop);
  if (!positive(multipleR)) throw new Error("Target multiple must be positive.");
  return actualAverageEntry + (direction === "Long" ? 1 : -1) * Math.abs(actualAverageEntry - fixedStop) * multipleR;
}

export function allocateExitShares(total: number, percentages: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !percentages.length || percentages.some(value => !nonNegative(value)) || Math.abs(percentages.reduce((a, b) => a + b, 0) - 100) > 1e-9) {
    throw new Error("Exit percentages must be non-negative and total 100%.");
  }
  const result = percentages.map(value => Math.floor(total * value / 100));
  const order = percentages.map((value, index) => ({ index, remainder: total * value / 100 - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = total - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index += 1) result[order[index].index] += 1;
  return result;
}

export function realizedPnl(input: { direction: TradeDirection; averageEntry: number; exits: Array<{ quantity: number; price: number }>; fees: number }) {
  if (!positive(input.averageEntry) || !nonNegative(input.fees)) throw new Error("Realized P&L inputs are invalid.");
  const direction = input.direction === "Long" ? 1 : -1;
  const gross = input.exits.reduce((sum, exit) => {
    if (!Number.isSafeInteger(exit.quantity) || exit.quantity <= 0 || !positive(exit.price)) throw new Error("Exit fills require positive whole-share quantities and prices.");
    return sum + direction * (exit.price - input.averageEntry) * exit.quantity;
  }, 0);
  return { gross, fees: input.fees, net: gross - input.fees };
}

export function remainingRisk(input: { direction: TradeDirection; openQuantity: number; averageEntry: number; protectionStop?: number; brokerConfirmed: boolean }) {
  if (!Number.isSafeInteger(input.openQuantity) || input.openQuantity < 0 || !positive(input.averageEntry)) throw new Error("Remaining-risk inputs are invalid.");
  if (input.openQuantity === 0) return { protected: true, risk: 0 };
  if (!input.brokerConfirmed || input.protectionStop == null) return { protected: false, risk: null };
  if (!positive(input.protectionStop)) throw new Error("Protection stop must be positive.");
  const lossPerShare = input.direction === "Long"
    ? Math.max(0, input.averageEntry - input.protectionStop)
    : Math.max(0, input.protectionStop - input.averageEntry);
  return { protected: true, risk: lossPerShare * input.openQuantity };
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

export function executionIdentity(execution: Pick<Execution, "accountId" | "sessionId" | "executionId">) {
  return `${execution.accountId}\u001f${execution.sessionId}\u001f${execution.executionId}`;
}

function sameExecution(left: Execution, right: Execution) {
  return left.schemaVersion === right.schemaVersion
    && left.accountId === right.accountId
    && left.sessionId === right.sessionId
    && left.executionId === right.executionId
    && left.orderId === right.orderId
    && left.campaignId === right.campaignId
    && left.effect === right.effect
    && left.role === right.role
    && left.quantity === right.quantity
    && left.price === right.price
    && left.fee === right.fee
    && left.occurredAt === right.occurredAt
    && left.protectionStopAtFill === right.protectionStopAtFill
    && left.provenance === right.provenance;
}

function validateExecution(execution: Execution, campaign: Pick<TradeCampaign, "accountId" | "campaignId">) {
  if (execution.schemaVersion !== TRADING_DOMAIN_VERSION || execution.accountId !== campaign.accountId || execution.campaignId !== campaign.campaignId) throw new Error("Execution identity does not match the campaign.");
  if (!execution.executionId || !execution.orderId || !execution.sessionId || !Number.isSafeInteger(execution.quantity) || execution.quantity <= 0 || !positive(execution.price) || !nonNegative(execution.fee) || !Number.isFinite(Date.parse(execution.occurredAt))) throw new Error("Invalid execution.");
}

export function rollupCampaign(campaign: Pick<TradeCampaign, "accountId" | "campaignId" | "direction" | "executions">): CampaignRollup {
  const executions = [...campaign.executions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || executionIdentity(a).localeCompare(executionIdentity(b)));
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
      if (!sameExecution(previousExecution, execution)) throw new Error("Conflicting executions share one broker identity.");
      continue;
    }
    seen.set(identity, execution);
    fees += execution.fee;
    if (execution.effect === "entry") {
      if (execution.role !== "entry") throw new Error("Entry executions must use the entry role.");
      const previousCost: number = (positionAverageEntry ?? 0) * openQuantity;
      openQuantity += execution.quantity;
      positionAverageEntry = (previousCost + execution.quantity * execution.price) / openQuantity;
      enteredQuantity += execution.quantity;
      entryNotional += execution.quantity * execution.price;
      if (execution.protectionStopAtFill == null) throw new Error("Entry executions require their protection stop risk snapshot.");
      validateStopDirection(campaign.direction, execution.price, execution.protectionStopAtFill);
      actualInitialRisk += execution.quantity * Math.abs(execution.price - execution.protectionStopAtFill);
    } else {
      if (execution.role === "entry" || execution.quantity > openQuantity || positionAverageEntry == null) throw new Error("Exit execution exceeds the confirmed open position.");
      grossRealizedPnl += multiplier * (execution.price - positionAverageEntry) * execution.quantity;
      openQuantity -= execution.quantity;
      exitedQuantity += execution.quantity;
      if (openQuantity === 0) positionAverageEntry = null;
    }
  }
  const actualAverageEntry = enteredQuantity ? entryNotional / enteredQuantity : null;
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
    finalNetR: closed && actualInitialRisk > 0 ? realizedNetPnl / actualInitialRisk : null,
  };
}

export function ingestExecutions(campaign: TradeCampaign, incoming: Execution[]) {
  const byIdentity = new Map(campaign.executions.map(execution => [executionIdentity(execution), execution]));
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
  if (conflicts.length) next.lifecycle = { status: "Needs Review", resumeStatus: campaign.lifecycle.status };
  return { campaign: next, rollup: rollupCampaign(next), ignoredDuplicateCount, conflicts };
}

export type LifecycleState = { status: LifecycleStatus; resumeStatus?: LifecycleStatus };
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

const transitions: Partial<Record<LifecycleStatus, Partial<Record<LifecycleEvent, LifecycleStatus>>>> = {
  Draft: { save: "Saved", cancel: "Cancelled" },
  Saved: { submit: "Pending entry", cancel: "Cancelled", expire: "Expired" },
  "Pending entry": { "partial-fill": "Partially filled", filled: "Open", cancel: "Cancelled", expire: "Expired", reject: "Rejected", "protection-missing": "Unprotected" },
  "Partially filled": { "partial-fill": "Partially filled", filled: "Open", "protection-missing": "Unprotected", "begin-close": "Closing" },
  Open: { "protection-missing": "Unprotected", "begin-close": "Closing", closed: "Closed" },
  Unprotected: { filled: "Open", "begin-close": "Closing", closed: "Closed" },
  Closing: { closed: "Closed", "partial-fill": "Closing" },
};

export function transitionLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  if (event === "sync-start") return state.status === "Sync pending" ? state : { status: "Sync pending", resumeStatus: state.status };
  if (event === "sync-resolved") {
    if (state.status !== "Sync pending" || !state.resumeStatus) throw new Error("No synchronization state to resolve.");
    return { status: state.resumeStatus };
  }
  if (event === "review-required") return state.status === "Needs Review" ? state : { status: "Needs Review", resumeStatus: state.status };
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

export function reconcileCheckpoint(state: ReconciliationState, checkpoint: ReconciliationCheckpoint): ReconciliationState {
  if (checkpoint.schemaVersion !== TRADING_DOMAIN_VERSION || !checkpoint.checkpointId || !checkpoint.accountId || !checkpoint.sessionId || !Number.isFinite(Date.parse(checkpoint.reconciledAt)) || ![checkpoint.brokerOpenQuantity, checkpoint.brokerProtectionQuantity, checkpoint.brokerWorkingExitQuantity].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Invalid reconciliation checkpoint.");
  }
  if (state.checkpoint?.checkpointId === checkpoint.checkpointId) {
    if (JSON.stringify(state.checkpoint) === JSON.stringify(checkpoint)) return state;
    return { ...state, lifecycle: { status: "Needs Review", resumeStatus: state.lifecycle.status }, discrepancies: [...state.discrepancies, "Conflicting broker snapshots share one checkpoint identity."] };
  }
  const discrepancies: string[] = [];
  if (checkpoint.brokerProtectionQuantity < checkpoint.brokerOpenQuantity) discrepancies.push("Broker-confirmed protection does not cover every open share.");
  if (checkpoint.brokerWorkingExitQuantity > checkpoint.brokerOpenQuantity) discrepancies.push("Working exits exceed broker-confirmed open quantity.");
  let lifecycle = state.lifecycle;
  if (checkpoint.brokerOpenQuantity === 0 && state.openQuantity > 0) lifecycle = { status: "Closed" };
  else if (checkpoint.brokerOpenQuantity > 0 && checkpoint.brokerProtectionQuantity < checkpoint.brokerOpenQuantity) lifecycle = { status: "Unprotected" };
  else if (discrepancies.length) lifecycle = { status: "Needs Review", resumeStatus: state.lifecycle.status };
  else if (lifecycle.status === "Sync pending") lifecycle = { status: lifecycle.resumeStatus ?? "Open" };
  return { checkpoint, openQuantity: checkpoint.brokerOpenQuantity, lifecycle, discrepancies };
}

export function nextCampaignIdentity(input: { accountId: string; planId?: string; symbol: string; existing: Array<{ campaignId: string; planId?: string; symbol: string; openQuantity: number }> }) {
  const linkedOpen = input.existing.find(campaign => campaign.openQuantity > 0 && campaign.planId === input.planId && campaign.symbol === input.symbol);
  if (linkedOpen) return linkedOpen.campaignId;
  const prefix = `${input.accountId}:${input.planId ?? "unlinked"}:${input.symbol}:`;
  const sequence = Math.max(0, ...input.existing.map(campaign => campaign.campaignId.startsWith(prefix) ? Number(campaign.campaignId.slice(prefix.length)) || 0 : 0)) + 1;
  return `${prefix}${sequence}`;
}
