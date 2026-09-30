// ============================================================================
// Server side of the index plan (SERVER ONLY). Mirrors the inventory schema
// check & repair channel (bundle 40f): reads the live index names from the
// pg_indexes catalog, compares them with the pure plan in dbIndexes.ts and
// can create the missing ones with one idempotent statement each.
//
// Safety: statements are built ONLY from the hard-coded DB_INDEX_PLAN
// constants (no user input reaches them), each is CREATE INDEX IF NOT
// EXISTS (re-running is a no-op) and nothing here ever drops or alters an
// existing index, column or table.
// ============================================================================

import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  DB_INDEX_PLAN,
  createIndexSql,
  missingDbIndexes,
  type DbIndexDef,
} from "@/lib/dbIndexes";

export interface DbIndexCheckResult {
  /** Index names the live database currently has (public schema). */
  live: string[];
  /** Plan indexes the database is missing. */
  missing: DbIndexDef[];
  /** How many of the plan indexes already exist. */
  presentCount: number;
  planCount: number;
}

/** Live index names from the Postgres catalog (public schema only). */
export async function readLiveDbIndexes(): Promise<string[]> {
  const rows = await db.execute<{ indexname: string }>(
    sql`select indexname from pg_indexes where schemaname = 'public' order by indexname`,
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows?: Array<{ indexname: string }> }).rows ?? [];
  return list.map((r) => String(r.indexname ?? "")).filter(Boolean);
}

/** Compare the live database with the plan. Read-only. */
export async function checkDbIndexes(): Promise<DbIndexCheckResult> {
  const live = await readLiveDbIndexes();
  const missing = missingDbIndexes(live);
  return {
    live,
    missing,
    presentCount: DB_INDEX_PLAN.length - missing.length,
    planCount: DB_INDEX_PLAN.length,
  };
}

/**
 * Create every missing plan index (idempotent). Returns the statements that
 * actually created something — CREATE INDEX IF NOT EXISTS reports nothing,
 * so "created" = the ones that were missing before the run.
 */
export async function ensureDbIndexes(): Promise<{
  created: DbIndexDef[];
  live: string[];
  presentCount: number;
  planCount: number;
}> {
  const before = await readLiveDbIndexes();
  const missing = missingDbIndexes(before);
  if (missing.length > 0) {
    await db.transaction(async (tx) => {
      for (const def of missing) {
        // Identifier comes from the hard-coded plan, never from a request.
        await tx.execute(sql.raw(createIndexSql(def)));
      }
    });
  }
  const live = await readLiveDbIndexes();
  return {
    created: missing,
    live,
    presentCount: DB_INDEX_PLAN.length - missingDbIndexes(live).length,
    planCount: DB_INDEX_PLAN.length,
  };
}
