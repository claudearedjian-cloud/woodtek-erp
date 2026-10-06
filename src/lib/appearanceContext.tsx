"use client";

// ============================================================================
// Appearance & Branding — client side.
// Loads data/appearance.json once at start-up, applies the theme to <html>
// and exposes save(). A module-level cache (currentAppearance) lets the
// printable-document builders (delivery note, job ticket, invoice PDF …)
// read the factory branding without prop-drilling it through every screen.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  APPEARANCE_DEFAULTS,
  sanitizeAppearance,
  setCurrentAppearance,
  type AppearanceConfig,
  type ThemeMode,
} from "@/lib/appearance";

const THEME_KEY = "woodtek-theme";

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — the theme still applies for this session */
  }
}

interface AppearanceContextValue {
  appearance: AppearanceConfig;
  /** Persists and applies. Throws with a readable message on failure. */
  save: (next: AppearanceConfig) => Promise<void>;
  saving: boolean;
}

const AppearanceContext = createContext<AppearanceContextValue>({
  appearance: APPEARANCE_DEFAULTS,
  save: async () => {},
  saving: false,
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceConfig>(APPEARANCE_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/appearance", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const cfg = sanitizeAppearance(json?.appearance);
        if (!alive) return;
        setCurrentAppearance(cfg);
        setAppearance(cfg);
        applyTheme(cfg.theme);
      } catch {
        /* offline / not signed in yet — keep defaults */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: AppearanceConfig) => {
    setSaving(true);
    try {
      const res = await fetch("/api/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Could not save appearance");
      const cfg = sanitizeAppearance(json?.appearance ?? next);
      setCurrentAppearance(cfg);
      setAppearance(cfg);
      applyTheme(cfg.theme);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <AppearanceContext.Provider value={{ appearance, save, saving }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  return useContext(AppearanceContext);
}
