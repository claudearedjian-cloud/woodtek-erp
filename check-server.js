#!/usr/bin/env node
// ============================================================================
// WoodTek ERP - server check (check-server.js)
// ----------------------------------------------------------------------------
// READ-ONLY health check of an installed WoodTek ERP on THIS PC:
//   1. which folder it is checking (the folder it sits in)
//   2. the database name + address from .env (NEVER the password)
//   3. the PostgreSQL server version
//   4. row counts that prove the real factory data is present
//   5. /api/health on the running app
//
// Run it by double-clicking check-server.bat next to it (that one finds the
// right Node.js first, including the app's own runtime\node).
//
// It never writes, never changes anything.
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = __dirname;

function loadDotEnv(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// The application ships with its own Node.js dependencies inside the
// standalone bundle. On an installed PC there is no node_modules next to this
// script, so 'pg' has to be loaded from there - exactly like
// installer\bootstrap-db.cjs does.
function loadPg() {
  try {
    return require("pg");
  } catch {
    const candidate = path.join(ROOT, ".next", "standalone", "node_modules", "pg");
    return require(candidate);
  }
}

// Show the database address without ever printing the password.
function describeDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, "") || "(none)";
    const host = parsed.hostname || "localhost";
    const port = parsed.port || "5432";
    return db + " at " + host + ":" + port;
  } catch {
    return "(the .env value could not be read as a database address)";
  }
}

function getHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let build = null;
          try {
            build = JSON.parse(body).build || null;
          } catch {}
          resolve({ status: res.statusCode, build });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ status: 0, build: null, error: err.message });
    });
  });
}

async function main() {
  const line = (label, value) => {
    console.log("  " + label.padEnd(17) + ": " + value);
  };

  console.log("");
  console.log("WoodTek ERP - server check");
  console.log("  " + "-".repeat(58));
  line("Folder", ROOT);

  const env = loadDotEnv(path.join(ROOT, ".env"));
  const databaseUrl = env.DATABASE_URL || "";
  const port = Number(env.PORT || 3000);

  let problems = 0;

  if (!databaseUrl) {
    line("Database", "no DATABASE_URL found in " + path.join(ROOT, ".env"));
    problems += 1;
  } else {
    line("Database", describeDatabaseUrl(databaseUrl));

    let pg = null;
    try {
      pg = loadPg();
    } catch {
      line("pg driver", "not found - expected .next\\standalone\\node_modules\\pg");
      problems += 1;
    }

    if (pg) {
      const client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
      });
      try {
        await client.connect();
        const version = await client.query("SHOW server_version");
        line("PostgreSQL", version.rows[0].server_version);

        const tables = ["users", "machines", "orders", "order_operations"];
        for (const table of tables) {
          try {
            const count = await client.query(
              "SELECT count(*)::int AS n FROM " + table
            );
            line(table, String(count.rows[0].n));
          } catch {
            line(table, "(table not found)");
          }
        }
      } catch (err) {
        line("Database", "cannot reach it - " + err.message);
        problems += 1;
      } finally {
        try {
          await client.end();
        } catch {}
      }
    }
  }

  const health = await getHealth(port);
  if (health.status === 200) {
    line("/api/health", "200 OK");
    if (health.build) line("Build", health.build);
  } else if (health.status === 0) {
    line("/api/health", "NOT answering - " + (health.error || "no response"));
    problems += 1;
  } else {
    line("/api/health", "answered with " + health.status);
    problems += 1;
  }

  console.log("  " + "-".repeat(58));
  if (problems === 0) {
    console.log("Everything looks good.");
  } else {
    console.log(
      "PROBLEM: " +
        (problems === 1 ? "1 check failed" : problems + " checks failed") +
        " - see the lines above."
    );
    console.log("For a server that should be running, tell the agent what this window says.");
  }
  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("The check itself failed unexpectedly:");
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
