// ============================================================================
// Custom roles API. GET is open (role names are not sensitive and the client
// needs them at bootstrap); PUT requires Manager (users:manage) and replaces
// the whole custom-role list. Deleting a role that users still carry is
// refused — reassign those users first.
// ============================================================================

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { allRoles } from "@/lib/permissions";
import {
  ensureRolesRegistered,
  readRolesConfig,
  sanitizeOverrides,
  sanitizeRoles,
  writeRolesConfig,
} from "@/lib/rolesConfig.server";

export async function GET() {
  ensureRolesRegistered();
  const cfg = readRolesConfig();
  return NextResponse.json({ roles: cfg.roles, overrides: cfg.overrides });
}

export async function PUT(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const body = await request.json();
    const next = sanitizeRoles(body?.roles);
    const prev = readRolesConfig().roles;

    // Block removal of roles that are still assigned to users.
    for (const old of prev) {
      if (next.some((n) => n.name === old.name)) continue;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.role, old.name));
      if (row && Number(row.n) > 0) {
        return NextResponse.json(
          {
            error: `Role "${old.name}" is still assigned to ${row.n} user(s). Change their role first, then remove it.`,
          },
          { status: 400 },
        );
      }
    }

    // Screen overrides: keep only entries for roles that will still exist
    // after this save; Manager can never be limited (lock-out protection).
    const requestedOverrides = body?.overrides !== undefined ? body.overrides : readRolesConfig().overrides;
    const cleanOverrides = sanitizeOverrides(requestedOverrides);
    const allowedNames = new Set(allRoles());
    const nextOverrides: Record<string, string[]> = {};
    for (const [name, mods] of Object.entries(cleanOverrides)) {
      if (name === "Manager") continue;
      if (allowedNames.has(name) && mods.length > 0) nextOverrides[name] = mods;
    }

    writeRolesConfig(next, nextOverrides);
    return NextResponse.json({ roles: next, overrides: nextOverrides });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save roles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
