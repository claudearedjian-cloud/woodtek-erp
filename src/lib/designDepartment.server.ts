// Design Department persistence (server only). Each row is one drawing
// revision; workflow events are append-only and production issue is guarded
// again here even if a client bypasses the UI.
import { db } from "@/db";
import {
  customers,
  designDrawingEvents,
  designDrawingFiles,
  designDrawings,
  orders,
  users,
} from "@/db/schema";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import {
  DesignDepartmentError,
  canIssueToProduction,
  designApprovalCodeDef,
  designDrawingStage,
  designRecordNumber,
  parseDesignApproval,
  parseDesignComments,
  parseDesignDrawing,
  parseDesignIssue,
  parseDesignResubmission,
  parseDesignStatusChange,
  parseDesignSubmit,
  summarizeDesignDrawings,
  type DesignDrawingInput,
} from "@/lib/designDepartment";
import { MAX_DESIGN_FILES_PER_DRAWING } from "@/lib/designAttachments";
import { ensureDesignSchema } from "@/lib/designSchema.server";

export interface DesignActor {
  id: number;
  name?: string | null;
  email?: string | null;
}

type DesignTx = any;
type DrawingRow = typeof designDrawings.$inferSelect;
type FileRow = typeof designDrawingFiles.$inferSelect;

function actorName(actor: DesignActor): string {
  return String(actor.name || actor.email || `User #${actor.id}`).slice(0, 160);
}

function serializeRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out as T;
}

function serializeDrawing(row: DrawingRow, userNames: Map<number, string>) {
  const clean = serializeRow(row as unknown as Record<string, unknown>);
  const nameFor = (id: unknown) =>
    typeof id === "number" ? userNames.get(id) ?? "" : "";
  return {
    ...clean,
    recordNumber: designRecordNumber(row.id),
    approvalLabel: designApprovalCodeDef(row.approvalCode)?.label ?? "",
    stage: designDrawingStage(row),
    issueEligibility: canIssueToProduction(row),
    createdByName: nameFor(row.createdById),
    updatedByName: nameFor(row.updatedById),
    submittedByName: nameFor(row.submittedById),
    commentsIncorporatedByName: nameFor(row.commentsIncorporatedById),
    issuedByName: nameFor(row.issuedById),
  };
}

function serializeFile(row: FileRow, userNames: Map<number, string>) {
  return {
    ...serializeRow(row as unknown as Record<string, unknown>),
    uploadedByName:
      row.uploadedById != null ? userNames.get(row.uploadedById) ?? "" : "",
  };
}

async function loadUserNames(tx: DesignTx = db): Promise<Map<number, string>> {
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users);
  return new Map(rows.map((row: any) => [row.id, row.name || row.email || `User #${row.id}`]));
}

async function addEvent(
  tx: DesignTx,
  drawing: DrawingRow,
  actor: DesignActor,
  eventType: string,
  summary: string,
  details = "",
): Promise<void> {
  await tx.insert(designDrawingEvents).values({
    drawingId: drawing.id,
    eventType,
    summary,
    details,
    revisionSnapshot: drawing.revision,
    statusSnapshot: drawing.status,
    approvalCode: drawing.approvalCode || "",
    actorId: actor.id,
    actorName: actorName(actor),
  });
}

async function getDrawingForUpdate(tx: DesignTx, id: number): Promise<DrawingRow> {
  const [row] = await tx
    .select()
    .from(designDrawings)
    .where(eq(designDrawings.id, id))
    .for("update");
  if (!row) throw new DesignDepartmentError("Drawing revision not found.", 404);
  return row;
}

async function assertRevisionAvailable(
  tx: DesignTx,
  input: Pick<DesignDrawingInput, "projectName" | "drawingNo" | "revision">,
  excludeId?: number,
): Promise<void> {
  const conditions = [
    sql`lower(${designDrawings.projectName}) = lower(${input.projectName})`,
    sql`lower(${designDrawings.drawingNo}) = lower(${input.drawingNo})`,
    sql`lower(${designDrawings.revision}) = lower(${input.revision})`,
  ];
  if (excludeId) conditions.push(ne(designDrawings.id, excludeId));
  const [existing] = await tx
    .select({ id: designDrawings.id })
    .from(designDrawings)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new DesignDepartmentError(
      `Project “${input.projectName || "—"}” already has drawing ${input.drawingNo} revision ${input.revision}.`,
      409,
    );
  }
}

