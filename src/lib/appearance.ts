// ============================================================================
// Appearance & Branding — runtime configuration.
// Safe to import from client components AND server routes (no node imports).
// Stored as JSON in <project>/data/appearance.json (survives rebuilds and
// update packs — data/ is on the update engine's preserve list).
//
// Two things live here on purpose:
//   1. THEME — "dark" (the look the app has always had) or "light".
//   2. BRANDING — the factory's own name, logo and contact details. These
//      replace the hardcoded "WOODTEK / Furniture Service Center" blocks on
//      every printable document: invoices, quotes, delivery notes, job
//      tickets, dispatch packs, statements, reports and outbound emails.
//      The app itself stays WoodTek ERP; the documents carry the factory's
//      identity, because that is what the client sees.
// ============================================================================

export type ThemeMode = "dark" | "light";

export interface AppearanceConfig {
  version: 1;
  theme: ThemeMode;
  /** The factory's own name — printed on documents, shown next to the app name. */
  factoryName: string;
  /** Short line under the factory name (e.g. "Furniture Service Center"). */
  tagline: string;
  /** data:image/png or data:image/jpeg;base64,… — "" means no logo. */
  logoDataUrl: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  website: string;
  /** Commercial register / tax number — printed in the document footer. */
  taxId: string;
  /** Full override of the document footer brand line ("" = factory name + tagline). */
  documentFooter: string;
}

export const APPEARANCE_DEFAULTS: AppearanceConfig = {
  version: 1,
  theme: "dark",
  factoryName: "",
  tagline: "",
  logoDataUrl: "",
  addressLine1: "",
  addressLine2: "",
  phone: "",
  email: "",
  website: "",
  taxId: "",
  documentFooter: "",
};

// Field caps. The JSON is read on every document render, so keep it small.
export const FACTORY_NAME_MAX = 80;
export const TAGLINE_MAX = 120;
export const FIELD_MAX = 160;
export const FOOTER_MAX = 200;
/** ~300 KB of base64 — enough for a 512px logo, small enough to stay sane. */
export const LOGO_MAX_CHARS = 400_000;

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+$/g, "").slice(0, max) : "";

// Only formats jsPDF (addImage) and every browser can print: PNG or JPEG.
const LOGO_RE = /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/]+={0,2}$/;

export function sanitizeAppearance(input: unknown): AppearanceConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<AppearanceConfig>;
  const logo =
    typeof raw.logoDataUrl === "string" && LOGO_RE.test(raw.logoDataUrl)
      ? raw.logoDataUrl.slice(0, LOGO_MAX_CHARS)
      : "";
  return {
    version: 1,
    theme: raw.theme === "light" ? "light" : "dark",
    factoryName: text(raw.factoryName, FACTORY_NAME_MAX).trim(),
    tagline: text(raw.tagline, TAGLINE_MAX).trim(),
    logoDataUrl: logo,
    addressLine1: text(raw.addressLine1, FIELD_MAX).trim(),
    addressLine2: text(raw.addressLine2, FIELD_MAX).trim(),
    phone: text(raw.phone, FIELD_MAX).trim(),
    email: text(raw.email, FIELD_MAX).trim(),
    website: text(raw.website, FIELD_MAX).trim(),
    taxId: text(raw.taxId, FIELD_MAX).trim(),
    documentFooter: text(raw.documentFooter, FOOTER_MAX),
  };
}

// ---------------------------------------------------------------------------
// Document helpers — one place that decides what a printed page says.
// ---------------------------------------------------------------------------

/**
 * Name printed on documents and shown in the app chrome.
 * Default keeps today's look exactly: "WoodTek ERP".
 */
export function brandName(cfg: AppearanceConfig | null | undefined): string {
  const n = cfg?.factoryName?.trim();
  return n || "WoodTek ERP";
}

/**
 * The big monogram on a document header / the app brand tile.
 * Defaults to "WoodTek" (not "WoodTek ERP") so existing documents, which were
 * designed around that short lockup, are unchanged until a factory name is set.
 */
export function brandShort(cfg: AppearanceConfig | null | undefined): string {
  const n = cfg?.factoryName?.trim();
  return n || "WoodTek";
}

export function brandTagline(cfg: AppearanceConfig | null | undefined): string {
  return cfg?.tagline?.trim() || "Furniture Service Center";
}

/** The left part of a document footer / header: "Factory — Tagline". */
export function documentBrandLine(cfg: AppearanceConfig | null | undefined): string {
  const custom = cfg?.documentFooter?.trim();
  if (custom) return custom;
  // brandTagline() falls back to "Furniture Service Center", which is what the
  // footers have always said — an unconfigured factory sees no change at all.
  return `${brandName(cfg)} — ${brandTagline(cfg)}`;
}

/** Contact lines for a document header (address, phone, email, …). */
export function contactLines(cfg: AppearanceConfig | null | undefined): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    const s = (v ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(cfg?.addressLine1);
  push(cfg?.addressLine2);
  push(cfg?.phone);
  push(cfg?.email);
  push(cfg?.website);
  if (cfg?.taxId?.trim()) out.push(`Reg. ${cfg.taxId.trim()}`);
  return out;
}

export function hasLogo(cfg: AppearanceConfig | null | undefined): boolean {
  return typeof cfg?.logoDataUrl === "string" && cfg.logoDataUrl.startsWith("data:image/");
}

// ---------------------------------------------------------------------------
// Runtime cache.
// The AppearanceProvider writes the saved config here once at start-up, so
// the printable-document builders (delivery note, job ticket, dispatch pack,
// invoice PDF …) can print the factory name/logo without prop-drilling the
// branding through every screen that has a Print button. Before the provider
// has loaded — and on the server / in tests — this is the default config,
// which reproduces the app's original look.
// ---------------------------------------------------------------------------

let current: AppearanceConfig = APPEARANCE_DEFAULTS;

export function currentAppearance(): AppearanceConfig {
  return current;
}

export function setCurrentAppearance(input: unknown): AppearanceConfig {
  current = sanitizeAppearance(input);
  return current;
}
