// Design Department attachments — pure validation helpers shared by the API,
// UI and render-test. Drawing files live in <data dir>/uploads/design/ and
// their metadata stays behind the Design Department optional-module grant.

export const MAX_DESIGN_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_DESIGN_FILES_PER_DRAWING = 30;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  dwg: "application/acad",
  dxf: "application/dxf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const DESIGN_FILE_EXTENSIONS: readonly string[] = Object.keys(CONTENT_TYPE_BY_EXT);

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function rawExtension(fileName: string): string {
  const clean = String(fileName ?? "").trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/**
 * CAD browsers frequently report application/octet-stream, so a safe file
 * extension is authoritative. MIME is only a fallback when the chosen file
 * has no extension. Executables/scripts/web payloads are never accepted.
 */
export function designFileExtension(fileName: string, mime = ""): string | null {
  const ext = rawExtension(fileName);
  if (ext) return DESIGN_FILE_EXTENSIONS.includes(ext) ? ext : null;
  const byMime = EXT_BY_MIME[String(mime ?? "").trim().toLowerCase()];
  return byMime ?? null;
}

export function validateDesignFile(fileName: string, mime: string, size: number): string | null {
  if (!designFileExtension(fileName, mime)) {
    return "Only PDF, DWG, DXF, PNG, JPG, WebP, ZIP, DOCX or XLSX drawing files are supported.";
  }
  if (!Number.isFinite(size) || size <= 0) return "The drawing file is empty.";
  if (size > MAX_DESIGN_FILE_BYTES) return "Drawing files must be 50 MB or smaller.";
  return null;
}

/** Stored names are server-generated; accept only that exact shape. */
export function isSafeDesignFileName(name: string): boolean {
  return /^design-\d+-\d+-\d+\.(pdf|dwg|dxf|png|jpe?g|webp|zip|docx|xlsx)$/.test(name);
}

export function designFileContentType(fileName: string): string {
  return CONTENT_TYPE_BY_EXT[rawExtension(fileName)] ?? "application/octet-stream";
}

export const DESIGN_FILE_ACCEPT = DESIGN_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
