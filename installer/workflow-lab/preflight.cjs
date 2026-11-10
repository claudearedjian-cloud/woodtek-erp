#!/usr/bin/env node
/* ============================================================================
 * WoodTek Workflow Lab - safety preflight (installer/workflow-lab/preflight.cjs)
 * ----------------------------------------------------------------------------
 * The Workflow Lab is a SECOND, side-by-side WoodTek installation on the same
 * PC as the factory system. The only thing that makes that safe is that every
 * machine-wide name it registers is different, and that its database can never
 * resolve to the factory one. This file is the single place that decides
 * whether a proposed lab install is safe. It runs:
 *
 *   1. BEFORE anything is created or copied (action install/refresh):
 *        - the registry itself is consistent (lab != default, everywhere)
 *        - the target folder is not the factory folder, not a parent/child of
 *          it, not a Windows system folder, and is empty or a lab install
 *        - the port is not the factory port and not a reserved port
 *        - the database name is exactly the lab database, on a local server,
 *          and never one of the protected names (woodtek_erp, postgres, ...)
 *
 *   2. AFTER the copy and the .env/edition files are written (action verify):
 *        - .next/standalone/server.js is present
 *        - .env points at the lab database and the lab port
 *        - the marker file, installed-edition.json and optional-modules.json
 *          match the registry (four optional modules hard-locked, none enabled)
 *        - no second .env came along with the copied app files
 *
 * Every rule is a plain function of its inputs (no Windows APIs), so the whole
 * safety model is testable in CI on Linux: scripts/workflow-lab-test.cjs.
 *
 * Usage:
 *   node installer/workflow-lab/preflight.cjs --action install \
 *        --target "C:\WoodTek-Workflow-Lab" --port 3001 \
 *        --db-url "postgresql://postgres:postgres@localhost:5432/woodtek_workflow_lab" \
 *        --source "C:\WoodTek-ERP" [--json]
 *
 * Exit codes:  0 = safe to continue,  2 = refused (readable reasons on stdout).
 * ==========================================================================*/

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_PATH = path.resolve(__dirname, "..", "instance-registry.json");
const LAB_ID = "workflow-lab";
const DEFAULT_ID = "default";

const LOCKABLE_OPTIONAL_MODULES = ["invoicing", "purchasing", "payroll", "design"];
const INSTALLER_ADDONS = ["invoicing", "purchasing", "cmms", "workforce"];
const LOCAL_DB_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/* ---------------------------------------------------------------- registry */

