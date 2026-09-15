// ============================================================================
// Manager-only database backup / restore.
//   GET  — list dumps in backup/db-dumps
//   POST — { action: "backup" }                pg_dump  -> backup/db-dumps/*.sql
//          { action: "restore", file: name }   psql -f  (single transaction)
// Uses the app's own DATABASE_URL; pg tools are located on PATH or in the
// usual Windows Postgres install folders (or WOODTEK_PG_BIN).
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

function dumpsDir(): string {
  // NEVER under the project/.next tree — rebuilds would wipe the dumps.
  // Windows default reuses the existing backup root (C:\WoodTekBackups).
  let dir = process.env.WOODTEK_DB_BACKUP_DIR || "";
  if (!dir) {
    dir =
      process.platform === "win32"
        ? "C:\\WoodTekBackups\\db-dumps"
        : path.join(process.cwd(), "backup", "db-dumps");
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Locate pg_dump/psql: WOODTEK_PG_BIN, then common Windows installs, then PATH. */
function findPgTool(tool: string): string {
  const candidates: string[] = [];
  const extra = process.env.WOODTEK_PG_BIN;
  if (extra) candidates.push(path.join(extra, tool));
  for (const root of ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"]) {
    try {
      for (const ver of fs.readdirSync(root).sort().reverse()) {
        candidates.push(path.join(root, ver, "bin", tool));
      }
    } catch {
      /* folder absent */
    }
  }
  for (const c of candidates) {
    const exe = process.platform === "win32" ? `${c}${tool.endsWith(".exe") ? "" : ".exe"}` : c;
    if (fs.existsSync(exe)) return exe;
  }
  return tool; // rely on PATH
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, output: `${stderr || ""}${stdout || ""} — ${err.message}` });
        else resolve({ ok: true, output: stdout || stderr || "" });
      },
    );
  });
}

export async function GET() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const dumps = fs
      .readdirSync(dumpsDir())
      .filter((f) => f.endsWith(".sql"))
      .map((f) => {
        const st = fs.statSync(path.join(dumpsDir(), f));
        return { file: f, sizeKb: Math.max(1, Math.round(st.size / 1024)), at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);

    const fulls = fs
      .readdirSync(fullDir())
      .filter((f) => f.startsWith("woodtek-full-"))
      .map((f) => {
        const p = path.join(fullDir(), f);
        const st = fs.statSync(p);
        let dataFiles = 0;
        try {
          dataFiles = fs.readdirSync(path.join(p, "data")).length;
        } catch {
          /* no data folder */
        }
        return {
          dir: f,
          sizeKb: st.isDirectory() ? dirSizeKb(p) : Math.max(1, Math.round(st.size / 1024)),
          dataFiles,
          at: st.mtimeMs,
        };
      })
      .filter((f) => fs.existsSync(path.join(fullDir(), f.dir, "db.sql")))
      .sort((a, b) => b.at - a.at);

    return NextResponse.json({ dumps, keep: keepCount(), fulls });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to list backups" }, { status: 500 });
  }
}

