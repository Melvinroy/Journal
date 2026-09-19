import Link from "next/link";

const scenarios = [
  ["Broker-observed", "NVDA pilot", "One completed round trip; historical evidence."],
  ["Failed", "F protection and recovery", "Round trip completed, but cleanup cancelled protection. Recovery does not turn this scenario into a pass."],
  ["Broker-observed", "SOFI cancellation", "Cancelled without a fill; not a completed round trip."],
  ["Deterministic", "Lifecycle, replay and accounting", "Automated simulated-event coverage; not broker acceptance."],
  ["Unobserved", "Repaired protection, concurrency and reconnect", "Require a separate paper-TWS acceptance run through the ordinary planner controls."],
  ["Blocked", "Live trading", "No approved live release mode. Paper evidence cannot establish live readiness."],
  ["Blocked", "Shorts, auctions, overnight and four-leg allocations", "Outside the supported bounded paper lifecycle."],
];

export default function VerificationPage() {
  return <main style={{ maxWidth: 1000, margin: "24px auto", padding: 16 }}>
    <Link href="/">Back to workspace</Link>
    <h1>Trading verification</h1>
    <p><strong>Not approved for live trading.</strong> This page reports evidence; it cannot submit orders.</p>
    <p>Historical broker evidence through September 17, 2026: two completed round trips toward the requested 30. The persisted historical approval still has a target of 200; an authenticated, audited reduction is required before any future execution.</p>
    <p>Review source: <code>589653dd</code>. This historical evidence is not certification of the current preview. The current repair requires its own verification report.</p>
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>Evidence</th><th>Scenario</th><th>Result / limitation</th></tr></thead><tbody>{scenarios.map(([state, name, result]) => <tr key={name}><td>{state}</td><th scope="row">{name}</th><td>{result}</td></tr>)}</tbody></table></div>
    <h2>Acceptance limits</h2>
    <p>Three shares per campaign, two simultaneous campaigns, $500 entry notional, $10 planned risk per campaign and $20 total. PL and AMD excluded. A cancelled entry does not count as a round trip.</p>
    <h2>Remaining release gates</h2>
    <p>Broker-confirmed repaired protection and recovery; account isolation; fresh-data validation; deployed ownership policies; restorable backups; operational alerts; and a reviewed release for an explicitly limited feature set.</p>
    <p>Paper submissions remain locked under the existing execution boundary. No broker tests or live readiness are implied by successful automated tests.</p>
  </main>;
}
