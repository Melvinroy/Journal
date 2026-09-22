import Link from "next/link";
import { acceptanceMatrix, evidenceGroups, recordedVerificationSource, tradingEvidence } from "../../lib/trading-verification";
import "./verification.css";

export default function VerificationPage() {
  const preview = process.env.NEXT_PUBLIC_BRONTIDE_PREVIEW_ID;
  return <main className="trading-verification">
    <header>
      <Link href="/">Back to workspace</Link>
      <p className="verification-kicker">Plan · Positions · Journal</p>
      <h1>Trading verification</h1>
      <p>What has been checked, what happened in paper trading, and what still needs evidence.</p>
      {preview && <p className="verification-preview" data-preview-identifier={preview}>Current preview: <code>{preview}</code>. This identifies the page you are viewing, not a verified trading release.</p>}
    </header>
    <section className="verification-overview" aria-labelledby="verification-readiness">
      <h2 id="verification-readiness">Not approved for live trading</h2>
      <p>This page reports evidence only. It cannot submit orders or change permissions.</p>
      <p><strong>2 of 30 historical round trips</strong> — NVDA and F. F's protection scenario failed; SOFI had no fill.</p>
      <p>The requested total is 30. The persisted historical session target remains 200 and requires an audited reduction before any permitted execution. Both historical completions count toward the ceiling.</p>
    </section>
    <section className="verification-baseline" aria-labelledby="verification-baseline">
      <h2 id="verification-baseline">Recorded automated baseline</h2>
      <p>September 23, 2026 (Singapore): full verification passed with 207 Node, 278 backend and 70 browser tests, plus TypeScript and the production build. Skipped cases are not passes.</p>
      <p>Recorded source: <a href={`https://github.com/Melvinroy/Journal/commit/${recordedVerificationSource}`}><code>{recordedVerificationSource.slice(0, 8)}</code></a>. These results precede new Phase 3 work and do not certify the current preview.</p>
      <p><a href="https://github.com/Melvinroy/Journal/actions/runs/35771433023">Recorded Windows verification run</a> · <a href={acceptanceMatrix.href}>{acceptanceMatrix.label}</a></p>
      <p className="verification-note">References below are immutable source snapshots. A document snapshot is not the execution source of a historical broker observation. Exact dates and sources are shown as not recorded when unavailable.</p>
    </section>
    <nav className="verification-navigation" aria-label="Evidence sections">
      {evidenceGroups.map(group => <a key={group.id} href={`#${group.id}`}>{group.title}</a>)}
    </nav>
    {evidenceGroups.map(group => <section key={group.id} id={group.id} className="verification-section" aria-labelledby={`${group.id}-heading`}>
      <h2 id={`${group.id}-heading`}>{group.title}</h2><p>{group.description}</p>
      <div className="verification-cards">{tradingEvidence.filter(record => record.group === group.id).map(record => <article key={record.id} className="verification-card" data-scenario-id={record.id}>
        <p className="verification-state" data-state={record.state}>{record.state}</p>
        <h3>{record.title}</h3><p>{record.summary}</p><p className="verification-limitation">{record.limitation}</p>
        <dl><div><dt>Verification / observation date</dt><dd>{record.verifiedDate ?? "Not recorded"}</dd></div>
          <div><dt>Verified / observed source</dt><dd>{record.source ? <a href={`https://github.com/Melvinroy/Journal/commit/${record.source}`}><code>{record.source.slice(0, 8)}</code></a> : "Not recorded"}</dd></div></dl>
        <ul aria-label={`${record.title} references`}>{record.references.map(reference => <li key={reference.href}><a href={reference.href}>{reference.label}</a></li>)}</ul>
      </article>)}</div>
    </section>)}
    <section className="verification-baseline" aria-labelledby="verification-limits">
      <h2 id="verification-limits">Acceptance limits and remaining gates</h2>
      <p>Three shares per campaign, two concurrent campaigns, $500 entry notional, $10 planned risk per campaign and $20 total. PL and AMD excluded. Checkpoints: 1, 10, 20 and 30.</p>
      <p>These are documented acceptance limits, not current account or connection status. Submission locks, unresolved security and operator gates, and separate live-release approval remain in force. Thirty trades cannot prove every combination or live readiness.</p>
      <p>The planner opens this page in a separate tab to preserve its draft. Return to your original workspace tab to continue that draft.</p>
    </section>
  </main>;
}
