export const DRAWING_GROUP_IDS = [
  "cursor", "lines", "channels", "fibonacci", "measureTrade", "patternsSetups", "shapes", "annotations",
] as const;

export type DrawingGroupId = typeof DRAWING_GROUP_IDS[number];
export type DrawingToolId =
  | "select" | "eraser"
  | "trendLine" | "ray" | "extendedLine" | "horizontalLine" | "horizontalRay" | "verticalLine" | "infoLine"
  | "parallelChannel" | "regressionChannel" | "flatChannel"
  | "fibRetracement" | "fibExtension"
  | "priceRange" | "dateRange" | "datePriceRange" | "longRiskReward" | "anchoredVwap"
  | "manualContraction"
  | "rectangle" | "circle" | "brush" | "highlighter" | "arrow"
  | "text" | "note" | "priceNote" | "callout";

export type DrawingIconKey =
  | "Cursor" | "Eraser" | "LineSegment" | "ArrowUpRight" | "ArrowsOutLineHorizontal" | "Minus" | "ArrowLineRight" | "ArrowsVertical" | "Info"
  | "Parallelogram" | "ChartLine" | "AlignTop" | "Function" | "MathOperations" | "Ruler" | "CalendarDots" | "CalendarBlank"
  | "Strategy" | "ChartLineUp" | "ChartLineDown" | "Rectangle" | "Circle" | "PaintBrush" | "HighlighterCircle" | "Path"
  | "TextT" | "NotePencil" | "Tag" | "ChatCenteredDots";

export type DrawingToolDefinition = {
  id: DrawingToolId;
  label: string;
  groupId: DrawingGroupId;
  icon: DrawingIconKey;
  overlay?: string;
  shortcut?: string;
  legacyIds?: readonly string[];
};

export type DrawingGroupDefinition = {
  id: DrawingGroupId;
  label: string;
  defaultTool: DrawingToolId;
};

export const DRAWING_GROUPS: readonly DrawingGroupDefinition[] = [
  { id: "cursor", label: "Cursor", defaultTool: "select" },
  { id: "lines", label: "Lines", defaultTool: "trendLine" },
  { id: "channels", label: "Channels", defaultTool: "parallelChannel" },
  { id: "fibonacci", label: "Fibonacci", defaultTool: "fibRetracement" },
  { id: "measureTrade", label: "Measure & Trade", defaultTool: "priceRange" },
  { id: "patternsSetups", label: "Patterns & Setups", defaultTool: "manualContraction" },
  { id: "shapes", label: "Shapes", defaultTool: "rectangle" },
  { id: "annotations", label: "Annotations", defaultTool: "note" },
] as const;

