// ============================================================================
// Machine category list. JSON file in <project>/data (survives rebuilds,
// covered by backups). GET is open (metadata; if no file exists yet, the
// distinct categories already on machines are returned). PUT requires
// machines:write and refuses to drop categories still assigned to machines.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { machines } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { sanitizeCategories } from "@/lib/machineCategories";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "machine-categories.json");
}

function readCategories(): string[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (Array.isArray(parsed?.categories)) return sanitizeCategories(parsed.categories);
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const fromFile = readCategories();
  if (fromFile) return NextResponse.json({ categories: fromFile });
  // No file yet: seed the UI from whatever categories machines already carry.
  try {
    const rows = await db.selectDistinct({ category: machines.category }).from(machines);
    return NextResponse.json({
      categories: sanitizeCategories(rows.map((r) => r.category)).sort(),
    });
  } catch {
    return NextResponse.json({ categories: [] });
  }
}

export async function PUT(request: Request) {
  const { error } = await authorize("machines:write");
  if (error) return error;
  try {
    const body = await request.json();
    const next = sanitizeCategories(body?.categories);

    // Refuse to remove categories that machines still use.
    const existing = readCategories();
    const previous =
      existing ??
      sanitizeCategories(
        (await db.selectDistinct({ category: machines.category }).from(machines)).map((r) => r.category),
      );
    for (const old of previous) {
      if (next.some((n) => n.toLowerCase() === old.toLowerCase())) continue;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(machines)
        .where(sql`lower(${machines.category}) = lower(${old})`);
      if (row && Number(row.n) > 0) {
        return NextResponse.json(
          {
            error: `Category "${old}" is still used by ${row.n} machine(s). Move those machines to another category first.`,
          },
          { status: 400 },
        );
      }
    }

    const file = fileLocation();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, categories: next }, null, 2), "utf8");
    return NextResponse.json({ categories: next });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save categories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
