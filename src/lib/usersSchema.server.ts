// Additive users-table migration for existing PCs. The installer creates the
// same column for a fresh PC (installer/schema.sql). Every reader of
// users.can_login runs through here first — getSessionUser (all authed
// routes), the public roster and the login POST — so an old database grows
// the column before the first query that needs it. One advisory lock keeps
// simultaneous first requests race-safe; the in-memory flag makes later
// calls free.
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

export async function ensureUsersLoginColumn(): Promise<void> {
  if (ready) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221909)`);
    await tx.execute(sql`
      alter table users
        add column if not exists can_login boolean not null default true
    `);
  });
  ready = true;
}
