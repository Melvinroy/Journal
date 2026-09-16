"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useBrowserStore } from "../lib/use-browser-store";

export function Disclosure({ title, name, scope = "account", children, className = "" }: {
  title: ReactNode; name: string; scope?: string; children: ReactNode; className?: string;
}) {
  const preference = useBrowserStore(`brontide.ui.v1.${scope}.${name}`, false, value => typeof value === "boolean");
  const [open, setOpen] = useState(false);
  useEffect(() => { if (preference.ready) setOpen(preference.value); }, [preference.ready, preference.value]);
  const id = useId();
  return <section className={`workspace-disclosure ${className}`}>
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id}
      onClick={() => { setOpen(!open); preference.save(!open); }}>
      <span aria-hidden="true">{open ? "−" : "+"}</span>{title}
    </button>
    <div id={id} hidden={!open} className="disclosure-content">{children}</div>
  </section>;
}

// Both panes stay mounted: presentation changes must never reset planning or broker state.
export function PlannerWorkspace({ children, positions, count = 0, exposure, scope = "account" }: {
  children: ReactNode; positions: ReactNode; count?: number; exposure?: ReactNode; scope?: string;
}) {
  const preference = useBrowserStore<"plan" | "positions">(`brontide.ui.v1.${scope}.planner-pane`, "plan", value => value === "plan" || value === "positions");
  const [pane, setPane] = useState<"plan" | "positions">("plan");
  useEffect(() => { if (preference.ready) setPane(preference.value); }, [preference.ready, preference.value]);
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const scrolls = useRef({ plan: 0, positions: 0 });
  const id = useId();
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < 960;
      setCompact(narrow);
      if (narrow && root.current?.querySelector(".planner-positions-column")?.contains(document.activeElement)) setPane("positions");
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function select(next: "plan" | "positions") {
    const candidate = root.current?.closest<HTMLElement>(".workspace");
    const scroller = candidate && candidate.scrollHeight > candidate.clientHeight ? candidate : null;
    scrolls.current[pane] = scroller?.scrollTop ?? window.scrollY;
    setPane(next); preference.save(next);
    requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scrolls.current[next]; else window.scrollTo(0, scrolls.current[next]); });
  }
  return <div ref={root} className="planner-workspace" data-pane={pane}>
    <div className="compact-workspace-switch">
      <div className="exposure-summary" role="status">{exposure}</div>
      <div role="tablist" aria-label="Planning and positions">
        {(["plan", "positions"] as const).map(value => <button key={value} id={`${id}-${value}-tab`} type="button"
          role="tab" aria-selected={pane === value} aria-controls={`${id}-${value}`} tabIndex={pane === value ? 0 : -1}
          onClick={() => select(value)} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault(); const next = event.key === "Home" ? "plan" : event.key === "End" ? "positions" : pane === "plan" ? "positions" : "plan";
              select(next); document.getElementById(`${id}-${next}-tab`)?.focus();
            }
          }}>{value === "plan" ? "Plan" : `Positions (${count})`}</button>)}
      </div>
    </div>
    <div className="planner-position-layout">
      <div className="planner-editing-column" id={`${id}-plan`} role={compact ? "tabpanel" : undefined} aria-labelledby={compact ? `${id}-plan-tab` : undefined}>{children}</div>
      <div className="planner-positions-column" id={`${id}-positions`} role={compact ? "tabpanel" : undefined} aria-labelledby={compact ? `${id}-positions-tab` : undefined}>{positions}</div>
    </div>
  </div>;
}

export function MissingValue({ reason = "Not available" }: { reason?: string }) {
  return <span className="missing-value" title={reason}><span aria-hidden="true">—</span><span className="sr-only">{reason}</span></span>;
}