// One registry owns canonical IDs, labels, icons, groups, aliases, and renderers.
// Tools without an overlay remain in the approved architecture but are not exposed
// as creation controls until their implementations land in Gate 2D.
export const DRAWING_TOOLS: readonly DrawingToolDefinition[] = [
  { id: "select", label: "Select/Crosshair", groupId: "cursor", icon: "Cursor", shortcut: "Esc", legacyIds: ["cursor"] },
  { id: "eraser", label: "Eraser", groupId: "cursor", icon: "Eraser", overlay: "__eraser__" },
  { id: "trendLine", label: "Trend Line", groupId: "lines", icon: "LineSegment", overlay: "segment", legacyIds: ["segment"] },
  { id: "ray", label: "Ray", groupId: "lines", icon: "ArrowUpRight", overlay: "rayLine" },
  { id: "extendedLine", label: "Extended Line", groupId: "lines", icon: "ArrowsOutLineHorizontal", overlay: "straightLine", legacyIds: ["trend", "extended"] },
  { id: "horizontalLine", label: "Horizontal Line", groupId: "lines", icon: "Minus", overlay: "horizontalStraightLine", legacyIds: ["horizontal"] },
  { id: "horizontalRay", label: "Horizontal Ray", groupId: "lines", icon: "ArrowLineRight", overlay: "horizontalRayLine" },
  { id: "verticalLine", label: "Vertical Line", groupId: "lines", icon: "ArrowsVertical", overlay: "verticalStraightLine", legacyIds: ["vertical"] },
  { id: "infoLine", label: "Info Line", groupId: "lines", icon: "Info", overlay: "brontide-info" },
  { id: "parallelChannel", label: "Parallel Channel", groupId: "channels", icon: "Parallelogram", overlay: "parallelStraightLine" },
  { id: "regressionChannel", label: "Regression Channel", groupId: "channels", icon: "ChartLine", overlay: "brontide-regression" },
  { id: "flatChannel", label: "Flat Top/Bottom Channel", groupId: "channels", icon: "AlignTop", overlay: "brontide-flat-channel" },
  { id: "fibRetracement", label: "Fibonacci Retracement", groupId: "fibonacci", icon: "Function", overlay: "fibonacciLine" },
  { id: "fibExtension", label: "Trend-Based Fibonacci Extension", groupId: "fibonacci", icon: "MathOperations", overlay: "brontide-fib-extension" },
  { id: "priceRange", label: "Price Range", groupId: "measureTrade", icon: "Ruler", overlay: "brontide-measure", legacyIds: ["rangeMeasure"] },
  { id: "dateRange", label: "Date Range", groupId: "measureTrade", icon: "CalendarDots", overlay: "brontide-date", legacyIds: ["dateMeasure"] },
  { id: "datePriceRange", label: "Date & Price Range", groupId: "measureTrade", icon: "CalendarBlank", overlay: "brontide-date-price" },
  { id: "longRiskReward", label: "Long Risk/Reward", groupId: "measureTrade", icon: "Strategy", overlay: "brontide-position", legacyIds: ["longPosition"] },
  { id: "anchoredVwap", label: "Anchored VWAP", groupId: "measureTrade", icon: "ChartLineUp", overlay: "brontide-vwap", legacyIds: ["anchoredVWAP"] },
  { id: "manualContraction", label: "Manual Contraction/VCP Markup", groupId: "patternsSetups", icon: "ChartLineDown", overlay: "brontide-contraction", legacyIds: ["contraction"] },
  { id: "rectangle", label: "Rectangle", groupId: "shapes", icon: "Rectangle", overlay: "brontide-box", legacyIds: ["box"] },
  { id: "circle", label: "Circle", groupId: "shapes", icon: "Circle", overlay: "brontide-ellipse", legacyIds: ["ellipse"] },
  { id: "brush", label: "Brush", groupId: "shapes", icon: "PaintBrush", overlay: "brush" },
  { id: "highlighter", label: "Highlighter", groupId: "shapes", icon: "HighlighterCircle", overlay: "brontide-highlighter" },
  { id: "arrow", label: "Arrow", groupId: "shapes", icon: "Path", overlay: "brontide-arrow" },
  { id: "text", label: "Text", groupId: "annotations", icon: "TextT", overlay: "brontide-text" },
  { id: "note", label: "Note", groupId: "annotations", icon: "NotePencil", overlay: "simpleAnnotation", legacyIds: ["textNote"] },
  { id: "priceNote", label: "Price Note/Label", groupId: "annotations", icon: "Tag", overlay: "simpleTag", legacyIds: ["priceLabel"] },
  { id: "callout", label: "Callout", groupId: "annotations", icon: "ChatCenteredDots", overlay: "brontide-callout" },
] as const;

export const DRAWING_TOOL_BY_ID = new Map(DRAWING_TOOLS.map(tool => [tool.id, tool]));
export const IMPLEMENTED_DRAWING_TOOLS = DRAWING_TOOLS.filter(tool => tool.id === "select" || tool.overlay !== undefined);
export const LEGACY_OVERLAY_LABELS: Readonly<Record<string, string>> = {
  horizontalSegment: "Horizontal Segment",
  verticalRayLine: "Vertical Ray",
  verticalSegment: "Vertical Segment",
  priceLine: "Price Line",
  priceChannelLine: "Price Channel",
};

const TOOL_ID_ALIASES = new Map<string, DrawingToolId>();
for (const tool of DRAWING_TOOLS) {
  for (const alias of [tool.id, ...(tool.legacyIds ?? [])]) {
    const existing = TOOL_ID_ALIASES.get(alias);
    if (existing && existing !== tool.id) throw new Error(`Drawing tool alias ${alias} is ambiguous.`);
    TOOL_ID_ALIASES.set(alias, tool.id);
  }
}

export function canonicalDrawingToolId(value: unknown): DrawingToolId | undefined {
  return typeof value === "string" ? TOOL_ID_ALIASES.get(value) : undefined;
}

