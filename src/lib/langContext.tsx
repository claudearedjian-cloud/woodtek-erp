"use client";

// ============================================================================
// Language context — lets deep screens read the language chosen in the top bar
// (EN / العربية / Français) without threading a `lang` prop through every
// component in between.
//
// Why a context instead of more props: page.tsx renders ~24 workspaces, most of
// them already carrying 3-6 props. Drilling one more prop through each would be
// noise; a context keeps the change surface to the screens that actually
// translate labels.
//
// SSR-safe by design: the default value is English, so a component rendered
// without a provider (render-test.js SSR checks, a future isolated screen)
// behaves exactly as it did before this file existed.
//
// Usage in a workspace:
//   const t = useT();
//   ...
//   <span>{t("START")}</span>
// `t()` passes unknown strings straight through, so custom names typed by the
// Manager (Menu Designer, machine names, client names) are never rewritten.
// ============================================================================

import { createContext, useContext, type ReactNode } from "react";
import { tt, type Lang } from "@/lib/i18n";

export const LangContext = createContext<Lang>("en");

/** Wraps the workspace so every screen below can read the active language. */
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The active label language (English when no provider is present). */
export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * Translator bound to the active language. Returns a function so JSX stays
 * terse: `{t("In Production")}`.
 */
export function useT(): (english: string) => string {
  const lang = useLang();
  return (english: string) => tt(lang, english);
}
