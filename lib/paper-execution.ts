import type { ExitPlanDefinition, TradeCampaign, Execution } from "./trading-domain";
import type { DemoPosition } from "./trading-demo";
import { allocateExitShares, type TrailingRule } from "./trading-domain";

export type PaperTicket = { planId: string; planRevision: string; planningSource?: string; symbol: string; direction: "Long" | "Short";
  method: "Limit" | "Normal" | "Breakout"; quantity: number; planningPrice: number; hardCap: number;
  triggerPrice?: number; stopPrice: number; cleanupFloor: number; sessionMode: string; duration: string;
  protectionOrderType: string; protectionLimitPrice?: number; exitPlan: ExitPlanDefinition };
export type PaperBatch = { id: string; digest: string; sourceIdentity: string; validUntil: string; tickets: PaperTicket[] };
export type PaperCampaign = { id: string; batchId: string; revision: number; symbol: string; direction: "Long" | "Short";
  state: string; message: string | null; automation: string; createdAt: string; accountBinding: string;
  contract: { conId: number; currency: string }; ticket: PaperTicket; activeExitPlan: ExitPlanDefinition;
  summary: { entered: number; exited: number; openQuantity: number; averageEntry: number | null;
    grossRealized: number | null; netRealized: number | null; fees: number | null; finalNetR: number | null; initialRisk: number | null; costsComplete: boolean };
  slots: { id: string; open: number; entryStatus: string; stopStatus: string; confirmedStop: number | null;
    whyHeld: string; exitStatus: string | null; exitPrice: number | null; leg: (ExitPlanDefinition["legs"][number] & { quantity: number }) | null }[];
  executions: { executionId: string; orderId: number; effect: "entry" | "exit"; role: string; quantity: number; price: number;
    occurredAt: string; commission: number | null }[];
  draft: { exitPlan: ExitPlanDefinition; digest: string; quantity: number; basedOn: number } | null };
export type PaperBrokerView = { mode: "read-only"; source: "IBKR TWS"; connectionStatus: "connected" | "refreshing" | "stale" | "disconnected";
  dataStatus: "fresh" | "stale" | "unavailable"; lastSuccessfulUpdate: string | null; error: string | null;
  account: { id: string; maskedId: string; value: number | null; currency: string | null; source: string; observedAt: string; available: boolean } | null;
  positions: import("../app/TradingWorkspace").UnlinkedPositionInput[];
  openOrders: { id: string; symbol: string; action: string; quantity: number; orderType: string; timeInForce: string; status: string }[] };
export type PaperStatus = { connected: boolean; account: string | null; connectionId: string | null; armedBatch: string | null;
  submissionsEnabled: boolean; lastReconciled: string | null; error: string | null; campaigns: PaperCampaign[]; batches: PaperBatch[];
  readiness: { state: "disconnected" | "blocked" | "ready" | "error"; message: string }; broker: PaperBrokerView | null };

export function paperDomainCampaign(c: PaperCampaign): TradeCampaign {
  return { schemaVersion: 1, campaignId: c.id, journalTradeId: `paper:${c.id}`, accountId: c.accountBinding,
    planId: c.ticket.planId, symbol: c.symbol, direction: c.direction,
    lifecycle: { status: c.state === "Closed" ? "Closed" : c.summary.entered ? "Open" : "Pending entry" },
    executions: c.executions.map(e => ({ schemaVersion: 1, accountId: c.accountBinding, sessionId: c.id,
      executionId: e.executionId, orderId: String(e.orderId), campaignId: c.id, effect: e.effect,
      role: (e.role === "entry" ? "entry" : e.role === "stop" ? "stop" : e.role === "target" ? "target" : "manual") as Execution["role"],
      quantity: e.quantity, price: e.price, fee: e.commission ?? 0, feeAvailable: e.commission != null, occurredAt: e.occurredAt,
      protectionStopAtFill: c.ticket.stopPrice, provenance: "IBKR" })),
    journalSnapshot: { instrumentId: `IBKR-STK:${c.contract.conId}`, currency: c.contract.currency, provenance: "Linked plan",
      plannedEntry: c.ticket.planningPrice, plannedQuantity: c.ticket.quantity, originalStop: c.ticket.stopPrice,
      plannedInitialRisk: c.ticket.quantity * Math.abs(c.ticket.hardCap - c.ticket.stopPrice), costsComplete: c.summary.costsComplete,
      plannedTargets: c.ticket.exitPlan.legs.flatMap(l => l.role === "Target" ? [{ label: l.id, allocationPercent: l.allocationPercent,
        ...(l.target.mode === "R" ? { multipleR: l.target.multipleR } : { price: l.target.price }) }] : []),
      plannedRunners: c.ticket.exitPlan.legs.flatMap(l => l.role === "Runner" ? [{ label: l.id, allocationPercent: l.allocationPercent, rule: l.trailing.mode }] : []),
      capturedAt: c.createdAt } };
}

