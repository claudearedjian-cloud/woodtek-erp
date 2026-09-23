// ============================================================================
// Printable delivery note — pure model + HTML builder (client-safe, no deps).
//
// One note per production order. Client-facing — no costs, no internal routing,
// only what is being delivered. Per-material batch cards show SKU/quantity
// (qty-only), panel dimensions and shop location from live stock when
// available. Legacy orders (no productionPlan) fall back to a combined
// Materials table. Includes Bill to / Deliver to (customerAddress), QR,
// delivery instructions and 4-signature footer.
// ============================================================================

export const DELIVERY_NOTE_VERSION = 1;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export function deliveryNoteFilename(orderNumber: string): string {
  const safe = String(orderNumber || "order")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "order";
  return `DeliveryNote-${safe}.pdf`;
}

export function formatDeliveryDate(value: unknown): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatDeliveryDateTime(value: unknown): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface DeliveryNoteBuildOptions {
  inventoryItems?: any[];
  machines?: any[];
  qrDataUrl?: string | null;
  generatedAt?: string | Date;
  lang?: string;
}

/**
 * Build a self-contained printable HTML delivery note. No external assets — all
 * styles are inline and the QR is an embedded data URL when provided.
 * Designed for window.open() + print() and "Save as PDF".
 */
export function buildDeliveryNoteHtml(order: any, opts: DeliveryNoteBuildOptions = {}): string {
  const inventoryItems: any[] = Array.isArray(opts.inventoryItems) ? opts.inventoryItems : [];
  const qrDataUrl = opts.qrDataUrl || null;
  const generatedAt = opts.generatedAt ? new Date(String(opts.generatedAt)) : new Date();
  const genStamp = Number.isNaN(generatedAt.getTime()) ? new Date().toLocaleString() : generatedAt.toLocaleString();

  const orderNumber = String(order?.orderNumber ?? `ORDER-${order?.id ?? ""}`);
  const title = String(order?.title ?? "");
  const projectType = String(order?.projectType ?? "—");
  const status = String(order?.status ?? "Pending");
  const dueDate = order?.dueDate ?? null;
  const createdAt = order?.createdAt ?? null;
  const notes = String(order?.notes ?? "").trim();
  const customerCompany = String(order?.customerCompany ?? order?.customerName ?? "—");
  const customerName = String(order?.customerName ?? "");
  const customerPhone = String(order?.customerPhone ?? "");
  const customerEmail = String(order?.customerEmail ?? "");
  const customerAddress = String(order?.customerAddress ?? order?.customer_address ?? order?.address ?? "").trim();
  const progress = Number(order?.progressPercent ?? 0);

  const invById = new Map<number, any>();
  for (const it of inventoryItems) {
    const id = Number(it?.id);
    if (Number.isInteger(id)) invById.set(id, it);
  }

  const dimFor = (itemId: number): string => {
    const it = invById.get(Number(itemId));
    if (!it) return "";
    return String(it.dimensions ?? "").trim();
  };
  const locFor = (itemId: number): string => {
    const it = invById.get(Number(itemId));
    if (!it) return "";
    return String(it.location ?? "").trim();
  };

  const plan = order?.productionPlan ?? null;
  const hasPlan = plan && Array.isArray(plan.items) && plan.items.length > 0;

  let batchesHtml = "";
  if (hasPlan) {
    for (let idx = 0; idx < plan.items.length; idx++) {
      const batch: any = plan.items[idx];
      const batchNumber = idx + 1;
      const batchName = String(batch?.name ?? `Batch ${batchNumber}`);
      const itemId = Number(batch?.itemId);
      const qty = Number(batch?.quantityUsed ?? 0);
      const inv = invById.get(itemId);
      const sku = inv ? String(inv.sku ?? "—") : "—";
      const unit = inv ? String(inv.unit ?? "") : "";
      const dims = dimFor(itemId);
      const loc = locFor(itemId);
      const matAlloc = (order?.materials ?? []).find((m: any) => Number(m?.id) === Number(batch?.materialId) || Number(m?.itemId) === itemId);
      const allocSku = matAlloc?.itemSku ? String(matAlloc.itemSku) : sku;
      const allocUnit = matAlloc?.itemUnit ? String(matAlloc.itemUnit) : unit;
      const allocName = matAlloc?.itemName ? String(matAlloc.itemName) : inv ? String(inv.name ?? batchName) : batchName;

      batchesHtml += `
        <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:14px 0 18px;page-break-inside:avoid">
          <div style="background:#f0fdfa;border-bottom:1px solid #99f6e0;padding:10px 14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#134e4a;text-transform:uppercase">BATCH ${batchNumber} · ${esc(batchName)}</div>
              <div style="font-size:11px;color:#334155;margin-top:2px">
                <span style="font-family:monospace;font-weight:800;color:#0f766e">${esc(allocSku)}</span>
                <span style="margin:0 6px;color:#94a3b8">·</span>
                <span style="font-weight:700">${esc(allocName)}</span>
                ${dims ? `<span style="margin:0 6px;color:#94a3b8">·</span><span style="font-family:monospace;background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 6px;border-radius:6px">${esc(dims)}</span>` : ""}
                ${loc ? `<span style="margin-left:6px;color:#64748b">· Loc: ${esc(loc)}</span>` : ""}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;font-weight:800;color:#0f172a">${qty} ${esc(allocUnit || unit)}</div>
              <div style="font-size:10px;color:#475569">Qty only — client-facing</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead>
              <tr style="background:#134e4a;color:#5eead4">
                <th style="padding:7px 6px;width:28px">#</th>
                <th style="padding:7px 8px;text-align:left">SKU</th>
                <th style="padding:7px 8px;text-align:left">Description</th>
                <th style="padding:7px 6px;width:70px;text-align:right">Qty</th>
                <th style="padding:7px 6px;width:56px">Unit</th>
                <th style="padding:7px 8px;text-align:left">Dimensions</th>
                <th style="padding:7px 6px;width:50px;text-align:center">Check ☐</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align:center;font-weight:800;padding:8px 6px;border-top:1px solid #e2e8f0">1</td>
                <td style="font-family:monospace;font-weight:800;color:#0f766e;padding:8px;border-top:1px solid #e2e8f0">${esc(allocSku)}</td>
                <td style="font-weight:700;padding:8px;border-top:1px solid #e2e8f0">${esc(allocName)}${batchName && batchName !== allocName ? ` — ${esc(batchName)}` : ""}</td>
                <td style="text-align:right;font-family:monospace;font-weight:900;padding:8px;border-top:1px solid #e2e8f0">${esc(String(qty))}</td>
                <td style="padding:8px;border-top:1px solid #e2e8f0">${esc(allocUnit || unit)}</td>
                <td style="font-family:monospace;padding:8px;border-top:1px solid #e2e8f0">${esc(dims || "—")}</td>
                <td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }
  } else {
    const materials: any[] = Array.isArray(order?.materials) ? order.materials : [];
    const matsRows = materials.map((m: any, i: number) => {
      const itemId = Number(m?.itemId);
      const sku = String(m?.itemSku ?? invById.get(itemId)?.sku ?? "—");
      const name = String(m?.itemName ?? m?.productionItemName ?? invById.get(itemId)?.name ?? "Material");
      const qty = String(m?.quantityUsed ?? "—");
      const unit = String(m?.itemUnit ?? invById.get(itemId)?.unit ?? "");
      const dims = dimFor(itemId);
      return `<tr>
        <td style="text-align:center;font-weight:700;padding:8px 6px;border-top:1px solid #e2e8f0">${i + 1}</td>
        <td style="font-family:monospace;font-weight:800;color:#0f766e;padding:8px;border-top:1px solid #e2e8f0">${esc(sku)}</td>
        <td style="font-weight:700;padding:8px;border-top:1px solid #e2e8f0">${esc(name)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:900;padding:8px;border-top:1px solid #e2e8f0">${esc(qty)}</td>
        <td style="padding:8px;border-top:1px solid #e2e8f0">${esc(unit)}</td>
        <td style="font-family:monospace;padding:8px;border-top:1px solid #e2e8f0">${esc(dims || "—")}</td>
        <td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
      </tr>`;
    }).join("");

    batchesHtml = `
      <div style="margin:14px 0">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:6px">Delivery list — qty only</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#134e4a;color:#5eead4">
            <th style="padding:7px 6px;width:28px">#</th>
            <th style="padding:7px 8px;text-align:left">SKU</th>
            <th style="padding:7px 8px;text-align:left">Description</th>
            <th style="padding:7px 6px;width:70px;text-align:right">Qty</th>
            <th style="padding:7px 6px;width:56px">Unit</th>
            <th style="padding:7px 8px;text-align:left">Dimensions</th>
            <th style="padding:7px 6px;width:50px;text-align:center">Check ☐</th>
          </tr></thead>
          <tbody>${matsRows || `<tr><td colspan="7" style="padding:12px;text-align:center;color:#94a3b8">No materials allocated</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  const totalMats = hasPlan ? plan.items.length : (order?.materials ?? []).length;
  const totalQty = hasPlan
    ? plan.items.reduce((s: number, it: any) => s + (Number(it?.quantityUsed) || 0), 0)
    : (order?.materials ?? []).reduce((s: number, m: any) => s + (Number(m?.quantityUsed) || 0), 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Delivery Note ${esc(orderNumber)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", Arial, Helvetica, sans-serif; color:#0f172a; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @media print { .no-print { display:none !important; } }
  a { color: inherit; }
  .cut { border-top: 1px dashed #94a3b8; margin: 10px 0; position:relative; }
  .cut span { position:absolute; top:-7px; left:50%; transform:translateX(-50%); background:#fff; padding:0 8px; font-size:9px; letter-spacing:0.1em; color:#94a3b8; }
</style>
</head>
<body>
  <div style="max-width:800px;margin:0 auto;padding:18px 18px 24px">

    <!-- Brand band teal -->
    <div style="background:#0f172a;border-radius:14px;overflow:hidden;border:1px solid #1e293b">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px 14px">
        <div>
          <div style="color:#2dd4bf;font-weight:900;letter-spacing:0.14em;font-size:18px;line-height:1">WOODTEK</div>
          <div style="color:#cbd5e1;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;margin-top:3px">Furniture Service Center</div>
          <div style="margin-top:10px;display:inline-flex;align-items:center;gap:8px;background:#2dd4bf;color:#0f172a;font-weight:900;font-size:11px;letter-spacing:0.1em;padding:5px 10px;border-radius:999px;text-transform:uppercase">Delivery Note</div>
        </div>
        <div style="text-align:right;min-width:180px">
          <div style="font-family:monospace;font-weight:900;font-size:22px;color:#2dd4bf;letter-spacing:0.02em;line-height:1">${esc(orderNumber)}</div>
          <div style="color:#e2e8f0;font-size:11px;font-weight:700;margin-top:3px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title || "—")}</div>
          <div style="margin-top:6px;display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap">
            <span style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:#134e4a;color:#5eead4;border:1px solid #0f766e">${esc(status)}</span>
            <span style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0">Due: ${esc(formatDeliveryDate(dueDate))}</span>
          </div>
        </div>
      </div>
      <div style="height:4px;background:#2dd4bf"></div>
      <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 18px;background:#1e293b;color:#cbd5e1;font-size:10px">
        <span>Issued: ${esc(formatDeliveryDate(createdAt))} · Delivery: ${esc(formatDeliveryDate(dueDate))} · Items: ${totalMats} · Qty: ${totalQty}</span>
        <span>Printed: ${esc(genStamp)}</span>
      </div>
    </div>

    <!-- Bill to / Deliver to -->
    <div style="display:grid;grid-template-columns:1fr 1fr 0.7fr;gap:12px;margin-top:14px">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Bill to</div>
        <div style="font-size:13px;font-weight:900;color:#0f172a;margin-top:4px">${esc(customerCompany)}</div>
        ${customerName ? `<div style="font-size:11px;color:#334155;margin-top:2px">Attn: ${esc(customerName)}</div>` : ""}
        ${customerPhone ? `<div style="font-size:11px;color:#334155">Tel: ${esc(customerPhone)}</div>` : ""}
        ${customerEmail ? `<div style="font-size:11px;color:#334155">Email: ${esc(customerEmail)}</div>` : ""}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;font-size:10px">
          <span style="background:#f0fdfa;border:1px solid #99f6e0;color:#134e4a;padding:3px 8px;border-radius:999px">Ref: <strong style="font-family:monospace">${esc(orderNumber)}</strong></span>
        </div>
      </div>
      <div style="border:1px solid #99f6e0;border-radius:12px;padding:12px 14px;background:#f0fdfa">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#0f766e;text-transform:uppercase">Deliver to</div>
        <div style="font-size:13px;font-weight:900;color:#0f172a;margin-top:4px">${esc(customerCompany)}</div>
        ${customerAddress ? `<div style="font-size:11px;color:#334155;margin-top:4px;white-space:pre-wrap;line-height:1.4">${esc(customerAddress)}</div>` : `<div style="font-size:11px;color:#94a3b8;margin-top:4px">No delivery address on file</div>`}
        ${customerPhone ? `<div style="font-size:11px;color:#334155;margin-top:6px">Tel: ${esc(customerPhone)}</div>` : ""}
        <div style="margin-top:8px;font-size:10px;color:#475569">Type: <strong>${esc(projectType)}</strong></div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc;display:flex;gap:12px;align-items:center;flex-direction:column;justify-content:center;text-align:center">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Scan to open</div>
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="Order QR" style="width:96px;height:96px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;padding:6px">` : `<div style="width:96px;height:96px;border-radius:10px;border:1px dashed #cbd5e1;background:#fff;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;text-align:center;padding:8px">QR<br>available<br>on screen</div>`}
        <div style="font-size:10px;color:#64748b;font-family:monospace;word-break:break-all">${esc(orderNumber)}</div>
      </div>
    </div>

    <!-- Summary chips -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <span style="background:#134e4a;color:#5eead4;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${totalMats} batch${totalMats===1?"":"es"}</span>
      <span style="background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${totalQty} total qty</span>
      ${progress ? `<span style="background:${progress===100?"#dcfce7":"#fef3c7"};color:${progress===100?"#166534":"#92400e"};font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">Progress ${esc(String(progress))}%</span>` : ""}
    </div>

    <!-- Batches qty-only -->
    ${batchesHtml}

    ${notes ? `<div style="margin-top:14px;border:1px solid #99f6e0;background:#f0fdfa;border-radius:12px;padding:12px 14px">
      <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#0f766e;text-transform:uppercase">Delivery notes</div>
      <div style="font-size:11px;color:#334155;margin-top:6px;white-space:pre-wrap;line-height:1.5">${esc(notes)}</div>
    </div>` : ""}

    <!-- Delivery instructions -->
    <div style="margin-top:14px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc">
      <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#334155;text-transform:uppercase">Delivery instructions</div>
      <ul style="margin:6px 0 0 16px;padding:0;font-size:11px;color:#334155;line-height:1.6">
        <li>Please check <strong>quantities</strong> against this note upon arrival. Report any discrepancy immediately.</li>
        <li>Goods remain property of <strong>WoodTek</strong> until fully paid. Handle with care — keep dry and protected.</li>
        <li>Sign below to confirm receipt. Keep one copy for your records.</li>
        <li>For service issues contact WoodTek with your order number <strong style="font-family:monospace">${esc(orderNumber)}</strong>.</li>
      </ul>
    </div>

    <!-- Signatures 4 -->
    <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Prepared by (WoodTek)</div>
        <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
        <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Delivered by (Driver)</div>
        <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
        <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time · Vehicle</div>
      </div>
    </div>
    <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Received by (Client)</div>
        <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
        <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Client stamp / remarks</div>
        <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
        <div style="font-size:9px;color:#64748b;margin-top:4px">Stamp · Remarks · Quality check</div>
      </div>
    </div>

    <div style="margin-top:18px;text-align:center;font-size:9px;color:#94a3b8">
      WoodTek ERP — Furniture Service Center · Delivery Note travels with the goods · Generated ${esc(genStamp)} · ${esc(orderNumber)}
    </div>

    <div class="cut no-print" style="margin-top:16px"><span>✂ cut here — client copy / WoodTek copy</span></div>

    <div class="no-print" style="margin-top:16px;display:flex;justify-content:center;gap:8px">
      <button onclick="window.print()" style="background:#134e4a;color:#5eead4;border:1px solid #0f766e;font-weight:800;font-size:12px;padding:10px 18px;border-radius:10px;cursor:pointer">🖨 Print delivery note</button>
      <button onclick="window.close()" style="background:#fff;border:1px solid #e2e8f0;color:#334155;font-weight:700;font-size:12px;padding:10px 18px;border-radius:10px;cursor:pointer">Close</button>
    </div>
  </div>
</body>
</html>`;
}
