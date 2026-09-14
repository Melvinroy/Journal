"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBrowserStore } from "../lib/use-browser-store";

type ScannerRow = {
  symbol: string;
  dollar_volume: number;
  growth_percent: number;
  adr_percent: number;
  growth_rank: number;
};

type SharedStatus = {
  state: "updating" | "current" | "stale" | "failed";
  expected_session?: string | null;
  published_session?: string | null;
  last_success_at?: string | null;
  retry_at?: string | null;
  explanation?: string | null;
};

type ScannerResponse = {
  data_date: string | null;
  formula_version: string;
  comparison_universe: { eligible: number; ranked: number; excluded: number };
  status: SharedStatus;
  results: ScannerRow[];
};

type Settings = { minDollarVolume: number; minAdrPercent: number; minGrowthRank: number };
type SortKey = "symbol" | "dollar_volume" | "growth_percent";
type Preferences = Settings & { sort: SortKey; descending: boolean; scrollTop: number };

export const SCANNER_DEFAULTS: Settings = {
  minDollarVolume: 9_000_000,
  minAdrPercent: 5,
  minGrowthRank: 93.77,
};
const DEFAULT_PREFERENCES: Preferences = {
  ...SCANNER_DEFAULTS,
  sort: "growth_percent",
  descending: true,
  scrollTop: 0,
};

function validPreferences(value: unknown): value is Preferences {
  const row = value as Preferences;
  return Boolean(row && Number.isFinite(row.minDollarVolume) && row.minDollarVolume >= 0 &&
    Number.isFinite(row.minAdrPercent) && row.minAdrPercent >= 0 && row.minAdrPercent <= 1000 &&
    Number.isFinite(row.minGrowthRank) && row.minGrowthRank >= 0 && row.minGrowthRank <= 100 &&
    ["symbol", "dollar_volume", "growth_percent"].includes(row.sort) &&
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

function sortRows(rows: ScannerRow[], key: SortKey, descending: boolean) {
  return [...rows].sort((left, right) => {
    const comparison = key === "symbol"
      ? left.symbol.localeCompare(right.symbol)
      : left[key] - right[key];
    if (comparison) return descending ? -comparison : comparison;
    return left.symbol.localeCompare(right.symbol);
  });
}

export function ScannerDashboard({ local, onChart }: {
  local: boolean;
  onChart: (symbol: string) => void;
}) {
  const preferences = useBrowserStore<Preferences>(
    "brontide-scanner-biggest-one-month-v1", DEFAULT_PREFERENCES, validPreferences,
  );
  const [draft, setDraft] = useState<Settings>(SCANNER_DEFAULTS);
  const [payload, setPayload] = useState<ScannerResponse | null>(null);
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
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
    if (!local || refreshing) return;
    setRefreshing(true);
    setUnavailable("");
    try {
      const response = await fetch("/v1/eod/refresh", { method: "POST", headers: { "X-Brontide-Local": "1" } });
      if (response.status === 409) throw new Error("An EOD update is already running.");
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

  return (
    <section className="scanner-dashboard" aria-labelledby="scanner-title">
      <header className="scanner-commandbar">
        <div>
          <div className="scanner-title-line">
            <h1 id="scanner-title">Biggest One Month</h1>
            <span className="scanner-count" aria-label={`${sorted.length} results`}>{sorted.length}</span>
          </div>
          <p>{payload?.data_date ? `EOD date ${payload.data_date}` : "Completed-session EOD data"}</p>
        </div>
        <div className="scanner-actions">
          <button type="button" className="secondary-button" aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(value => !value)}>Settings</button>
          <button type="button" className="secondary-button" disabled={!local || refreshing}
            onClick={manualRefresh}>{refreshing || state === "updating" ? "Updating…" : "Refresh EOD"}</button>
        </div>
      </header>

      {settingsOpen && (
        <form className="scanner-settings" onSubmit={apply} aria-label="Biggest One Month settings">
          <label>Dollar volume &gt;<span>$</span><input aria-label="Minimum dollar volume" type="number" min="0" step="1000000"
            value={draft.minDollarVolume} onChange={event => setDraft({ ...draft, minDollarVolume: Number(event.target.value) })} /></label>
          <label>ADR20% &gt;<input aria-label="Minimum ADR percent" type="number" min="0" max="1000" step="0.1"
            value={draft.minAdrPercent} onChange={event => setDraft({ ...draft, minAdrPercent: Number(event.target.value) })} /></label>
          <label>Growth rank ≥<input aria-label="Minimum growth rank" type="number" min="0" max="100" step="0.01"
            value={draft.minGrowthRank} onChange={event => setDraft({ ...draft, minGrowthRank: Number(event.target.value) })} /></label>
          <div className="scanner-settings-actions"><button className="primary-button" type="submit">Apply</button>
            <button className="secondary-button" type="button" onClick={reset}>Reset defaults</button></div>
          <small>Growth: split-adjusted close versus 21 sessions earlier. ADR20%: mean high/low−1 over 20 sessions. Rank is calculated before filters.</small>
        </form>
      )}

      {preferences.error && <p className="scanner-state scanner-state-failed">{preferences.error}</p>}
      {stateMessage && <p className={`scanner-state scanner-state-${state}`}>{stateMessage}</p>}
      {unavailable && <p className="scanner-state scanner-state-unavailable">Unavailable — {unavailable}</p>}

      <div className="scanner-table-wrap" ref={tableRef} tabIndex={0} aria-label="Scanner results"
        onScroll={event => {
          if (scrollTimer.current) clearTimeout(scrollTimer.current);
          const scrollTop = event.currentTarget.scrollTop;
          scrollTimer.current = setTimeout(() => preferences.save({ ...preferences.value, scrollTop }), 120);
        }}>
        <table className="scanner-table">
          <thead><tr>
            <th><button type="button" onClick={() => sortBy("symbol")}>Symbol {preferences.value.sort === "symbol" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
            <th className="numeric"><button type="button" onClick={() => sortBy("dollar_volume")}>Dollar volume {preferences.value.sort === "dollar_volume" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
            <th className="numeric"><button type="button" onClick={() => sortBy("growth_percent")}>1M gain % {preferences.value.sort === "growth_percent" ? (preferences.value.descending ? "↓" : "↑") : ""}</button></th>
          </tr></thead>
          <tbody>
            {sorted.map(row => <tr key={row.symbol} tabIndex={0} onClick={() => onChart(row.symbol)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChart(row.symbol); } }}>
              <td><strong>{row.symbol}</strong></td><td className="numeric">{compactDollars(row.dollar_volume)}</td>
              <td className={`numeric ${row.growth_percent >= 0 ? "positive" : "negative"}`}>{row.growth_percent.toFixed(2)}%</td>
            </tr>)}
          </tbody>
        </table>
        {loading && <div className="scanner-empty" role="status">Loading validated Scanner results…</div>}
        {!loading && !unavailable && sorted.length === 0 && <div className="scanner-empty">No matches for these thresholds on the published session.</div>}
      </div>
    </section>
  );
}