async function resolveDrawingInput(
  tx: DesignTx,
  input: DesignDrawingInput,
): Promise<DesignDrawingInput & { orderSnapshot: string }> {
  if (input.orderId == null) return { ...input, orderSnapshot: "" };
  const [order] = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      title: orders.title,
      customerName: customers.name,
      customerCompany: customers.company,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!order) {
    throw new DesignDepartmentError("The linked production order no longer exists.", 409);
  }
  const client = order.customerCompany || order.customerName || "";
  return {
    ...input,
    projectName: input.projectName || order.title,
    clientName: input.clientName || client,
    orderSnapshot: `${order.orderNumber} — ${order.title}${client ? ` (${client})` : ""}`,
  };
}

function drawingValues(input: DesignDrawingInput & { orderSnapshot: string }) {
  return {
    drawingNo: input.drawingNo,
    revision: input.revision,
    title: input.title,
    projectName: input.projectName,
    clientName: input.clientName,
    architectName: input.architectName,
    orderId: input.orderId,
    orderSnapshot: input.orderSnapshot,
    discipline: input.discipline,
    area: input.area,
    sheetCount: input.sheetCount,
    priority: input.priority,
    requiredDate: input.requiredDate,
    externalLink: input.externalLink,
    notes: input.notes,
  };
}

export async function designBoard() {
  await ensureDesignSchema();
  const drawingRows = await db
    .select()
    .from(designDrawings)
    .orderBy(desc(designDrawings.updatedAt), desc(designDrawings.id));
  const fileRows = await db
    .select()
    .from(designDrawingFiles)
    .orderBy(asc(designDrawingFiles.createdAt), asc(designDrawingFiles.id));
  const eventRows = await db
    .select({ drawingId: designDrawingEvents.drawingId })
    .from(designDrawingEvents);
  const userNames = await loadUserNames();
  const orderRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      title: orders.title,
      status: orders.status,
      dueDate: orders.dueDate,
      customerName: customers.name,
      customerCompany: customers.company,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .orderBy(desc(orders.createdAt), desc(orders.id));

  const filesByDrawing = new Map<number, ReturnType<typeof serializeFile>[]>();
  for (const file of fileRows) {
    const list = filesByDrawing.get(file.drawingId) ?? [];
    list.push(serializeFile(file, userNames));
    filesByDrawing.set(file.drawingId, list);
  }
  const eventCounts = new Map<number, number>();
  for (const event of eventRows) {
    eventCounts.set(event.drawingId, (eventCounts.get(event.drawingId) ?? 0) + 1);
  }

  return {
    drawings: drawingRows.map((row) => ({
      ...serializeDrawing(row, userNames),
      files: filesByDrawing.get(row.id) ?? [],
      fileCount: filesByDrawing.get(row.id)?.length ?? 0,
      eventCount: eventCounts.get(row.id) ?? 0,
    })),
    orders: orderRows.map((order: any) => {
      const clientName = order.customerCompany || order.customerName || "";
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        title: order.title,
        status: order.status,
        dueDate: order.dueDate instanceof Date ? order.dueDate.toISOString() : order.dueDate,
        projectName: order.title,
        clientName,
        label: `${order.orderNumber} — ${order.title}${clientName ? ` (${clientName})` : ""}`,
      };
    }),
    summary: summarizeDesignDrawings(drawingRows),
  };
}

