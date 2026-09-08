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

export type EntryMethod = "Normal" | "Breakout" | "Opening";

export type EntryTicket = Readonly<{
  account: string;
  action: "BUY" | "SELL";
  totalQuantity: number;
  orderType: "MIDPRICE" | "STP LMT" | "LMT";
  tif: "DAY" | "OPG";
  lmtPrice: number;
  auxPrice?: number;
  outsideRth: false;
  transmit: false;
  orderRef: string;
}>;

export type ProtectionTicket = Readonly<{
  account: string;
  action: "BUY" | "SELL";
  totalQuantity: number;
  orderType: "STP";
  tif: "GTC";
  auxPrice: number;
  outsideRth: false;
  transmit: true;
  parentRef: string;
  orderRef: string;
}>;

export type ConstructedEntryPackage = Readonly<{
  contract: StockContract;
  entry: EntryTicket;
  protection: ProtectionTicket;
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
  if (input.method === "Normal") {
    entry = { account, action, totalQuantity: quantity, orderType: "MIDPRICE", tif: "DAY", lmtPrice: hardCap, outsideRth: false, transmit: false, orderRef };
  } else if (input.method === "Breakout") {
    const triggerPrice = price(input.triggerPrice ?? 0, "Breakout trigger");
    if (input.direction === "Long" ? hardCap < triggerPrice : hardCap > triggerPrice) throw new Error("A stop-limit worst price cannot cross inside its trigger.");
    entry = { account, action, totalQuantity: quantity, orderType: "STP LMT", tif: "DAY", lmtPrice: hardCap, auxPrice: triggerPrice, outsideRth: false, transmit: false, orderRef };
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
      orderType: "STP",
      tif: "GTC",
      auxPrice: stopPrice,
      outsideRth: false,
      transmit: true,
      parentRef: orderRef,
      orderRef: `${orderRef}:protection`,
    },
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

export function applyOneRTargetFill(input: {
  confirmedFill: boolean;
  direction: TradeDirection;
  actualAverageEntry: number;
  currentStop: number;
}) {
  return input.confirmedFill
    ? { stop: breakevenProtection(input.direction, input.actualAverageEntry, input.currentStop), changed: true }
    : { stop: input.currentStop, changed: false };
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
