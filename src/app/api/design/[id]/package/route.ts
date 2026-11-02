import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveDesignId } from "@/lib/designDepartment";
import { isSafeDesignFileName } from "@/lib/designAttachments";
import { designDrawingDetail } from "@/lib/designDepartment.server";
import { DESIGN_NO_STORE, designFailure } from "@/lib/designRoute.server";
import {
  buildDesignTransmittalHtml,
  designPackageManifestCsv,
  designTransmittalFilename,
  designTransmittalText,
} from "@/lib/designTransmittal";
import {
  createStoredZip,
  safeZipEntryName,
  uniqueZipEntryName,
  type StoredZipEntry,
} from "@/lib/zipStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function designUploadsDir(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "uploads", "design");
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "drawing-package.zip";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function modifiedDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  try {
    const drawingId = positiveDesignId((await context.params).id, "Drawing id");
    const detail = await designDrawingDetail(drawingId);
    const files = Array.isArray(detail.files) ? detail.files : [];
    const generatedAt = new Date();
    const packageStem = designTransmittalFilename(detail, "zip").replace(/-transmittal\.zip$/i, "");
    const folder = safeZipEntryName(packageStem, "drawing-package");
    const usedNames = new Set<string>();
    const entries: StoredZipEntry[] = [];
    const encoder = new TextEncoder();
    const missing: string[] = [];

    const addEntry = (name: string, data: Uint8Array, modified?: Date) => {
      entries.push({
        name: uniqueZipEntryName(`${folder}/${name}`, usedNames, "file"),
        data,
        modified,
      });
    };

    addEntry(
      "transmittal.html",
      encoder.encode(buildDesignTransmittalHtml(detail, files, generatedAt)),
      generatedAt,
    );
    addEntry(
      "transmittal.txt",
      encoder.encode(designTransmittalText(detail, files, generatedAt)),
      generatedAt,
    );
    addEntry(
      "manifest.csv",
      encoder.encode(designPackageManifestCsv(detail, files)),
      generatedAt,
    );

    for (const file of files as any[]) {
      const storedName = String(file.fileName || "");
      const displayName = String(file.originalName || storedName || `design-file-${file.id ?? "download"}`);
      if (!isSafeDesignFileName(storedName)) {
        missing.push(`${displayName} — unsafe stored file name; skipped for safety.`);
        continue;
      }
      const full = path.join(designUploadsDir(), storedName);
      if (!fs.existsSync(full)) {
        missing.push(`${displayName} — stored data was not found on the server.`);
        continue;
      }
      addEntry(
        `files/${displayName}`,
        new Uint8Array(fs.readFileSync(full)),
        modifiedDate(file.createdAt),
      );
    }

    if (missing.length > 0) {
      addEntry(
        "MISSING-FILES.txt",
        encoder.encode([
          "Some files recorded for this drawing revision could not be included:",
          "",
          ...missing.map((item) => `- ${item}`),
          "",
          "Ask the Manager to check the Design Department upload folder on the server.",
          "",
        ].join("\n")),
        generatedAt,
      );
    }

    let zip: Uint8Array<ArrayBuffer>;
    try {
      zip = createStoredZip(entries);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The drawing package is too large to create.";
      if (/zip|4\s*gb|too many|too large/i.test(message)) {
        return NextResponse.json(
          { error: `Could not create the drawing package: ${message} Download the largest files individually instead.` },
          { status: 413, headers: DESIGN_NO_STORE },
        );
      }
      throw cause;
    }

    const filename = `${packageStem}-package.zip`;
    logAudit(
      user,
      "design.drawing.package",
      "design-drawing",
      `Downloaded drawing package for ${detail.recordNumber} (${Math.max(0, entries.length - 3 - (missing.length ? 1 : 0))} uploaded files${missing.length ? `, ${missing.length} missing` : ""})`,
      drawingId,
    );
    return new NextResponse(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zip.length),
        "Content-Disposition": contentDisposition(filename),
        "X-Content-Type-Options": "nosniff",
        ...DESIGN_NO_STORE,
      },
    });
  } catch (cause) {
    return designFailure(cause);
  }
}
