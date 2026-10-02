#!/usr/bin/env node
// ============================================================================
// WoodTek ERP — Installer Database & Edition Bootstrapper (bootstrap-db.cjs)
// ----------------------------------------------------------------------------
// Runs during Windows .exe installation (and re-configuration) to:
//   1. Persist data/installed-edition.json (hard-locked add-on selection).
//   2. Sync data/optional-modules.json so only installed modules can be enabled.
//   3. Connect to PostgreSQL, create the target database if missing, and apply
//      installer/schema.sql (all 31 tables + indexes idempotently).
//   4. Optionally create the initial Manager account (hashed PIN via bcryptjs)
//      and default factory shifts when the users table is empty.
//
// Works on a fresh target PC using only the standalone production bundle
// (.next/standalone/node_modules/pg and bcryptjs) — no drizzle-kit or TS needed.
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const VALID_ADDONS = ["invoicing", "purchasing", "cmms", "workforce"];

function log(msg) {
  console.log(`[bootstrap-db] ${msg}`);
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
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
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function parseArgs(argv) {
  const out = {
    addons: null,
    dbUrl: null,
    dataDir: null,
    managerName: null,
    managerPin: "1234",
    configOnly: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config-only") {
      out.configOnly = true;
    } else if (arg.startsWith("--addons=")) {
      out.addons = arg.slice("--addons=".length);
    } else if (arg === "--addons" && i + 1 < argv.length) {
      out.addons = argv[++i];
    } else if (arg.startsWith("--db-url=")) {
      out.dbUrl = arg.slice("--db-url=".length);
    } else if (arg === "--db-url" && i + 1 < argv.length) {
      out.dbUrl = argv[++i];
    } else if (arg.startsWith("--data-dir=")) {
      out.dataDir = arg.slice("--data-dir=".length);
    } else if (arg === "--data-dir" && i + 1 < argv.length) {
      out.dataDir = argv[++i];
    } else if (arg.startsWith("--manager-name=")) {
      out.managerName = arg.slice("--manager-name=".length);
    } else if (arg === "--manager-name" && i + 1 < argv.length) {
      out.managerName = argv[++i];
    } else if (arg.startsWith("--manager-pin=")) {
      out.managerPin = arg.slice("--manager-pin=".length);
    } else if (arg === "--manager-pin" && i + 1 < argv.length) {
      out.managerPin = argv[++i];
    }
  }
  return out;
}

function writeJsonSafe(targetPath, data) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  const payloadText = JSON.stringify(data, null, 2) + "\n";
  try {
    fs.writeFileSync(tmpPath, payloadText, "utf8");
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }
}

function requireRuntimeModule(pkgName) {
  try {
    return require(pkgName);
  } catch {
    const standaloneCandidate = path.join(ROOT, ".next", "standalone", "node_modules", pkgName);
    return require(standaloneCandidate);
  }
}

function normalizeAddons(rawAddons) {
  if (rawAddons === null || rawAddons === undefined) return [...VALID_ADDONS];
  const tokens = String(rawAddons)
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("all") || tokens.includes("full")) return [...VALID_ADDONS];
  if (tokens.includes("none") || tokens.includes("core")) return [];
  return VALID_ADDONS.filter((id) => tokens.includes(id));
}

function configureInstalledEdition(dataDir, addonsList) {
  const editionPath = path.join(dataDir, "installed-edition.json");
  const editionPayload = {
    version: 1,
    addons: addonsList,
    installedAt: new Date().toISOString(),
    installerVersion: "1.0.0",
  };
  writeJsonSafe(editionPath, editionPayload);
  log(
    `Saved installed-edition.json (addons: ${addonsList.length > 0 ? addonsList.join(", ") : "core-only"})`,
  );

  // Sync optional-modules.json so enabled modules match the installed edition
  const optPath = path.join(dataDir, "optional-modules.json");
  let existing = null;
  if (fs.existsSync(optPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(optPath, "utf8"));
    } catch {
      existing = null;
    }
  }

  const allowedOptMods = [];
  if (addonsList.includes("invoicing")) allowedOptMods.push("invoicing");
  if (addonsList.includes("purchasing")) allowedOptMods.push("purchasing");
  if (addonsList.includes("workforce")) allowedOptMods.push("payroll");

  const baseEnabled = existing && Array.isArray(existing.enabled)
    ? existing.enabled
    : allowedOptMods.filter((m) => m === "invoicing" || m === "purchasing");
  const nextEnabled = baseEnabled.filter((m) => allowedOptMods.includes(m));
  // If installing an optional add-on for the first time, switch it on by default
  for (const mod of ["invoicing", "purchasing"]) {
    if (allowedOptMods.includes(mod) && (!existing || !Array.isArray(existing.enabled))) {
      if (!nextEnabled.includes(mod)) nextEnabled.push(mod);
    }
  }

  const defaultRoles = addonsList.includes("invoicing")
    ? { "Sales Coordinator": ["invoicing"] }
    : {};
  const nextOpt = {
    version: 1,
    enabled: nextEnabled,
    roles: existing && existing.roles && typeof existing.roles === "object" ? existing.roles : defaultRoles,
    users: existing && existing.users && typeof existing.users === "object" ? existing.users : {},
  };
  writeJsonSafe(optPath, nextOpt);
  log(`Synced optional-modules.json (enabled: ${nextEnabled.join(", ") || "none"})`);
}

function quoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

async function ensureDatabaseAndSchema(dbUrl, managerName, managerPin) {
  const { Client } = requireRuntimeModule("pg");
  const bcrypt = requireRuntimeModule("bcryptjs");

  const parsedUrl = new URL(dbUrl);
  const targetDb = decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")) || "woodtek_erp";

  // Step 1: Connect to the maintenance database ('postgres') to create targetDb if missing
  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = "/postgres";
  const adminClient = new Client({ connectionString: adminUrl.toString() });
  await adminClient.connect();
  try {
    const checkRes = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDb]);
    if (checkRes.rowCount === 0) {
      log(`Creating PostgreSQL database ${targetDb}...`);
      await adminClient.query(`CREATE DATABASE ${quoteIdent(targetDb)}`);
      log(`Database ${targetDb} created.`);
    } else {
      log(`Database ${targetDb} already exists.`);
    }
  } finally {
    await adminClient.end();
  }

  // Step 2: Connect to targetDb and apply installer/schema.sql
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Missing schema file at ${schemaPath}`);
  }
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  const appClient = new Client({ connectionString: dbUrl });
  await appClient.connect();
  try {
    log("Applying WoodTek ERP database schema (31 tables & indexes)...");
    await appClient.query("BEGIN");
    await appClient.query("SELECT pg_advisory_xact_lock(874221900)");
    await appClient.query(schemaSql);
    await appClient.query("COMMIT");
    log("Database schema verified and up to date.");

    // Step 3: Seed initial Manager and default shifts if users table is empty
    const userCountRes = await appClient.query("SELECT count(*)::int AS cnt FROM users");
    const userCount = userCountRes.rows[0]?.cnt ?? 0;
    if (userCount === 0 && managerName && String(managerName).trim()) {
      const cleanName = String(managerName).trim();
      const cleanPin = String(managerPin || "1234").trim();
      const hashedPin = await bcrypt.hash(cleanPin, 10);
      const emailSlug =
        cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/^\.+|\.+$/g, "") || "manager";
      await appClient.query(
        `INSERT INTO users (name, email, role, avatar_color, pin, active)
         VALUES ($1, $2, 'Manager', 'bg-amber-600', $3, true)`,
        [cleanName, `${emailSlug}@woodtek.local`, hashedPin],
      );
      log(`Created initial Manager account: "${cleanName}" (PIN: ${cleanPin}).`);
    } else if (userCount > 0) {
      log(`Existing users found (${userCount} account(s)) — keeping existing accounts untouched.`);
    }

    const shiftCountRes = await appClient.query("SELECT count(*)::int AS cnt FROM shifts");
    if ((shiftCountRes.rows[0]?.cnt ?? 0) === 0) {
      await appClient.query(`
        INSERT INTO shifts (name, start_time, end_time, color, active) VALUES
          ('Morning Shift', '06:00', '14:00', 'bg-amber-500', true),
          ('Afternoon Shift', '14:00', '22:00', 'bg-sky-500', true)
      `);
      log("Created default Morning & Afternoon shifts.");
    }
  } catch (err) {
    try {
      await appClient.query("ROLLBACK");
    } catch {
      /* ignore rollback error */
    }
    throw err;
  } finally {
    await appClient.end();
  }
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const args = parseArgs(process.argv);
  const dataDir = args.dataDir || process.env.WOODTEK_DATA_DIR || path.join(ROOT, "data");

  if (args.addons !== null) {
    const addonsList = normalizeAddons(args.addons);
    configureInstalledEdition(dataDir, addonsList);
  }

  if (args.configOnly) {
    log("Configuration-only mode complete.");
    return;
  }

  const dbUrl = args.dbUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set. Pass --db-url=... or configure .env first.");
  }

  await ensureDatabaseAndSchema(dbUrl, args.managerName, args.managerPin);
  log("Bootstrap completed successfully.");
}

main().catch((err) => {
  console.error("[bootstrap-db] ERROR:", err?.message || err);
  process.exit(1);
});
