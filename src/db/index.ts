import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// Fail fast instead of hanging for 2 minutes on a dead DB.
// These are conservative defaults; tune via env if needed.
const pool = globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({
  connectionString: databaseUrl,
  // Give up connecting after 5 seconds (default is 0 = forever)
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5000),
  // Return idle clients after 30s
  idleTimeoutMillis: 30_000,
  // Cap the pool so a runaway request burst can't open 100 sockets
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export { pool };
export const db = drizzle(pool);
