"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const TABLES = ["users", "machines", "orders", "order_operations"];

function copyTableName(line) {
  const header = line.match(/^COPY\s+(.+?)\s+\(/i);
  if (!header) return null;
  const identifiers = header[1].match(/"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*/g);
  if (!identifiers || identifiers.length === 0) return null;
  const last = identifiers[identifiers.length - 1];
  return last[0] === '"' ? last.slice(1, -1).replace(/""/g, '"').toLowerCase() : last.toLowerCase();
}

function createCopyRowCounter() {
  const counts = Object.fromEntries(TABLES.map((table) => [table, 0]));
  const seen = new Set();
  let insideCopy = false;
  let targetTable = null;

  return {
    counts,
    seen,
    consume(line) {
      if (!insideCopy) {
        if (!/^COPY\s+/i.test(line)) return;
        insideCopy = true;
        const table = copyTableName(line);
        targetTable = table && TABLES.includes(table) ? table : null;
        if (targetTable) seen.add(targetTable);
        return;
      }

      if (line === "\\.") {
        insideCopy = false;
        targetTable = null;
        return;
      }
      if (targetTable) counts[targetTable] += 1;
    },
  };
}

function parseCopyCounts(lines) {
  const counter = createCopyRowCounter();
  for (const line of lines) counter.consume(String(line).replace(/\r$/, ""));
  return { ...counter.counts };
}

function findPgRestore() {
  const candidates = [];
  let pgBin = process.env.WOODTEK_PG_BIN;
  const envFile = path.resolve(__dirname, "..", ".env");
  if (!pgBin && fs.existsSync(envFile)) {
    const match = fs.readFileSync(envFile, "utf8").match(/^\s*WOODTEK_PG_BIN\s*=\s*(.*?)\s*$/m);
    if (match) pgBin = match[1].trim().replace(/^['\"]|['\"]$/g, "");
  }
  if (pgBin) candidates.push(path.join(pgBin, "pg_restore.exe"));
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const root of roots) {
    for (const version of ["18", "17", "16", "15", "14"]) {
      candidates.push(path.join(root, "PostgreSQL", version, "bin", "pg_restore.exe"));
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    const { spawnSync } = require("node:child_process");
    const found = spawnSync("where.exe", ["pg_restore.exe"], { encoding: "utf8", windowsHide: true });
    if (found.status === 0 && found.stdout) {
      const first = found.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    }
  }
  return null;
}

function inspectDump(pgRestorePath, dumpPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgRestorePath, ["--data-only", "--no-owner", "--no-privileges", "--file=-", dumpPath], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    const counter = createCopyRowCounter();
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", counter.consume);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_restore could not read the dump (exit code ${code}).`));
        return;
      }
      if (counter.seen.size === 0) {
        reject(new Error("The dump contained no row data for the core WoodTek tables. It may be the wrong or incomplete dump."));
        return;
      }
      resolve({ ...counter.counts });
    });
  });
}

async function main(argv) {
  const dumpPath = path.resolve(argv[2] || "");
  if (!argv[2] || !fs.existsSync(dumpPath) || !fs.statSync(dumpPath).isFile()) {
    throw new Error("Select an existing PostgreSQL .dump file.");
  }
  const pgRestore = findPgRestore();
  if (!pgRestore) {
    throw new Error("pg_restore.exe was not found. Run backup\\find-postgres-tools.bat on the old PC, then try again.");
  }

  console.log("Read-only inspection: opening the dump file only; no database connection or restore.");
  console.log(`Dump: ${path.basename(dumpPath)}`);
  const counts = await inspectDump(pgRestore, dumpPath);
  console.log("\nRows stored in this dump:");
  for (const table of TABLES) console.log(`  ${table}: ${counts[table]}`);
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(`\n[inspect-dump] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { TABLES, copyTableName, parseCopyCounts };
