"use client";

import { type FormEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useBrowserStore } from "../lib/use-browser-store";

type ScannerRow = {
  symbol: string;
  dollar_volume: number;
  growth_percent: number;
  adr_percent: number;
  growth_rank: number;
  day_percent: number | null;
};

type UpdateRun = {
  run_id: string;
  mode: string;
  started_at: string;
  completed_at?: string | null;
  status: string;
  expected_session?: string | null;
  retry_attempt: number;
  explanation?: string | null;
  diagnostics?: {
    observed_symbols?: number;
    complete_symbols?: number;
    no_target_bar_count?: number;
    session_continuity_percent?: number;
    adjustment_coverage_percent?: number;
  };
};

type SharedStatus = {
  state: "updating" | "current" | "stale" | "failed";
  expected_session?: string | null;
  published_session?: string | null;
  last_success_at?: string | null;
  retry_at?: string | null;
  explanation?: string | null;
  recent_runs?: UpdateRun[];
};

type ScannerResponse = {
  data_date: string | null;
  formula_version: string;
  comparison_universe: { eligible: number; ranked: number; excluded: number; source?: string; evaluation_session?: string | null; age_sessions?: number | null; stale?: boolean; ranking_mode?: "exact" | "approximate" | "unknown"; effective_rank_cutoff?: number | null };
  status: SharedStatus;
  results: ScannerRow[];
};

type Settings = { minDollarVolume: number; minAdrPercent: number; minGrowthRank: number };
type SortKey = "symbol" | "dollar_volume" | "day_percent";
type Preferences = Settings & { sort: SortKey; descending: boolean; scrollTop: number };

export const SCANNER_DEFAULTS: Settings = {
  minDollarVolume: 89_000_000,
  minAdrPercent: 5,
  minGrowthRank: 89.817466,
};
const DEFAULT_PREFERENCES: Preferences = {
  ...SCANNER_DEFAULTS,
  sort: "day_percent",
  descending: true,
  scrollTop: 0,
};

function validPreferences(value: unknown): value is Preferences {
  const row = value as Preferences;
  return Boolean(row && Number.isFinite(row.minDollarVolume) && row.minDollarVolume >= 0 &&
    Number.isFinite(row.minAdrPercent) && row.minAdrPercent >= 0 && row.minAdrPercent <= 1000 &&
    Number.isFinite(row.minGrowthRank) && row.minGrowthRank >= 0 && row.minGrowthRank <= 100 &&
    ["symbol", "dollar_volume", "day_percent"].includes(row.sort) &&
    typeof row.descending === "boolean" && Number.isFinite(row.scrollTop) && row.scrollTop >= 0);
}

export function scannerQuery(settings: Settings) {
  const query = new URLSearchParams({
    min_dollar_volume: String(settings.minDollarVolume),
    min_adr_percent: String(settings.minAdrPercent),
    min_growth_rank: String(settings.minGrowthRank),
  });
  return `/v1/scanners/biggest-one-month?${query}`;
}

function compactDollars(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact",
    maximumFractionDigits: 1 }).format(value);
}

function signedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  if (rounded > 0) return `+${rounded.toFixed(2)}%`;
  if (rounded < 0) return `−${Math.abs(rounded).toFixed(2)}%`;
  return "0.00%";
}

function sortRows(rows: ScannerRow[], key: SortKey, descending: boolean) {
  return [...rows].sort((left, right) => {
    if (key === "day_percent") {
      if (left.day_percent == null) return right.day_percent == null ? left.symbol.localeCompare(right.symbol) : 1;
      if (right.day_percent == null) return -1;
    }
    const comparison = key === "symbol"
      ? left.symbol.localeCompare(right.symbol)
      : Number(left[key]) - Number(right[key]);
    if (comparison) return descending ? -comparison : comparison;
    return left.symbol.localeCompare(right.symbol);
  });
}


