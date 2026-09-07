# Pull-request verification

`.github/workflows/verify.yml` runs the existing `npm run verify` command on every pull request and on pushes to `codex/HarnassValidation`. It uses `windows-latest` because the four current screenshot baselines were reviewed on Windows.

The job installs Node 22, Python 3.11, locked npm dependencies, the EOD development dependencies in `services/eod/.venv`, and Playwright Chromium. The verification command still owns prerequisite validation, test isolation, stage ordering, and failure behavior; the workflow does not reproduce that logic.

The job supplies no production credentials. `npm run verify` assigns dummy provider credentials, blocks external provider traffic, and creates a temporary DuckDB path for backend tests. Screenshot comparison stays enabled with the reviewed thresholds, and CI never passes an update-snapshots option.

On failure, the workflow uploads the captured verification log, EOD and Playwright JUnit reports when reached, the Playwright HTML report, traces, actual screenshots, and screenshot differences. A failure before a report-producing stage remains visible in `verify.log` and the Actions step log.

The workflow does not deploy, change branch protection, or configure lint. Merges to `main` trigger the separate GitHub Pages deployment workflow; obtain the publication approvals required by [Journal working agreements](../../AGENTS.md) before pushing, merging or deploying.

## Current operating state

Verified against GitHub on 8 September 2026: both chart PR #2 and harness PR #3 are merged, the verification workflow is on `main`, and Harness Step 4 protection is active. Remote `main` was `333f8cd7c1c07335699cd82eb33575c0dcceb393` at this check. Recheck live state before a later release rather than treating this recorded SHA as permanently current.

| Protection | Effective setting |
|---|---|
| Pull requests | Required |
| Required approving reviews | 0 (solo workflow) |
| Required status check | `Windows verification`, restricted to GitHub Actions app ID `15368` |
| Branch up to date before merge | Required (`strict: true`) |
| Administrator enforcement | Enabled |
| Force pushes / branch deletion | Disabled / disabled |

Use a scoped branch from current remote `main`. Obtain a successful required check against the current PR base and follow the existing exact-SHA publication rules. Do not bypass checks. The documentation-only exception to local full verification does not waive GitHub's required check.

## Historical rollout and verification evidence

The original harness PR was stacked on `codex/chart-phase-2-drawings` because its regressions depended on the Phase 2 fixes. Protection was deliberately deferred until the workflow reached `main`. That dependency is resolved; the former instructions to keep both PRs unmerged and leave protection disabled no longer apply.

- [Chart PR #2](https://github.com/Melvinroy/Journal/pull/2) merged before the harness PR.
- [Harness PR #3](https://github.com/Melvinroy/Journal/pull/3) was retargeted to updated `main`, verified and merged on 7 September 2026. Its head was `ab0ef66158548b36ef89a067417ec49438002739`; the merge commit was `333f8cd7c1c07335699cd82eb33575c0dcceb393`.
- [Windows verification run 34140262363](https://github.com/Melvinroy/Journal/actions/runs/34140262363) succeeded for that PR head against the updated base.
- [Pages deployment run 34140562072](https://github.com/Melvinroy/Journal/actions/runs/34140562072) succeeded for merge commit `333f8cd7c1c07335699cd82eb33575c0dcceb393`.
- Protection was applied after those releases and its effective settings were read back. The table above records the maintenance readback; it is not a request to change protection.

These are existing results, not tests or deployments rerun during documentation maintenance. See [local verification](local-verification.md) for execution and [chart regressions](chart-ui-regressions.md) for coverage and historical defect-detection proof.
