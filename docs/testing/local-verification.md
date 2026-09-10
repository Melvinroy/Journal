# Local verification

Run the complete local verification from the repository root:

```powershell
npm run verify
```

## Prerequisites

- Node.js 20.9 or newer and repository dependencies installed with `npm install` or `npm ci`.
- Playwright Chromium installed once with `npx playwright install chromium`.
- The EOD environment at `services/eod/.venv`, created with Python 3.11 or newer and installed with `services/eod/.venv/Scripts/python.exe -m pip install -e "./services/eod[dev]"` on Windows. On macOS/Linux the runner selects `services/eod/.venv/bin/python`.

Missing or unsupported prerequisites stop verification with a specific error. The runner never falls back to PATH Python.

## Stages

The command runs sequentially and stops at the first failure:

1. Every existing Node test: `node --test tests/*.test.mjs`.
2. Every EOD backend test through the explicit service virtual environment.
3. TypeScript: `tsc --noEmit`.
4. The focused Playwright browser regressions, including the locked chart screenshots and shared workspace quality checks. Screenshot baselines are compared and are never updated by this command.
5. One production build through the existing `scripts/build.mjs` runner.

Each stage prints PASS/FAIL and elapsed time. The header prints the exact Node, Python, pytest, and Chromium runtimes. Any failed or interrupted child returns a nonzero result.

When `BRONTIDE_VERIFY_REPORT_DIR` is set, the runner writes an EOD JUnit report there and Playwright adds HTML and JUnit reports. Playwright failure screenshots, visual diffs, and traces remain under `test-results`. This reporting switch does not update screenshot baselines.

Backend tests receive dummy provider credentials, an unreachable loopback provider/proxy, and a unique database path under the operating-system temporary directory. Tests continue to use their existing `tmp_path`, mock transports, and local FastAPI clients. The production database and live provider services are not used. The isolated directory is removed after the run.

The browser suite uses its development server and the final stage performs the only production build, avoiding a duplicate build. Lint is not configured in Journal and is not part of this command. The merged [CI workflow](../../.github/workflows/verify.yml) invokes the same command; see [current CI and protection status](ci-verification.md).

## Frontend review gate

Before handing off any frontend change:

1. Record the checkout, branch, HEAD, working-tree state, preview identifier, and exact URL. Confirm the visible `Preview …` identifier equals the current identifier printed by the preview process; restart a stale preview rather than reviewing it.
2. Inspect the affected flow in a browser. Exercise applicable desktop/laptop/mobile sizes, same-page wide → narrow → wide resizing, interactions, keyboard focus, dialogs, validation, and loading/empty/error/stale states. Include a short independent check for clipping, overflow, overlap, misleading actions, and inaccessible controls.
3. Report automated results, direct browser observations, and untested cases separately. Document intentional scrolling containers rather than treating their internal overflow as page clipping.

The identifier is HEAD plus a short digest of staged, unstaged, and nonignored untracked source content. Generated builds, outputs, caches, logs, test artifacts, temporary files, and `brontide-preview-identity.json` are excluded. Only the digest is displayed; source paths and contents are not exposed. Development and `npm run local` previews include it; deployment builds do not.

Browser viewport/device-scale simulation is not physical monitor movement. Record a native monitor/DPI result only against the exact identifier physically tested, and list it as unverified again after the identifier changes.

New Journal performance metrics must reuse the shared `MetricCard` structure and Journal semantic formatting so positive, negative, zero, and unavailable results remain consistent in cards, rows, and details.

### Controlled layout-regression proof — 9 September 2026

A detached disposable worktree reproduced the active staged, unstaged, and eligible untracked source state at `42628c2e+d.6cef4912`; the full internal source digests matched before fault injection. Two disposable-only CSS faults produced exit 1: selected-Journal padding moved the shared tab geometry by 64 CSS pixels, and an oversized Journal surface reached x=1585 in a 1440-pixel viewport even though document `scrollWidth` still reported a fit. After removing both faults, the same two focused tests passed. The active checkout was not changed by this proof, the disposable worktree was removed, and no screenshot baseline was updated.

## Historical Step 2 changed files

- `package.json` — adds `npm run verify`.
- `scripts/verify.mjs` — validates prerequisites and runs the five fail-fast stages.
- `docs/testing/local-verification.md` — documents runtimes, isolation, stages, and limitations.

This list records the original Step 2 implementation, not pending work. The verification command itself does not change branch protection, global instructions, hooks, lint, plugins, application source, or deployment configuration.
