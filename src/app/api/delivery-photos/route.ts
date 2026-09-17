// ============================================================================
// Delivery photos — proof pictures per independent material-batch Dispatch row.
// Legacy order-level metadata/files remain readable as a fallback.
// Storage: data/delivery-photos.json + data/uploads/delivery (no migration).
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import {
  MAX_PHOTOS_PER_ORDER,
  isSafeStoredPhotoName,
  photoExtFor,
  sanitizePhotoMeta,
  validatePhoto,
  type DeliveryPhotoMeta,
} from "@/lib/deliveryPhotos";

interface PhotoStore {
  version: 2;
  orders: Record<string, DeliveryPhotoMeta[]>;
  batches: Record<string, DeliveryPhotoMeta[]>;
}

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function uploadsDir(): string {
  return path.join(dataDir(), "uploads", "delivery");
}

function metaLocation(): string {
  return path.join(dataDir(), "delivery-photos.json");
}

function sanitizeMap(raw: unknown): Record<string, DeliveryPhotoMeta[]> {
  const out: Record<string, DeliveryPhotoMeta[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (/^\d+$/.test(key)) out[key] = sanitizePhotoMeta(value);
  }
  return out;
}

function readMeta(): PhotoStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaLocation(), "utf8"));
    return {
      version: 2,
      orders: sanitizeMap(parsed?.orders),
      batches: sanitizeMap(parsed?.batches),
    };
  } catch {
    return { version: 2, orders: {}, batches: {} };
  }
}

