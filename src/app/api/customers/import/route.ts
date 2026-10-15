// ============================================================================
// Import clients from an Excel workbook (Manager only; Settings → Import clients).
//   GET  — the blank .xlsx template with the expected columns
//   POST — multipart form: file (.xlsx) + mode=preview|commit
//          preview returns the row-by-row plan; commit re-checks the file
//          against the live client list and inserts only the "create" rows
//          in one transaction. Existing clients are never changed.
// ============================================================================

import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { baseRoleOf } from "@/lib/permissions";
import { CLIENT_IMPORT_MAX_FILE_BYTES, planClientImport } from "@/lib/clientImport";
import { buildClientImportTemplate, ClientWorkbookError, parseClientWorkbook } from "@/lib/clientImport.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

async function requireManager() {
  const { user, error } = await authorize("users:manage");
  if (error) return { user: null, error };
  if (baseRoleOf(user.role) !== "Manager") {
    return { user: null, error: NextResponse.json({ error: "Only a Manager can import clients." }, { status: 403, headers: NO_STORE }) };
  }
  return { user, error: null };
}

export async function GET() {
  const { error } = await requireManager();
  if (error) return error;
  try {
    const bytes = await buildClientImportTemplate();
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="WoodTek-Clients-Import-Template.xlsx"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("Client import template generation failed", cause);
    return NextResponse.json({ error: "Could not generate the Excel template." }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const { user, error } = await requireManager();
  if (error || !user) return error!;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the workbook as multipart form data." }, { status: 400, headers: NO_STORE });
  }
  const mode = String(form.get("mode") ?? "preview").trim().toLowerCase();
  if (mode !== "preview" && mode !== "commit") {
    return NextResponse.json({ error: "Import mode must be preview or commit." }, { status: 400, headers: NO_STORE });
  }
  const candidate = form.get("file");
  if (!candidate || typeof candidate !== "object" || !("arrayBuffer" in candidate) || !("size" in candidate)) {
    return NextResponse.json({ error: "Choose an .xlsx workbook to upload." }, { status: 400, headers: NO_STORE });
  }
  const file = candidate as File;
  if (!String(file.name ?? "").toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Only .xlsx Excel workbooks are supported. Download the WoodTek template and save as .xlsx." }, { status: 400, headers: NO_STORE });
  }
  if (file.size <= 0) return NextResponse.json({ error: "The selected workbook is empty." }, { status: 400, headers: NO_STORE });
  if (file.size > CLIENT_IMPORT_MAX_FILE_BYTES) return NextResponse.json({ error: "The workbook exceeds the 5 MB upload limit." }, { status: 413, headers: NO_STORE });

  let matrix: unknown[][];
  try {
    matrix = await parseClientWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch (cause) {
    const message = cause instanceof ClientWorkbookError ? cause.message : "The workbook could not be read.";
    return NextResponse.json({ error: message }, { status: 422, headers: NO_STORE });
  }

  try {
    const existing = await db.select({ name: customers.name, company: customers.company, email: customers.email }).from(customers);
    const plan = planClientImport(matrix, existing);
    if (mode === "preview") return NextResponse.json(plan, { headers: NO_STORE });
    if (!plan.valid) return NextResponse.json(plan, { status: 422, headers: NO_STORE });

    const created = await db.transaction(async (tx) => {
      // Re-check against the live list inside the transaction, so a client added
      // between preview and commit cannot be duplicated.
      const latest = await tx.select({ name: customers.name, company: customers.company, email: customers.email }).from(customers);
      const fresh = planClientImport(matrix, latest);
      if (!fresh.valid) return { plan: fresh, inserted: 0 };
      const toCreate = fresh.rows.filter((r) => r.action === "create");
      if (toCreate.length > 0) {
        await tx.insert(customers).values(
          toCreate.map((r) => ({
            name: r.name,
            company: r.company,
            email: r.email,
            phone: r.phone,
            address: r.address,
            creditLimit: r.creditLimit,
            notes: r.notes || null,
            assignedSalesId: null, // shared until a Manager assigns it
          })),
        );
      }
      return { plan: fresh, inserted: toCreate.length };
    });

    if (!created.plan.valid) return NextResponse.json(created.plan, { status: 422, headers: NO_STORE });
    logAudit(user, "customers.import", "customer", `Imported ${created.inserted} client(s) from Excel; ${created.plan.existsCount} already existed and were skipped.`);
    return NextResponse.json({ ...created.plan, inserted: created.inserted }, { headers: NO_STORE });
  } catch (cause) {
    console.error("Client import failed", cause);
    const message = (cause as { cause?: { message?: string } })?.cause?.message || (cause as Error)?.message || "The import failed. Nothing was saved.";
    return NextResponse.json({ error: `The import failed. Nothing was saved. ${message}` }, { status: 500, headers: NO_STORE });
  }
}
