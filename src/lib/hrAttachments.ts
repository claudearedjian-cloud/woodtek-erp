// ============================================================================
// Employee-card attachments — pure, client-safe validation helpers.
// Personal photos: JPG/PNG/WebP up to 8 MB, one per employee (re-upload
// replaces). HR documents (ID copy, passport, visa, residency, …):
// JPG/PNG/WebP/PDF up to 10 MB, at most 20 per employee.
// Files live in <data dir>/uploads/hr/; the API routes own the storage.
// ============================================================================

export const MAX_HR_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_HR_DOC_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_HR_DOCS_PER_EMPLOYEE = 20;

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DOC_EXT: Record<string, string> = {
  ...PHOTO_EXT,
  "application/pdf": "pdf",
};

/** Extension for an accepted photo MIME type, or null when rejected. */
export function hrPhotoExtFor(mime: string): string | null {
  return Object.prototype.hasOwnProperty.call(PHOTO_EXT, mime) ? PHOTO_EXT[mime] : null;
}

/** Extension for an accepted document MIME type, or null when rejected. */
export function hrDocExtFor(mime: string): string | null {
  return Object.prototype.hasOwnProperty.call(DOC_EXT, mime) ? DOC_EXT[mime] : null;
}

/** Human-readable rejection reason, or null when the photo is acceptable. */
export function validateHrPhoto(mime: string, size: number): string | null {
  if (!hrPhotoExtFor(mime)) return "Only JPG, PNG or WebP photos are supported.";
  if (!Number.isFinite(size) || size <= 0) return "The file is empty.";
  if (size > MAX_HR_PHOTO_BYTES) return "Photos must be 8 MB or smaller.";
  return null;
}

/** Human-readable rejection reason, or null when the document is acceptable. */
export function validateHrDocument(mime: string, size: number): string | null {
  if (!hrDocExtFor(mime)) return "Only JPG, PNG, WebP or PDF documents are supported.";
  if (!Number.isFinite(size) || size <= 0) return "The file is empty.";
  if (size > MAX_HR_DOC_BYTES) return "Documents must be 10 MB or smaller.";
  return null;
}

/** Stored names are server-generated; accept only that exact shape. */
export function isSafeHrPhotoName(name: string): boolean {
  return /^hr-photo-\d+-\d+\.(jpg|png|webp)$/.test(name);
}

/** Stored names are server-generated; accept only that exact shape. */
export function isSafeHrDocName(name: string): boolean {
  return /^hr-doc-\d+-\d+-\d+\.(jpg|png|webp|pdf)$/.test(name);
}

export function hrPhotoContentType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export function hrDocContentType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}