export async function designDrawingDetail(id: number) {
  await ensureDesignSchema();
  const [row] = await db.select().from(designDrawings).where(eq(designDrawings.id, id));
  if (!row) throw new DesignDepartmentError("Drawing revision not found.", 404);
  const userNames = await loadUserNames();
  const files = await db
    .select()
    .from(designDrawingFiles)
    .where(eq(designDrawingFiles.drawingId, id))
    .orderBy(asc(designDrawingFiles.createdAt), asc(designDrawingFiles.id));
  const events = await db
    .select()
    .from(designDrawingEvents)
    .where(eq(designDrawingEvents.drawingId, id))
    .orderBy(desc(designDrawingEvents.createdAt), desc(designDrawingEvents.id))
    .limit(200);
  const revisionRows = await db
    .select()
    .from(designDrawings)
    .where(
      and(
        sql`lower(${designDrawings.projectName}) = lower(${row.projectName})`,
        sql`lower(${designDrawings.drawingNo}) = lower(${row.drawingNo})`,
      ),
    )
    .orderBy(asc(designDrawings.createdAt), asc(designDrawings.id));

  return {
    ...serializeDrawing(row, userNames),
    files: files.map((file) => serializeFile(file, userNames)),
    fileCount: files.length,
    events: events.map((event: any) => serializeRow(event)),
    revisions: revisionRows.map((revision: any) => ({
      id: revision.id,
      recordNumber: designRecordNumber(revision.id),
      revision: revision.revision,
      status: revision.status,
      approvalCode: revision.approvalCode,
      stage: designDrawingStage(revision),
      submittedDate: revision.submittedDate,
      approvalDate: revision.approvalDate,
      issuedAt:
        revision.issuedAt instanceof Date
          ? revision.issuedAt.toISOString()
          : revision.issuedAt,
      supersedesId: revision.supersedesId,
      updatedAt:
        revision.updatedAt instanceof Date
          ? revision.updatedAt.toISOString()
          : revision.updatedAt,
    })),
  };
}

export async function createDesignDrawing(input: unknown, actor: DesignActor) {
  const parsed = parseDesignDrawing(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const resolved = await resolveDrawingInput(tx, parsed);
    await assertRevisionAvailable(tx, resolved);
    const [created] = await tx
      .insert(designDrawings)
      .values({
        ...drawingValues(resolved),
        status: "Draft",
        createdById: actor.id,
        updatedById: actor.id,
      })
      .returning();
    await addEvent(tx, created, actor, "created", "Drawing revision created", created.title);
    return {
      id: created.id,
      recordNumber: designRecordNumber(created.id),
      status: created.status,
    };
  });
}

export async function updateDesignDrawing(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignDrawing(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    if (["Issued to Production", "Superseded", "Cancelled"].includes(current.status)) {
      throw new DesignDepartmentError(
        "Issued, superseded and cancelled revisions are historical records. Create a new revision instead of editing this one.",
        409,
      );
    }
    const resolved = await resolveDrawingInput(tx, parsed);
    await assertRevisionAvailable(tx, resolved, id);
    const [updated] = await tx
      .update(designDrawings)
      .set({ ...drawingValues(resolved), updatedById: actor.id, updatedAt: new Date() })
      .where(eq(designDrawings.id, id))
      .returning();
    await addEvent(tx, updated, actor, "updated", "Drawing details updated");
    return { id, recordNumber: designRecordNumber(id), status: updated.status };
  });
}

export async function submitDesignDrawing(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignSubmit(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    if (current.status !== "Draft") {
      throw new DesignDepartmentError(
        "Only a Draft revision can be submitted. Create a new revision for a resubmittal.",
        409,
      );
    }
    const [updated] = await tx
      .update(designDrawings)
      .set({
        status: "Submitted",
        submittedTo: parsed.submittedTo,
        submittedById: actor.id,
        submittedDate: parsed.submittedDate,
        transmittalNo: parsed.transmittalNo,
        responseDueDate: parsed.responseDueDate,
        approvalCode: "",
        approvalBy: "",
        approvalDate: null,
        approvalComments: "",
        commentsIncorporated: false,
        commentsIncorporatedById: null,
        commentsIncorporatedAt: null,
        updatedById: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(designDrawings.id, id))
      .returning();
    await addEvent(
      tx,
      updated,
      actor,
      "submitted",
      `Submitted to ${parsed.submittedTo}`,
      [parsed.transmittalNo ? `Transmittal ${parsed.transmittalNo}` : "", parsed.note]
        .filter(Boolean)
        .join("\n"),
    );
    return { id, recordNumber: designRecordNumber(id), status: updated.status };
  });
}

