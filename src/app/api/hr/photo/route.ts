// ============================================================================
// Employee-card personal photo — one picture per employee. HR-private:
// every handler requires the HR & Payroll grant. Files live in
// <data dir>/uploads/hr/photos/; the profile row stores the file name.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError, isValidYmd } from "@/lib/hrPayroll";
import {
  getEmployeePhotoFile,
  setEmployeePhotoFile,
} from "@/lib/hrPayroll.server";
import { ensureHrSchema } from "@/lib/hrSchema.server";
import {
  hrPhotoContentType,
  hrPhotoExtFor,
  isSafeHrPhotoName,
  validateHrPhoto,
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

function photosDir(): string {
  return path.join(dataDir(), "uploads", "hr", "photos");
}

function failure(cause: unknown, fallback: string) {
  if (cause instanceof HRPayrollError) {
    return NextResponse.json({ error: cause.message }, { status: cause.status, headers: PRIVATE_HEADERS });
  }
  console.error("HR photo error:", cause);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

async function employeeExists(userId: number): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row);
}

/** Serves the employee's personal photo bytes (or 404 when none). */
export async function GET(request: Request) {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const userId = Number(new URL(request.url).searchParams.get("userId"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid employee is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const file = await getEmployeePhotoFile(userId);
    if (!file || !isSafeHrPhotoName(file)) {
      return NextResponse.json({ error: "No photo on file." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const full = path.join(photosDir(), file);
    if (!fs.existsSync(full)) {
      return NextResponse.json({ error: "Photo file not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return new NextResponse(new Uint8Array(fs.readFileSync(full)), {
      headers: {
        "Content-Type": hrPhotoContentType(file),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (cause) {
    return failure(cause, "Failed to load the employee photo.");
  }
}

/** Uploads (or replaces) the employee's personal photo. */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    await ensureHrSchema();
    const form = await request.formData();
    const userId = Number(form.get("userId"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid employee is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    if (!(await employeeExists(userId))) {
      return NextResponse.json({ error: "Employee account not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const file = form.get("photo");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const problem = validateHrPhoto(file.type, file.size);
    if (problem) return NextResponse.json({ error: problem }, { status: 400, headers: PRIVATE_HEADERS });

    const ext = hrPhotoExtFor(file.type) as string;
    const stored = `hr-photo-${userId}-${Date.now()}.${ext}`;
    fs.mkdirSync(photosDir(), { recursive: true });
    fs.writeFileSync(path.join(photosDir(), stored), new Uint8Array(await file.arrayBuffer()));

    const previous = await getEmployeePhotoFile(userId);
    await setEmployeePhotoFile(userId, stored, user.id);
    if (previous && previous !== stored && isSafeHrPhotoName(previous)) {
      try {
        const old = path.join(photosDir(), previous);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      } catch {
        /* the profile pointer is authoritative; a stray file is harmless */
      }
    }
    logAudit(user, "hr.photo.upload", "hr-employee", `Personal photo uploaded for employee #${userId}`, userId);
    return NextResponse.json({ ok: true, photoFile: stored }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to upload the employee photo.");
  }
}

/** Removes the employee's personal photo. */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const userId = Number(new URL(request.url).searchParams.get("userId"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid employee is required." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const previous = await getEmployeePhotoFile(userId);
    if (!previous) return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
    await setEmployeePhotoFile(userId, "", user.id);
    if (isSafeHrPhotoName(previous)) {
      try {
        const old = path.join(photosDir(), previous);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      } catch {
        /* metadata removal is authoritative */
      }
    }
    logAudit(user, "hr.photo.delete", "hr-employee", `Personal photo removed for employee #${userId}`, userId);
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to remove the employee photo.");
  }
}