function writeMeta(meta: PhotoStore): void {
  const file = metaLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean: PhotoStore = {
    version: 2,
    orders: sanitizeMap(meta.orders),
    batches: sanitizeMap(meta.batches),
  };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function canWrite(role: string): boolean {
  return can(role, "quality:write") || can(role, "orders:write") || can(role, "inventory:write");
}

function photosFor(meta: PhotoStore, orderId: number, batchId: number | null): DeliveryPhotoMeta[] {
  if (batchId !== null) {
    // Copy-on-write fallback keeps historical order photos visible after the
    // Dispatch conversion without coupling new batch uploads to siblings.
    return meta.batches[String(batchId)] ?? meta.orders[String(orderId)] ?? [];
  }
  return meta.orders[String(orderId)] ?? [];
}

async function validBatch(orderId: number, batchId: number | null): Promise<boolean> {
  if (batchId === null) return true;
  const [row] = await db
    .select({ id: orderMaterials.id })
    .from(orderMaterials)
    .where(and(eq(orderMaterials.id, batchId), eq(orderMaterials.orderId, orderId)));
  return Boolean(row);
}

function parseIds(params: URLSearchParams): { orderId: number; batchId: number | null; valid: boolean } {
  const orderId = Number(params.get("orderId"));
  const rawBatch = params.get("batchId");
  const batchId = rawBatch === null || rawBatch === "" ? null : Number(rawBatch);
  return {
    orderId,
    batchId,
    valid: Number.isInteger(orderId) && orderId > 0
      && (batchId === null || (Number.isInteger(batchId) && batchId > 0)),
  };
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view delivery photos." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;

  const file = params.get("file");
  if (file) {
    if (!isSafeStoredPhotoName(file)) {
      return NextResponse.json({ error: "Invalid photo name." }, { status: 400 });
    }
    const full = path.join(uploadsDir(), file);
    if (!fs.existsSync(full)) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    const ext = file.slice(file.lastIndexOf(".") + 1);
    return new NextResponse(new Uint8Array(fs.readFileSync(full)), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const ids = parseIds(params);
  if (!ids.valid) {
    return NextResponse.json({ error: "A valid orderId and optional batchId are required." }, { status: 400 });
  }
  if (!(await validBatch(ids.orderId, ids.batchId))) {
    return NextResponse.json({ error: "Material batch not found on this order." }, { status: 404 });
  }
  const meta = readMeta();
  return NextResponse.json({
    photos: photosFor(meta, ids.orderId, ids.batchId),
    inheritedFromOrder: ids.batchId !== null
      && !Object.prototype.hasOwnProperty.call(meta.batches, String(ids.batchId))
      && Object.prototype.hasOwnProperty.call(meta.orders, String(ids.orderId)),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: "You cannot upload delivery photos." }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const orderId = Number(form.get("orderId"));
    const rawBatch = form.get("batchId");
    const batchId = rawBatch === null || rawBatch === "" ? null : Number(rawBatch);
    if (
      !Number.isInteger(orderId)
      || orderId <= 0
      || (batchId !== null && (!Number.isInteger(batchId) || batchId <= 0))
    ) {
      return NextResponse.json({ error: "A valid orderId and optional batchId are required." }, { status: 400 });
    }
    if (!(await validBatch(orderId, batchId))) {
      return NextResponse.json({ error: "Material batch not found on this order." }, { status: 404 });
    }

    const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
    if (files.length === 0) return NextResponse.json({ error: "Choose at least one picture." }, { status: 400 });
    for (const file of files) {
      const problem = validatePhoto(file.type, file.size);
      if (problem) return NextResponse.json({ error: `${file.name || "Picture"}: ${problem}` }, { status: 400 });
    }

    const meta = readMeta();
    const existing = photosFor(meta, orderId, batchId);
    if (existing.length + files.length > MAX_PHOTOS_PER_ORDER) {
      return NextResponse.json(
        { error: `At most ${MAX_PHOTOS_PER_ORDER} photos per dispatch batch (${existing.length} already saved).` },
        { status: 400 },
      );
    }

    const stamp = Date.now();
    const saved: DeliveryPhotoMeta[] = [];
    let index = existing.length + 1;
    for (const file of files) {
      const ext = photoExtFor(file.type) as string;
      const name = batchId !== null
        ? `delivery-batch-${batchId}-${stamp}-${index}.${ext}`
        : `delivery-${orderId}-${stamp}-${index}.${ext}`;
      fs.mkdirSync(uploadsDir(), { recursive: true });
      fs.writeFileSync(path.join(uploadsDir(), name), new Uint8Array(await file.arrayBuffer()));
      saved.push({ file: name, at: new Date().toISOString(), by: user.name || user.role, size: file.size });
      index += 1;
    }
    const next = [...existing, ...saved];
    if (batchId !== null) meta.batches[String(batchId)] = next;
    else meta.orders[String(orderId)] = next;
    writeMeta(meta);
    logAudit(
      user,
      "delivery.photo.upload",
      batchId !== null ? "order_material" : "order",
      `${saved.length} delivery photo(s) uploaded${batchId !== null ? ` for batch ${batchId}` : ""}`,
      batchId ?? orderId,
    );
    return NextResponse.json({ ok: true, photos: next });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to upload the photos" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: "You cannot delete delivery photos." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const ids = parseIds(params);
  const file = params.get("file") ?? "";
  if (!ids.valid || !isSafeStoredPhotoName(file)) {
    return NextResponse.json({ error: "A valid orderId, optional batchId and file are required." }, { status: 400 });
  }
  if (!(await validBatch(ids.orderId, ids.batchId))) {
    return NextResponse.json({ error: "Material batch not found on this order." }, { status: 404 });
  }

  const meta = readMeta();
  const list = photosFor(meta, ids.orderId, ids.batchId);
  if (!list.some((photo) => photo.file === file)) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  const next = list.filter((photo) => photo.file !== file);
  if (ids.batchId !== null) meta.batches[String(ids.batchId)] = next;
  else meta.orders[String(ids.orderId)] = next;
  writeMeta(meta);

  const stillReferenced = [...Object.values(meta.orders), ...Object.values(meta.batches)]
    .some((photos) => photos.some((photo) => photo.file === file));
  if (!stillReferenced) {
    try {
      const full = path.join(uploadsDir(), file);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      /* metadata removal is authoritative */
    }
  }
  logAudit(
    user,
    "delivery.photo.delete",
    ids.batchId !== null ? "order_material" : "order",
    `Delivery photo deleted (${file})`,
    ids.batchId ?? ids.orderId,
  );
  return NextResponse.json({ ok: true, photos: next });
}
