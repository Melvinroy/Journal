# Brontide: consolidated local handoff

## Start here

The canonical repository is `C:\Users\melvi\Projects\Journal`, branch `main`. Scanner and Trading development were consolidated from `codex/ibkr-paper-lifecycle`; see the latest local commit and [QC report](TRADING_QC_2026_09_16.md) for verification. Nothing was pushed or deployed. Retain the other checkouts, branches and chat history until the operator separately chooses to remove them.

The reviewed preview runs from `C:\Users\melvi\Projects\Journal-paper-lifecycle` on port **8766**, with the same committed application source. Port **8765** is the older Scanner preview. Use `http://127.0.0.1:8766/` for sign-in and `http://127.0.0.1:8766/?demo=1` only for isolated simulation. Verify the visible preview identifier before testing.

## What is included

- Discover Scanner, approximate ranking disclosure, result delivery and updater corrections.
- One Trade Planner, account summary above it, positions beside setup on wide screens, stacked on smaller screens.
- Authenticated local paper execution service, durable command/event ledger, exact ticket review, position management and shared Journal projections.
- Readability, stop precision, eligibility, Journal search/source and broker-ID corrections described in the QC report.

## What remains before real paper testing

1. Sign into Brontide; explicitly confirm the verified user-to-paper-account link. Credentials stay in TWS.
2. Check the current connection and quote availability. Historical error 10197 must not be assumed current.
3. Prepare fresh qualified tickets and approve their exact quantities, price bounds, protection and exits. The server remains submission-locked until the approved session is enabled.
4. Run the one-campaign pilot, then two campaigns, and reconcile acknowledgement, fills, stops, exits, fees and cleanup separately.
5. Only after a passed pilot, progress through reviewed sequential checkpoints of 10, 50 and 100/200 trades. Preserve the existing limits and unrelated broker exposure.

No broker execution is established by simulation or UI fixtures. Shorts without enforceable bounds, auctions and overnight remain blocked. Four active exit legs need more than the permitted three shares and therefore remain deterministic-only coverage.

## Working rules

Read `AGENTS.md` and `docs/testing/local-verification.md`. Use the repository EOD Python environment. Preserve local untracked files and all private databases/environments; never commit credentials or broker records. The paper ledger is separate from EOD data. Run scoped checks and `npm run verify` for implementation work, then inspect the exact served source in a browser using frontend-verification. Push, deployment, branch deletion and chat deletion require separate instructions.
