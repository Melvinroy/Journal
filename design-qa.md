# Brontide chart design QA

- Source visual truth: `/workspace/scratch/84eca3f58433/upload/IMG_533B02CE-2174-4010-B8B0-1F4DB9170963.jpeg`.
- Implementation: browser-rendered production capture from `https://melvinroy.github.io/Journal/?demo=1`.
- Viewport: 1,363 × 936 CSS pixels at device scale factor 1.
- Source pixels: 1,536 × 1,152, including photographed monitor and browser chrome.
- Normalization: compared the chart application region at its natural desktop scale and ignored the source photograph's monitor bezel and browser chrome.
- State: NVDA sample history, 6M daily range, light and dark themes, linear scale, 20/50/200 moving averages enabled.

## Full-view comparison evidence

The price history now starts at the left edge of the usable plot and fills approximately 80% of its width. The remaining approximately 20% is clean forward space on the right, matching the requested default composition. Candles, moving averages, axes, volume, header values, and navigation controls remain legible without overlap.

The drawing rail stays narrow and quiet in its resting state. Thirty drawing and measurement tools are organized into six families, plus cursor and clear controls, instead of being displayed as one long undifferentiated toolbar.

## Focused-region comparison evidence

- Viewport: bar spacing is derived from the current chart width and selected range; right offset is derived as 20% of that width. A resize observer reapplies the fit when the chart container changes size.
- Drawing tools: grouped flyouts expose trend, level, channel, Fibonacci, annotation, position, and measurement tools. Each item has a recognizable Phosphor icon and accessible name.
- Tool interaction: selecting a tool closes the flyout, preserves its active family state, and initiates the corresponding KLineChart overlay.
- Light/dark treatment: flyouts, active states, borders, shadows, and icons use the chart theme tokens in both modes.
- Volume and viewport controls: the drawing rail, flyouts, zoom controls, and volume pane occupy separate layout regions.

## Findings and comparison history

1. P1 — visible history occupied only part of the plot and was biased toward the right.
   - Fix: calculated default bar spacing from the usable canvas width and placed the final candle near the 80% mark.
   - Post-fix evidence: the first visible candle begins next to the drawing rail and the last candle leaves approximately 20% forward space.
2. P2 — the original flat drawing rail exposed too few tools and did not communicate families.
   - Fix: added 30 drawing and measurement entries in six grouped flyouts, while keeping only eight compact rail controls visible at rest.
3. P2 — text/glyph tool marks looked inconsistent.
   - Fix: replaced them with the open-source MIT-licensed Phosphor icon set.
4. P1 — the chart canvas could paint above a light-theme flyout despite the menu being present in the accessibility tree.
   - Fix: made the rail an explicit positioned stacking context above the canvas and raised the open group within it.
5. P2 — controls previously competed with the plot and volume pane.
   - Fix: viewport controls remain in the secondary command bar and drawing tools remain in the dedicated left rail.

## Primary interactions tested

- Open Charts from the main workspace.
- Switch between light and dark themes.
- Open Trend and Level tool families.
- Select Trend line; confirm the menu closes and the active family remains indicated.
- Confirm grouped menus expose their item counts and accessible menu-item names.
- Confirm the 6M default history fills the left 80% of the chart with forward space on the right.
- Production build completed successfully.

## Accessibility and responsive checks

- All rail triggers and menu entries have accessible names and native button semantics.
- Group triggers expose expanded state; flyout entries use menu-item roles.
- Focus rings remain visible in both themes.
- Below the mobile breakpoint, flyouts use a single column and are bounded to the available viewport width.
- The cloud browser has a fixed desktop viewport, so a physical-device capture remains a P3 verification gap, not a known defect.

## Remaining findings

No actionable P0, P1, or P2 finding remains after the final production verification. Exact advanced-tool semantics are bounded by KLineChart's native overlay primitives; the visible tool catalog uses the closest supported primitive where KLineChart does not provide a dedicated overlay.

final result: passed
