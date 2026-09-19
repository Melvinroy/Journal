"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  EXIT_PLAN_SCHEMA_VERSION,
  calculatePositionSize,
  deleteExitPlanPreset,
  deriveStop,
  roundedPlanningStop,
  exitLegQuantities,
  freezeRiskReference,
  loadExitPlanPreset,
  readExitPlanPresetStore,
  renameExitPlanPreset,
  resolvedTarget,
  saveExitPlanPreset,
  targetPrice,
  validateExitPlan,
  writeExitPlanPresetStore,
  type ExitPlanDefinition,
  type ExitPlanLeg,
  type ExitPlanPreset,
  type ExitPlanPresetStore,
  type StopMethod,
  type TradeDirection as TradeSide,
  type TrailingRule,
} from "../lib/trading-domain";
import { demoPlanningMarketSnapshot, loadPlanningMarketSnapshot, type PlanningMarketSnapshot } from "../lib/planner-market-data";
import { demoStorageKey as legacyStorageKey } from "../lib/review-demo";
import {
  resolveExecutionSession,
  sessionDurationOptions,
  validateBrokerReadiness,
  type ExecutionSessionPolicy,
  type OrderDuration,
  type ProtectionOrderType,
  type TradingSessionMode,
} from "../lib/ibkr-paper-adapter";
import type { MarketContext } from "../lib/workspace-state";
import { useModalAccessibility } from "./useModalAccessibility";
import { BrokerConnection } from "./BrokerConnection";
import { PaperQuote } from "./PaperQuote";
import { PaperOrderReview } from "./PaperOrderReview";
import type { PaperExecution } from "./usePaperExecution";
import type { PaperTicket } from "../lib/paper-execution";

import { Disclosure, PlannerWorkspace } from "./WorkspacePresentation";

const RISK_OPTIONS = [.25, .5, .75, 1] as const;
const ALLOCATION_OPTIONS = [3, 5, 10, 15, 20, 25] as const;
const SETTINGS_KEY = "journal.trade-planner.settings.v1";
const DRAFT_KEY = "journal.trade-planner.draft.v1";
const EXIT_KEY = "journal.trade-planner.exits.v1";
const AFTER_FILL_KEY = "journal.trade-planner.after-fill-stage.v1";
const EXIT_PRESET_KEY = "journal.trade-planner.exit-presets.v1";
const TARGET_COUNT_OPTIONS = [1, 2] as const;
const RUNNER_COUNT_OPTIONS = [0, 1, 2] as const;

type StageState = "draft" | "staged";
type TargetCount = (typeof TARGET_COUNT_OPTIONS)[number];
type RunnerCount = (typeof RUNNER_COUNT_OPTIONS)[number];

type SavedSettings = {
  accountEquity: number;
  riskPercent: number;
  maxAllocationPercent: number;
};

type CapturedEntrySource = {
  observedAt: string;
  sessionDate?: string;
  source: "Local EOD close" | "Manual" | "Simulated fixture" | "Legacy" | "IBKR TWS snapshot";
};

type PlannerDraft = Partial<SavedSettings> & {
  executionMethod?: PaperTicket["method"];
  executionQuantity?: number;
  hardCap?: number;
  triggerPrice?: number;
  planRevision?: string;
  atrMultiplier?: number;
  capturedEntrySource?: CapturedEntrySource;
  entryPrice?: number;
  exitPlan?: ExitPlanDefinition | { targetCount?: number; stopCount?: number; runnerEnabled?: boolean };
  marketSnapshot?: PlanningMarketSnapshot | null;
  schemaVersion?: number;
  side?: TradeSide;
  stopPrice?: number;
  stopSource?: StopMethod;
  symbol?: string;
  planId?: string;
  sessionMode?: TradingSessionMode;
  duration?: OrderDuration;
  protectionOrderType?: ProtectionOrderType;
  protectionLimitPrice?: number;
  sessionPolicy?: ExecutionSessionPolicy;
  sizingEquity?: number;
  sizingBasis?: { source: "Fresh broker equity" | "Stale broker estimate" | "Legacy planning equity"; currency: "USD"; value: number; observedAt?: string };
  savedAt?: string;
};

type MarketLoad = {
  error?: string;
  snapshot?: PlanningMarketSnapshot;
  state: "loading" | "ready" | "unavailable" | "legacy";
};

type BrokerIntentCheck = Readonly<{
  state: "unchecked" | "checking" | "validated" | "blocked";
  message: string;
  observedAt?: string;
  quote?: number;
  quoteSide?: "ask" | "bid";
  contractLabel?: string;
  sessionPolicy?: ExecutionSessionPolicy;
}>;

function money(value: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(value) ? value : 0);
}

function price(value: number) {
  return Number.isFinite(value) && value > 0 ? money(value, 2) : "—";
}

function safeNumber(value: string) {
  return Number(value.replace(/,/g, "")) || 0;
}

function makeExitPlan(targetCount: TargetCount = 2, runnerCount: RunnerCount = 1): ExitPlanDefinition {
  const templates: Record<string, number[]> = {
    "1-0": [100], "1-1": [70, 30], "1-2": [35, 35, 30],
    "2-0": [50, 50], "2-1": [35, 35, 30], "2-2": [25, 25, 25, 25],
  };
  const allocations = templates[`${targetCount}-${runnerCount}`];
  const legs: ExitPlanLeg[] = [];
  for (let index = 0; index < targetCount; index += 1) legs.push({ id: `T${index + 1}`, role: "Target", allocationPercent: allocations[index], target: { mode: "R", multipleR: index + 1 } });
  for (let index = 0; index < runnerCount; index += 1) legs.push({ id: `Runner ${String.fromCharCode(65 + index)}`, role: "Runner", allocationPercent: allocations[targetCount + index], activationR: index + 1, trailing: index === 0 ? { mode: "SMA", period: 10 } : { mode: "Percentage", percent: 5 } });
  return { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } }, legs };
}

function legacyExitPlan(value: { targetCount?: number; runnerEnabled?: boolean } | undefined): ExitPlanDefinition {
  const targets: TargetCount = value?.targetCount === 1 ? 1 : 2;
  const runners: RunnerCount = value?.runnerEnabled === false ? 0 : 1;
  return makeExitPlan(targets, runners);
}

function trailingMode(rule: TrailingRule) {
  return rule.mode === "SMA" ? `SMA${rule.period}` : rule.mode;
}

function trailingFromMode(mode: string): TrailingRule {
  if (mode.startsWith("SMA")) return { mode: "SMA", period: Number(mode.slice(3)) as 10 | 20 | 50 };
  if (mode === "Day extreme") return { mode };
  if (mode === "Dollar") return { mode, distance: 1 };
  if (mode === "Percentage") return { mode, percent: 5 };
  return { mode: "Manual", stopPrice: 1 };
}

