# Journal working agreements

## Verification

- Follow [local verification](docs/testing/local-verification.md) for prerequisites and runtime selection. EOD work must use the repository environment described there, including its version check; do not substitute an interpreter found on `PATH`.
- Use focused checks while iterating. Run `npm run verify` for executable-code, build, test-harness, or release-ready changes before presenting them for merge review. Minor documentation-only edits need only relevant targeted checks unless they affect verification behavior.
- For chart-toolbar proposals, use [ChartDashboard](app/ChartDashboard.tsx), [chart styles](app/chart-workspace.css), [the focused browser tests](tests/ui/chart-regressions.spec.ts), and [their evidence guide](docs/testing/chart-ui-regressions.md). The harness covers four focused regressions for the corrected toolbar and volume behavior at its documented Windows viewport and themes, not the full responsive or end-to-end chart suite.
- Never update screenshot baselines automatically. Review intentional baseline changes at their original dimensions in the fixed environment and inspect actual, expected, and diff images before accepting them.
- Every frontend change must verify that the served preview identifier matches the intended checkout, HEAD, and current staged, unstaged, and eligible untracked source edits, and must report that identifier with the exact inspected URL. A build alone is insufficient: inspect the affected flow in a browser, including relevant responsive, interaction, keyboard, form-error, dialog, and accessibility states, plus a short independent review for additional defects.
- Frontend handoffs must separate automated results, direct manual observations, and untested cases. Viewport or device-scale emulation is not native monitor/DPI evidence; carry a physical result forward only for the exact preview identifier that was tested. Follow the frontend evidence rules in [local verification](docs/testing/local-verification.md).

## Delivery

- Work on the scoped branch. For implementation and release work, follow [the execution plan](docs/EXECUTION_PLAN.md), [the Windows handoff](docs/WINDOWS_CODEX_HANDOFF.md), and the active phase review packet; chart-toolbar proposals start with the focused route above. Do not push until the user approves the exact commit SHA, and do not merge or deploy until the user explicitly approves that action. Approval of one commit or gate does not carry forward; an implementation, local pass, or CI pass is not approval.
- Follow the current required checks and protection settings in [the CI verification guide](docs/testing/ci-verification.md). Chart PR #2 and harness PR #3 are merged; their former stacked-PR dependency is historical, not a pending release gate.