function loadRegistry(registryPath) {
  const file = registryPath || REGISTRY_PATH;
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

function isWinAbs(p) {
  return /^[A-Za-z]:[\\/]/.test(String(p || ""));
}

function isPosixAbs(p) {
  return String(p || "").startsWith("/");
}

function isAbsoluteAny(p) {
  return isWinAbs(p) || isPosixAbs(p);
}

/**
 * Lower-case, forward slashes, no "." / ".." segments, no trailing slash - the
 * comparable form. Purely textual: ".\\lab\." and "C:/Lab" must compare equal
 * to their plain forms without resolving anything against the current disk.
 */
function normalizeDir(input) {
  let p = String(input === undefined || input === null ? "" : input).trim();
  if (!p) return "";
  p = p.replace(/["']/g, "").replace(/\\/g, "/");
  p = p.replace(/\/+/g, "/");
  const absolute = p.startsWith("/");
  const segments = [];
  for (const segment of p.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 1 || (segments.length === 1 && !/^[A-Za-z]:$/.test(segments[0]))) {
        segments.pop();
        continue;
      }
      continue;
    }
    segments.push(segment);
  }
  p = segments.join("/");
  if (absolute && !/^[A-Za-z]:/.test(p)) p = "/" + p;
  if (/^[A-Za-z]:$/.test(p)) p = p + "/";
  return p.toLowerCase();
}

function isSameDir(a, b) {
  const na = normalizeDir(a);
  const nb = normalizeDir(b);
  return Boolean(na) && na === nb;
}

/** True when `child` is inside `parent` (or equal). */
function isWithinDir(child, parent) {
  const nc = normalizeDir(child);
  const np = normalizeDir(parent);
  if (!nc || !np) return false;
  if (nc === np) return true;
  const prefix = np.endsWith("/") ? np : np + "/";
  return nc.startsWith(prefix);
}

function portableDatabaseName(url) {
  try {
    const parsed = new URL(String(url || ""));
    const raw = parsed.pathname.replace(/^\//, "");
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

function stringList(value) {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/* -------------------------------------------------------- registry checks */

/**
 * The lab profile must differ from the default profile in every value that a
 * second installation could collide on. Returns [] when it does.
 */
function registryProblems(registry) {
  const problems = [];
  if (!registry || typeof registry !== "object") return ["registry is empty or not an object"];
  const instances = registry.instances || {};
  const def = instances[DEFAULT_ID];
  const lab = instances[LAB_ID];
  if (!def) problems.push("registry has no 'default' instance");
  if (!lab) problems.push("registry has no 'workflow-lab' instance");
  if (problems.length) return problems;

  const mustDiffer = [
    "installDir",
    "port",
    "databaseName",
    "serviceTask",
    "backupTask",
    "firewallRule",
    "desktopShortcut",
    "startMenuFolder",
    "logFile",
  ];
  for (const key of mustDiffer) {
    const a = key === "installDir" ? normalizeDir(def[key]) : String(def[key] || "").trim().toLowerCase();
    const b = key === "installDir" ? normalizeDir(lab[key]) : String(lab[key] || "").trim().toLowerCase();
    if (!b) problems.push("workflow-lab." + key + " is empty");
    else if (a === b) problems.push("workflow-lab." + key + " is the same as the default instance: " + String(lab[key]));
  }
  if (Number(lab.port) === Number(def.port)) {
    problems.push("workflow-lab.port must differ from the default port (" + def.port + ")");
  }
  const labAddons = stringList(lab.addons);
  for (const addon of labAddons) {
    if (!INSTALLER_ADDONS.includes(addon)) problems.push("workflow-lab.addons has unknown pack '" + addon + "'");
  }
  const labLocks = stringList(lab.lockedOptionalModules);
  for (const mod of labLocks) {
    if (!LOCKABLE_OPTIONAL_MODULES.includes(mod)) {
      problems.push("workflow-lab.lockedOptionalModules has unknown module '" + mod + "'");
    }
  }
  // A locked module must not be shipped as an installed add-on pack. ("payroll"
  // is provided by the "workforce" pack but is its own module id, so locking
  // payroll while installing workforce - shifts on, payroll off - stays legal.)
  for (const addon of labAddons) {
    if (labLocks.includes(addon)) {
      problems.push("workflow-lab locks '" + addon + "' but also installs it in addons");
    }
  }
  if (!stringList(registry.protectedDatabases).map((d) => d.toLowerCase()).includes(String(def.databaseName).toLowerCase())) {
    problems.push("registry.protectedDatabases must contain the default database name");
  }
  if (!stringList(registry.protectedPorts).map(String).includes(String(def.port))) {
    problems.push("registry.protectedPorts must contain the default port");
  }
  return problems;
}

/* ------------------------------------------------------- leftover detection */

/**
 * Names the Workflow Lab installer itself creates inside its folder. A folder
 * that holds NOTHING else is the remains of an interrupted lab install (for
 * example a build that failed after the helper had created its folders), so a
 * re-run continues instead of refusing. Anything else in the folder - an
 * upload, a database dump, a foreign app, a copied factory .env - is not ours
 * and stays refused.
 */
const LAB_SCAFFOLD_ENTRIES = ["data", "logs", "backups"];
/** Files the lab bootstrap writes into <lab>\data. */
const LAB_DATA_FILES = ["installed-edition.json", "optional-modules.json"];

function readEnvFileIfPresent(file) {
  try {
    return parseDotEnv(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** True when <target>\.env is a LAB .env (lab database on the lab port). */
function envIsLabOwned(file, registry) {
  const env = readEnvFileIfPresent(file);
  if (!env) return false;
  const lab = registry && registry.instances ? registry.instances[LAB_ID] : null;
  if (!lab) return false;
  if (!env.DATABASE_URL) return false;
  if (portableDatabaseName(env.DATABASE_URL) !== String(lab.databaseName)) return false;
  const port = Number(env.PORT);
  return Number.isInteger(port) ? port === Number(lab.port) : true;
}

/** True when every file under `dir` is something the lab itself writes. */
function onlyLabFiles(dir, top) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A "data" folder with subfolders means uploads/overlays of a real
      // installation: not ours. logs/ and backups/ may hold any depth.
      if (top === "data") return false;
      if (!onlyLabFiles(full, top)) return false;
      continue;
    }
    const name = entry.name.toLowerCase();
    if (top === "data") {
      if (!LAB_DATA_FILES.includes(name)) return false;
    } else if (top === "logs") {
      if (!name.endsWith(".log")) return false;
    }
    // backups/ may legitimately contain dumps and zips: nothing to veto.
  }
  return true;
}

/**
 * Classifies a non-empty target folder:
 *   "lab-complete"    - the marker file proves a finished lab install
 *   "lab-interrupted" - only our own folders (and maybe a lab .env) exist
 *   "foreign"         - anything else
 */
function classifyExistingFolder(target, entries, registry) {
  const markerName = (registry && registry.instances && registry.instances[LAB_ID]
    && registry.instances[LAB_ID].markerFile) || "workflow-lab-instance.json";
  const markerPath = path.join(target, markerName);
  let marker = null;
  if (fs.existsSync(markerPath)) {
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    } catch {
      marker = null;
    }
  }
  if (marker && String(marker.instanceId || "") === LAB_ID) {
    // A lab counts as finished when it says so, or when it was written by the
    // first version of the helper (no "completed" flag, but a lab .env exists).
    // Anything else is a run that stopped early and must be resumable by simply
    // running the same helper again.
    const finished =
      marker.completed === true ||
      (marker.completed === undefined && envIsLabOwned(path.join(target, ".env"), registry));
    return finished
      ? { kind: "lab-complete", marker }
      : { kind: "lab-interrupted", marker, reason: "previous attempt stopped before finishing" };
  }
  for (const entry of entries) {
    const name = entry.toLowerCase();
    if (name === ".env") {
      if (envIsLabOwned(path.join(target, entry), registry)) continue;
      return { kind: "foreign" };
    }
    if (!LAB_SCAFFOLD_ENTRIES.includes(name)) return { kind: "foreign" };
    let stat = null;
    try {
      stat = fs.statSync(path.join(target, entry));
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) return { kind: "foreign" };
    if (!onlyLabFiles(path.join(target, entry), name)) return { kind: "foreign" };
  }
  return { kind: "lab-interrupted", marker: null };
}

/* ------------------------------------------------------------ target rules */

/** System folders and the factory folder may never be the lab folder. */
function protectedDirsFor(registry, extra) {
  const registryPaths = stringList(registry && registry.protectedPaths);
  const defaultDir = registry && registry.instances && registry.instances[DEFAULT_ID]
    ? String(registry.instances[DEFAULT_ID].installDir || "")
    : "";
  const list = registryPaths.slice();
  if (defaultDir) list.push(defaultDir);
  for (const extraDir of stringList(extra)) if (extraDir) list.push(extraDir);
  // De-duplicate (the factory folder is listed both as a protected path and as
  // the default instance folder) so a refusal is not printed twice.
  const seen = new Set();
  const unique = [];
  for (const dir of list) {
    if (!dir) continue;
    const key = normalizeDir(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(dir);
  }
  return unique;
}

function checkTargetDir(targetDir, registry, options) {
  const opts = options || {};
  const errors = [];
  const warnings = [];
  const target = String(targetDir || "").trim();

  if (!target) {
    return { ok: false, errors: ["no target folder given"], warnings };
  }
  if (!isAbsoluteAny(target)) {
    return { ok: false, errors: ["target folder must be a full path, not a relative one: " + target], warnings };
  }
  if (isWindowsPathLike(target) && /^[A-Za-z]:[\\/]*$/.test(target)) {
    return { ok: false, errors: ["refusing a whole drive as the lab folder: " + target], warnings };
  }
  if (!isWindowsPathLike(target) && process.platform === "win32") {
    errors.push("target folder must be a Windows path such as C:\\WoodTek-Workflow-Lab: " + target);
  }

  const protectedDirs = protectedDirsFor(registry, opts.extraProtectedDirs);
  for (const protectedDir of protectedDirs) {
    if (!protectedDir) continue;
    if (isSameDir(target, protectedDir)) {
      errors.push("refusing to install the lab into " + target + ": that folder belongs to the existing installation or to Windows");
    } else if (isWithinDir(target, protectedDir)) {
      errors.push("refusing to install the lab inside " + protectedDir + " (target: " + target + ")");
    } else if (isWithinDir(protectedDir, target)) {
      errors.push("refusing " + target + " as the lab folder: it contains " + protectedDir);
    }
  }

  // Folder contents (classifyExistingFolder also reads the instance marker).
  let exists = false;
  try {
    exists = fs.existsSync(target);
  } catch {
    exists = false;
  }

  let existingMarker = null;
  if (exists) {
    let stat = null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) {
      errors.push("refusing " + target + ": a file with that name already exists");
    } else {
      let entries = [];
      try {
        entries = fs.readdirSync(target);
      } catch (err) {
        errors.push("cannot read " + target + " (" + (err && err.message ? err.message : err) + ")");
      }
      if (entries.length > 0) {
        const state = classifyExistingFolder(target, entries, registry);
        existingMarker = state.marker;
        if (state.kind === "foreign") {
          const sample = entries.slice(0, 6).join(", ");
          errors.push(
            "refusing " + target + ": the folder already contains data that is not a WoodTek Workflow Lab installation (" +
              entries.length + " entries: " + sample + (entries.length > 6 ? ", ..." : "") + ")",
          );
        } else if (state.kind === "lab-complete" && opts.action === "install") {
          errors.push(
            "a WoodTek Workflow Lab already exists in " + target +
              " - run update-workflow-lab.bat there (or -Action Refresh) to repair or refresh it, " +
              "or pick another folder with -TargetDir",
          );
        } else if (state.kind === "lab-interrupted") {
          warnings.push(
            "an unfinished Workflow Lab was found in " + target + " (" +
              (state.reason || "only the lab's own data/logs/backups") +
              ") - continuing from there; nothing of the factory installation is involved",
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, exists, marker: existingMarker };
}

function isWindowsPathLike(p) {
  return isWinAbs(p);
}

/* -------------------------------------------------------------- port rules */

function checkPort(port, registry) {
  const errors = [];
  const warnings = [];
  const value = Number(port);
  if (!Number.isInteger(value)) {
    return { ok: false, errors: ["port is not a whole number: " + String(port)], warnings };
  }
  if (value < 1024 || value > 65535) {
    errors.push("port " + value + " is outside the usable range (1024-65535)");
  }
  const defPort = registry && registry.instances && registry.instances[DEFAULT_ID]
    ? Number(registry.instances[DEFAULT_ID].port)
    : 3000;
  const protectedPorts = stringList(registry && registry.protectedPorts).map(Number).filter((n) => Number.isInteger(n));
  if (!protectedPorts.includes(defPort)) protectedPorts.push(defPort);
  if (protectedPorts.includes(value)) {
    errors.push("port " + value + " belongs to the existing WoodTek ERP installation - the lab needs its own port");
  }
  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------------------------------------------------- database rules */

function checkDatabaseUrl(dbUrl, registry) {
  const errors = [];
  const warnings = [];
  const raw = String(dbUrl || "").trim();
  if (!raw) {
    return { ok: false, errors: ["no database URL given - the lab always gets its own database"], warnings };
  }
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, errors: ["database URL cannot be parsed: " + redactUrl(raw)], warnings };
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol || "")) {
    errors.push("database URL must be a PostgreSQL URL (postgresql://...): " + parsed.protocol);
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!LOCAL_DB_HOSTS.includes(host)) {
    errors.push(
      "database URL points at '" + host + "'. The lab database must stay on this PC (localhost) so test data never lands on a shared server",
    );
  }
  const dbName = portableDatabaseName(raw);
  if (!dbName) {
    errors.push("database URL has no database name");
  }
  const labName = registry && registry.instances && registry.instances[LAB_ID]
    ? String(registry.instances[LAB_ID].databaseName || "")
    : "";
  const protectedNames = stringList(registry && registry.protectedDatabases).map((d) => d.toLowerCase());
  const defaultName = registry && registry.instances && registry.instances[DEFAULT_ID]
    ? String(registry.instances[DEFAULT_ID].databaseName || "").toLowerCase()
    : "woodtek_erp";
  if (defaultName && !protectedNames.includes(defaultName)) protectedNames.push(defaultName);
  if (dbName) {
    if (protectedNames.includes(dbName.toLowerCase())) {
      errors.push(
        "refusing database '" + dbName + "': that is the existing WoodTek ERP database (or a PostgreSQL system database). The lab must never connect to it",
      );
    } else if (labName && dbName !== labName) {
      errors.push("lab database must be '" + labName + "', not '" + dbName + "'");
    }
  }
  return { ok: errors.length === 0, errors, warnings, databaseName: dbName };
}

function redactUrl(raw) {
  return String(raw).replace(/:\/\/([^:/@]+):([^@]*)@/, "://$1:***@");
}

/* ------------------------------------------------------------ source rules */

function checkSourceDir(sourceDir, targetDir, registry) {
  const errors = [];
  const warnings = [];
  const source = String(sourceDir || "").trim();
  if (!source) {
    return { ok: false, errors: ["no source folder given (pass -SourceDir or -PayloadZip)"], warnings };
  }
  if (isSameDir(source, targetDir)) {
    return { ok: false, errors: ["source and target are the same folder: " + source], warnings };
  }
  if (isWithinDir(targetDir, source)) {
    return { ok: false, errors: ["refusing to copy " + source + " into a folder inside itself (" + targetDir + ")"], warnings };
  }
  if (!fs.existsSync(source)) {
    return { ok: false, errors: ["source folder does not exist: " + source], warnings };
  }
  const launcher = path.join(source, "start-prod.cjs");
  if (!fs.existsSync(launcher)) {
    return { ok: false, errors: ["source folder does not look like a WoodTek ERP installation (no start-prod.cjs): " + source], warnings };
  }
  const server = path.join(source, ".next", "standalone", "server.js");
  if (!fs.existsSync(server)) {
    return { ok: false, errors: ["source installation has no production build (.next\\standalone\\server.js): " + source], warnings };
  }
  const defaultDir = registry && registry.instances && registry.instances[DEFAULT_ID]
    ? String(registry.instances[DEFAULT_ID].installDir || "")
    : "";
  if (defaultDir && isSameDir(source, defaultDir)) {
    warnings.push(
      "app files are copied READ-ONLY from the existing installation (" + source + "). Its .env, data, logs, backups and uploads are never copied",
    );
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Can this app build enforce the lab's four hard module locks?
 * invoicing/purchasing/payroll are locked by the installed-edition add-on list,
 * which every build understands. "Design" has no add-on pack, so it needs the
 * lockedOptionalModules support added with the Workflow Lab. A build without it
 * would let a Manager switch design on from Settings, which is exactly what the
 * owner asked to prevent - so we look for the token in the shipped build.
 */
function appSupportsLabLocks(appDir) {
  const roots = [path.join(appDir, ".next", "standalone")];
  const needle = "lockedOptionalModules";
  const maxFiles = 4000;
  let seen = 0;
  const stack = roots.slice();
  while (stack.length > 0 && seen < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" && path.basename(current) === "standalone") {
          // Still scan: chunks live under .next inside standalone, node_modules does not carry app code.
          continue;
        }
        stack.push(full);
      } else if (/\.(js|json|mjs|cjs)$/i.test(entry.name)) {
        seen += 1;
        if (seen > maxFiles) break;
        try {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes(needle)) return true;
        } catch {
          /* unreadable file - ignore */
        }
      }
    }
  }
  return false;
}

/* ----------------------------------------------------------- post-install */

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parseDotEnv(text) {
  const out = {};
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    });
  return out;
}

/** Finds stray .env files (a copied production .env is the classic disaster). */
function findStrayEnvFiles(targetDir) {
  const found = [];
  const skip = new Set(["node_modules", ".git", "backups", "logs"]);
  const stack = [{ dir: targetDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > 3) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.name === ".env" && depth > 0) {
        found.push(full);
      }
    }
  }
  return found;
}

