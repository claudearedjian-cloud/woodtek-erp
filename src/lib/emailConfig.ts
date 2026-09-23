// ============================================================================
// SMTP configuration model — pure helpers (client-safe, no node imports).
//
// Stored on the server as <data dir>/email-config.json (see
// emailConfig.server.ts). Version 1: one factory-wide SMTP account. The
// password is NEVER returned to the browser in clear — routes respond with
// maskEmailConfig() output (pass "***" + hasPass flag) and the PUT handler
// keeps the stored password whenever the "***" placeholder comes back.
// ============================================================================

export const EMAIL_CONFIG_VERSION = 1;

export const EMAIL_CONFIG_PLACEHOLDER = "***";

export interface EmailConfig {
  version: 1;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  version: 1,
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  fromName: "WoodTek",
  fromEmail: "",
};

export const EMAIL_MAX_PORT = 65535;
export const EMAIL_MIN_PORT = 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clampPort(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_EMAIL_CONFIG.port;
  return Math.min(EMAIL_MAX_PORT, Math.max(EMAIL_MIN_PORT, n));
}

/**
 * Accepts unknown input (the JSON file or an API body) and returns a clean
 * EmailConfig: trims text fields, lowercases the from-address, clamps the
 * port to 1–65535 and forces booleans.
 */
export function sanitizeEmailConfig(raw: unknown): EmailConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    version: 1,
    host: String(src.host ?? "").trim(),
    port: clampPort(src.port),
    secure: src.secure === true || src.secure === "true",
    user: String(src.user ?? "").trim(),
    pass: String(src.pass ?? "").trim(),
    fromName: String(src.fromName ?? "").trim(),
    fromEmail: String(src.fromEmail ?? "").trim().toLowerCase(),
  };
}

/** True when the address looks like an email (used by validation + recipients). */
export function isValidEmail(value: string): boolean {
  const v = String(value ?? "").trim();
  return v.length > 0 && v.length <= 254 && EMAIL_RE.test(v);
}

/**
 * Validate a sanitized config. Returns a human-readable error, or null when
 * the config is usable. Rules: host + fromEmail are required, an SMTP user
 * needs a password, and fromEmail must look like an email address.
 */
export function validateEmailConfig(cfg: EmailConfig): string | null {
  if (!cfg.host) return "SMTP host is required.";
  if (!cfg.fromEmail) return "From email is required.";
  if (!isValidEmail(cfg.fromEmail)) return "From email does not look like a valid address.";
  if (cfg.user && !cfg.pass) return "SMTP user is set — a password is required too.";
  return null;
}

/** Is the config ready to send mail? */
export function isEmailConfigured(cfg: EmailConfig): boolean {
  return Boolean(cfg.host && cfg.fromEmail);
}

export interface MaskedEmailConfig {
  version: 1;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Always the placeholder (or "" when no password is stored). Never clear. */
  pass: string;
  hasPass: boolean;
  fromName: string;
  fromEmail: string;
  configured: boolean;
}

/** The only shape the server may send to the browser. */
export function maskEmailConfig(cfg: EmailConfig): MaskedEmailConfig {
  const clean = sanitizeEmailConfig(cfg);
  return {
    version: 1,
    host: clean.host,
    port: clean.port,
    secure: clean.secure,
    user: clean.user,
    pass: clean.pass ? EMAIL_CONFIG_PLACEHOLDER : "",
    hasPass: Boolean(clean.pass),
    fromName: clean.fromName,
    fromEmail: clean.fromEmail,
    configured: isEmailConfigured(clean),
  };
}

/** "WoodTek <woodtek@factory.com>" — or the bare address when no name is set. */
export function buildFromHeader(cfg: EmailConfig): string {
  const clean = sanitizeEmailConfig(cfg);
  const name = clean.fromName.replace(/"/g, "");
  if (!name) return clean.fromEmail;
  return `${name} <${clean.fromEmail}>`;
}
