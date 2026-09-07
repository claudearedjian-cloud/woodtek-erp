import { NextResponse } from "next/server";
import { db } from "@/db";
import { pimsSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

async function upsert(key: string, value: any) {
  const [existing] = await db.select({ id: pimsSettings.id }).from(pimsSettings).where(eq(pimsSettings.settingKey, key));
  if (existing) {
    await db.update(pimsSettings).set({ settingValue: value, updatedAt: new Date() }).where(eq(pimsSettings.id, existing.id));
  } else {
    await db.insert(pimsSettings).values({ settingKey: key, settingValue: value });
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("pims:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();

    if (typeof body.folderPath === "string") {
      await upsert("folder_path", body.folderPath.trim());
    }
    if (body.serviceMap && typeof body.serviceMap === "object") {
      await upsert("service_map", body.serviceMap);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST pims settings error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save PIMS settings" }, { status: 500 });
  }
}
