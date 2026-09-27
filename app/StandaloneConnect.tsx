import { useEffect, useRef, useState } from "react";
import { rememberedChoiceFromResponse } from "../lib/local-account-status";
import { localPaperReferenceFromResponse, type LocalPaperReferenceStatus } from "../lib/local-paper-reference";
import { localSdkMetadataFromResponse, type LocalSdkMetadata } from "../lib/local-sdk-status";
import { StandaloneAccountSelection } from "./StandaloneAccountSelection";
import type { OptionalStandaloneView } from "./standalone-module";

/** Read-only, synthetic status used by isolated browser fixtures. It never binds a broker account. */
export type ConnectionFixture = {
  source: "synthetic-fixture";
  generation: string;
  sdk: "missing" | "incompatible" | "compatible";
  tws: "unavailable" | "read-only" | "available";
  environment: "unverified" | "paper";
  accounts: string[];
};

type RememberedChoice = { profileId: string; kind: "checking" | "unbound" | "remembered" | "unavailable"; accountMask: string | null };
type ModuleSelection = { kind: "checking" | "sample" | "unavailable" } |
  { kind: "ready"; profileId: string; enabledViews: OptionalStandaloneView[]; canHideTrading: boolean };

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

export function StandaloneConnect({ onOpenTrading, onOpenJournal, onLocalSessionInvalid, onAccountConfirmed, localSessionActive, localProfileId = null, localCsrf = null, fixtureReadiness = null, moduleSelection, onSaveModules, canOpenTrading, canOpenJournal }: {
  onOpenTrading: () => void;
  onOpenJournal: () => void;
  onLocalSessionInvalid: () => void;
  onAccountConfirmed: (profileId: string, accountMask: string) => void;
  localSessionActive: boolean;
  localProfileId?: string | null;
  localCsrf?: string | null;
  fixtureReadiness?: ConnectionFixture | null;
  moduleSelection: ModuleSelection;
  onSaveModules: (views: OptionalStandaloneView[]) => Promise<boolean>;
  canOpenTrading: boolean;
  canOpenJournal: boolean;
}) {
  const [chosenViews, setChosenViews] = useState<OptionalStandaloneView[]>(
    moduleSelection.kind === "ready" ? moduleSelection.enabledViews : ["trading", "journal"]);
  const [savingViews, setSavingViews] = useState(false);
  const [viewMessage, setViewMessage] = useState("");
  useEffect(() => {
    setChosenViews(moduleSelection.kind === "ready" ? moduleSelection.enabledViews : ["trading", "journal"]);
    setSavingViews(false);
    setViewMessage("");
  }, [moduleSelection]);
  const moduleReady = moduleSelection.kind === "ready" &&
    moduleSelection.profileId === localProfileId && localSessionActive;
  const chooseView = (view: OptionalStandaloneView) => {
    setViewMessage("");
    setChosenViews(current => current.includes(view)
      ? current.filter(item => item !== view)
      : (["trading", "journal"] as const).filter(item => item === view || current.includes(item)));
  };
  const saveViews = async () => {
    if (!moduleReady || savingViews || chosenViews.length === 0) return;
    setSavingViews(true);
    const saved = await onSaveModules(chosenViews);
    setViewMessage(saved ? "Workspace views saved for this local profile." :
      "View choice could not be verified. Reopen the local app before changing views.");
    setSavingViews(false);
  };
  const [fixtureState, setFixtureState] = useState<{ profileId: string; fixture: ConnectionFixture | null } | null>(
    localSessionActive && localProfileId ? { profileId: localProfileId, fixture: fixtureReadiness } : null,
  );
  const fixture = localSessionActive && localProfileId && fixtureState?.profileId === localProfileId
    ? fixtureState.fixture : null;
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [sdkMetadata, setSdkMetadata] = useState<LocalSdkMetadata | null>(null);
  const [checkingSdk, setCheckingSdk] = useState(false);
  const [sdkMessage, setSdkMessage] = useState("");
  const [rememberedChoice, setRememberedChoice] = useState<RememberedChoice | null>(null);
  const [accountSelectionAvailable, setAccountSelectionAvailable] = useState(false);
  const [paperReference, setPaperReference] = useState<
    { profileId: string; kind: "checking" | "unavailable" | LocalPaperReferenceStatus["kind"]; accountMask: string | null } | null>(null);
  const [paperAccount, setPaperAccount] = useState("");
  const [repeatPaperAccount, setRepeatPaperAccount] = useState("");
  const [checkedPaperAccount, setCheckedPaperAccount] = useState(false);
  const [savingPaperReference, setSavingPaperReference] = useState(false);
  const [paperReferenceUncertain, setPaperReferenceUncertain] = useState(false);
  const [paperReferenceMessage, setPaperReferenceMessage] = useState("");
  const selectionEpoch = useRef(0);
  const refreshEpoch = useRef(0);
  const sdkEpoch = useRef(0);
  const paperReferenceEpoch = useRef(0);
  const sdkScope = useRef({ profileId: localProfileId, active: localSessionActive });
  sdkScope.current = { profileId: localProfileId, active: localSessionActive };
  const referenceScope = useRef({ profileId: localProfileId, csrf: localCsrf,
    active: localSessionActive, fixture: Boolean(fixtureReadiness) });
  referenceScope.current = { profileId: localProfileId, csrf: localCsrf,
    active: localSessionActive, fixture: Boolean(fixtureReadiness) };
  const invalidateSession = useRef(onLocalSessionInvalid);
  invalidateSession.current = onLocalSessionInvalid;

  useEffect(() => {
    refreshEpoch.current += 1;
    sdkEpoch.current += 1;
    paperReferenceEpoch.current += 1;
    selectionEpoch.current += 1;
    setFixtureState(localSessionActive && localProfileId ? { profileId: localProfileId, fixture: fixtureReadiness } : null);
    setSelected("");
    setConfirmed("");
    setRefreshing(false);
    setRefreshMessage("");
    setSdkMetadata(null);
    setCheckingSdk(false);
    setSdkMessage("");
    setAccountSelectionAvailable(false);
    setPaperReference(null);
    setPaperAccount(""); setRepeatPaperAccount(""); setCheckedPaperAccount(false);
    setSavingPaperReference(false); setPaperReferenceUncertain(false);
    setPaperReferenceMessage("");
  }, [fixtureReadiness, localProfileId, localCsrf, localSessionActive]);

  async function checkPaperReference() {
    if (!localSessionActive || !localProfileId || !localCsrf || fixtureReadiness) return;
    const requestEpoch = ++paperReferenceEpoch.current;
    const currentProfile = localProfileId;
    const currentCsrf = localCsrf;
    const stillCurrent = () => requestEpoch === paperReferenceEpoch.current &&
      referenceScope.current.active && !referenceScope.current.fixture &&
      referenceScope.current.profileId === currentProfile && referenceScope.current.csrf === currentCsrf;
    setPaperReference({ profileId: currentProfile, kind: "checking", accountMask: null });
    setPaperReferenceMessage("");
    try {
      const response = await fetch("/v1/local/paper-reference", {
        credentials: "same-origin", cache: "no-store",
        headers: { "X-Brontide-Local": "1", "X-Brontide-CSRF": currentCsrf },
      });
      if (!stillCurrent()) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) invalidateSession.current();
        throw new Error("Paper reference status is unavailable.");
      }
      const status = localPaperReferenceFromResponse(await response.json());
      if (!stillCurrent()) return;
      if (!status) throw new Error("Paper reference status is inconsistent.");
      setPaperReference({ profileId: currentProfile, ...status });
      setPaperReferenceUncertain(false);
      setPaperAccount(""); setRepeatPaperAccount(""); setCheckedPaperAccount(false);
    } catch {
      if (stillCurrent()) {
        setPaperReference({ profileId: currentProfile, kind: "unavailable", accountMask: null });
        setPaperReferenceMessage("The private paper reference could not be checked. Trading remains locked.");
      }
    }
  }

  useEffect(() => {
    if (!localSessionActive || !localProfileId || !localCsrf || fixtureReadiness) return;
    void checkPaperReference();
    return () => { paperReferenceEpoch.current += 1; };
  }, [localSessionActive, localProfileId, localCsrf, fixtureReadiness]);

  async function savePaperReference() {
    if (!localSessionActive || !localProfileId || !localCsrf || fixtureReadiness ||
        paperReference?.profileId !== localProfileId || paperReference.kind !== "missing" ||
        savingPaperReference || paperReferenceUncertain || !checkedPaperAccount ||
        !/^[A-Z][A-Z0-9]{5,31}$/.test(paperAccount) || paperAccount !== repeatPaperAccount) return;
    const requestEpoch = ++paperReferenceEpoch.current;
    const currentProfile = localProfileId;
    const currentCsrf = localCsrf;
    const stillCurrent = () => requestEpoch === paperReferenceEpoch.current &&
      referenceScope.current.active && !referenceScope.current.fixture &&
      referenceScope.current.profileId === currentProfile && referenceScope.current.csrf === currentCsrf;
    setSavingPaperReference(true);
    setPaperReferenceMessage("");
    try {
      const response = await fetch("/v1/local/paper-reference", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "X-Brontide-Local": "1", "X-Brontide-CSRF": currentCsrf,
          "Content-Type": "application/json" },
        body: JSON.stringify({ typedAccount: paperAccount,
          repeatedAccount: repeatPaperAccount, checkedInIbkrPaper: true }),
      });
      if (!stillCurrent()) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) invalidateSession.current();
        throw new Error("Paper reference save was not confirmed.");
      }
      const status = localPaperReferenceFromResponse(await response.json());
      const expectedMask = paperAccount.slice(0, 2) + "•".repeat(paperAccount.length - 4) + paperAccount.slice(-2);
      if (!stillCurrent()) return;
      if (!status || status.kind !== "recorded" || status.accountMask !== expectedMask) {
        throw new Error("Paper reference acknowledgement was inconsistent.");
      }
      setPaperReference({ profileId: currentProfile, ...status });
      setPaperAccount(""); setRepeatPaperAccount(""); setCheckedPaperAccount(false);
      setPaperReferenceMessage("Private paper reference recorded. TWS identity and trading remain unverified.");
    } catch {
      if (stillCurrent()) {
        setPaperReferenceUncertain(true);
        setPaperReferenceMessage("The save result is uncertain. Check the saved reference before trying again; do not enter another account.");
      }
    } finally {
      if (stillCurrent()) setSavingPaperReference(false);
    }
  }

  useEffect(() => {
    if (!localSessionActive || !localProfileId || fixtureReadiness) return;
    const controller = new AbortController();
    setRememberedChoice({ profileId: localProfileId, kind: "checking", accountMask: null });
    (async () => {
      const response = await fetch("/v1/local/binding", {
        credentials: "same-origin", cache: "no-store",
        headers: { "X-Brontide-Local": "1" }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 409].includes(response.status)) invalidateSession.current();
        throw new Error("The saved account choice is unavailable.");
      }
      const payload = await response.json();
      const choice = rememberedChoiceFromResponse(payload);
      if (!controller.signal.aborted) {
        setAccountSelectionAvailable(choice !== null && payload?.accountSelectionAvailable === true);
        setRememberedChoice({ profileId: localProfileId,
          kind: choice?.kind ?? "unavailable", accountMask: choice?.accountMask ?? null });
      }
    })().catch(() => {
      if (!controller.signal.aborted) {
        setAccountSelectionAvailable(false);
        setRememberedChoice({ profileId: localProfileId, kind: "unavailable", accountMask: null });
      }
    });
    return () => controller.abort();
  }, [localSessionActive, localProfileId, fixtureReadiness]);

  const visibleChoice = localSessionActive && localProfileId && rememberedChoice?.profileId === localProfileId && !fixture
    ? rememberedChoice : null;

  const canWalkThroughSelection = fixture?.sdk === "compatible" &&
    fixture.tws === "available" && fixture.environment === "paper" && fixture.accounts.length > 0;

  async function refreshFixture() {
    if (!fixture || !localSessionActive || !localProfileId) return;
    const requestEpoch = ++refreshEpoch.current;
    const accountEpoch = selectionEpoch.current;
    setRefreshing(true);
    setRefreshMessage("");
    try {
      // Re-reads only the local fixture status. It cannot contact TWS or submit an order.
      const response = await fetch("/v1/local/session/status", {
        credentials: "same-origin", cache: "no-store", headers: { "X-Brontide-Local": "1" },
      });
      if (requestEpoch !== refreshEpoch.current) return;
      // A revoked session wins over a changed selection: never retain a stale confirmation.
      if (!response.ok) {
        setFixtureState(null); setSelected(""); setConfirmed("");
        if ([401, 403, 409].includes(response.status)) onLocalSessionInvalid();
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
        setFixtureState(null); setSelected(""); setConfirmed("");
        onLocalSessionInvalid();
        setRefreshMessage("Local identity or account changed. The walkthrough remains locked.");
        return;
      }
      if (requestEpoch !== refreshEpoch.current || accountEpoch !== selectionEpoch.current) {
        setRefreshMessage("Account choice changed during refresh. Check status again.");
        return;
      }
      const next = connectionFixtureFromStatus(status.connectionFixture);
      setFixtureState({ profileId: localProfileId, fixture: next }); setSelected(""); setConfirmed("");
      setRefreshMessage(next ? "Synthetic local status refreshed. Select the account again." : "Fixture status is unavailable. The walkthrough remains locked.");
    } catch {
      if (requestEpoch === refreshEpoch.current && accountEpoch === selectionEpoch.current) {
        setFixtureState(null); setSelected(""); setConfirmed("");
        setRefreshMessage("Local status is unavailable. The walkthrough remains locked.");
      }
    } finally {
      if (requestEpoch === refreshEpoch.current) setRefreshing(false);
    }
  }

  async function checkLocalSdk() {
    if (!localSessionActive || !localProfileId) return;
    const requestEpoch = ++sdkEpoch.current;
    const requestedProfile = localProfileId;
    const stillCurrent = () => requestEpoch === sdkEpoch.current &&
      sdkScope.current.active && sdkScope.current.profileId === requestedProfile;
    setCheckingSdk(true);
    setSdkMetadata(null);
    setSdkMessage("");
    try {
      // This local diagnostic only reads installed-package metadata. It does
      // not import the SDK, probe TWS, bind an account or enable submission.
      const response = await fetch("/v1/local/sdk/metadata", {
        credentials: "same-origin", cache: "no-store", headers: { "X-Brontide-Local": "1" },
      });
      if (!stillCurrent()) return;
      if (!response.ok) {
        if ([401, 403, 409].includes(response.status)) onLocalSessionInvalid();
        setSdkMessage("The local package check is unavailable. Broker execution remains locked.");
        return;
      }
      const result = localSdkMetadataFromResponse(await response.json());
      if (!stillCurrent()) return;
      if (!result) {
        setSdkMessage("The local package report could not be verified. Broker execution remains locked.");
        return;
      }
      setSdkMetadata(result);
    } catch {
      if (stillCurrent()) setSdkMessage("The local package check is unavailable. Broker execution remains locked.");
    } finally {
      if (stillCurrent()) setCheckingSdk(false);
    }
  }

  return (
    <section className="standalone-connect" aria-labelledby="standalone-connect-title">
      <header>
        <p className="eyebrow">Local setup</p>
        <h1 id="standalone-connect-title">Connect to Interactive Brokers</h1>
        <p>Brontide runs on this computer. Sign in to Trader Workstation (TWS) there; Brontide never needs your IBKR password.</p>
      </header>

      <section className="standalone-connect-steps" aria-labelledby="standalone-views-title">
        <h2 id="standalone-views-title">Choose your workspace</h2>
        <p>Trading opens Plan &amp; Positions. Journal shows saved trade history. Both are selected by default; hiding Journal never stops trade recording.</p>
        {moduleReady && moduleSelection.kind === "ready" ? <>
          <div className="standalone-view-options">
            <label><input type="checkbox" checked={chosenViews.includes("trading")}
              disabled={savingViews || !moduleSelection.canHideTrading ||
                (chosenViews.length === 1 && chosenViews.includes("trading"))}
              onChange={() => chooseView("trading")} /> Trading</label>
            <label><input type="checkbox" checked={chosenViews.includes("journal")}
              disabled={savingViews || (chosenViews.length === 1 && chosenViews.includes("journal"))}
              onChange={() => chooseView("journal")} /> Journal</label>
          </div>
          {!moduleSelection.canHideTrading && <p>Trading stays visible while a paper account is remembered and its exposure is unverified.</p>}
          <button type="button" className="secondary-button" disabled={savingViews ||
            chosenViews.length === moduleSelection.enabledViews.length &&
            chosenViews.every(view => moduleSelection.enabledViews.includes(view))}
            onClick={saveViews}>{savingViews ? "Saving views…" : "Save views"}</button>
        </> : <p role="status">{moduleSelection.kind === "sample"
          ? "Sample preview shows both views. Launch the installed app to save your choice."
          : moduleSelection.kind === "checking" ? "Checking your local view choices…"
          : "Saved view choices are unavailable. Reopen the local app; trading stays locked."}</p>}
        {viewMessage && <p role="status">{viewMessage}</p>}
      </section>

      {!fixture && localSessionActive && localCsrf && <section className="standalone-connect-steps standalone-paper-reference" aria-labelledby="paper-reference-title">
        <h2 id="paper-reference-title">Record your paper account</h2>
        <p>First check the full paper-account ID inside your own IBKR paper login, outside Brontide. This step stores a private reference to that account. It does not connect to TWS, verify paper mode, choose a trading account or allow orders.</p>
        {paperReference?.profileId === localProfileId && paperReference.kind === "recorded" &&
          <p role="status">Private reference: <strong>{paperReference.accountMask}</strong>. Connection and account identity still need separate verification.</p>}
        {paperReference?.profileId === localProfileId && paperReference.kind === "checking" &&
          <p role="status">Checking this profile's private paper reference…</p>}
        {paperReference?.profileId === localProfileId && paperReference.kind === "missing" && !paperReferenceUncertain && <form autoComplete="off" onSubmit={event => { event.preventDefault(); void savePaperReference(); }}>
          <label>Paper account ID checked in IBKR
            <input type="text" autoComplete="off" spellCheck={false} maxLength={32}
              value={paperAccount} onChange={event => setPaperAccount(event.target.value)} />
          </label>
          <label>Enter the same paper account ID again
            <input type="text" autoComplete="off" spellCheck={false} maxLength={32}
              value={repeatPaperAccount} onChange={event => setRepeatPaperAccount(event.target.value)} />
          </label>
          <label><input type="checkbox" checked={checkedPaperAccount}
            onChange={event => setCheckedPaperAccount(event.target.checked)} /> I checked this exact ID in my IBKR paper account, outside Brontide.</label>
          <button type="submit" className="secondary-button" disabled={savingPaperReference ||
            !checkedPaperAccount || !/^[A-Z][A-Z0-9]{5,31}$/.test(paperAccount) ||
            paperAccount !== repeatPaperAccount}>{savingPaperReference ? "Recording reference…" : "Record private paper reference"}</button>
        </form>}
        {(paperReference?.kind === "unavailable" || paperReferenceUncertain) &&
          <button type="button" className="secondary-button" disabled={savingPaperReference}
            onClick={() => void checkPaperReference()}>Check saved reference</button>}
        {paperReferenceMessage && <p role={paperReferenceUncertain ? "alert" : "status"}>{paperReferenceMessage}</p>}
      </section>}

      {!fixture && localSessionActive && localProfileId && localCsrf &&
        paperReference?.profileId === localProfileId && paperReference.kind === "recorded" &&
        visibleChoice?.kind === "unbound" && accountSelectionAvailable &&
        <StandaloneAccountSelection key={localProfileId}
          profileId={localProfileId} csrf={localCsrf} referenceMask={paperReference.accountMask!}
          onSessionInvalid={onLocalSessionInvalid}
          onConfirmed={(profileId, accountMask) => {
            setRememberedChoice({ profileId, kind: "remembered", accountMask });
            onAccountConfirmed(profileId, accountMask);
          }} />}
      {!fixture && localSessionActive && localProfileId &&
        paperReference?.profileId === localProfileId && paperReference.kind === "recorded" &&
        visibleChoice?.kind === "unbound" && !accountSelectionAvailable &&
        <p role="status">Broker account review is unavailable in this installed app. Your private reference is saved, but no TWS account is confirmed and orders remain locked.</p>}

      {fixture && <p className="standalone-connect-fixture" role="status">Synthetic setup walkthrough. These statuses and account names come from an isolated test fixture, not TWS. No broker account is bound.</p>}
      <section className="standalone-connect-grid" aria-label="Connection readiness">
        <section className="metric-card"><span className="metric-label">Local session</span><strong>{localSessionActive ? "Checked at launch · sample only" : "Sample mode"}</strong><small>{localSessionActive ? "The local session was verified when this page loaded; it may expire. Broker execution remains locked." : "Trading is available for planning only. A local trading session has not been established."}</small></section>
        <section className="metric-card"><span className="metric-label">IBKR API package</span><strong>{fixture?.sdk === "missing" ? "Missing · fixture" : fixture?.sdk === "incompatible" ? "Incompatible · fixture" : fixture?.sdk === "compatible" ? "Compatible · fixture" : sdkMetadata?.knownDependencyAdvisory ? "Known dependency advisory" : sdkMetadata?.metadataStatus === "metadata-present-unverified" ? "Found · source unverified" : sdkMetadata?.metadataStatus === "not-found-in-runtime" ? "Not found in this app" : sdkMetadata?.metadataStatus === "unavailable" ? "Check unavailable" : "Not verified"}</strong><small>{fixture ? "Synthetic status only. The installed package still needs its own check." : sdkMetadata?.knownDependencyAdvisory ? `Package metadata declares protobuf ${sdkMetadata.reportedProtobufPin}, which has a known security advisory. Broker execution remains locked; origin and compatibility are unverified.` : sdkMetadata?.metadataStatus === "metadata-present-unverified" ? `Reported version ${sdkMetadata.reportedVersion ?? "unknown"}; protobuf pin ${sdkMetadata.reportedProtobufPin ?? "unknown"}. Origin, security and compatibility remain unverified.` : sdkMetadata?.metadataStatus === "not-found-in-runtime" ? "No IBKR SDK package metadata was found in this app's Python runtime." : "A supported IBKR API installation must be checked before broker use."}</small>{!fixture && sdkMetadata?.knownDependencyAdvisory && <a href="https://github.com/advisories/GHSA-7gcm-g887-7qv7" target="_blank" rel="noopener noreferrer">Read the dependency advisory</a>}</section>
        <section className="metric-card"><span className="metric-label">TWS connection</span><strong>{fixture?.tws === "unavailable" ? "Unavailable · fixture" : fixture?.tws === "read-only" ? "Read-only · fixture" : fixture?.tws === "available" ? "Available · fixture" : "Not checked"}</strong><small>{fixture?.tws === "read-only" ? "TWS API read-only mode blocks order submission." : fixture?.tws === "unavailable" ? "Open TWS and sign in locally before checking connectivity." : "Opening this page does not contact TWS."}</small></section>
        <section className="metric-card"><span className="metric-label">Account and environment</span><strong>{fixture?.environment === "unverified" ? "Environment unverified · fixture" : fixture && confirmed ? "Walkthrough choice recorded" : fixture?.accounts.length ? "Confirmation required · fixture" : visibleChoice?.kind === "remembered" ? `Paper choice ${visibleChoice.accountMask} · disconnected` : visibleChoice?.kind === "checking" ? "Checking saved choice…" : visibleChoice?.kind === "unavailable" ? "Saved choice unavailable" : "Not confirmed"}</strong><small>{fixture ? "A fixture label is not broker proof. No real account or paper/live identity is verified." : visibleChoice?.kind === "remembered" ? "This is a previously confirmed paper choice, not proof of a current TWS connection, account state or permission to trade." : visibleChoice?.kind === "unavailable" ? "The private account choice could not be verified. Trading remains locked." : "No account is selected. Paper or live identity has not been verified."}</small></section>
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
        {localSessionActive && !fixture && <div>
          <button type="button" className="secondary-button" disabled={checkingSdk} onClick={checkLocalSdk}>Check local API package</button>
          {sdkMessage && <p role="status">{sdkMessage}</p>}
          <p>This reads package information in Brontide only. It does not connect to TWS or permit trading.</p>
        </div>}
      </section>

      <div className="standalone-connect-actions">
        {canOpenTrading && <button type="button" className="primary-button" onClick={onOpenTrading}>Explore Trading with sample data</button>}
        {canOpenJournal && <button type="button" className="secondary-button" onClick={onOpenJournal}>Explore Journal</button>}
      </div>
    </section>
  );
}
