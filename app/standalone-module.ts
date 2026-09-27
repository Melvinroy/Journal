/** Reviewed built-in module manifest. This is not a plugin loader. */
export const standaloneModules = [{
  id: "trading",
  version: 1,
  label: "Trading",
  requiredService: "local-session",
  views: [
    { id: "Connect", label: "Connect", icon: "check", profileView: "connect" },
    { id: "Trade", label: "Trading", icon: "target", profileView: "trading" },
    { id: "Journal", label: "Journal", icon: "book", profileView: "journal" },
  ],
}] as const;

export type StandaloneView = (typeof standaloneModules)[number]["views"][number]["id"];
export type LocalProfileView = (typeof standaloneModules)[number]["views"][number]["profileView"];
export type OptionalStandaloneView = "trading" | "journal";
export type LocalModuleStatus = {
  enabledViews: OptionalStandaloneView[];
  canHideTrading: boolean;
};

/** The local service owns the choice. An invalid response grants no view. */
export function localModuleStatusFromResponse(value: unknown): LocalModuleStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Record<string, unknown>;
  const views = status.enabledViews;
  if (status.executionEnabled !== false || typeof status.canHideTrading !== "boolean" ||
      !Array.isArray(views) || views.length < 1 || views.length > 2 ||
      views.some(view => view !== "trading" && view !== "journal") ||
      new Set(views).size !== views.length ||
      (views.length === 2 && (views[0] !== "trading" || views[1] !== "journal")) ||
      (!status.canHideTrading && !views.includes("trading"))) return null;
  return { enabledViews: views as OptionalStandaloneView[], canHideTrading: status.canHideTrading };
}

export function standaloneViewEnabled(view: StandaloneView, enabledViews: readonly OptionalStandaloneView[]): boolean {
  return view === "Connect" || enabledViews.includes(view === "Trade" ? "trading" : "journal");
}

export function standaloneViewFromProfile(value: unknown): StandaloneView | null {
  return standaloneModules[0].views.find(view => view.profileView === value)?.id ?? null;
}

export function profileViewFromStandalone(value: string): LocalProfileView | null {
  return standaloneModules[0].views.find(view => view.id === value)?.profileView ?? null;
}
