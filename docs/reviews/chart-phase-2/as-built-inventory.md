# Phase 2A — as-built inventory and reconciliation

Status: Gate 2A review artifact. No toolbar removal or storage migration has been performed.

Baseline inspected:

- default branch: `origin/main` at `fd6e934c2085d4a1639246f2bbbd29c3525585ac`;
- Phase 2 branch: `codex/chart-phase-2-drawings` at `c518a8d1379d11d34f791737c3ec1e54f7ffe49d`;
- draft pull request: [#2](https://github.com/Melvinroy/Journal/pull/2).

“Wired” below means the control resolves to a registered KLineChart overlay and enters the shared save path. It does not mean the revised tool-by-tool lifecycle gate has passed. “Partially verified” records only the checks retained from the earlier Phase 2 review packet.

## Default branch and PR #2 summary

`main` presents Cursor, six drawing groups, and a destructive Clear control. It exposes 20 drawing tools plus Cursor. Drawings are created through KLineChart, saved manually as a version-1 array, and restored per source, symbol, daily interval, and adjustment basis. It also exposes Auto Trendline and Recent Trend (Original) in the top bar.

PR #2 retains that six-group information architecture and adds five tools, a five-button favourites strip, contextual editing, a Boolean snap toggle, undo/redo, and an Objects popover. The result is 26 accessible entries: Cursor plus 25 creation tools. Favourites duplicate tools as permanent rail buttons, so the rail can show Cursor, five favourites, six groups, and four utilities. This does not meet the replacement specification's eight fixed groups and four utilities.

## Complete as-built tool inventory

All creation tools are declared inline in `app/ChartDashboard.tsx`. KLineChart built-ins are supplied by `klinecharts`; Brontide templates are registered from `lib/chart-overlays.ts`. Completed drawings all flow through `useDrawingController` and `useDrawingWorkspace` to the version-1 symbol-scoped drawing key.

| Current ID | Current label | Icon | Current group/location | Renderer / implementation | Persistence | Functional evidence |
|---|---|---|---|---|---|---|
| `cursor` | Cursor | `Cursor` | Permanent rail control | Chart navigation state; no overlay | Active state only; not persisted | Wired; returns from completed/cancelled drawings |
| `trend` | Extended line | `TrendUp` | Trend tools | KLineChart `straightLine` | Drawing v1 | Wired; revised lifecycle unverified |
| `ray` | Ray | `ArrowUpRight` | Trend tools | KLineChart `rayLine` | Drawing v1 | Partially verified: create and strong snap |
| `segment` | Line segment | `LineSegment` | Trend tools; default favourite duplicate | KLineChart `segment` | Drawing v1; favourite v1 | Partially verified: create and persistence |
| `arrow` | Arrow | `Path` | Trend tools | Brontide `brontide-arrow` in `extraOverlays` | Drawing v1 | Wired; revised lifecycle unverified |
| `horizontal` | Horizontal line | `Minus` | Level tools | KLineChart `horizontalStraightLine` | Drawing v1 | Wired; revised lifecycle unverified |
| `horizontalRay` | Horizontal ray | `ArrowUpRight` | Level tools; default favourite duplicate | KLineChart `horizontalRayLine` | Drawing v1; favourite v1 | Wired; favourite persistence checked; lifecycle incomplete |
| `horizontalSegment` | Horizontal segment | `LineSegment` | Level tools | KLineChart `horizontalSegment` | Drawing v1 | Wired; revised lifecycle unverified; not approved inventory |
| `vertical` | Vertical line | `ArrowsVertical` | Level tools | KLineChart `verticalStraightLine` | Drawing v1 | Wired; revised lifecycle unverified |
| `verticalRay` | Vertical ray | `ArrowsVertical` | Level tools | KLineChart `verticalRayLine` | Drawing v1 | Wired; revised lifecycle unverified; not approved inventory |
| `verticalSegment` | Vertical segment | `Rows` | Level tools | KLineChart `verticalSegment` | Drawing v1 | Wired; revised lifecycle unverified; not approved inventory |
| `priceLine` | Price line | `Crosshair` | Level tools | KLineChart `priceLine`; one anchor, right-extending line and price text | Drawing v1 | Wired; revised lifecycle unverified; not equivalent to approved Info Line |
| `parallelChannel` | Parallel channel | `Rows` | Channel tools; default favourite duplicate | KLineChart `parallelStraightLine` | Drawing v1; favourite v1 | Wired; revised lifecycle unverified |
| `priceChannel` | Price channel | `Rectangle` | Channel tools | KLineChart `priceChannelLine`; three-anchor parallel geometry | Drawing v1 | Wired; candidate basis for Flat Top/Bottom Channel, subject to geometry verification |
| `box` | Rectangle | `Rectangle` | Channel tools; default favourite duplicate | Brontide `brontide-box` in `extraOverlays` | Drawing v1; favourite v1 | Partially verified: create and Escape cancellation |
| `ellipse` | Ellipse | `WaveSine` | Channel tools | Brontide `brontide-ellipse` in `extraOverlays` | Drawing v1 | Wired; can migrate to approved Circle alias; lifecycle unverified |
| `regressionChannel` | Regression channel | `ChartLine` | Channel tools | Brontide `brontide-regression` in `workflowOverlays`; calculation in `drawing-workspace` | Drawing v1 | Partially verified: create, exact anchors, calculation, Lin/Log rendering, refresh |
| `fibRetracement` | Fib retracement | `Function` | Fibonacci tools | KLineChart `fibonacciLine` | Drawing v1 | Wired; revised lifecycle unverified |
| `brush` | Brush | `PencilSimple` | Annotation tools | KLineChart `brush` | Drawing v1 | Wired; revised lifecycle unverified |
| `priceLabel` | Price label | `Tag` | Annotation tools | KLineChart `simpleTag`; horizontal price tag | Drawing v1 | Wired; revised lifecycle unverified |
| `textNote` | Text note | `TextT` | Annotation tools | KLineChart `simpleAnnotation`; note text in `extendData` | Drawing v1 | Partially verified: create, text edit, undo/redo, refresh |
| `anchoredVWAP` | Anchored VWAP | `ChartLineUp` | Annotation tools | Brontide `brontide-vwap`; HLC3/volume calculation in `drawing-workspace` | Drawing v1 | Partially verified: create, exact anchor, fixed VWAP, missing volume, range independence |
| `rangeMeasure` | Price / percentage range | `Ruler` | Position and measure; default favourite duplicate | Brontide `brontide-measure` in `extraOverlays` | Drawing v1; favourite v1 | Partially verified: price/percentage calculation and unavailable state; full lifecycle unverified |
| `longPosition` | Long position risk/reward | `Strategy` | Position and measure | Brontide `brontide-position`; calculation in `drawing-workspace` | Drawing v1 | Partially verified: create, exact anchors, 2R fixture, edit, refresh; no planner handoff from object |
| `dateMeasure` | Date / session range | `CalendarDots` | Position and measure | Brontide `brontide-date`; calculation in `drawing-workspace` | Drawing v1 | Partially verified: create, exact dates, session/calendar fixture, invalid date |
| `contraction` | Manual contractions | `ChartLineDown` | Position and measure | Brontide `brontide-contraction`; fixed six-anchor calculation in `drawing-workspace` | Drawing v1 | Partially verified: three pairs, depth fixture, drag, undo; does not support 2–5 pairs or setup metadata |

## Utilities, editing, and automated controls

| Control / state | As-built implementation | Finding against replacement plan |
|---|---|---|
| Favourites | Five global IDs in `brontide-drawing-favorites-v1`; each renders as a second permanent rail button | Persistence works, but duplication and five-item cap violate Sections 5–6 |
| Recent / last used | No persisted group last-used state | Missing |
| Keep Drawing | Completion always invokes `onFinish` and returns to Cursor | Missing |
| Snap | Boolean `brontide-drawing-snap-v1`; maps Off to `normal`, On to `strong_magnet` | Weak default, three-state cycle, Alt bypass, and move/resize matrix are missing |
| Contextual editing | Top-row `DrawingEditor`: colour, width, solid/dashed, lock, visibility, exact anchors, annotation text, delete | Not floating near object; dotted, duplicate, More Settings, tool-specific properties, and complete history coverage are missing |
| Objects | Temporary popover with numbered labels, visibility, lock, delete, and clear unlocked | Correct temporary surface; naming, rename, duplicate, reorder, multi-select, bulk visibility/lock, filter, confirmation, collapsible groups, and Indicators group are missing |
| Undo/redo | Whole-array snapshots in memory, 50 actions per context | Create/edit/lock/hide/delete are covered by the common store; 100 limit and explicit move/resize/style/name/duplicate/reorder matrix remain missing |
| Keyboard | Escape, Delete, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | First/second Escape distinction and locked-object inspection behaviour need verification |
| Auto Trendline | Top-bar `Auto` menu, editable generated rays, persisted under `brontide-auto:*` | Unvalidated Phase 3+ automation is visibly presented and must be hidden while state is preserved |
| Recent Trend (Original) | Second control in `Auto`, persisted under `brontide-recent-v1:*` | Unvalidated automation is visibly presented and must be hidden while state is preserved |

## Duplicate, icon, and orphan audit

### IDs and registrations

- No duplicate creation-tool ID exists inside the current `drawingTools` array.
- The group ID `trend` and tool ID `trend` collide because groups and tools do not have separate typed namespaces.
- No custom overlay template is registered twice: `extraOverlays` and `workflowOverlays` contain unique names. KLineChart supplies the built-in overlay names.
- Favourites are duplicate render paths for the same canonical tool, not duplicate renderer registrations.
- Saved drawings store a renderer `name`, not a canonical tool ID. This makes aliases and future renderer changes ambiguous.

### Shared icons that fail semantic differentiation

| Shared icon | Current functions |
|---|---|
| `ArrowUpRight` | Ray; Horizontal ray |
| `LineSegment` | Line segment; Horizontal segment |
| `ArrowsVertical` | Vertical line; Vertical ray |
| `Rows` | Vertical segment; Parallel channel; Channels group |
| `Rectangle` | Price channel; Rectangle |
| `TrendUp` | Extended line; Trend tools group |
| `Function` | Fib retracement; Fibonacci group |
| `PencilSimple` | Brush; Annotation tools group |
| `Ruler` | Price/percentage range; Position and measure group |

The icons come from the project's Phosphor library, but reuse makes distinct functions visually ambiguous. A canonical registry must assign a unique icon component or a clearly modified library icon to every different function.

### Declared but inaccessible tool IDs

The `DrawingTool` union contains ten IDs with no registry entry or control: `extended`, `pitchfork`, `fibExtension`, `fibChannel`, `fibTime`, `callout`, `flag`, `shortPosition`, `dateMarker`, and `crosshairMeasure`. The first, `extended`, also overlaps conceptually with the accessible `trend` ID. These declarations are orphaned and should be removed only after canonical aliases and saved-preference migration are covered by tests.

Unused icon imports (`ArrowsOutLineHorizontal`, `Flag`, `NotePencil`, and `Selection`) reflect planned or abandoned controls rather than accessible tools.

## Approved inventory reconciliation

| Approved group | Approved tool / canonical ID proposed | As-built source | Reconciliation |
|---|---|---|---|
| Cursor | Select/Crosshair / `select` | `cursor` | Alias and migrate preference/state; keep navigation behaviour |
| Cursor | Eraser / `eraser` | None | Implement |
| Lines | Trend Line / `trendLine` | `segment` | Reuse renderer; rename canonical ID and label |
| Lines | Ray / `ray` | `ray` | Reuse |
| Lines | Extended Line / `extendedLine` | `trend` | Reuse renderer; migrate ID |
| Lines | Horizontal Line / `horizontalLine` | `horizontal` | Reuse; migrate ID |
| Lines | Horizontal Ray / `horizontalRay` | `horizontalRay` | Reuse |
| Lines | Vertical Line / `verticalLine` | `vertical` | Reuse; migrate ID |
| Lines | Info Line / `infoLine` | None | Implement; current Price Line lacks the required measurement information |
| Channels | Parallel Channel / `parallelChannel` | `parallelChannel` | Reuse |
| Channels | Regression Channel / `regressionChannel` | `regressionChannel` | Extend existing implementation |
| Channels | Flat Top/Bottom Channel / `flatChannel` | `priceChannel` candidate | Verify geometry; reuse only if it satisfies flat-boundary behaviour, otherwise implement |
| Fibonacci | Fibonacci Retracement / `fibRetracement` | `fibRetracement` | Reuse |
| Fibonacci | Trend-Based Fibonacci Extension / `fibExtension` | Orphan ID only | Implement and activate canonical ID |
| Measure & Trade | Price Range / `priceRange` | `rangeMeasure` | Reuse calculation/renderer; migrate ID |
| Measure & Trade | Date Range / `dateRange` | `dateMeasure` | Reuse and extend properties; migrate ID |
| Measure & Trade | Date & Price Range / `datePriceRange` | None | Implement |
| Measure & Trade | Long Risk/Reward / `longRiskReward` | `longPosition` | Extend existing object and migrate ID |
| Measure & Trade | Anchored VWAP / `anchoredVwap` | `anchoredVWAP` | Extend existing object and normalize ID |
| Patterns & Setups | Manual Contraction/VCP Markup / `manualContraction` | `contraction` | Extend from fixed three pairs to 2–5 pairs and setup metadata; migrate ID |
| Shapes | Rectangle / `rectangle` | `box` | Reuse; migrate ID and group |
| Shapes | Circle / `circle` | `ellipse` | Reuse ellipse renderer as resizable Circle tool; migrate ID and group |
| Shapes | Brush / `brush` | `brush` | Reuse; move group |
| Shapes | Highlighter / `highlighter` | None | Implement |
| Shapes | Arrow / `arrow` | `arrow` | Reuse; move group |
| Annotations | Text / `text` | None | Implement |
| Annotations | Note / `note` | `textNote` | Reuse annotation basis; migrate ID |
| Annotations | Price Note/Label / `priceNote` | `priceLabel` | Extend to meaningful label content; migrate ID |
| Annotations | Callout / `callout` | Orphan ID only | Implement and activate canonical ID |

The approved inventory contains 29 tools across eight fixed groups. Nineteen have reusable as-built implementations or a viable implementation basis; ten require a new tool or material extension. Every reused tool still needs the full lifecycle matrix in Gate 2C/2D.

## Working tools outside the approved inventory

Four accessible KLineChart tools are useful but have no approved owner: Horizontal Segment, Vertical Ray, Vertical Segment, and the current one-anchor Price Line. Price Channel is separately treated as a candidate implementation basis for Flat Top/Bottom Channel.

Recommended disposition:

1. Remove the four unapproved tools from creation flyouts after migration tests pass.
2. Preserve all saved instances in the shared overlay store and Objects panel under a compact `Legacy drawings` group.
3. Keep them selectable, editable, duplicable, and deletable, but do not allow new creation from the canonical rail.
4. Do not silently rename Price Line to Info Line; implement Info Line with its specified measurements.
5. Reuse Price Channel for Flat Top/Bottom Channel only after its geometry passes a fixed interaction fixture.

This disposition needs owner approval before the creation controls are removed.

## Proposed non-destructive state migration

1. Add a version-2 overlay envelope keyed by source, symbol, and adjustment, without a hard-coded daily interval. Each record carries `schemaVersion`, stable ID, canonical `toolId`, renderer type, `source: "manual"`, timestamp/price anchors, style, properties, visibility, lock, order, and default daily/weekly timeframe scope. Future automation fields remain optional.
2. On first load, read the existing `brontide-drawings-v1:<mode>:<symbol>:1Day:<adjustment>` record, map known renderer names and legacy IDs to canonical tool IDs, and write the v2 record only after validation succeeds.
3. Leave the v1 record untouched for rollback. Unknown renderer names are preserved as legacy manual overlays rather than discarded.
4. Migrate favourites from `brontide-drawing-favorites-v1` through an explicit alias table. Store favourites, group last-used tools, recent tools, Keep Drawing, and the three-state snap preference in a global versioned preferences record.
5. Translate the Boolean snap value deterministically: saved `false` becomes Off; saved `true` becomes Strong. New users default to Weak.
6. Preserve `brontide-auto:*` and `brontide-recent-v1:*` data unchanged. Hide their controls and overlays in Phase 2; do not delete or rewrite the saved state.
7. Add fixture tests for migration idempotence, unknown-tool retention, ID uniqueness, preference aliases, raw/adjusted separation, daily/weekly sharing, and explicit write failure before switching the application to v2 writes.

## Gate 2A decision

No working implementation has been deleted, no storage key has been migrated, and no Auto state has been changed. Approval of this reconciliation authorizes Gate 2B to:

- implement the canonical registry and eight fixed groups;
- remove duplicate favourite rail buttons while retaining favourites inside groups;
- hide the two incomplete Auto controls while preserving their stored state;
- apply the proposed aliases and non-destructive v1-to-v2 migration; and
- archive the four unapproved creation tools as preserved legacy drawings.

It does not authorize merging PR #2 or starting Phase 3.
