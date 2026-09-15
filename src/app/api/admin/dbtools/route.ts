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
    return NextResponse.json({ dumps, keep: keepCount() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to list backups" }, { status: 500 });
  }
}

/** How many dumps to keep (WOODTEK_DB_BACKUP_KEEP, default 30). */
function keepCount(): number {
  const n = Math.floor(Number(process.env.WOODTEK_DB_BACKUP_KEEP) || 30);
  return Math.max(3, n);
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
