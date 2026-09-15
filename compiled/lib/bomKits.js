"use strict";
// ============================================================================
// BOM kits — reusable materials lists (like routing recipes, but for the
// BOM). Pure, client-safe. Storage lives in data/bom-kits.json via
// /api/bom-kits ({version:1, kits:[{name, items:[{itemId, qty}]}]}).
// Also hosts the order-entry stock check (#4): aggregating requested
// quantities per item and comparing with stock BEFORE the order exists.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_KITS = exports.KIT_NAME_MAX = void 0;
exports.sanitizeKitName = sanitizeKitName;
exports.sanitizeKitList = sanitizeKitList;
exports.findKit = findKit;
exports.mergeBomKit = mergeBomKit;
exports.stockShortfall = stockShortfall;
exports.KIT_NAME_MAX = 40;
exports.MAX_KITS = 50;
/** Clamp a kit name the same way everywhere (UI, storage). */
function sanitizeKitName(raw) {
    return String(raw ?? "")
        .trim()
        .slice(0, exports.KIT_NAME_MAX);
}
/**
 * Sanitize a whole kits array (server-side PUT body or file read):
 * valid names, positive integer quantities, duplicate itemIds merged,
 * item count capped at 60 per kit.
 */
function sanitizeKitList(raw) {
    if (!Array.isArray(raw))
        return [];
    const seenNames = new Set();
    const kits = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object")
            continue;
        const e = entry;
        const name = sanitizeKitName(e.name);
        if (!name || seenNames.has(name.toLowerCase()))
            continue;
        const itemsMap = new Map();
        if (Array.isArray(e.items)) {
            for (const it of e.items) {
                if (!it || typeof it !== "object")
                    continue;
                const itemId = Math.floor(Number(it.itemId));
                const qty = Math.floor(Number(it.qty));
                if (!Number.isFinite(itemId) || itemId <= 0)
                    continue;
                if (!Number.isFinite(qty) || qty <= 0)
                    continue;
                itemsMap.set(itemId, Math.min(1000000, (itemsMap.get(itemId) ?? 0) + qty));
            }
        }
        seenNames.add(name.toLowerCase());
        kits.push({
            name,
            items: [...itemsMap.entries()].slice(0, 60).map(([itemId, qty]) => ({ itemId, qty })),
            ...(typeof e.updatedAt === "string" ? { updatedAt: e.updatedAt } : {}),
        });
        if (kits.length >= exports.MAX_KITS)
            break;
    }
    return kits;
}
/** Find an existing kit ignoring case (kit names behave case-insensitively). */
function findKit(kits, name) {
    const needle = sanitizeKitName(name).toLowerCase();
    return kits.find((k) => k.name.toLowerCase() === needle);
}
/**
 * Append a kit onto the wizard's current BOM draft: duplicate items merge by
 * summing quantities (never silently overwrite what the user already typed).
 * Unknown item ids are kept — the select simply shows "Select item…".
 */
function mergeBomKit(current, kit) {
    const merged = current.map((l) => ({ ...l }));
    for (const item of kit.items) {
        const key = String(item.itemId);
        const existing = merged.find((l) => l.itemId === key);
        if (existing) {
            const n = Math.max(0, Math.floor(Number(existing.qty) || 0)) + item.qty;
            existing.qty = String(n);
        }
        else {
            merged.push({ itemId: key, qty: String(item.qty) });
        }
    }
    return merged;
}
/**
 * Order-entry stock check: aggregate the requested qty per item across ALL
 * draft lines, then compare with stock. Returns only the SHORT lines,
 * biggest gap first. Items with unknown stock (deleted?) are skipped.
 */
function stockShortfall(lines, itemsById) {
    const needed = new Map();
    for (const l of lines) {
        const id = Math.floor(Number(l.itemId));
        const qty = Math.floor(Number(l.qty));
        if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(qty) || qty <= 0)
            continue;
        needed.set(id, (needed.get(id) ?? 0) + qty);
    }
    const out = [];
    for (const [id, qty] of needed) {
        const item = itemsById.get(id);
        if (!item)
            continue; // unknown item — the API will reject at creation
        const stock = Math.max(0, Math.floor(Number(item.stockQuantity) || 0));
        if (qty > stock) {
            out.push({
                itemId: id,
                name: String(item.name ?? `Item #${id}`),
                needed: qty,
                stock,
                missing: qty - stock,
                unit: String(item.unit ?? ""),
            });
        }
    }
    return out.sort((a, b) => b.missing - a.missing);
}
