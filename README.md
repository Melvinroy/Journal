# Brontide

<p align="center">
  <img src="public/og.png" alt="Brontide — Review clearly. Trade deliberately." width="100%" />
</p>

<p align="center"><strong>Plan deliberately. Track every position. Learn from every trade.</strong></p>

Brontide is an open-source, local-first trading workspace. The modular desktop direction starts with **Trading** and **Journal** over one execution record. It reuses the existing planner, position management and Journal interface rather than rebuilding them as separate apps.

> **Release status:** the modular Windows build is an **unsigned, execution-locked engineering candidate**. There is no public broker-enabled installer or one-command download yet. The historical paper acceptance count is **2/30**; the repaired protection path still needs broker verification. Do not use this candidate for live orders.

## Start here

| You want to… | Use this path |
| --- | --- |
| See the current local candidate | [Candidate installation and limits](docs/trading/CANDIDATE_INSTALL.md) |
| Understand what is built and what is still gated | [Modular product plan](docs/trading-modular-product-plan.md) |
| Review paper-trading evidence | [Trading acceptance matrix](docs/trading/IBKR_PAPER_ACCEPTANCE_QC.md) |
| Contribute to the existing web app | [Local verification guide](docs/testing/local-verification.md) |

Once a signed, qualified release exists, this section will have **one primary Windows download** and a copyable install command for the same versioned artifact. We will not point an install command at an unsigned development build or an automatically changing branch.

## The intended experience

1. Install Brontide for Windows and open it from your own desktop. The interface runs in your local browser; your private service binds only to `127.0.0.1`.
2. Choose **Trading** or **Journal**. Journal recording continues even when you are looking at Trading.
3. Use **Connect** to confirm the local TWS API prerequisites and the exact account and paper/live environment. Sign in to IBKR through TWS; Brontide never asks for your IBKR password.
4. Save a plan, review its exact terms and explicitly confirm an entry. Confirmed executions, exits and fees update Positions and Journal from the same ledger.

Steps 3–4 describe the **target product**, not a claim that this candidate can submit orders. The current candidate offers the reused views in a locked sample mode. Connection qualification, operational security proof and broker acceptance remain open.

## What is available now

| Area | Current state |
| --- | --- |
| Existing Plan, Positions and Journal UI | Reused in the modular standalone route. |
| Local browser session | One-use launcher authorization, exact loopback Host/Origin checks and HttpOnly session cookie; no broker authority. |
| Local view preference | Stored separately under the Windows user's local profile; no legacy records are silently imported. |
| Paper execution service | Existing safeguarded implementation, still subject to its submission lock and feature limits. |
| Broker setup and public installer | In progress; no public trading release. |
| Shorts, GTC, overnight and four populated exit legs | Full-planner targets. Execution remains blocked pending implementation and qualification. |

The independent [feature inventory and architecture contracts](docs/trading/MODULAR_CONTRACTS.md) separate visible planning controls from executable broker support. Automated fixtures and a sample screen cannot substitute for a paper-broker acknowledgement.

## Why local first?

The desktop service can keep its ledger and private state under your Windows account and connect to a TWS instance on the same machine. A static GitHub Pages site can describe or download the app, but it cannot safely act as a remote trading service when your laptop or TWS is off. No cloud subscription is required for the planned standalone session. The existing cloud-backed web workflow remains separate during migration.

Brontide does **not** bundle IBKR's API SDK in its candidate package. Users must accept the vendor's terms and install a supported SDK separately when broker setup is eventually enabled. [IBKR's API license](https://interactivebrokers.github.io/) restricts redistribution; permitted public product use needs clarification before a broker-enabled release.

## Build and review source

This repository also contains the earlier multi-workspace web app. See [the execution plan](docs/EXECUTION_PLAN.md), [Windows handoff](docs/WINDOWS_CODEX_HANDOFF.md), [service setup](services/eod/README.md), [legacy self-hosting guide](docs/SELF_HOSTING.md) and [security policy](SECURITY.md). Follow [local verification](docs/testing/local-verification.md) before treating a build as reviewed. `npm run verify` is the full repository check; it does not place broker orders.

The new candidate is built from a Windows x64 checkout with `scripts/package-windows-candidate.ps1` after the repository's Node and private Python build environments are installed. This source-build path is for contributors and is distinct from the eventual one-command end-user installer.

## Contributing and license

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Brontide source is [MIT licensed](LICENSE); the IBKR SDK and bundled third-party dependencies retain their own licenses. Never include credentials, private databases or raw broker callbacks in an issue or pull request.
