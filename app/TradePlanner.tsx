"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateTradePlan, splitShares, type TradeSide } from "../lib/trade-planner";

const RISK_OPTIONS = [.25, .5, .75, 1] as const;
const ALLOCATION_OPTIONS = [3, 5, 10, 15, 20, 25] as const;
const SETTINGS_KEY = "journal.trade-planner.settings.v1";
const DRAFT_KEY = "journal.trade-planner.draft.v1";

type StopSource = "LoD" | "Manual";
type StageState = "draft" | "staged";

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

  useEffect(() => {
    try {
      const savedSettings = window.localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as Partial<SavedSettings>;
        if (Number(parsed.accountEquity) > 0) setAccountEquity(Number(parsed.accountEquity));
        if (RISK_OPTIONS.includes(Number(parsed.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(parsed.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(parsed.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(parsed.maxAllocationPercent));
      }

      const savedDraft = window.localStorage.getItem(DRAFT_KEY);
      if (savedDraft) {
        const draft = JSON.parse(savedDraft) as Partial<SavedSettings> & { symbol?: string; side?: TradeSide; entryPrice?: number; stopPrice?: number; stopSource?: StopSource };
        if (draft.symbol) setSymbol(draft.symbol);
        if (draft.side === "Long" || draft.side === "Short") setSide(draft.side);
        if (Number(draft.entryPrice) > 0) setEntryPrice(Number(draft.entryPrice));
        if (Number(draft.stopPrice) > 0) setStopPrice(Number(draft.stopPrice));
        if (draft.stopSource === "LoD" || draft.stopSource === "Manual") setStopSource(draft.stopSource);
        if (Number(draft.accountEquity) > 0) setAccountEquity(Number(draft.accountEquity));
        if (RISK_OPTIONS.includes(Number(draft.riskPercent) as (typeof RISK_OPTIONS)[number])) setRiskPercent(Number(draft.riskPercent));
        if (ALLOCATION_OPTIONS.includes(Number(draft.maxAllocationPercent) as (typeof ALLOCATION_OPTIONS)[number])) setMaxAllocationPercent(Number(draft.maxAllocationPercent));
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

  const [p1Shares, p2Shares, runnerShares] = splitShares(result.shares);
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
      exitPlan: { p1Shares, p2Shares, runnerShares, p1Target: result.oneRPrice, p2Target: result.twoRPrice },
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

  return (
    <div className="trade-planner">
      <header className="trade-commandbar">
        <div>
          <p className="eyebrow">Phase 1 · planning only</p>
          <h1>New trade</h1>
          <p>Size the position now. Stage exits for after the entry fills.</p>
        </div>
        <div className="trade-risk-banner" aria-label="Risk controls">
          <span>Risk <strong>{riskPercent.toFixed(2)}%</strong></span>
          <i aria-hidden="true"/>
          <span>Alloc. <strong>{maxAllocationPercent}%</strong></span>
          <button type="button" onClick={() => setSettingsOpen(true)}>Change</button>
        </div>
      </header>

      <section className="trade-actionbar" aria-label="Quick trade actions">
        <div className={`trade-action-card ${stageState === "staged" ? "staged" : ""}`}>
          <div className="trade-action-copy">
            <span>Entry protection</span>
            <strong>Entry + 1 SL</strong>
            <small>{stageState === "staged" ? "Staged locally · not sent" : "One full-position stop"}</small>
          </div>
          {stageState === "staged" ? <div className="trade-action-controls">
            <span className="trade-status-pill"><i/> Staged</span>
            <button type="button" className="trade-cancel-stage" onClick={cancelStage}>Cancel stage</button>
          </div> : <button type="button" className="trade-stage-button" disabled={!result.valid || !symbol.trim()} onClick={stageEntry}>Stage entry</button>}
        </div>

        <div className="trade-action-card exits">
          <div className="trade-action-copy">
            <span>After fill</span>
            <strong>P1 · P2 · Runner</strong>
            <small>Attach only to confirmed shares</small>
          </div>
          <button type="button" className="trade-preview-button" disabled={!result.valid} onClick={() => setExitOpen((current) => !current)} aria-expanded={exitOpen}>{exitOpen ? "Close" : "Preview"}</button>
        </div>

        <p className="trade-lifecycle"><b>Phase 1</b> Stage locally <i>→</i> <span>Phase 2 · Submit + cancel working order</span> <i>→</i> <span>Confirmed fill</span> <i>→</i> <span>Attach exits</span></p>
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
            <div className="trade-exit-head"><div><span>Post-fill default</span><strong>P1 · P2 · Runner</strong></div><span className="trade-locked-pill">Locked until fill</span></div>
            <div className="trade-exit-details">
              <div className="trade-exit-row"><b>P1</b><strong>{p1Shares} sh</strong><span>Target 1R · {price(result.oneRPrice)}</span><span>Then review stop → breakeven</span></div>
              <div className="trade-exit-row"><b>P2</b><strong>{p2Shares} sh</strong><span>Target 2R · {price(result.twoRPrice)}</span><span>Reduce aggregate stop quantity</span></div>
              <div className="trade-exit-row"><b>Run</b><strong>{runnerShares} sh</strong><span>No fixed target</span><span>Manual 10 SMA / ORL trail</span></div>
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
