// src/lib/userDeletion.server.ts
// ============================================================================
// DELETING A USER ACCOUNT — the one code path every Delete button goes
// through (Settings → Users, and HR → delete a no-login employee).
//
// Why this module exists: the tables point at users(id) with plain
// `references users(id)` (NO ACTION), so `delete from "users" where id = $1`
// died on the first foreign key that still referenced the person and the
// Manager only saw:
//     Failed query: delete from "users" where "users"."id" = $1 params: 8
//
// The live foreign keys are read from the Postgres catalog (a table added in
// a future version is covered automatically) and sorted by the pure rules in
// src/lib/userDeletionRules.ts into RELEASE / REMOVED / KEPT / BLOCK.
//
//   previewUserDeletion() → the Manager-facing "will also…" list + blockers
//   deleteUserAccount()   → re-checks, releases, deletes, audits — all in one
//                           transaction, so a surprise foreign key rolls the
//                           whole thing back instead of half-deleting somebody
//
// Everything the cleaner touches is named in the audit trail.
// ============================================================================

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { logAudit, type AuditActor } from "@/lib/audit.server";
import { baseRoleOf } from "@/lib/permissions";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";
import {
  explainUserDeleteError,
  lastManagerMessage,
  refAction,
  refHasRows,
  referenceLabel,
  selfDeleteMessage,
  type UserReference,
} from "@/lib/userDeletionRules";

export { explainUserDeleteError };

export class UserDeleteError extends Error {
  status: number;
  blockers: string[];
  constructor(message: string, status = 400, blockers: string[] = []) {
    super(message);
    this.name = "UserDeleteError";
    this.status = status;
    this.blockers = blockers;
  }
}

export interface UserDeletePreview {
  user: { id: number; name: string; role: string; active: boolean; canLogin: boolean } | null;
  /** Reasons the account cannot be deleted until somebody fixes them. */
  blockers: string[];
  /** "This will also…" lines shown in the confirmation. */
  notes: string[];
}

interface ReleaseStep {
  reference: UserReference;
  rows: number;
}

interface DeletionPlan {
  user: { id: number; name: string; role: string; active: boolean; canLogin: boolean };
  blockers: string[];
  releases: ReleaseStep[];
  removed: string[];
  kept: string[];
  notes: string[];
}

// --------------------------------------------------------------- identifiers

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Table/column names come from the Postgres catalog, never from a request —
 * but they are still validated and quoted before being interpolated into the
 * cleanup statements, so a hand-renamed table can never break the query.
 */
function safeIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new UserDeleteError(
      "Internal: unexpected table or column name while cleaning up this account.",
      500,
    );
  }
  return `"${value}"`;
}

// ------------------------------------------------------------------ catalog

function deleteActionOf(code: string): UserReference["onDelete"] {
  switch (code) {
    case "c": return "cascade";
    case "n": return "set null";
    case "d": return "set default";
    case "r": return "restrict";
    case "a": return "no action";
    default: return "unknown";
  }
}

/** Every single-column foreign key in the live database pointing at users(id). */
async function loadUserReferences(): Promise<UserReference[]> {
  const result = (await db.execute(sql`
    select c.relname as table_name,
           a.attname as column_name,
           con.confdeltype as delete_action,
           (not a.attnotnull) as nullable
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = coalesce(to_regclass('users'), to_regclass('public.users'), 0)
      and n.nspname = 'public'
      and array_length(con.conkey, 1) = 1
  `)) as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  return rows.map((row) => ({
    table: String(row.table_name),
    column: String(row.column_name),
    rows: 0,
    nullable: row.nullable === true || row.nullable === "t",
    onDelete: deleteActionOf(String(row.delete_action)),
  }));
}

/** How many live rows point at this user through that reference. */
async function countReferenceRows(ref: UserReference, userId: number): Promise<number | null> {
  try {
    const result = (await db.execute(sql`
      select count(*)::int as n
      from ${sql.raw(safeIdentifier(ref.table))}
      where ${sql.raw(safeIdentifier(ref.column))} = ${userId}
    `)) as { rows?: Array<{ n: unknown }> } | Array<{ n: unknown }>;
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    const value = Number(rows[0]?.n);
    return Number.isFinite(value) ? value : null;
  } catch {
    // A failed count must never look like "nothing points here".
    return null;
  }
}

// ------------------------------------------------------------------- planning

async function loadTargetUser(userId: number) {
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      active: users.active,
      canLogin: users.canLogin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new UserDeleteError("That user no longer exists.", 404);
  return target;
}

/** True when another active login Manager exists besides `excludeId`. */
export async function anotherLoginManagerExists(excludeId: number): Promise<boolean> {
  ensureRolesRegistered();
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.active, true), eq(users.canLogin, true)));
  return rows.some(
    (row) => row.id !== excludeId && (baseRoleOf(row.role) || row.role) === "Manager",
  );
}

async function blockOnAssignedMachines(userId: number): Promise<string[]> {
  const result = (await db.execute(sql`
    select code, name from ${sql.raw(safeIdentifier("machines"))}
    where ${sql.raw(safeIdentifier("assigned_operator_id"))} = ${userId}
    order by code
  `)) as { rows?: Array<{ code: unknown; name: unknown }> } | Array<{ code: unknown; name: unknown }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  if (rows.length === 0) return [];
  const names = rows.slice(0, 6).map((row) => String(row.code ?? row.name ?? "")).filter(Boolean);
  const more = rows.length > names.length ? ` +${rows.length - names.length} more` : "";
  return [
    `Assigned operator of machine(s) ${names.join(", ")}${more}. Reassign those machines (Machines → Assigned operator) or pick another operator first.`,
  ];
}

