import { rollupCampaign, type Execution, type TradeCampaign } from "./trading-domain";

export type DemoPosition = {
  campaignId: string;
  planId?: string;
  symbol: string;
  direction: "Long" | "Short";
  status: "Working entry" | "Partially filled" | "Open" | "Unprotected" | "Closed";
  plannedQuantity: number;
  filledQuantity: number;
  openQuantity: number;
  averageEntry?: number;
  entryLabel: string;
  protection: { state: "Staged" | "Working" | "Unprotected" | "Complete"; quantity: number; stop?: number };
  targets: Array<{ label: string; quantity: number; price: number; state: "Staged" | "Working" | "Filled" }>;
  runner?: { quantity: number; rule: string };
  changedInIbkr?: boolean;
  stale?: boolean;
  simulated: true;
};

const execution = (value: Omit<Execution, "schemaVersion" | "accountId" | "sessionId" | "provenance"> & { provenance?: Execution["provenance"] }): Execution => ({
  schemaVersion: 1,
  accountId: "SIMULATED-ONLY",
  sessionId: "stage-3-preview",
  provenance: "IBKR",
  ...value,
});

const campaigns: TradeCampaign[] = [
  {
    schemaVersion: 1, campaignId: "demo-aapl", accountId: "SIMULATED-ONLY", planId: "plan-aapl", journalTradeId: "journal-aapl", symbol: "AAPL", direction: "Long", lifecycle: { status: "Partially filled" }, executions: [
      execution({ executionId: "aapl-entry-1", orderId: "sim-aapl-entry", campaignId: "demo-aapl", effect: "entry", role: "entry", quantity: 25, price: 226.10, fee: .35, occurredAt: "2026-09-08T14:31:00Z", protectionStopAtFill: 221.50 }),
      execution({ executionId: "aapl-entry-2", orderId: "sim-aapl-entry", campaignId: "demo-aapl", effect: "entry", role: "entry", quantity: 15, price: 226.30, fee: .25, occurredAt: "2026-09-08T14:33:00Z", protectionStopAtFill: 221.50 }),
      execution({ executionId: "aapl-manual-exit", orderId: "sim-aapl-external", campaignId: "demo-aapl", effect: "exit", role: "manual", quantity: 5, price: 228.00, fee: .18, occurredAt: "2026-09-08T15:04:00Z", provenance: "manual-import" }),
    ],
  },
  {
    schemaVersion: 1, campaignId: "demo-mrna", accountId: "SIMULATED-ONLY", planId: "plan-mrna", journalTradeId: "journal-mrna", symbol: "MRNA", direction: "Short", lifecycle: { status: "Open" }, executions: [
      execution({ executionId: "mrna-entry", orderId: "sim-mrna-entry", campaignId: "demo-mrna", effect: "entry", role: "entry", quantity: 20, price: 90, fee: 1, occurredAt: "2026-09-05T14:00:00Z", protectionStopAtFill: 94 }),
      execution({ executionId: "mrna-profit", orderId: "sim-mrna-t1", campaignId: "demo-mrna", effect: "exit", role: "target", quantity: 5, price: 85, fee: .5, occurredAt: "2026-09-06T15:00:00Z" }),
      execution({ executionId: "mrna-loss", orderId: "sim-mrna-manual", campaignId: "demo-mrna", effect: "exit", role: "manual", quantity: 3, price: 92, fee: .5, occurredAt: "2026-09-07T15:00:00Z", provenance: "manual-import" }),
      // Exact replay proves one economic effect in the view model.
      execution({ executionId: "mrna-loss", orderId: "sim-mrna-manual", campaignId: "demo-mrna", effect: "exit", role: "manual", quantity: 3, price: 92, fee: .5, occurredAt: "2026-09-07T15:00:00Z", provenance: "manual-import" }),
    ],
  },
  {
    schemaVersion: 1, campaignId: "demo-tsla", accountId: "SIMULATED-ONLY", planId: "plan-tsla", journalTradeId: "journal-tsla", symbol: "TSLA", direction: "Long", lifecycle: { status: "Unprotected" }, executions: [
      execution({ executionId: "tsla-entry", orderId: "sim-tsla-entry", campaignId: "demo-tsla", effect: "entry", role: "entry", quantity: 18, price: 347.50, fee: .65, occurredAt: "2026-09-04T14:00:00Z", protectionStopAtFill: 338 }),
    ],
  },
  {
    schemaVersion: 1, campaignId: "demo-amd", accountId: "SIMULATED-ONLY", planId: "plan-amd", journalTradeId: "journal-amd", symbol: "AMD", direction: "Long", lifecycle: { status: "Closed" }, executions: [
      execution({ executionId: "amd-entry", orderId: "sim-amd-entry", campaignId: "demo-amd", effect: "entry", role: "entry", quantity: 20, price: 164, fee: .5, occurredAt: "2026-09-01T14:00:00Z", protectionStopAtFill: 160 }),
      execution({ executionId: "amd-target", orderId: "sim-amd-target", campaignId: "demo-amd", effect: "exit", role: "target", quantity: 10, price: 172, fee: .4, occurredAt: "2026-09-02T15:00:00Z" }),
      execution({ executionId: "amd-stop", orderId: "sim-amd-stop", campaignId: "demo-amd", effect: "exit", role: "stop", quantity: 10, price: 164, fee: .4, occurredAt: "2026-09-03T15:00:00Z" }),
    ],
  },
];

