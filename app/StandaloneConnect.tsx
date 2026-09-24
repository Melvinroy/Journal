import { useEffect, useRef, useState } from "react";

/** Read-only, synthetic status used by isolated browser fixtures. It never binds a broker account. */
export type ConnectionFixture = {
  source: "synthetic-fixture";
  generation: string;
  sdk: "missing" | "incompatible" | "compatible";
  tws: "unavailable" | "read-only" | "available";
  environment: "unverified" | "paper";
  accounts: string[];
};

export function connectionFixtureFromStatus(value: unknown): ConnectionFixture | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.source !== "synthetic-fixture" || typeof item.generation !== "string" ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(item.generation) ||
      !["missing", "incompatible", "compatible"].includes(String(item.sdk)) ||
      !["unavailable", "read-only", "available"].includes(String(item.tws)) ||
      !["unverified", "paper"].includes(String(item.environment)) ||
      !Array.isArray(item.accounts) || item.accounts.length > 8 ||
      !item.accounts.every(account => typeof account === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(account)) ||
      new Set(item.accounts).size !== item.accounts.length) return null;
  return item as ConnectionFixture;
}

export function StandaloneConnect({ onOpenTrading, onOpenJournal, localSessionActive, localProfileId = null, fixtureReadiness = null }: {
  onOpenTrading: () => void;
  onOpenJournal: () => void;
  localSessionActive: boolean;
  localProfileId?: string | null;
  fixtureReadiness?: ConnectionFixture | null;
}) {
  const [fixture, setFixture] = useState<ConnectionFixture | null>(fixtureReadiness);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const selectionEpoch = useRef(0);
  const refreshEpoch = useRef(0);

  useEffect(() => {
    refreshEpoch.current += 1;
    setFixture(fixtureReadiness);
    setSelected("");
    setConfirmed("");
  }, [fixtureReadiness]);

  const canWalkThroughSelection = fixture?.sdk === "compatible" &&
    fixture.tws === "available" && fixture.environment === "paper" && fixture.accounts.length > 0;

  async function refreshFixture() {
    if (!fixture || !localSessionActive) return;
    const requestEpoch = ++refreshEpoch.current;
    const accountEpoch = selectionEpoch.current;
    setRefreshing(true);
    setRefreshMessage("");
    try {
      // Re-reads only the local fixture status. It cannot contact TWS or submit an order.
      const response = await fetch("/v1/local/session/status", {
        credentials: "same-origin", cache: "no-store", headers: { "X-Brontide-Local": "1" },
      });
      // A revoked session wins over a changed selection: never retain a stale confirmation.
      if (!response.ok) {
        setFixture(null); setSelected(""); setConfirmed("");
        setRefreshMessage("Local status is unavailable. The walkthrough remains locked.");
        return;
      }
      if (requestEpoch !== refreshEpoch.current || accountEpoch !== selectionEpoch.current) {
        setRefreshMessage("Account choice changed during refresh. Check status again.");
        return;
      }
      const status = await response.json();
      if (status?.authenticated !== true || status?.executionEnabled !== false ||
          status?.profileId !== localProfileId || status?.brokerAccount !== null ||
          status?.environment !== null) {
        setFixture(null); setSelected(""); setConfirmed("");
        setRefreshMessage("Local identity or account changed. The walkthrough remains locked.");
        return;
      }
      if (requestEpoch !== refreshEpoch.current || accountEpoch !== selectionEpoch.current) {
        setRefreshMessage("Account choice changed during refresh. Check status again.");
        return;
      }
      const next = connectionFixtureFromStatus(status.connectionFixture);
      setFixture(next); setSelected(""); setConfirmed("");
      setRefreshMessage(next ? "Synthetic local status refreshed. Select the account again." : "Fixture status is unavailable. The walkthrough remains locked.");
    } catch {
      if (requestEpoch === refreshEpoch.current && accountEpoch === selectionEpoch.current) {
        setFixture(null); setSelected(""); setConfirmed("");
        setRefreshMessage("Local status is unavailable. The walkthrough remains locked.");
      }
    } finally {
      if (requestEpoch === refreshEpoch.current) setRefreshing(false);
    }
  }

  return (
    <section className="standalone-connect" aria-labelledby="standalone-connect-title">
      <header>
        <p className="eyebrow">Local setup</p>
        <h1 id="standalone-connect-title">Connect to Interactive Brokers</h1>
        <p>Brontide runs on this computer. Sign in to Trader Workstation (TWS) there; Brontide never needs your IBKR password.</p>
      </header>

      {fixture && <p className="standalone-connect-fixture" role="status">Synthetic setup walkthrough. These statuses and account names come from an isolated test fixture, not TWS. No broker account is bound.</p>}
      <section className="standalone-connect-grid" aria-label="Connection readiness">
        <section className="metric-card"><span className="metric-label">Local session</span><strong>{localSessionActive ? "Checked at launch · sample only" : "Sample mode"}</strong><small>{localSessionActive ? "The local session was verified when this page loaded; it may expire. Broker execution remains locked." : "Trading is available for planning only. A local trading session has not been established."}</small></section>
        <section className="metric-card"><span className="metric-label">Official API package</span><strong>{fixture?.sdk === "missing" ? "Missing · fixture" : fixture?.sdk === "incompatible" ? "Incompatible · fixture" : fixture?.sdk === "compatible" ? "Compatible · fixture" : "Not verified"}</strong><small>{fixture?.sdk === "missing" ? "Obtain the official IBKR API package before broker use." : fixture?.sdk === "incompatible" ? "This package cannot be used; use a vendor-supported compatible version." : "A supported IBKR API installation must be checked before broker use."}</small></section>
        <section className="metric-card"><span className="metric-label">TWS connection</span><strong>{fixture?.tws === "unavailable" ? "Unavailable · fixture" : fixture?.tws === "read-only" ? "Read-only · fixture" : fixture?.tws === "available" ? "Available · fixture" : "Not checked"}</strong><small>{fixture?.tws === "read-only" ? "TWS API read-only mode blocks order submission." : fixture?.tws === "unavailable" ? "Open TWS and sign in locally before checking connectivity." : "Opening this page does not contact TWS."}</small></section>
        <section className="metric-card"><span className="metric-label">Account and environment</span><strong>{fixture?.environment === "unverified" ? "Environment unverified · fixture" : confirmed ? "Walkthrough choice recorded" : fixture?.accounts.length ? "Confirmation required · fixture" : "Not confirmed"}</strong><small>{fixture ? "A fixture label is not broker proof. No real account or paper/live identity is verified." : "No account is selected. Paper or live identity has not been verified."}</small></section>
      </section>

      {fixture && <section className="standalone-connect-steps" aria-labelledby="standalone-fixture-accounts-title">
        <h2 id="standalone-fixture-accounts-title">Account selection walkthrough</h2>
        <p>Choose one synthetic candidate to rehearse confirmation. This does not save a broker binding or permit execution.</p>
        {fixture.accounts.length ? <>
          <label htmlFor="standalone-fixture-account">Synthetic account candidate</label>
          <select id="standalone-fixture-account" value={selected} onChange={event => {
            selectionEpoch.current += 1; setSelected(event.target.value); setConfirmed("");
          }}>
            <option value="">Choose a candidate</option>
            {fixture.accounts.map(account => <option value={account} key={account}>{account}</option>)}
          </select>
          <button type="button" className="secondary-button" disabled={!canWalkThroughSelection || !selected || confirmed === selected} onClick={() => setConfirmed(selected)}>Confirm walkthrough choice</button>
          {confirmed && <p role="status">Synthetic choice {confirmed} recorded for this view only. Broker identity remains unverified.</p>}
        </> : <p>No account candidates were reported by the fixture.</p>}
        {!canWalkThroughSelection && <p role="status">Confirmation is blocked until the fixture reports a compatible SDK, available TWS API and verified paper environment.</p>}
        <button type="button" className="secondary-button" disabled={refreshing} onClick={refreshFixture}>Refresh synthetic local status</button>
        {refreshMessage && <p role="status">{refreshMessage}</p>}
      </section>}

      <section className="standalone-connect-lock" aria-label="Execution status">
        <strong>Order submission locked</strong>
        <p>Connection, account selection and current market data must be verified before any order can be reviewed. Connecting alone will never place an order.</p>
      </section>

      <section className="standalone-connect-steps" aria-labelledby="standalone-connect-steps-title">
        <h2 id="standalone-connect-steps-title">Prepare your local setup</h2>
        <ol>
          <li>Install TWS and sign in directly through Interactive Brokers.</li>
          <li>Follow IBKR&apos;s instructions to configure TWS API access. Keep the API read-only while setup and acceptance remain incomplete.</li>
          <li>Use the official IBKR API download and license when a supported package is available. Brontide will require a compatibility check.</li>
          <li>Later, confirm the exact account and paper/live environment in Brontide before execution is enabled.</li>
        </ol>
        <div className="standalone-connect-links">
          <a href="https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/" target="_blank" rel="noopener noreferrer">Official TWS API setup</a>
          <a href="https://interactivebrokers.github.io/" target="_blank" rel="noopener noreferrer">Official API download and license</a>
        </div>
      </section>

      <div className="standalone-connect-actions">
        <button type="button" className="primary-button" onClick={onOpenTrading}>Explore Trading with sample data</button>
        <button type="button" className="secondary-button" onClick={onOpenJournal}>Explore Journal</button>
      </div>
    </section>
  );
}
