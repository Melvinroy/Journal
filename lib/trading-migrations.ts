import { TRADING_DOMAIN_VERSION, calculatePositionSize, type PlanRecord, type TradeDirection } from "./trading-domain";

export type MigrationCounts = { migrated: number; unchanged: number; needsReview: number; failed: number };
export type MigrationIssue = { source: string; index?: number; category: "Needs Review" | "Failed"; reason: string };
export type TradingMigrationInput = {
  legacyPlansRaw?: string;
  legacyJournalRaw?: string;
  legacyPlannerDraftRaw?: string;
  legacyPlannerSettingsRaw?: string;
  legacyExitSettingsRaw?: string;
  legacyAfterFillRaw?: string;
};
export type TradingMigrationResult = {
  dryRun: true;
  counts: MigrationCounts;
  backup: TradingMigrationInput;
  migratedPlans: PlanRecord[];
  unchangedJournalRaw?: string;
  issues: MigrationIssue[];
};

type LegacyTranche = { id: string; percent: number; stop: number; target: number | null };
type LegacyPlan = {
  id: string; name: string; symbol: string; side: TradeDirection; entry: number; equity: number;
  riskPercent: number; allocationPercent: number; tranches: LegacyTranche[]; fills: unknown[];
  notes: string; revision: number; updatedAt: string;
};
type LegacyPlannerDraft = {
  symbol: string; side: TradeDirection; entryPrice: number; stopPrice: number; stopSource: "LoD" | "Manual";
  accountEquity: number; riskPercent: number; maxAllocationPercent: number; savedAt: string;
  targetPrices?: number[]; exitPlan?: { targetShares?: number[]; runnerShares?: number };
};

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function validLegacyPlan(value: unknown): value is LegacyPlan {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.symbol !== "string" || !["Long", "Short"].includes(String(value.side)) || !Array.isArray(value.tranches) || !Array.isArray(value.fills) || typeof value.notes !== "string" || typeof value.updatedAt !== "string") return false;
  return [value.entry, value.equity, value.riskPercent, value.allocationPercent, value.revision].every(item => Number.isFinite(item))
    && value.tranches.length > 0
    && value.tranches.every(item => isRecord(item) && typeof item.id === "string" && Number.isFinite(item.percent) && Number.isFinite(item.stop) && (item.target === null || Number.isFinite(item.target)));
}

function validLegacyPlannerDraft(value: unknown): value is LegacyPlannerDraft {
  if (!isRecord(value) || typeof value.symbol !== "string" || !["Long", "Short"].includes(String(value.side)) || !["LoD", "Manual"].includes(String(value.stopSource)) || typeof value.savedAt !== "string") return false;
  return [value.entryPrice, value.stopPrice, value.accountEquity, value.riskPercent, value.maxAllocationPercent].every(Number.isFinite)
    && (value.targetPrices == null || Array.isArray(value.targetPrices))
    && (value.exitPlan == null || isRecord(value.exitPlan));
}

function migratePlan(plan: LegacyPlan): PlanRecord {
  if (plan.fills.length) throw new Error("Legacy plan contains fills and needs deliberate campaign migration.");
  if (plan.tranches.some(tranche => tranche.stop !== plan.tranches[0].stop)) throw new Error("Split-stop legacy plan needs deliberate review.");
  const sizing = calculatePositionSize({ accountBase: plan.equity, riskPercent: plan.riskPercent, allocationPercent: plan.allocationPercent, entryPrice: plan.entry, stopPrice: plan.tranches[0].stop, direction: plan.side });
  const runnerPercent = plan.tranches.filter(tranche => tranche.target === null).reduce((sum, tranche) => sum + tranche.percent, 0);
  return {
    schemaVersion: TRADING_DOMAIN_VERSION,
    kind: "trade-plan",
    planId: plan.id,
    revisionId: `${plan.id}:legacy:${plan.revision}`,
    revision: plan.revision,
    symbol: plan.symbol.trim().toUpperCase(),
    direction: plan.side,
    setup: plan.name,
    capturedEntry: plan.entry,
    capturedPriceSource: { source: "Legacy", observedAt: plan.updatedAt },
    stop: { method: "Manual", price: plan.tranches[0].stop },
    sizing: {
      accountBase: plan.equity,
      manualPlanningBalance: plan.equity,
      riskPercent: plan.riskPercent,
      allocationPercent: plan.allocationPercent,
      plannedQuantity: sizing.shares,
      plannedRisk: sizing.plannedRisk,
    },
    targets: plan.tranches.filter(tranche => tranche.target !== null).map(tranche => ({
      multipleR: Math.abs((tranche.target! - plan.entry) / (plan.entry - plan.tranches[0].stop)),
      percent: tranche.percent,
    })),
    runner: runnerPercent ? { percent: runnerPercent, rule: "Legacy manual runner" } : undefined,
    createdAt: plan.updatedAt,
    savedAt: plan.updatedAt,
  };
}

