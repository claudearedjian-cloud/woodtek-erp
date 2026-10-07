// ============================================================================
// Warehouse register API — the places stock lives.
//
// GET    any signed-in role with inventory:read — the register plus how many
//        stock items (and units) sit in each warehouse.
// POST   inventory:write — add a warehouse. Name is required and unique.
// PUT    inventory:write — edit/rename. A rename moves the stock rows already
//        stored under the old name, so nothing is ever orphaned.
// DELETE users:manage (Manager) — remove a warehouse. Refused while stock
//        items still live there unless force=1, which moves them to the first
//        remaining warehouse. The last warehouse can never be deleted.
//
// Storage: data/warehouses.json (no database migration).
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  MAX_WAREHOUSES,
  cleanWarehouseText,
  sanitizeWarehouse,
  slugifyWarehouseId,
  validateWarehouseInput,
  warehouseRename,
  type Warehouse,
} from "@/lib/warehouses";
import {
  effectiveWarehouseList,
  renameWarehouseItems,
  warehouseItemCount,
  warehouseUsage,
  writeWarehousesFile,
} from "@/lib/warehouses.server";

export const dynamic = "force-dynamic";

async function payload(list?: Warehouse[]) {
  return NextResponse.json({ warehouses: await warehouseUsage(list) });
}

export async function GET() {
  const { error } = await authorize("inventory:read");
  if (error) return error;
  try {
    return await payload();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to read warehouses" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error } = await authorize("inventory:write");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const list = effectiveWarehouseList();
  if (list.length >= MAX_WAREHOUSES) {
    return NextResponse.json({ error: `A factory holds at most ${MAX_WAREHOUSES} warehouses.` }, { status: 400 });
  }

  const draft = sanitizeWarehouse({ ...body, id: "" }, slugifyWarehouseId(body?.name));
  if (!draft) return NextResponse.json({ error: "Give the warehouse a name." }, { status: 400 });
  const problem = validateWarehouseInput(draft, list);
  if (problem) return NextResponse.json({ error: problem.error }, { status: 400 });

  // Never reuse an existing id, even after a delete/rename dance.
  const taken = new Set(list.map((warehouse) => warehouse.id));
  let id = draft.id;
  let bump = 2;
  while (taken.has(id)) {
    id = `${draft.id}-${bump}`.slice(0, 60);
    bump += 1;
  }

  const next = [...list, { ...draft, id, createdAt: new Date().toISOString() }];
  const saved = writeWarehousesFile(next);
  logAudit(user, "warehouse.add", "inventory", `Warehouse added: ${draft.name}`);
  return await payload(saved);
}

export async function PUT(request: Request) {
  const { user, error } = await authorize("inventory:write");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const list = effectiveWarehouseList();
  const id = cleanWarehouseText(body?.id, 60);
  const previous = list.find((warehouse) => warehouse.id === id) ?? null;
  if (!previous) return NextResponse.json({ error: "That warehouse no longer exists." }, { status: 404 });

  const draft = sanitizeWarehouse({ ...body, id: previous.id }, previous.id);
  if (!draft) return NextResponse.json({ error: "Give the warehouse a name." }, { status: 400 });
  const problem = validateWarehouseInput(draft, list, { editingId: previous.id });
  if (problem) return NextResponse.json({ error: problem.error }, { status: 400 });

  const rename = warehouseRename(previous, draft);
  const next = list.map((warehouse) => (warehouse.id === previous.id ? { ...draft, createdAt: previous.createdAt } : warehouse));
  const saved = writeWarehousesFile(next);

  // Items keep the name as text — move them with the warehouse.
  let moved = 0;
  if (rename) moved = await renameWarehouseItems(rename.from, rename.to);

  logAudit(
    user,
    rename ? "warehouse.rename" : "warehouse.edit",
    "inventory",
    rename
      ? `Warehouse renamed ${rename.from} → ${rename.to}${moved ? ` (${moved} stock item${moved === 1 ? "" : "s"} moved)` : ""}`
      : `Warehouse updated: ${draft.name}`,
  );
  return await payload(saved);
}

export async function DELETE(request: Request) {
  const { user, error } = await authorize("users:manage");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = cleanWarehouseText(url.searchParams.get("id"), 60);
  const force = url.searchParams.get("force") === "1";

  const list = effectiveWarehouseList();
  const target = list.find((warehouse) => warehouse.id === id) ?? null;
  if (!target) return NextResponse.json({ error: "That warehouse no longer exists." }, { status: 404 });
  if (list.length <= 1) {
    return NextResponse.json({ error: "Keep at least one warehouse — the factory must have somewhere to put stock." }, { status: 400 });
  }

  const inUse = await warehouseItemCount(target.name);
  if (inUse > 0 && !force) {
    return NextResponse.json(
      {
        error: `"${target.name}" still holds ${inUse} stock item${inUse === 1 ? "" : "s"}. Move them first, or confirm to move them into another warehouse.`,
        itemCount: inUse,
      },
      { status: 409 },
    );
  }

  // Force: the stranded items move to the first remaining warehouse.
  const next = list.filter((warehouse) => warehouse.id !== target.id);
  const fallback = next[0];
  const moved = inUse > 0 ? await renameWarehouseItems(target.name, fallback.name) : 0;
  const saved = writeWarehousesFile(next);

  logAudit(
    user,
    "warehouse.delete",
    "inventory",
    `Warehouse deleted: ${target.name}${moved ? ` — ${moved} stock item${moved === 1 ? "" : "s"} moved to ${fallback.name}` : ""}`,
  );
  return await payload(saved);
}
