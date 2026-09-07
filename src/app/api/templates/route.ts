import { NextResponse } from "next/server";
import { db } from "@/db";
import { operationTemplates } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

export async function GET() {
  const { error: authError } = await authorize();
  if (authError) return authError;

  try {
    const tpls = await db.select().from(operationTemplates).orderBy(asc(operationTemplates.name));
    return NextResponse.json(tpls);
  } catch (error: any) {
    console.error("GET templates error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch operation templates" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("recipes:write");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, description, defaultStepsJson } = body;

    if (!name || !defaultStepsJson || !Array.isArray(defaultStepsJson)) {
      return NextResponse.json({ error: "Name and steps array are required." }, { status: 400 });
    }

    // Normalize steps: sequential stepOrder, trimmed fields, sane minutes.
    const steps = defaultStepsJson.map((s: any, i: number) => ({
      stepOrder: i + 1,
      operationName: String(s.operationName || "").trim(),
      machineCategory: String(s.machineCategory || "").trim(),
      estimatedMinutes: Number(s.estimatedMinutes) || 60,
    })).filter((s: any) => s.operationName);

    if (steps.length === 0) {
      return NextResponse.json({ error: "A recipe needs at least one named step." }, { status: 400 });
    }

    const [newTpl] = await db.insert(operationTemplates).values({
      name: String(name).trim(),
      description: description || "Custom workflow routing",
      defaultStepsJson: steps,
    }).returning();

    return NextResponse.json(newTpl, { status: 201 });
  } catch (error: any) {
    console.error("POST template error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create template" }, { status: 500 });
  }
}
