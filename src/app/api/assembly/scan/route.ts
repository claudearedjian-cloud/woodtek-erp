import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { clearPartRejection, rejectPart, scanPart, togglePartStatus } from "@/lib/assemblyStorage.server";
import { REJECT_REASONS } from "@/lib/assemblyRejects";
import { logAudit } from "@/lib/audit.server";

export async function POST(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  try {
    const body = await req.json();
    const { projectId, cabinetId, barcodeOrCixRef, partId, action, forceStatus } = body;

    if (!projectId || !cabinetId) {
      return NextResponse.json(
        { error: "projectId and cabinetId are required" },
        { status: 400 }
      );
    }

    // Reject a part (defect or wrong dimensions) at the assembly check.
    if (action === "reject" && partId) {
      const reason = String(body.reason ?? "");
      if (!REJECT_REASONS.some((r) => r.value === reason)) {
        return NextResponse.json({ error: "Choose a reject reason: defect, wrong dimensions or other." }, { status: 400 });
      }
      const res = rejectPart(projectId, cabinetId, partId, reason as any, String(body.note ?? ""), user.name);
      if (!res.success) return NextResponse.json({ error: res.message }, { status: 404 });
      logAudit(user, "assembly.part_rejected", "assembly", `Part ${partId} rejected (${reason}) in project ${projectId}`);
      return NextResponse.json({ success: true, message: res.message, project: res.project });
    }

    // Clear a rejection after the part was fixed or remade.
    if (action === "clear-reject" && partId) {
      const res = clearPartRejection(projectId, cabinetId, partId);
      if (!res.success) return NextResponse.json({ error: res.message }, { status: 404 });
      logAudit(user, "assembly.part_rejection_cleared", "assembly", `Part ${partId} rejection cleared in project ${projectId}`);
      return NextResponse.json({ success: true, message: res.message, project: res.project });
    }

    // Direct toggle / click
    if (action === "toggle" && partId) {
      const res = togglePartStatus(projectId, cabinetId, partId, forceStatus, user.name);
      if (res.rejected) {
        return NextResponse.json(
          { error: "This part is rejected. Fix or remake it, then clear the rejection." },
          { status: 409 }
        );
      }
      if (!res.success) {
        return NextResponse.json({ error: "Failed to update part status" }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        project: res.project,
        cabinetReady: res.cabinetReady,
      });
    }

    // Barcode scan or manual CIX number entry
    if (!barcodeOrCixRef || !barcodeOrCixRef.trim()) {
      return NextResponse.json(
        { error: "Please provide a part barcode or CIX program number to scan." },
        { status: 400 }
      );
    }

    const scanRes = scanPart(projectId, cabinetId, barcodeOrCixRef, user.name);

    if (scanRes.cabinetReady) {
      logAudit(
        user,
        "assembly.cabinet_ready",
        "assembly",
        `Cabinet completed and marked ready for assembly in project ${projectId}`
      );
    }

    return NextResponse.json({
      success: scanRes.success,
      message: scanRes.message,
      matchedPart: scanRes.matchedPart,
      cabinetReady: scanRes.cabinetReady,
      scannedParts: scanRes.scannedParts,
      totalParts: scanRes.totalParts,
      project: scanRes.project,
    });
  } catch (err: any) {
    console.error("Assembly scan error:", err);
    return NextResponse.json({ error: err.message || "Failed to process scan" }, { status: 500 });
  }
}
