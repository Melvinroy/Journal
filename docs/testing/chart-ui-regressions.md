# Chart UI regression harness

Run the two corrected Phase 2 UI regressions with:

```powershell
npm run test:ui-regressions
```

Install the repository dependencies and Playwright Chromium once on a new machine with `npm install` and `npx playwright install chromium`. The checked-in runner starts its own development server on `127.0.0.1:3107`, uses the seeded NVDA sample series, fixes the viewport and device scale, disables animation during comparisons, and runs one Chromium worker. It suppresses Next.js agent-file generation in the child server and restores Next's generated `next-env.d.ts` references after the run.

The four tests cover the rail geometry and real click targets in light/dark themes, then exercise the actual chart canvas with the volume indicator and price moving-average controls. Four reviewed snapshots provide focused comparisons for the rail and for the combined price/volume rendering.

## Baselines reviewed

- `tests/ui/__screenshots__/toolbar-light.png`
- `tests/ui/__screenshots__/toolbar-dark.png`
- `tests/ui/__screenshots__/price-and-volume-light.png`
- `tests/ui/__screenshots__/price-and-volume-dark.png`

The toolbar images were reviewed at their original 48×280 resolution. They show the active Trend Line and chevron wholly inside the rail. The chart images were reviewed at their original 1232×672 resolution. They show the seeded price chart with MA20/MA50/MA200 and a lower pane containing volume bars without line overlays.

## Historical defect-detection proof

The corrected branch passed the documented command: four tests passed, covering both defects in light and dark themes.

Each original defect was then reintroduced separately in the disposable detached worktree `C:/Users/melvi/Projects/Journal-harness-proof`. The harness files and reviewed baselines were copied into that checkout; no active-checkout file was modified.

| Isolated defect | Focused command | Expected result observed |
|---|---|---|
| Original protruding chevron CSS from `b4ee336` | `npm run test:ui-regressions -- --grep "active tool"` | Exit 1; both theme cases reported expected `contained: true`, received `contained: false` |
| Original KLineCharts VOL defaults from `b4ee336` | `npm run test:ui-regressions -- --grep "volume is"` | Exit 1; light comparison differed by 1,577 pixels and dark by 1,536 pixels, localized to the three rendered volume-average lines |

The disposable worktree was removed after the proof. The corrected checkout passed all four locked comparisons at that time. These records are retained evidence, not new test results from documentation maintenance.

## Scope and limitations

- The harness runs Chromium at 1280×720 on one worker. It targets the two reported desktop defects rather than repeating the broader Phase 2 responsive suite.
- Pixel baselines are environment-sensitive. They were captured and verified on the project’s current Windows Chromium environment; a future Linux CI job should use baselines generated and reviewed in that fixed environment.
- The 75-pixel tolerance absorbs minor antialiasing noise. The reproduced volume defect changed more than 1,500 pixels per theme.
- The runner starts the Next.js development server. Production build verification is the final stage of [the unified verification command](local-verification.md). The harness is merged; [CI and branch protection](ci-verification.md) enforce verification on pull requests.

## Historical Step 1 changed files

- `.gitignore` — ignores Playwright reports and transient test results.
- `package.json`, `package-lock.json` — adds the command and the sole new dependency, `@playwright/test`.
- `playwright.ui.config.ts` — fixes the browser environment and owns the test server.
- `scripts/run-ui-regressions.mjs` — forwards runner arguments and restores Next's generated type references.
- `tests/ui/chart-regressions.spec.ts` — contains the four light/dark interaction and rendering regressions.
- `tests/ui/__screenshots__/*.png` — contains the four reviewed visual baselines.
- `docs/testing/chart-ui-regressions.md` — documents execution, proof, baselines, and limitations.

No application source, global instruction, hook, CI, branch-protection, or deployment file changes were part of Step 1. This list describes that original step, not the current overall harness status.
