import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  DesignDepartmentError,
  positiveDesignId,
} from "@/lib/designDepartment";
import { isSafeDesignFileName } from "@/lib/designAttachments";
import {
  changeDesignDrawingStatus,
  createDesignResubmission,
  deleteDesignDrawing,
  designDrawingDetail,
  issueDesignDrawing,
  markDesignComments,
  recordDesignApproval,
  submitDesignDrawing,
  updateDesignDrawing,
} from "@/lib/designDepartment.server";
import { DESIGN_NO_STORE, designFailure } from "@/lib/designRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function designUploadsDir(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "uploads", "design");
}

export async function GET(_request: Request, context: RouteContext) {
  const { error } = await authorizeModule("design");
  if (error) return error;
  try {
    const id = positiveDesignId((await context.params).id, "Drawing id");
    return NextResponse.json(await designDrawingDetail(id), { headers: DESIGN_NO_STORE });
  } catch (cause) {
    return designFailure(cause);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  try {
    const id = positiveDesignId((await context.params).id, "Drawing id");
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body?.action ?? "update").trim();
    let result: any;
    let auditAction: string;
    let auditSummary: string;

    switch (action) {
      case "update":
        result = await updateDesignDrawing(id, body, user);
        auditAction = "design.drawing.update";
        auditSummary = `Updated ${result.recordNumber}`;
        break;
      case "submit":
        result = await submitDesignDrawing(id, body, user);
        auditAction = "design.drawing.submit";
        auditSummary = `Submitted ${result.recordNumber}`;
        break;
      case "approval":
        result = await recordDesignApproval(id, body, user);
        auditAction = "design.drawing.approval";
        auditSummary = `Recorded Code ${result.approvalCode} for ${result.recordNumber}`;
        break;
      case "comments":
        result = await markDesignComments(id, body, user);
        auditAction = "design.drawing.comments";
        auditSummary = `Updated Code B comment incorporation for ${result.recordNumber}`;
        break;
      case "issue":
        result = await issueDesignDrawing(id, body, user);
        auditAction = "design.drawing.issue";
        auditSummary = `Issued ${result.recordNumber} to production`;
        break;
      case "resubmit":
        result = await createDesignResubmission(id, body, user);
        auditAction = "design.drawing.resubmit";
        auditSummary = `Created ${result.recordNumber} revision ${result.revision} from ${result.sourceRecordNumber}`;
        logAudit(user, auditAction, "design-drawing", auditSummary, result.id);
        return NextResponse.json(result, { status: 201, headers: DESIGN_NO_STORE });
      case "status":
        result = await changeDesignDrawingStatus(id, body, user);
        auditAction = "design.drawing.status";
        auditSummary = `Set ${result.recordNumber} to ${result.status}`;
        break;
      default:
        throw new DesignDepartmentError("Choose a valid Design Department action.");
    }

    logAudit(user, auditAction, "design-drawing", auditSummary, id);
    return NextResponse.json(result, { headers: DESIGN_NO_STORE });
  } catch (cause) {
    return designFailure(cause);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  if (user.role !== "Manager") {
    return NextResponse.json(
      { error: "Only a Manager can delete a Design Department draft." },
      { status: 403, headers: DESIGN_NO_STORE },
    );
  }
  try {
    const id = positiveDesignId((await context.params).id, "Drawing id");
    const result = await deleteDesignDrawing(id, user);
    for (const fileName of result.fileNames) {
      if (!isSafeDesignFileName(fileName)) continue;
      try {
        const full = path.join(designUploadsDir(), fileName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        // The database delete is authoritative; an orphaned file is ignored.
      }
    }
    logAudit(
      user,
      "design.drawing.delete",
      "design-drawing",
      `Deleted draft ${result.recordNumber} (${result.drawingNo} rev ${result.revision})`,
      id,
    );
    return NextResponse.json(
      { id, recordNumber: result.recordNumber, deleted: true },
      { headers: DESIGN_NO_STORE },
    );
  } catch (cause) {
    return designFailure(cause);
  }
}