export function paperJournalRow(c: PaperCampaign) {
  const campaign = paperDomainCampaign(c);
  const fixedTargets = c.ticket.exitPlan.legs.filter(l => l.role === "Target" && l.target.mode === "R");
  const fixedTargetCoverage = fixedTargets.reduce((sum,l) => sum + l.allocationPercent, 0);
  const plannedR = fixedTargetCoverage === 100 ? fixedTargets.reduce((sum,l) => sum + (l.role === "Target" && l.target.mode === "R" ? l.allocationPercent * l.target.multipleR / 100 : 0), 0) : 0;
  return { id: `paper:${c.id}`, campaignId: c.id, planId: c.ticket.planId, symbol: c.symbol, side: c.direction,
    setup: "Unclassified", grade: "C" as const, plannedR, fixedTargetCoverage, currency: c.contract.currency,
    date: c.executions.find(e => e.occurredAt)?.occurredAt.slice(0, 10) ?? "", executions: campaign.executions,
    journalSnapshot: campaign.journalSnapshot, status: c.state, pnl: c.summary.netRealized ?? 0, realizedAvailable: c.summary.netRealized != null,
    r: c.summary.finalNetR ?? 0, finalRAvailable: c.summary.finalNetR != null, costsComplete: c.summary.costsComplete,
    costs: c.summary.fees ?? undefined, grossRealized: c.summary.grossRealized ?? undefined,
    risk: c.summary.initialRisk ?? 0, initialRiskAvailable: c.summary.initialRisk != null,
    enteredQuantity: c.summary.entered, exitedQuantity: c.summary.exited, weightedEntry: c.summary.averageEntry ?? undefined,
    weightedExit: c.summary.exited ? c.executions.filter(e => e.effect === "exit").reduce((n,e) => n + e.price * e.quantity, 0) / c.summary.exited : undefined,
    openQuantity: c.summary.openQuantity, provenance: "IBKR paper · local ledger" };
}
export function trailingDescription(rule: TrailingRule) {
  switch (rule.mode) {
    case "SMA": return `${rule.period}-day moving average`;
    case "Day extreme": return "Previous day extreme";
    case "Dollar": return `$${rule.distance} trailing distance`;
    case "Percentage": return `${rule.percent}% trailing distance`;
    case "Manual": return `Manual stop $${rule.stopPrice}`;
  }
}
export function exitDescriptions(plan: ExitPlanDefinition, quantity: number) {
  const amounts = allocateExitShares(quantity, plan.legs.map(l => l.allocationPercent));
  return plan.legs.map((l,i) => `${l.id}: ${amounts[i]} shares (${l.allocationPercent}%) · ${l.role === "Target" ? l.target.mode === "R" ? `${l.target.multipleR}R target` : `$${l.target.price} target` : `${l.activationR}R activation · ${trailingDescription(l.trailing)}`}`);
}

export function paperPosition(c: PaperCampaign, connected: boolean): DemoPosition {
  const protectedSlots = c.slots.filter(s => s.open > 0 && ["Submitted", "PreSubmitted"].includes(s.stopStatus) && s.confirmedStop != null && !s.whyHeld);
  const protectedQuantity = protectedSlots.reduce((n, s) => n + s.open, 0);
  return { campaignId: c.id, accountId: c.accountBinding, instrumentId: `IBKR-STK:${c.contract.conId}`, positionRevision: String(c.revision),
    planId: c.ticket.planId, symbol: c.symbol, direction: c.direction,
    status: c.state === "Closed" || c.state === "Cancelled" ? "Closed" : c.state === "Pending entry" ? "Working entry" :
      c.state === "Open" || c.state === "Partially filled" || c.state === "Unprotected" ? c.state : "Needs Review",
    plannedQuantity: c.ticket.quantity, filledQuantity: c.summary.entered, openQuantity: c.summary.openQuantity,
    averageEntry: c.summary.averageEntry ?? undefined, plannedEntry: c.ticket.planningPrice, plannedRisk: c.summary.initialRisk ?? undefined,
    fixedInitialStop: c.ticket.stopPrice, entryLabel: "Broker-confirmed executions", simulated: false, stale: !connected,
    protection: { state: c.summary.openQuantity === 0 ? "Staged" : protectedQuantity === c.summary.openQuantity ? "Working" : "Unprotected",
      quantity: protectedQuantity, stop: protectedSlots.length ? Math.min(...protectedSlots.map(s => s.confirmedStop!)) : undefined,
      confirmed: protectedQuantity > 0, source: connected ? "TWS confirmed protection by share" : "Last TWS confirmation · stale" },
    targets: c.slots.flatMap(s => s.leg?.role === "Target" && s.exitPrice != null ? [{ label: `${s.leg.id} · share ${Number(s.id)+1}`,
      quantity: 1, price: s.exitPrice, state: s.exitStatus === "Filled" ? "Filled" as const : ["Submitted", "PreSubmitted"].includes(s.exitStatus ?? "") ? "Working" as const : "Staged" as const }] : []),
    exitPlan: c.activeExitPlan, price: { source: "Disconnected source", status: "Unavailable" }, campaign: paperDomainCampaign(c),
    paperSummary: c.summary };
}