export async function recordDesignApproval(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignApproval(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    if (current.status !== "Submitted") {
      throw new DesignDepartmentError(
        "An approval code can be recorded only while this revision is Submitted.",
        409,
      );
    }
    if (current.submittedDate && parsed.approvalDate < current.submittedDate) {
      throw new DesignDepartmentError("Approval return date cannot be before the submitted date.");
    }
    const incorporatedNow = parsed.approvalCode === "B" && parsed.commentsIncorporated;
    const [updated] = await tx
      .update(designDrawings)
      .set({
        status: "Returned",
        approvalCode: parsed.approvalCode,
        approvalBy: parsed.approvalBy,
        approvalDate: parsed.approvalDate,
        approvalComments: parsed.approvalComments,
        commentsIncorporated: incorporatedNow,
        commentsIncorporatedById: incorporatedNow ? actor.id : null,
        commentsIncorporatedAt: incorporatedNow ? new Date() : null,
        issuedTo: "",
        issuedById: null,
        issuedAt: null,
        issueNote: "",
        updatedById: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(designDrawings.id, id))
      .returning();
    const def = designApprovalCodeDef(parsed.approvalCode)!;
    await addEvent(tx, updated, actor, "approval", def.label, parsed.approvalComments);
    return {
      id,
      recordNumber: designRecordNumber(id),
      status: updated.status,
      approvalCode: updated.approvalCode,
    };
  });
}

export async function markDesignComments(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignComments(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    if (current.status !== "Returned" || current.approvalCode !== "B") {
      throw new DesignDepartmentError(
        "Comment incorporation applies only to a Returned Code B revision.",
        409,
      );
    }
    const [updated] = await tx
      .update(designDrawings)
      .set({
        commentsIncorporated: parsed.incorporated,
        commentsIncorporatedById: parsed.incorporated ? actor.id : null,
        commentsIncorporatedAt: parsed.incorporated ? new Date() : null,
        updatedById: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(designDrawings.id, id))
      .returning();
    await addEvent(
      tx,
      updated,
      actor,
      "comments",
      parsed.incorporated
        ? "Code B comments incorporated"
        : "Code B comment incorporation withdrawn",
      parsed.note,
    );
    return { id, recordNumber: designRecordNumber(id), status: updated.status };
  });
}

