"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateTradePlan, type TradeSide } from "../lib/trade-planner";

const RISK_OPTIONS = [.25, .5, .75, 1] as const;
const ALLOCATION_OPTIONS = [3, 5, 10, 15, 20, 25] as const;
const SETTINGS_KEY = "journal.trade-planner.settings.v1";
const DRAFT_KEY = "journal.trade-planner.draft.v1";
const EXIT_KEY = "journal.trade-planner.exits.v1";
const EXIT_COUNT_OPTIONS = [1, 2, 3] as const;

type StopSource = "LoD" | "Manual";
type StageState = "draft" | "staged";
type ExitCount = (typeof EXIT_COUNT_OPTIONS)[number];

type SavedSettings = {
  accountEquity: number;
  riskPercent: number;
  maxAllocationPercent: number;
};

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

function distributeShares(total: number, count: number) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - base * (count - 1) : base);
}

export function TradePlanner() {
  const [symbol, setSymbol] = useState("NVDA");
  const [side, setSide] = useState<TradeSide>("Long");
  const [entryPrice, setEntryPrice] = useState(120);
  const [stopPrice, setStopPrice] = useState(118);
  const [stopSource, setStopSource] = useState<StopSource>("LoD");
  const [accountEquity, setAccountEquity] = useState(30000);
  const [riskPercent, setRiskPercent] = useState(0.5);
  const [maxAllocationPercent, setMaxAllocationPercent] = useState(15);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [stageState, setStageState] = useState<StageState>("draft");
  const [targetCount, setTargetCount] = useState<ExitCount>(2);
  const [stopCount, setStopCount] = useState<ExitCount>(1);
  const [runnerEnabled, setRunnerEnabled] = useState(true);

  useEffect(() => {
    try {
      const savedSettings = window.localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as Partial<SavedSettings>;
        if (Number(parsed.accountEquity) > 0) setAccountEquity(Number(parsed.accountEquity));
        if (RISK_OPTIONS.includes(Number(parsed.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(parsed.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(parsed.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(parsed.maxAllocationPercent));
      }

      const savedExits = window.localStorage.getItem(EXIT_KEY);
      if (savedExits) {
        const exits = JSON.parse(savedExits) as { targetCount?: number; stopCount?: number; runnerEnabled?: boolean };
        if (EXIT_COUNT_OPTIONS.includes(exits.targetCount as ExitCount)) setTargetCount(exits.targetCount as ExitCount);
        if (EXIT_COUNT_OPTIONS.includes(exits.stopCount as ExitCount)) setStopCount(exits.stopCount as ExitCount);
        if (typeof exits.runnerEnabled === "boolean") setRunnerEnabled(exits.runnerEnabled);
      }

      const savedDraft = window.localStorage.getItem(DRAFT_KEY);
      if (savedDraft) {
        const draft = JSON.parse(savedDraft) as Partial<SavedSettings> & { symbol?: string; side?: TradeSide; entryPrice?: number; stopPrice?: number; stopSource?: StopSource; exitPlan?: { targetCount?: number; stopCount?: number; runnerEnabled?: boolean } };
        if (draft.symbol) setSymbol(draft.symbol);
        if (draft.side === "Long" || draft.side === "Short") setSide(draft.side);
        if (Number(draft.entryPrice) > 0) setEntryPrice(Number(draft.entryPrice));
        if (Number(draft.stopPrice) > 0) setStopPrice(Number(draft.stopPrice));
        if (draft.stopSource === "LoD" || draft.stopSource === "Manual") setStopSource(draft.stopSource);
        if (Number(draft.accountEquity) > 0) setAccountEquity(Number(draft.accountEquity));
        if (RISK_OPTIONS.includes(Number(draft.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(draft.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(draft.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(draft.maxAllocationPercent));
        if (EXIT_COUNT_OPTIONS.includes(draft.exitPlan?.targetCount as ExitCount)) setTargetCount(draft.exitPlan?.targetCount as ExitCount);
        if (EXIT_COUNT_OPTIONS.includes(draft.exitPlan?.stopCount as ExitCount)) setStopCount(draft.exitPlan?.stopCount as ExitCount);
        if (typeof draft.exitPlan?.runnerEnabled === "boolean") setRunnerEnabled(draft.exitPlan.runnerEnabled);
        setStageState("staged");
      }
    } catch {
      // Invalid local preferences are ignored and replaced on the next save.
    }
  }, []);

  const result = useMemo(() => calculateTradePlan({
    accountEquity,
    riskPercent,
    maxAllocationPercent,
    entryPrice,
    stopPrice,
    side,
  }), [accountEquity, riskPercent, maxAllocationPercent, entryPrice, stopPrice, side]);

  const runnerShares = runnerEnabled ? Math.floor(result.shares * .3) : 0;
  const targetShares = distributeShares(Math.max(0, result.shares - runnerShares), targetCount);
  const targetPrices = [result.oneRPrice, result.twoRPrice, entryPrice + (side === "Long" ? 1 : -1) * result.riskPerShare * 3];
  const allocationLimited = result.valid && result.sharesByAllocation < result.sharesByRisk;

  function saveSettings() {
    const settings: SavedSettings = { accountEquity, riskPercent, maxAllocationPercent };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.localStorage.removeItem(DRAFT_KEY);
    setStageState("draft");
    setSettingsOpen(false);
  }

  function stageEntry() {
    if (!result.valid) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      symbol: symbol.trim().toUpperCase(), side, entryPrice, stopPrice, stopSource,
      accountEquity, riskPercent, maxAllocationPercent, result,
      exitPlan: { targetCount, stopCount, runnerEnabled, targetShares, runnerShares },
      savedAt: new Date().toISOString(),
    }));
    setStageState("staged");
  }

  function cancelStage() {
    window.localStorage.removeItem(DRAFT_KEY);
    setStageState("draft");
  }

  function editPlan() {
    if (stageState !== "staged") return;
    window.localStorage.removeItem(DRAFT_KEY);
    setStageState("draft");
  }

  function saveExitDefaults(next: { targetCount: ExitCount; stopCount: ExitCount; runnerEnabled: boolean }) {
    window.localStorage.setItem(EXIT_KEY, JSON.stringify(next));
    editPlan();
  }

  function changeTargetCount(next: ExitCount) {
    setTargetCount(next);
    saveExitDefaults({ targetCount: next, stopCount, runnerEnabled });
  }

  function changeStopCount(next: ExitCount) {
    setStopCount(next);
    saveExitDefaults({ targetCount, stopCount: next, runnerEnabled });
  }

  function toggleRunner() {
    const next = !runnerEnabled;
    setRunnerEnabled(next);
    saveExitDefaults({ targetCount, stopCount, runnerEnabled: next });
  }

  return (
    <div className="trade-planner">
      <header className="trade-commandbar">
        <div>
          <p className="eyebrow">Phase 1 · UI preview</p>
          <h1>New trade</h1>
          <p>Size and stage now. IBKR execution activates in Phase 2.</p>
        </div>
        <div className="trade-risk-banner" aria-label="Risk controls">
          <span>Risk <strong>{riskPercent.toFixed(2)}%</strong></span>
          <i aria-hidden="true"/>
          <span>Alloc. <strong>{maxAllocationPercent}%</strong></span>
          <button type="button" onClick={() => setSettingsOpen(true)}>Change</button>
        </div>
      </header>

      <section className="trade-actionbar" aria-label="Quick trade actions">
        <button type="button" className={`trade-action-button entry ${stageState === "staged" ? "cancel" : ""}`} disabled={stageState === "draft" && (!result.valid || !symbol.trim())} onClick={stageState === "staged" ? cancelStage : stageEntry}>
          <span>{stageState === "staged" ? "Cancel stage" : "Stage entry + SL"}</span><small>{stageState === "staged" ? "Staged locally" : "1 full stop"}</small>
        </button>
        <button type="button" className={`trade-action-button exits ${exitOpen ? "active" : ""}`} disabled={!result.valid} onClick={() => setExitOpen((current) => !current)} aria-expanded={exitOpen}>
          <span>After fill</span><small>{targetCount} TP · {stopCount} SL{runnerEnabled ? " · Runner" : ""}</small><i aria-hidden="true">{exitOpen ? "×" : "⌄"}</i>
        </button>
        <span className="trade-execution-state">Execute with IBKR · Phase 2</span>
      </section>

      <section className="trade-ticket" aria-labelledby="trade-ticket-title">
        <div className="trade-ticket-head">
          <div><p className="eyebrow">Order calculator</p><h2 id="trade-ticket-title">Trade setup</h2></div>
          <span className={`trade-draft-state ${stageState === "staged" ? "staged" : ""}`}><i/> {stageState === "staged" ? "Staged locally" : "Draft"}</span>
        </div>

        <div className="trade-ticket-body">
          <div className="trade-input-grid">
            <label>Symbol<input className="trade-symbol-input" value={symbol} onChange={(event) => { editPlan(); setSymbol(event.target.value.toUpperCase().slice(0, 8)); }} placeholder="NVDA" aria-label="Stock symbol"/></label>
            <label>Side<span className="trade-side-control"><button type="button" className={side === "Long" ? "active" : ""} onClick={() => { editPlan(); setSide("Long"); }}>Long</button><button type="button" className={side === "Short" ? "active" : ""} onClick={() => { editPlan(); setSide("Short"); }}>Short</button></span></label>
            <label>Entry price<span className="trade-price-control"><span>$</span><input inputMode="decimal" value={entryPrice || ""} onChange={(event) => { editPlan(); setEntryPrice(safeNumber(event.target.value)); }} aria-label="Entry price"/></span></label>
            <label>Initial stop<span className="trade-combined-control"><select value={stopSource} onChange={(event) => { editPlan(); setStopSource(event.target.value as StopSource); }} aria-label="Stop source"><option>LoD</option><option>Manual</option></select><input inputMode="decimal" value={stopPrice || ""} onChange={(event) => { editPlan(); setStopPrice(safeNumber(event.target.value)); }} aria-label="Stop price"/></span></label>
          </div>

          <div className="trade-context-line">
            <span>{stopSource === "LoD" ? "LoD entered manually in Phase 1" : "Manual technical stop"}</span>
            <span>Risk/share <b>{price(result.riskPerShare)}</b></span>
            <span>Stop distance <b>{entryPrice > 0 ? `${(result.riskPerShare / entryPrice * 100).toFixed(2)}%` : "—"}</b></span>
          </div>

          {!result.valid && <p className="trade-validation" role="alert">{result.error}</p>}

          <div className="trade-result-strip" aria-label="Position sizing result">
            <div><span>Shares</span><strong>{result.valid ? result.shares.toLocaleString() : "—"}</strong></div>
            <div><span>Position</span><strong>{result.valid ? money(result.positionValue) : "—"}</strong></div>
            <div><span>Planned risk</span><strong>{result.valid ? money(result.plannedRisk) : "—"}</strong><small>{result.valid ? `${result.actualRiskPercent.toFixed(2)}% of account` : ""}</small></div>
            <div><span>Account use</span><strong>{result.valid ? `${result.accountUsePercent.toFixed(1)}%` : "—"}</strong><small>{allocationLimited ? "Allocation cap applied" : "Risk cap applied"}</small></div>
          </div>

          <div className="trade-protection-row">
            <div><b>Initial protection</b><span>One full-position stop at {price(stopPrice)}</span></div>
            <strong>{result.valid ? `${result.shares.toLocaleString()} shares` : "—"}</strong>
          </div>

          {exitOpen && <div className="trade-exit-plan open">
            <div className="trade-exit-head"><div><span>Editable default</span><strong>After-fill plan</strong></div><span className="trade-locked-pill">Attach after fill</span></div>
            <div className="trade-exit-details">
              <div className="trade-exit-config">
                <div><span>Profit targets</span><div className="trade-count-control">{EXIT_COUNT_OPTIONS.map((count) => <button type="button" key={count} className={targetCount === count ? "active" : ""} onClick={() => changeTargetCount(count)}>{count}</button>)}</div></div>
                <div><span>Stop steps</span><div className="trade-count-control">{EXIT_COUNT_OPTIONS.map((count) => <button type="button" key={count} className={stopCount === count ? "active" : ""} onClick={() => changeStopCount(count)}>{count}</button>)}</div></div>
                <div><span>Runner</span><button type="button" className={`trade-runner-toggle ${runnerEnabled ? "active" : ""}`} onClick={toggleRunner}>{runnerEnabled ? "On" : "Off"}</button></div>
              </div>
              <div className="trade-exit-columns">
                <div>{targetShares.map((shares, index) => <div className="trade-exit-row" key={`target-${index}`}><b>T{index + 1}</b><strong>{shares} sh</strong><span>{index + 1}R · {price(targetPrices[index])}</span></div>)}{runnerEnabled && <div className="trade-exit-row"><b>Run</b><strong>{runnerShares} sh</strong><span>10 SMA / ORL trail</span></div>}</div>
                <div>{Array.from({ length: stopCount }, (_, index) => <div className="trade-exit-row stop" key={`stop-${index}`}><b>SL{index + 1}</b><strong>{index === 0 ? "Initial" : `After T${index}`}</strong><span>{index === 0 ? `${price(stopPrice)} · full position` : index === 1 ? "Move remaining → breakeven" : "Trail remaining → 10 SMA / ORL"}</span></div>)}</div>
              </div>
              <div className="trade-attach-row"><p>Preview only. Quantities will be recalculated from confirmed filled shares.</p><button type="button" disabled>Attach to position</button></div>
            </div>
          </div>}
        </div>
      </section>

      <p className="trade-safety-note"><span>i</span> Phase 1 is a local planning preview. Nothing is sent to IBKR.</p>

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
        <section className="modal trade-settings-modal" role="dialog" aria-modal="true" aria-labelledby="risk-settings-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-heading"><div><p className="eyebrow">Trade defaults</p><h2 id="risk-settings-title">Risk settings</h2></div><button className="icon-button" aria-label="Close risk settings" onClick={() => setSettingsOpen(false)}>×</button></div>
          <label>Account equity<input inputMode="decimal" value={accountEquity || ""} onChange={(event) => { editPlan(); setAccountEquity(safeNumber(event.target.value)); }}/></label>
          <fieldset><legend>Maximum risk per trade</legend><div className="trade-setting-options">{RISK_OPTIONS.map((option) => <button type="button" key={option} className={riskPercent === option ? "active" : ""} onClick={() => { editPlan(); setRiskPercent(option); }}>{option.toFixed(2)}%</button>)}</div></fieldset>
          <fieldset><legend>Maximum position per symbol</legend><div className="trade-setting-options allocation-options">{ALLOCATION_OPTIONS.map((option) => <button type="button" key={option} className={maxAllocationPercent === option ? "active" : ""} onClick={() => { editPlan(); setMaxAllocationPercent(option); }}>{option}%</button>)}</div></fieldset>
          <p className="trade-settings-help">The calculator always uses the smaller share count produced by the risk limit and the position-allocation limit.</p>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={saveSettings}>Save defaults</button></div>
        </section>
      </div>}
    </div>
  );
}
