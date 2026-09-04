# Brontide chart design QA

- Source visual truth: `/workspace/scratch/84eca3f58433/upload/IMG_D928B69B-1C3A-4415-9563-9E281EEE751C.jpeg`.
- Implementation screenshot: browser-rendered production capture from `https://melvinroy.github.io/Journal/?demo=1` in this QA run.
- Viewport: 1,363 × 936 CSS pixels at device scale factor 1.
- Source pixels: 1,536 × 1,152, including photographed monitor and browser chrome.
- Implementation pixels: 1,363 × 936.
- Normalization: compared the chart application region at its natural desktop scale; ignored the source photograph's monitor bezel and browser chrome.
- State: NVDA sample history, 6M daily range, light theme, linear scale, 20/50/200 moving averages enabled.

## Full-view comparison evidence

The final production view preserves the reference's compact two-row command structure, narrow drawing rail, dominant white plot, low-contrast grid, right price scale, green/red candles, moving-average overlays, and separate volume pane. The implementation intentionally omits the reference's base rectangles because the user requested removal. Controls stay outside the plotting and volume regions.

## Focused-region comparison evidence

- Header and toolbar: stock identity remains prominent, while secondary actions use compact controls with consistent height and spacing.
- Plot header: OHLC and moving-average values now occupy two clean lines; native indicator tooltips are disabled so they cannot collide.
- Volume pane: no floating zoom, navigation, or base controls cover the bars or axis.
- Theme treatment: light and dark modes use matched semantic tokens for panels, borders, text, axes, grids, crosshairs, candles, volume, and popovers.
- No separate image asset fidelity issue applies; the reference and implementation are data-chart interfaces rather than image-led screens.

## Findings and comparison history

1. P1 — floating viewport controls overlapped the volume pane.
   - Fix: moved zoom out, zoom in, backward, and latest controls into the secondary toolbar.
   - Post-fix evidence: the entire volume pane is unobstructed in the final production capture.
2. P1 — base annotations competed with candles and created visual noise.
   - Fix: removed the base toggle, rectangles, pivot label, and footer selector.
   - Post-fix evidence: the chart now presents only price, moving averages, crosshair state, and volume.
3. P2 — duplicate chart chrome and nonfunctional save/share actions reduced trust.
   - Fix: simplified the header to sample-data status, Analyze setup, and theme controls; renamed the supported price-channel tool accurately.
4. P2 — native MA tooltip content collided with the custom OHLC/legend layer.
   - Fix: consolidated moving averages into one indicator and disabled native indicator tooltips globally.
   - Post-fix evidence: the final capture has one OHLC row, one MA legend row, and visible dashed average lines with no collision.
5. P2 — previous theme styling was hard-coded and dark-only.
   - Fix: added semantic light/dark tokens, a labeled toggle, and persisted preference in local storage. Both modes were browser-tested.

## Primary interactions tested

- Open Charts from the main workspace.
- Switch light to dark and reload; the saved preference persists.
- Zoom in and move to latest from the toolbar.
- Stock selector, range controls, indicator menu, linear/log controls, drawing tools, and clear-drawings control remain exposed with accessible names.
- Production build and GitHub Pages workflows 51–54 completed successfully.

## Accessibility and responsive checks

- Visible keyboard focus rings were added to buttons, summaries, and selects.
- Toolbar buttons have accessible labels; the theme toggle communicates the destination and pressed state.
- At the mobile breakpoint, the header uses three bounded columns, Analyze setup is removed from the constrained row, toolbars scroll rather than overlap, viewport controls remain in the toolbar, the chart receives a dedicated bottom-navigation row, and the footer is removed.
- The cloud browser has a fixed desktop viewport, so the mobile breakpoint was code-reviewed but not captured on a physical iPhone-sized browser. This is a P3 device-verification gap, not a known layout defect.

## Remaining findings

No actionable P0, P1, or P2 finding remains in the browser-rendered desktop production state. The remaining follow-up is physical-device verification at common phone widths.

final result: passed
