"use strict";
// ============================================================================
// Daily digest (morning brief) — pure, client-safe formatting helpers.
// /api/digest gathers the data (orders, materials reception, machines);
// this lib turns it into display/PDF-ready lines. Kept free of node/db
// imports so render-test can verify it.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_DIGEST = void 0;
exports.digestToLines = digestToLines;
exports.digestSectionCount = digestSectionCount;
exports.digestTotalIssues = digestTotalIssues;
exports.EMPTY_DIGEST = {
    date: "",
    overdue: [],
    staleQuotes: [],
    dueSoon: [],
    materials: [],
    warehousePending: [],
    machinesDown: [],
    serviceDue: [],
    awaitingDelivery: [],
    lowStock: [],
};
const shortOrder = (o) => {
    const bits = [o.orderNumber];
    if (o.title)
        bits.push(o.title);
    if (o.customerCompany)
        bits.push(o.customerCompany);
    if (typeof o.daysLate === "number")
        bits.push(`${o.daysLate}d late`);
    return bits.join(" · ");
};
/**
 * Flat text lines for the printed digest. Section headers do NOT start with
 * a space; detail lines are indented with two spaces (the PDF renderer uses
 * this to pick style).
 */
function digestToLines(d, maxPerSection = 8) {
    const lines = [];
    const section = (title, items) => {
        lines.push(items.length ? `${title} (${items.length})` : `${title}: none`);
        for (const it of items.slice(0, maxPerSection))
            lines.push(`  ${it}`);
        if (items.length > maxPerSection)
            lines.push(`  …and ${items.length - maxPerSection} more`);
    };
    section("OVERDUE ORDERS", d.overdue.map(shortOrder));
    section("STALE QUOTES - FOLLOW UP", d.staleQuotes.map((q) => `${q.orderNumber} ${q.customerCompany ?? ""} ${q.title ?? ""} - quote is ${q.daysOld} days old`.replace(/\s+/g, " ")));
    section("DUE WITHIN 7 DAYS", d.dueSoon.map(shortOrder));
    section("MATERIALS FLAGGED BY THE FLOOR", d.materials.map((m) => `${m.orderNumber} · ${m.title ?? ""} — ${m.state}`.replace(" ·  — ", " — ")));
    section("WAREHOUSE LINES NOT FULLY SENT", d.warehousePending.map((w) => `${w.orderNumber} · ${w.title ?? ""} — ${w.pending}/${w.total} line(s) open`));
    section("MACHINES DOWN RIGHT NOW", d.machinesDown.map((m) => `${m.code ?? "?"} ${m.name ?? ""} — ${m.reason} · down ${Math.floor(m.minutes / 60)}h ${m.minutes % 60}m`.replace(/\s+/g, " ")));
    section("SERVICE OVERDUE (CMMS)", d.serviceDue.map((s) => `${s.assetTag} ${s.name ?? ""} — ${s.pastBy}h past its ${s.interval}h interval`.replace(/\s+/g, " ")));
    section("COMPLETED, AWAITING DELIVERY", d.awaitingDelivery.map(shortOrder));
    section("LOW STOCK", d.lowStock.map((s) => `${s.name ?? "Item"} — ${s.qty}${s.unit ? ` ${s.unit}` : ""} left (reorder at ${s.reorderLevel})`));
    return lines;
}
function digestSectionCount(d, key) {
    return d[key].length;
}
function digestTotalIssues(d) {
    return (d.overdue.length +
        d.staleQuotes.length +
        d.materials.length +
        d.machinesDown.length +
        d.serviceDue.length +
        d.lowStock.length);
}
