// ============================================================================
// src/lib/pims.ts
// PIMS invoice bridge: XML parsing + import into WoodTek production orders.
//
// The PIMS export is a flat list of <TAG>value</TAG> elements. Document-level
// header fields appear before the first <LINETYPE>; each <LINETYPE> starts a
// new line item whose fields follow until the next <LINETYPE>.
//
// De-duplication key: the invoice number (found in the XML header or the file
// name). Every imported invoice is recorded in pims_imports so it is never
// imported twice.
// ============================================================================

import { db } from "@/db";
import { orders, customers, machines, orderOperations, pimsImports, pimsSettings } from "@/db/schema";
import { eq, ilike, or } from "drizzle-orm";

// --- candidate header tag names (checked in order) --------------------------
const INVOICE_NO_KEYS = ["INVOICENO", "INVOICENUMBER", "DOCNO", "DOCNUMBER", "VOUCHERNO", "VOUCHERNUMBER", "BILLNO", "NUMBER", "NO"];
const CUSTOMER_KEYS = ["CUSTOMERNAME", "CUSTOMER", "CLIENTNAME", "CLIENT", "ACCOUNTNAME", "ACCOUNT", "BILLTO", "PARTYNAME", "NAME"];
const DATE_KEYS = ["INVOICEDATE", "DOCDATE", "DATE", "TRXDATE", "ISSUEDATE", "CREATEDDATE"];

export type ParsedInvoice = {
  header: Record<string, string>;
  lines: Record<string, string>[];
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: string | null;
};

