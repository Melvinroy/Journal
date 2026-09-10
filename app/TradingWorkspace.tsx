"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEMO_CAMPAIGNS,
  DEMO_DEFAULT_EXIT_PLAN,
  DEMO_LINKABLE_JOURNAL_TRADES,
  DEMO_POSITIONS,
  DEMO_SAVED_PLANS,
  DEMO_UNLINKED_POSITIONS,
  type DemoPosition,
} from "../lib/trading-demo";
import {
  assertAmendmentMatchesPosition,
  createExitPlanAmendment,
  createPositionAssociation,
  freezeRiskReference,
  positionRiskBreakdown,
  rollupCampaign,
  type ExitPlanAmendment,
  type ExitPlanDefinition,
  type PositionAssociation,
  type TradeCampaign,
} from "../lib/trading-domain";
import { SAMPLE_PLANS, demoStorageKey } from "../lib/review-demo";
import {
  PLANS_KEY,
  appendFill,
  position,
  validatePlans,
  type Fill,
  type Plan,
  type PlanRevision,
} from "../lib/trading-ledger";
import { useBrowserStore } from "../lib/use-browser-store";
import type { MarketContext } from "../lib/workspace-state";
import { PositionExitPlanControls } from "./PositionExitPlanControls";
import { TradePlanner } from "./TradePlanner";
import { useModalAccessibility } from "./useModalAccessibility";

const AMENDMENTS_KEY = "brontide-position-amendments-v1";
const ASSOCIATIONS_KEY = "brontide-position-associations-v1";
const POSITION_OVERRIDES_KEY = "brontide-position-snapshot-overrides-v1";

type StoredAmendment = ExitPlanAmendment & {
  accountId: string;
  instrumentId: string;
  savedAt: string;
};
type PositionOverride = {
  positionRevision: string;
  confirmedOpenQuantity: number;
};
export type UnlinkedPositionInput = {
  id: string;
  accountId: string;
  instrumentId: string;
  positionRevision?: string;
  symbol: string;
  direction: "Long" | "Short";
  quantity: number;
  averageEntry: number | null;
  marketValue: number | null;
  changedAt: string;
  currency?: string | null;
  exchange?: string | null;
  snapshotState?: "current" | "reconciliation-required";
  associationEligible?: boolean;
  missingInformation?: string[];
  stale?: boolean;
};

type BrokerAccountView = {
  id: string;
  maskedId: string;
  value: number | null;
  currency: string | null;
  source: string;
  observedAt: string;
  available: boolean;
};

type BrokerOrderView = {
  id: string;
  symbol: string;
  action: string;
  quantity: number;
  orderType: string;
  timeInForce: string;
  status: string;
};

type BrokerReadOnlyState = {
  mode: "read-only";
  source: "IBKR TWS";
  connectionStatus: "connected" | "refreshing" | "stale" | "disconnected";
  dataStatus: "fresh" | "stale" | "unavailable";
  lastSuccessfulUpdate: string | null;
  account: BrokerAccountView | null;
  positions: UnlinkedPositionInput[];
  openOrders: BrokerOrderView[];
  error: string | null;
};

const EMPTY_BROKER_STATE: BrokerReadOnlyState = {
  mode: "read-only",
  source: "IBKR TWS",
  connectionStatus: "disconnected",
  dataStatus: "unavailable",
  lastSuccessfulUpdate: null,
  account: null,
  positions: [],
  openOrders: [],
  error: null,
};

const money = (value: number, decimals = 0) =>
  value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
const signedMoney = (value: number) =>
  `${value >= 0 ? "+" : "−"}${money(Math.abs(value), 2)}`;
const accountMoney = (value: number, currency: string) =>
  value.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
const observedTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(value))
    : "No successful update";
const fresh = (context?: MarketContext): Plan => ({
  id: crypto.randomUUID(),
  name: "New trade plan",
  symbol: context?.symbol ?? "",
  side: "Long",
  entry: 0,
  equity: 30000,
  riskPercent: 0.5,
  allocationPercent: 10,
  tranches: [
    { id: "T1", percent: 35, stop: 0, target: null },
    { id: "T2", percent: 35, stop: 0, target: null },
    { id: "Runner", percent: 30, stop: 0, target: null },
  ],
  fills: [],
  notes: "",
  revision: 0,
  context,
  updatedAt: new Date().toISOString(),
});
const validAmendments = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item &&
      typeof item.amendmentId === "string" &&
      typeof item.campaignId === "string" &&
      typeof item.sourcePlanRevisionId === "string" &&
      Number.isSafeInteger(item.confirmedOpenQuantity) &&
      item.confirmedOpenQuantity >= 0 &&
      item.state === "Draft" &&
      item.requestedDefinition &&
      Array.isArray(item.requestedQuantities),
  );
const validAssociations = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item &&
      typeof item.associationId === "string" &&
      typeof item.accountId === "string" &&
      typeof item.instrumentId === "string" &&
      typeof item.brokerPositionId === "string" &&
      typeof item.journalTradeId === "string",
  );
const validOverrides = (value: unknown) =>
  Boolean(value) &&
  typeof value === "object" &&
  Object.values(value as Record<string, PositionOverride>).every(
    (item) =>
      item &&
      typeof item.positionRevision === "string" &&
      Number.isSafeInteger(item.confirmedOpenQuantity) &&
      item.confirmedOpenQuantity >= 0,
  );

function positionNumbers(item: DemoPosition) {
  const campaign =
    item.campaign ?? DEMO_CAMPAIGNS.find(
    (value) => value.campaignId === item.campaignId,
  );
  const rollup = campaign ? rollupCampaign(campaign) : null;
  const hasExecutions = Boolean(rollup?.executions.length);
  const averageEntry =
    (hasExecutions ? rollup?.actualAverageEntry : null) ?? item.averageEntry ?? null;
  const filledQuantity = hasExecutions
    ? rollup!.enteredQuantity
    : item.snapshotOnly
      ? null
      : (item.filledQuantity ?? null);
  // The reconciled position snapshot is authoritative for current quantity;
  // the immutable execution rollup remains authoritative for fills and P&L.
  const openQuantity = item.openQuantity;
  const exitedQuantity = hasExecutions
    ? rollup!.exitedQuantity
    : item.snapshotOnly || filledQuantity == null
      ? null
      : Math.max(0, filledQuantity - openQuantity);
  const realized = hasExecutions ? rollup!.realizedNetPnl : item.snapshotOnly ? null : 0;
  const actualInitialRisk = hasExecutions
    ? rollup!.actualInitialRisk
    : item.snapshotOnly
      ? null
      : filledQuantity
        ? (item.plannedRisk ?? null)
        : 0;
  const unrealized =
    averageEntry && item.price.price != null && openQuantity > 0
      ? (item.direction === "Long" ? 1 : -1) *
        (item.price.price - averageEntry) *
        openQuantity
      : null;
  const risk = averageEntry
    ? positionRiskBreakdown({
        direction: item.direction,
        openQuantity,
        averageEntry,
        confirmedProtectionQuantity: Math.min(
          item.protection.quantity,
          openQuantity,
        ),
        confirmedStopPrice: item.protection.quantity
          ? item.protection.stop
          : undefined,
      })
    : null;
  return {
    campaign,
    rollup,
    averageEntry,
    filledQuantity,
    openQuantity,
    exitedQuantity,
    realized,
    actualInitialRisk,
    unrealized,
    risk,
  };
}

