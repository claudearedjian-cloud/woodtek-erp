"use client";

// Collapse / expand for EVERY screen. One control sits above the screen:
// "Collapse panels" folds away the screen's panels and keeps its title row
// visible; "Expand panels" brings them back. The choice is remembered per screen
// on this device (localStorage "woodtek-screen-collapse:<screen>").
// Nothing is unmounted: the panels are hidden with CSS (globals.css rule
// [data-screen-collapse="closed"]), so loaded data and typed input are kept.
// Overlays and dialogs (position: fixed) are never hidden.

import React, { useEffect, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

const KEY_PREFIX = "woodtek-screen-collapse:";

export default function ScreenCollapse({ screenId, children }: { screenId: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY_PREFIX + screenId) === "closed");
    } catch {
      setCollapsed(false);
    }
  }, [screenId]);

  const toggle = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(KEY_PREFIX + screenId, next ? "closed" : "open");
      } catch {
        /* the choice applies for this session only */
      }
      return next;
    });
  };

  return (
    <>
      <div className="flex justify-end px-6 pt-4 print:hidden">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Show this screen's panels" : "Fold away this screen's panels to see less"}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:border-slate-600 hover:text-white"
        >
          {collapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
          {collapsed ? "Expand panels" : "Collapse panels"}
        </button>
      </div>
      <div data-screen-collapse={collapsed ? "closed" : "open"}>{children}</div>
    </>
  );
}