function migratePlannerDraft(draft: LegacyPlannerDraft): PlanRecord {
  if (draft.side === "Short" && draft.stopSource === "LoD") throw new Error("A legacy short labelled LoD needs direction-aware stop review.");
  const sizing = calculatePositionSize({ accountBase: draft.accountEquity, riskPercent: draft.riskPercent, allocationPercent: draft.maxAllocationPercent, entryPrice: draft.entryPrice, stopPrice: draft.stopPrice, direction: draft.side });
  const targetShares = draft.exitPlan?.targetShares?.filter(value => Number.isSafeInteger(value) && value >= 0) ?? [];
  const runnerShares = Number.isSafeInteger(draft.exitPlan?.runnerShares) && draft.exitPlan!.runnerShares! >= 0 ? draft.exitPlan!.runnerShares! : 0;
  if (targetShares.reduce((sum, value) => sum + value, 0) + runnerShares > sizing.shares) throw new Error("Legacy exit allocations exceed the planned quantity.");
  const direction = draft.side === "Long" ? 1 : -1;
  return {
    schemaVersion: TRADING_DOMAIN_VERSION,
    kind: "trade-plan",
    planId: `legacy-original:${draft.symbol.trim().toUpperCase()}:${draft.savedAt}`,
    revisionId: `legacy-original:${draft.savedAt}:1`,
    revision: 1,
    symbol: draft.symbol.trim().toUpperCase(),
    direction: draft.side,
    setup: "Original Trade Planner",
    capturedEntry: draft.entryPrice,
    capturedPriceSource: { source: "Legacy", observedAt: draft.savedAt },
    stop: { method: draft.stopSource, price: draft.stopPrice },
    sizing: {
      accountBase: draft.accountEquity,
      manualPlanningBalance: draft.accountEquity,
      riskPercent: draft.riskPercent,
      allocationPercent: draft.maxAllocationPercent,
      plannedQuantity: sizing.shares,
      plannedRisk: sizing.plannedRisk,
    },
    targets: (draft.targetPrices ?? []).map((price, index) => {
      if (!Number.isFinite(price) || direction * (price - draft.entryPrice) <= 0) throw new Error("Legacy target price is invalid for its direction.");
      return { multipleR: Math.abs((price - draft.entryPrice) / (draft.entryPrice - draft.stopPrice)), percent: sizing.shares ? (targetShares[index] ?? 0) / sizing.shares * 100 : 0 };
    }),
    runner: runnerShares && sizing.shares ? { percent: runnerShares / sizing.shares * 100, rule: "Legacy saved runner" } : undefined,
    createdAt: draft.savedAt,
    savedAt: draft.savedAt,
  };
}

function parseArray(raw: string, source: string, result: TradingMigrationResult): unknown[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
    return parsed;
  } catch (error) {
    result.counts.failed += 1;
    result.issues.push({ source, category: "Failed", reason: error instanceof Error ? error.message : "Invalid JSON." });
    return null;
  }
}

export function dryRunTradingMigration(input: TradingMigrationInput): TradingMigrationResult {
  const result: TradingMigrationResult = {
    dryRun: true,
    counts: { migrated: 0, unchanged: 0, needsReview: 0, failed: 0 },
    backup: { ...input },
    migratedPlans: [],
    unchangedJournalRaw: input.legacyJournalRaw,
    issues: [],
  };
  if (input.legacyJournalRaw != null) {
    const journal = parseArray(input.legacyJournalRaw, "journal-trades-v2", result);
    if (journal) result.counts.unchanged += journal.length;
  }
  if (input.legacyPlansRaw != null) {
    const plans = parseArray(input.legacyPlansRaw, "brontide-plans-v1", result);
    plans?.forEach((candidate, index) => {
      if (!validLegacyPlan(candidate)) {
        result.counts.needsReview += 1;
        result.issues.push({ source: "brontide-plans-v1", index, category: "Needs Review", reason: "Record does not match the supported legacy plan shape." });
        return;
      }
      try {
        result.migratedPlans.push(migratePlan(candidate));
        result.counts.migrated += 1;
      } catch (error) {
        result.counts.needsReview += 1;
        result.issues.push({ source: "brontide-plans-v1", index, category: "Needs Review", reason: error instanceof Error ? error.message : "Ambiguous legacy plan." });
      }
    });
  }
  if (input.legacyPlannerDraftRaw != null) {
    try {
      const draft: unknown = JSON.parse(input.legacyPlannerDraftRaw);
      if (!validLegacyPlannerDraft(draft)) throw new Error("Record does not match the supported original planner draft shape.");
      result.migratedPlans.push(migratePlannerDraft(draft));
      result.counts.migrated += 1;
    } catch (error) {
      result.counts.needsReview += 1;
      result.issues.push({ source: "journal.trade-planner.draft.v1", category: "Needs Review", reason: error instanceof Error ? error.message : "Ambiguous planner draft." });
    }
  }
  for (const [source, raw] of [
    ["journal.trade-planner.settings.v1", input.legacyPlannerSettingsRaw],
    ["journal.trade-planner.exits.v1", input.legacyExitSettingsRaw],
    ["journal.trade-planner.after-fill-stage.v1", input.legacyAfterFillRaw],
  ] as const) {
    if (raw == null) continue;
    try {
      if (!isRecord(JSON.parse(raw))) throw new Error("Expected a JSON object.");
      result.counts.unchanged += 1;
    } catch (error) {
      result.counts.failed += 1;
      result.issues.push({ source, category: "Failed", reason: error instanceof Error ? error.message : "Invalid JSON." });
    }
  }
  return result;
}