function verifyInstall(options) {
  const opts = options || {};
  const registry = opts.registry || loadRegistry(opts.registryPath);
  const lab = registry.instances[LAB_ID];
  const target = String(opts.targetDir || "");
  const port = Number(opts.port || lab.port);
  const errors = [];
  const warnings = [];

  const server = path.join(target, ".next", "standalone", "server.js");
  if (!fs.existsSync(server)) errors.push("missing production build: " + server);

  const envPath = path.join(target, ".env");
  if (!fs.existsSync(envPath)) {
    errors.push("missing .env in " + target);
  } else {
    const env = parseDotEnv(fs.readFileSync(envPath, "utf8"));
    if (!env.DATABASE_URL) {
      errors.push(".env has no DATABASE_URL");
    } else {
      const dbCheck = checkDatabaseUrl(env.DATABASE_URL, registry);
      for (const problem of dbCheck.errors) errors.push(".env: " + problem);
    }
    if (Number(env.PORT) !== port) {
      errors.push(".env PORT is '" + String(env.PORT || "") + "' but the lab port is " + port);
    }
    if (!env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16) {
      errors.push(".env AUTH_SECRET is missing or too short - the lab would not be able to sign anyone in");
    }
    if (env.WOODTEK_DATA_DIR && normalizeDir(env.WOODTEK_DATA_DIR) !== normalizeDir(path.join(target, "data"))) {
      warnings.push("WOODTEK_DATA_DIR points outside the lab folder: " + env.WOODTEK_DATA_DIR);
    }
  }

  const markerName = lab.markerFile || "workflow-lab-instance.json";
  const marker = readJsonSafe(path.join(target, markerName));
  if (marker && marker.completed === false) {
    warnings.push(markerName + " says this install never finished - run the helper again to complete it");
  }
  if (!marker) {
    errors.push("missing " + markerName + " - this folder is not marked as a Workflow Lab installation");
  } else {
    if (String(marker.instanceId || "") !== LAB_ID) errors.push(markerName + " names the wrong instance: " + String(marker.instanceId));
    if (Number(marker.port) !== port) errors.push(markerName + " port " + String(marker.port) + " != " + port);
    if (String(marker.databaseName || "") !== String(lab.databaseName)) {
      errors.push(markerName + " database " + String(marker.databaseName) + " != " + lab.databaseName);
    }
    if (String(marker.serviceTask || "") !== String(lab.serviceTask)) {
      errors.push(markerName + " scheduled task '" + String(marker.serviceTask) + "' != '" + lab.serviceTask + "'");
    }
  }

  const edition = readJsonSafe(path.join(target, "data", "installed-edition.json"));
  if (!edition) {
    errors.push("missing data/installed-edition.json - the module hard lock would not exist");
  } else {
    const addons = stringList(edition.addons);
    const expectedAddons = stringList(lab.addons);
    if (addons.slice().sort().join(",") !== expectedAddons.slice().sort().join(",")) {
      errors.push("installed-edition addons are [" + addons.join(", ") + "], expected [" + expectedAddons.join(", ") + "]");
    }
    const locks = stringList(edition.lockedOptionalModules).map((m) => m.toLowerCase()).sort();
    const expectedLocks = stringList(lab.lockedOptionalModules).map((m) => m.toLowerCase()).sort();
    if (locks.join(",") !== expectedLocks.join(",")) {
      errors.push("installed-edition lockedOptionalModules are [" + locks.join(", ") + "], expected [" + expectedLocks.join(", ") + "]");
    }
    for (const locked of expectedLocks) {
      if (addons.some((a) => a === locked)) {
        errors.push("installed-edition installs the pack '" + locked + "' that must stay locked");
      }
    }
  }

  const optFile = path.join(target, "data", "optional-modules.json");
  const opt = readJsonSafe(optFile);
  if (!opt) {
    warnings.push("data/optional-modules.json not written yet - the app will start with the factory default (Invoicing on, then re-locked)");
  } else {
    const lockedList = stringList(lab.lockedOptionalModules);
    const enabled = stringList(opt.enabled);
    for (const mod of enabled) {
      if (lockedList.includes(mod)) errors.push("optional-modules.json switches ON the locked module '" + mod + "'");
    }
    const grants = [];
    const roles = opt.roles && typeof opt.roles === "object" ? opt.roles : {};
    const users = opt.users && typeof opt.users === "object" ? opt.users : {};
    for (const [role, mods] of Object.entries(roles)) for (const mod of stringList(mods)) grants.push("role " + role + " -> " + mod);
    for (const [userId, mods] of Object.entries(users)) for (const mod of stringList(mods)) grants.push("user " + userId + " -> " + mod);
    for (const grant of grants) {
      const mod = grant.split("-> ").pop();
      if (lockedList.includes(mod)) errors.push("optional-modules.json grants the locked module: " + grant);
    }
  }

  for (const stray of findStrayEnvFiles(target)) {
    errors.push("found a second .env inside the lab (" + stray + ") - a copied .env could point the lab at the factory database");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------------------------------------------------------- driver */

function buildDefaultDbUrl(registry, password, port) {
  const lab = registry.instances[LAB_ID];
  const user = String(lab.databaseUser || "postgres");
  const pass = String(password === undefined || password === null ? "postgres" : password);
  const dbPort = Number(port || lab.databasePort || 5432);
  return (
    "postgresql://" + encodeURIComponent(user) + ":" + encodeURIComponent(pass) +
    "@localhost:" + dbPort + "/" + encodeURIComponent(lab.databaseName)
  );
}

/**
 * Rewrites a PostgreSQL connection string so it points at another database on
 * the same server, keeping the user, password, host and port untouched.
 * Returns null when the string is not a usable local PostgreSQL URL.
 */
function databaseUrlWithName(rawUrl, databaseName) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") return null;
  const host = parsed.hostname.toLowerCase();
  if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]")) return null;
  if (!parsed.username) return null;
  const target = String(databaseName || "").trim();
  if (!target) return null;
  parsed.pathname = "/" + encodeURIComponent(target);
  parsed.search = "";
  return parsed.toString();
}

