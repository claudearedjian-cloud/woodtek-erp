// ============================================================================
// Email dispatch — send an order's documents by email (API).
//
// POST { orderId, to, cc?, subject?, message?, includeDeliveryNote?,
//        includeDispatchPack?, includeJobTicket? }
//
// Permission: canSendEmail = orders:write OR quality:write OR
// inventory:write OR users:manage (Sales, Manager, QA & Dispatch, floor
// supervisors — anyone who is trusted with a shipping action).
//
// Reads:
//   - order + customer (customers.address = the delivery address)
//   - production plan via readOrderProductionPlan — the orders table has NO
//     productionPlan column, the plan lives in the JSON store
//   - materials via orderMaterials ⋈ inventoryItems (orderMaterials has NO
//     itemName column — the name comes from the join)
//   - operations via orderOperations ⋈ machines
//   - packing QC template + checks, delivery-photos.json, dispatch-status.json
//
// Builds the printable HTML documents as email attachments (buildDeliveryNoteHtml
// / buildDispatchPackHtml / buildJobTicketHtml), sends via nodemailer using the
// SMTP account from Settings, and audits the action as email.dispatch.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { customers, inventoryItems, machines, orderMaterials, orderOperations, orders, users } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can, deniedMessage } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import { buildFromHeader, isEmailConfigured } from "@/lib/emailConfig";
import { readEmailConfig } from "@/lib/emailConfig.server";
import {
  buildDeliveryEmailSubject,
  buildDispatchPackEmailSubject,
  buildEmailHtmlBody,
  buildEmailTextBody,
  describeSendError,
  parseRecipients,
} from "@/lib/emailDispatch";
import { readOrderProductionPlan } from "@/lib/productionPlan.server";
import { readDispatchStore } from "@/lib/dispatch.server";
import { readPackingChecksStore, readTemplateWithDefault } from "@/lib/packingQc.server";
import { sanitizePhotoMeta } from "@/lib/deliveryPhotos";
import { buildDeliveryNoteHtml, deliveryNoteFilename } from "@/lib/deliveryNote";
import { buildDispatchPackHtml, dispatchPackFilename } from "@/lib/dispatchPack";
import { buildJobTicketHtml, jobTicketFilename } from "@/lib/jobTicket";

/** HTML attachments keep the printable document's name, .html extension. */
const htmlAttachmentName = (pdfName: string): string => pdfName.replace(/\.pdf$/i, ".html");

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

interface PhotoStore {
  orders: Record<string, any[]>;
  batches: Record<string, any[]>;
}

