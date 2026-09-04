# Brontide chart design QA

- Source visual truth: `/workspace/scratch/84eca3f58433/upload/IMG_533B02CE-2174-4010-B8B0-1F4DB9170963.jpeg` for layout and `/workspace/scratch/84eca3f58433/upload/IMG_E031AD2B-C394-4441-95EB-7EF1E062C8E8.jpeg` for the manually drawn trend-line intent.
- Implementation: browser-rendered local production export at the same application viewport.
- Viewport: 1,363 × 936 CSS pixels at device scale factor 1.
- Source pixels: 1,536 × 1,152, including photographed monitor and browser chrome.
- Normalization: compared the chart application region at its natural desktop scale and ignored the source photograph's monitor bezel and browser chrome.
- State: NVDA sample history, 6M daily range, light and dark themes, linear scale, 20/50/200 moving averages enabled, Auto Trend enabled.

## Full-view comparison evidence

The price history now starts at the left edge of the usable plot and fills approximately 80% of its width. The remaining approximately 20% is clean forward space on the right, matching the requested default composition. Candles, moving averages, axes, volume, header values, and navigation controls remain legible without overlap.

The drawing rail stays narrow and quiet in its resting state. Thirty drawing and measurement tools are organized into six families, plus cursor and clear controls, instead of being displayed as one long undifferentiated toolbar.

Auto Trend adds one recent resistance and one recent support ray without moving or covering the chart controls. The header toggle sits immediately left of the sample-data status, and a compact legend reports line type, touch count and confidence. The detected lines preserve the manually drawn source's thin analytical treatment while using red/green semantic separation.

## Focused-region comparison evidence

- Viewport: bar spacing is derived from the current chart width and selected range; right offset is derived as 20% of that width. A resize observer reapplies the fit when the chart container changes size.
- Drawing tools: grouped flyouts expose trend, level, channel, Fibonacci, annotation, position, and measurement tools. Each item has a recognizable Phosphor icon and accessible name.
- Tool interaction: selecting a tool closes the flyout, preserves its active family state, and initiates the corresponding KLineChart overlay.
- Light/dark treatment: flyouts, active states, borders, shadows, and icons use the chart theme tokens in both modes.
- Volume and viewport controls: the drawing rail, flyouts, zoom controls, and volume pane occupy separate layout regions.
- Auto Trend: confirmed recent pivot highs/lows are paired and ranked by ATR-adjusted touches, integrity, recency, length and relevance; three completed closes invalidate a broken line.

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
6. P1 — automatic overlays disappeared after changing the chart theme because chart re-initialization raced the overlay effect.
   - Fix: chart readiness is reset before every asynchronous re-initialization; overlays are recreated only after the new chart instance is ready.
   - Post-fix evidence: resistance and support rays remain visible in both light and dark themes.

## Primary interactions tested

- Open Charts from the main workspace.
- Switch between light and dark themes.
- Open Trend and Level tool families.
- Select Trend line; confirm the menu closes and the active family remains indicated.
- Confirm grouped menus expose their item counts and accessible menu-item names.
- Confirm the 6M default history fills the left 80% of the chart with forward space on the right.
- Enable Auto Trend; confirm the button exposes pressed state and the chart shows scored support and resistance rays.
- Change theme while Auto Trend remains active; confirm both overlays are reconstructed in the new chart instance.
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