/** Human description of a connection string - never includes the password. */
function describeDatabaseUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const user = decodeURIComponent(parsed.username || "");
    const db = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const port = parsed.port || "5432";
    return user + "@" + parsed.hostname + ":" + port + "/" + db;
  } catch {
    return "(unreadable connection string)";
  }
}

/**
 * Decides which PostgreSQL login the lab uses.
 *
 * Order: an explicit -DbUrl / --db-url, then the login the factory installation
 * already uses (read from its .env, database name swapped), then the setup
 * wizard default. The owner therefore never has to retype the postgres
 * password: whatever the factory uses works for the lab too, on its own
 * database. A remote factory database is deliberately never reused.
 */
function resolveLabDatabaseUrl(options) {
  const opts = options || {};
  const registry = opts.registry || loadRegistry(opts.registryPath);
  const lab = registry.instances[LAB_ID];
  const databaseName = String(opts.databaseName || lab.databaseName);

  const override = String(opts.overrideUrl || "").trim();
  if (override) {
    return { ok: true, url: override, source: "argument", note: "connection string passed to the installer" };
  }
  if (opts.passwordProvided) {
    return {
      ok: true,
      url: buildDefaultDbUrl(registry, opts.password, opts.port),
      source: "argument",
      note: "password given to the installer (-PgSuperPassword)",
    };
  }

  const factoryEnvPath = String(opts.factoryEnvPath || "").trim();
  if (factoryEnvPath) {
    const env = readEnvFileIfPresent(factoryEnvPath);
    if (env && env.DATABASE_URL) {
      const reused = databaseUrlWithName(env.DATABASE_URL, databaseName);
      if (reused) {
        return {
          ok: true,
          url: reused,
          source: "factory-env",
          note: "same PostgreSQL login as the factory installation (" + factoryEnvPath + "), database " + databaseName,
        };
      }
      return {
        ok: true,
        url: buildDefaultDbUrl(registry, opts.password, opts.port),
        source: "default",
        note:
          "the factory installation at " + factoryEnvPath + " does not use a local PostgreSQL login, so the lab " +
          "falls back to the setup default - pass -DbUrl or -PgSuperPassword if the login is different",
      };
    }
  }

  return {
    ok: true,
    url: buildDefaultDbUrl(registry, opts.password, opts.port),
    source: "default",
    note: "the setup default postgres login was used - pass -DbUrl or -PgSuperPassword if it is different",
  };
}

