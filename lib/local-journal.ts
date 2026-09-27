/** Validated local recorded-history bridge to the shared Journal rows. */
import { paperJournalRow, type PaperCampaign } from "./paper-execution";
import { validateExitPlan, type ExitPlanDefinition, type ExitPlanLeg } from "./trading-domain";

const fixtureId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const fixtureBinding = /^fixture-[A-Za-z0-9-]{1,64}$/;
const privateScope = /^[0-9a-f]{64}$/;
const symbolPattern = /^[A-Z][A-Z0-9.]{0,9}$/;
const utcTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const states = new Set(["Pending entry", "Partially filled", "Open", "Closed", "Cancelled", "Closing", "Needs reconciliation", "Unprotected", "Paused", "Paused — submissions locked"]);

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
function check(valid: unknown, message: string): asserts valid { if (!valid) throw new Error(`Invalid local Journal history: ${message}`); }
// Match the synthetic Python boundary: finite values beyond this magnitude
// cannot be safely represented by the browser's shared Journal projection.
const number = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const positive = (value: unknown): value is number => number(value) && value > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === "string" && fixtureId.test(value);
function timestampMicros(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = utcTime.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const base = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`;
  const date = new Date(base);
  if (year < 1 || !Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second) return null;
  const micros = date.getTime() * 1000 + Number((parts[7] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(micros) ? micros : null;
}
const time = (value: unknown): value is string => timestampMicros(value) !== null;
function recordedMicros(value: string): number {
  const micros = timestampMicros(value);
  check(micros !== null, "timestamp precision");
  return micros;
}
const optionalNumber = (value: unknown): value is number | null => value === null || number(value);
const accountingNear = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9 + 32 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(expected));

function exitPlan(value: unknown): ExitPlanDefinition {
  check(object(value) && value.schemaVersion === 1 && typeof value.schemaVersion === "number" && Array.isArray(value.legs), "exit plan");
  const breakeven = value.breakeven;
  check(object(breakeven) && positive(breakeven.activationR) && object(breakeven.favorableOffset), "breakeven");
  const offset = breakeven.favorableOffset;
  check((offset.unit === "Dollar" || offset.unit === "R") && number(offset.value) && offset.value >= 0, "breakeven offset");
  const legs: ExitPlanLeg[] = value.legs.map((item: unknown) => {
    check(object(item) && id(item.id) && positive(item.allocationPercent), "exit leg");
    if (item.role === "Target") {
      check(object(item.target) && (item.target.mode === "R" || item.target.mode === "Price"), "target");
      return item.target.mode === "R"
        ? { id: item.id, role: "Target", allocationPercent: item.allocationPercent, target: { mode: "R", multipleR: requirePositive(item.target.multipleR, "target R") } }
        : { id: item.id, role: "Target", allocationPercent: item.allocationPercent, target: { mode: "Price", price: requirePositive(item.target.price, "target price") } };
    }
    check(item.role === "Runner" && positive(item.activationR) && object(item.trailing), "runner");
    const trailing = item.trailing;
    let rule: Extract<ExitPlanLeg, { role: "Runner" }>["trailing"];
    switch (trailing.mode) {
      case "SMA": check(trailing.period === 10 || trailing.period === 20 || trailing.period === 50, "SMA period"); rule = { mode: "SMA", period: trailing.period }; break;
      case "Day extreme": rule = { mode: "Day extreme" }; break;
      case "Dollar": rule = { mode: "Dollar", distance: requirePositive(trailing.distance, "trail distance") }; break;
      case "Percentage": rule = { mode: "Percentage", percent: requirePositive(trailing.percent, "trail percentage") }; break;
      case "Manual": rule = { mode: "Manual", stopPrice: requirePositive(trailing.stopPrice, "manual stop") }; break;
      default: throw new Error("Invalid synthetic Journal fixture: trailing rule");
    }
    return { id: item.id, role: "Runner", allocationPercent: item.allocationPercent, activationR: item.activationR, trailing: rule };
  });
  return validateExitPlan({ schemaVersion: 1, legs, breakeven: { activationR: breakeven.activationR, favorableOffset: { unit: offset.unit, value: offset.value } } });
}

function requirePositive(value: unknown, label: string): number {
  check(positive(value), label);
  return value;
}

type ProjectedRow = ReturnType<typeof paperJournalRow>;
export type SyntheticJournalRow = Omit<ProjectedRow, "journalSnapshot" | "executions"> & {
  journalSnapshot: Omit<NonNullable<ProjectedRow["journalSnapshot"]>, "provenance"> & { provenance: "Synthetic fixture" };
  executions: (Omit<ProjectedRow["executions"][number], "provenance"> & { provenance: "Synthetic fixture" })[];
  syntheticOnly: true;
  recordedOnly: true;
  currentExposure: null;
  ordersCleared: null;
  recordedOpenQuantity: number;
};

export type SyntheticJournalView = Readonly<{
  source: "synthetic-ledger-fixture";
  environment: "paper";
  connectionStatus: "not-connected";
  historyStatus: "recorded" | "no-records";
  lastRecordedAt: string | null;
  lastBrokerReconciledAt: null;
  currentExposure: null;
  ordersCleared: null;
  uncertainCommandCount: number;
  rows: SyntheticJournalRow[];
}>;

export type RecordedJournalRow = ProjectedRow & {
  recordedOnly: true;
  currentExposure: null;
  ordersCleared: null;
  recordedOpenQuantity: number;
};

export type RecordedJournalView = Readonly<{
  source: "recorded-local-ledger";
  scopeId: string;
  environment: "paper";
  connectionStatus: "not-connected";
  historyStatus: "recorded" | "no-records";
  lastRecordedAt: string | null;
  lastBrokerReconciledAt: null;
  currentExposure: null;
  ordersCleared: null;
  uncertainCommandCount: number;
  rows: RecordedJournalRow[];
}>;

/** Never combine these rows with demo or broker Journal history. */
export function adaptSyntheticJournal(value: unknown, expectedBinding: string): SyntheticJournalView {
  check(fixtureBinding.test(expectedBinding), "expected fixture binding");
  return adaptLocalJournal(value, "synthetic", expectedBinding) as SyntheticJournalView;
}

/** The local service has already authenticated and scoped this read to one confirmed paper account. */
export function adaptRecordedJournal(value: unknown): RecordedJournalView {
  return adaptLocalJournal(value, "recorded") as RecordedJournalView;
}

function adaptLocalJournal(value: unknown, kind: "synthetic" | "recorded", expectedBinding?: string): SyntheticJournalView | RecordedJournalView {
  const synthetic = kind === "synthetic";
  const prefix = synthetic ? "fixture" : "recorded";
  check(object(value) && value.source === (synthetic ? "synthetic-ledger-fixture" : "recorded-local-ledger") && value.environment === "paper"
    && value.executionEnabled === false && value.connectionStatus === "not-connected"
    && value.currentExposure === null && value.ordersCleared === null && value.lastBrokerReconciledAt === null
    && count(value.uncertainCommandCount) && Array.isArray(value.journalCampaigns) && Array.isArray(value.records), "history scope");
  if (!synthetic) check(typeof value.scopeId === "string" && privateScope.test(value.scopeId), "private paper scope");
  check(value.historyStatus === "recorded" || value.historyStatus === "no-records", "history status");
  const historyStatus = value.historyStatus;
  check(value.lastRecordedAt === null || time(value.lastRecordedAt), "last recorded timestamp");
  check((value.historyStatus === "no-records") === (value.journalCampaigns.length === 0), "history consistency");
  check(value.records.length === value.journalCampaigns.length, "record count");
  check(value.historyStatus === "recorded" || value.lastRecordedAt === null, "empty history timestamp");
  const records = value.records;
  const campaignIds = new Set<string>();
  const executionIds = new Set<string>();
  let latestRecorded = 0;
  let recordedBinding: string | null = null;
  const rows = value.journalCampaigns.map((raw: unknown, index: number): SyntheticJournalRow | RecordedJournalRow => {
    check(object(raw) && raw.syntheticOnly === synthetic && id(raw.id)
      && (synthetic ? raw.accountBinding === expectedBinding : typeof raw.accountBinding === "string" && /^[0-9a-f]{64}$/.test(raw.accountBinding))
      && typeof raw.symbol === "string" && symbolPattern.test(raw.symbol)
      && (raw.direction === "Long" || raw.direction === "Short")
      && typeof raw.state === "string" && states.has(raw.state)
      && time(raw.createdAt) && object(raw.contract) && count(raw.contract.conId) && raw.contract.conId > 0
      && raw.contract.currency === "USD" && object(raw.ticket) && object(raw.summary)
      && Array.isArray(raw.executions), "campaign scope");
    if (!synthetic) {
      if (recordedBinding === null) recordedBinding = raw.accountBinding as string;
      check(raw.accountBinding === recordedBinding, "mixed account bindings");
    }
    check(!campaignIds.has(raw.id), "duplicate campaign"); campaignIds.add(raw.id);
    const createdAt = raw.createdAt;
    const state = raw.state;
    const ticket = raw.ticket;
    check(id(ticket.planId) && positive(ticket.planningPrice) && positive(ticket.hardCap)
      && positive(ticket.stopPrice) && count(ticket.quantity) && ticket.quantity > 0, "ticket");
    const plan = exitPlan(ticket.exitPlan);
    const summary = raw.summary;
    check(count(summary.entered) && count(summary.exited) && count(summary.openQuantity)
      && summary.entered <= ticket.quantity && summary.exited <= summary.entered
      && summary.openQuantity === summary.entered - summary.exited
      && optionalNumber(summary.averageEntry) && optionalNumber(summary.grossRealized)
      && optionalNumber(summary.netRealized) && optionalNumber(summary.fees)
      && optionalNumber(summary.finalNetR) && optionalNumber(summary.initialRisk)
      && typeof summary.costsComplete === "boolean", "recorded summary");
    check(summary.costsComplete || (summary.fees === null && summary.netRealized === null && summary.finalNetR === null), "unknown fees");
    check(summary.grossRealized !== null || summary.entered === 0 || state === "Needs reconciliation", "accounting agreement");
    const executions = raw.executions.map((execution: unknown) => {
      check(object(execution) && id(execution.executionId) && count(execution.orderId) && execution.orderId > 0
        && (execution.effect === "entry" || execution.effect === "exit")
        && (synthetic ? ["entry", "stop", "target", "manual"] : ["entry", "stop", "target", "cleanup"]).includes(String(execution.role))
        && (execution.effect === "entry") === (execution.role === "entry")
        && count(execution.quantity) && execution.quantity > 0 && positive(execution.price)
        && time(execution.occurredAt) && (execution.commission === null || number(execution.commission)), "execution");
      check(!executionIds.has(execution.executionId), "duplicate execution"); executionIds.add(execution.executionId);
      return { executionId: execution.executionId, orderId: execution.orderId, effect: execution.effect as "entry" | "exit",
        role: execution.role as string, quantity: execution.quantity, price: execution.price, occurredAt: execution.occurredAt,
        commission: execution.commission as number | null };
    });
    check(executions.filter(e => e.effect === "entry").reduce((n,e) => n + e.quantity, 0) === summary.entered
      && executions.filter(e => e.effect === "exit").reduce((n,e) => n + e.quantity, 0) === summary.exited, "execution quantities");
    check(summary.costsComplete === (executions.length > 0 && executions.every(e => e.commission !== null)), "fee completeness");
    if (summary.costsComplete) {
      check(number(summary.fees), "accounting agreement");
      const executionFees = executions.reduce((total, execution) => total + execution.commission!, 0);
      check(accountingNear(summary.fees, executionFees), "accounting agreement");
      if (summary.grossRealized === null) {
        check(state === "Needs reconciliation" && summary.averageEntry === null
          && summary.initialRisk === null && summary.netRealized === null
          && summary.finalNetR === null, "accounting agreement");
      } else {
        check(number(summary.grossRealized) && number(summary.netRealized)
          && accountingNear(summary.netRealized, summary.grossRealized - summary.fees), "accounting agreement");
      }
    }
    check(raw.state !== "Closed" || (summary.entered > 0 && summary.openQuantity === 0), "closed quantity");
    check(raw.state !== "Pending entry" || summary.entered === 0, "pending quantity");
    check(!["Open", "Partially filled", "Unprotected"].includes(state) || summary.entered > 0, "open quantity");
    check(executions.every(e => recordedMicros(e.occurredAt) >= recordedMicros(createdAt)), "execution chronology");
    const byTime = new Map<number, { entries: number; exits: number }>();
    for (const execution of executions) {
      const instant = recordedMicros(execution.occurredAt);
      const group = byTime.get(instant) ?? { entries: 0, exits: 0 };
      if (execution.effect === "entry") group.entries += execution.quantity;
      else group.exits += execution.quantity;
      byTime.set(instant, group);
    }
    let held = 0;
    let exitedEarlier = false;
    let entryAfterExit = false;
    for (const instant of [...byTime.keys()].sort((a, b) => a - b)) {
      const group = byTime.get(instant)!;
      if (group.entries > 0 && (exitedEarlier || (group.exits > 0 && held > 0))) {
        entryAfterExit = true;
      }
      // An entry sharing an exit timestamp does not establish that the exit
      // followed it. Only previously recorded shares count as inventory.
      check(group.exits <= held, "exit precedes held inventory");
      held += group.entries - group.exits;
      if (group.exits > 0) exitedEarlier = true;
    }
    check(!entryAfterExit || state === "Needs reconciliation", "protection and allocations");
    const campaignRecorded = Math.max(recordedMicros(createdAt), ...executions.map(e => recordedMicros(e.occurredAt)));
    const record = records[index];
    check(object(record) && record.id === `${prefix}:${raw.id}` && record.campaignId === raw.id
      && record.symbol === raw.symbol && record.direction === raw.direction && record.state === raw.state
      && record.entered === summary.entered && record.exited === summary.exited
      && record.recordedOpenQuantity === summary.openQuantity && record.executionCount === executions.length
      && record.grossRealized === summary.grossRealized && record.fees === summary.fees
      && record.netRealized === summary.netRealized && record.finalNetR === summary.finalNetR
      && record.costsCompleteRecorded === summary.costsComplete && time(record.recordedAt)
      && recordedMicros(record.recordedAt) === campaignRecorded, "record agreement");
    latestRecorded = Math.max(latestRecorded, campaignRecorded);
    // paperJournalRow is the shared Journal projection. Only the fields it reads
    // are supplied; this cast is confined to the validated local-history boundary.
    const projectionInput = { id: raw.id, accountBinding: raw.accountBinding, symbol: raw.symbol,
      direction: raw.direction, state: raw.state, createdAt: raw.createdAt,
      contract: { conId: raw.contract.conId, currency: "USD" },
      ticket: { planId: ticket.planId, planningPrice: ticket.planningPrice, quantity: ticket.quantity,
        hardCap: ticket.hardCap, stopPrice: ticket.stopPrice, exitPlan: plan },
      summary: { entered: summary.entered, exited: summary.exited, openQuantity: summary.openQuantity,
        averageEntry: summary.averageEntry, grossRealized: summary.grossRealized, netRealized: summary.netRealized,
        fees: summary.fees, finalNetR: summary.finalNetR, initialRisk: summary.initialRisk,
        costsComplete: summary.costsComplete }, executions } as PaperCampaign;
    const projected = paperJournalRow(projectionInput);
    if (synthetic) return { ...projected, id: `fixture:${raw.id}`, provenance: "Synthetic fixture · recorded ledger",
      journalSnapshot: { ...projected.journalSnapshot!, instrumentId: `FIXTURE-STK:${raw.contract.conId}`,
        provenance: "Synthetic fixture" },
      executions: projected.executions.map(e => ({ ...e, provenance: "Synthetic fixture" })),
      syntheticOnly: true, recordedOnly: true, currentExposure: null, ordersCleared: null,
      recordedOpenQuantity: summary.openQuantity };
    return { ...projected, id: `recorded:${raw.id}`, provenance: "IBKR paper · recorded local history",
      recordedOnly: true, currentExposure: null, ordersCleared: null,
      recordedOpenQuantity: summary.openQuantity };
  });
  check(value.lastRecordedAt === null ? rows.length === 0 : recordedMicros(value.lastRecordedAt) === latestRecorded,
    "last recorded agreement");
  const common = { environment: "paper" as const, connectionStatus: "not-connected" as const,
    historyStatus, lastRecordedAt: value.lastRecordedAt,
    lastBrokerReconciledAt: null, currentExposure: null, ordersCleared: null,
    uncertainCommandCount: value.uncertainCommandCount } satisfies Omit<RecordedJournalView, "source" | "scopeId" | "rows">;
  if (synthetic) return { ...common, source: "synthetic-ledger-fixture", rows: rows as SyntheticJournalRow[] };
  return { ...common, source: "recorded-local-ledger", scopeId: value.scopeId as string,
    rows: rows as RecordedJournalRow[] };
}
