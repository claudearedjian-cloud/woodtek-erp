import { NextResponse } from "next/server";
import { db } from "@/db";
import { pimsSettings, pimsImports, orders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { importPimsInvoice, getServiceMap } from "@/lib/pims";

export async function GET() {
  const { user, error: authError } = await authorize("pims:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [settingRows, importRows] = await Promise.all([
      db.select().from(pimsSettings),
      db.select({
        id: pimsImports.id,
        fileName: pimsImports.fileName,
        invoiceNumber: pimsImports.invoiceNumber,
        customerName: pimsImports.customerName,
        orderId: pimsImports.orderId,
        status: pimsImports.status,
        message: pimsImports.message,
        importedAt: pimsImports.importedAt,
        orderNumber: orders.orderNumber,
      })
        .from(pimsImports)
        .leftJoin(orders, eq(pimsImports.orderId, orders.id))
        .orderBy(desc(pimsImports.importedAt))
        .limit(200),
    ]);

    const settings: Record<string, any> = {};
    for (const r of settingRows) settings[r.settingKey] = r.settingValue;

    return NextResponse.json({
      settings: {
        folderPath: typeof settings.folder_path === "string" ? settings.folder_path : "",
        serviceMap: (settings.service_map && typeof settings.service_map === "object" ? settings.service_map : {}) as Record<string, { operationName: string; machineCategory: string }>,
      },
      imports: importRows,
    });
  } catch (error: any) {
    console.error("GET pims error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load PIMS bridge" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("pims:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const xml = String(body.xml ?? "");
    const fileName = String(body.fileName ?? "manual-import.xml");

    if (!xml.trim()) {
      return NextResponse.json({ error: "Paste the PIMS invoice XML first." }, { status: 400 });
    }

    const result = await importPimsInvoice(xml, fileName);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("POST pims import error:", error);
    return NextResponse.json({ error: error?.message || "Failed to import PIMS invoice" }, { status: 500 });
  }
}