function parseArgs(argv) {
  const out = { action: "install" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : "");
    if (arg === "--json") out.json = true;
    else if (arg === "--action") out.action = next();
    else if (arg.startsWith("--action=")) out.action = arg.slice("--action=".length);
    else if (arg === "--target") out.targetDir = next();
    else if (arg.startsWith("--target=")) out.targetDir = arg.slice("--target=".length);
    else if (arg === "--port") out.port = Number(next());
    else if (arg.startsWith("--port=")) out.port = Number(arg.slice("--port=".length));
    else if (arg === "--db-url") out.dbUrl = next();
    else if (arg.startsWith("--db-url=")) out.dbUrl = arg.slice("--db-url=".length);
    else if (arg === "--pg-password") out.pgPassword = next();
    else if (arg.startsWith("--pg-password=")) out.pgPassword = arg.slice("--pg-password=".length);
    else if (arg === "--source") out.sourceDir = next();
    else if (arg.startsWith("--source=")) out.sourceDir = arg.slice("--source=".length);
    else if (arg === "--registry") out.registryPath = next();
    else if (arg.startsWith("--registry=")) out.registryPath = arg.slice("--registry=".length);
    else if (arg === "--factory-env") out.factoryEnvPath = next();
    else if (arg.startsWith("--factory-env=")) out.factoryEnvPath = arg.slice("--factory-env=".length);
    else if (arg === "--pg-port") out.pgPort = Number(next());
    else if (arg.startsWith("--pg-port=")) out.pgPort = Number(arg.slice("--pg-port=".length));
    else if (arg === "--database") out.databaseName = next();
    else if (arg.startsWith("--database=")) out.databaseName = arg.slice("--database=".length);
    else if (arg === "--out") out.outFile = next();
    else if (arg.startsWith("--out=")) out.outFile = arg.slice("--out=".length);
    else if (arg === "--require-lock-support") out.requireLockSupport = true;
    else if (arg.startsWith("--app-dir=")) out.appDir = arg.slice("--app-dir=".length);
  }
  return out;
}

