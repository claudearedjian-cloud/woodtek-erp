"use client";

// Collapse / expand for EACH PANEL of every screen.
//
// Every direct child of a screen's root block (except the first block, which is
// the title/top bar, and except overlays such as dialogs) gets a small
// "Hide <panel name>" / "Show <panel name>" bar placed just above it. Collapsing
// a panel only hides that panel (CSS data-part-collapsed="true"). Nothing is
// unmounted, so loaded data and typed input are kept. The choice is saved per
// screen and per panel on this device (localStorage "woodtek-part:<screen>:...").
//
// The bars are added to the DOM by this component, not by React, so the
// observer re-applies them whenever a screen re-renders with new panels.

import React, { useEffect, useRef } from "react";

const KEY_PREFIX = "woodtek-part:";
const BAR_ATTR = "data-part-bar";
const COLLAPSED_ATTR = "data-part-collapsed";
const SKIP_SELECTOR = ".fixed, .inset-0, script, style, [data-no-part]";

function labelFor(el: HTMLElement, index: number): string {
  const heading = el.querySelector("h1, h2, h3, h4");
  const text = (heading?.textContent || el.textContent || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 48) : `Section ${index}`;
}

function readClosed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "closed";
  } catch {
    return false;
  }
}

function writeClosed(key: string, closed: boolean): void {
  try {
    localStorage.setItem(key, closed ? "closed" : "open");
  } catch {
    /* the choice applies for this session only */
  }
}

export default function ScreenCollapse({ screenId, children }: { screenId: string; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let frame = 0;
    // bar -> the panel it belongs to
    const partOf = new WeakMap<HTMLElement, HTMLElement>();

    const applyState = (part: HTMLElement, bar: HTMLButtonElement, key: string, label: string) => {
      const closed = part.getAttribute(COLLAPSED_ATTR) === "true";
      const text = `${closed ? "Show" : "Hide"} ${label}`;
      if (bar.dataset.partKey !== key) bar.dataset.partKey = key;
      if (bar.textContent !== text) bar.textContent = text;
      bar.setAttribute("aria-expanded", String(!closed));
      bar.dataset.closed = closed ? "true" : "false";
    };

    const createBar = (part: HTMLElement): HTMLButtonElement => {
      const bar = document.createElement("button");
      bar.type = "button";
      bar.setAttribute(BAR_ATTR, "");
      bar.className =
        "part-collapse-bar flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1 text-left text-[11px] font-bold text-slate-400 hover:border-slate-600 hover:text-white print:hidden";
      bar.addEventListener("click", () => {
        const key = bar.dataset.partKey || "";
        const closed = part.getAttribute(COLLAPSED_ATTR) !== "true";
        part.setAttribute(COLLAPSED_ATTR, closed ? "true" : "false");
        writeClosed(key, closed);
        applyState(part, bar, key, bar.dataset.label || "");
      });
      partOf.set(bar, part);
      return bar;
    };

    const enhance = () => {
      frame = 0;
      const root = wrap.firstElementChild as HTMLElement | null;
      if (!root) return;

      // Drop bars whose panel has gone (React removed or replaced it).
      Array.from(root.children).forEach((node) => {
        const bar = node as HTMLButtonElement;
        if (!bar.hasAttribute(BAR_ATTR)) return;
        const part = partOf.get(bar as HTMLElement);
        if (!part || part.parentElement !== root || bar.nextElementSibling !== part) bar.remove();
      });

      let index = 0;
      Array.from(root.children).forEach((node, position) => {
        const el = node as HTMLElement;
        if (el.hasAttribute(BAR_ATTR)) return;
        index += 1;
        if (position === 0) return; // the title bar always stays visible
        if (el.matches(SKIP_SELECTOR)) return;

        const label = labelFor(el, index);
        const key = `${KEY_PREFIX}${screenId}:${index}:${label}`;
        const prev = el.previousElementSibling as HTMLButtonElement | null;
        let bar: HTMLButtonElement;
        if (prev && prev.hasAttribute(BAR_ATTR) && partOf.get(prev) === el) {
          bar = prev;
        } else {
          bar = createBar(el);
          root.insertBefore(bar, el);
          el.setAttribute(COLLAPSED_ATTR, readClosed(key) ? "true" : "false");
        }
        if (bar.dataset.label !== label) bar.dataset.label = label;
        applyState(el, bar, key, label);
        // A panel that is not rendered (e.g. a hidden tab) gets no visible bar.
        const hiddenByScreen = el.getClientRects().length === 0 && el.getAttribute(COLLAPSED_ATTR) !== "true";
        if (bar.hidden !== hiddenByScreen) bar.hidden = hiddenByScreen;
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(enhance);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    enhance();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [screenId]);

  return <div ref={wrapRef}>{children}</div>;
}
