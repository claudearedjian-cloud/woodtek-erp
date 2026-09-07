import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is missing from .env");
  process.exit(2);
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();

  const result = await client.query(
    "select current_database() as database, current_user as username"
  );

  const row = result.rows[0];

  console.log(
    `Connected: database=${row.database} user=${row.username}`
  );
} catch (error) {
  console.error("Database connection failed:");
  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
