"use strict";
// ============================================================================
// Audit log — append-only trail of who did what. SERVER ONLY.
// Stored as a JSON overlay (data/audit-log.json, same no-migration pattern),
// capped to the newest AUDIT_MAX entries so the file can never grow forever.
// Never throws into the caller: a logging failure must not break the action.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIT_MAX = void 0;
exports.logAudit = logAudit;
exports.readAudit = readAudit;
exports.clearAudit = clearAudit;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.AUDIT_MAX = 2000;
function fileLocation() {
    const dir = process.env.WOODTEK_DATA_DIR || node_path_1.default.join(process.cwd(), "data");
    return node_path_1.default.join(dir, "audit-log.json");
}
function readAll() {
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(fileLocation(), "utf8"));
        if (parsed && Array.isArray(parsed.entries))
            return parsed.entries;
    }
    catch {
        /* first run */
    }
    return [];
}
function writeAll(entries) {
    const file = fileLocation();
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file, JSON.stringify({ version: 1, entries: entries.slice(-exports.AUDIT_MAX) }, null, 2), "utf8");
}
/** Append one audit entry (never throws). */
function logAudit(actor, action, entity, detail, entityId) {
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
    }
    catch {
        /* auditing must never break the action */
    }
}
/** Newest-first read with optional substring filter on action/detail/entity. */
function readAudit(opts) {
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(opts?.limit) || 300)));
    const q = (opts?.q || "").trim().toLowerCase();
    const entries = readAll().reverse();
    const filtered = q
        ? entries.filter((e) => [e.action, e.detail, e.entity, e.actorName, e.entityId]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)))
        : entries;
    return filtered.slice(0, limit);
}
/** Drop the whole trail (Manager "Clear log"). */
function clearAudit() {
    try {
        writeAll([]);
    }
    catch {
        /* ignore */
    }
}
