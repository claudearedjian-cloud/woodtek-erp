// ============================================================================
// Email dispatch — pure helpers (client-safe, no node imports).
//
// The Order Workflow "Email Docs" modal pre-fills recipient/subject from the
// order and posts to /api/email-dispatch, which builds the printable HTML
// documents (delivery note / dispatch pack / job ticket) as attachments and
// sends them through the SMTP account configured in Settings.
// ============================================================================

export const EMAIL_DISPATCH_VERSION = 1;

import { isValidEmail } from "@/lib/emailConfig";

export const MAX_EMAIL_RECIPIENTS = 25;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * One recipient candidate: trim, collapse inner whitespace, lowercase.
 * Returns "" for blank input. Does NOT validate — see parseRecipients.
 */
export function sanitizeRecipient(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ParsedRecipients {
  recipients: string[];
  /** Up to 5 offending addresses, for the error message. */
  rejected: string[];
}

/**
 * Split a raw recipient string on commas / semicolons / newlines (and loose
 * whitespace), trim, lowercase, dedupe case-insensitively, validate each
 * address. Invalid entries land in `rejected` (max 5) instead of aborting,
 * so the caller can report exactly what was wrong.
 */
export function parseRecipients(raw: unknown): ParsedRecipients {
  const out: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const parts = String(raw ?? "")
    .split(/[,;\n\r\t]+/)
    .map((p) => sanitizeRecipient(p))
    .filter(Boolean);
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    if (!isValidEmail(part)) {
      if (rejected.length < 5) rejected.push(part);
      continue;
    }
    seen.add(key);
    out.push(part);
    if (out.length >= MAX_EMAIL_RECIPIENTS) break;
  }
  return { recipients: out, rejected };
}

/**
 * "Delivery note — ORD-2026-0419 — Executive Conference Table"
 * Falls back to the order id when no number exists yet.
 */
export function buildDeliveryEmailSubject(order: { orderNumber?: unknown; title?: unknown; id?: unknown }): string {
  const num = String(order?.orderNumber ?? `ORDER-${order?.id ?? ""}`).trim() || "order";
  const title = String(order?.title ?? "").trim();
  return title ? `Delivery note — ${num} — ${title}` : `Delivery note — ${num}`;
}

/**
 * "Dispatch pack — ORD-2026-0419 — Executive Conference Table"
 */
export function buildDispatchPackEmailSubject(order: { orderNumber?: unknown; title?: unknown; id?: unknown }): string {
  const num = String(order?.orderNumber ?? `ORDER-${order?.id ?? ""}`).trim() || "order";
  const title = String(order?.title ?? "").trim();
  return title ? `Dispatch pack — ${num} — ${title}` : `Dispatch pack — ${num}`;
}

export interface EmailBodyParts {
  title: string;
  message: string;
  orderNumber?: string;
  senderName?: string;
  attachments?: string[];
  generatedAt?: string | Date;
}

function formatStamp(value?: string | Date): string {
  const d = value ? new Date(String(value)) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toLocaleString() : d.toLocaleString();
}

/**
 * Branded, self-contained HTML body for the dispatch email. title and
 * message are HTML-escaped — they come from a form field, not the DB.
 */
export function buildEmailHtmlBody(parts: EmailBodyParts): string {
  const attachments = Array.isArray(parts.attachments)
    ? parts.attachments.map((a) => String(a)).filter(Boolean).slice(0, 10)
    : [];
  const attList = attachments.length
    ? `<ul style="margin:6px 0 0 18px;padding:0">${attachments.map((a) => `<li style="margin:2px 0;font-family:ui-monospace,monospace;font-size:11px;color:#334155">${esc(a)}</li>`).join("")}</ul>`
    : `<p style="margin:8px 0 0;font-size:11px;color:#64748b">No document attachments on this email.</p>`;
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>${esc(parts.title)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:0 auto">
    <div style="background:#0f172a;border-radius:10px 10px 0 0;padding:16px 20px">
      <div style="font-size:16px;font-weight:900;letter-spacing:2px;color:#f8fafc">WOODTEK</div>
      <div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:#38bdf8;text-transform:uppercase">Production order documents</div>
    </div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:20px">
      ${parts.orderNumber ? `<div style="font-family:ui-monospace,monospace;font-size:11px;font-weight:bold;color:#0369a1;margin-bottom:8px">${esc(parts.orderNumber)}</div>` : ""}
      <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${esc(parts.title)}</h2>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:#334155">${esc(parts.message) || "<span style='color:#94a3b8'>No message.</span>"}</div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0 10px" />
      <div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#64748b;text-transform:uppercase">Attached documents</div>
      ${attList}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0 10px" />
      <div style="font-size:10px;color:#94a3b8">
        Sent${parts.senderName ? ` by ${esc(parts.senderName)}` : ""} from WoodTek ERP on ${esc(formatStamp(parts.generatedAt))}.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * SMTP errors can be noisy and occasionally echo credentials — shorten the
 * message and redact password-like tokens before surfacing it in a response
 * or an audit detail.
 */
export function describeSendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw
    .replace(/(password|pass|passwd|pwd)\s*[:=]\s*\S+/gi, "$1=***")
    .replace(/\r?\n+/g, " ")
    .slice(0, 300);
  return clean || "The mail server rejected the message.";
}

/** Plain-text twin of buildEmailHtmlBody (for mail clients without HTML). */
export function buildEmailTextBody(parts: EmailBodyParts): string {
  const attachments = Array.isArray(parts.attachments)
    ? parts.attachments.map((a) => String(a)).filter(Boolean).slice(0, 10)
    : [];
  const lines: string[] = [];
  lines.push("WOODTEK — Production order documents");
  lines.push("=".repeat(44));
  if (parts.orderNumber) lines.push(parts.orderNumber);
  lines.push(parts.title);
  lines.push("");
  lines.push(parts.message.trim() ? parts.message : "(no message)");
  lines.push("");
  lines.push("Attached documents:");
  if (attachments.length) {
    for (const a of attachments) lines.push(`  - ${a}`);
  } else {
    lines.push("  (none)");
  }
  lines.push("");
  lines.push(`Sent${parts.senderName ? ` by ${parts.senderName}` : ""} from WoodTek ERP on ${formatStamp(parts.generatedAt)}.`);
  return lines.join("\n");
}
