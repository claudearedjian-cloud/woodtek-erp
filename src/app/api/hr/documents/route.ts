// ============================================================================
// Employee-card documents — identity copy, passport, visa, residency permit,
// work permit, contract, certificate… HR-private: every handler requires the
// HR & Payroll grant. Files live in <data dir>/uploads/hr/docs/; the
// hr_employee_documents table is the metadata ledger.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  HRPayrollError,
  HR_DOCUMENT_TYPES,
  isValidYmd,
} from "@/lib/hrPayroll";
import {
  countEmployeeDocuments,
  createEmployeeDocument,
  deleteEmployeeDocument,
  getEmployeeDocument,
  listEmployeeDocuments,
} from "@/lib/hrPayroll.server";
import {
  MAX_HR_DOCS_PER_EMPLOYEE,
  hrDocContentType,
  hrDocExtFor,
  isSafeHrDocName,
  validateHrDocument,
} from "@/lib/hrAttachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  return response;
}

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function docsDir(): string {
  return path.join(dataDir(), "uploads", "hr", "docs");
}

function failure(cause: unknown, fallback: string) {
  if (cause instanceof HRPayrollError) {
    return NextResponse.json({ error: cause.message }, { status: cause.status, headers: PRIVATE_HEADERS });
  }
  console.error("HR documents error:", cause);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/**
 * GET ?userId=… lists the employee's documents.
 * GET ?id=… streams one document's file bytes (HR-private download).
 */
export async function GET(request: Request) {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id !== null) {
      const docId = Number(id);
      if (!Number.isSafeInteger(docId) || docId <= 0) {
        return NextResponse.json({ error: "A valid document is required." }, { status: 400, headers: PRIVATE_HEADERS });
      }
      const doc = await getEmployeeDocument(docId);
      if (!doc || !isSafeHrDocName(doc.fileName)) {
        return NextResponse.json({ error: "Document not found." }, { status: 404, headers: PRIVATE_HEADERS });
      }
      const full = path.join(docsDir(), doc.fileName);
      if (!fs.existsSync(full)) {
        return NextResponse.json({ error: "Document file not found." }, { status: 404, headers: PRIVATE_HEADERS });
      }
      const bytes = new Uint8Array(fs.readFileSync(full));
      const download = params.get("download") === "1";
      const safeName = (doc.originalName || doc.fileName).replace(/["\r\n]/g, "").slice(0, 120) || doc.fileName;
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": doc.mime || hrDocContentType(doc.fileName),
          "Content-Length": String(bytes.length),
          ...(download ? { "Content-Disposition": `attachment; filename="${safeName}"` } : {}),
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
    const userId = Number(params.get("userId"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid employee is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(await listEmployeeDocuments(userId), { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load employee documents.");
  }
}

/** Uploads one document for an employee (multipart: userId, docType, file…). */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const form = await request.formData();
    const userId = Number(form.get("userId"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid employee is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const docType = String(form.get("docType") ?? "Other").trim();
    if (!(HR_DOCUMENT_TYPES as readonly string[]).includes(docType)) {
      return NextResponse.json({ error: "Choose a valid document type." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const title = String(form.get("title") ?? "").trim().slice(0, 80);
    const expiryRaw = String(form.get("expiryDate") ?? "").trim();
    if (expiryRaw && !isValidYmd(expiryRaw)) {
      return NextResponse.json({ error: "Expiry date must be a real date in YYYY-MM-DD format." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "Choose a document file to upload." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const problem = validateHrDocument(file.type, file.size);
    if (problem) return NextResponse.json({ error: problem }, { status: 400, headers: PRIVATE_HEADERS });

    const existing = await countEmployeeDocuments(userId);
    if (existing >= MAX_HR_DOCS_PER_EMPLOYEE) {
      return NextResponse.json(
        { error: `At most ${MAX_HR_DOCS_PER_EMPLOYEE} documents per employee (${existing} already saved).` },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    const ext = hrDocExtFor(file.type) as string;
    const stored = `hr-doc-${userId}-${Date.now()}-${existing + 1}.${ext}`;
    fs.mkdirSync(docsDir(), { recursive: true });
    fs.writeFileSync(path.join(docsDir(), stored), new Uint8Array(await file.arrayBuffer()));

    const created = await createEmployeeDocument(
      {
        userId,
        docType,
        title,
        fileName: stored,
        originalName: String(file.name || "").slice(0, 120),
        mime: file.type,
        size: file.size,
        expiryDate: expiryRaw || null,
      },
      user.id,
    );
    logAudit(user, "hr.document.upload", "hr-employee", `${docType} uploaded for employee #${userId}`, userId);
    return NextResponse.json(created, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to upload the document.");
  }
}

/** Deletes one document (metadata first; the file follows best-effort). */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const docId = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isSafeInteger(docId) || docId <= 0) {
      return NextResponse.json({ error: "A valid document is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const removed = await deleteEmployeeDocument(docId);
    if (!removed) return NextResponse.json({ error: "Document not found." }, { status: 404, headers: PRIVATE_HEADERS });
    if (isSafeHrDocName(removed.fileName)) {
      try {
        const full = path.join(docsDir(), removed.fileName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        /* metadata removal is authoritative */
      }
    }
    logAudit(user, "hr.document.delete", "hr-employee", `${removed.docType} deleted for employee #${removed.userId}`, removed.userId);
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to delete the document.");
  }
}
