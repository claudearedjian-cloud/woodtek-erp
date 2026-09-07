import { NextResponse } from "next/server";
import { db } from "@/db";
import { cmmsSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

const DEFAULTS: Record<string, unknown> = {
  service_interval_hours: 500,
  site_locations: ["Main Plant Bay A", "Power Substation 1", "Substation 2 / Yard", "Assembly Line 3"],
  operation_categories: [
    "Preventative Maintenance",
    "Oil & Filter Replacement",
    "Generators Load Test",
    "Calibration & Alignment",
    "Emergency Repair",
  ],
};

async function readAll() {
  const rows = await db.select().from(cmmsSettings);
  const map: Record<string, any> = { ...DEFAULTS };
  for (const row of rows) map[row.settingKey] = row.settingValue;
  return map;
}

async function writeSetting(key: string, value: unknown) {
  const existing = await db.select().from(cmmsSettings).where(eq(cmmsSettings.settingKey, key));
  if (existing.length > 0) {
    await db
      .update(cmmsSettings)
      .set({ settingValue: value as any, updatedAt: new Date() })
      .where(eq(cmmsSettings.settingKey, key));
  } else {
    await db.insert(cmmsSettings).values({ settingKey: key, settingValue: value as any });
  }
}

export async function GET() {
  const { error: authError } = await authorize();
  if (authError) return authError;

  try {
    return NextResponse.json(await readAll());
  } catch (error: any) {
    console.error("GET cmms settings error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("cmms:configure");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, key, value, item } = body;

    // Save a scalar rule (e.g. default service interval)
    if (action === "set") {
      if (!key) return NextResponse.json({ error: "Setting key is required." }, { status: 400 });
      if (key === "service_interval_hours") {
        const hours = Number(value);
        if (!Number.isFinite(hours) || hours < 1) {
          return NextResponse.json({ error: "Service interval must be at least 1 hour." }, { status: 400 });
        }
        await writeSetting(key, Math.round(hours));
      } else {
        await writeSetting(key, value);
      }
      return NextResponse.json(await readAll());
    }

    // Add an item to a list setting (locations / categories)
    if (action === "add") {
      const label = String(item ?? "").trim();
      if (!label) return NextResponse.json({ error: "Please enter a value." }, { status: 400 });

      const current = await readAll();
      const list: string[] = Array.isArray(current[key]) ? current[key] : [];
      if (list.some((entry) => entry.toLowerCase() === label.toLowerCase())) {
        return NextResponse.json({ error: `"${label}" already exists.` }, { status: 409 });
      }
      await writeSetting(key, [...list, label]);
      return NextResponse.json(await readAll());
    }

    // Remove an item from a list setting
    if (action === "remove") {
      const current = await readAll();
      const list: string[] = Array.isArray(current[key]) ? current[key] : [];
      await writeSetting(
        key,
        list.filter((entry) => entry !== item),
      );
      return NextResponse.json(await readAll());
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error: any) {
    console.error("POST cmms settings error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save setting" }, { status: 500 });
  }
}
