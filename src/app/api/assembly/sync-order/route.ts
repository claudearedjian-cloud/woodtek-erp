import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { readAssemblyStore, writeAssemblyStore } from "@/lib/assemblyStorage.server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit.server";

/**
 * POST /api/assembly/sync-order
 * Syncs an assembled cabinet milestone into WoodTek ERP's production workflow
 */
export async function POST(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  try {
    const body = await req.json();
    const { projectId, cabinetId, orderId, markComplete } = body;

    if (!projectId || !cabinetId) {
      return NextResponse.json(
        { error: "projectId and cabinetId are required" },
        { status: 400 }
      );
    }

    const store = readAssemblyStore();
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const cabinet = project.cabinets.find((c) => c.id === cabinetId);
    if (!cabinet) {
      return NextResponse.json({ error: "Cabinet not found" }, { status: 404 });
    }

    if (orderId) {
      cabinet.linkedOrderId = Number(orderId);
    }

    if (markComplete) {
      cabinet.isReadyForAssembly = true;
      cabinet.assembledAt = new Date().toISOString();
      cabinet.parts.forEach((p) => {
        p.isScanned = true;
        p.scannedAt = p.scannedAt || new Date().toISOString();
        p.scannedBy = p.scannedBy || user.name;
      });
    }

    writeAssemblyStore(store);

    // If linked to an order, optionally update the order note / status
    if (cabinet.linkedOrderId) {
      try {
        const [ord] = await db.select().from(orders).where(eq(orders.id, cabinet.linkedOrderId));
        if (ord) {
          const newNotes = `${ord.notes || ""}\n[Assembly] Cabinet "${cabinet.name}" verified & ready for assembly.`.trim();
          await db.update(orders).set({ notes: newNotes }).where(eq(orders.id, ord.id));
        }
      } catch (dbErr) {
        console.warn("Could not sync note to order db:", dbErr);
      }
    }

    logAudit(
      user,
      "assembly.sync_order",
      "assembly",
      `Cabinet "${cabinet.name}" synced (Ready: ${cabinet.isReadyForAssembly})`
    );

    return NextResponse.json({
      success: true,
      message: `Cabinet "${cabinet.name}" status updated successfully.`,
      project,
    });
  } catch (err: any) {
    console.error("Sync order error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync" }, { status: 500 });
  }
}