/** data/delivery-photos.json — sanitized proof photos per order / batch. */
function readDeliveryPhotosStore(): PhotoStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir(), "delivery-photos.json"), "utf8"));
    const orders: Record<string, any[]> = {};
    const batches: Record<string, any[]> = {};
    for (const [key, value] of Object.entries(parsed?.orders ?? {})) {
      if (/^\d+$/.test(key)) orders[key] = sanitizePhotoMeta(value);
    }
    for (const [key, value] of Object.entries(parsed?.batches ?? {})) {
      if (/^\d+$/.test(key)) batches[key] = sanitizePhotoMeta(value);
    }
    return { orders, batches };
  } catch {
    return { orders: {}, batches: {} };
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize();
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canSendEmail =
    can(user.role, "orders:write") ||
    can(user.role, "quality:write") ||
    can(user.role, "inventory:write") ||
    can(user.role, "users:manage");
  if (!canSendEmail) {
    return NextResponse.json(
      { error: deniedMessage(user.role, "orders:write") },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = Number(body?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  // ---- recipients -----------------------------------------------------------
  const to = parseRecipients(body?.to);
  if (!to.recipients.length) {
    return NextResponse.json(
      { error: to.rejected[0] ? `Not a valid email address: ${to.rejected[0]}` : "Enter at least one recipient." },
      { status: 400 },
    );
  }
  const cc = parseRecipients(body?.cc ?? "");
  const subjectIn = String(body?.subject ?? "").trim().slice(0, 300);
  const message = String(body?.message ?? "").slice(0, 4000);
  const includeDeliveryNote = body?.includeDeliveryNote === true;
  const includeDispatchPack = body?.includeDispatchPack === true;
  const includeJobTicket = body?.includeJobTicket === true;

  // ---- SMTP account ----------------------------------------------------------
  const cfg = readEmailConfig();
  if (!isEmailConfigured(cfg)) {
    return NextResponse.json(
      { error: "Email is not configured yet — a Manager must set the SMTP account in Settings first." },
      { status: 400 },
    );
  }

  // ---- order + customer (the delivery address lives on the customer) --------
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      title: orders.title,
      projectType: orders.projectType,
      priority: orders.priority,
      status: orders.status,
      totalValue: orders.totalValue,
      dueDate: orders.dueDate,
      progressPercent: orders.progressPercent,
      notes: orders.notes,
      createdAt: orders.createdAt,
      customerId: orders.customerId,
      customerName: customers.name,
      customerCompany: customers.company,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerAddress: customers.address,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.id, orderId));

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // ---- BOM materials — the name comes from the inventoryItems join ---------
  const mats = await db
    .select({
      id: orderMaterials.id,
      itemId: orderMaterials.itemId,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      itemUnit: inventoryItems.unit,
      itemLocation: inventoryItems.location,
      quantityUsed: orderMaterials.quantityUsed,
      consumed: orderMaterials.consumed,
      released: orderMaterials.released,
    })
    .from(orderMaterials)
    .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
    .where(eq(orderMaterials.orderId, orderId));
  const matIds = mats.map((m) => m.id);

  // ---- live stock rows for the documents' dimension/location columns -------
  const liveItems = matIds.length
    ? await db
        .select({
          id: inventoryItems.id,
          sku: inventoryItems.sku,
          name: inventoryItems.name,
          unit: inventoryItems.unit,
          location: inventoryItems.location,
          stockQuantity: inventoryItems.stockQuantity,
        })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, matIds))
    : [];

  // Full machine roster — the builders fall back to it for station labels.
  const machineList = await db
    .select({
      id: machines.id,
      name: machines.name,
      code: machines.code,
      category: machines.category,
      location: machines.location,
    })
    .from(machines);

  // ---- operations — machine name/code come from the machines join ----------
  const ops = await db
    .select({
      id: orderOperations.id,
      stepOrder: orderOperations.stepOrder,
      operationName: orderOperations.operationName,
      estimatedMinutes: orderOperations.estimatedMinutes,
      actualMinutes: orderOperations.actualMinutes,
      status: orderOperations.status,
      machineId: orderOperations.machineId,
      machineName: machines.name,
      machineCode: machines.code,
      machineCategory: machines.category,
      operatorId: orderOperations.operatorId,
      operatorName: users.name,
      operatorAvatar: users.avatarColor,
      startTime: orderOperations.startTime,
      endTime: orderOperations.endTime,
      scheduledStart: orderOperations.scheduledStart,
      scheduledEnd: orderOperations.scheduledEnd,
    })
    .from(orderOperations)
    .leftJoin(machines, eq(orderOperations.machineId, machines.id))
    .leftJoin(users, eq(orderOperations.operatorId, users.id))
    .where(eq(orderOperations.orderId, orderId))
    .orderBy(asc(orderOperations.stepOrder));

  // ---- JSON-store overlays (no productionPlan column on the orders table) ---
  const productionPlan = readOrderProductionPlan(orderId);
  const qc = readTemplateWithDefault();
  const qcStore = readPackingChecksStore();
  const dispatchStore = readDispatchStore();
  const photos = readDeliveryPhotosStore();

  const orderStage = dispatchStore.stages[String(orderId)];
  const batchDispatchStages: Record<string, { stage?: string; proof?: any }> = {};
  const batchPackingChecks: Record<string, boolean[]> = {};
  const batchDeliveryPhotos: Record<string, any[]> = {};
  for (const m of matIds) {
    const key = String(m);
    const batchEntry = dispatchStore.batches[key];
    if (batchEntry && Number(batchEntry.orderId) === orderId) {
      batchDispatchStages[key] = { stage: batchEntry.stage, proof: batchEntry.proof ?? null };
    }
    const batchChecks = qcStore.batches[key];
    if (batchChecks) batchPackingChecks[key] = batchChecks;
    const batchPhotos = photos.batches[key];
    if (batchPhotos?.length) batchDeliveryPhotos[key] = batchPhotos;
  }

  const orderDoc = {
    ...order,
    productionPlan, // from the JSON store — NOT a column on orders
    operations: ops,
    materials: mats,
  };

  // ---- build the requested documents ---------------------------------------
  const attachments: { filename: string; content: string; contentType: string }[] = [];
  const shared = { inventoryItems: liveItems, machines: machineList, qrDataUrl: null as string | null };
  if (includeJobTicket) {
    const html = buildJobTicketHtml(orderDoc, shared);
    attachments.push({ filename: htmlAttachmentName(jobTicketFilename(order.orderNumber)), content: html, contentType: "text/html; charset=utf-8" });
  }
  if (includeDeliveryNote) {
    const html = buildDeliveryNoteHtml(orderDoc, shared);
    attachments.push({ filename: htmlAttachmentName(deliveryNoteFilename(order.orderNumber)), content: html, contentType: "text/html; charset=utf-8" });
  }
  if (includeDispatchPack) {
    const html = buildDispatchPackHtml(orderDoc, {
      ...shared,
      packingTemplate: qc.template,
      packingChecks: qcStore.orders[String(orderId)] ?? null,
      batchPackingChecks,
      deliveryPhotos: photos.orders[String(orderId)] ?? [],
      batchDeliveryPhotos,
      dispatchStage: orderStage?.stage ?? null,
      dispatchProof: orderStage?.proof
        ? {
            receivedBy: orderStage.proof.receivedBy,
            deliveredAt: orderStage.proof.deliveredAt,
            notes: orderStage.proof.notes ?? undefined,
          }
        : null,
      batchDispatchStages,
    });
    attachments.push({ filename: htmlAttachmentName(dispatchPackFilename(order.orderNumber)), content: html, contentType: "text/html; charset=utf-8" });
  }

  // ---- compose + send --------------------------------------------------------
  const fallbackSubject = includeDispatchPack
    ? buildDispatchPackEmailSubject(order)
    : includeDeliveryNote
      ? buildDeliveryEmailSubject(order)
      : `Job ticket — ${order.orderNumber}${order.title ? ` — ${order.title}` : ""}`;
  const subject = subjectIn || fallbackSubject;
  const parts = {
    title: subject,
    message,
    orderNumber: order.orderNumber,
    senderName: user.name,
    attachments: attachments.map((a) => a.filename),
  };

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    await transporter.sendMail({
      from: buildFromHeader(cfg),
      to: to.recipients.join(", "),
      ...(cc.recipients.length ? { cc: cc.recipients.join(", ") } : {}),
      subject,
      html: buildEmailHtmlBody(parts),
      text: buildEmailTextBody(parts),
      attachments,
    });
    logAudit(
      user,
      "email.dispatch",
      "order",
      `sent to ${to.recipients.join(", ")}${cc.recipients.length ? ` (cc ${cc.recipients.join(", ")})` : ""} — ${attachments.length} attachment(s)`,
      orderId,
    );
    return NextResponse.json({
      ok: true,
      message: `Email sent to ${to.recipients.join(", ")}${attachments.length ? ` with ${attachments.length} document(s)` : ""}.`,
    });
  } catch (err) {
    const detail = describeSendError(err);
    logAudit(user, "email.dispatch", "order", `FAILED to ${to.recipients.join(", ")}: ${detail}`, orderId);
    return NextResponse.json({ error: `Could not send the email: ${detail}` }, { status: 502 });
  }
}
