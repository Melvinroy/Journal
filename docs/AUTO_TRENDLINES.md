# E6 — Auto Trendlines v1

## Design recorded before implementation

This is chart assistance, not a validated trading strategy or a probability of success. No alerts, orders or backtests are attached to these lines.

The calculation uses chronologically ordered, completed daily bars through the selected as-of date, on the explicitly selected raw/adjusted basis. It examines the most recent 120 sessions. Chart range, pixel size and zoom do not enter the calculation. Wilder ATR14 is seeded with the first 14 true ranges (first true range is high minus low), then warmed with all available preceding bars. Missing warmup produces no pivots.

A pivot needs three sessions on each side. High pivots exceed the previous three highs and equal or exceed the following three; lows use the inverse rule. This chooses the first equal extreme in a local plateau. A pivot is available only after its third following session closes. Bounded prominence is the smaller excursion from the extreme to the lowest low (high pivot), or highest high (low pivot), on either three-session wing, and must reach 0.75 pivot-day ATR. This deliberately defines a bounded local measure, not global topographic prominence.

Construct lines through same-kind confirmed pivots at least six sessions apart. Touches must be confirmed pivots within 0.35 pivot-day ATR of the line, at least three sessions apart; require three touches. Reject a line with three consecutive closes beyond its support/resistance side by more than 0.35 session ATR, a latest touch older than 30 sessions, or a latest projection more than five ATR from the latest close. Count individual violating closes even when the rejection threshold is not reached.

Rank deterministically by descending touch count, ascending violating closes, descending latest-touch session, ascending mean touch error in ATR, then anchor sessions. Display at most one support and one resistance line, avoiding a cluttered chart. There is no confidence percentage. The line is only available when all its supporting confirmed pivots are available; historical anchors must never be interpreted as earlier signals.

Line metadata records the evaluation session, not an inferred historical entry signal. Ranking, current distance and break checks use information through that session; an earlier pivot anchor or confirmation date must not be treated as the date the final ranked result was known.

Linear scale fits price per trading session; logarithmic scale fits log-price per trading session, while tolerances and errors remain in price ATR. Switching scale deliberately recalculates a different model and keeps its edits separate. KLineCharts rays draw straight lines in the selected coordinate system.

## Ownership and persistence

Generated lines start unlocked and selectable. Moving one stores a user-owned override; its algorithm measurements are no longer presented as measurements of the edited geometry. Edited lines use dashes and remain saved even when the original generated candidate falls out of the ranking. Keep edited anchors in chronological order within loaded sessions and above zero; invalid moves are rolled back with a message. Deleting with the selected-drawing button or right-click stores a tombstone so that candidate does not return on reload. New candidates with different anchors may still appear after new data arrives. Toggle hides/shows without erasing edits. Reset explicitly removes overrides and deletions for the current instrument, mode, adjustment, scale and as-of context. Manual drawings remain in their existing store. Saved records are versioned, validated, and protected against failed reads and concurrent writes by the existing browser-storage abstraction. Edits are local to this browser, not cloud-synced.

Auto overlays use trading-session indices derived from the complete loaded series, including negative positions when an anchor precedes the displayed range. This avoids the renderer's calendar-day extrapolation for off-screen timestamps. Saved edits retain timestamps and are projected again on range changes. The calculation has no dependency on the visible range. Pivot centers are restricted to the last 120 sessions; their three-session left wing may use preceding loaded history.

## Research basis

- [SciPy peak detection](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html) documents local extrema and plateau handling. Our implementation is original TypeScript with the bounded rules above.
- [SciPy peak prominence](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.peak_prominences.html) distinguishes local window prominence from global prominence; we use a simpler, explicitly specified ATR-normalized wing excursion.
- [KLineCharts overlay creation](https://klinecharts.com/en-US/api/instance/createOverlay) provides public overlay IDs, groups and locking; [overlay removal](https://klinecharts.com/en-US/api/instance/removeOverlay) supports independent ownership groups.

## Validation requirements

Test confirmed-pivot delay, future-bar exclusion, deterministic ranking, ATR warmup, breaks, short/invalid input, both scale models and saved-record validation. Build both public and local frontends, run existing JS/backend suites, and inspect the browser interaction. Real-DuckDB E6 validation and a Windows/mobile check must be reported separately when unavailable here. Existing E2–E5 Windows validation does not establish E6 behavior.