export async function issueDesignDrawing(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignIssue(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    const commentsReady =
      current.commentsIncorporated ||
      (current.approvalCode === "B" && parsed.confirmCommentsIncorporated);
    const eligibility = canIssueToProduction({
      ...current,
      commentsIncorporated: commentsReady,
    });
    if (!eligibility.ok) throw new DesignDepartmentError(eligibility.reason, 409);

    // Issuing this revision makes every older production-issued revision of
    // the same project/drawing historical, so the floor cannot keep building
    // from an older release by mistake.
    const olderIssued = await tx
      .select()
      .from(designDrawings)
      .where(
        and(
          ne(designDrawings.id, id),
          eq(designDrawings.status, "Issued to Production"),
          sql`lower(${designDrawings.projectName}) = lower(${current.projectName})`,
          sql`lower(${designDrawings.drawingNo}) = lower(${current.drawingNo})`,
        ),
      )
      .for("update");
    for (const older of olderIssued) {
      const [superseded] = await tx
        .update(designDrawings)
        .set({ status: "Superseded", updatedById: actor.id, updatedAt: new Date() })
        .where(eq(designDrawings.id, older.id))
        .returning();
      await addEvent(
        tx,
        superseded,
        actor,
        "superseded",
        `Superseded by ${designRecordNumber(id)} revision ${current.revision}`,
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(designDrawings)
      .set({
        status: "Issued to Production",
        commentsIncorporated: commentsReady,
        commentsIncorporatedById:
          current.approvalCode === "B" && parsed.confirmCommentsIncorporated
            ? actor.id
            : current.commentsIncorporatedById,
        commentsIncorporatedAt:
          current.approvalCode === "B" && parsed.confirmCommentsIncorporated
            ? now
            : current.commentsIncorporatedAt,
        issuedTo: parsed.issuedTo,
        issuedById: actor.id,
        issuedAt: now,
        issueNote: parsed.note,
        updatedById: actor.id,
        updatedAt: now,
      })
      .where(eq(designDrawings.id, id))
      .returning();
    await addEvent(
      tx,
      updated,
      actor,
      "issued",
      `Issued to production — ${parsed.issuedTo}`,
      parsed.note,
    );
    return {
      id,
      recordNumber: designRecordNumber(id),
      status: updated.status,
      approvalCode: updated.approvalCode,
    };
  });
}

export async function createDesignResubmission(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignResubmission(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const source = await getDrawingForUpdate(tx, id);
    if (source.status === "Superseded" || source.status === "Cancelled") {
      throw new DesignDepartmentError(
        "A superseded or cancelled revision cannot be used to create another revision.",
        409,
      );
    }
    if (parsed.revision.toLowerCase() === source.revision.toLowerCase()) {
      throw new DesignDepartmentError("The new revision must be different from the current revision.");
    }
    await assertRevisionAvailable(tx, {
      projectName: source.projectName,
      drawingNo: source.drawingNo,
      revision: parsed.revision,
    });
    const [created] = await tx
      .insert(designDrawings)
      .values({
        drawingNo: source.drawingNo,
        revision: parsed.revision,
        title: source.title,
        projectName: source.projectName,
        clientName: source.clientName,
        architectName: source.architectName,
        orderId: source.orderId,
        orderSnapshot: source.orderSnapshot,
        discipline: source.discipline,
        area: source.area,
        sheetCount: source.sheetCount,
        status: "Draft",
        priority: source.priority,
        requiredDate: source.requiredDate,
        externalLink: source.externalLink,
        notes: source.notes,
        supersedesId: source.id,
        createdById: actor.id,
        updatedById: actor.id,
      })
      .returning();
    await addEvent(
      tx,
      created,
      actor,
      "created",
      `Revision created from ${designRecordNumber(source.id)} revision ${source.revision}`,
      parsed.note,
    );

    if (source.status !== "Issued to Production") {
      const [superseded] = await tx
        .update(designDrawings)
        .set({ status: "Superseded", updatedById: actor.id, updatedAt: new Date() })
        .where(eq(designDrawings.id, source.id))
        .returning();
      await addEvent(
        tx,
        superseded,
        actor,
        "superseded",
        `Superseded by draft revision ${parsed.revision}`,
        parsed.note,
      );
    } else {
      await addEvent(
        tx,
        source,
        actor,
        "revision-created",
        `New draft revision ${parsed.revision} created; this issued revision remains current until the new one is issued`,
        parsed.note,
      );
    }

    return {
      id: created.id,
      recordNumber: designRecordNumber(created.id),
      revision: created.revision,
      sourceId: source.id,
      sourceRecordNumber: designRecordNumber(source.id),
    };
  });
}

export async function changeDesignDrawingStatus(id: number, input: unknown, actor: DesignActor) {
  const parsed = parseDesignStatusChange(input);
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    let target = parsed.status as string;
    if (parsed.status === "On Hold") {
      if (!["Draft", "Submitted", "Returned"].includes(current.status)) {
        throw new DesignDepartmentError("Only an active Draft, Submitted or Returned drawing can be put on hold.", 409);
      }
    } else if (parsed.status === "Cancelled") {
      if (!["Draft", "Submitted", "Returned", "On Hold"].includes(current.status)) {
        throw new DesignDepartmentError("An issued or superseded revision cannot be cancelled.", 409);
      }
    } else {
      // The UI sends Draft for "Resume"; return to the workflow stage proven
      // by the fields already recorded instead of erasing submittal history.
      if (current.status !== "On Hold") {
        throw new DesignDepartmentError("Only an On Hold drawing can be resumed.", 409);
      }
      target = current.approvalCode
        ? "Returned"
        : current.submittedDate || current.submittedTo
          ? "Submitted"
          : "Draft";
    }
    const [updated] = await tx
      .update(designDrawings)
      .set({ status: target, updatedById: actor.id, updatedAt: new Date() })
      .where(eq(designDrawings.id, id))
      .returning();
    await addEvent(
      tx,
      updated,
      actor,
      "status",
      parsed.status === "Draft" ? `Resumed as ${target}` : `Status changed to ${target}`,
      parsed.note,
    );
    return { id, recordNumber: designRecordNumber(id), status: updated.status };
  });
}

