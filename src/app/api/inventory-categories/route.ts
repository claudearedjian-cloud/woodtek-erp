// ============================================================================
// Stock category list (Wood & Edge Stock). JSON file in <data> dir.
// GET is open to inventory:read (metadata). PUT requires Manager
// (users:manage) and refuses to remove categories still used by items.
// Renames migrate the item rows first, then the list is replaced — same
// convention as /api/project-types.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { sanitizeInventoryCategories } from "@/lib/inventoryCategories";
import {
  countItemsByCategory,
  effectiveInventoryCategories,
  readInventoryCategoriesFile,
  renameItemsCategory,
  writeInventoryCategoriesFile,
} from "@/lib/inventoryCategories.server";

interface Rename {
  from: string;
  to: string;
}

function normalizeRenames(input: unknown): { renames: Rename[]; error: string | null } {
  if (input === undefined || input === null) return { renames: [], error: null };
  if (!Array.isArray(input)) return { renames: [], error: "Renames must be a list of from/to pairs." };
  const renames: Rename[] = [];
  const froms = new Set<string>();
  for (const entry of input) {
    const from = String((entry as Rename)?.from ?? "").trim();
    const to = String((entry as Rename)?.to ?? "").trim();
    if (!from || !to) continue;
    if (from.length > 40 || to.length > 40) return { renames: [], error: "Category names must be 40 characters or fewer." };
    if (from.toLowerCase() === to.toLowerCase()) continue;
    const key = from.toLowerCase();
    if (froms.has(key)) return { renames: [], error: `Category "${from}" appears in more than one rename.` };
    froms.add(key);
    renames.push({ from, to });
    if (renames.length >= 25) break;
  }
  return { renames, error: null };
}

export async function GET() {
  const { error: authError } = await authorize("inventory:read");
  if (authError) return authError;
  const categories = await effectiveInventoryCategories();
  return NextResponse.json({ categories });
}

export async function PUT(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const body = await request.json();
    const next = sanitizeInventoryCategories(body?.categories);
    if (next.length === 0) {
      return NextResponse.json({ error: "Keep at least one stock category." }, { status: 400 });
    }
    const { renames, error: renameError } = normalizeRenames(body?.renames);
    if (renameError) return NextResponse.json({ error: renameError }, { status: 400 });

    const previous = readInventoryCategoriesFile() ?? await effectiveInventoryCategories();

    // Every rename source must exist, and every target must be new.
    for (const rename of renames) {
      if (!previous.some((c) => c.toLowerCase() === rename.from.toLowerCase())) {
        return NextResponse.json({ error: `"${rename.from}" is not an existing category.` }, { status: 400 });
      }
      const collision = next.find(
        (c) => c.toLowerCase() === rename.to.toLowerCase() && c.toLowerCase() !== rename.from.toLowerCase(),
      );
      if (collision) {
        return NextResponse.json({ error: `"${rename.to}" already exists — choose another name.` }, { status: 400 });
      }
    }

    // Move item rows first, then remove-protection sees the new names.
    for (const rename of renames) {
      await renameItemsCategory(rename.from, rename.to);
    }

    // Refuse to remove categories that items still carry.
    for (const old of previous) {
      if (next.some((n) => n.toLowerCase() === old.toLowerCase())) continue;
      const count = await countItemsByCategory(old);
      if (count > 0) {
        return NextResponse.json(
          { error: `"${old}" is used by ${count} item(s), so it cannot be removed. Rename it or move its items first.` },
          { status: 400 },
        );
      }
    }

    writeInventoryCategoriesFile(next);
    return NextResponse.json({ categories: next });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save stock categories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
