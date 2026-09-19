# Workspace UI refinement — 16 September 2026

## Scope

Isolated `codex/workspace-ui-refinement` checkout, based on consolidated main `e46f95fdd6233daa3d64953405d70375383a0c02`.
Presentation changes only. Existing planning calculations, saved data formats, execution service, approval requirements, risk limits, account linking, Scanner formulas and Journal calculations are retained. Original and Scanner checkouts are preserved.

## Delivered changes

- Shared persistent disclosures, missing-value presentation and keyboard-operable narrow Plan / Positions tabs. Both panes stay mounted, preserving drafts and details. Preferences are separated between demo and account use.
- Account summary remains above the planner; blockers stay visible. Side-by-side planning and positions at 960 content pixels, including the 1,280px laptop window. Purpose-sized controls, readable supporting text, compact exits, and expandable presets/session explanations.
- Position rows emphasize remaining quantity, results and protection. Saved plans and closed records start collapsed. Details fit the workspace when the sidebar is present.
- Journal has six primary metrics and six under More statistics, one filter toolbar with Clear filters, distinct empty/incomplete states, compact empty charts, and accessible mobile summaries. Expanded single-record details receive adequate table height.
- Catalyst results precede optional analysis. Report metadata is compact, late-delivery warnings remain visible, and failed results retain a visible retry action. Full reports, history, themes, sources and chart navigation remain available.
- Scanner uses a 640px maximum panel with exactly Symbol / DV / Day %. Approximate ranking stays visible. Settings support Close and Escape with focus return. Update details expand in the page without covering Settings.

## Regression findings resolved

The first integration pass exposed Scanner update details covering Settings, drawer containment at an intermediate width, chart height failing to adapt, and the exact 960px container boundary rounding into the wrong layout. Focused checks were added or updated and rerun. Existing tests now follow intentionally collapsed sections and preserve domain assertions.

## Verification record

### Automated results

- `npm run verify`: all five stages passed. Node: 200 passed, 2 skipped. EOD: 217 passed, using the checkout's Python 3.11.9 environment and official matching TWS SDK. TypeScript passed. Browser: 53 passed, 3 skipped. Production build passed. Log: `output/verify-verified.log`; reports: `output/ui-refinement/verified`.
- After the final typography changes, all 41 Trading, Journal and refinement browser checks passed (`output/verify-typography.log`). After runner alignment and mobile touch-height adjustments, all five refinement checks passed (`output/verify-final-layout.log`). The final unrelated-position wrapping regression also passed (`output/verify-final-wrapping.log`).
- Coverage includes 1600, 1280, 1024, 768 and 390px viewports, both sides of the 960px content breakpoint, same-page resize roundtrips, drafts, presets, targets, both runners, amendments, exact-review dialogs, keyboard/Escape/focus return, missing-data states, and 200% CSS zoom emulation. No screenshot baseline was changed.
- Skips are two existing optional Node cases and three optional private Catalyst fixture/integration cases. Lint is not configured. Generated logs and reports are local artifacts and are not committed.

### Direct browser observations

Directly inspected the served preview on `http://127.0.0.1:8766/?demo=1`, checking its visible identifier against the source digest and manifest. Final typography was also inspected in the test preview before the committed preview was rebuilt.

- Laptop planner/positions columns, compact tabs, preserved unsaved entry through resizing, both runners, preset disclosure, readable risk settings, validation, Escape and focus return.
- Intermediate-width position drawer containment and visible incomplete-protection warnings; mobile positions remain one action away.
- Journal six-card summary, Clear filters, filtered-empty and incomplete-record messages, mobile expanded records and missing numeric values.
- Catalyst results-first layout, readable source confidence and details, full-report/analysis access, and short inventory using page scrolling.
- Scanner desktop 640px panel and mobile controls, three columns, sorting, exact settings precision, visible Approximate ranking, Escape from the trigger and focus return. The read-only data observed was September 15 with 106 results; no EOD refresh or formula change was made.

Source identifiers evolved during corrections; the delivery message records the final commit and exact served identifier. Native monitor/DPI evidence is not inferred from emulation.

### Changed surfaces

Presentation components and styles for Trading, Journal, Catalyst and Scanner; new `WorkspacePresentation.tsx`; focused browser/static tests and browser-suite inclusion. No backend service, API, authentication, execution or calculation files changed. Submission locks remain enabled in the local preview.

## Limits

Browser fixtures simulate paper connection, order reviews, callbacks and failure states. They do not establish broker execution success. No broker orders are part of this UI work. Authenticated TWS pilot, account/session conflict resolution, exact-ticket approval and larger paper-trading sequences remain separate gates. Native monitor/DPI transitions, physical touch devices and non-Chromium browsers require their own checks.