function protectionLabel(item: DemoPosition, openQuantity: number) {
  if (openQuantity === 0)
    return item.status === "Working entry" ? item.protection.state : "Complete";
  const uncovered = Math.max(0, openQuantity - item.protection.quantity);
  if (uncovered)
    return item.protection.quantity
      ? `${item.protection.quantity}/${openQuantity} protected · ${uncovered} unprotected`
      : `${openQuantity} unprotected`;
  return item.protection.confirmed
    ? `${openQuantity}/${openQuantity} confirmed`
    : item.protection.state;
}

function positionMessageIsError(message: string) {
  return /failed|invalid|could not|^The confirmed position changed/i.test(
    message,
  );
}

export function TradingWorkspace({
  context,
  onChart,
  onOpenJournalTrade,
  onCreateJournalTrade,
  positionCampaigns = [],
  demo = false,
}: {
  demo?: boolean;
  context?: MarketContext;
  onChart: (context: MarketContext) => void;
  onOpenJournalTrade?: (tradeId: string) => void;
  onCreateJournalTrade?: (item: UnlinkedPositionInput) => string;
  positionCampaigns?: readonly TradeCampaign[];
}) {
  const store = useBrowserStore<Plan[]>(
    demoStorageKey(PLANS_KEY, demo),
    demo ? SAMPLE_PLANS : [],
    validatePlans,
  );
  const revisions = useBrowserStore<PlanRevision[]>(
    demoStorageKey("brontide-plan-revisions-v1", demo),
    [],
    (value) =>
      Array.isArray(value) &&
      value.every(
        (item) =>
          item &&
          Number.isInteger(item.revision) &&
          typeof item.savedAt === "string" &&
          validatePlans([item.plan]),
      ),
  );
  const recovery = useBrowserStore<{ draft: Plan | null; dirty: boolean }>(
    demoStorageKey("brontide-plan-editor-v1", demo),
    { draft: null, dirty: false },
    (value) => {
      const item = value as { draft?: Plan | null; dirty?: boolean };
      return (
        !!item &&
        typeof item.dirty === "boolean" &&
        (item.draft === null ||
          (!!item.draft &&
            typeof item.draft.id === "string" &&
            Array.isArray(item.draft.tranches) &&
            Array.isArray(item.draft.fills)))
      );
    },
  );
  const amendments = useBrowserStore<StoredAmendment[]>(
    demoStorageKey(AMENDMENTS_KEY, demo),
    [],
    validAmendments,
  );
  const associations = useBrowserStore<PositionAssociation[]>(
    demoStorageKey(ASSOCIATIONS_KEY, demo),
    [],
    validAssociations,
  );
  const positionOverrides = useBrowserStore<Record<string, PositionOverride>>(
    demoStorageKey(POSITION_OVERRIDES_KEY, demo),
    {},
    validOverrides,
  );

  const [draft, setDraft] = useState<Plan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [showSaved, setShowSaved] = useState(true);
  const [planAmendmentMode, setPlanAmendmentMode] = useState(false);
  const [fill, setFill] = useState<Omit<Fill, "id" | "provenance">>({
    trancheId: "A",
    action: "entry",
    quantity: 0,
    price: 0,
    fee: 0,
    at: "",
    reason: "Manual",
  });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [amendmentDefinition, setAmendmentDefinition] =
    useState<ExitPlanDefinition | null>(null);
  const [amendmentSource, setAmendmentSource] = useState<{
    revision: string;
    quantity: number;
  } | null>(null);
  const [amendmentDirty, setAmendmentDirty] = useState(false);
  const [positionMessage, setPositionMessage] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [selectedJournalTradeId, setSelectedJournalTradeId] = useState(
    DEMO_LINKABLE_JOURNAL_TRADES[0]?.journalTradeId ?? "",
  );
  const [linkMessage, setLinkMessage] = useState("");
  const [brokerState, setBrokerState] = useState<BrokerReadOnlyState>(
    EMPTY_BROKER_STATE,
  );
  const [brokerBusy, setBrokerBusy] = useState(false);
  const restored = useRef(false);
  const brokerStarted = useRef(false);
  const editorRef = useRef<HTMLElement>(null);
  const positionRef = useRef<HTMLElement>(null);
  const linkRef = useRef<HTMLElement>(null);

  const brokerPositions = demo
    ? (DEMO_UNLINKED_POSITIONS as UnlinkedPositionInput[])
    : brokerState.positions;
  const linkableJournalTrades = demo
    ? DEMO_LINKABLE_JOURNAL_TRADES
    : positionCampaigns
        .filter((campaign) => campaign.positionSnapshot)
        .map((campaign) => ({
          journalTradeId: campaign.journalTradeId,
          accountId: campaign.positionSnapshot!.accountId,
          instrumentId: campaign.positionSnapshot!.instrumentId,
          label: `${campaign.symbol} · ${campaign.journalTradeId}`,
        }));

  const effectivePositions = useMemo(() => {
      const campaigns = demo
        ? [...DEMO_CAMPAIGNS, ...positionCampaigns]
        : [...positionCampaigns];
      const linkedSnapshots = associations.value.flatMap((association) => {
        const campaign = campaigns.find(
          (value) => value.journalTradeId === association.journalTradeId,
        );
        const snapshot = campaign?.positionSnapshot;
        const source = brokerPositions.find(
          (value) => value.id === association.brokerPositionId,
        );
        if (!campaign || !snapshot || !source) return [];
        const openQuantity = Number(source.quantity);
        const price =
          source.marketValue != null && openQuantity > 0
            ? source.marketValue / openQuantity
            : undefined;
        return [{
          campaignId: campaign.campaignId,
          campaign,
          accountId: snapshot.accountId,
          instrumentId: snapshot.instrumentId,
          positionRevision: source.positionRevision ?? snapshot.positionRevision,
          symbol: campaign.symbol,
          direction: campaign.direction,
          status: "Needs Review" as const,
          openQuantity,
          averageEntry: source.averageEntry ?? snapshot.averageEntry ?? undefined,
          entryLabel: "Position snapshot only",
          protection: {
            state: "Unknown" as const,
            quantity: 0,
            confirmed: false,
            source: "Position snapshot has no confirmed protection record",
          },
          targets: [],
          exitPlan: DEMO_DEFAULT_EXIT_PLAN,
          price: {
            price,
            source: demo ? "Simulated quote" as const : "IBKR snapshot" as const,
            status: source.stale || price == null ? "Stale" as const : "Fresh" as const,
            observedAt: source.changedAt,
          },
          changedInIbkr: true,
          snapshotOnly: true,
          stale: source.stale,
          simulated: demo,
        } satisfies DemoPosition];
      });
      return [...(demo ? DEMO_POSITIONS : []), ...linkedSnapshots].map((item) => {
        const override = positionOverrides.value[item.campaignId];
        return override
          ? {
              ...item,
              positionRevision: override.positionRevision,
              openQuantity: override.confirmedOpenQuantity,
              protection: {
                ...item.protection,
                quantity: Math.min(
                  item.protection.quantity,
                  override.confirmedOpenQuantity,
                ),
              },
            }
          : item;
      });
    }, [associations.value, brokerPositions, demo, positionCampaigns, positionOverrides.value]);
  const detail =
    effectivePositions.find((item) => item.campaignId === detailId) ?? null;
  const detailNumbers = detail ? positionNumbers(detail) : null;
  const savedAmendment = detail
    ? amendments.value.find((item) => item.campaignId === detail.campaignId)
    : undefined;
  const linkingItem = brokerPositions.find((item) => item.id === linkingId) ?? null;

  async function brokerRequest(
    path: "/v1/ibkr/read-only/refresh" | "/v1/ibkr/read-only/disconnect",
  ) {
    setBrokerBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        headers: { "X-Brontide-Local": "1" },
      });
      if (!response.ok) throw new Error(`Read-only broker request failed (${response.status}).`);
      setBrokerState((await response.json()) as BrokerReadOnlyState);
    } catch (error) {
      setBrokerState((current) => ({
        ...current,
        connectionStatus: current.lastSuccessfulUpdate ? "stale" : "disconnected",
        dataStatus: current.lastSuccessfulUpdate ? "stale" : "unavailable",
        positions: current.positions.map((item) => ({ ...item, stale: true })),
        error: (error as Error).message,
      }));
    } finally {
      setBrokerBusy(false);
    }
  }

  useEffect(() => {
    if (demo || brokerStarted.current) return;
    brokerStarted.current = true;
    fetch("/v1/ibkr/read-only", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Read-only broker status failed (${response.status}).`);
        return response.json() as Promise<BrokerReadOnlyState>;
      })
      .then((value) => {
        setBrokerState(value);
        void brokerRequest("/v1/ibkr/read-only/refresh");
      })
      .catch((error) => {
        setBrokerState((value) => ({ ...value, error: (error as Error).message }));
      });
  }, [demo]);

  useEffect(() => {
    if (recovery.ready && !restored.current) {
      setDraft(recovery.value.draft);
      setDirty(recovery.value.dirty);
      setPlanAmendmentMode(
        Boolean(recovery.value.dirty && recovery.value.draft?.fills.length),
      );
      restored.current = true;
    }
  }, [recovery.ready]);
  useEffect(() => {
    if (restored.current && recovery.ready) recovery.save({ draft, dirty });
  }, [draft, dirty]);
  useModalAccessibility(Boolean(draft), editorRef, () => closeEditor());
  useModalAccessibility(Boolean(detail), positionRef, () =>
    closePositionDetail(),
  );
  useModalAccessibility(Boolean(linkingItem), linkRef, () =>
    setLinkingId(null),
  );

  const edit = (patch: Partial<Plan>) => {
    if (draft && (!draft.fills.length || planAmendmentMode)) {
      setDraft({ ...draft, ...patch });
      setDirty(true);
      setMessage("");
    }
  };
  const open = (plan: Plan) => {
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved editor changes? Saved plans remain unchanged.",
      )
    )
      return;
    setDraft(structuredClone(plan));
    setDirty(false);
    setPlanAmendmentMode(false);
    setMessage("");
    setFill((current) => ({
      ...current,
      trancheId: plan.tranches[0]?.id ?? "",
    }));
  };
  const closeEditor = () => {
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved editor changes? Saved plans remain unchanged.",
      )
    )
      return;
    setDraft(null);
    setDirty(false);
    setPlanAmendmentMode(false);
  };
  const persist = (next: Plan) => {
    try {
      position(next);
      const prior = store.value.find((plan) => plan.id === next.id);
      if (prior && prior.revision !== next.revision - 1)
        throw new Error(
          "This plan changed elsewhere. Reopen its latest revision.",
        );
      if (
        prior &&
        !revisions.save([
          ...revisions.value,
          { revision: prior.revision, savedAt: prior.updatedAt, plan: prior },
        ])
      )
        throw new Error("Prior revision could not be preserved; save stopped.");
      if (
        store.save([...store.value.filter((plan) => plan.id !== next.id), next])
      ) {
        setDraft(next);
        setDirty(false);
        setMessage("Saved. No broker order was sent.");
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const save = () =>
    draft &&
    persist({
      ...draft,
      symbol: draft.symbol.trim().toUpperCase(),
      revision: draft.revision + 1,
      updatedAt: new Date().toISOString(),
    });
  const record = () => {
    if (!draft || dirty) {
      setMessage("Save the plan before recording an execution.");
      return;
    }
    try {
      if (!fill.at) throw new Error("Enter the execution time.");
      persist({
        ...appendFill(draft, {
          ...fill,
          id: crypto.randomUUID(),
          at: new Date(fill.at).toISOString(),
          provenance: "manual",
        }),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const exportPlans = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, value: store.value }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "brontide-plans.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const metrics = useMemo(() => {
    if (!draft) return null;
    try {
      return position(draft);
    } catch {
      return null;
    }
  }, [draft]);
  const savedRows = demo
    ? DEMO_SAVED_PLANS
    : store.value.map((plan) => {
        const state = position(plan);
        return {
          id: plan.id,
          symbol: plan.symbol,
          name: plan.name,
          revision: plan.revision,
          entry: plan.entry,
          stop: plan.tranches[0]?.stop ?? 0,
          quantity: state.shares,
          state: state.status,
          priceSource: "Saved plan",
          stale: false,
        };
      });
  const recordedPositions = !demo
    ? store.value
        .filter((plan) => plan.fills.length)
        .map((plan) => ({ plan, state: position(plan) }))
    : [];
  const errors = [
    store.error,
    recovery.error,
    revisions.error,
    amendments.error,
    associations.error,
    positionOverrides.error,
    message,
  ].filter(Boolean);

  function openPositionDetail(item: DemoPosition) {
    setDetailId(item.campaignId);
    setAmendmentDefinition(null);
    setAmendmentSource(null);
    setAmendmentDirty(false);
    setPositionMessage("");
  }

  function closePositionDetail() {
    if (
      amendmentDirty &&
      !window.confirm(
        "Discard unsaved amendment edits? The saved draft and confirmed position remain unchanged.",
      )
    )
      return;
    setDetailId(null);
    setAmendmentDefinition(null);
    setAmendmentDirty(false);
  }

  function beginAmendment(item: DemoPosition) {
    const existing = amendments.value.find(
      (value) => value.campaignId === item.campaignId,
    );
    setAmendmentDefinition(
      structuredClone(existing?.requestedDefinition ?? item.exitPlan!),
    );
    setAmendmentSource({
      revision: existing?.sourcePlanRevisionId ?? item.positionRevision,
      quantity: existing?.confirmedOpenQuantity ?? item.openQuantity,
    });
    setAmendmentDirty(false);
    setPositionMessage(
      existing
        ? "Saved unapplied amendment reopened. Confirmed protection remains unchanged."
        : "Unapplied amendment draft started. Confirmed protection remains unchanged.",
    );
  }

  function saveAmendment(item: DemoPosition) {
    if (!amendmentDefinition || !amendmentSource) return;
    try {
      const created = createExitPlanAmendment({
        amendmentId: savedAmendment?.amendmentId ?? crypto.randomUUID(),
        campaignId: item.campaignId,
        sourcePlanRevisionId: amendmentSource.revision,
        confirmedOpenQuantity: amendmentSource.quantity,
        requestedDefinition: amendmentDefinition,
        filledQuantitySnapshot: {},
        createdAt: savedAmendment?.createdAt ?? new Date().toISOString(),
      });
      assertAmendmentMatchesPosition(created, {
        accountId: item.accountId,
        campaignId: item.campaignId,
        instrumentId: item.instrumentId,
        positionRevision: item.positionRevision,
        confirmedOpenQuantity: item.openQuantity,
      });
      const stored: StoredAmendment = {
        ...created,
        accountId: item.accountId,
        instrumentId: item.instrumentId,
        savedAt: new Date().toISOString(),
      };
      if (
        !amendments.save([
          ...amendments.value.filter(
            (value) => value.campaignId !== item.campaignId,
          ),
          stored,
        ])
      )
        throw new Error(
          "Amendment save failed. Your edits remain on screen and the previous draft was not replaced.",
        );
      setAmendmentDirty(false);
      setPositionMessage(
        "Unapplied amendment saved. No confirmed stop, exit, position, or broker order changed.",
      );
    } catch (error) {
      setPositionMessage((error as Error).message);
    }
  }

  function discardAmendment(item: DemoPosition) {
    if (
      !window.confirm(
        "Discard this unapplied amendment draft? Confirmed position records will not change.",
      )
    )
      return;
    if (
      savedAmendment &&
      !amendments.save(
        amendments.value.filter(
          (value) => value.campaignId !== item.campaignId,
        ),
      )
    ) {
      setPositionMessage(
        "Could not discard the saved amendment. Existing records were not changed.",
      );
      return;
    }
    setAmendmentDefinition(null);
    setAmendmentSource(null);
    setAmendmentDirty(false);
    setPositionMessage(
      "Unapplied amendment discarded. Confirmed protection was not changed.",
    );
  }

  function linkToJournal(item: UnlinkedPositionInput, journalTradeId: string) {
    const candidate = linkableJournalTrades.find(
      (value) => value.journalTradeId === journalTradeId,
    );
    if (!candidate?.journalTradeId) {
      setLinkMessage("Choose an eligible Journal trade.");
      return;
    }
    try {
      const association = createPositionAssociation({
        associationId: crypto.randomUUID(),
        accountId: item.accountId,
        instrumentId: item.instrumentId,
        brokerPositionId: item.id,
        journalTradeId: candidate.journalTradeId,
        journalAccountId: candidate.accountId,
        journalInstrumentId: candidate.instrumentId,
        linkedAt: new Date().toISOString(),
        existing: associations.value,
      });
      if (!associations.save([...associations.value, association]))
        throw new Error(
          "Link save failed. The position remains unlinked and your selection is retained.",
        );
      setLinkMessage(
        "Position linked by account and instrument identity. No broker protection or order changed.",
      );
      setLinkingId(null);
    } catch (error) {
      setLinkMessage((error as Error).message);
    }
  }

  function createJournalRecord(item: UnlinkedPositionInput) {
    try {
      if (item.associationEligible === false)
        throw new Error(
          item.missingInformation?.[0] ??
            "This snapshot is incomplete and cannot be associated yet.",
        );
      if (item.averageEntry == null || !Number.isSafeInteger(item.quantity))
        throw new Error(
          "A confirmed whole-share quantity and average cost are required before creating a Journal snapshot.",
        );
      const journalTradeId =
        onCreateJournalTrade?.(item) ?? `journal-${item.id}`;
      const association = createPositionAssociation({
        associationId: crypto.randomUUID(),
        accountId: item.accountId,
        instrumentId: item.instrumentId,
        brokerPositionId: item.id,
        journalTradeId,
        journalAccountId: item.accountId,
        journalInstrumentId: item.instrumentId,
        linkedAt: new Date().toISOString(),
        existing: associations.value,
      });
      if (!associations.save([...associations.value, association]))
        throw new Error(
          "Journal link save failed. The new Journal record was retained, but the position remains unlinked.",
        );
      setLinkMessage(
        "Journal record created and linked. No broker protection or order changed.",
      );
      setLinkingId(null);
    } catch (error) {
      setLinkMessage((error as Error).message);
    }
  }

  const working = effectivePositions.filter(
    (item) => item.status === "Working entry",
  );
  const openPositions = effectivePositions.filter(
    (item) => !["Working entry", "Closed"].includes(item.status),
  );
  const closed = effectivePositions.filter((item) => item.status === "Closed");

  return (
    <section className="consolidated-trading">
      {demo && (
        <div className="simulation-ribbon" role="status">
          <strong>SIMULATED PREVIEW</strong>
          <span>
            Isolated sample records · paper QC remains blocked · no
            broker-confirmed fills
          </span>
        </div>
      )}
      <TradePlanner demo={demo} context={context} onChart={onChart} />
      <section
        className="position-command-center"
        aria-labelledby="position-center-title"
      >
        <header className="position-center-head">
          <div>
            <p className="eyebrow">Saved plans → working entries → positions</p>
            <h2 id="position-center-title">Positions</h2>
            <p>
              Compact broker-shaped state; open a row for execution, risk,
              protection and exits.
            </p>
          </div>
          <div className="position-center-actions">
            <button onClick={() => open(fresh(context))}>
              New advanced plan
            </button>
            <button onClick={() => setShowSaved((value) => !value)}>
              {showSaved ? "Hide" : "Show"} saved plans
            </button>
            <button disabled={!store.ready} onClick={exportPlans}>
              Export records
            </button>
          </div>
        </header>
        {demo ? (
          <p className="simulation-action-note">
            No broker connection · broker submission disabled.
          </p>
        ) : (
          <section className="broker-readonly-status" aria-labelledby="broker-status-title">
            <div>
              <p className="eyebrow">Paper data · read only</p>
              <h3 id="broker-status-title">IBKR connection</h3>
              <span className={`broker-state ${brokerState.dataStatus}`}>
                {brokerState.connectionStatus}
              </span>
            </div>
            <dl>
              <div>
                <dt>Account value</dt>
                <dd>
                  {brokerState.account?.available && brokerState.account.value != null && brokerState.account.currency
                    ? accountMoney(brokerState.account.value, brokerState.account.currency)
                    : "Unavailable"}
                </dd>
                <small>
                  {brokerState.account
                    ? `${brokerState.account.maskedId} · ${brokerState.account.source} · ${brokerState.account.currency ?? "currency unavailable"}`
                    : "No verified account snapshot"}
                </small>
              </div>
              <div>
                <dt>Last successful update</dt>
                <dd>{observedTime(brokerState.lastSuccessfulUpdate)}</dd>
                <small>Manual planner equity and risk defaults are unchanged</small>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>{brokerState.positions.filter((item) => item.snapshotState === "current").length} positions</dd>
                <small>
                  Open orders: {brokerState.openOrders.length === 0 ? "0 · completed empty" : brokerState.openOrders.length}
                </small>
              </div>
            </dl>
            <div className="broker-readonly-actions">
              <button
                disabled={brokerBusy}
                onClick={() => void brokerRequest("/v1/ibkr/read-only/refresh")}
              >
                {brokerBusy ? "Refreshing…" : "Refresh paper data"}
              </button>
              <button
                disabled={brokerBusy || brokerState.connectionStatus === "disconnected"}
                onClick={() => void brokerRequest("/v1/ibkr/read-only/disconnect")}
              >
                Disconnect Brontide
              </button>
            </div>
            {brokerState.error && (
              <p className="broker-refresh-alert" role="alert">
                {brokerState.error} Last completed positions were retained and marked stale.
              </p>
            )}
            {brokerState.dataStatus === "stale" && !brokerState.error && (
              <p className="broker-refresh-alert" role="status">
                Broker data is stale. Displayed positions are retained; no closure is inferred.
              </p>
            )}
            {brokerState.openOrders.length > 0 && (
              <details className="broker-open-orders">
                <summary>{brokerState.openOrders.length} read-only open orders</summary>
                {brokerState.openOrders.map((order) => (
                  <p key={order.id}>
                    {order.symbol} · {order.action} {order.quantity} · {order.orderType} {order.timeInForce} · {order.status}
                  </p>
                ))}
              </details>
            )}
            <p className="simulation-action-note">
              TWS Read-Only remains enabled · submissions disabled · refresh does not bind or alter orders.
            </p>
          </section>
        )}
        {errors.length > 0 && (
          <p className="persistence-alert" role="alert">
            <strong>Persistence blocked.</strong> {errors[0]} Existing records
            were not overwritten.
          </p>
        )}
        {showSaved && (
          <section
            className="saved-plan-rail"
            aria-labelledby="saved-plans-title"
          >
            <div className="section-kicker">
              <h3 id="saved-plans-title">Saved plans</h3>
              <span>Intent · not positions</span>
            </div>
            <div className="saved-plan-grid">
              {savedRows.map((row) => (
                <article key={row.id} className="saved-plan-card">
                  <div>
                    <b>{row.symbol}</b>
                    <span>{row.name}</span>
                  </div>
                  <i className={row.stale ? "stale" : ""}>
                    {row.stale ? "Stale source" : row.state}
                  </i>
                  <dl>
                    <div>
                      <dt>Entry</dt>
                      <dd>{money(row.entry, 2)}</dd>
                    </div>
                    <div>
                      <dt>Stop</dt>
                      <dd>{money(row.stop, 2)}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{row.quantity} sh</dd>
                    </div>
                  </dl>
                  <small>
                    {row.priceSource} · rev {row.revision}
                  </small>
                  {store.value.some((plan) => plan.id === row.id) && (
                    <button
                      onClick={() =>
                        open(store.value.find((plan) => plan.id === row.id)!)
                      }
                    >
                      Open details
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {demo ? (
          <>
            <PositionRows
              title="Working entries"
              meta="Not yet positions"
              items={working}
              onOpen={openPositionDetail}
            />
            <PositionRows
              title="Open positions"
              meta="Recorded execution state"
              items={openPositions}
              onOpen={openPositionDetail}
            />
            <PositionRows
              title="Recently closed"
              meta="Zero confirmed open shares"
              items={closed}
              onOpen={openPositionDetail}
            />
          </>
        ) : (
          <>
            {effectivePositions.length > 0 && (
              <PositionRows
                title="Associated paper positions"
                meta="Exact persisted associations · snapshot state"
                items={effectivePositions}
                onOpen={openPositionDetail}
              />
            )}
            <section aria-labelledby="actual-positions-title">
              <div className="section-kicker">
                <h3 id="actual-positions-title">Recorded positions</h3>
                <span>Manual/imported executions</span>
              </div>
              <div className="position-list">
                {recordedPositions.map(({ plan, state }) => (
                  <article className="position-card" key={plan.id}>
                  <header>
                    <div>
                      <b>{plan.symbol}</b>
                      <span className={`side-pill ${plan.side.toLowerCase()}`}>
                        {plan.side}
                      </span>
                    </div>
                    <i>{state.status}</i>
                  </header>
                  <div className="position-metrics">
                    <span>
                      <small>Entered</small>
                      <strong>{state.entered}</strong>
                    </span>
                    <span>
                      <small>Open</small>
                      <strong>{state.remaining}</strong>
                    </span>
                    <span>
                      <small>Realized</small>
                      <strong>{money(state.realized, 2)}</strong>
                    </span>
                  </div>
                  <p>
                    Manual/imported execution records only; broker confirmation
                    unavailable.
                  </p>
                  <button onClick={() => open(plan)}>
                    Open plan &amp; fills
                  </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {(demo || brokerState.lastSuccessfulUpdate || brokerState.positions.length > 0) && (
          <section
            className="unlinked-positions"
            aria-labelledby="unlinked-title"
          >
            <div className="section-kicker">
              <h3 id="unlinked-title">Unlinked IBKR positions</h3>
              <span>Explicit association only</span>
            </div>
            {linkMessage && (
              <p className="workspace-notice" role="status">
                {linkMessage}
              </p>
            )}
            {brokerPositions.length === 0 && (
              <p className="workspace-notice">No positions in the latest completed snapshot.</p>
            )}
            {brokerPositions.map((item) => {
              const association = associations.value.find(
                (value) => value.brokerPositionId === item.id,
              );
              return (
                <article key={item.id} className={association ? "linked" : ""}>
                  <div>
                    <b>{item.symbol}</b>
                    <span>
                      {item.direction} · {item.quantity} shares @{" "}
                      {item.averageEntry == null ? "average cost unavailable" : money(item.averageEntry, 2)}
                    </span>
                    <small>
                      Account and instrument identity retained
                      {item.stale ? " · stale snapshot" : ""}
                    </small>
                  </div>
                  <strong>
                    {item.marketValue == null ? "Market value unavailable" : money(item.marketValue)}
                  </strong>
                  <div>
                    {association ? (
                      <>
                        <button disabled>Already linked</button>
                        <button
                          onClick={() =>
                            onOpenJournalTrade?.(association.journalTradeId)
                          }
                        >
                          Open Journal
                        </button>
                        <button
                          onClick={() => {
                            const linked = effectivePositions.find(
                              (value) => value.campaignId ===
                                ([...(demo ? DEMO_CAMPAIGNS : []), ...positionCampaigns].find(
                                  (campaign) =>
                                    campaign.journalTradeId === association.journalTradeId,
                                )?.campaignId ?? ""),
                            );
                            if (linked) openPositionDetail(linked);
                          }}
                        >
                          Open position
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={item.associationEligible === false}
                        onClick={() => {
                          setLinkMessage("");
                          const firstCandidate = linkableJournalTrades.find(
                            (candidate) =>
                              candidate.accountId === item.accountId &&
                              candidate.instrumentId === item.instrumentId,
                          );
                          setSelectedJournalTradeId(firstCandidate?.journalTradeId ?? "");
                          setLinkingId(item.id);
                        }}
                      >
                        Link or create record
                      </button>
                    )}
                  </div>
                  <small>
                    {item.snapshotState === "reconciliation-required"
                      ? "Reconciliation required · absent from latest completed snapshot · closure not inferred"
                      : association
                      ? "Linked association only · broker orders unchanged"
                      : item.missingInformation?.[0] ?? "Never auto-linked by ticker · broker protection unchanged"}
                  </small>
                </article>
              );
            })}
          </section>
        )}
      </section>

      {detail && detailNumbers && (
        <PositionDetail
          drawerRef={positionRef}
          item={detail}
          numbers={detailNumbers}
          amendment={savedAmendment}
          definition={amendmentDefinition}
          amendmentDirty={amendmentDirty}
          message={positionMessage}
          onClose={closePositionDetail}
          onBeginAmendment={() => beginAmendment(detail)}
          onDefinition={(next) => {
            setAmendmentDefinition(next);
            setAmendmentDirty(true);
            setPositionMessage("");
          }}
          onSaveAmendment={() => saveAmendment(detail)}
          onDiscardAmendment={() => discardAmendment(detail)}
          onJournal={() =>
            detailNumbers.campaign?.journalTradeId &&
            onOpenJournalTrade?.(detailNumbers.campaign.journalTradeId)
          }
        />
      )}

      {linkingItem && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setLinkingId(null)}
        >
          <section
            ref={linkRef}
            tabIndex={-1}
            className="modal position-link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-position-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Explicit association</p>
                <h2 id="link-position-title">
                  Link {linkingItem.symbol} position
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close position linking"
                onClick={() => setLinkingId(null)}
              >
                ×
              </button>
            </div>
            <p>
              Match the exact account and instrument identity. Linking never
              changes broker protection or orders.
            </p>
            <label>
              Eligible Journal trade
              <select
                aria-label="Eligible Journal trade"
                value={selectedJournalTradeId}
                onChange={(event) =>
                  setSelectedJournalTradeId(event.target.value)
                }
              >
                {linkableJournalTrades.filter(
                  (item) =>
                    item.accountId === linkingItem.accountId &&
                    item.instrumentId === linkingItem.instrumentId,
                ).map((item) => (
                  <option key={item.journalTradeId} value={item.journalTradeId}>
                    {item.label}
                  </option>
                ))}
              </select>
              {!linkableJournalTrades.some(
                (item) =>
                  item.accountId === linkingItem.accountId &&
                  item.instrumentId === linkingItem.instrumentId,
              ) && <small>No exact existing Journal trade is eligible. Create a snapshot record explicitly.</small>}
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setLinkingId(null)}
              >
                Cancel
              </button>
              <button
                className="secondary-button"
                onClick={() => createJournalRecord(linkingItem)}
              >
                Create Journal record
              </button>
              <button
                className="primary-button"
                disabled={!selectedJournalTradeId}
                onClick={() =>
                  linkToJournal(linkingItem, selectedJournalTradeId)
                }
              >
                Link selected trade
              </button>
            </div>
          </section>
        </div>
      )}

      {draft && (
        <aside
          ref={editorRef}
          tabIndex={-1}
          className="integrated-plan-editor"
          role="dialog"
          aria-modal="true"
          aria-label="Saved plan details"
        >
          <header>
            <div>
              <p className="eyebrow">
                {draft.fills.length
                  ? planAmendmentMode
                    ? "Unapplied position amendment"
                    : "Actual position · read only"
                  : "Integrated saved record"}
              </p>
              <h2>
                {draft.name} {dirty && <span>· Unsaved</span>}
              </h2>
            </div>
            <button aria-label="Close saved plan details" onClick={closeEditor}>
              ×
            </button>
          </header>
          {draft.fills.length && !planAmendmentMode && (
            <p className="persistence-alert">
              Recorded executions are not edited as a draft plan. Create an
              amendment to propose new values without changing the position or
              broker orders.
            </p>
          )}
          {draft.fills.length && planAmendmentMode && (
            <p className="workspace-notice" role="status">
              Unapplied amendment draft. Edits stay local and do not change
              protection, executions, or broker orders.
            </p>
          )}
          <div className="plan-fields">
            <label>
              Name
              <input
                disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
              />
            </label>
            <label>
              Ticker
              <input
                disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                value={draft.symbol}
                onChange={(event) =>
                  edit({ symbol: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Direction
              <select
                disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                value={draft.side}
                onChange={(event) =>
                  edit({ side: event.target.value as Plan["side"] })
                }
              >
                <option>Long</option>
                <option>Short</option>
              </select>
            </label>
            <label>
              Entry
              <input
                disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                type="number"
                value={draft.entry || ""}
                onChange={(event) =>
                  edit({ entry: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <div className="editor-actions">
            {!draft.fills.length ? (
              <button disabled={!store.ready || !metrics} onClick={save}>
                Save revision
              </button>
            ) : !planAmendmentMode ? (
              <button
                onClick={() => {
                  setPlanAmendmentMode(true);
                  setMessage(
                    "Unapplied amendment draft started. The recorded position remains unchanged.",
                  );
                }}
              >
                Draft position amendment
              </button>
            ) : (
              <button
                onClick={() =>
                  setMessage(
                    "Amendment retained as an unapplied local draft. No position or broker order changed.",
                  )
                }
              >
                Keep unapplied draft
              </button>
            )}
            <button
              disabled={!draft.symbol}
              onClick={() =>
                onChart(
                  draft.context
                    ? { ...draft.context, symbol: draft.symbol }
                    : {
                        symbol: draft.symbol,
                        mode: "sample",
                        adjustment: "all",
                      },
                )
              }
            >
              Open chart
            </button>
          </div>
          {metrics && (
            <div className="editor-kpis">
              <span>
                Planned <b>{metrics.shares} sh</b>
              </span>
              <span>
                Open <b>{metrics.remaining} sh</b>
              </span>
              <span>
                Risk <b>{money(metrics.risk, 2)}</b>
              </span>
              <span>
                Realized <b>{money(metrics.realized, 2)}</b>
              </span>
            </div>
          )}
          <details open>
            <summary>Protection, targets &amp; runner rules</summary>
            {draft.tranches.map((tranche, index) => (
              <div className="tranche-line" key={tranche.id}>
                <b>{tranche.id}</b>
                <label>
                  Allocation %
                  <input
                    disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                    type="number"
                    value={tranche.percent}
                    onChange={(event) =>
                      edit({
                        tranches: draft.tranches.map((item, current) =>
                          current === index
                            ? { ...item, percent: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Stop
                  <input
                    disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                    type="number"
                    value={tranche.stop || ""}
                    onChange={(event) =>
                      edit({
                        tranches: draft.tranches.map((item, current) =>
                          current === index
                            ? { ...item, stop: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Target
                  <input
                    disabled={Boolean(draft.fills.length && !planAmendmentMode)}
                    type="number"
                    value={tranche.target ?? ""}
                    onChange={(event) =>
                      edit({
                        tranches: draft.tranches.map((item, current) =>
                          current === index
                            ? {
                                ...item,
                                target:
                                  event.target.value === ""
                                    ? null
                                    : Number(event.target.value),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </details>
          <details open>
            <summary>Entry / exit details</summary>
            <div className="fill-list">
              {draft.fills.map((item) => (
                <div key={item.id}>
                  <b>{item.action === "entry" ? "Entry" : "Exit"}</b>
                  <span>
                    {item.quantity} @ {money(item.price, 2)}
                  </span>
                  <span>{new Date(item.at).toLocaleString()}</span>
                  <i>{item.provenance}</i>
                </div>
              ))}
              {!draft.fills.length && <p>No executions recorded.</p>}
            </div>
          </details>
          <div className="manual-fill-form">
            <h3>Record manual execution</h3>
            <label>
              Tranche
              <select
                value={fill.trancheId}
                onChange={(event) =>
                  setFill({ ...fill, trancheId: event.target.value })
                }
              >
                {draft.tranches.map((item) => (
                  <option key={item.id}>{item.id}</option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select
                value={fill.action}
                onChange={(event) =>
                  setFill({
                    ...fill,
                    action: event.target.value as Fill["action"],
                  })
                }
              >
                <option value="entry">Entry</option>
                <option value="exit">Exit</option>
              </select>
            </label>
            <label>
              Shares
              <input
                type="number"
                value={fill.quantity || ""}
                onChange={(event) =>
                  setFill({ ...fill, quantity: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Price
              <input
                type="number"
                value={fill.price || ""}
                onChange={(event) =>
                  setFill({ ...fill, price: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Fee
              <input
                type="number"
                value={fill.fee || ""}
                onChange={(event) =>
                  setFill({ ...fill, fee: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Time
              <input
                type="datetime-local"
                value={fill.at}
                onChange={(event) =>
                  setFill({ ...fill, at: event.target.value })
                }
              />
            </label>
            <button
              disabled={
                dirty ||
                draft.revision === 0 ||
                Boolean(draft.fills.length && planAmendmentMode)
              }
              onClick={record}
            >
              Record manual execution
            </button>
          </div>
          <details>
            <summary>Revision history</summary>
            <pre>
              {JSON.stringify(
                revisions.value.filter((item) => item.plan.id === draft.id),
                null,
                2,
              )}
            </pre>
          </details>
        </aside>
      )}
    </section>
  );
}

function PositionRows({
  title,
  meta,
  items,
  onOpen,
}: {
  title: string;
  meta: string;
  items: DemoPosition[];
  onOpen: (item: DemoPosition) => void;
}) {
  return (
    <section className="position-section" aria-label={title}>
      <div className="section-kicker">
        <h3>{title}</h3>
        <span>
          {meta} · {items.length}
        </span>
      </div>
      <div className="position-list">
        {items.map((item) => {
          const numbers = positionNumbers(item);
          const protection = protectionLabel(item, numbers.openQuantity);
          const unsafe =
            numbers.risk?.unprotectedQuantity || item.status === "Unprotected";
          return (
            <article
              key={item.campaignId}
              className={`position-compact-card ${unsafe ? "danger" : ""}`}
            >
              <button
                className="position-compact-row"
                onClick={() => onOpen(item)}
                aria-label={`Open ${item.symbol} position details`}
              >
                <span className="position-symbol">
                  <b>{item.symbol}</b>
                  <i className={`side-pill ${item.direction.toLowerCase()}`}>
                    {item.direction}
                  </i>
                  {item.changedInIbkr && <em>Changed in IBKR</em>}
                </span>
                <span>
                  <small>Open</small>
                  <strong>{numbers.openQuantity} sh</strong>
                </span>
                <span>
                  <small>Unrealized</small>
                  <strong
                    className={
                      numbers.unrealized == null
                        ? "muted"
                        : numbers.unrealized >= 0
                          ? "positive"
                          : "negative"
                    }
                  >
                    {numbers.unrealized == null
                      ? "Unavailable"
                      : signedMoney(numbers.unrealized)}
                  </strong>
                </span>
                <span
                  className={`compact-protection ${unsafe ? "danger" : ""}`}
                >
                  <small>Protection</small>
                  <strong>{protection}</strong>
                </span>
                <span className="row-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const PositionDetail = ({
  drawerRef,
  item,
  numbers,
  amendment,
  definition,
  amendmentDirty,
  message,
  onClose,
  onBeginAmendment,
  onDefinition,
  onSaveAmendment,
  onDiscardAmendment,
  onJournal,
}: {
  drawerRef: React.RefObject<HTMLElement | null>;
  item: DemoPosition;
  numbers: ReturnType<typeof positionNumbers>;
  amendment?: StoredAmendment;
  definition: ExitPlanDefinition | null;
  amendmentDirty: boolean;
  message: string;
  onClose: () => void;
  onBeginAmendment: () => void;
  onDefinition: (definition: ExitPlanDefinition) => void;
  onSaveAmendment: () => void;
  onDiscardAmendment: () => void;
  onJournal: () => void;
}) => {
  const risk = numbers.risk;
      const frozen =
        numbers.averageEntry && item.fixedInitialStop && item.fixedInitialStop > 0
      ? freezeRiskReference({
          basis: "Execution",
          direction: item.direction,
          entryPrice: numbers.averageEntry,
          fixedStopPrice: item.fixedInitialStop,
          frozenAt:
            numbers.campaign?.executions[0]?.occurredAt ??
            "2026-09-08T14:00:00Z",
        })
      : null;
  return (
    <aside
      ref={drawerRef}
      tabIndex={-1}
      className="integrated-plan-editor position-detail-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.symbol} position details`}
    >
      <header>
        <div>
          <p className="eyebrow">
            {item.simulated
              ? "Recorded position · simulated source"
              : "Associated position · read-only IBKR snapshot"}
          </p>
          <h2>
            {item.symbol}{" "}
            <span className={`side-pill ${item.direction.toLowerCase()}`}>
              {item.direction}
            </span>
          </h2>
        </div>
        <button
          aria-label={`Close ${item.symbol} position details`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="position-detail-status">
        <strong>{item.status}</strong>
        <span className={risk?.unprotectedQuantity ? "danger" : ""}>
          {protectionLabel(item, numbers.openQuantity)}
        </span>
        {item.changedInIbkr && <em>Changed in IBKR</em>}
      </div>
      <section className="position-detail-section">
        <div className="section-kicker">
          <h3>Plan versus recorded execution</h3>
          <span>Original intent remains unchanged</span>
        </div>
        <div className="position-detail-grid">
          <span>
            <small>Planned entry</small>
            <b>{item.plannedEntry == null ? "Unavailable" : money(item.plannedEntry, 2)}</b>
          </span>
          <span>
            <small>Planned quantity</small>
            <b>{item.plannedQuantity == null ? "Unavailable" : `${item.plannedQuantity} sh`}</b>
          </span>
          <span>
            <small>Planned risk</small>
            <b>{item.plannedRisk == null ? "Unavailable" : money(item.plannedRisk, 2)}</b>
          </span>
          <span>
            <small>Actual average entry</small>
            <b>
              {numbers.averageEntry
                ? money(numbers.averageEntry, 2)
                : "Unavailable"}
            </b>
          </span>
          <span>
            <small>Filled entry</small>
            <b>{numbers.filledQuantity == null ? "Unavailable" : `${numbers.filledQuantity} sh`}</b>
          </span>
          <span>
            <small>Exited</small>
            <b>{numbers.exitedQuantity == null ? "Unavailable" : `${numbers.exitedQuantity} sh`}</b>
          </span>
          <span>
            <small>Remaining</small>
            <b>{numbers.openQuantity} sh</b>
          </span>
          <span>
            <small>Realized P&amp;L</small>
            <b className={numbers.realized == null ? "" : numbers.realized >= 0 ? "positive" : "negative"}>
              {numbers.realized == null ? "Unavailable" : signedMoney(numbers.realized)}
            </b>
          </span>
        </div>
      </section>
      <section className="position-detail-section">
        <div className="section-kicker">
          <h3>Risk and valuation</h3>
          <span title="Actual initial risk sums the loss to the fixed stop recorded with each confirmed entry fill.">
            Calculation bases ⓘ
          </span>
        </div>
        <div className="position-detail-grid">
          <span>
            <small>Actual initial risk</small>
            <b>{numbers.actualInitialRisk == null ? "Unavailable" : money(numbers.actualInitialRisk, 2)}</b>
          </span>
          <span>
            <small>Confirmed-stop downside</small>
            <b>{risk ? money(risk.confirmedStopRisk, 2) : "Unavailable"}</b>
          </span>
          <span>
            <small>Total remaining risk</small>
            <b>
              {risk?.totalRemainingRisk == null
                ? "Unavailable"
                : money(risk.totalRemainingRisk, 2)}
            </b>
            <i>
              {risk?.unprotectedQuantity
                ? `${risk.unprotectedQuantity} unprotected shares`
                : "Confirmed stops only"}
            </i>
          </span>
          <span>
            <small>Unrealized P&amp;L</small>
            <b
              className={
                numbers.unrealized == null
                  ? ""
                  : numbers.unrealized >= 0
                    ? "positive"
                    : "negative"
              }
            >
              {numbers.unrealized == null
                ? "Unavailable"
                : signedMoney(numbers.unrealized)}
            </b>
            <i>
              {item.price.status}
              {item.price.observedAt
                ? ` · ${new Date(item.price.observedAt).toLocaleString()}`
                : ""}
            </i>
          </span>
        </div>
        <p
          className={`price-source ${item.price.status !== "Fresh" ? "stale" : ""}`}
        >
          {item.price.source} · {item.price.status}
          {item.price.price != null
            ? ` · ${money(item.price.price, 2)}`
            : " · no valuation price"}
        </p>
      </section>
      <section className="position-detail-section">
        <div className="section-kicker">
          <h3>Protection, targets and runners</h3>
          <span>
            {item.protection.confirmed
              ? "Recorded source confirmation"
              : "Not confirmed"}
          </span>
        </div>
        <div
          className={`protection-status ${risk?.unprotectedQuantity ? "danger" : ""}`}
        >
          <span>
            {item.protection.state} · {item.protection.source}
          </span>
          <b>
            {item.protection.quantity} sh
            {item.protection.stop ? ` @ ${money(item.protection.stop, 2)}` : ""}
          </b>
        </div>
        <div className="position-exits">
          {item.targets.map((target) => (
            <span key={target.label}>
              <b>{target.label}</b> {target.quantity} @ {money(target.price, 2)}{" "}
              <i>{target.state}</i>
            </span>
          ))}
          {item.runner && (
            <span>
              <b>Runner</b> {item.runner.quantity} · {item.runner.rule}
            </span>
          )}
        </div>
      </section>
      {numbers.rollup?.executions.length ? (
        <details open>
          <summary>Recorded executions</summary>
          <div className="fill-list">
            {numbers.rollup.executions.map((execution) => (
              <div key={`${execution.sessionId}:${execution.executionId}`}>
                <b>
                  {execution.effect === "entry"
                    ? "Entry"
                    : `Exit · ${execution.role}`}
                </b>
                <span>
                  {execution.quantity} @ {money(execution.price, 2)}
                </span>
                <span>{new Date(execution.occurredAt).toLocaleString()}</span>
                <i>
                  {execution.provenance === "manual-import"
                    ? "Changed in IBKR"
                    : "Simulated adapter"}
                </i>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <p className="workspace-notice">
          {item.snapshotOnly
            ? "Historical fills, exited quantity, realized P&L and initial risk are unavailable. Current quantity and average entry come only from the identified position snapshot."
            : "No confirmed executions are recorded for this working entry."}
        </p>
      )}
      <div className="editor-actions">
        <button
          disabled={!numbers.campaign?.journalTradeId}
          onClick={onJournal}
        >
          Open Journal trade
        </button>
        {numbers.openQuantity > 0 && item.exitPlan && (
          <button onClick={onBeginAmendment}>
            {amendment ? "Reopen amendment" : "Draft amendment"}
          </button>
        )}
      </div>
      {definition && (
        <section className="position-amendment">
          <div className="section-kicker">
            <h3>Unapplied amendment draft</h3>
            <span>
              Against {numbers.openQuantity} confirmed remaining shares
            </span>
          </div>
          <p className="workspace-notice">
            Current confirmed configuration stays active. Proposed edits below
            are local and unapplied.
          </p>
          {!frozen && (
            <p className="persistence-alert" role="status">
              Execution R is unavailable because historical fills and the fixed
              initial stop are missing. R-based prices and advanced-rule triggers
              cannot be evaluated; this remains an unapplied planning draft.
            </p>
          )}
          <PositionExitPlanControls
            definition={definition}
            direction={item.direction}
            quantity={numbers.openQuantity}
            reference={frozen}
            onChange={onDefinition}
          />
          <div className="editor-actions">
            <button onClick={onSaveAmendment}>
              {amendmentDirty
                ? "Save amendment draft"
                : amendment
                  ? "Save again"
                  : "Save amendment draft"}
            </button>
            <button onClick={onDiscardAmendment}>Discard draft</button>
          </div>
        </section>
      )}
      {message && (
        <p
          className={
            positionMessageIsError(message)
              ? "persistence-alert"
              : "workspace-notice"
          }
          role={positionMessageIsError(message) ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      <small className="simulation-label">
        {item.simulated
          ? "Simulation · not broker confirmation. No broker submission path is enabled."
          : "Read-only position snapshot · historical fills, realized P&L and protection remain unavailable unless separately recorded. No broker submission path is enabled."}
      </small>
    </aside>
  );
};
