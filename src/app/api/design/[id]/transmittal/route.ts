import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveDesignId } from "@/lib/designDepartment";
import { designDrawingDetail } from "@/lib/designDepartment.server";
import { DESIGN_NO_STORE, designFailure } from "@/lib/designRoute.server";
import {
  buildDesignTransmittalHtml,
  designPackageManifestCsv,
  designTransmittalFilename,
  designTransmittalText,
} from "@/lib/designTransmittal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function contentDisposition(filename: string, download: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "drawing-transmittal.html";
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  try {
    const drawingId = positiveDesignId((await context.params).id, "Drawing id");
    const detail = await designDrawingDetail(drawingId);
    const params = new URL(request.url).searchParams;
    const format = String(params.get("format") || "html").toLowerCase();
    const files = Array.isArray(detail.files) ? detail.files : [];
    let body: string;
    let contentType: string;
    let extension: string;

    if (format === "text" || format === "txt") {
      body = designTransmittalText(detail, files);
      contentType = "text/plain; charset=utf-8";
      extension = "txt";
    } else if (format === "csv") {
      body = designPackageManifestCsv(detail, files);
      contentType = "text/csv; charset=utf-8";
      extension = "csv";
    } else {
      body = buildDesignTransmittalHtml(detail, files);
      contentType = "text/html; charset=utf-8";
      extension = "html";
    }

    const filename = designTransmittalFilename(detail, extension);
    logAudit(
      user,
      "design.drawing.transmittal",
      "design-drawing",
      `Generated ${extension.toUpperCase()} transmittal for ${detail.recordNumber}`,
      drawingId,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(new TextEncoder().encode(body).length),
        "Content-Disposition": contentDisposition(filename, params.get("download") === "1"),
        "X-Content-Type-Options": "nosniff",
        ...DESIGN_NO_STORE,
      },
    });
  } catch (cause) {
    return designFailure(cause);
  }
}