function ScanPanel({ title, count, approximate, settingsOpen, settingsButtonRef, onSettings, children }: {
  title: string;
  count: number;
  approximate: boolean;
  settingsOpen: boolean;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  onSettings: () => void;
  children: ReactNode;
}) {
  return (
    <article className="scan-panel" aria-labelledby="biggest-one-month-title">
      <header className="scan-panel-header">
        <div className="scan-panel-title">
          <h2 id="biggest-one-month-title">{title}</h2>
          <span className="scanner-count" aria-label={`${count} results`}>{count}</span>
        </div>
        <div className="scan-panel-tools">
          {approximate && <span className="scanner-approximate">Approximate ranking</span>}
          <button type="button" className="scanner-settings-button" aria-label={`${title} settings`}
            aria-expanded={settingsOpen} ref={settingsButtonRef} onClick={onSettings}>Settings</button>
        </div>
      </header>
      {children}
    </article>
  );
}

export function ScannerDashboard({ local, onChart }: {
  local: boolean;
  onChart: (symbol: string) => void;
}) {
  const preferences = useBrowserStore<Preferences>(
    "brontide-scanner-biggest-one-month-v3", DEFAULT_PREFERENCES, validPreferences,
  );
  const [draft, setDraft] = useState<Settings>(SCANNER_DEFAULTS);
  const [payload, setPayload] = useState<ScannerResponse | null>(null);
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!preferences.ready) return;
    setDraft({ minDollarVolume: preferences.value.minDollarVolume,
      minAdrPercent: preferences.value.minAdrPercent, minGrowthRank: preferences.value.minGrowthRank });
    requestAnimationFrame(() => tableRef.current?.scrollTo({ top: preferences.value.scrollTop }));
  }, [preferences.ready]);

  const load = async (settings: Settings, background = false) => {
    if (!local) {
      setLoading(false);
      setUnavailable("Scanner requires the local EOD service. No demo results are substituted.");
      return;
    }
    if (!background) setLoading(true);
    try {
      const response = await fetch(scannerQuery(settings), { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 503 ? "No validated Scanner publication is available." : "Scanner request failed.");
      const next = await response.json() as ScannerResponse;
      setPayload(next);
      setRows(next.results);
      setUnavailable("");
    } catch (error) {
      setUnavailable(error instanceof Error ? error.message : "The local EOD service is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!preferences.ready) return;
    void load(preferences.value);
  }, [preferences.ready, preferences.value.minDollarVolume,
    preferences.value.minAdrPercent, preferences.value.minGrowthRank, local]);

  const sorted = useMemo(() => sortRows(rows, preferences.value.sort, preferences.value.descending),
    [rows, preferences.value.sort, preferences.value.descending]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!Object.values(draft).every(Number.isFinite) || draft.minDollarVolume < 0 ||
        draft.minAdrPercent < 0 || draft.minAdrPercent > 1000 ||
        draft.minGrowthRank < 0 || draft.minGrowthRank > 100) return;
    preferences.save({ ...preferences.value, ...draft, scrollTop: 0 });
    tableRef.current?.scrollTo({ top: 0 });
    setSettingsOpen(false);
    settingsButtonRef.current?.focus();
  };

  const reset = () => {
    setDraft(SCANNER_DEFAULTS);
    preferences.save({ ...DEFAULT_PREFERENCES });
    tableRef.current?.scrollTo({ top: 0 });
  };

  const sortBy = (key: SortKey) => {
    const descending = preferences.value.sort === key ? !preferences.value.descending : key !== "symbol";
    preferences.save({ ...preferences.value, sort: key, descending });
  };

  const manualRefresh = async () => {
    if (!local || refreshing || state === "updating") return;
    setRefreshing(true);
    setUnavailable("");
    try {
      const response = await fetch("/v1/eod/refresh", { method: "POST", headers: { "X-Brontide-Local": "1" } });
      if (response.status === 409) {
        const statusResponse = await fetch("/v1/eod/status", { cache: "no-store" });
        if (statusResponse.ok) {
          const status = await statusResponse.json() as SharedStatus;
          setPayload((current) => current ? { ...current, status } : current);
          return;
        }
        throw new Error("The EOD update lock is not currently available.");
      }
      if (!response.ok) throw new Error("The EOD refresh could not be queued.");
      setPayload((current) => current ? { ...current, status: { ...current.status, state: "updating",
        explanation: "A validated EOD update is in progress." } } : current);
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        const statusResponse = await fetch("/v1/eod/status", { cache: "no-store" });
        if (!statusResponse.ok) break;
        const status = await statusResponse.json() as SharedStatus;
        setPayload((current) => current ? { ...current, status } : current);
        if (status.state !== "updating") break;
      }
      await load(preferences.value, true);
    } catch (error) {
      setUnavailable(error instanceof Error ? error.message : "The EOD refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const state = payload?.status.state;
  const stateMessage = state === "updating" ? "Updating — showing the last validated results."
    : state === "failed" ? `Update failed — showing ${payload?.data_date ?? "the last valid session"}. ${payload?.status.explanation ?? ""}`
      : state === "stale" ? `Stale — results are through ${payload?.data_date ?? "an earlier session"}. ${payload?.status.explanation ?? ""}` : "";
  const fallbackPopulation = payload?.comparison_universe.source === "alpaca-fallback";
  const approximate = fallbackPopulation || payload?.comparison_universe.ranking_mode === "approximate" ||
    payload?.comparison_universe.source === "tc2000-derived-approximate";
  const compactStatus = unavailable ? "Unavailable" : loading ? "Loading"
    : state === "updating" ? "Updating" : state === "failed" ? "Update failed"
    : state === "stale" ? "Stale" : state === "current" ? "Current" : "Unavailable";

  return (
    <section className="scanner-dashboard" aria-labelledby="scanner-title">
      <header className="scanner-pagebar">
        <div>
          <h1 id="scanner-title">Scanner</h1>
          <p title="All scans use the same completed EOD session">{payload?.data_date ? `EOD ${payload.data_date}` : "Completed-session EOD"} · {compactStatus}</p>
        </div>
        <div className="scanner-actions">
          <button type="button" className="secondary-button" disabled={!local || refreshing || state === "updating"}
            onClick={manualRefresh}>{refreshing || state === "updating" ? "Updating…" : "Refresh EOD"}</button>
        </div>
      </header>

      {preferences.error && <p className="scanner-state scanner-state-failed">{preferences.error}</p>}
      {stateMessage && state !== "stale" && <p className={`scanner-state scanner-state-${state}`}>{stateMessage}</p>}
      {unavailable && <p className="scanner-state scanner-state-unavailable">Unavailable — {unavailable}</p>}
      {state === "stale" && <p className="scanner-routine-state" role="status">{stateMessage}</p>}

      {Boolean(payload?.status.recent_runs?.length) && (
        <details className="scanner-update-details">
          <summary>Update details</summary>
          <div className="scanner-update-history" aria-label="Recent EOD updates">
            {payload!.status.recent_runs!.map(run => (
              <div className="scanner-update-run" key={run.run_id}>
                <div><strong>{run.status === "succeeded" ? "Published" : "Failed"}</strong>
                  <span>{new Date(run.started_at).toLocaleString()}</span></div>
                <p>{run.expected_session ? `EOD ${run.expected_session}` : "No completed session"}
                  {run.retry_attempt ? ` · retry ${run.retry_attempt}` : ""}</p>
                {run.diagnostics?.observed_symbols != null && (
                  <p>{run.diagnostics.complete_symbols ?? 0}/{run.diagnostics.observed_symbols} complete
                    {run.diagnostics.adjustment_coverage_percent != null ? ` · ${run.diagnostics.adjustment_coverage_percent.toFixed(2)}% adjustment coverage` : ""}
                    {run.diagnostics.session_continuity_percent != null ? ` · ${run.diagnostics.session_continuity_percent.toFixed(2)}% continuity` : ""}
                    {run.diagnostics.no_target_bar_count ? ` · ${run.diagnostics.no_target_bar_count} without a target-session bar` : ""}</p>
                )}
                {run.explanation && <p className="scanner-update-explanation">{run.explanation}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="scanner-grid">
        <ScanPanel title="Biggest One Month" count={sorted.length} approximate={approximate}
          settingsOpen={settingsOpen} settingsButtonRef={settingsButtonRef}
          onSettings={() => setSettingsOpen(value => !value)}>
          {settingsOpen && (
            <form className="scanner-settings" onSubmit={apply} aria-label="Biggest One Month settings"
              onKeyDown={event => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSettingsOpen(false);
                  settingsButtonRef.current?.focus();
                }
              }}>
              <label>DV &gt;<input aria-label="Minimum dollar volume" type="number" min="0" step="1000000"
                value={draft.minDollarVolume} onChange={event => setDraft({ ...draft, minDollarVolume: Number(event.target.value) })} /></label>
              <label>ADR% &gt;<input aria-label="Minimum ADR percent" type="number" min="0" max="1000" step="0.1"
                value={draft.minAdrPercent} onChange={event => setDraft({ ...draft, minAdrPercent: Number(event.target.value) })} /></label>
              <label>Effective rank ≥<input aria-label="Minimum growth rank" type="number" min="0" max="100" step="0.000001"
                value={draft.minGrowthRank} onChange={event => setDraft({ ...draft, minGrowthRank: Number(event.target.value) })} /></label>
              <div className="scanner-settings-actions"><button className="primary-button" type="submit">Apply</button>
                <button className="secondary-button" type="button" onClick={reset}>Reset defaults</button></div>
              <details><summary>Formula and ranking details</summary>
                <p>Selection uses raw close × actual-share volume above $89M; split-adjusted close ÷ the lowest split-adjusted low in 22 sessions; and the captured 21-term H/L expression divided by 20.</p>
                <p>{fallbackPopulation ? "Approximate ranking uses the prior fallback population. The frozen derived population has not yet been published; these results are not exact TC2000 parity." : approximate ? `Approximate ranking uses the frozen derived population and effective cutoff ${payload?.comparison_universe.effective_rank_cutoff ?? preferences.value.minGrowthRank}. It is not exact TC2000 parity.` : "Ranking uses the validated publication population."}</p>
                <p>Day % is display-only: split-adjusted close for this EOD session versus the previous completed session.</p>
              </details>
            </form>
          )}

          <div className="scanner-table-wrap" ref={tableRef} tabIndex={0} aria-label="Scanner results"
            onScroll={event => {
              if (scrollTimer.current) clearTimeout(scrollTimer.current);
              const scrollTop = event.currentTarget.scrollTop;
              scrollTimer.current = setTimeout(() => preferences.save({ ...preferences.value, scrollTop }), 120);
            }}>
            <table className="scanner-table">
              <thead><tr>
                <th><button type="button" onClick={() => sortBy("symbol")}>Symbol {preferences.value.sort === "symbol" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
                <th className="numeric"><button type="button" title="Dollar volume" onClick={() => sortBy("dollar_volume")}>DV {preferences.value.sort === "dollar_volume" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
                <th className="numeric"><button type="button" title={`Day change for ${payload?.data_date ?? "the completed EOD session"} versus the previous trading session`} onClick={() => sortBy("day_percent")}>Day % {preferences.value.sort === "day_percent" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
              </tr></thead>
              <tbody>
                {sorted.map(row => <tr key={row.symbol} tabIndex={0} onClick={() => onChart(row.symbol)}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChart(row.symbol); } }}>
                  <td><strong>{row.symbol}</strong></td><td className="numeric">{compactDollars(row.dollar_volume)}</td>
                  <td className={`numeric ${row.day_percent == null ? "unavailable" : row.day_percent > 0 ? "positive" : row.day_percent < 0 ? "negative" : "neutral"}`}>{signedPercent(row.day_percent ?? null)}</td>
                </tr>)}
              </tbody>
            </table>
            {loading && <div className="scanner-empty" role="status">Loading validated Scanner results…</div>}
            {!loading && !unavailable && sorted.length === 0 && <div className="scanner-empty">No matches for these thresholds on the published session.</div>}
          </div>
        </ScanPanel>
      </div>
    </section>
  );
}
