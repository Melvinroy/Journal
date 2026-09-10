import type { TradeDirection } from "./trading-domain";

export const IBKR_ADAPTER_VERSION = 1 as const;

export type PaperGatewayConfig = Readonly<{
  host: string;
  port: number;
  clientId: number;
  accountId: string;
  submissionsEnabled?: boolean;
}>;

export type OperatorVerification = Readonly<{
  accountId: string;
  observedIn: "TWS" | "IB Gateway";
  verifiedAt: string;
  configurationBinding: string;
}>;

export type ConnectionObservation = Readonly<{
  managedAccounts: string[];
  connectedAt: string;
}>;

export type SubmissionAuthorization = Readonly<{
  accountId: string;
  connectionId: string;
  maskedAccountId: string;
  label: "PAPER — OPERATOR VERIFIED";
}>;

export class PaperSafetyError extends Error {
  constructor(message: string, readonly code:
    | "SUBMISSION_DISABLED"
    | "VERIFICATION_REQUIRED"
    | "CONFIGURATION_CHANGED"
    | "ACCOUNT_MISSING"
    | "ACCOUNT_MISMATCH"
    | "UNEXPECTED_ACCOUNT"
    | "ORDER_ACCOUNT_MISMATCH"
    | "AUCTION_UNVALIDATED") {
    super(message);
    this.name = "PaperSafetyError";
  }
}

export class BrokerSubmissionUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerSubmissionUncertainError";
  }
}

export class BrokerSubmissionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerSubmissionRejectedError";
  }
}

