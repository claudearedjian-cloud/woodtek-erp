import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { scanPart, togglePartStatus } from "@/lib/assemblyStorage.server";
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

    // Direct toggle / click
    if (action === "toggle" && partId) {
      const res = togglePartStatus(projectId, cabinetId, partId, forceStatus, user.name);
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
