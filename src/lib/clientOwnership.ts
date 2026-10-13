// src/lib/clientOwnership.ts
// ============================================================================
// WHO MAY USE A CLIENT FILE — the single rule book for the client book.
//
// The rule is expressed twice on purpose, because a list needs SQL and a
// single record needs a predicate:
//   • list queries   → SQL scope in src/lib/dataAccess.ts
//                      (allowedCustomerIdsSubquery)
//   • single records → canUseClient() below (customer file GET/PATCH, the
//                      per-client ledger, the "can I issue an order for this
//                      client?" check in POST /api/orders)
//
// The rule (since 2026-10-13):
//   Manager            → every client.
//   Sales Coordinator  → the clients assigned to them, PLUS the shared pool of
//                        clients nobody owns yet (assigned_sales_id IS NULL —
//                        which is every client created before assignment was
//                        introduced). A client handed to ANOTHER rep stays
//                        private to that rep.
//   Everyone else      → no client access.
//
// Before this rule existed the sales scope was `assigned_sales_id = me` only,
// so a brand-new Sales Coordinator opened the New Order wizard to an empty
// client list: every client in the factory was owned by nobody, and nobody
// could be handed one (there was no picker either).
//
// Pure module: no database, no node-only imports, so the browser can use it
// too (the client file shows/hides the assignment picker with it).
// ============================================================================

import { baseRoleOf } from "@/lib/permissions";

/** Wording used in the client file when nobody owns the account. */
export const SHARED_CLIENT_LABEL = "Shared — not assigned";

export type ClientViewer = { id: number; role?: string | null } | null | undefined;

export type ClientOwnerRow =
  | { assignedSalesId?: number | string | null; assignedSalesName?: string | null }
  | null
  | undefined;

/** Built-in role behind a (possibly custom) role name. */
export function viewerBaseRole(user: ClientViewer): string {
  return baseRoleOf(user?.role ?? "");
}

export function isManagerViewer(user: ClientViewer): boolean {
  return viewerBaseRole(user) === "Manager";
}

export function isSalesCoordinatorViewer(user: ClientViewer): boolean {
  return viewerBaseRole(user) === "Sales Coordinator";
}

/**
 * Normalises the owner column: undefined / "" / 0 / a non-numeric value all
 * mean "nobody has claimed this client yet". Hand-edited rows must never be
 * able to hide a client from everyone or hand it to a phantom user.
 */
export function ownerIdOf(client: ClientOwnerRow): number | null {
  const raw = client?.assignedSalesId;
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** True while the account sits in the shared pool every sales rep can work. */
export function isSharedClient(client: ClientOwnerRow): boolean {
  return ownerIdOf(client) === null;
}

/** Managers own the whole book. */
export function seesEveryClient(user: ClientViewer): boolean {
  return isManagerViewer(user);
}

/**
 * Can this user read/edit this client?
 * Mirrors allowedCustomerIdsSubquery() in dataAccess.ts exactly.
 */
export function canUseClient(user: ClientViewer, client: ClientOwnerRow): boolean {
  if (!user) return false;
  const base = viewerBaseRole(user);
  if (base === "Manager") return true;
  if (base !== "Sales Coordinator") return false;
  const owner = ownerIdOf(client);
  return owner === null || owner === Number(user.id);
}

/** Roles that may be handed a client file (used by the assignment picker). */
export function canOwnClients(role: string | null | undefined): boolean {
  const base = baseRoleOf(role ?? "");
  return base === "Manager" || base === "Sales Coordinator";
}

/**
 * Staff list for the "Assigned sales rep" picker: built-in and custom roles
 * that can own clients, sorted by name.
 */
export function salesRepOptions<T extends { id: number; name?: string; role?: string | null }>(
  users: T[] | null | undefined,
): T[] {
  return [...(users ?? [])]
    .filter((u) => canOwnClients(u?.role))
    .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
}

/** Name of the rep who owns the client, or the shared-pool wording. */
export function assignedRepLabel(
  client: ClientOwnerRow,
  users: Array<{ id: number; name?: string | null }> = [],
): string {
  const owner = ownerIdOf(client);
  if (owner === null) return SHARED_CLIENT_LABEL;
  const match = users.find((u) => Number(u?.id) === owner);
  const name = String(client?.assignedSalesName ?? match?.name ?? "").trim();
  return name || `User #${owner}`;
}
