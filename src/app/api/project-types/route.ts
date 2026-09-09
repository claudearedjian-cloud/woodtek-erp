// ============================================================================
// Project category list. JSON file in <project>/data. GET is open (metadata;
// without a file it returns the defaults merged with whatever the orders
// already use). PUT requires Manager (users:manage) and refuses to drop
// categories still used by orders.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { DEFAULT_PROJECT_TYPES, sanitizeProjectTypes } from "@/lib/projectTypes";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "project-types.json");
}

function readTypes(): string[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (Array.isArray(parsed?.types)) return sanitizeProjectTypes(parsed.types);
    return null;
  } catch {
    return null;
  }
}

async function dbTypes(): Promise<string[]> {
  try {
    const rows = await db.selectDistinct({ projectType: orders.projectType }).from(orders);
    return sanitizeProjectTypes(rows.map((r) => r.projectType));
  } catch {
    return [];
  }
}

export async function GET() {
  const fromFile = readTypes();
  if (fromFile) return NextResponse.json({ types: fromFile });
  return NextResponse.json({
    types: Array.from(new Set([...DEFAULT_PROJECT_TYPES, ...(await dbTypes())])),
  });
}

export async function PUT(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const body = await request.json();
    const next = sanitizeProjectTypes(body?.types);

    // Refuse to remove categories that orders still carry.
    const previous =
      readTypes() ?? Array.from(new Set([...DEFAULT_PROJECT_TYPES, ...(await dbTypes())]));
    for (const old of previous) {
      if (next.some((n) => n.toLowerCase() === old.toLowerCase())) continue;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`lower(${orders.projectType}) = lower(${old})`);
      if (row && Number(row.n) > 0) {
        return NextResponse.json(
          {
            error: `"${old}" is used by ${row.n} order(s), so it cannot be removed.`,
          },
          { status: 400 },
        );
      }
    }

    const file = fileLocation();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, types: next }, null, 2), "utf8");
    return NextResponse.json({ types: next });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save project categories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
