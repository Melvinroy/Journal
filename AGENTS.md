# Journal working agreements

## Verification

- Follow [local verification](docs/testing/local-verification.md) for prerequisites and runtime selection. EOD work must use the repository environment described there, including its version check; do not substitute an interpreter found on `PATH`.
- Use focused checks while iterating. Run `npm run verify` for executable-code, build, test-harness, or release-ready changes before presenting them for merge review. Minor documentation-only edits need only relevant targeted checks unless they affect verification behavior.
- Treat [the chart browser harness](docs/testing/chart-ui-regressions.md) as four focused regressions for the corrected toolbar and volume behavior at its documented Windows viewport and themes. It is not the full responsive or end-to-end chart suite.
- Never update screenshot baselines automatically. Review intentional baseline changes at their original dimensions in the fixed environment and inspect actual, expected, and diff images before accepting them.

## Delivery

- Work on the scoped branch and follow [the execution plan](docs/EXECUTION_PLAN.md), [the Windows handoff](docs/WINDOWS_CODEX_HANDOFF.md), and the active phase review packet. Do not push until the user approves the exact commit SHA, and do not merge or deploy until the user explicitly approves that action. Approval of one commit or gate does not carry forward; an implementation, local pass, or CI pass is not approval.
- Keep harness work separate from chart PR #2. The current CI and pending branch-protection dependency are recorded in [the CI verification guide](docs/testing/ci-verification.md).