export function drawingToolLabelForOverlay(name: string): string {
  return DRAWING_TOOLS.find(tool => tool.overlay === name)?.label ?? LEGACY_OVERLAY_LABELS[name] ?? name;
}

export type SnapPreference = "off" | "weak" | "strong";
export type DrawingPreferences = {
  schemaVersion: 2;
  favorites: DrawingToolId[];
  lastUsed: Partial<Record<DrawingGroupId, DrawingToolId>>;
  recent: DrawingToolId[];
  keepDrawing: boolean;
  snap: SnapPreference;
};

const DEFAULT_FAVORITES: DrawingToolId[] = ["trendLine", "horizontalRay", "parallelChannel", "rectangle", "priceRange"];
export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  schemaVersion: 2,
  favorites: DEFAULT_FAVORITES,
  lastUsed: Object.fromEntries(DRAWING_GROUPS.map(group => [group.id, group.defaultTool])) as Record<DrawingGroupId, DrawingToolId>,
  recent: [],
  keepDrawing: false,
  snap: "weak",
};

const uniqueImplemented = (values: unknown): DrawingToolId[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(canonicalDrawingToolId).filter((id): id is DrawingToolId =>
    id !== undefined && IMPLEMENTED_DRAWING_TOOLS.some(tool => tool.id === id)))];
};

export function validDrawingPreferences(value: unknown): value is DrawingPreferences {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DrawingPreferences>;
  if (row.schemaVersion !== 2 || typeof row.keepDrawing !== "boolean" || !["off", "weak", "strong"].includes(row.snap ?? "")) return false;
  if (!Array.isArray(row.favorites) || !Array.isArray(row.recent) || !row.lastUsed || typeof row.lastUsed !== "object") return false;
  if (uniqueImplemented(row.favorites).length !== row.favorites.length || uniqueImplemented(row.recent).length !== row.recent.length) return false;
  return Object.entries(row.lastUsed).every(([groupId, toolId]) => {
    const tool = DRAWING_TOOL_BY_ID.get(toolId);
    return DRAWING_GROUP_IDS.includes(groupId as DrawingGroupId) && tool?.groupId === groupId && (tool.id === "select" || !!tool.overlay);
  });
}

export function migrateDrawingPreferences(value: unknown, legacyFavorites: unknown, legacySnap: unknown): DrawingPreferences {
  if (validDrawingPreferences(value)) return value;
  const favorites = uniqueImplemented(legacyFavorites);
  return {
    ...DEFAULT_DRAWING_PREFERENCES,
    favorites: favorites.length ? favorites : [...DEFAULT_FAVORITES],
    snap: legacySnap === true ? "strong" : legacySnap === false ? "off" : "weak",
  };
}

export function toolsForGroup(groupId: DrawingGroupId, favorites: readonly DrawingToolId[], implementedOnly = true): DrawingToolDefinition[] {
  return DRAWING_TOOLS.filter(tool => tool.groupId === groupId && (!implementedOnly || tool.id === "select" || !!tool.overlay))
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
}

export function assertDrawingRegistry(): true {
  if (DRAWING_GROUPS.length !== 8 || new Set(DRAWING_GROUPS.map(group => group.id)).size !== 8) throw new Error("Drawing groups must contain eight unique IDs.");
  if (DRAWING_TOOLS.length !== 29 || new Set(DRAWING_TOOLS.map(tool => tool.id)).size !== DRAWING_TOOLS.length) throw new Error("Drawing tool IDs must be unique.");
  if (new Set(DRAWING_TOOLS.map(tool => tool.label)).size !== DRAWING_TOOLS.length) throw new Error("Drawing tool labels must be unique.");
  if (new Set(DRAWING_TOOLS.map(tool => tool.icon)).size !== DRAWING_TOOLS.length) throw new Error("Drawing tool icons must be unique.");
  const renderers = DRAWING_TOOLS.flatMap(tool => tool.overlay ? [tool.overlay] : []);
  if (new Set(renderers).size !== renderers.length) throw new Error("Creation renderers must have one canonical owner.");
  for (const tool of DRAWING_TOOLS) if (!DRAWING_GROUP_IDS.includes(tool.groupId)) throw new Error(`Unknown group for ${tool.id}.`);
  for (const group of DRAWING_GROUPS) if (DRAWING_TOOL_BY_ID.get(group.defaultTool)?.groupId !== group.id) throw new Error(`Invalid default for ${group.id}.`);
  return true;
}