export function TradePlanner({ storageScope = "unlinked", context, onChart, demo=false, paper, positions, positionCount, exposure }: {storageScope?:string;demo?:boolean;context?:MarketContext;onChart?:(context:MarketContext)=>void;paper?:PaperExecution;positions?:ReactNode;positionCount?:number;exposure?:ReactNode}) {
  const demoStorageKey = (key: string, simulation: boolean) => simulation ? legacyStorageKey(key, true) : `${key}:scope:${storageScope}`;
  const [importEpoch, setImportEpoch] = useState(0);
  const initialSnapshot = demo ? demoPlanningMarketSnapshot("NVDA") : null;
  const [symbol, setSymbol] = useState("NVDA");
  const [side, setSide] = useState<TradeSide>("Long");
  const [entryPrice, setEntryPrice] = useState(initialSnapshot?.close ?? 0);
  const [stopPrice, setStopPrice] = useState(0);
  const [stopSource, setStopSource] = useState<StopMethod>("ATR");
  const [atrMultiplier, setAtrMultiplier] = useState(1);
  const [capturedEntrySource, setCapturedEntrySource] = useState<CapturedEntrySource>(initialSnapshot ? {
    source: "Simulated fixture", observedAt: initialSnapshot.observedAt, sessionDate: initialSnapshot.sessionDate,
  } : { source: "Manual", observedAt: new Date().toISOString() });
  const [marketLoad, setMarketLoad] = useState<MarketLoad>(initialSnapshot ? { state: "ready", snapshot: initialSnapshot } : { state: "loading" });
  const [hydrated, setHydrated] = useState(false);
  const [accountEquity, setAccountEquity] = useState(30000);
  const brokerEquity = paper?.status?.broker?.account;
  const sizingEquity = !demo && brokerEquity?.available && brokerEquity.currency === "USD" && brokerEquity.value != null ? brokerEquity.value : accountEquity;
  const [riskPercent, setRiskPercent] = useState(0.5);
  const [maxAllocationPercent, setMaxAllocationPercent] = useState(15);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SavedSettings>({ accountEquity: 30000, riskPercent: .5, maxAllocationPercent: 15 });
  const [settingsError, setSettingsError] = useState("");
  const settingsRef = useRef<HTMLElement>(null);
  const [stageState, setStageState] = useState<StageState>("draft");
  const [afterFillStaged, setAfterFillStaged] = useState(false);
  const [exitPlan, setExitPlan] = useState<ExitPlanDefinition>(() => makeExitPlan());
  const [exitPlanDirty, setExitPlanDirty] = useState(false);
  const [exitMessage, setExitMessage] = useState("");
  const [presetStore, setPresetStore] = useState<ExitPlanPresetStore>({ schemaVersion: EXIT_PLAN_SCHEMA_VERSION, presets: [] });
  const [presetRaw, setPresetRaw] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetScope, setPresetScope] = useState<"General" | "Symbol">("General");
  const [contextImportPending, setContextImportPending] = useState(false);
  const restoredDraft = useRef(false);
  const entryEdited = useRef(false);
  const planIdentity = useRef("");
  const [brokerIntentCheck, setBrokerIntentCheck] = useState<BrokerIntentCheck>({ state: "unchecked", message: "Save the plan, then validate its current paper-session prerequisites." });
  const [sessionMode, setSessionMode] = useState<TradingSessionMode>("Regular");
  const [duration, setDuration] = useState<OrderDuration>("DAY");
  const [protectionOrderType, setProtectionOrderType] = useState<ProtectionOrderType>("STP");
  const [protectionLimitPrice, setProtectionLimitPrice] = useState(0);
  const [executionMethod, setExecutionMethod] = useState<PaperTicket["method"]>("Limit");
  const [executionQuantity, setExecutionQuantity] = useState(0);
  const [hardCap, setHardCap] = useState(0);
  const [triggerPrice, setTriggerPrice] = useState(0);
  const [planRevision, setPlanRevision] = useState("");
  const [savedPlan, setSavedPlan] = useState<PlannerDraft | null>(null);

  useEffect(() => setContextImportPending(false), [context]);
  useModalAccessibility(settingsOpen, settingsRef, () => setSettingsOpen(false));

  useEffect(() => {
    try {
      const savedSettings = window.localStorage.getItem(demoStorageKey(SETTINGS_KEY,demo));
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as Partial<SavedSettings>;
        if (Number(parsed.accountEquity) > 0) setAccountEquity(Number(parsed.accountEquity));
        if (RISK_OPTIONS.includes(Number(parsed.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(parsed.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(parsed.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(parsed.maxAllocationPercent));
      }

      let hydratedExitPlan: ExitPlanDefinition | null = null;
      const savedExits = window.localStorage.getItem(demoStorageKey(EXIT_KEY,demo));
      if (savedExits) {
        const exits = JSON.parse(savedExits) as { targetCount?: number; stopCount?: number; runnerEnabled?: boolean };
        hydratedExitPlan = legacyExitPlan(exits);
      }
      const savedAfterFill = window.localStorage.getItem(demoStorageKey(AFTER_FILL_KEY,demo));
      if (savedAfterFill) {
        const parsed = JSON.parse(savedAfterFill) as { definition?: ExitPlanDefinition };
        if (parsed.definition) hydratedExitPlan = validateExitPlan(parsed.definition);
        setAfterFillStaged(true);
      }

      const presets = readExitPlanPresetStore(window.localStorage, demoStorageKey(EXIT_PRESET_KEY,demo));
      if (presets.ok) { setPresetStore(presets.store); setPresetRaw(presets.raw); }
      else setExitMessage(presets.error);

      const savedDraft = window.localStorage.getItem(demoStorageKey(DRAFT_KEY,demo));
      if (savedDraft) {
        const draft = JSON.parse(savedDraft) as PlannerDraft;
        setSavedPlan(draft.schemaVersion === 2 ? structuredClone(draft) : null);
        if (draft.planId) planIdentity.current = draft.planId;
        if (["Regular", "RegularExtended", "Overnight", "OvernightDay"].includes(String(draft.sessionMode))) setSessionMode(draft.sessionMode!);
        if (["DAY", "GTC"].includes(String(draft.duration))) setDuration(draft.duration!);
        if (["STP", "STP LMT"].includes(String(draft.protectionOrderType))) setProtectionOrderType(draft.protectionOrderType!);
        if (Number(draft.protectionLimitPrice) > 0) setProtectionLimitPrice(Number(draft.protectionLimitPrice));
        if (draft.symbol) setSymbol(draft.symbol);
        if (["Limit", "Normal", "Breakout"].includes(draft.executionMethod ?? "")) setExecutionMethod(draft.executionMethod!);
        setExecutionQuantity(draft.executionQuantity ?? 0); setHardCap(draft.hardCap ?? 0); setTriggerPrice(draft.triggerPrice ?? 0);
        setPlanRevision(draft.planRevision ?? "legacy");
        if (draft.side === "Long" || draft.side === "Short") setSide(draft.side);
        if (Number(draft.entryPrice) > 0) setEntryPrice(Number(draft.entryPrice));
        if (Number(draft.stopPrice) > 0) setStopPrice(Number(draft.stopPrice));
        if (["ATR", "LoD", "HoD", "Manual"].includes(String(draft.stopSource))) setStopSource(draft.stopSource!);
        if (Number(draft.atrMultiplier) > 0) setAtrMultiplier(Number(draft.atrMultiplier));
        if (draft.capturedEntrySource) setCapturedEntrySource(draft.capturedEntrySource);
        else setCapturedEntrySource({ source: "Legacy", observedAt: String((draft as { savedAt?: string }).savedAt ?? new Date(0).toISOString()) });
        if (draft.marketSnapshot) setMarketLoad({ state: "ready", snapshot: draft.marketSnapshot });
        else setMarketLoad({ state: "legacy", error: "This saved draft has no recorded market-data source." });
        if (Number(draft.accountEquity) > 0) setAccountEquity(Number(draft.accountEquity));
        if (RISK_OPTIONS.includes(Number(draft.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(draft.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(draft.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(draft.maxAllocationPercent));
        if (draft.exitPlan && "schemaVersion" in draft.exitPlan) hydratedExitPlan = validateExitPlan(draft.exitPlan);
        else hydratedExitPlan = legacyExitPlan(draft.exitPlan);
        setStageState("staged");
        restoredDraft.current = true;
      }
      if (hydratedExitPlan) setExitPlan(hydratedExitPlan);
    } catch {
      // Invalid local preferences are ignored and replaced on the next save.
    } finally {
      setHydrated(true);
    }
  }, [demo, storageScope, importEpoch]);

  useEffect(() => {
    if (!hydrated || restoredDraft.current) return;
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9./-]{0,31}$/.test(normalized)) {
      setMarketLoad({ state: "unavailable", error: "Enter a valid ticker to load daily market data." });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMarketLoad({ state: "loading" });
      try {
        const snapshot = demo ? demoPlanningMarketSnapshot(normalized) : await loadPlanningMarketSnapshot(normalized, controller.signal);
        if (!snapshot) throw new Error("No simulated daily data exists for this ticker.");
        setMarketLoad({ state: "ready", snapshot });
        if (!entryEdited.current) {
          setEntryPrice(snapshot.close);
          setCapturedEntrySource({
            source: demo ? "Simulated fixture" : "Local EOD close",
            observedAt: snapshot.observedAt,
            sessionDate: snapshot.sessionDate,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setMarketLoad({ state: "unavailable", error: error instanceof Error ? error.message : "Daily market data is unavailable." });
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [demo, hydrated, symbol]);

  const stopDerivation = useMemo(() => {
    try {
      const snapshot = marketLoad.snapshot;
      if (stopSource !== "Manual" && !snapshot) {
        const label = stopSource === "ATR" ? "ATR" : side === "Long" ? "Day low" : "Day high";
        throw new Error(`${label} is unavailable. ${marketLoad.error ?? "Daily market data is still loading."} Choose Manual to enter an explicit stop.`);
      }
      const derived = deriveStop({
        method: stopSource,
        direction: side,
        capturedEntry: entryPrice,
        atr14: snapshot?.atr14,
        atrMultiplier,
        dayLow: snapshot?.dayLow,
        dayHigh: snapshot?.dayHigh,
        manualStop: stopPrice,
      });
      return { error: "", price: stopSource === "Manual" ? derived : roundedPlanningStop(derived, side) };
    } catch (error) {
      return { error: (error as Error).message, price: stopSource === "Manual" ? stopPrice : 0 };
    }
  }, [atrMultiplier, entryPrice, marketLoad.error, marketLoad.snapshot, side, stopPrice, stopSource]);
  const rawStopPrice = stopDerivation.price || (marketLoad.state === "legacy" && stopSource !== "Manual" ? stopPrice : 0);
  const effectiveStopPrice = rawStopPrice;
  const sessionSelection = useMemo(() => {
    try {
      return { error: "", policy: resolveExecutionSession({ mode: sessionMode, duration, protectionOrderType, protectionStopPrice: effectiveStopPrice, protectionLimitPrice }) };
    } catch (error) {
      return { error: (error as Error).message, policy: undefined };
    }
  }, [duration, effectiveStopPrice, protectionLimitPrice, protectionOrderType, sessionMode]);

  const result = useMemo(() => {
    const empty = { valid:false,error:"Enter the account, entry and stop values to calculate the trade.",riskBudget:0,riskPerShare:0,sharesByRisk:0,sharesByAllocation:0,shares:0,positionValue:0,plannedRisk:0,accountUsePercent:0,actualRiskPercent:0,oneRPrice:0,twoRPrice:0 };
    try {
      if (stopDerivation.error) throw new Error(stopDerivation.error);
      const sized=calculatePositionSize({accountBase:sizingEquity,riskPercent,allocationPercent:maxAllocationPercent,entryPrice,stopPrice:effectiveStopPrice,direction:side});
      if(!sized.shares)return {...empty,error:"The current limits do not allow at least one share."};
      return {...sized,valid:true,error:"",oneRPrice:targetPrice(entryPrice,effectiveStopPrice,1,side),twoRPrice:targetPrice(entryPrice,effectiveStopPrice,2,side)};
    } catch(error) { return {...empty,error:(error as Error).message}; }
  }, [sizingEquity, riskPercent, maxAllocationPercent, entryPrice, effectiveStopPrice, side, stopDerivation.error]);

  const targetCount = exitPlan.legs.filter(leg => leg.role === "Target").length as TargetCount;
  const runnerCount = exitPlan.legs.filter(leg => leg.role === "Runner").length as RunnerCount;
  const allocationTotal = exitPlan.legs.reduce((sum, leg) => sum + leg.allocationPercent, 0);
  const plannedReference = useMemo(() => {
    try { return freezeRiskReference({ basis: "Planned", direction: side, entryPrice, fixedStopPrice: effectiveStopPrice, frozenAt: capturedEntrySource.observedAt }); }
    catch { return null; }
  }, [capturedEntrySource.observedAt, effectiveStopPrice, entryPrice, side]);
  const exitState = useMemo(() => {
    try {
      validateExitPlan(exitPlan);
      if (!result.valid || !plannedReference) throw new Error("Enter a valid entry and initial stop before saving exits.");
      const quantities = exitLegQuantities(result.shares, exitPlan);
      return { error: "", quantities: Object.fromEntries(quantities.map(item => [item.legId, item.quantity])) as Record<string, number> };
    } catch (error) { return { error: (error as Error).message, quantities: {} as Record<string, number> }; }
  }, [exitPlan, plannedReference, result.shares, result.valid]);
  const allocationLimited = result.valid && result.sharesByAllocation < result.sharesByRisk;
  const dataStatus = marketLoad.snapshot?.status === "sample" ? "Sample" : marketLoad.snapshot?.status === "fresh" ? "Fresh" : marketLoad.snapshot?.status === "stale" ? "Stale" : marketLoad.snapshot?.status === "unknown" ? "Freshness unknown" : marketLoad.state === "loading" ? "Loading" : "Unavailable";
  const sessionLabel = marketLoad.snapshot?.sessionDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${marketLoad.snapshot.sessionDate}T12:00:00Z`)) : "No session";

  function saveSettings() {
    if (!Number.isFinite(settingsDraft.accountEquity) || settingsDraft.accountEquity <= 0) {
      setSettingsError("Account equity must be greater than zero.");
      return;
    }
    const settings: SavedSettings = settingsDraft;
    editPlan();
    setAccountEquity(settings.accountEquity);
    setRiskPercent(settings.riskPercent);
    setMaxAllocationPercent(settings.maxAllocationPercent);
    window.localStorage.setItem(demoStorageKey(SETTINGS_KEY,demo), JSON.stringify(settings));
    window.localStorage.removeItem(demoStorageKey(DRAFT_KEY,demo));
    setStageState("draft");
    setSettingsOpen(false);
  }

  function openSettings() {
    setSettingsDraft({ accountEquity, riskPercent, maxAllocationPercent });
    setSettingsError("");
    setSettingsOpen(true);
  }

  function changeSymbol(value: string) {
    editPlan();
    restoredDraft.current = false;
    entryEdited.current = false;
    setSymbol(value.toUpperCase().slice(0, 32));
  }

  function changeSide(next: TradeSide) {
    editPlan();
    if (stopSource === "LoD" || stopSource === "HoD") setStopSource(next === "Long" ? "LoD" : "HoD");
    setSide(next);
  }

  function changeEntry(value: string) {
    editPlan();
    entryEdited.current = true;
    setEntryPrice(safeNumber(value));
    setCapturedEntrySource({ source: "Manual", observedAt: new Date().toISOString() });
  }

  function changeStopMethod(next: StopMethod) {
    editPlan();
    if (next === "Manual") setStopPrice(effectiveStopPrice || stopPrice);
    setStopSource(next);
  }

  function editStopPrice(value: string) {
    editPlan();
    setStopPrice(safeNumber(value));
    setStopSource("Manual");
  }

  function stageEntry() {
    if (!result.valid) return;
    if (!planIdentity.current) planIdentity.current = crypto.randomUUID();
    const revision = crypto.randomUUID();
    const snapshot = {
      schemaVersion: 2,
      planId: planIdentity.current,
      planRevision: revision, executionMethod, executionQuantity: executionQuantity || result.shares,
      hardCap: hardCap || entryPrice, triggerPrice,
      symbol: symbol.trim().toUpperCase(), side, entryPrice, stopPrice: effectiveStopPrice, stopSource,
      atrMultiplier, capturedEntrySource, marketSnapshot: marketLoad.snapshot ?? null,
      accountEquity, sizingEquity, riskPercent, maxAllocationPercent, result,
      sizingBasis: { source: brokerEquity?.available && brokerEquity.currency === "USD"
        ? paper?.status?.connected && paper.status.broker?.dataStatus === "fresh" ? "Fresh broker equity" as const : "Stale broker estimate" as const
        : "Legacy planning equity" as const,
        currency: "USD" as const, value: sizingEquity, ...(brokerEquity?.observedAt ? { observedAt: brokerEquity.observedAt } : {}) },
      exitPlan, sessionMode, duration, protectionOrderType, protectionLimitPrice,
      sessionPolicy: sessionSelection.policy,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(demoStorageKey(DRAFT_KEY,demo), JSON.stringify(snapshot));
    setSavedPlan(JSON.parse(JSON.stringify(snapshot)));
    setStageState("staged");
    setPlanRevision(revision);
    setBrokerIntentCheck({ state: "unchecked", message: "Saved locally. Broker validation has not run and no order was submitted." });
  }

  function cancelStage() {
    window.localStorage.removeItem(demoStorageKey(DRAFT_KEY,demo));
    setStageState("draft");
    restoredDraft.current = false;
  }

  function editPlan() {
    if (stageState !== "staged") return;
    window.localStorage.removeItem(demoStorageKey(DRAFT_KEY,demo));
    setStageState("draft");
    setBrokerIntentCheck({ state: "unchecked", message: "Plan changed. Save and validate the new revision before any submission review." });
  }

  async function validatePaperPrerequisites() {
    if (stageState !== "staged" || !result.valid || exitState.error) {
      setBrokerIntentCheck({ state: "blocked", message: "Save a valid plan and exit allocation before broker validation." });
      return;
    }
    if (!sessionSelection.policy?.submissionEligible) {
      setBrokerIntentCheck({ state: "blocked", message: sessionSelection.policy?.blockedReason ?? sessionSelection.error ?? "The selected session is not eligible for submission." });
      return;
    }
    setBrokerIntentCheck({ state: "checking", message: "Checking the qualified contract, minimum tick and executable-side quote…" });
    try {
      const now = new Date();
      if (!demo) throw new Error("Use the local authenticated planner to review a paper order.");
      const payload = {
        observedAt: now.toISOString(), contract: { conId: 265598, symbol: symbol.trim().toUpperCase(), secType: "STK" as const, exchange: "SMART", currency: "USD", minimumTick: .01 },
        quote: { bid: entryPrice - .01, ask: entryPrice + .01, complete: true }, executable: true, source: "Simulated fixture", sessionPolicy: sessionSelection.policy,
      };
      const checked = validateBrokerReadiness({
        contract: payload.contract, expectedSymbol: symbol, direction: side, planningPrice: entryPrice,
        quote: { bid: payload.quote.bid, ask: payload.quote.ask, observedAt: payload.observedAt }, now: now.toISOString(),
        maximumQuoteAgeMs: 15_000, maximumPriceDriftPercent: .5,
      });
      setBrokerIntentCheck({
        state: "validated",
        message: `${demo ? "Simulated prerequisite check" : "Read-only paper prerequisites"} passed. Submission remains locked; saving a plan did not send an order.`,
        observedAt: checked.quote.observedAt, quote: checked.executableQuote, quoteSide: checked.quoteSide,
        contractLabel: `${checked.contract.symbol} · conId ${checked.contract.conId} · tick ${checked.contract.minimumTick}`,
        sessionPolicy: payload.sessionPolicy ?? { ...sessionSelection.policy, effectiveCoverage: demo ? "Sep 10, 2026 09:30–16:00 America/New_York" : sessionSelection.policy.effectiveCoverage, expiresAt: demo && duration === "DAY" ? "2026-09-10T20:00:00Z" : sessionSelection.policy.expiresAt, scheduleSource: demo ? "Planning preview" : sessionSelection.policy.scheduleSource },
      });
    } catch (error) {
      setBrokerIntentCheck({ state: "blocked", message: `${(error as Error).message} No intent was submitted.` });
    }
  }

  function editExitPlan(next: ExitPlanDefinition) {
    setExitPlan(next); setExitPlanDirty(true); setExitMessage("");
  }

  function changeStructure(nextTargets: TargetCount, nextRunners: RunnerCount) {
    editExitPlan({ ...makeExitPlan(nextTargets, nextRunners), breakeven: exitPlan.breakeven });
  }

  function updateLeg(index: number, next: ExitPlanLeg) {
    editExitPlan({ ...exitPlan, legs: exitPlan.legs.map((leg, legIndex) => legIndex === index ? next : leg) });
  }

  function stageAfterFill() {
    if (exitState.error) { setExitMessage(exitState.error); return; }
    try {
      const revision = crypto.randomUUID();
      const savedEntry = window.localStorage.getItem(demoStorageKey(DRAFT_KEY,demo));
      if (savedEntry) {
        const snapshot = { ...JSON.parse(savedEntry), exitPlan, planRevision: revision, savedAt: new Date().toISOString() } as PlannerDraft;
        window.localStorage.setItem(demoStorageKey(DRAFT_KEY,demo), JSON.stringify(snapshot));
        setSavedPlan(snapshot);
      }
      window.localStorage.setItem(demoStorageKey(AFTER_FILL_KEY,demo), JSON.stringify({ schemaVersion: EXIT_PLAN_SCHEMA_VERSION, definition: exitPlan, savedAt: new Date().toISOString() }));
      setPlanRevision(revision); setAfterFillStaged(true); setExitPlanDirty(false); setExitMessage("Exit-plan draft saved locally. No broker action was applied.");
    } catch { setExitMessage("Exit-plan save failed. Your edits remain on screen and the saved plan was not replaced."); }
  }

  function cancelAfterFill() {
    window.localStorage.removeItem(demoStorageKey(AFTER_FILL_KEY,demo));
    setAfterFillStaged(false); setExitPlanDirty(false); setExitMessage("Saved exit plan removed. Current fields remain an unsaved draft.");
  }

  function persistPresets(nextPresets: readonly ExitPlanPreset[]) {
    const nextStore: ExitPlanPresetStore = { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, presets: nextPresets };
    const written = writeExitPlanPresetStore(window.localStorage, demoStorageKey(EXIT_PRESET_KEY,demo), presetRaw, nextStore);
    if (!written.ok) { setExitMessage(written.error); return false; }
    setPresetStore(nextStore); setPresetRaw(written.raw); return true;
  }

  function savePreset() {
    try {
      validateExitPlan(exitPlan);
      const now = new Date().toISOString();
      const preset: ExitPlanPreset = { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, presetId: crypto.randomUUID(), name: presetName.trim(), scope: presetScope, ...(presetScope === "Symbol" ? { symbol: symbol.trim().toUpperCase() } : {}), definition: exitPlan, createdAt: now, updatedAt: now };
      const next = saveExitPlanPreset(presetStore.presets, preset);
      if (persistPresets(next)) { setSelectedPresetId(preset.presetId); setPresetName(""); setExitMessage(`Preset “${preset.name}” saved. The current draft and saved plans were not changed.`); }
    } catch (error) { setExitMessage((error as Error).message); }
  }

  function loadPreset() {
    const preset = presetStore.presets.find(item => item.presetId === selectedPresetId);
    if (!preset) { setExitMessage("Choose a preset to load."); return; }
    try { editExitPlan(loadExitPlanPreset(preset)); setExitMessage(`Preset “${preset.name}” loaded into this unsaved draft only.`); }
    catch (error) { setExitMessage((error as Error).message); }
  }

  function renamePreset() {
    try {
      const next = renameExitPlanPreset(presetStore.presets, selectedPresetId, presetName.trim(), new Date().toISOString());
      if (persistPresets(next)) { setPresetName(""); setExitMessage("Preset renamed. Saved plans and the current draft were not changed."); }
    } catch (error) { setExitMessage((error as Error).message); }
  }

  function removePreset() {
    try {
      const next = deleteExitPlanPreset(presetStore.presets, selectedPresetId);
      if (persistPresets(next)) { setSelectedPresetId(""); setExitMessage("Preset deleted. Saved plans and the current draft were not changed."); }
    } catch (error) { setExitMessage((error as Error).message); }
  }

  return (
    <div className="trade-planner">
      <BrokerConnection paper={paper} demo={demo} />
      <header className="trade-commandbar">
        <div><h1>Trade planner</h1><Link href="/verification/" target="_blank" rel="noopener noreferrer" title="Open verification in a new tab; keep this draft open">Verification</Link></div>
        <div className="trade-risk-banner" aria-label="Risk controls">
          <span>Risk <strong>{riskPercent.toFixed(2)}%</strong></span>
          <i aria-hidden="true"/>
          <span>Alloc. <strong>{maxAllocationPercent}%</strong></span>
          <button type="button" onClick={openSettings}>Change</button>
        </div>
      </header>
      {context && <p className="workspace-notice">Chart context: {context.symbol} · {context.mode} · {context.adjustment}{context.asOf?` · ${context.asOf}`:""}{context.tradeDraft?` · long ${price(context.tradeDraft.entry)} / stop ${price(context.tradeDraft.stop)} / ${context.tradeDraft.targets.length} target${context.tradeDraft.targets.length===1?"":"s"}`:""}. Existing saved plan was not changed. {!contextImportPending?<button onClick={()=>setContextImportPending(true)}>{context.tradeDraft?"Load drawing":"Use instrument"}</button>:<span role="alert"> Load into the current draft? <button disabled={Boolean(paper && context.mode === "sample")} title={paper && context.mode === "sample" ? "Sample chart data cannot enter paper execution" : undefined} onClick={()=>{editPlan();restoredDraft.current=false;entryEdited.current=Boolean(context.tradeDraft);setSymbol(context.symbol);setSide(context.tradeDraft?.side??"Long");setEntryPrice(context.tradeDraft?.entry??0);setStopPrice(context.tradeDraft?.stop??0);setStopSource(context.tradeDraft?"Manual":"ATR");setCapturedEntrySource({source:context.tradeDraft?"Manual":context.mode==="sample"?"Simulated fixture":"Local EOD close",observedAt:new Date().toISOString(),sessionDate:context.asOf});if(context.tradeDraft?.targets.length){const count=Math.min(2,context.tradeDraft.targets.length) as TargetCount;const imported=makeExitPlan(count,runnerCount);editExitPlan({...imported,legs:imported.legs.map((leg,index)=>leg.role==="Target"&&context.tradeDraft?.targets[index]?{...leg,target:{mode:"Price",price:context.tradeDraft.targets[index]}}:leg)});}setContextImportPending(false);}}>Confirm import</button> <button onClick={()=>setContextImportPending(false)}>Cancel</button></span>} <button onClick={()=>onChart?.(context)}>Open chart</button></p>}

      <section className="trade-actionbar" aria-label="Quick trade actions">
        <button type="button" className={`trade-action-button entry ${stageState === "staged" ? "cancel" : ""}`} disabled={stageState === "draft" && (!result.valid || !symbol.trim())} onClick={stageState === "staged" ? cancelStage : stageEntry}>
          {stageState === "staged" ? "Unsave plan" : "Save plan"}
        </button>
        <button type="button" className={`trade-action-button exits ${afterFillStaged && !exitPlanDirty ? "active" : ""}`} disabled={!result.valid} onClick={afterFillStaged && !exitPlanDirty ? cancelAfterFill : stageAfterFill}>
          {afterFillStaged && !exitPlanDirty ? "Unsave exits" : "Save exits"}
        </button>
        {paper && !demo && <PaperOrderReview paper={paper} saved={(executionQuantity === 0 || executionQuantity <= result.shares) && stageState === "staged" && afterFillStaged && !exitPlanDirty && !exitState.error && Boolean(planRevision)} ticket={{
          planId: planIdentity.current, planRevision, savedPlan: savedPlan ?? undefined, planningSource: capturedEntrySource.source, symbol: symbol.trim().toUpperCase(), direction: side,
          method: executionMethod, quantity: executionQuantity || result.shares, planningPrice: entryPrice, hardCap: hardCap || entryPrice,
          ...(executionMethod === "Breakout" ? { triggerPrice } : {}), stopPrice: effectiveStopPrice, cleanupFloor: effectiveStopPrice,
          sessionMode, duration, protectionOrderType, ...(protectionOrderType === "STP LMT" ? { protectionLimitPrice } : {}), exitPlan,
        }} />}
        <span className="trade-execution-state">{paper ? "Save drafts, then review the exact paper order" : "Draft only · no broker order"}</span>
      </section>

      {paper && !demo && <p className="trade-execution-state">Sizing basis: {brokerEquity?.available && brokerEquity.currency === "USD" ? `${paper.status?.connected && paper.status.broker?.dataStatus === "fresh" ? "Broker equity" : "Last-known broker equity · draft estimate"} ${money(sizingEquity)}` : `Legacy planning equity ${money(accountEquity)} · estimate only`}. Fresh broker funds are required for review.</p>}
      <PlannerWorkspace positions={positions} count={positionCount} exposure={exposure} scope={demo ? "demo" : storageScope}>
      <section className="trade-ticket" aria-labelledby="trade-ticket-title">
        <div className="trade-ticket-head">
          <div><h2 id="trade-ticket-title">Trade setup</h2></div>
          <span className={`trade-draft-state ${stageState === "staged" ? "staged" : ""}`}><i/> {stageState === "staged" ? "Saved locally" : "Draft"}</span>
        </div>

        <div className="trade-ticket-body">
          <div className="trade-input-grid">
            <label>Symbol<input className="trade-symbol-input" value={symbol} onChange={(event) => changeSymbol(event.target.value)} placeholder="NVDA" aria-label="Stock symbol"/></label>
            <div className="trade-field"><span>Side</span><span className="trade-side-control" role="group" aria-label="Trade side"><button type="button" aria-pressed={side === "Long"} className={side === "Long" ? "active" : ""} onClick={() => changeSide("Long")}>Long</button><button type="button" aria-pressed={side === "Short"} className={side === "Short" ? "active" : ""} onClick={() => changeSide("Short")}>Short</button></span></div>
            <label>Entry price<span className="trade-price-control"><span>$</span><input inputMode="decimal" value={entryPrice || ""} onChange={(event) => changeEntry(event.target.value)} aria-label="Captured planning entry price"/></span></label>
            <label>Initial stop<span className={`trade-combined-control ${stopSource === "ATR" ? "with-multiplier" : ""}`}><select value={stopSource} onChange={(event) => changeStopMethod(event.target.value as StopMethod)} aria-label="Stop method"><option value="ATR">ATR</option><option value={side === "Long" ? "LoD" : "HoD"}>{side === "Long" ? "Day low" : "Day high"}</option><option value="Manual">Manual</option></select>{stopSource === "ATR" && <input className="trade-atr-multiplier" inputMode="decimal" value={atrMultiplier || ""} min="0" aria-label="ATR multiplier" onChange={(event)=>{editPlan();setAtrMultiplier(safeNumber(event.target.value));}}/>}<input inputMode="decimal" value={effectiveStopPrice || ""} onChange={(event) => editStopPrice(event.target.value)} aria-label="Stop price" aria-describedby="initial-stop-context"/></span></label>
          </div>

          {paper && !demo && <>
        <PaperQuote paper={paper} symbol={symbol.trim().toUpperCase()} side={side} onApply={(value, observedAt) => {
          editPlan(); entryEdited.current = true; setEntryPrice(value); setHardCap(value);
          setCapturedEntrySource({source: "IBKR TWS snapshot", observedAt});
        }} />
        <div className="broker-execution-fields">
          <label>Order method<select aria-label="Order method" value={executionMethod} onChange={e => { editPlan(); setExecutionMethod(e.target.value as PaperTicket["method"]); }}><option value="Limit">Limit</option><option value="Normal">Capped midpoint</option><option value="Breakout">Stop-limit breakout</option></select></label>
          <label>Requested shares<input aria-label="Requested shares" type="number" min="1" step="1" placeholder={`Calculated: ${result.shares}`} value={executionQuantity || ""} onChange={e => { editPlan(); setExecutionQuantity(safeNumber(e.target.value)); }} /></label>
          <label>Entry price cap<input aria-label="Entry price cap" type="number" min="0.0001" step="any" value={hardCap || entryPrice || ""} onChange={e => { editPlan(); setHardCap(safeNumber(e.target.value)); }} /></label>
          {executionMethod === "Breakout" && <label>Entry trigger<input aria-label="Entry trigger" type="number" min="0.0001" step="any" value={triggerPrice || ""} onChange={e => { editPlan(); setTriggerPrice(safeNumber(e.target.value)); }} /></label>}
        </div>
        <p className="trade-exit-help">Calculated size {result.shares} shares · requested {executionQuantity || result.shares}. Quantity is never reduced automatically.</p>
        {executionQuantity > result.shares && <p role="alert">Requested paper quantity must not exceed calculated sizing.</p>}
          </>}

          <div className="trade-context-line" id="initial-stop-context">
            <span>{stopSource === "ATR" ? `ATR ${marketLoad.snapshot ? price(marketLoad.snapshot.atr14) : "—"} × ${atrMultiplier || "—"}` : stopSource === "Manual" ? `Manual stop · ${capturedEntrySource.source === "Legacy" ? "saved legacy value" : "operator supplied"}` : marketLoad.snapshot ? `${sessionLabel} completed-session ${side === "Long" ? "low" : "high"} ${price(side === "Long" ? marketLoad.snapshot.dayLow : marketLoad.snapshot.dayHigh)}` : `${side === "Long" ? "Day low" : "Day high"} unavailable`}</span>
            <span>{marketLoad.snapshot ? `${marketLoad.snapshot.source} · ${sessionLabel} · ${dataStatus}` : `${capturedEntrySource.source} · ${dataStatus}`}</span>
            <span>Risk/share <b>{price(result.riskPerShare)}</b></span>
            <span>Stop distance <b>{entryPrice > 0 ? `${(result.riskPerShare / entryPrice * 100).toFixed(2)}%` : "—"}</b></span>
          </div>

          <fieldset className="trade-session-panel" aria-describedby="trade-session-summary">
            <legend>Execution session</legend>
            <label>Coverage<select aria-label="Trading session" value={sessionMode} onChange={(event)=>{editPlan();const next=event.target.value as TradingSessionMode;setSessionMode(next);if(!sessionDurationOptions(next).includes(duration))setDuration("DAY");}}><option value="Regular">Regular hours</option><option value="RegularExtended">Regular + extended</option><option value="Overnight">Overnight only</option><option value="OvernightDay">Overnight + following day</option></select></label>
            <label>Duration<select aria-label="Order duration" value={duration} onChange={(event)=>{editPlan();setDuration(event.target.value as OrderDuration);}}>{sessionDurationOptions(sessionMode).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
            <span className="trade-session-static"><small>Entry / route</small><b>{paper && !demo ? ({Limit: "Limit", Normal: "Capped midpoint", Breakout: "Stop-limit breakout"} as const)[executionMethod] : sessionSelection.policy?.entryOrderType ?? "—"} · {sessionSelection.policy?.route ?? "—"}</b></span>
            <label>Protection<select aria-label="Protection order type" value={protectionOrderType} onChange={(event)=>{editPlan();setProtectionOrderType(event.target.value as ProtectionOrderType);}}><option value="STP">Stop</option><option value="STP LMT">Stop limit</option></select></label>
            {protectionOrderType === "STP LMT" && <label>Protection limit<input aria-label="Protection limit price" inputMode="decimal" value={protectionLimitPrice || ""} onChange={(event)=>{editPlan();setProtectionLimitPrice(safeNumber(event.target.value));}}/></label>}
          </fieldset>
          {(sessionSelection.policy?.blockedReason || sessionSelection.error) && <p className="trade-validation" role="alert">{sessionSelection.policy?.blockedReason || sessionSelection.error}</p>}
          {protectionOrderType === "STP LMT" && <p className="trade-validation">A triggered stop-limit may remain unfilled. Planned risk is not a guaranteed loss cap.</p>}
          <Disclosure title="Session details" name="session-details" scope={demo ? "demo" : storageScope}>
          <div id="trade-session-summary" className={`trade-session-summary ${sessionSelection.policy?.submissionEligible ? "" : "blocked"}`} role={sessionSelection.policy?.submissionEligible ? "status" : "alert"}>
            <span><b>{brokerIntentCheck.sessionPolicy?.effectiveCoverage ?? sessionSelection.policy?.effectiveCoverage ?? "Session schedule will be verified from the broker contract before submission."}</b>{brokerIntentCheck.sessionPolicy?.expiresAt ? ` · expires ${new Date(brokerIntentCheck.sessionPolicy.expiresAt).toLocaleString()}` : sessionSelection.policy?.expiresAt ? ` · ${sessionSelection.policy.expiresAt}` : ""}</span>
            <span>{(sessionSelection.policy?.blockedReason ?? sessionSelection.error) || `${sessionSelection.policy?.protectionOrderType} protection is ${sessionSelection.policy?.protectionOutsideRth ? "eligible during the selected extended schedule when broker-confirmed" : "eligible only during its verified regular-hours schedule"}.`}</span>
            {protectionOrderType === "STP LMT" && <small>A triggered stop-limit may remain unfilled. Planned stop risk is a sizing reference, not a guaranteed loss cap.</small>}
          </div>
          </Disclosure>

          {!result.valid && <p className="trade-validation trade-entry-validation" role="alert">{result.error}</p>}

          <div className="trade-result-strip" aria-label="Position sizing result">
            <div><span>Shares</span><strong>{result.valid ? result.shares.toLocaleString() : "—"}</strong></div>
            <div><span>Position</span><strong>{result.valid ? money(result.positionValue) : "—"}</strong></div>
            <div><span>Planned risk</span><strong>{result.valid ? money(result.plannedRisk) : "—"}</strong><small>{result.valid ? `${result.actualRiskPercent.toFixed(2)}% of account` : ""}</small></div>
            <div><span>Account use</span><strong>{result.valid ? `${result.accountUsePercent.toFixed(1)}%` : "—"}</strong><small>{allocationLimited ? "Allocation cap applied" : "Risk cap applied"}</small></div>
          </div>

          <div className="trade-protection-row">
            <div><b>Initial protection</b><span>Full-position {protectionOrderType === "STP LMT" ? `stop-limit at ${price(effectiveStopPrice)} / limit ${price(protectionLimitPrice)}` : `stop at ${price(effectiveStopPrice)}`} · {sessionSelection.policy?.submissionEligible ? "planned, not broker acknowledged" : "submission inactive"}</span></div>
            <strong>{result.valid ? `${result.shares.toLocaleString()} shares` : "—"}</strong>
          </div>

        </div>
      </section>

      <section className="trade-ticket trade-after-fill-ticket" aria-labelledby="after-fill-title">
        <div className="trade-ticket-head">
          <div><p className="eyebrow">{afterFillStaged && !exitPlanDirty ? "Saved locally" : "Unsaved draft"}</p><h2 id="after-fill-title">After-fill plan</h2></div>
          <span className="trade-plan-summary">{targetCount} target{targetCount === 1 ? "" : "s"} · {runnerCount} runner{runnerCount === 1 ? "" : "s"} · {allocationTotal}%</span>
        </div>
        <div className="trade-ticket-body trade-exit-details">
          <div className="trade-exit-config">
            <div><span>Targets</span><div className="trade-count-control" role="group" aria-label="Target count">{TARGET_COUNT_OPTIONS.map(count => <button type="button" key={count} aria-pressed={targetCount === count} className={targetCount === count ? "active" : ""} onClick={() => changeStructure(count,runnerCount)}>{count}</button>)}</div></div>
            <div><span>Runners</span><div className="trade-count-control" role="group" aria-label="Runner count">{RUNNER_COUNT_OPTIONS.map(count => <button type="button" key={count} aria-pressed={runnerCount === count} className={runnerCount === count ? "active" : ""} onClick={() => changeStructure(targetCount,count)}>{count}</button>)}</div></div>
            <div className="trade-allocation-total"><span>Allocation</span><strong className={Math.abs(allocationTotal - 100) > 1e-9 ? "invalid" : ""}>{allocationTotal}% · {result.valid ? `${result.shares} shares` : "—"}</strong></div>
          </div>
          <div className="trade-rule-panel">
            <div className="trade-rule-title"><div><b>Price-based breakeven</b><span>Independent of target fills</span></div></div>
            <div className="trade-rule-fields">
              <label>Activate at<select aria-label="Breakeven activation" value={[1,2,3].includes(exitPlan.breakeven.activationR) ? String(exitPlan.breakeven.activationR) : "custom"} onChange={event=>editExitPlan({...exitPlan,breakeven:{...exitPlan.breakeven,activationR:event.target.value==="custom"?1.1:Number(event.target.value)}})}><option value="1">1R</option><option value="2">2R</option><option value="3">3R</option><option value="custom">Custom</option></select></label>
              {![1,2,3].includes(exitPlan.breakeven.activationR)&&<label>Custom R<input aria-label="Custom breakeven R" type="number" min="0" step="0.1" value={exitPlan.breakeven.activationR||""} onChange={event=>editExitPlan({...exitPlan,breakeven:{...exitPlan.breakeven,activationR:Number(event.target.value)}})}/></label>}
              <label>Favorable offset<span className="trade-inline-fields"><select aria-label="Breakeven offset unit" value={exitPlan.breakeven.favorableOffset.unit} onChange={event=>editExitPlan({...exitPlan,breakeven:{...exitPlan.breakeven,favorableOffset:{...exitPlan.breakeven.favorableOffset,unit:event.target.value as "Dollar"|"R"}}})}><option value="Dollar">$ / share</option><option value="R">R</option></select><input aria-label="Breakeven offset value" type="number" min="0" step="0.1" value={exitPlan.breakeven.favorableOffset.value} onChange={event=>editExitPlan({...exitPlan,breakeven:{...exitPlan.breakeven,favorableOffset:{...exitPlan.breakeven.favorableOffset,value:Number(event.target.value)}}})}/></span></label>
            </div>
          </div>

          <div className="trade-leg-list">
            {exitPlan.legs.map((leg,index)=>{
              const quantity=exitState.quantities[leg.id];
              if(leg.role==="Target"){
                let resolved: ReturnType<typeof resolvedTarget>|null=null;
                try { if(plannedReference) resolved=resolvedTarget(leg.target,plannedReference); } catch {}
                return <div className="trade-leg-row target" key={leg.id}>
                  <div className="trade-leg-name"><b>{leg.id}</b><span>{quantity ? `${quantity} sh` : "—"}</span></div>
                  <label>Allocation %<input aria-label={`${leg.id} allocation percent`} type="number" min="0" step="1" value={leg.allocationPercent||""} onChange={event=>updateLeg(index,{...leg,allocationPercent:Number(event.target.value)})}/></label>
                  <label>Input<select aria-label={`${leg.id} authoritative input`} value={leg.target.mode} onChange={event=>{const mode=event.target.value as "R"|"Price";const target=mode==="R"?{mode,multipleR:resolved?.multipleR??1} as const:{mode,price:resolved?.price??entryPrice} as const;updateLeg(index,{...leg,target});}}><option value="R">R</option><option value="Price">Price</option></select></label>
                  <label>{leg.target.mode==="R"?"Target R":"Target price"}<input aria-label={`${leg.id} ${leg.target.mode === "R" ? "target R" : "target price"}`} type="number" min="0" step="0.1" value={leg.target.mode==="R"?leg.target.multipleR:leg.target.price} onChange={event=>updateLeg(index,{...leg,target:leg.target.mode==="R"?{mode:"R",multipleR:Number(event.target.value)}:{mode:"Price",price:Number(event.target.value)}})}/></label>
                  <span className="trade-linked-value">{resolved ? `${resolved.multipleR.toFixed(2)}R · ${price(resolved.price)}` : "Invalid target"}<small>{leg.target.mode} authoritative</small></span>
                </div>;
              }
              return <div className="trade-leg-row runner" key={leg.id}>
                <div className="trade-leg-name"><b>{leg.id}</b><span>{quantity ? `${quantity} sh` : "—"}</span></div>
                <label>Allocation %<input aria-label={`${leg.id} allocation percent`} type="number" min="0" step="1" value={leg.allocationPercent||""} onChange={event=>updateLeg(index,{...leg,allocationPercent:Number(event.target.value)})}/></label>
                <label>Activate R<input aria-label={`${leg.id} activation R`} type="number" min="0" step="0.1" value={leg.activationR||""} onChange={event=>updateLeg(index,{...leg,activationR:Number(event.target.value)})}/></label>
                <label>Trail<select aria-label={`${leg.id} trailing method`} value={trailingMode(leg.trailing)} onChange={event=>updateLeg(index,{...leg,trailing:trailingFromMode(event.target.value)})}><option value="SMA10">10 SMA</option><option value="SMA20">20 SMA</option><option value="SMA50">50 SMA</option><option value="Day extreme">{side==="Long"?"Day low":"Day high"}</option><option value="Dollar">$ distance</option><option value="Percentage">Percent</option><option value="Manual">Manual stop</option></select></label>
                {leg.trailing.mode==="Dollar"&&<label>Distance $<input aria-label={`${leg.id} dollar distance`} type="number" min="0" step="0.1" value={leg.trailing.distance||""} onChange={event=>updateLeg(index,{...leg,trailing:{mode:"Dollar",distance:Number(event.target.value)}})}/></label>}
                {leg.trailing.mode==="Percentage"&&<label>Distance %<input aria-label={`${leg.id} trailing percent`} type="number" min="0" step="0.1" value={leg.trailing.percent||""} onChange={event=>updateLeg(index,{...leg,trailing:{mode:"Percentage",percent:Number(event.target.value)}})}/></label>}
                {leg.trailing.mode==="Manual"&&<label>Stop price<input aria-label={`${leg.id} manual trail stop`} type="number" min="0" step="0.01" value={leg.trailing.stopPrice||""} onChange={event=>updateLeg(index,{...leg,trailing:{mode:"Manual",stopPrice:Number(event.target.value)}})}/></label>}
              </div>;
            })}
          </div>

          {(exitState.error||exitMessage)&&<p className={exitState.error?"trade-validation":"trade-exit-message"} role={exitState.error?"alert":"status"}>{exitState.error||exitMessage}</p>}

          <Disclosure title="Exit presets" name="exit-presets" scope={demo ? "demo" : storageScope}><div className="trade-preset-panel">
            <div><b>Named presets</b><span>Load copies values into this unsaved draft.</span></div>
            <select aria-label="Exit-plan preset" value={selectedPresetId} onChange={event=>setSelectedPresetId(event.target.value)}><option value="">Choose preset</option>{presetStore.presets.filter(item=>item.scope==="General"||item.symbol===symbol.trim().toUpperCase()).map(item=><option key={item.presetId} value={item.presetId}>{item.name} · {item.scope==="Symbol"?item.symbol:"General"}</option>)}</select>
            <button type="button" onClick={loadPreset} disabled={!selectedPresetId}>Load</button>
            <input aria-label="Preset name" placeholder={selectedPresetId?"New name":"Preset name"} value={presetName} onChange={event=>setPresetName(event.target.value)}/>
            <select aria-label="Preset scope" value={presetScope} onChange={event=>setPresetScope(event.target.value as "General"|"Symbol")}><option value="General">General</option><option value="Symbol">{symbol.trim().toUpperCase()||"Symbol"} only</option></select>
            <button type="button" onClick={savePreset}>Save preset</button>
            <button type="button" onClick={renamePreset} disabled={!selectedPresetId}>Rename</button>
            <button type="button" onClick={removePreset} disabled={!selectedPresetId}>Delete</button>
          </div>
          </Disclosure><p className="trade-exit-help">Save exits updates the draft. Open positions require a reviewed amendment.</p>
        </div>
      </section>

      {(!paper || demo) && <section className="paper-intent-readiness" aria-labelledby="paper-intent-title">
        <div>
          <p className="eyebrow">Paper execution · approval locked</p>
          <h2 id="paper-intent-title">Intent readiness</h2>
          <p role={brokerIntentCheck.state === "blocked" ? "alert" : "status"}>{brokerIntentCheck.message}</p>
          {brokerIntentCheck.state === "validated" && <small>{brokerIntentCheck.contractLabel} · fresh {brokerIntentCheck.quoteSide} {price(brokerIntentCheck.quote ?? 0)} · {new Date(brokerIntentCheck.observedAt!).toLocaleTimeString()}</small>}
        </div>
        <div className="paper-intent-actions">
          <span className={`paper-intent-state ${brokerIntentCheck.state}`}>{brokerIntentCheck.state === "unchecked" ? "Draft" : brokerIntentCheck.state === "checking" ? "Checking" : brokerIntentCheck.state === "validated" ? "Validated intent" : "Blocked"}</span>
          <button type="button" disabled={brokerIntentCheck.state === "checking" || stageState !== "staged"} onClick={() => void validatePaperPrerequisites()}>{brokerIntentCheck.state === "checking" ? "Checking…" : "Validate paper intent"}</button>
          <button type="button" disabled aria-describedby="paper-submission-lock">Submit paper order</button>
        </div>
        <p id="paper-submission-lock" className="paper-intent-lock">TWS Read-Only and Brontide submission lock must remain enabled until the reviewed test batch receives explicit approval.</p>
      </section>}



      <p className="trade-safety-note"><span>i</span> {paper && !demo ? "Saving keeps a draft. Only exact paper-order confirmation can send an order." : "Plans and exit settings are stored in this browser. Nothing is sent to a broker."}</p>

      </PlannerWorkspace>

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
        <section ref={settingsRef} tabIndex={-1} className="modal trade-settings-modal" role="dialog" aria-modal="true" aria-labelledby="risk-settings-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-heading"><div><p className="eyebrow">Trade defaults</p><h2 id="risk-settings-title">Risk settings</h2></div><button className="icon-button" aria-label="Close risk settings" onClick={() => setSettingsOpen(false)}>×</button></div>
          <label>{paper && !demo ? "Legacy planning equity" : "Account equity"}<input inputMode="decimal" value={settingsDraft.accountEquity || ""} aria-invalid={Boolean(settingsError)} aria-describedby={settingsError ? "risk-settings-error" : undefined} onChange={(event) => { setSettingsError(""); setSettingsDraft({...settingsDraft,accountEquity:safeNumber(event.target.value)}); }}/></label>
          <fieldset><legend>Maximum risk per trade</legend><div className="trade-setting-options">{RISK_OPTIONS.map((option) => <button type="button" key={option} className={settingsDraft.riskPercent === option ? "active" : ""} onClick={() => setSettingsDraft({...settingsDraft,riskPercent:option})}>{option.toFixed(2)}%</button>)}</div></fieldset>
          <fieldset><legend>Maximum position per symbol</legend><div className="trade-setting-options allocation-options">{ALLOCATION_OPTIONS.map((option) => <button type="button" key={option} className={settingsDraft.maxAllocationPercent === option ? "active" : ""} onClick={() => setSettingsDraft({...settingsDraft,maxAllocationPercent:option})}>{option}%</button>)}</div></fieldset>
          {settingsError && <p className="modal-validation" id="risk-settings-error" role="alert">{settingsError} Defaults were not changed.</p>}
          {!demo && <details><summary>Import legacy planning data</summary><p>Copy this browser's unscoped saved draft, defaults and presets into the current account. Existing account data is never replaced. Imported values require a new review.</p><button type="button" onClick={() => { try { for (const key of [SETTINGS_KEY, DRAFT_KEY, EXIT_KEY, AFTER_FILL_KEY, EXIT_PRESET_KEY]) { const value = localStorage.getItem(key); const destination = demoStorageKey(key, false); if (value && !localStorage.getItem(destination)) { JSON.parse(value); localStorage.setItem(destination, value); } } setImportEpoch(v => v + 1); setSettingsOpen(false); } catch { setSettingsError("Legacy import failed. Existing records were preserved."); } }}>Import into this account</button></details>}
          <p className="trade-settings-help">The calculator always uses the smaller share count produced by the risk limit and the position-allocation limit.</p>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={saveSettings}>Save defaults</button></div>
        </section>
      </div>}
    </div>
  );
}