export const DEMO_CAMPAIGNS = campaigns;

export const DEMO_POSITIONS: DemoPosition[] = [
  { campaignId: "demo-pltr", planId: "plan-pltr", symbol: "PLTR", direction: "Long", status: "Working entry", plannedQuantity: 60, filledQuantity: 0, openQuantity: 0, entryLabel: "MIDPRICE · cap $161.20", protection: { state: "Staged", quantity: 60, stop: 154.80 }, targets: [{ label: "1R", quantity: 21, price: 167.60, state: "Staged" }, { label: "2R", quantity: 21, price: 174, state: "Staged" }], runner: { quantity: 18, rule: "SMA10" }, simulated: true },
  { campaignId: "demo-aapl", planId: "plan-aapl", symbol: "AAPL", direction: "Long", status: "Partially filled", plannedQuantity: 100, filledQuantity: 40, openQuantity: 35, averageEntry: 226.18, entryLabel: "40 / 100 filled", protection: { state: "Working", quantity: 35, stop: 221.50 }, targets: [{ label: "1R", quantity: 12, price: 230.86, state: "Staged" }, { label: "2R", quantity: 12, price: 235.54, state: "Staged" }], runner: { quantity: 11, rule: "SMA20" }, changedInIbkr: true, simulated: true },
  { campaignId: "demo-mrna", planId: "plan-mrna", symbol: "MRNA", direction: "Short", status: "Open", plannedQuantity: 20, filledQuantity: 20, openQuantity: 12, averageEntry: 90, entryLabel: "Entry complete", protection: { state: "Working", quantity: 12, stop: 90 }, targets: [{ label: "1R", quantity: 5, price: 86, state: "Filled" }, { label: "2R", quantity: 3, price: 82, state: "Working" }], runner: { quantity: 4, rule: "Day high" }, changedInIbkr: true, simulated: true },
  { campaignId: "demo-tsla", planId: "plan-tsla", symbol: "TSLA", direction: "Long", status: "Unprotected", plannedQuantity: 18, filledQuantity: 18, openQuantity: 18, averageEntry: 347.50, entryLabel: "Entry complete", protection: { state: "Unprotected", quantity: 0, stop: 338 }, targets: [], runner: { quantity: 18, rule: "Manual" }, simulated: true },
  { campaignId: "demo-amd", planId: "plan-amd", symbol: "AMD", direction: "Long", status: "Closed", plannedQuantity: 20, filledQuantity: 20, openQuantity: 0, averageEntry: 164, entryLabel: "Closed", protection: { state: "Complete", quantity: 0 }, targets: [{ label: "1R", quantity: 10, price: 172, state: "Filled" }], simulated: true },
];

export const DEMO_SAVED_PLANS = [
  { id: "sample-nvda", symbol: "NVDA", name: "Sample breakout", revision: 1, entry: 120, stop: 116, quantity: 25, state: "Saved", priceSource: "Local EOD · Sep 8", stale: true },
  { id: "sample-mrna", symbol: "MRNA", name: "Sample partial exit", revision: 1, entry: 90, stop: 94, quantity: 20, state: "Partially exited", priceSource: "Simulated execution ledger", stale: false },
];

export const DEMO_UNLINKED_POSITIONS = [
  { id: "unlinked-msft", symbol: "MSFT", direction: "Long" as const, quantity: 12, averageEntry: 507.40, marketValue: 6146.40, changedAt: "2026-09-08T15:12:00Z" },
];

export function demoJournalRows() {
  return campaigns.map(campaign => {
    const rollup = rollupCampaign(campaign);
    return {
      id: campaign.journalTradeId!,
      campaignId: campaign.campaignId,
      symbol: campaign.symbol,
      side: campaign.direction,
      setup: campaign.planId ? "Linked plan" : "Unlinked broker trade",
      date: rollup.executions[0]?.occurredAt.slice(0, 10) ?? "2026-09-09",
      pnl: rollup.finalNetPnl ?? rollup.realizedNetPnl,
      r: rollup.actualInitialRisk ? (rollup.finalNetPnl ?? rollup.realizedNetPnl) / rollup.actualInitialRisk : 0,
      risk: rollup.actualInitialRisk,
      plannedR: 2,
      grade: "A" as const,
      status: campaign.lifecycle.status,
      executions: rollup.executions,
      openQuantity: rollup.openQuantity,
      simulated: true as const,
    };
  });
}
