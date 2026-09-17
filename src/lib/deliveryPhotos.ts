// ============================================================================
// Delivery photos — proof-of-delivery pictures taken at the gate (phone camera
// or tablet). Files live in <data dir>/uploads/delivery/, metadata in
// data/delivery-photos.json. Pure validation helpers here; the API route in
// src/app/api/delivery-photos/route.ts does the storage work. No migration.
// ============================================================================

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB per picture
export const MAX_PHOTOS_PER_ORDER = 12;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Extension for an accepted image MIME type, or null when rejected. */
export function photoExtFor(mime: string): string | null {
  return Object.prototype.hasOwnProperty.call(MIME_EXT, mime) ? MIME_EXT[mime] : null;
}

/** Human-readable rejection reason, or null when the file is acceptable. */
export function validatePhoto(mime: string, size: number): string | null {
  if (!photoExtFor(mime)) return "Only JPG, PNG or WebP pictures are supported.";
  if (!Number.isFinite(size) || size <= 0) return "The file is empty.";
  if (size > MAX_PHOTO_BYTES) return "Pictures must be 8 MB or smaller.";
  return null;
}

/**
 * Stored names are server-generated. Keep accepting legacy order names and the
 * new independent material-batch names.
 */
export function isSafeStoredPhotoName(name: string): boolean {
  return /^(delivery-\d+-\d+-\d+|delivery-batch-\d+-\d+-\d+)\.(jpg|png|webp)$/.test(name);
}

export interface DeliveryPhotoMeta {
  file: string;
  at: string;
  by: string;
  size: number;
}

export function sanitizePhotoMeta(raw: unknown): DeliveryPhotoMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: DeliveryPhotoMeta[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const file = String(entry.file ?? "");
    if (!isSafeStoredPhotoName(file)) continue;
    out.push({
      file,
      at: typeof entry.at === "string" ? entry.at.slice(0, 40) : "",
      by: typeof entry.by === "string" ? entry.by.slice(0, 120) : "—",
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
    });
  }
  return out.slice(0, MAX_PHOTOS_PER_ORDER);
}
