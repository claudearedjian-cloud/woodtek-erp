"use client";

// A panel that can be folded away to make a crowded screen easier to read.
// The open/closed choice is remembered per section on this device
// (localStorage "woodtek-collapse:<id>"), so a station that keeps one panel
// closed keeps it closed after a reload. The content stays mounted when
// closed (only hidden), so nothing it loads or edits is lost by collapsing it.

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const STORAGE_PREFIX = "woodtek-collapse:";

export default function CollapsibleSection({
  id,
  title,
  children,
  defaultOpen = true,
  className = "",
  right,
}: {
  id: string;
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read the saved choice after mount (localStorage does not exist during SSR).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + id);
      if (saved === "open") setOpen(true);
      if (saved === "closed") setOpen(false);
    } catch {
      /* private mode: keep the default */
    }
  }, [id]);

  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      try {
        localStorage.setItem(STORAGE_PREFIX + id, next ? "open" : "closed");
      } catch {
        /* the choice applies for this session only */
      }
      return next;
    });
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="truncate">{title}</span>
          <span className="ml-1 text-[10px] font-bold normal-case tracking-normal text-slate-500">{open ? "Collapse" : "Expand"}</span>
        </button>
        {right}
      </div>
      <div className={open ? "mt-3" : "hidden"}>{children}</div>
    </section>
  );
}
