"use client";

import { useEffect, useRef } from "react";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("button, input, select, textarea, [href]");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]") ?? [])];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
      if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop"><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="drawer-close" onClick={onClose} aria-label={`Close ${title}`}>×</button>{children}</div></div>;
}