function runPreflight(options) {
  const opts = options || {};
  const registry = opts.registry || loadRegistry(opts.registryPath);
  const action = String(opts.action || "install").toLowerCase();
  const errors = [];
  const warnings = [];
  const notes = [];

  for (const problem of registryProblems(registry)) errors.push("registry: " + problem);

  const lab = registry.instances[LAB_ID];
  const defaultInstance = registry.instances[DEFAULT_ID];
  const targetDir = String(opts.targetDir || lab.installDir);
  const port = Number(opts.port === undefined || opts.port === null || opts.port === "" ? lab.port : opts.port);

  if (action === "verify") {
    const result = verifyInstall({ registry, targetDir, port });
    return { ok: result.ok, errors: result.errors, warnings: result.warnings, notes, action, targetDir, port };
  }

  const dirCheck = checkTargetDir(targetDir, registry, { action });
  errors.push(...dirCheck.errors);
  warnings.push(...dirCheck.warnings);

  const portCheck = checkPort(port, registry);
  errors.push(...portCheck.errors);
  warnings.push(...portCheck.warnings);

  const dbUrl = opts.dbUrl || buildDefaultDbUrl(registry, opts.pgPassword);
  const dbCheck = checkDatabaseUrl(dbUrl, registry);
  errors.push(...dbCheck.errors);
  warnings.push(...dbCheck.warnings);

  if (opts.sourceDir) {
    const sourceCheck = checkSourceDir(opts.sourceDir, targetDir, registry);
    errors.push(...sourceCheck.errors);
    warnings.push(...sourceCheck.warnings);
  }

  if (opts.requireLockSupport && opts.appDir && !appSupportsLabLocks(opts.appDir)) {
    errors.push(
      "the app files in " + opts.appDir + " cannot enforce the lab module lock (no lockedOptionalModules support) - " +
        "use a Workflow Lab build/payload instead",
    );
  }

  notes.push("lab folder:      " + targetDir + "   (default installation stays at " + defaultInstance.installDir + ")");
  notes.push("lab port:        " + port + "   (default installation keeps " + defaultInstance.port + ")");
  notes.push("lab database:    " + (dbCheck.databaseName || lab.databaseName) + "   (default database " + defaultInstance.databaseName + " untouched)");
  notes.push("scheduled task:  " + lab.serviceTask + "   (default task " + defaultInstance.serviceTask + " untouched)");
  notes.push("firewall rule:   " + lab.firewallRule + "   (default rule " + defaultInstance.firewallRule + " untouched)");

  return { ok: errors.length === 0, errors, warnings, notes, action, targetDir, port, databaseName: dbCheck.databaseName };
}

