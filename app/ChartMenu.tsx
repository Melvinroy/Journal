"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** A tab-navigable popover. Only its trigger occupies toolbar space. */
export function ChartMenu({ label, title, open, onToggle, onClose, children, className = "" }: {
  label: ReactNode; title: string; open: boolean; onToggle: () => void;
  onClose: () => void; children: ReactNode; className?: string;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); close.current(); trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div ref={host} className={`chart-popover-host ${className}`} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onClose();
  }}>
    <button ref={trigger} type="button" className="chart-command" aria-label={title} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>{label}</button>
    {open && <div ref={panel} id={id} className="chart-popover" role="region" aria-label={title}>{children}</div>}
  </div>;
}
