// ============================================================================
// Daily digest (morning brief) — pure, client-safe formatting helpers.
// /api/digest gathers the data (orders, materials reception, machines);
// this lib turns it into display/PDF-ready lines. Kept free of node/db
// imports so render-test can verify it.
// ============================================================================

export interface DigestOrderRow {
  id: number;
  orderNumber: string;
  title?: string | null;
  customerCompany?: string | null;
  dueDate?: string | null;
  status?: string | null;
  daysLate?: number;
}

export interface DigestMaterialRow {
  orderId: number;
  orderNumber: string;
  title?: string | null;
  state: string; // "Not Received" | "Declined"
}

export interface DigestWarehouseRow {
  orderId: number;
  orderNumber: string;
  title?: string | null;
  pending: number;
  total: number;
}

export interface DigestMachineRow {
  code?: string | null;
  name?: string | null;
  reason: string;
  minutes: number;
}

export interface DigestServiceRow {
  assetTag: string;
  name?: string | null;
  interval: number;
  pastBy: number;
}

export interface DigestStockRow {
  name?: string | null;
  qty: number;
  unit?: string | null;
  reorderLevel: number;
}

export interface DigestData {
  date: string;
  overdue: DigestOrderRow[];
  dueSoon: DigestOrderRow[];
  materials: DigestMaterialRow[];
  warehousePending: DigestWarehouseRow[];
  machinesDown: DigestMachineRow[];
  serviceDue: DigestServiceRow[];
  awaitingDelivery: DigestOrderRow[];
  lowStock: DigestStockRow[];
}

export const EMPTY_DIGEST: DigestData = {
  date: "",
  overdue: [],
  dueSoon: [],
  materials: [],
  warehousePending: [],
  machinesDown: [],
  serviceDue: [],
  awaitingDelivery: [],
  lowStock: [],
};

const shortOrder = (o: DigestOrderRow): string => {
  const bits = [o.orderNumber];
  if (o.title) bits.push(o.title);
  if (o.customerCompany) bits.push(o.customerCompany);
  if (typeof o.daysLate === "number") bits.push(`${o.daysLate}d late`);
  return bits.join(" · ");
};

/**
 * Flat text lines for the printed digest. Section headers do NOT start with
 * a space; detail lines are indented with two spaces (the PDF renderer uses
 * this to pick style).
 */
export function digestToLines(d: DigestData, maxPerSection = 8): string[] {
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    lines.push(items.length ? `${title} (${items.length})` : `${title}: none`);
    for (const it of items.slice(0, maxPerSection)) lines.push(`  ${it}`);
    if (items.length > maxPerSection) lines.push(`  …and ${items.length - maxPerSection} more`);
  };

  section("OVERDUE ORDERS", d.overdue.map(shortOrder));
  section("DUE WITHIN 7 DAYS", d.dueSoon.map(shortOrder));
  section(
    "MATERIALS FLAGGED BY THE FLOOR",
    d.materials.map((m) => `${m.orderNumber} · ${m.title ?? ""} — ${m.state}`.replace(" ·  — ", " — ")),
  );
  section(
    "WAREHOUSE LINES NOT FULLY SENT",
    d.warehousePending.map((w) => `${w.orderNumber} · ${w.title ?? ""} — ${w.pending}/${w.total} line(s) open`),
  );
  section(
    "MACHINES DOWN RIGHT NOW",
    d.machinesDown.map((m) => `${m.code ?? "?"} ${m.name ?? ""} — ${m.reason} · down ${Math.floor(m.minutes / 60)}h ${m.minutes % 60}m`.replace(/\s+/g, " ")),
  );
  section(
    "SERVICE OVERDUE (CMMS)",
    d.serviceDue.map((s) => `${s.assetTag} ${s.name ?? ""} — ${s.pastBy}h past its ${s.interval}h interval`.replace(/\s+/g, " ")),
  );
  section("COMPLETED, AWAITING DELIVERY", d.awaitingDelivery.map(shortOrder));
  section(
    "LOW STOCK",
    d.lowStock.map((s) => `${s.name ?? "Item"} — ${s.qty}${s.unit ? ` ${s.unit}` : ""} left (reorder at ${s.reorderLevel})`),
  );
  return lines;
}

export function digestSectionCount(d: DigestData, key: keyof Omit<DigestData, "date">): number {
  return (d[key] as unknown[]).length;
}

export function digestTotalIssues(d: DigestData): number {
  return (
    d.overdue.length +
    d.materials.length +
    d.machinesDown.length +
    d.serviceDue.length +
    d.lowStock.length
  );
}
