import { NextResponse } from "next/server";
import { db } from "@/db";
import { operationTemplates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("recipes:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const templateId = Number(id);
    const body = await request.json();
    const { name, description, defaultStepsJson } = body;

    const [existing] = await db.select().from(operationTemplates).where(eq(operationTemplates.id, templateId));
    if (!existing) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

    let steps: any = existing.defaultStepsJson;
    if (Array.isArray(defaultStepsJson)) {
      steps = defaultStepsJson
        .map((s: any, i: number) => ({
          stepOrder: i + 1,
          operationName: String(s.operationName || "").trim(),
          machineCategory: String(s.machineCategory || "").trim(),
          estimatedMinutes: Number(s.estimatedMinutes) || 60,
        }))
        .filter((s: any) => s.operationName);
      if (steps.length === 0) {
        return NextResponse.json({ error: "A recipe needs at least one named step." }, { status: 400 });
      }
    }

    const [updated] = await db.update(operationTemplates).set({
      name: name?.trim() || existing.name,
      description: description ?? existing.description,
      defaultStepsJson: steps,
    }).where(eq(operationTemplates.id, templateId)).returning();

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("PUT template error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("recipes:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const templateId = Number(id);

    const [existing] = await db.select().from(operationTemplates).where(eq(operationTemplates.id, templateId));
    if (!existing) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

    await db.delete(operationTemplates).where(eq(operationTemplates.id, templateId));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE template error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete template" }, { status: 500 });
  }
}
