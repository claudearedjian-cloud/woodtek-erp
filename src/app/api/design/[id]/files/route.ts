import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  DESIGN_FILE_KINDS,
  positiveDesignId,
} from "@/lib/designDepartment";
import {
  designFileContentType,
  designFileExtension,
  isSafeDesignFileName,
  validateDesignFile,
} from "@/lib/designAttachments";
import {
  createDesignDrawingFile,
  deleteDesignDrawingFile,
  getDesignDrawingFile,
  listDesignDrawingFiles,
} from "@/lib/designDepartment.server";
import { DESIGN_NO_STORE, designFailure } from "@/lib/designRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function designUploadsDir(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "uploads", "design");
}

function contentDisposition(originalName: string, fallback: string, download: boolean): string {
  const display = originalName || fallback;
  const ascii = display.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").slice(0, 160) || fallback;
  const encoded = encodeURIComponent(display);
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { error } = await authorizeModule("design");
  if (error) return error;
  try {
    const drawingId = positiveDesignId((await context.params).id, "Drawing id");
    const params = new URL(request.url).searchParams;
    const rawFileId = params.get("fileId");
    if (rawFileId === null) {
      return NextResponse.json(await listDesignDrawingFiles(drawingId), {
        headers: DESIGN_NO_STORE,
      });
    }
    const fileId = positiveDesignId(rawFileId, "Drawing file id");
    const file = await getDesignDrawingFile(drawingId, fileId);
    if (!file || !isSafeDesignFileName(file.fileName)) {
      return NextResponse.json(
        { error: "Drawing file not found." },
        { status: 404, headers: DESIGN_NO_STORE },
      );
    }
    const full = path.join(designUploadsDir(), file.fileName);
    if (!fs.existsSync(full)) {
      return NextResponse.json(
        { error: "Drawing file data not found on the server." },
        { status: 404, headers: DESIGN_NO_STORE },
      );
    }
    const bytes = new Uint8Array(fs.readFileSync(full));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": designFileContentType(file.fileName),
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(
          file.originalName || file.fileName,
          file.fileName,
          params.get("download") === "1",
        ),
        "X-Content-Type-Options": "nosniff",
        ...DESIGN_NO_STORE,
      },
    });
  } catch (cause) {
    return designFailure(cause);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  let storedName = "";
  try {
    const drawingId = positiveDesignId((await context.params).id, "Drawing id");
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "Drawing PDF/CAD").trim();
    if (!(DESIGN_FILE_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json(
        { error: "Choose a valid drawing file type." },
        { status: 400, headers: DESIGN_NO_STORE },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { error: "Choose a drawing file to upload." },
        { status: 400, headers: DESIGN_NO_STORE },
      );
    }
    const problem = validateDesignFile(file.name || "", file.type || "", file.size);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400, headers: DESIGN_NO_STORE });
    }
    const ext = designFileExtension(file.name || "", file.type || "");
    if (!ext) {
      return NextResponse.json(
        { error: "Unsupported drawing file type." },
        { status: 400, headers: DESIGN_NO_STORE },
      );
    }

    const existing = await listDesignDrawingFiles(drawingId);
    const uploads = designUploadsDir();
    fs.mkdirSync(uploads, { recursive: true });
    let suffix = existing.length + 1;
    storedName = `design-${drawingId}-${Date.now()}-${suffix}.${ext}`;
    while (fs.existsSync(path.join(uploads, storedName))) {
      suffix += 1;
      storedName = `design-${drawingId}-${Date.now()}-${suffix}.${ext}`;
    }
    fs.writeFileSync(path.join(uploads, storedName), new Uint8Array(await file.arrayBuffer()));

    const created = await createDesignDrawingFile(
      drawingId,
      {
        kind,
        fileName: storedName,
        originalName: String(file.name || storedName).slice(0, 180),
        mime: file.type || designFileContentType(storedName),
        size: file.size,
      },
      user,
    );
    logAudit(user, "design.file.upload", "design-drawing", `${kind} file uploaded`, drawingId);
    return NextResponse.json(created, { status: 201, headers: DESIGN_NO_STORE });
  } catch (cause) {
    if (storedName && isSafeDesignFileName(storedName)) {
      try {
        const full = path.join(designUploadsDir(), storedName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        // The original failure remains the useful response.
      }
    }
    return designFailure(cause);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  try {
    const drawingId = positiveDesignId((await context.params).id, "Drawing id");
    const fileId = positiveDesignId(
      new URL(request.url).searchParams.get("fileId"),
      "Drawing file id",
    );
    const removed = await deleteDesignDrawingFile(drawingId, fileId, user);
    if (!removed) {
      return NextResponse.json(
        { error: "Drawing file not found." },
        { status: 404, headers: DESIGN_NO_STORE },
      );
    }
    if (isSafeDesignFileName(removed.fileName)) {
      try {
        const full = path.join(designUploadsDir(), removed.fileName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        // Metadata removal is authoritative; a leftover orphan is harmless.
      }
    }
    logAudit(user, "design.file.delete", "design-drawing", `${removed.kind} file deleted`, drawingId);
    return NextResponse.json({ ok: true }, { headers: DESIGN_NO_STORE });
  } catch (cause) {
    return designFailure(cause);
  }
}
