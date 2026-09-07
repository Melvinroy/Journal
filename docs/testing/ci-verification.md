# Pull-request verification

`.github/workflows/verify.yml` runs the existing `npm run verify` command on every pull request and on pushes to `codex/HarnassValidation`. It uses `windows-latest` because the four current screenshot baselines were reviewed on Windows.

The job installs Node 22, Python 3.11, locked npm dependencies, the EOD development dependencies in `services/eod/.venv`, and Playwright Chromium. The verification command still owns prerequisite validation, test isolation, stage ordering, and failure behavior; the workflow does not reproduce that logic.

The job supplies no production credentials. `npm run verify` assigns dummy provider credentials, blocks external provider traffic, and creates a temporary DuckDB path for backend tests. Screenshot comparison stays enabled with the reviewed thresholds, and CI never passes an update-snapshots option.

On failure, the workflow uploads the captured verification log, EOD and Playwright JUnit reports when reached, the Playwright HTML report, traces, actual screenshots, and screenshot differences. A failure before a report-producing stage remains visible in `verify.log` and the Actions step log.

The workflow does not deploy, change branch protection, or configure lint. The dedicated harness PR targets `codex/chart-phase-2-drawings` because these regressions depend on the unmerged Phase 2 chart corrections in PR #2.

## Pending branch protection

Harness Step 4 remains pending because PR #2 cannot produce the required `Windows verification` check while the workflow exists only in dependent PR #3. Do not enable the required check yet.

The release sequence is: obtain explicit approval to merge and deploy PR #2; update PR #3 to target the resulting `main`; require a fresh successful verification against that current base; obtain separate approval to merge and deploy PR #3; then enable and read back protection for `main`. Until those releases are authorized, keep both PRs unmerged and leave protection unchanged so PR #2 is not blocked by an unavailable check.