function firstValue(header: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = header[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

/**
 * Parse a PIMS XML string into header + line items.
 * No external XML library — a tolerant tag-walker handles the real PIMS
 * flat format and survives slightly malformed exports.
 */
export function parsePimsXml(xml: string, fileName?: string): ParsedInvoice {
  const cleaned = xml.replace(/^\uFEFF/, "").trim();
  const segments = splitFlat(cleaned);

  const header: Record<string, string> = {};
  const lines: Record<string, string>[] = [];
  for (const seg of segments) {
    if (seg.type === "line") lines.push(seg.fields);
    else Object.assign(header, seg.fields);
  }

  const invoiceNumber =
    firstValue(header, INVOICE_NO_KEYS) ||
    (fileName ? fileName.replace(/\.xml$/i, "").trim() : null) ||
    null;

  return {
    header,
    lines,
    invoiceNumber,
    customerName: firstValue(header, CUSTOMER_KEYS),
    invoiceDate: firstValue(header, DATE_KEYS),
  };
}

/**
 * Split the raw XML into header fields and line items by walking the actual
 * tag sequence (preserves order and grouping even when LINETYPE repeats).
 */
function splitFlat(xml: string): { type: "header" | "line"; fields: Record<string, string> }[] {
  // Match only LEAF tags (no nested tags inside), so a root wrapper such as
  // <INVOICE>…</INVOICE> is skipped and its inner fields are walked directly.
  const tagRe = /<([A-Za-z0-9_.]+)>([^<]*)<\/\1>/g;
  const out: { type: "header" | "line"; fields: Record<string, string> }[] = [];
  let current: Record<string, string> | null = null;
  let currentType: "header" | "line" = "header";
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[1];
    const value = decodeEntities(m[2]).trim();
    if (tag === "LINETYPE") {
      if (current) out.push({ type: currentType, fields: current });
      current = { LINETYPE: value };
      currentType = "line";
    } else if (current) {
      current[tag] = value;
    } else {
      current = { [tag]: value };
      currentType = "header";
    }
  }
  if (current) out.push({ type: currentType, fields: current });
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// --- service map ------------------------------------------------------------

export type ServiceMap = Record<string, { operationName: string; machineCategory: string }>;

export async function getServiceMap(): Promise<ServiceMap> {
  const rows = await db.select().from(pimsSettings).where(eq(pimsSettings.settingKey, "service_map"));
  const v = rows[0]?.settingValue;
  return (v && typeof v === "object" ? v : {}) as ServiceMap;
}

// --- import -----------------------------------------------------------------

export type ImportResult =
  | { status: "imported"; orderId: number; orderNumber: string; invoiceNumber: string; customerName: string | null; operations: number }
  | { status: "skipped"; invoiceNumber: string; message: string };

export async function importPimsInvoice(xml: string, fileName: string): Promise<ImportResult> {
  const parsed = parsePimsXml(xml, fileName);
  const invoiceNumber = parsed.invoiceNumber || fileName.replace(/\.xml$/i, "");
  const customerName = parsed.customerName || "PIMS Customer";

  // De-duplication: skip if this invoice number was already imported.
  const [existing] = await db.select({ id: pimsImports.id }).from(pimsImports).where(eq(pimsImports.invoiceNumber, invoiceNumber));
  if (existing) {
    return { status: "skipped", invoiceNumber, message: "Invoice already imported." };
  }

  const serviceMap = await getServiceMap();

  // Split lines: SER.* (and any code in the service map) = operations;
  // everything else = materials (kept as reference text on the order).
  const serviceLines = parsed.lines.filter(l => {
    const code = (l["ITEMCODE"] || "").toUpperCase();
    return code.startsWith("SER") || serviceMap[code] != null;
  });
  const materialLines = parsed.lines.filter(l => {
    const code = (l["ITEMCODE"] || "").toUpperCase();
    return !(code.startsWith("SER") || serviceMap[code] != null);
  });

  // Resolve (or create) the customer.
  let customerId: number;
  const nameLike = customerName.trim();
  const [found] = await db.select({ id: customers.id }).from(customers)
    .where(or(ilike(customers.company, nameLike), ilike(customers.name, nameLike)))
    .limit(1);
  if (found) {
    customerId = found.id;
  } else {
    const [created] = await db.insert(customers).values({
      name: nameLike,
      company: nameLike,
      email: "pims.import@woodtek.local",
      phone: "",
      address: "PIMS import",
      notes: "Created automatically from PIMS invoice import.",
    }).returning({ id: customers.id });
    customerId = created.id;
  }

  // Reference notes from material lines + VAT/cash context.
  const materialNotes = materialLines.length
    ? materialLines.map(l => `• ${l["ITEMDESC"] || l["ITEMCODE"]} ×${l["Q1QTY"] || 1} (${l["ITEMCODE"] || ""}) @ $${l["UPRICE"] || 0}`).join("\n")
    : "";
  const headerNotes = [
    parsed.header["TRANSACTIONTYPE"] ? `PIMS ${parsed.header["TRANSACTIONTYPE"]}` : "",
    parsed.header["CURRENCY"] ? `Currency: ${parsed.header["CURRENCY"]}` : "",
  ].filter(Boolean).join(" · ");
  const notes = [headerNotes, materialNotes].filter(Boolean).join("\n");

  const totalValue = parsed.lines.reduce((s, l) => s + (parseFloat(l["LINETOTNET"] || "0") || 0), 0);

  const invoiceDate = parsed.invoiceDate ? new Date(parsed.invoiceDate) : null;
  const due = invoiceDate && !Number.isNaN(invoiceDate.getTime())
    ? new Date(invoiceDate.getTime() + 7 * 24 * 3600 * 1000)
    : new Date(Date.now() + 7 * 24 * 3600 * 1000);

  const title = serviceLines[0]?.ITEMDESC || materialLines[0]?.ITEMDESC || `PIMS Invoice ${invoiceNumber}`;

  const [newOrder] = await db.insert(orders).values({
    orderNumber: `PIMS-${invoiceNumber}`,
    customerId,
    title,
    projectType: "PIMS Import",
    priority: "Normal",
    status: "Pending",
    totalValue: String(totalValue.toFixed(2)),
    dueDate: due,
    progressPercent: 0,
    notes: notes || null,
  }).returning();

  // Create operations from service lines (mapped via the service map).
  const allMachines = await db.select().from(machines);
  let stepOrder = 0;
  for (const line of serviceLines) {
    const code = (line["ITEMCODE"] || "").toUpperCase();
    const map = serviceMap[code];
    const qty = parseInt(line["Q1QTY"] || "1", 10) || 1;
    stepOrder += 1;
    const operationName = map
      ? map.operationName
      : (line["ITEMDESC"] || `Service ${code}`).trim();
    const machineCategory = map?.machineCategory || "";
    const machine = machineCategory
      ? allMachines.find(m => m.category === machineCategory) || allMachines[0]
      : null;
    await db.insert(orderOperations).values({
      orderId: newOrder.id,
      machineId: machine ? machine.id : null,
      stepOrder,
      operationName: qty > 1 ? `${operationName} ×${qty}` : operationName,
      estimatedMinutes: 60,
      status: stepOrder === 1 ? "Ready" : "Pending",
    });
  }

  // Log the import.
  await db.insert(pimsImports).values({
    fileName,
    invoiceNumber,
    customerName,
    orderId: newOrder.id,
    status: "imported",
    message: `${serviceLines.length} operations, ${materialLines.length} material lines`,
    rawXml: xml.slice(0, 20000),
  });

  return {
    status: "imported",
    orderId: newOrder.id,
    orderNumber: newOrder.orderNumber,
    invoiceNumber,
    customerName,
    operations: stepOrder,
  };
}
