import { db } from "@/db";
import { orders } from "@/db/schema";
import { like } from "drizzle-orm";

// ============================================================================
// Sequential order numbers: PO-0001/2026.
// The counter is scoped to the calendar year, so the first order created in a
// new year automatically restarts at 0001 (no PO-… numbers exist for that
// year yet). Numbers already issued are never reused or renumbered.
// ============================================================================

export async function nextOrderNumber(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();
  const rows = await db
    .select({ n: orders.orderNumber })
    .from(orders)
    .where(like(orders.orderNumber, `PO-%/${year}`));

  const pattern = new RegExp(`^PO-(\\d+)/${year}$`);
  let max = 0;
  for (const r of rows) {
    const m = pattern.exec(r.n ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PO-${String(max + 1).padStart(4, "0")}/${year}`;
}
