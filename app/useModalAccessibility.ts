"use client";

import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE = "[data-modal-initial-focus],[autofocus],button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function useModalAccessibility(open: boolean, container: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  const triggerRef = useRef<HTMLElement | null>(null);
  const previousOpen = useRef(open);
  closeRef.current = onClose;
  if (typeof document !== "undefined" && open && !previousOpen.current) {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  previousOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const target = container.current?.querySelector<HTMLElement>("[data-modal-initial-focus]")
        ?? container.current?.querySelector<HTMLElement>(FOCUSABLE)
        ?? container.current;
      target?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !container.current) return;
      const focusable = Array.from(container.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        container.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, container]);
}