export async function deleteDesignDrawing(id: number, actor: DesignActor) {
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const current = await getDrawingForUpdate(tx, id);
    if (
      current.status !== "Draft" ||
      current.submittedDate ||
      current.approvalCode ||
      current.issuedAt
    ) {
      throw new DesignDepartmentError(
        "Only a never-submitted Draft can be deleted. Cancel or supersede a drawing with history instead.",
        409,
      );
    }
    const files = await tx
      .select({ fileName: designDrawingFiles.fileName })
      .from(designDrawingFiles)
      .where(eq(designDrawingFiles.drawingId, id));
    await tx.delete(designDrawings).where(eq(designDrawings.id, id));
    return {
      id,
      recordNumber: designRecordNumber(id),
      drawingNo: current.drawingNo,
      revision: current.revision,
      fileNames: files.map((file: any) => file.fileName),
      deletedBy: actorName(actor),
    };
  });
}

export async function listDesignDrawingFiles(drawingId: number) {
  await ensureDesignSchema();
  const [drawing] = await db
    .select({ id: designDrawings.id })
    .from(designDrawings)
    .where(eq(designDrawings.id, drawingId));
  if (!drawing) throw new DesignDepartmentError("Drawing revision not found.", 404);
  const userNames = await loadUserNames();
  const files = await db
    .select()
    .from(designDrawingFiles)
    .where(eq(designDrawingFiles.drawingId, drawingId))
    .orderBy(asc(designDrawingFiles.createdAt), asc(designDrawingFiles.id));
  return files.map((file) => serializeFile(file, userNames));
}

export async function getDesignDrawingFile(drawingId: number, fileId: number) {
  await ensureDesignSchema();
  const [file] = await db
    .select()
    .from(designDrawingFiles)
    .where(
      and(
        eq(designDrawingFiles.id, fileId),
        eq(designDrawingFiles.drawingId, drawingId),
      ),
    );
  return file ?? null;
}

export interface DesignFileMetadata {
  kind: string;
  fileName: string;
  originalName: string;
  mime: string;
  size: number;
}

export async function createDesignDrawingFile(
  drawingId: number,
  metadata: DesignFileMetadata,
  actor: DesignActor,
) {
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const drawing = await getDrawingForUpdate(tx, drawingId);
    const existing = await tx
      .select({ id: designDrawingFiles.id })
      .from(designDrawingFiles)
      .where(eq(designDrawingFiles.drawingId, drawingId));
    if (existing.length >= MAX_DESIGN_FILES_PER_DRAWING) {
      throw new DesignDepartmentError(
        `At most ${MAX_DESIGN_FILES_PER_DRAWING} files per drawing revision (${existing.length} already saved).`,
      );
    }
    const [created] = await tx
      .insert(designDrawingFiles)
      .values({ drawingId, ...metadata, uploadedById: actor.id })
      .returning();
    const [touched] = await tx
      .update(designDrawings)
      .set({ updatedById: actor.id, updatedAt: new Date() })
      .where(eq(designDrawings.id, drawingId))
      .returning();
    await addEvent(
      tx,
      touched ?? drawing,
      actor,
      "file-uploaded",
      `${metadata.kind} file uploaded`,
      metadata.originalName || metadata.fileName,
    );
    const userNames = new Map([[actor.id, actorName(actor)]]);
    return serializeFile(created, userNames);
  });
}

export async function deleteDesignDrawingFile(
  drawingId: number,
  fileId: number,
  actor: DesignActor,
) {
  await ensureDesignSchema();
  return db.transaction(async (tx) => {
    const drawing = await getDrawingForUpdate(tx, drawingId);
    const [file] = await tx
      .select()
      .from(designDrawingFiles)
      .where(
        and(
          eq(designDrawingFiles.id, fileId),
          eq(designDrawingFiles.drawingId, drawingId),
        ),
      );
    if (!file) return null;
    await tx.delete(designDrawingFiles).where(eq(designDrawingFiles.id, fileId));
    const [touched] = await tx
      .update(designDrawings)
      .set({ updatedById: actor.id, updatedAt: new Date() })
      .where(eq(designDrawings.id, drawingId))
      .returning();
    await addEvent(
      tx,
      touched ?? drawing,
      actor,
      "file-deleted",
      `${file.kind} file deleted`,
      file.originalName || file.fileName,
    );
    return file;
  });
}
