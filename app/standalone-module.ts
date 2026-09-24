/** Reviewed built-in module manifest. This is not a plugin loader. */
export const standaloneModules = [{
  id: "trading",
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

export function standaloneViewFromProfile(value: unknown): StandaloneView | null {
  return standaloneModules[0].views.find(view => view.profileView === value)?.id ?? null;
}

export function profileViewFromStandalone(value: string): LocalProfileView | null {
  return standaloneModules[0].views.find(view => view.id === value)?.profileView ?? null;
}