async function blockOnActiveOperations(userId: number): Promise<string[]> {
  const result = (await db.execute(sql`
    select operation_name, status from ${sql.raw(safeIdentifier("order_operations"))}
    where ${sql.raw(safeIdentifier("operator_id"))} = ${userId}
      and status in ('Ready', 'In Progress', 'Paused')
    order by id
  `)) as { rows?: Array<{ operation_name: unknown; status: unknown }> } | Array<{ operation_name: unknown; status: unknown }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  if (rows.length === 0) return [];
  const names = rows.slice(0, 4).map((row) => `“${String(row.operation_name)}” (${String(row.status)})`);
  const more = rows.length > names.length ? ` +${rows.length - names.length} more` : "";
  return [
    `Operator on step(s) ${names.join(", ")}${more}. Finish, reassign or reject those station steps first so the shop floor is not left holding a job nobody owns.`,
  ];
}

async function planUserDeletion(userId: number, actorId: number): Promise<DeletionPlan> {
  const target = await loadTargetUser(userId);
  const blockers: string[] = [];

  if (userId === actorId) blockers.push(selfDeleteMessage());
  if (
    target.active &&
    target.canLogin &&
    (baseRoleOf(target.role) || target.role) === "Manager" &&
    !(await anotherLoginManagerExists(userId))
  ) {
    blockers.push(lastManagerMessage());
  }

  // Operational assignments that must not be silently released.
  if (target.canLogin) {
    blockers.push(...(await blockOnAssignedMachines(userId)));
    blockers.push(...(await blockOnActiveOperations(userId)));
  }

  const references = await loadUserReferences();
  const releases: ReleaseStep[] = [];
  const removed: string[] = [];
  const kept: string[] = [];

  for (const reference of references) {
    // Handled explicitly above with a message that names the machine/step.
    if (
      target.canLogin &&
      reference.table === "machines" &&
      reference.column === "assigned_operator_id"
    ) {
      continue;
    }
    if (
      target.canLogin &&
      reference.table === "order_operations" &&
      reference.column === "operator_id"
    ) {
      // Everything left here is historical (no Ready / In Progress / Paused
      // row survived the check above), so it is released like an order author.
      const rows = await countReferenceRows(reference, userId);
      if (refHasRows({ ...reference, rows })) {
        releases.push({ reference, rows: rows ?? 0 });
      }
      continue;
    }

    const rows = await countReferenceRows(reference, userId);
    const withRows = { ...reference, rows };
    if (!refHasRows(withRows)) continue;

    switch (refAction(withRows)) {
      case "release":
        releases.push({ reference, rows: rows ?? 0 });
        break;
      case "removed":
        removed.push(`${referenceLabel(reference)} (${rows ?? "?"})`);
        break;
      case "kept":
        kept.push(`${referenceLabel(reference)} (${rows ?? "?"})`);
        break;
      default:
        blockers.push(
          `${referenceLabel(reference)} (${rows ?? "some records"}) still point at this account.`,
        );
    }
  }

  const notes: string[] = [];
  if (releases.length > 0) {
    notes.push(
      `cleared pointers: ${releases
        .map((step) => `${referenceLabel(step.reference)} (${step.rows})`)
        .join(", ")}`,
    );
  }
  if (removed.length > 0) notes.push(`removed with the account: ${removed.join(", ")}`);
  if (kept.length > 0) notes.push(`kept, only the author reference is cleared: ${kept.join(", ")}`);

  return { user: target, blockers, releases, removed, kept, notes };
}

// --------------------------------------------------------------- public API

/** Read-only: what would happen if this account were deleted right now. */
export async function previewUserDeletion(
  userId: number,
  actorId: number,
): Promise<UserDeletePreview> {
  const plan = await planUserDeletion(userId, actorId);
  return { user: plan.user, blockers: plan.blockers, notes: plan.notes };
}

/**
 * Deletes the account after releasing the pointers that only reference it.
 * Refuses (with the full reason list) while something operational still holds
 * the person. One transaction: releases + delete together, or nothing.
 */
export async function deleteUserAccount(
  userId: number,
  actor: AuditActor,
): Promise<{ id: number; name: string; role: string; notes: string[] }> {
  const plan = await planUserDeletion(userId, Number(actor?.id ?? 0));
  if (plan.blockers.length > 0) {
    logAudit(
      actor,
      "user.delete.blocked",
      "user",
      `${plan.user.name} was not deleted: ${plan.blockers.join(" ")}`,
      userId,
    );
    throw new UserDeleteError("This account cannot be deleted yet.", 400, plan.blockers);
  }

  try {
    await db.transaction(async (tx) => {
      for (const step of plan.releases) {
        await tx.execute(sql`
          update ${sql.raw(safeIdentifier(step.reference.table))}
          set ${sql.raw(safeIdentifier(step.reference.column))} = null
          where ${sql.raw(safeIdentifier(step.reference.column))} = ${userId}
        `);
      }
      await tx.delete(users).where(eq(users.id, userId));
    });
  } catch (error) {
    if (error instanceof UserDeleteError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logAudit(actor, "user.delete.blocked", "user", `${plan.user.name} was not deleted: ${message}`, userId);
    throw new UserDeleteError(explainUserDeleteError(message), 409, [
      "The database still holds records that point at this account. Nothing was deleted — try again from the delete dialog, which lists what to fix.",
    ]);
  }

  const detail = [
    `Deleted ${plan.user.name} (${plan.user.role})`,
    ...plan.notes,
  ].join(" — ");
  logAudit(actor, "user.delete", "user", detail, userId);

  return { id: plan.user.id, name: plan.user.name, role: plan.user.role, notes: plan.notes };
}
