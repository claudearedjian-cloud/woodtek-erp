// ============================================================================
// Per-material machine routing.
//   GET ?orderId=N → { routes: {"<orderMaterialsId>": ["Beam Saw", …]} }
//                    (orders:read, only that order's lines)
//   PUT {orderId, routes:[{orderMaterialsId, steps:[category, …]}]}
//                    (orders:write — set at order creation / Manager edits;
//                     steps validated, lines must belong to the order,
//                     empty steps = back to the order's default routing)
// Storage: data/material-routes.json (no migration). Pure helpers in
// src/lib/materialRoutes.ts. Audited.
// ============================================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { baseRoleOf, can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import { sanitizeRouteSteps } from "@/lib/materialRoutes";
import { readAllRoutes, writeAllRoutes } from "@/lib/materialRoutes.server";
import { findProductionItemByMaterial, routeStageKeys } from "@/lib/productionPlan";
import { readOrderProductionPlan } from "@/lib/productionPlan.server";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(baseRoleOf(user.role), "orders:read")) {
    return NextResponse.json({ error: "You cannot view material routings." }, { status: 403 });
  }
  const orderId = Number(new URL(request.url).searchParams.get("orderId"));
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
  }
  try {
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    const all = readAllRoutes();
    const productionPlan = readOrderProductionPlan(orderId);
    const routes: Record<string, string[]> = {};
    const routeDetails: Record<string, any> = {};
    for (const line of lines) {
      const planned = findProductionItemByMaterial(productionPlan, line.id);
      if (planned) {
        routes[String(line.id)] = routeStageKeys(planned);
        routeDetails[String(line.id)] = planned;
        continue;
      }
      const hit = all[String(line.id)];
      if (hit) routes[String(line.id)] = hit;
    }
    return NextResponse.json({ routes, routeDetails });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load material routings" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(baseRoleOf(user.role), "orders:write")) {
    return NextResponse.json({ error: "You cannot set material routings." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const orderId = Number(body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0 || !Array.isArray(body?.routes)) {
      return NextResponse.json({ error: "A valid orderId and routes list are required." }, { status: 400 });
    }
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    const validIds = new Set(lines.map((l) => l.id));
    const productionPlan = readOrderProductionPlan(orderId);
    const plannedIds = new Set((productionPlan?.items ?? []).map((item) => item.materialId));
    if (body.routes.some((entry: any) => plannedIds.has(Number(entry?.orderMaterialsId)))) {
      return NextResponse.json(
        { error: "This order uses independent material jobs. Change its production plan instead of the legacy route overlay." },
        { status: 409 },
      );
    }

    const all = readAllRoutes();
    let saved = 0;
    for (const entry of body.routes) {
      const materialId = Number(entry?.orderMaterialsId);
      if (!Number.isInteger(materialId) || !validIds.has(materialId)) continue;
      const steps = sanitizeRouteSteps(entry?.steps);
      if (steps.length > 0) {
        all[String(materialId)] = steps;
      } else {
        delete all[String(materialId)];
      }
      saved++;
    }
    writeAllRoutes(all);
    logAudit(
      user,
      "material.route",
      "order",
      `Material routings set on ${saved} line(s)`,
      orderId,
    );
    return NextResponse.json({ ok: true, saved });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save the material routings" }, { status: 500 });
  }
}
