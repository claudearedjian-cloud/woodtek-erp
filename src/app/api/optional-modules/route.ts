// ============================================================================
// Optional-module grants API.
//
// GET is open to the signed-in workspace (module ids are not secret and the
// client needs them at bootstrap, same policy as /api/roles) — it only ever
// returns module ids and grant lists, never money or client data.
// PUT is Manager-only (users:manage) and writes one audit entry describing
// exactly what changed.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  moduleLabel,
  sanitizeOptionalModules,
  summarizeOptionalModuleChange,
} from "@/lib/optionalModules";
import { isOptionalModuleInstalled } from "@/lib/installedEdition";
import { hasInstalledEditionFile, readInstalledEdition } from "@/lib/installedEdition.server";
import { readOptionalModules, writeOptionalModules } from "@/lib/optionalModules.server";

export async function GET() {
  const { error } = await authorize();
  if (error) return error;

  try {
    return NextResponse.json(readOptionalModules());
  } catch {
    // Never fail the workspace bootstrap on a corrupt file: hand back the
    // factory default (Invoicing on, Sales Coordinator granted).
    return NextResponse.json({
      version: 1,
      enabled: ["invoicing"],
      roles: { "Sales Coordinator": ["invoicing"] },
      users: {},
    });
  }
}

export async function PUT(request: Request) {
  const { user, error } = await authorize("users:manage");
  if (error) return error;

  try {
    const body = (await request.json()) as unknown;
    const requested = sanitizeOptionalModules(body);
    if (hasInstalledEditionFile()) {
      const edition = readInstalledEdition();
      for (const modId of requested.enabled) {
        if (!isOptionalModuleInstalled(modId, edition)) {
          return NextResponse.json(
            {
              error: `${moduleLabel(modId)} is not installed on this PC. Re-run WoodTek ERP Setup (.exe) to install this module.`,
            },
            { status: 403 },
          );
        }
      }
    }
    const prev = readOptionalModules();
    const next = writeOptionalModules(requested);

    logAudit(user, "optional-modules.save", "system", summarizeOptionalModuleChange(prev, next));
    return NextResponse.json(next);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save optional modules";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
