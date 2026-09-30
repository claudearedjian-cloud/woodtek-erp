import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// WoodTek ERP — ESLint 9 flat config.
// Before 2026-09-30 this file did not exist: `npm run lint` errored out with
// "couldn't find an eslint.config.(js|mjs|cjs)" even though eslint and
// eslint-config-next were installed. This is the first time the codebase is
// actually lintable. CI runs `npm run lint` on every PR.
//
// LEGACY DEBT POLICY (2026-09-30 baseline, 857 findings triaged):
// - Errors block CI: everything that can break at runtime (rules of hooks,
//   Next.js rules, real syntax problems, unescaped entities, …).
// - Warnings stay visible but do not block: `no-explicit-any` (649 legacy
//   `any`s across older components/lib shapers — fixed over time, never
//   silently hidden), unused imports (81), and the new-generation
//   react-hooks compiler rules (set-state-in-effect / purity /
//   static-components / immutability / refs) which flag working code that
//   needs case-by-case refactors.
// The goal: no NEW errors can merge, while the existing debt stays on the
// radar instead of being blanket-disabled.

// Severity overrides, applied to the eslint-config-next element that already
// declares each rule (flat config requires a plugin to be defined in the same
// element that references its rules — mutating the preset's own elements is
// the only clean way to soften a severity without redefining plugins).
const SEVERITY_OVERRIDES = {
  // New-generation react-hooks compiler rules: flag working legacy patterns
  // that need individual refactors (setState in effect, render-time purity,
  // static components) — visible warnings, not build breakers.
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/refs": "warn",
  // Legacy `any` usage: visible warning, not a build breaker (649 sites).
  "@typescript-eslint/no-explicit-any": "warn",
};

function withSeverityOverrides(configs) {
  return configs.map((element) => {
    if (!element || !element.rules) return element;
    const overrides = Object.fromEntries(
      Object.entries(SEVERITY_OVERRIDES).filter(([ruleId]) => ruleId in element.rules),
    );
    if (Object.keys(overrides).length === 0) return element;
    return { ...element, rules: { ...element.rules, ...overrides } };
  });
}

export default defineConfig([
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "compiled/**", // legacy compiled copies, kept on disk only
    "backup/**", // .bat/.ps1 helpers + pg dumps
    "data/**",
    "logs/**",
    "backups/**",
    "uploads/**",
    "next-env.d.ts",
    "tsconfig.tsbuildinfo",
    "drizzle/meta/**",
  ]),
  ...withSeverityOverrides(nextCoreWebVitals),
  ...withSeverityOverrides(nextTypescript),
  {
    // Plain CommonJS: the watchdog launcher, build script and the SSR test
    // harness. require() is the correct module system for these.
    files: ["*.cjs", "render-test.js", "scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
