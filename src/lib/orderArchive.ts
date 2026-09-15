// ============================================================================
// Order archive — hide finished/cancelled orders from the Orders tab without
// deleting them. Pure helpers; storage lives in data/order-archive.json
// (a list of order IDs — no DB migration).
// ============================================================================

export const MAX_ARCHIVED_ORDERS = 5000;

/** Keep only valid, positive, unique order IDs, sorted ascending, capped. */
export function sanitizeArchivedIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const value of raw) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && id <= Number.MAX_SAFE_INTEGER) seen.add(id);
  }
  return Array.from(seen)
    .sort((a, b) => a - b)
    .slice(0, MAX_ARCHIVED_ORDERS);
}

/** Replace `orderId`'s membership in the archived list. */
export function withArchived(ids: number[], orderId: number, archived: boolean): number[] {
  const set = new Set(ids);
  if (archived) set.add(orderId);
  else set.delete(orderId);
  return sanitizeArchivedIds(Array.from(set));
}
