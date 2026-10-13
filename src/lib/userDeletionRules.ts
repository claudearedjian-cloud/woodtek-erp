// src/lib/userDeletionRules.ts
// ============================================================================
// DELETING A USER ACCOUNT — the policy, in pure code (no database imports, so
// the SSR test harness can check it and the browser could read it too).
//
// A user row is referenced from all over the database (orders, operations,
// machines, reports, invoices, HR…). The base tables were created with plain
// `references users(id)` — NO ACTION on delete — so a bare DELETE dies on the
// first foreign key that still points at the person and the Manager only sees
// the raw Postgres error:
//     Failed query: delete from "users" where "users"."id" = $1
//
// The live foreign keys are read from the database catalog at run time (so a
// table added tomorrow is covered automatically) and each reference is sorted
// into one of three buckets by these rules:
//
//   RELEASE  the reference is only history/ownership — clear it to NULL and
//            delete the account (the machine step, the order or the client
//            stays, it just stops naming the deleted person).
//   REMOVED  the database itself cascades the row (employee card, attendance,
//            shift plan…) — it disappears with the account, and the Manager is
//            told exactly how many rows that means before confirming.
//   KEPT     the database itself clears just the reference (invoices, payroll
//            payslips, leave history) — the document survives.
//
// Anything the rules do not explicitly release is a BLOCKER: the delete is
// refused with a list of what to fix first (a machine with an assigned
// operator, a step that is Ready / In Progress / Paused). Better an honest
// "reassign it first" than silently unassigning a running machine.
// ============================================================================

/** Postgres `confdeltype` values, mapped to what the delete would do. */
export type RefDeleteAction = "release" | "removed" | "kept" | "block";

/** One foreign key in the live schema that points at users(id). */
export interface UserReference {
  table: string;
  column: string;
  /** null = "count could not be read" — treated as "cannot prove it is empty". */
  rows: number | null;
  /** true when the column accepts NULL (so RELEASE is possible). */
  nullable: boolean;
  /** Postgres ON DELETE action for this constraint. */
  onDelete: "no action" | "restrict" | "cascade" | "set null" | "set default" | "unknown";
}

/**
 * References we deliberately RELEASE (set to NULL) instead of blocking.
 * Historical or ownership pointers only — no operational meaning is lost.
 * Format: "<table>.<column>". Unlisted no-action references BLOCK, so a future
 * table can never be silently gutted by this cleaner.
 */
export const RELEASABLE_REFERENCES: readonly string[] = [
  "orders.created_by_id",          // who typed the order in — history
  "orders.assigned_sales_id",      // order still exists, just no owner
  "customers.assigned_sales_id",   // client returns to the shared pool
  "maintenance_logs.performed_by_id",
  "reports.generated_by",
  "material_consumptions.consumed_by",
  "quality_events.recorded_by_id",
  "downtime_events.operator_id",
];

/** Plain-language name of a reference, for the Manager-facing messages. */
const REFERENCE_LABELS: Record<string, string> = {
  "orders.created_by_id": "order(s) they entered",
  "orders.assigned_sales_id": "order(s) assigned to them as sales rep",
  "customers.assigned_sales_id": "client file(s) they own (the client goes back to the shared pool)",
  "maintenance_logs.performed_by_id": "maintenance log entries (the machine history stays)",
  "reports.generated_by": "saved reports (the report stays)",
  "material_consumptions.consumed_by": "material consumption records (the stock movement stays)",
  "quality_events.recorded_by_id": "scrap/rework log entries (they stay)",
  "downtime_events.operator_id": "machine downtime entries (they stay)",
  "machines.assigned_operator_id": "machine(s) they operate",
  "order_operations.operator_id": "station step(s) they operate",
};

export function referenceLabel(ref: Pick<UserReference, "table" | "column">): string {
  const key = `${ref.table}.${ref.column}`;
  if (REFERENCE_LABELS[key]) return REFERENCE_LABELS[key];
  return `${ref.table.replace(/_/g, " ")} records`;
}

/**
 * What must happen to one reference before the account can go.
 * `rows === null` (count unknown) is treated as "assume it is in use" so the
 * delete can never slip through on a failed count query.
 */
export function refAction(ref: UserReference): RefDeleteAction {
  if (ref.onDelete === "set null" || ref.onDelete === "set default") return "kept";
  if (ref.onDelete === "cascade") return "removed";
  // no action / restrict / unknown — only our explicit list may be released.
  if (RELEASABLE_REFERENCES.includes(`${ref.table}.${ref.column}`) && ref.nullable) return "release";
  return "block";
}

/** True when this reference has rows we have to deal with. */
export function refHasRows(ref: UserReference): boolean {
  return ref.rows === null || ref.rows > 0;
}

/** An "is this person actually on a step right now?" status. */
export const ACTIVE_OPERATION_STATUSES: readonly string[] = ["Ready", "In Progress", "Paused"];

export function isActiveOperationStatus(status: string | null | undefined): boolean {
  return ACTIVE_OPERATION_STATUSES.includes(String(status ?? ""));
}

/**
 * Managers may not delete themselves or the last way back in. Either mistake
 * locks the factory out of its own ERP, so both are refused with a sentence
 * that says what to do instead.
 */
export function selfDeleteMessage(): string {
  return "You are signed in with this account — sign in as another Manager to delete it.";
}

export function lastManagerMessage(): string {
  return "This is the last active Manager sign-in. Add or activate another Manager account first, so somebody can always get in.";
}

/**
 * Postgres errors are unreadable ("Failed query: delete from "users"…"). Only
 * recognise the shapes we know; leave everything else untouched rather than
 * inventing an explanation.
 */
export function explainUserDeleteError(message: string | null | undefined): string {
  const text = String(message ?? "");
  if (/foreign key|violates foreign key constraint/i.test(text)) {
    return "This account still has records pointing at it. Reopen the delete dialog — it now lists exactly what to fix.";
  }
  if (/duplicate key/i.test(text)) return "A record with this email already exists.";
  return text;
}