function pgDumpLineCount(file: string): number {
  try {
    return fs.readFileSync(file, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

/** How many dumps to keep (WOODTEK_DB_BACKUP_KEEP, default 30). */
function keepCount(): number {
  const n = Math.floor(Number(process.env.WOODTEK_DB_BACKUP_KEEP) || 30);
  return Math.max(3, n);
}

function dataDir(): string {
  // Same resolution the JSON-overlay libs use (start-prod.cjs sets
  // WOODTEK_DATA_DIR in production so it survives rebuilds).
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fullDir(): string {
  let dir = process.env.WOODTEK_FULL_BACKUP_DIR || "";
  if (!dir) {
    dir =
      process.platform === "win32"
        ? "C:\\WoodTekBackups\\full"
        : path.join(process.cwd(), "backup", "full");
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copy every regular file (recursively) from src into dst. Returns count. */
function copyDirFiles(src: string, dst: string): number {
  let count = 0;
  try {
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name);
      const d = path.join(dst, name);
      const st = fs.statSync(s);
      if (st.isDirectory()) {
        count += copyDirFiles(s, d);
      } else if (st.isFile()) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
        count += 1;
      }
    }
  } catch {
    /* unreadable entries are skipped */
  }
  return count;
}

function dirSizeKb(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  };
  try {
    walk(dir);
  } catch {
    /* ignore */
  }
  return Math.max(1, Math.round(total / 1024));
}

/** Delete the oldest dumps beyond the retention count. Returns pruned names. */
function pruneDumps(): string[] {
  try {
    const dumps = fs
      .readdirSync(dumpsDir())
      .filter((f) => f.endsWith(".sql"))
      .map((f) => {
        const st = fs.statSync(path.join(dumpsDir(), f));
        return { f, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
    const pruned: string[] = [];
    for (const d of dumps.slice(keepCount())) {
      try {
        fs.unlinkSync(path.join(dumpsDir(), d.f));
        pruned.push(d.f);
      } catch {
        /* file locked — keep it */
      }
    }
    return pruned;
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const { user, error } = await authorize("users:manage");
  if (error) return error;

  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  if (action === "backup") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dumpsDir(), `woodtek-db-${stamp}.sql`);
    const res = await run(findPgTool("pg_dump"), ["--format=plain", "--clean", "--if-exists", "--no-owner", "--no-privileges", "-f", file, url], 300000);
    if (!res.ok || !fs.existsSync(file)) {
      return NextResponse.json({ error: `Backup failed: ${String(res.output).slice(0, 400)}` }, { status: 500 });
    }
    const sizeKb = Math.max(1, Math.round(fs.statSync(file).size / 1024));
    const pruned = pruneDumps();
    logAudit(user, "db.backup", "system", `Backup ${path.basename(file)} (${sizeKb} KB)${pruned.length ? ` - ${pruned.length} old dump(s) pruned` : ""}`);
    return NextResponse.json({ ok: true, file: path.basename(file), sizeKb, pruned });
  }

  if (action === "full-backup") {
    // Everything in one folder: the SQL dump + a copy of every data/ JSON
    // file (ledgers, BOM status, dispatch stages, audit trail, roles…).
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(fullDir(), `woodtek-full-${stamp}`);
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });

    const dumpFile = path.join(dir, "db.sql");
    const dump = await run(findPgTool("pg_dump"), ["--format=plain", "--clean", "--if-exists", "--no-owner", "--no-privileges", "-f", dumpFile, url], 300000);
    if (!dump.ok || !fs.existsSync(dumpFile)) {
      return NextResponse.json({ error: `Full backup failed at the database step: ${String(dump.output).slice(0, 300)}` }, { status: 500 });
    }

    const fileCount = copyDirFiles(dataDir(), path.join(dir, "data"));
    fs.writeFileSync(
      path.join(dir, "manifest.txt"),
      [
        `WoodTek FULL backup ${new Date().toISOString()}`,
        `database: ${dumpFile} (${pgDumpLineCount(dumpFile)} lines)`,
        `data files: ${fileCount}`,
        `restore: full-restore of this folder (DB first, then data files)`,
      ].join("\n"),
      "utf8",
    );

    const pruned: string[] = [];
    try {
      const all = fs
        .readdirSync(fullDir())
        .filter((f) => f.startsWith("woodtek-full-"))
        .map((f) => ({ f, at: fs.statSync(path.join(fullDir(), f)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      for (const d of all.slice(keepCount())) {
        try {
          fs.rmSync(path.join(fullDir(), d.f), { recursive: true, force: true });
          pruned.push(d.f);
        } catch {
          /* locked — keep */
        }
      }
    } catch {
      /* ignore */
    }

    const sizeKb = dirSizeKb(dir);
    logAudit(user, "db.full-backup", "system", `FULL backup woodtek-full-${stamp} (db + ${fileCount} files, ${sizeKb} KB)${pruned.length ? ` - ${pruned.length} old pruned` : ""}`);
    return NextResponse.json({ ok: true, dir: path.basename(dir), files: fileCount, sizeKb, pruned });
  }

  if (action === "full-restore") {
    const name = String(body?.dir || "");
    if (!name.startsWith("woodtek-full-") || name.includes("/") || name.includes("\\") || name.includes("..")) {
      return NextResponse.json({ error: "Invalid backup folder name." }, { status: 400 });
    }
    const dir = path.join(fullDir(), name);
    const dumpFile = path.join(dir, "db.sql");
    if (!fs.existsSync(dumpFile)) return NextResponse.json({ error: "Backup folder not found (or has no db.sql)." }, { status: 404 });

    // Kill every OTHER connection so psql can take the locks it needs.
    try {
      const { db } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(
        sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
    } catch {
      /* best effort */
    }

    const res = await run(findPgTool("psql"), ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", dumpFile, url], 600000);
    if (!res.ok) {
      return NextResponse.json({ error: `Full restore failed at the database step: ${String(res.output).slice(0, 300)}` }, { status: 500 });
    }
    // Database is back — now overlay the saved data files. Files that only
    // exist today and are not in the backup are left untouched (safer).
    const restored = copyDirFiles(path.join(dir, "data"), dataDir());
    logAudit(user, "db.full-restore", "system", `FULL restore from ${name} (db + ${restored} data files)`);
    return NextResponse.json({ ok: true, dir: name, files: restored });
  }

  if (action === "restore") {
    const name = String(body?.file || "");
    if (!name || !name.endsWith(".sql") || name.includes("/") || name.includes("\\") || name.includes("..")) {
      return NextResponse.json({ error: "Invalid backup file name." }, { status: 400 });
    }
    const file = path.join(dumpsDir(), name);
    if (!fs.existsSync(file)) return NextResponse.json({ error: "Backup file not found." }, { status: 404 });

    // Kill every OTHER connection so psql can take the locks it needs.
    try {
      const { db } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(
        sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
    } catch {
      /* best effort */
    }

    const res = await run(findPgTool("psql"), ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", file, url], 600000);
    if (!res.ok) {
      return NextResponse.json({ error: `Restore failed: ${String(res.output).slice(0, 400)}` }, { status: 500 });
    }
    logAudit(user, "db.restore", "system", `Database restored from ${name}`);
    return NextResponse.json({ ok: true, file: name });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
