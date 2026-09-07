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
4. The four locked Playwright browser regressions from Harness Step 1. Screenshot baselines are compared and are never updated by this command.
5. One production build through the existing `scripts/build.mjs` runner.

Each stage prints PASS/FAIL and elapsed time. The header prints the exact Node, Python, pytest, and Chromium runtimes. Any failed or interrupted child returns a nonzero result.

When `BRONTIDE_VERIFY_REPORT_DIR` is set, the runner writes an EOD JUnit report there and Playwright adds HTML and JUnit reports. Playwright failure screenshots, visual diffs, and traces remain under `test-results`. This reporting switch does not update screenshot baselines.

Backend tests receive dummy provider credentials, an unreachable loopback provider/proxy, and a unique database path under the operating-system temporary directory. Tests continue to use their existing `tmp_path`, mock transports, and local FastAPI clients. The production database and live provider services are not used. The isolated directory is removed after the run.

The browser suite uses its development server and the final stage performs the only production build, avoiding a duplicate build. Lint is not configured in Journal and is not part of this command. The merged [CI workflow](../../.github/workflows/verify.yml) invokes the same command; see [current CI and protection status](ci-verification.md).

## Historical Step 2 changed files

- `package.json` — adds `npm run verify`.
- `scripts/verify.mjs` — validates prerequisites and runs the five fail-fast stages.
- `docs/testing/local-verification.md` — documents runtimes, isolation, stages, and limitations.

This list records the original Step 2 implementation, not pending work. The verification command itself does not change branch protection, global instructions, hooks, lint, plugins, application source, or deployment configuration.
