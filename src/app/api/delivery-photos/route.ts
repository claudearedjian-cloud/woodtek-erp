// ============================================================================
// Delivery photos — proof-of-delivery pictures taken at the gate.
//   GET    ?orderId=N   → {photos:[{file, at, by, size}]} (orders:read)
//   GET    ?file=name   → the picture bytes (orders:read, name validated)
//   POST   formData(orderId, files[])  → save up to 12 JPG/PNG/WebP ≤8MB each
//              → quality:write OR orders:write OR inventory:write
//   DELETE ?orderId=N&file=name → remove one picture (same gate)
// Files: <data dir>/uploads/delivery/delivery-<orderId>-<stamp>-<n>.<ext>
// Meta:  data/delivery-photos.json. No DB migration. Writes are audited.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
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

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function uploadsDir(): string {
  return path.join(dataDir(), "uploads", "delivery");
}

function metaLocation(): string {
  return path.join(dataDir(), "delivery-photos.json");
}

function readMeta(): Record<string, DeliveryPhotoMeta[]> {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaLocation(), "utf8"));
    const orders = parsed?.orders;
    if (orders && typeof orders === "object" && !Array.isArray(orders)) {
      const out: Record<string, DeliveryPhotoMeta[]> = {};
      for (const [key, value] of Object.entries(orders)) {
        if (/^\d+$/.test(key)) out[key] = sanitizePhotoMeta(value);
      }
      return out;
    }
  } catch {
    /* missing or corrupt */
  }
  return {};
}

function writeMeta(meta: Record<string, DeliveryPhotoMeta[]>): void {
  const file = metaLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, orders: meta }, null, 2), "utf8");
}

function canWrite(role: string): boolean {
  return can(role, "quality:write") || can(role, "orders:write") || can(role, "inventory:write");
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

  // Serve one picture's bytes.
  const file = params.get("file");
  if (file) {
    if (!isSafeStoredPhotoName(file)) {
      return NextResponse.json({ error: "Invalid photo name." }, { status: 400 });
    }
    const full = path.join(uploadsDir(), file);
    if (!fs.existsSync(full)) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }
    const ext = file.slice(file.lastIndexOf(".") + 1);
    const bytes = new Uint8Array(fs.readFileSync(full));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // List one order's pictures.
  const orderId = Number(params.get("orderId"));
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
  }
  return NextResponse.json({ photos: readMeta()[String(orderId)] ?? [] });
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
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
    }
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json({ error: "Choose at least one picture." }, { status: 400 });
    }
    const meta = readMeta();
    const existing = meta[String(orderId)] ?? [];
    if (existing.length + files.length > MAX_PHOTOS_PER_ORDER) {
      return NextResponse.json(
        { error: `At most ${MAX_PHOTOS_PER_ORDER} photos per order (${existing.length} already saved).` },
        { status: 400 },
      );
    }
    const stamp = Date.now();
    const saved: DeliveryPhotoMeta[] = [];
    let index = existing.length + 1;
    for (const file of files) {
      const problem = validatePhoto(file.type, file.size);
      if (problem) return NextResponse.json({ error: `${file.name || "Picture"}: ${problem}` }, { status: 400 });
      const ext = photoExtFor(file.type) as string;
      const name = `delivery-${orderId}-${stamp}-${index}.${ext}`;
      const full = path.join(uploadsDir(), name);
      fs.mkdirSync(uploadsDir(), { recursive: true });
      fs.writeFileSync(full, new Uint8Array(await file.arrayBuffer()));
      saved.push({ file: name, at: new Date().toISOString(), by: user.name || user.role, size: file.size });
      index++;
    }
    meta[String(orderId)] = [...existing, ...saved];
    writeMeta(meta);
    logAudit(user, "delivery.photo.upload", "order", `${saved.length} delivery photo(s) uploaded`, orderId);
    return NextResponse.json({ ok: true, photos: meta[String(orderId)] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to upload the photos" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: "You cannot delete delivery photos." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const orderId = Number(params.get("orderId"));
  const file = params.get("file") ?? "";
  if (!Number.isInteger(orderId) || orderId <= 0 || !isSafeStoredPhotoName(file)) {
    return NextResponse.json({ error: "A valid orderId and file are required." }, { status: 400 });
  }
  const meta = readMeta();
  const list = meta[String(orderId)] ?? [];
  if (!list.some((p) => p.file === file)) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  const full = path.join(uploadsDir(), file);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    /* keep going — the metadata removal is what matters */
  }
  meta[String(orderId)] = list.filter((p) => p.file !== file);
  writeMeta(meta);
  logAudit(user, "delivery.photo.delete", "order", `Delivery photo deleted (${file})`, orderId);
  return NextResponse.json({ ok: true, photos: meta[String(orderId)] });
}