function requiredText(value: string, field: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function assertDate(value: string, field: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO-compatible timestamp.`);
}

/**
 * This is an equality binding, not proof that a session is paper. It deliberately
 * binds every connection setting so any edit forces operator reverification.
 */
export function paperConfigurationBinding(config: PaperGatewayConfig) {
  const host = requiredText(config.host, "Gateway host");
  const accountId = requiredText(config.accountId, "Allowlisted account ID");
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Gateway port is invalid.");
  if (!Number.isSafeInteger(config.clientId) || config.clientId < 0) throw new Error("Client ID is invalid.");
  return JSON.stringify({ adapter: IBKR_ADAPTER_VERSION, host, port: config.port, clientId: config.clientId, accountId });
}

export function recordOperatorVerification(
  config: PaperGatewayConfig,
  observedAccountId: string,
  observedIn: OperatorVerification["observedIn"],
  verifiedAt: string,
): OperatorVerification {
  const expected = requiredText(config.accountId, "Allowlisted account ID");
  const observed = requiredText(observedAccountId, "Observed account ID");
  assertDate(verifiedAt, "Verification time");
  if (observed !== expected) throw new PaperSafetyError("The account shown in IBKR does not match the configured allowlist.", "ACCOUNT_MISMATCH");
  return { accountId: expected, observedIn, verifiedAt, configurationBinding: paperConfigurationBinding(config) };
}

export function maskAccountId(accountId: string) {
  const value = requiredText(accountId, "Account ID");
  return value.length <= 4 ? "••••" : `${value.slice(0, 2)}${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

export function verifyPaperConnection(
  config: PaperGatewayConfig,
  verification: OperatorVerification | undefined,
  observation: ConnectionObservation,
): SubmissionAuthorization {
  paperConfigurationBinding(config);
  assertDate(observation.connectedAt, "Connection time");
  if (!verification) throw new PaperSafetyError("Operator verification is required before paper submission.", "VERIFICATION_REQUIRED");
  if (verification.accountId !== config.accountId || verification.configurationBinding !== paperConfigurationBinding(config)) {
    throw new PaperSafetyError("Gateway, client or account configuration changed after operator verification.", "CONFIGURATION_CHANGED");
  }
  const accounts = [...new Set(observation.managedAccounts.map(value => value.trim()).filter(Boolean))];
  if (!accounts.length) throw new PaperSafetyError("The gateway returned no managed account.", "ACCOUNT_MISSING");
  if (!accounts.includes(config.accountId)) throw new PaperSafetyError("The connected account does not match the verified allowlist.", "ACCOUNT_MISMATCH");
  if (accounts.some(accountId => accountId !== config.accountId)) {
    throw new PaperSafetyError("The gateway exposed an unexpected account; submission is disabled.", "UNEXPECTED_ACCOUNT");
  }
  return {
    accountId: config.accountId,
    connectionId: `${observation.connectedAt}\u001f${config.clientId}\u001f${config.accountId}`,
    maskedAccountId: maskAccountId(config.accountId),
    label: "PAPER — OPERATOR VERIFIED",
  };
}

export function authorizePaperConnection(
  config: PaperGatewayConfig,
  verification: OperatorVerification | undefined,
  observation: ConnectionObservation,
): SubmissionAuthorization {
  if (!config.submissionsEnabled) throw new PaperSafetyError("Paper order submission is disabled by default.", "SUBMISSION_DISABLED");
  return verifyPaperConnection(config, verification, observation);
}

export type StockContract = Readonly<{
  conId: number;
  symbol: string;
  secType: "STK";
  exchange: string;
  currency: string;
}>;

export type EntryMethod = "Normal" | "Limit" | "Breakout" | "Opening";
export type TradingSessionMode = "Regular" | "RegularExtended" | "Overnight" | "OvernightDay";
export type OrderDuration = "DAY" | "GTC";
export type ProtectionOrderType = "STP" | "STP LMT";

export type ExecutionSessionPolicy = Readonly<{
  mode: TradingSessionMode;
  duration: OrderDuration;
  route: "SMART" | "OVERNIGHT" | "OVERNIGHT+SMART";
  entryOrderType: "MIDPRICE" | "LMT";
  outsideRth: boolean;
  protectionOrderType: ProtectionOrderType;
  protectionOutsideRth: boolean;
  protectionLimitPrice?: number;
  effectiveCoverage?: string;
  expiresAt?: string;
  scheduleSource?: "IBKR contract schedule" | "Planning preview";
  brokerTimeZone?: string;
  submissionEligible: boolean;
  blockedReason?: string;
}>;

export function sessionDurationOptions(mode: TradingSessionMode): readonly OrderDuration[] {
  return mode === "Regular" || mode === "RegularExtended" ? ["DAY", "GTC"] : ["DAY"];
}

export function resolveExecutionSession(input: {
  mode: TradingSessionMode;
  duration: OrderDuration;
  protectionOrderType: ProtectionOrderType;
  protectionStopPrice: number;
  protectionLimitPrice?: number;
}): ExecutionSessionPolicy {
  if (!sessionDurationOptions(input.mode).includes(input.duration)) throw new Error("The selected duration is not valid for this trading session.");
  price(input.protectionStopPrice, "Protection trigger");
  if (input.mode === "Overnight") return {
    mode: input.mode, duration: "DAY", route: "OVERNIGHT", entryOrderType: "LMT", outsideRth: false,
    protectionOrderType: input.protectionOrderType, protectionOutsideRth: false, protectionLimitPrice: input.protectionLimitPrice,
    submissionEligible: false, scheduleSource: "Planning preview",
    blockedReason: "Overnight entries are planning-only because the verified OVERNIGHT route supports limit entries but no supported broker-held initial stop protection.",
  };
  if (input.mode === "OvernightDay") return {
    mode: input.mode, duration: "DAY", route: "OVERNIGHT+SMART", entryOrderType: "LMT", outsideRth: false,
    protectionOrderType: input.protectionOrderType, protectionOutsideRth: false, protectionLimitPrice: input.protectionLimitPrice,
    submissionEligible: false, scheduleSource: "Planning preview",
    blockedReason: "Overnight + following day is planning-only because the installed TWS socket API has no verified documented field for this combined route; Web API OVT/OND values are not reused.",
  };
  if (input.protectionOrderType === "STP LMT") price(input.protectionLimitPrice ?? 0, "Protection limit");
  if (input.mode === "RegularExtended" && input.protectionOrderType !== "STP LMT") return {
    mode: input.mode, duration: input.duration, route: "SMART", entryOrderType: "LMT", outsideRth: true,
    protectionOrderType: input.protectionOrderType, protectionOutsideRth: false,
    submissionEligible: false, scheduleSource: "Planning preview",
    blockedReason: "Regular + extended entries require explicit stop-limit protection with its own valid limit price; an ordinary stop is not silently replaced.",
  };
  return {
    mode: input.mode, duration: input.duration, route: "SMART", entryOrderType: input.mode === "Regular" ? "MIDPRICE" : "LMT",
    outsideRth: input.mode === "RegularExtended", protectionOrderType: input.protectionOrderType,
    protectionOutsideRth: input.mode === "RegularExtended", protectionLimitPrice: input.protectionLimitPrice,
    submissionEligible: true, scheduleSource: "Planning preview",
    effectiveCoverage: input.mode === "Regular" ? "Broker regular hours; exact schedule verified with the intent" : "Broker total trading hours; exact schedule verified with the intent",
    expiresAt: input.duration === "DAY" ? "End of the selected broker session" : "Until cancelled; eligible only during supported broker sessions",
  };
}

export function validateStopLimitProtection(direction: TradeDirection, triggerPrice: number, limitPrice: number, minimumTick: number) {
  const trigger = price(triggerPrice, "Protection trigger");
  const limit = price(limitPrice, "Protection limit");
  const tick = price(minimumTick, "Minimum tick");
  for (const [value, label] of [[trigger, "Protection trigger"], [limit, "Protection limit"]] as const) {
    if (Math.abs(value / tick - Math.round(value / tick)) > 1e-7) throw new Error(`${label} does not conform to the broker minimum tick.`);
  }
  if (direction === "Long" ? limit > trigger : limit < trigger) throw new Error(direction === "Long" ? "A sell stop-limit price must be at or below its trigger." : "A buy stop-limit price must be at or above its trigger.");
  return { triggerPrice: trigger, limitPrice: limit };
}

export type EntryTicket = Readonly<{
  account: string;
  action: "BUY" | "SELL";
  totalQuantity: number;
  orderType: "MIDPRICE" | "STP LMT" | "LMT";
  tif: OrderDuration | "OPG";
  lmtPrice: number;
  auxPrice?: number;
  outsideRth: boolean;
  transmit: false;
  orderRef: string;
}>;

export type ProtectionTicket = Readonly<{
  account: string;
  action: "BUY" | "SELL";
  totalQuantity: number;
  orderType: ProtectionOrderType;
  tif: "GTC";
  auxPrice: number;
  lmtPrice?: number;
  outsideRth: boolean;
  transmit: true;
  parentRef: string;
  orderRef: string;
}>;

export type ConstructedEntryPackage = Readonly<{
  contract: StockContract;
  entry: EntryTicket;
  protection: ProtectionTicket;
  sessionPolicy?: ExecutionSessionPolicy;
  submissionPolicy: "paper-enabled" | "construction-only-auction";
}>;

export function validateStockContract(contract: StockContract) {
  if (!Number.isSafeInteger(contract.conId) || contract.conId <= 0) throw new Error("A qualified IBKR contract ID is required.");
  requiredText(contract.symbol, "Stock symbol");
  requiredText(contract.exchange, "Stock exchange");
  requiredText(contract.currency, "Stock currency");
  if (contract.secType !== "STK") throw new Error("Gate 2 supports stocks only.");
  return contract;
}

function wholeShares(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Order quantity must be positive whole shares.");
  return value;
}

function price(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive price.`);
  return value;
}

export function constructEntryPackage(input: {
  authorization: SubmissionAuthorization;
  contract: StockContract;
  direction: TradeDirection;
  method: EntryMethod;
  quantity: number;
  hardCap: number;
  stopPrice: number;
  triggerPrice?: number;
  idempotencyKey: string;
  sessionPolicy?: ExecutionSessionPolicy;
}): ConstructedEntryPackage {
  validateStockContract(input.contract);
  const account = input.authorization.accountId;
  const quantity = wholeShares(input.quantity);
  const hardCap = price(input.hardCap, "Hard cap");
  const stopPrice = price(input.stopPrice, "Protection stop");
  const orderRef = requiredText(input.idempotencyKey, "Idempotency key");
  if (input.direction === "Long" ? stopPrice >= hardCap : stopPrice <= hardCap) throw new Error("Protection stop is on the wrong side of the entry cap.");
  const action = input.direction === "Long" ? "BUY" : "SELL";
  const exitAction = action === "BUY" ? "SELL" : "BUY";
  let entry: EntryTicket;
  const policy = input.sessionPolicy;
  if (policy && !policy.submissionEligible) throw new Error(policy.blockedReason ?? "The selected session is not eligible for submission.");
  const expectedOrderType = input.method === "Normal" ? "MIDPRICE" : input.method === "Limit" ? "LMT" : input.method === "Breakout" ? "STP LMT" : "LMT";
  if (policy && input.method !== "Opening" && policy.entryOrderType !== expectedOrderType) throw new Error("The saved entry type is incompatible with the selected session and was not converted.");
  const tif = policy?.duration ?? "DAY";
  const outsideRth = policy?.outsideRth ?? false;
  if (input.method === "Normal") {
    entry = { account, action, totalQuantity: quantity, orderType: "MIDPRICE", tif, lmtPrice: hardCap, outsideRth, transmit: false, orderRef };
  } else if (input.method === "Limit") {
    entry = { account, action, totalQuantity: quantity, orderType: "LMT", tif, lmtPrice: hardCap, outsideRth, transmit: false, orderRef };
  } else if (input.method === "Breakout") {
    const triggerPrice = price(input.triggerPrice ?? 0, "Breakout trigger");
    if (input.direction === "Long" ? hardCap < triggerPrice : hardCap > triggerPrice) throw new Error("A stop-limit worst price cannot cross inside its trigger.");
    entry = { account, action, totalQuantity: quantity, orderType: "STP LMT", tif, lmtPrice: hardCap, auxPrice: triggerPrice, outsideRth, transmit: false, orderRef };
  } else {
    entry = { account, action, totalQuantity: quantity, orderType: "LMT", tif: "OPG", lmtPrice: hardCap, outsideRth: false, transmit: false, orderRef };
  }
  return {
    contract: input.contract,
    entry,
    protection: {
      account,
      action: exitAction,
      totalQuantity: quantity,
      orderType: policy?.protectionOrderType ?? "STP",
      tif: "GTC",
      auxPrice: stopPrice,
      ...(policy?.protectionOrderType === "STP LMT" ? { lmtPrice: policy.protectionLimitPrice } : {}),
      outsideRth: policy?.protectionOutsideRth ?? false,
      transmit: true,
      parentRef: orderRef,
      orderRef: `${orderRef}:protection`,
    },
    ...(policy ? { sessionPolicy: policy } : {}),
    submissionPolicy: input.method === "Opening" ? "construction-only-auction" : "paper-enabled",
  };
}

export function assertOrderAccount(authorization: SubmissionAuthorization, order: { account?: string }) {
  if (!order.account || order.account !== authorization.accountId) {
    throw new PaperSafetyError("Every order must explicitly use the verified account ID.", "ORDER_ACCOUNT_MISMATCH");
  }
}

export function assertPackageMaySubmit(authorization: SubmissionAuthorization, value: ConstructedEntryPackage) {
  assertOrderAccount(authorization, value.entry);
  assertOrderAccount(authorization, value.protection);
  if (value.submissionPolicy === "construction-only-auction") {
    throw new PaperSafetyError("Opening-auction submission is disabled pending approved non-live validation.", "AUCTION_UNVALIDATED");
  }
}

export function quoteWithinCap(direction: TradeDirection, quote: { bid: number; ask: number }, hardCap: number) {
  price(quote.bid, "Bid");
  price(quote.ask, "Ask");
  price(hardCap, "Hard cap");
  if (quote.bid > quote.ask) throw new Error("Quote is crossed.");
  return direction === "Long" ? quote.ask <= hardCap : quote.bid >= hardCap;
}

export type EquitySnapshot = Readonly<{
  accountId: string;
  netLiquidation: number;
  currency: string;
  observedAt: string;
  connectionId: string;
}>;

export function acceptEquitySnapshot(authorization: SubmissionAuthorization, snapshot: EquitySnapshot) {
  if (snapshot.accountId !== authorization.accountId || snapshot.connectionId !== authorization.connectionId) throw new PaperSafetyError("Equity snapshot is not valid for this verified session.", "ACCOUNT_MISMATCH");
  if (!Number.isFinite(snapshot.netLiquidation) || snapshot.netLiquidation <= 0) throw new Error("Net liquidation must be positive.");
  assertDate(snapshot.observedAt, "Equity observation time");
  requiredText(snapshot.currency, "Equity currency");
  return snapshot;
}

export type ProtectionState = "staged" | "working" | "retry-required" | "unprotected";
export type ManagedOrderState = Readonly<{
  requestedQuantity: number;
  filledQuantity: number;
  entryComplete: boolean;
  protectionQuantity: number;
  protectionState: ProtectionState;
  protectionAttempts: number;
  targetsActive: boolean;
  lifecycle: "Pending entry" | "Partially filled" | "Open" | "Unprotected" | "Sync pending";
  audit: string[];
}>;

export function initialManagedOrderState(requestedQuantity: number): ManagedOrderState {
  return {
    requestedQuantity: wholeShares(requestedQuantity),
    filledQuantity: 0,
    entryComplete: false,
    protectionQuantity: 0,
    protectionState: "staged",
    protectionAttempts: 0,
    targetsActive: false,
    lifecycle: "Pending entry",
    audit: [],
  };
}

export function applyEntryFill(state: ManagedOrderState, cumulativeFilled: number, brokerProtectionQuantity: number, entryComplete = false): ManagedOrderState {
  if (![cumulativeFilled, brokerProtectionQuantity].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Fill and protection quantities must be non-negative whole shares.");
  if (cumulativeFilled < state.filledQuantity || cumulativeFilled > state.requestedQuantity) throw new Error("Cumulative fill is inconsistent.");
  if (brokerProtectionQuantity > cumulativeFilled) throw new Error("Protection cannot exceed the confirmed fill.");
  const complete = entryComplete || cumulativeFilled === state.requestedQuantity;
  const protectedInFull = cumulativeFilled > 0 && brokerProtectionQuantity === cumulativeFilled;
  return {
    ...state,
    filledQuantity: cumulativeFilled,
    entryComplete: complete,
    protectionQuantity: brokerProtectionQuantity,
    protectionState: protectedInFull ? "working" : "staged",
    targetsActive: complete && protectedInFull,
    lifecycle: cumulativeFilled === 0 ? "Pending entry" : complete && protectedInFull ? "Open" : "Partially filled",
    audit: [...state.audit, `fill:${cumulativeFilled};protection:${brokerProtectionQuantity};complete:${complete}`],
  };
}

export function rejectProtection(state: ManagedOrderState): { state: ManagedOrderState; action: "retry-stop" | "show-unprotected" } {
  if (state.filledQuantity <= 0) throw new Error("Protection failure requires a confirmed fill.");
  const attempts = state.protectionAttempts + 1;
  if (attempts === 1) return {
    action: "retry-stop",
    state: { ...state, protectionAttempts: attempts, protectionState: "retry-required", targetsActive: false, audit: [...state.audit, "protection-rejected:retry"] },
  };
  return {
    action: "show-unprotected",
    state: { ...state, protectionAttempts: attempts, protectionState: "unprotected", targetsActive: false, lifecycle: "Unprotected", audit: [...state.audit, "protection-rejected:unprotected"] },
  };
}

export function activateFinalExits(state: ManagedOrderState, brokerProtectionQuantity: number) {
  if (!state.entryComplete) throw new Error("Targets remain staged until the entry completes or its remainder is final.");
  if (brokerProtectionQuantity !== state.filledQuantity) throw new Error("Every filled share must have broker-confirmed protection before targets activate.");
  return { ...state, protectionQuantity: brokerProtectionQuantity, protectionState: "working" as const, targetsActive: true, lifecycle: "Open" as const };
}

export function breakevenProtection(direction: TradeDirection, actualAverageEntry: number, currentStop: number) {
  price(actualAverageEntry, "Actual average entry");
  price(currentStop, "Current stop");
  return direction === "Long" ? Math.max(currentStop, actualAverageEntry) : Math.min(currentStop, actualAverageEntry);
}

export function allocateTargetPlan(totalQuantity: number, percentages: number[] = [35, 35, 30]) {
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity <= 0) throw new Error("Final filled quantity must be positive whole shares.");
  if (percentages.length < 2 || percentages.length > 3 || percentages.some(value => !Number.isFinite(value) || value < 0) || Math.abs(percentages.reduce((sum, value) => sum + value, 0) - 100) > 1e-9) {
    throw new Error("One or two targets plus a runner must total 100%.");
  }
  const quantities = percentages.map(value => Math.floor(totalQuantity * value / 100));
  const remainders = percentages.map((value, index) => ({ index, remainder: totalQuantity * value / 100 - quantities[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  const remaining = totalQuantity - quantities.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index += 1) quantities[remainders[index].index] += 1;
  return quantities;
}

export type RunnerMode = "SMA10" | "SMA20" | "SMA50" | "Day extreme" | "Dollar" | "Percentage" | "Manual";

export function runnerStop(input: {
  direction: TradeDirection;
  mode: RunnerMode;
  lastPrice: number;
  sma10?: number;
  sma20?: number;
  sma50?: number;
  dayLow?: number;
  dayHigh?: number;
  dollarTrail?: number;
  percentageTrail?: number;
  manualStop?: number;
}) {
  price(input.lastPrice, "Last price");
  const selected = input.mode === "SMA10" ? input.sma10
    : input.mode === "SMA20" ? input.sma20
      : input.mode === "SMA50" ? input.sma50
        : input.mode === "Day extreme" ? (input.direction === "Long" ? input.dayLow : input.dayHigh)
          : input.mode === "Manual" ? input.manualStop
            : input.mode === "Dollar" ? input.lastPrice + (input.direction === "Long" ? -1 : 1) * price(input.dollarTrail ?? 0, "Dollar trail")
              : input.lastPrice * (1 + (input.direction === "Long" ? -1 : 1) * price(input.percentageTrail ?? 0, "Percentage trail") / 100);
  return price(selected ?? 0, `${input.mode} runner stop`);
}

export type SubmissionRecord = Readonly<{
  idempotencyKey: string;
  brokerOrderId?: string;
  state: "prepared" | "accepted" | "sync-pending" | "warning" | "rejected";
  warning?: string;
}>;

export function beginSubmission(records: ReadonlyMap<string, SubmissionRecord>, idempotencyKey: string) {
  const key = requiredText(idempotencyKey, "Idempotency key");
  const existing = records.get(key);
  if (existing) return { record: existing, shouldSubmit: false };
  return { record: { idempotencyKey: key, state: "prepared" } as SubmissionRecord, shouldSubmit: true };
}

export function markSubmissionTimeout(record: SubmissionRecord): SubmissionRecord {
  return { ...record, state: "sync-pending" };
}

export function reconcileSubmission(record: SubmissionRecord, brokerOrderId: string | undefined): { record: SubmissionRecord; mayRetry: boolean } {
  if (record.state !== "sync-pending") throw new Error("Only a timed-out submission can be reconciled.");
  return brokerOrderId
    ? { record: { ...record, state: "accepted", brokerOrderId: requiredText(brokerOrderId, "Broker order ID") }, mayRetry: false }
    : { record: { ...record, state: "prepared", brokerOrderId: undefined }, mayRetry: true };
}

export function receivePrecautionaryWarning(record: SubmissionRecord, warning: string): SubmissionRecord {
  return { ...record, state: "warning", warning: requiredText(warning, "Broker warning") };
}

export function resolvePrecautionaryWarning(record: SubmissionRecord, decision: "confirm" | "cancel"): SubmissionRecord {
  if (record.state !== "warning") throw new Error("There is no broker warning to resolve.");
  return { ...record, state: decision === "confirm" ? "prepared" : "rejected", warning: record.warning };
}

export type BrokerPositionSnapshot = Readonly<{
  accountId: string;
  symbol: string;
  quantity: number;
  observedAt: string;
}>;

export function reconcileBrokerPosition(input: {
  authorization: SubmissionAuthorization;
  localQuantity: number;
  broker: BrokerPositionSnapshot;
}) {
  if (input.broker.accountId !== input.authorization.accountId) throw new PaperSafetyError("Position belongs to an unexpected account.", "ACCOUNT_MISMATCH");
  if (![input.localQuantity, input.broker.quantity].every(value => Number.isSafeInteger(value))) throw new Error("Position quantities must be whole shares.");
  assertDate(input.broker.observedAt, "Position observation time");
  const delta = input.broker.quantity - input.localQuantity;
  return {
    quantity: input.broker.quantity,
    changedInIbkr: delta !== 0,
    externalEffect: delta === 0 ? "none" as const : delta > 0 ? "entry" as const : "exit" as const,
    externalQuantity: Math.abs(delta),
    campaignClosed: input.broker.quantity === 0 && input.localQuantity !== 0,
  };
}

export type PlanningPrice = Readonly<{
  value: number;
  source: "IBKR quote" | "Local EOD close";
  observedAt: string;
  sessionDate?: string;
  executable: boolean;
}>;

export function planningPrice(input: {
  quote?: { midpoint: number; observedAt: string };
  eod?: { close: number; observedAt: string; sessionDate: string };
}): PlanningPrice {
  if (input.quote) {
    price(input.quote.midpoint, "Quote midpoint");
    assertDate(input.quote.observedAt, "Quote observation time");
    return { value: input.quote.midpoint, source: "IBKR quote", observedAt: input.quote.observedAt, executable: true };
  }
  if (input.eod) {
    price(input.eod.close, "EOD close");
    assertDate(input.eod.observedAt, "EOD observation time");
    requiredText(input.eod.sessionDate, "EOD session date");
    return { value: input.eod.close, source: "Local EOD close", observedAt: input.eod.observedAt, sessionDate: input.eod.sessionDate, executable: false };
  }
  throw new Error("No valid planning price is available; do not fabricate one.");
}

/** Raw TWS vocabulary terminates at this injected transport boundary. */
export interface TwsPaperTransport {
  connect(config: Pick<PaperGatewayConfig, "host" | "port" | "clientId">): Promise<{ managedAccounts: string[]; connectedAt: string }>;
  placeBracket(value: ConstructedEntryPackage): Promise<{ entryOrderId: string; protectionOrderId: string; status: string }>;
  findOrderByReference(orderRef: string): Promise<{ orderId: string; status: string } | undefined>;
}

export class IbkrPaperAdapter {
  #authorization?: SubmissionAuthorization;
  readonly #submissions = new Map<string, SubmissionRecord>();

  constructor(
    readonly config: PaperGatewayConfig,
    readonly verification: OperatorVerification | undefined,
    readonly transport: TwsPaperTransport,
  ) {}

  get authorization() { return this.#authorization; }
  get submissions() { return new Map(this.#submissions); }

  async connect() {
    this.#authorization = undefined;
    const observation = await this.transport.connect(this.config);
    this.#authorization = verifyPaperConnection(this.config, this.verification, observation);
    return this.#authorization;
  }

  disconnect() {
    this.#authorization = undefined;
  }

  async submit(value: ConstructedEntryPackage) {
    const authorization = this.#authorization;
    if (!authorization) throw new PaperSafetyError("A currently verified connection is required.", "VERIFICATION_REQUIRED");
    if (!this.config.submissionsEnabled) throw new PaperSafetyError("Paper order submission is disabled by default.", "SUBMISSION_DISABLED");
    assertPackageMaySubmit(authorization, value);
    const started = beginSubmission(this.#submissions, value.entry.orderRef);
    if (!started.shouldSubmit) return started.record;
    this.#submissions.set(value.entry.orderRef, started.record);
    try {
      const bracket = await this.transport.placeBracket(value);
      const record: SubmissionRecord = { idempotencyKey: value.entry.orderRef, brokerOrderId: bracket.entryOrderId, state: "accepted" };
      this.#submissions.set(value.entry.orderRef, record);
      return { ...record, protectionOrderId: bracket.protectionOrderId };
    } catch (error) {
      const record: SubmissionRecord = error instanceof BrokerSubmissionUncertainError
        ? markSubmissionTimeout(started.record)
        : { ...started.record, state: "rejected" };
      this.#submissions.set(value.entry.orderRef, record);
      throw error;
    }
  }

  async reconcileTimedOut(idempotencyKey: string) {
    const existing = this.#submissions.get(idempotencyKey);
    if (!existing) throw new Error("Unknown submission.");
    const broker = await this.transport.findOrderByReference(idempotencyKey);
    const result = reconcileSubmission(existing, broker?.orderId);
    this.#submissions.set(idempotencyKey, result.record);
    return result;
  }
}

export const PAPER_EXECUTION_SCHEMA_VERSION = 1 as const;

export type PaperExecutionStatus =
  | "Draft"
  | "Validated intent"
  | "Submitting"
  | "Broker acknowledged"
  | "Partially filled"
  | "Filled"
  | "Partially exited"
  | "Closed"
  | "Rejected"
  | "Cancellation pending"
  | "Cancelled"
  | "Unprotected"
  | "Unknown submission"
  | "Reconciliation required";

export type PaperExecutionFill = Readonly<{
  executionId: string;
  orderId: string;
  effect: "entry" | "exit";
  role: "entry" | "target" | "stop" | "runner" | "manual";
  quantity: number;
  price: number;
  fee: number;
  occurredAt: string;
}>;

export type ValidatedPaperIntent = Readonly<{
  schemaVersion: typeof PAPER_EXECUTION_SCHEMA_VERSION;
  intentId: string;
  idempotencyKey: string;
  planId: string;
  campaignId: string;
  accountBinding: string;
  instrumentIdentity: string;
  symbol: string;
  direction: TradeDirection;
  session: TradingSessionMode;
  sessionPolicy: ExecutionSessionPolicy;
  createdAt: string;
  quoteObservedAt: string;
  quoteSide: "ask" | "bid";
  executableQuote: number;
  planningPrice: number;
  maximumPriceDriftPercent: number;
  minTick: number;
  package: ConstructedEntryPackage;
  exitPlanSnapshot: unknown;
}>;

export type PaperExecutionRecord = Readonly<{
  schemaVersion: typeof PAPER_EXECUTION_SCHEMA_VERSION;
  intent: ValidatedPaperIntent;
  status: PaperExecutionStatus;
  revision: number;
  updatedAt: string;
  brokerOrderIds: Readonly<{
    entry?: string;
    protection?: string;
    exits: readonly string[];
  }>;
  entryFinal: boolean;
  cancellationRequested: boolean;
  requestedQuantity: number;
  enteredQuantity: number;
  exitedQuantity: number;
  openQuantity: number;
  actualAverageEntry?: number;
  executionRiskPerShare?: number;
  executionRiskFrozenAt?: string;
  protection: Readonly<{
    requestedQuantity: number;
    confirmedQuantity: number;
    state: "staged" | "requested" | "working" | "unknown" | "retry-required" | "unprotected";
    attempts: number;
  }>;
  advancedExitsActive: boolean;
  automationAvailability: "available" | "offline" | "not-active";
  thresholdTouches: readonly Readonly<{ ruleId: string; quote: number; observedAt: string; deferred: boolean }>[];
  fills: readonly PaperExecutionFill[];
  reconciliationReason?: string;
  rejectionReason?: string;
  audit: readonly string[];
}>;

export type BrokerReadinessObservation = Readonly<{
  contract: StockContract & Readonly<{ minimumTick: number }>;
  quote: Readonly<{ bid: number; ask: number; observedAt: string }>;
  executableQuote: number;
  quoteSide: "ask" | "bid";
  priceDriftPercent: number;
}>;

function wholeNonNegative(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative whole shares.`);
  return value;
}

function iso(value: string, field: string) {
  assertDate(value, field);
  return value;
}

function nextExecutionRecord(
  record: PaperExecutionRecord,
  patch: Partial<PaperExecutionRecord>,
  audit: string,
  updatedAt: string,
): PaperExecutionRecord {
  iso(updatedAt, "Execution update time");
  return { ...record, ...patch, revision: record.revision + 1, updatedAt, audit: [...record.audit, audit] };
}

export function validateBrokerReadiness(input: {
  contract: StockContract & Readonly<{ minimumTick: number }>;
  expectedSymbol: string;
  direction: TradeDirection;
  planningPrice: number;
  quote: { bid: number; ask: number; observedAt: string };
  now: string;
  maximumQuoteAgeMs: number;
  maximumPriceDriftPercent: number;
}): BrokerReadinessObservation {
  validateStockContract(input.contract);
  if (input.contract.symbol.toUpperCase() !== requiredText(input.expectedSymbol, "Expected symbol").toUpperCase()) throw new Error("Qualified broker symbol does not match the saved plan.");
  const nowMs = Date.parse(iso(input.now, "Validation time"));
  const quoteMs = Date.parse(iso(input.quote.observedAt, "Quote observation time"));
  if (!Number.isFinite(input.maximumQuoteAgeMs) || input.maximumQuoteAgeMs <= 0) throw new Error("Quote age limit must be positive.");
  if (quoteMs > nowMs + 1_000 || nowMs - quoteMs > input.maximumQuoteAgeMs) throw new Error("Executable quote is stale; refresh before validating the intent.");
  const planningPrice = price(input.planningPrice, "Captured planning price");
  const executableQuote = input.direction === "Long" ? price(input.quote.ask, "Ask") : price(input.quote.bid, "Bid");
  if (input.quote.bid > input.quote.ask) throw new Error("Quote is crossed.");
  if (!Number.isFinite(input.maximumPriceDriftPercent) || input.maximumPriceDriftPercent < 0) throw new Error("Price drift limit cannot be negative.");
  const priceDriftPercent = Math.abs(executableQuote - planningPrice) / planningPrice * 100;
  if (priceDriftPercent > input.maximumPriceDriftPercent + 1e-9) throw new Error(`Price drift ${priceDriftPercent.toFixed(2)}% exceeds the approved ${input.maximumPriceDriftPercent.toFixed(2)}% limit.`);
  price(input.contract.minimumTick, "Minimum tick");
  return { contract: input.contract, quote: input.quote, executableQuote, quoteSide: input.direction === "Long" ? "ask" : "bid", priceDriftPercent };
}

/**
 * Creates the immutable intent that must be durably stored before submit.
 * Account proof remains the private configuration binding; the browser never
 * receives or stores the full account identifier.
 */
export function validatePaperIntent(input: {
  intentId: string;
  idempotencyKey: string;
  planId: string;
  campaignId: string;
  accountBinding: string;
  instrumentIdentity: string;
  symbol: string;
  direction: TradeDirection;
  planningPrice: number;
  quote: { bid: number; ask: number; observedAt: string };
  now: string;
  maximumQuoteAgeMs: number;
  maximumPriceDriftPercent: number;
  minTick: number;
  package: ConstructedEntryPackage;
  exitPlanSnapshot: unknown;
}): PaperExecutionRecord {
  const readiness = validateBrokerReadiness({
    contract: { ...input.package.contract, minimumTick: input.minTick }, expectedSymbol: input.symbol,
    direction: input.direction, planningPrice: input.planningPrice, quote: input.quote, now: input.now,
    maximumQuoteAgeMs: input.maximumQuoteAgeMs, maximumPriceDriftPercent: input.maximumPriceDriftPercent,
  });
  const { executableQuote } = readiness;
  const planningPrice = input.planningPrice;
  const minTick = input.minTick;
  for (const [label, value] of [["Entry cap", input.package.entry.lmtPrice], ["Protection stop", input.package.protection.auxPrice]] as const) {
    const ticks = value / minTick;
    if (Math.abs(ticks - Math.round(ticks)) > 1e-7) throw new Error(`${label} does not conform to the broker minimum tick.`);
  }
  if (input.package.protection.orderType === "STP LMT") validateStopLimitProtection(input.direction, input.package.protection.auxPrice, input.package.protection.lmtPrice ?? 0, minTick);
  if (input.package.contract.conId.toString() !== requiredText(input.instrumentIdentity, "Instrument identity")) throw new Error("Qualified broker contract identity changed during validation.");
  const quantity = wholeShares(input.package.entry.totalQuantity);
  if (input.package.protection.totalQuantity !== quantity) throw new Error("Initial protection must cover the complete requested entry quantity.");
  const sessionPolicy = input.package.sessionPolicy ?? resolveExecutionSession({ mode: "Regular", duration: "DAY", protectionOrderType: "STP", protectionStopPrice: input.package.protection.auxPrice });
  if (!sessionPolicy.submissionEligible) throw new Error(sessionPolicy.blockedReason ?? "The selected trading session is not eligible for submission.");
  const intent: ValidatedPaperIntent = {
    schemaVersion: PAPER_EXECUTION_SCHEMA_VERSION,
    intentId: requiredText(input.intentId, "Intent ID"),
    idempotencyKey: requiredText(input.idempotencyKey, "Idempotency key"),
    planId: requiredText(input.planId, "Plan ID"),
    campaignId: requiredText(input.campaignId, "Campaign ID"),
    accountBinding: requiredText(input.accountBinding, "Private account binding"),
    instrumentIdentity: input.instrumentIdentity,
    symbol: requiredText(input.symbol, "Symbol").toUpperCase(),
    direction: input.direction,
    session: sessionPolicy.mode,
    sessionPolicy,
    createdAt: input.now,
    quoteObservedAt: input.quote.observedAt,
    quoteSide: readiness.quoteSide,
    executableQuote,
    planningPrice,
    maximumPriceDriftPercent: input.maximumPriceDriftPercent,
    minTick,
    package: input.package,
    exitPlanSnapshot: structuredClone(input.exitPlanSnapshot),
  };
  return {
    schemaVersion: PAPER_EXECUTION_SCHEMA_VERSION,
    intent,
    status: "Validated intent",
    revision: 1,
    updatedAt: input.now,
    brokerOrderIds: { exits: [] },
    entryFinal: false,
    cancellationRequested: false,
    requestedQuantity: quantity,
    enteredQuantity: 0,
    exitedQuantity: 0,
    openQuantity: 0,
    protection: { requestedQuantity: quantity, confirmedQuantity: 0, state: "staged", attempts: 0 },
    advancedExitsActive: false,
    automationAvailability: "not-active",
    thresholdTouches: [],
    fills: [],
    audit: ["intent:validated-and-ready-for-durable-persistence"],
  };
}

export function markIntentSubmitting(record: PaperExecutionRecord, updatedAt: string) {
  if (record.status !== "Validated intent") throw new Error("Only a validated intent may begin submission.");
  return nextExecutionRecord(record, { status: "Submitting", protection: { ...record.protection, state: "requested" } }, "submission:begun-after-persistence", updatedAt);
}

export function acknowledgePaperBracket(record: PaperExecutionRecord, input: { entryOrderId: string; protectionOrderId: string; acknowledgedAt: string }) {
  if (!(["Submitting", "Unknown submission", "Reconciliation required"] as PaperExecutionStatus[]).includes(record.status)) throw new Error("Bracket acknowledgement does not match the current lifecycle.");
  return nextExecutionRecord(record, {
    status: record.enteredQuantity > 0 ? (record.entryFinal ? "Filled" : "Partially filled") : "Broker acknowledged",
    brokerOrderIds: { ...record.brokerOrderIds, entry: requiredText(input.entryOrderId, "Entry order ID"), protection: requiredText(input.protectionOrderId, "Protection order ID") },
    reconciliationReason: undefined,
  }, "broker:bracket-acknowledged", input.acknowledgedAt);
}

export function markPaperSubmissionUnknown(record: PaperExecutionRecord, reason: string, updatedAt: string) {
  if (!(["Submitting", "Validated intent"] as PaperExecutionStatus[]).includes(record.status)) throw new Error("Only an in-flight submission may become unknown.");
  return nextExecutionRecord(record, { status: "Unknown submission", reconciliationReason: requiredText(reason, "Unknown-submission reason"), protection: { ...record.protection, state: "unknown" } }, "submission:unknown-reconcile-before-retry", updatedAt);
}

export function rejectPaperIntent(record: PaperExecutionRecord, reason: string, updatedAt: string) {
  if (record.enteredQuantity > 0) throw new Error("A filled order cannot be represented as an entry rejection.");
  return nextExecutionRecord(record, { status: "Rejected", rejectionReason: requiredText(reason, "Rejection reason"), advancedExitsActive: false }, "broker:entry-rejected", updatedAt);
}

export function requestPaperCancellation(record: PaperExecutionRecord, updatedAt: string) {
  if (record.entryFinal || (["Closed", "Cancelled", "Rejected"] as PaperExecutionStatus[]).includes(record.status)) throw new Error("The entry remainder is not cancellable.");
  return nextExecutionRecord(record, { status: "Cancellation pending", cancellationRequested: true }, "cancel:requested-not-confirmed", updatedAt);
}

export function confirmPaperCancellation(record: PaperExecutionRecord, updatedAt: string) {
  if (!record.cancellationRequested) throw new Error("No cancellation request is pending.");
  const entryFinal = true;
  const status: PaperExecutionStatus = record.enteredQuantity === 0 ? "Cancelled" : "Filled";
  const fullyProtected = record.enteredQuantity > 0 && record.protection.confirmedQuantity === record.openQuantity;
  return nextExecutionRecord(record, {
    status,
    entryFinal,
    advancedExitsActive: fullyProtected,
    automationAvailability: fullyProtected ? "available" : "not-active",
  }, "cancel:confirmed-entry-phase-final", updatedAt);
}

export function expirePaperEntry(record: PaperExecutionRecord, updatedAt: string) {
  if (record.entryFinal || (["Closed", "Cancelled", "Rejected"] as PaperExecutionStatus[]).includes(record.status)) throw new Error("The entry is already final.");
  const fullyProtected = record.enteredQuantity > 0 && record.protection.confirmedQuantity === record.openQuantity;
  return nextExecutionRecord(record, {
    status: record.enteredQuantity === 0 ? "Cancelled" : fullyProtected ? "Filled" : "Unprotected",
    entryFinal: true,
    advancedExitsActive: fullyProtected,
    automationAvailability: fullyProtected ? "available" : "not-active",
    reconciliationReason: fullyProtected ? undefined : record.enteredQuantity > 0 ? "The entry expired with confirmed shares that lack complete broker protection." : undefined,
  }, "session:entry-expired-no-recreate", updatedAt);
}

export function paperProtectionDisplay(record: PaperExecutionRecord, input: { sessionEligible: boolean; connected: boolean; triggeredUnfilled?: boolean }) {
  if (record.protection.state === "unknown") return { state: "unknown" as const, label: "Protection status unknown · reconcile before retry" };
  if (record.protection.state === "unprotected" || record.protection.confirmedQuantity < record.openQuantity) return { state: "inactive" as const, label: "Inactive protection · confirmed open quantity is not fully covered" };
  if (input.triggeredUnfilled) return { state: "triggered-unfilled" as const, label: "Triggered stop-limit · unfilled quantity remains exposed" };
  if (!input.sessionEligible) return { state: "inactive" as const, label: "Broker acknowledged protection · inactive in the current session" };
  if (!input.connected) return { state: "broker-held" as const, label: "Broker-held protection eligible · Brontide automation offline" };
  return { state: "eligible" as const, label: "Broker acknowledged and currently eligible" };
}

function weightedEntry(record: PaperExecutionRecord, fill: PaperExecutionFill) {
  const previousNotional = (record.actualAverageEntry ?? 0) * record.enteredQuantity;
  return (previousNotional + fill.price * fill.quantity) / (record.enteredQuantity + fill.quantity);
}

export function ingestPaperExecution(record: PaperExecutionRecord, fill: PaperExecutionFill, updatedAt = fill.occurredAt): { record: PaperExecutionRecord; duplicate: boolean } {
  requiredText(fill.executionId, "Execution ID");
  requiredText(fill.orderId, "Order ID");
  wholeShares(fill.quantity);
  price(fill.price, "Execution price");
  if (!Number.isFinite(fill.fee) || fill.fee < 0) throw new Error("Execution fee cannot be negative.");
  iso(fill.occurredAt, "Execution time");
  const existing = record.fills.find(item => item.executionId === fill.executionId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(fill)) return { record: nextExecutionRecord(record, { status: "Reconciliation required", reconciliationReason: "Conflicting payloads share one broker execution ID." }, "execution:identity-conflict", updatedAt), duplicate: false };
    return { record, duplicate: true };
  }
  if (fill.effect === "entry") {
    if (fill.role !== "entry" || record.entryFinal || record.enteredQuantity + fill.quantity > record.requestedQuantity) throw new Error("Entry execution is inconsistent with the validated intent.");
    const enteredQuantity = record.enteredQuantity + fill.quantity;
    const openQuantity = record.openQuantity + fill.quantity;
    const entryFinal = enteredQuantity === record.requestedQuantity;
    const fullyProtected = record.protection.confirmedQuantity === openQuantity;
    return { duplicate: false, record: nextExecutionRecord(record, {
      status: entryFinal ? "Filled" : "Partially filled",
      enteredQuantity,
      openQuantity,
      entryFinal,
      actualAverageEntry: weightedEntry(record, fill),
      advancedExitsActive: entryFinal && fullyProtected,
      automationAvailability: entryFinal && fullyProtected ? "available" : "not-active",
      fills: [...record.fills, fill],
    }, `execution:entry:${fill.executionId}`, updatedAt) };
  }
  if (fill.quantity > record.openQuantity) throw new Error("Exit execution would over-close or reverse the position.");
  const exitedQuantity = record.exitedQuantity + fill.quantity;
  const openQuantity = record.openQuantity - fill.quantity;
  return { duplicate: false, record: nextExecutionRecord(record, {
    status: openQuantity === 0 ? "Closed" : "Partially exited",
    exitedQuantity,
    openQuantity,
    protection: { ...record.protection, confirmedQuantity: Math.min(record.protection.confirmedQuantity, openQuantity) },
    advancedExitsActive: openQuantity > 0 && record.advancedExitsActive,
    automationAvailability: openQuantity > 0 && record.advancedExitsActive ? record.automationAvailability : "not-active",
    fills: [...record.fills, fill],
  }, `execution:exit:${fill.executionId}`, updatedAt) };
}

export function confirmProtection(record: PaperExecutionRecord, confirmedQuantity: number, updatedAt: string) {
  wholeNonNegative(confirmedQuantity, "Confirmed protection quantity");
  if (confirmedQuantity > record.openQuantity) throw new Error("Protection cannot exceed confirmed open quantity.");
  const complete = record.openQuantity > 0 && confirmedQuantity === record.openQuantity;
  return nextExecutionRecord(record, {
    protection: { ...record.protection, confirmedQuantity, state: complete ? "working" : "requested" },
    advancedExitsActive: record.entryFinal && complete,
    automationAvailability: record.entryFinal && complete ? "available" : "not-active",
  }, `protection:confirmed:${confirmedQuantity}`, updatedAt);
}

export function markProtectionUnknown(record: PaperExecutionRecord, reason: string, updatedAt: string) {
  return nextExecutionRecord(record, { status: "Reconciliation required", reconciliationReason: requiredText(reason, "Protection uncertainty"), protection: { ...record.protection, state: "unknown" }, advancedExitsActive: false, automationAvailability: "not-active" }, "protection:unknown-no-retry", updatedAt);
}

export function rejectProtectionWithSingleRetry(record: PaperExecutionRecord, updatedAt: string) {
  if (record.openQuantity <= 0) throw new Error("Protection rejection requires a confirmed open position.");
  const attempts = record.protection.attempts + 1;
  return nextExecutionRecord(record, {
    status: attempts === 1 ? "Reconciliation required" : "Unprotected",
    reconciliationReason: attempts === 1 ? "Initial stop rejected; one retry is required after broker reconciliation." : "Protective stop retry rejected; position is unprotected.",
    protection: { ...record.protection, attempts, state: attempts === 1 ? "retry-required" : "unprotected" },
    advancedExitsActive: false,
    automationAvailability: "not-active",
  }, attempts === 1 ? "protection:retry-required" : "protection:unprotected", updatedAt);
}

export function freezePaperExecutionRisk(record: PaperExecutionRecord, initialStop: number, frozenAt: string) {
  if (!record.entryFinal || record.actualAverageEntry == null) throw new Error("Execution R freezes only after the entry quantity is final.");
  const stop = price(initialStop, "Execution risk stop");
  if (record.intent.direction === "Long" ? stop >= record.actualAverageEntry : stop <= record.actualAverageEntry) throw new Error("Execution risk stop is on the wrong side of the actual average entry.");
  const executionRiskPerShare = Math.abs(record.actualAverageEntry - stop);
  return nextExecutionRecord(record, { executionRiskPerShare, executionRiskFrozenAt: iso(frozenAt, "Execution R freeze time") }, `execution-r:frozen:${executionRiskPerShare}`, frozenAt);
}

export type PaperAmendmentDraft = Readonly<{
  amendmentId: string;
  intentId: string;
  sourceRevision: number;
  sourceOpenQuantity: number;
  requestedExitPlan: unknown;
  sessionPolicy: ExecutionSessionPolicy;
  state: "unapplied" | "applying" | "broker-confirmed" | "rejected-stale" | "reconciliation-required";
  createdAt: string;
  updatedAt: string;
  brokerRevision?: string;
  error?: string;
}>;

export function createPaperAmendmentDraft(record: PaperExecutionRecord, input: { amendmentId: string; requestedExitPlan: unknown; createdAt: string }): PaperAmendmentDraft {
  if (record.openQuantity <= 0) throw new Error("Only an open confirmed position can be amended.");
  return {
    amendmentId: requiredText(input.amendmentId, "Amendment ID"),
    intentId: record.intent.intentId,
    sourceRevision: record.revision,
    sourceOpenQuantity: record.openQuantity,
    requestedExitPlan: structuredClone(input.requestedExitPlan),
    sessionPolicy: structuredClone(record.intent.sessionPolicy),
    state: "unapplied",
    createdAt: iso(input.createdAt, "Amendment creation time"),
    updatedAt: input.createdAt,
  };
}

export function beginPaperAmendment(record: PaperExecutionRecord, draft: PaperAmendmentDraft, updatedAt: string) {
  if (draft.state !== "unapplied") throw new Error("Only an unapplied amendment can be applied.");
  if (draft.intentId !== record.intent.intentId || draft.sourceRevision !== record.revision || draft.sourceOpenQuantity !== record.openQuantity) {
    return { ...draft, state: "rejected-stale" as const, updatedAt: iso(updatedAt, "Amendment update time"), error: "Position quantity or working-order revision changed. Rebuild the amendment from current broker state." };
  }
  return { ...draft, state: "applying" as const, updatedAt: iso(updatedAt, "Amendment update time"), error: undefined };
}

export function confirmPaperAmendment(draft: PaperAmendmentDraft, brokerRevision: string, updatedAt: string) {
  if (draft.state !== "applying") throw new Error("Broker confirmation requires an applying amendment.");
  return { ...draft, state: "broker-confirmed" as const, brokerRevision: requiredText(brokerRevision, "Broker revision"), updatedAt: iso(updatedAt, "Amendment confirmation time"), error: undefined };
}

export function markPaperAmendmentUnknown(draft: PaperAmendmentDraft, reason: string, updatedAt: string) {
  if (draft.state !== "applying") throw new Error("Only an applying amendment can require reconciliation.");
  return { ...draft, state: "reconciliation-required" as const, error: requiredText(reason, "Amendment reconciliation reason"), updatedAt: iso(updatedAt, "Amendment update time") };
}

export function setAutomationConnection(record: PaperExecutionRecord, connected: boolean, updatedAt: string) {
  if (!record.advancedExitsActive) return record;
  return nextExecutionRecord(record, { automationAvailability: connected ? "available" : "offline" }, connected ? "automation:online" : "automation:offline-warning", updatedAt);
}

export function recordDeferredThresholdTouch(record: PaperExecutionRecord, input: { ruleId: string; quote: number; observedAt: string }) {
  if (record.entryFinal) throw new Error("A finalized entry must evaluate a fresh quote instead of a historical touch.");
  price(input.quote, "Threshold quote");
  iso(input.observedAt, "Threshold observation time");
  return nextExecutionRecord(record, { thresholdTouches: [...record.thresholdTouches, { ...input, ruleId: requiredText(input.ruleId, "Rule ID"), deferred: true }] }, `threshold:${input.ruleId}:deferred`, input.observedAt);
}

export function reconcilePaperExecution(record: PaperExecutionRecord, input: {
  observedAt: string;
  foundEntryOrder: boolean;
  entryOrderId?: string;
  protectionOrderId?: string;
  brokerOpenQuantity: number;
  brokerProtectionQuantity: number;
  brokerWorkingExitQuantity: number;
}) {
  wholeNonNegative(input.brokerOpenQuantity, "Broker open quantity");
  wholeNonNegative(input.brokerProtectionQuantity, "Broker protection quantity");
  wholeNonNegative(input.brokerWorkingExitQuantity, "Broker working exit quantity");
  const discrepancies: string[] = [];
  if (input.brokerProtectionQuantity < input.brokerOpenQuantity) discrepancies.push("Broker protection does not cover every confirmed open share.");
  if (input.brokerProtectionQuantity > input.brokerOpenQuantity) discrepancies.push("Broker protection exceeds confirmed open shares.");
  if (input.brokerWorkingExitQuantity > input.brokerOpenQuantity) discrepancies.push("Working exits could over-close or reverse the position.");
  if (input.brokerOpenQuantity !== record.openQuantity) discrepancies.push("Broker and local open quantities differ; executions must be imported before resolution.");
  if (!input.foundEntryOrder && record.status === "Unknown submission" && record.enteredQuantity === 0) {
    return { record: nextExecutionRecord(record, { status: "Validated intent", reconciliationReason: undefined, protection: { ...record.protection, state: "staged" } }, "reconcile:no-economic-action-retry-permitted", input.observedAt), mayRetry: true, discrepancies };
  }
  const brokerOrderIds = input.foundEntryOrder ? {
    ...record.brokerOrderIds,
    entry: requiredText(input.entryOrderId ?? record.brokerOrderIds.entry ?? "", "Reconciled entry order ID"),
    protection: input.protectionOrderId ?? record.brokerOrderIds.protection,
  } : record.brokerOrderIds;
  const protectedInFull = input.brokerOpenQuantity > 0 && input.brokerProtectionQuantity === input.brokerOpenQuantity;
  const status = discrepancies.length ? "Reconciliation required" : record.enteredQuantity > 0 ? record.status : "Broker acknowledged";
  return {
    record: nextExecutionRecord(record, {
      status,
      brokerOrderIds,
      protection: { ...record.protection, confirmedQuantity: input.brokerProtectionQuantity, state: protectedInFull ? "working" : input.brokerOpenQuantity ? "unprotected" : record.protection.state },
      advancedExitsActive: record.entryFinal && protectedInFull && !discrepancies.length,
      automationAvailability: record.entryFinal && protectedInFull && !discrepancies.length ? "available" : "not-active",
      reconciliationReason: discrepancies.join(" ") || undefined,
    }, discrepancies.length ? "reconcile:required" : "reconcile:resolved", input.observedAt),
    mayRetry: false,
    discrepancies,
  };
}

export type PaperExecutionStore = Readonly<{ schemaVersion: typeof PAPER_EXECUTION_SCHEMA_VERSION; records: readonly PaperExecutionRecord[] }>;

export function readPaperExecutionStore(storage: Pick<Storage, "getItem">, key: string): { raw: string | null; store: PaperExecutionStore } {
  const raw = storage.getItem(key);
  if (!raw) return { raw: null, store: { schemaVersion: PAPER_EXECUTION_SCHEMA_VERSION, records: [] } };
  const parsed = JSON.parse(raw) as PaperExecutionStore;
  if (parsed.schemaVersion !== PAPER_EXECUTION_SCHEMA_VERSION || !Array.isArray(parsed.records)) throw new Error("Paper execution store is invalid; recovery is required before submission.");
  return { raw, store: parsed };
}

export function writePaperExecutionStore(storage: Pick<Storage, "getItem" | "setItem">, key: string, expectedRaw: string | null, store: PaperExecutionStore) {
  if (storage.getItem(key) !== expectedRaw) return { ok: false as const, error: "Paper execution records changed elsewhere. Reload and reconcile before continuing." };
  const raw = JSON.stringify(store);
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error("round-trip mismatch");
    return { ok: true as const, raw };
  } catch {
    return { ok: false as const, error: "Paper execution persistence failed. No submission is permitted until the intent is durably stored." };
  }
}

export function upsertPaperExecutionRecord(store: PaperExecutionStore, record: PaperExecutionRecord): PaperExecutionStore {
  const existing = store.records.find(item => item.intent.idempotencyKey === record.intent.idempotencyKey);
  if (existing && existing.intent.intentId !== record.intent.intentId) throw new Error("An economic action already uses this idempotency key.");
  if (existing && record.revision < existing.revision) throw new Error("A stale execution revision cannot replace newer broker state.");
  return { schemaVersion: PAPER_EXECUTION_SCHEMA_VERSION, records: [...store.records.filter(item => item.intent.idempotencyKey !== record.intent.idempotencyKey), record] };
}