/**
 * --action dburl: resolve the lab's PostgreSQL login and hand it to the
 * installer through a file, so the password never appears in a log or a window.
 */
function runDbUrlAction(args) {
  const registry = loadRegistry(args.registryPath);
  const resolved = resolveLabDatabaseUrl({
    registry,
    overrideUrl: args.dbUrl,
    factoryEnvPath: args.factoryEnvPath,
    password: args.pgPassword,
    passwordProvided: args.pgPassword !== undefined,
    databaseName: args.databaseName,
    port: args.pgPort,
  });
  if (!resolved.ok || !resolved.url) {
    console.log("[preflight] REFUSED: " + (resolved.note || "the lab database login could not be resolved"));
    return 1;
  }
  if (args.outFile) {
    fs.writeFileSync(args.outFile, resolved.url, { encoding: "utf8", mode: 0o600 });
    console.log("[preflight] lab database login: " + describeDatabaseUrl(resolved.url));
    console.log("[preflight] login source: " + resolved.note);
    return 0;
  }
  console.log(JSON.stringify({ ok: true, source: resolved.source, login: describeDatabaseUrl(resolved.url) }));
  return 0;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.action === "dburl") {
    process.exit(runDbUrlAction(args));
  }
  let result;
  try {
    result = runPreflight(args);
  } catch (err) {
    console.error("[workflow-lab-preflight] ERROR: " + (err && err.message ? err.message : err));
    process.exit(2);
  }
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const note of result.notes || []) console.log("[preflight] " + note);
    for (const warning of result.warnings || []) console.log("[preflight] NOTE: " + warning);
    for (const error of result.errors || []) console.log("[preflight] REFUSED: " + error);
    if (result.ok) console.log("[preflight] OK - safe to continue (" + result.action + ")");
    else console.log("[preflight] NOT SAFE - nothing was created or changed.");
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = {
  DEFAULT_ID,
  LAB_ID,
  LOCKABLE_OPTIONAL_MODULES,
  INSTALLER_ADDONS,
  loadRegistry,
  registryProblems,
  normalizeDir,
  isSameDir,
  isWithinDir,
  checkTargetDir,
  classifyExistingFolder,
  envIsLabOwned,
  checkPort,
  checkDatabaseUrl,
  checkSourceDir,
  appSupportsLabLocks,
  verifyInstall,
  runPreflight,
  buildDefaultDbUrl,
  databaseUrlWithName,
  describeDatabaseUrl,
  resolveLabDatabaseUrl,
  parseDotEnv,
  findStrayEnvFiles,
  portableDatabaseName,
};

if (require.main === module) main();
