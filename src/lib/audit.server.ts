// ============================================================================
// Audit log — append-only trail of who did what. SERVER ONLY.
// Stored as a JSON overlay (data/audit-log.json, same no-migration pattern),
// capped to the newest AUDIT_MAX entries so the file can never grow forever.
// Never throws into the caller: a logging failure must not break the action.
// ============================================================================

import fs from "node:fs";
import path from "node:path";

export const AUDIT_MAX = 2000;

export interface AuditEntry {
  at: string; // ISO timestamp
  actorId: number | null;
  actorName: string;
  actorRole: string;
  action: string; // e.g. "login", "order.status", "bom.deliver", "db.restore"
  entity: string; // e.g. "order", "operation", "user", "system"
  entityId?: string;
  detail?: string;
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "audit-log.json");
}

function readAll(): AuditEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries as AuditEntry[];
  } catch {
    /* first run */
  }
  return [];
}

function writeAll(entries: AuditEntry[]): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: entries.slice(-AUDIT_MAX) }, null, 2), "utf8");
}

export interface AuditActor {
  id?: number | null;
  name?: string | null;
  role?: string | null;
}

/** Append one audit entry (never throws). */
export function logAudit(
  actor: AuditActor | null,
  action: string,
  entity: string,
  detail?: string,
  entityId?: string | number,
): void {
  try {
    const entries = readAll();
    entries.push({
      at: new Date().toISOString(),
      actorId: actor?.id ?? null,
      actorName: actor?.name || "Unknown",
      actorRole: actor?.role || "—",
      action,
      entity,
      entityId: entityId != null ? String(entityId) : undefined,
      detail: detail ? String(detail).slice(0, 300) : undefined,
    });
    writeAll(entries);
  } catch {
    /* auditing must never break the action */
  }
}

/** Newest-first read with optional substring filter on action/detail/entity. */
export function readAudit(opts?: { limit?: number; q?: string }): AuditEntry[] {
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(opts?.limit) || 300)));
  const q = (opts?.q || "").trim().toLowerCase();
  const entries = readAll().reverse();
  const filtered = q
    ? entries.filter((e) =>
        [e.action, e.detail, e.entity, e.actorName, e.entityId]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : entries;
  return filtered.slice(0, limit);
}

/** Drop the whole trail (Manager "Clear log"). */
export function clearAudit(): void {
  try {
    writeAll([]);
  } catch {
    /* ignore */
  }
}
