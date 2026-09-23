// ============================================================================
// Combined dispatch pack — printable pack that staples job ticket +
// delivery note + packing QC + delivery photos + dispatch proof.
// Client-safe, no deps, self-contained HTML for window.open() + print().
// One pack per production order.
// ============================================================================

export const DISPATCH_PACK_VERSION = 1;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export function dispatchPackFilename(orderNumber: string): string {
  const safe = String(orderNumber || "order")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "order";
  return `DispatchPack-${safe}.pdf`;
}

export function formatPackDate(value: unknown): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatPackDateTime(value: unknown): string {
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

function formatScheduled(start: unknown, end: unknown): string {
  if (!start || !end) return "—";
  const s = new Date(String(start));
  const e = new Date(String(end));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${s.toLocaleDateString()} · ${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${formatPackDateTime(s)} → ${formatPackDateTime(e)}`;
}

export interface DispatchPackBuildOptions {
  inventoryItems?: any[];
  machines?: any[];
  qrDataUrl?: string | null;
  packingTemplate?: string[] | null;
  packingChecks?: boolean[] | null;
  batchPackingChecks?: Record<string, boolean[]> | null;
  deliveryPhotos?: any[] | null;
  batchDeliveryPhotos?: Record<string, any[]> | null;
  dispatchStage?: string | null;
  dispatchProof?: { receivedBy?: string; deliveredAt?: string; notes?: string } | null;
  batchDispatchStages?: Record<string, { stage?: string; proof?: any }> | null;
  generatedAt?: string | Date;
}

export function buildDispatchPackHtml(order: any, opts: DispatchPackBuildOptions = {}): string {
  const inventoryItems: any[] = Array.isArray(opts.inventoryItems) ? opts.inventoryItems : [];
  const machines: any[] = Array.isArray(opts.machines) ? opts.machines : [];
  const qrDataUrl = opts.qrDataUrl || null;
  const packingTemplate: string[] = Array.isArray(opts.packingTemplate) ? opts.packingTemplate : [];
  const packingChecks: boolean[] = Array.isArray(opts.packingChecks) ? opts.packingChecks : [];
  const batchPackingChecks = opts.batchPackingChecks && typeof opts.batchPackingChecks === "object" ? opts.batchPackingChecks : {};
  const deliveryPhotos: any[] = Array.isArray(opts.deliveryPhotos) ? opts.deliveryPhotos : [];
  const batchDeliveryPhotos = opts.batchDeliveryPhotos && typeof opts.batchDeliveryPhotos === "object" ? opts.batchDeliveryPhotos : {};
  const dispatchStage = opts.dispatchStage ? String(opts.dispatchStage) : null;
  const dispatchProof = opts.dispatchProof || null;
  const batchDispatchStages = opts.batchDispatchStages && typeof opts.batchDispatchStages === "object" ? opts.batchDispatchStages : {};
  const generatedAt = opts.generatedAt ? new Date(String(opts.generatedAt)) : new Date();
  const genStamp = Number.isNaN(generatedAt.getTime()) ? new Date().toLocaleString() : generatedAt.toLocaleString();

  const orderNumber = String(order?.orderNumber ?? `ORDER-${order?.id ?? ""}`);
  const title = String(order?.title ?? "");
  const projectType = String(order?.projectType ?? "—");
  const priority = String(order?.priority ?? "Normal");
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
  const machineById = new Map<number, any>();
  for (const m of machines) {
    const id = Number(m?.id);
    if (Number.isInteger(id)) machineById.set(id, m);
  }
  const opsById = new Map<number, any>();
  for (const op of (order?.operations ?? [] as any[])) {
    const id = Number(op?.id);
    if (Number.isInteger(id)) opsById.set(id, op);
  }

  const dimFor = (itemId: number): string => {
    const it = invById.get(Number(itemId));
    return it ? String(it.dimensions ?? "").trim() : "";
  };
  const locFor = (itemId: number): string => {
    const it = invById.get(Number(itemId));
    return it ? String(it.location ?? "").trim() : "";
  };

  const plan = order?.productionPlan ?? null;
  const hasPlan = plan && Array.isArray(plan.items) && plan.items.length > 0;

  // Summary counts
  const totalBatches = hasPlan ? plan.items.length : (order?.materials ?? []).length;
  const totalOps = hasPlan
    ? plan.items.reduce((s: number, it: any) => s + (Array.isArray(it?.steps) ? it.steps.length : 0), 0)
    : (order?.operations ?? []).length;
  const totalMinutes = hasPlan
    ? plan.items.reduce((s: number, it: any) => s + (Array.isArray(it?.steps) ? it.steps.reduce((a: number, st: any) => a + (Number(st?.estimatedMinutes) || 0), 0) : 0), 0)
    : (order?.operations ?? []).reduce((s: number, op: any) => s + (Number(op?.estimatedMinutes) || 0), 0);
  const totalQty = hasPlan
    ? plan.items.reduce((s: number, it: any) => s + (Number(it?.quantityUsed) || 0), 0)
    : (order?.materials ?? []).reduce((s: number, m: any) => s + (Number(m?.quantityUsed) || 0), 0);
  const qcTotal = packingTemplate.length;
  const qcDone = packingChecks.filter(Boolean).length;
  const photosCount = deliveryPhotos.length + Object.values(batchDeliveryPhotos).reduce((s: number, arr: any) => s + (Array.isArray(arr) ? arr.length : 0), 0);

  // Build per-batch job ticket section
  let jobBatchesHtml = "";
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
      const steps: any[] = Array.isArray(batch?.steps) ? batch.steps : [];
      const batchMinutes = steps.reduce((s: number, st: any) => s + (Number(st?.estimatedMinutes) || 0), 0);
      const stepRows = steps.map((st: any, sIdx: number) => {
        const opId = Number(st?.operationId);
        const live = opsById.get(opId);
        const opName = String(st?.operationName ?? live?.operationName ?? `Step ${sIdx + 1}`);
        const cat = String(st?.machineCategory ?? live?.machineCategory ?? "—");
        const mid = st?.machineId != null ? Number(st.machineId) : live?.machineId != null ? Number(live.machineId) : null;
        const machine = mid != null ? machineById.get(mid) : null;
        const station = machine ? `${esc(machine.code)} — ${esc(machine.name)}` : mid == null ? `<span style="color:#64748b">Auto-assign</span>` : `Machine #${esc(String(mid))}`;
        const est = Number(st?.estimatedMinutes ?? live?.estimatedMinutes ?? 0);
        const sched = live ? formatScheduled(live.scheduledStart, live.scheduledEnd) : "—";
        const liveStatus = live ? String(live.status ?? "") : "";
        const statusDot = liveStatus === "Completed" ? "✓" : liveStatus === "In Progress" ? "●" : liveStatus === "Ready" ? "○" : "·";
        return `<tr>
          <td style="text-align:center;font-weight:800;padding:7px 6px;border-top:1px solid #e2e8f0">${sIdx + 1}</td>
          <td style="font-weight:700;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(opName)}</td>
          <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(cat)}</td>
          <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${station}</td>
          <td style="text-align:center;font-family:monospace;padding:7px 6px;border-top:1px solid #e2e8f0">${est || "—"}</td>
          <td style="font-size:10px;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(sched)}</td>
          <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0">${esc(statusDot)}</td>
          <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
          <td style="min-width:70px;border-bottom:1px solid #94a3b8;border-top:1px solid #e2e8f0"></td>
        </tr>`;
      }).join("");

      // Batch QC + photos for this batch
      const bChecks = batchPackingChecks[String(batch?.materialId)] || [];
      const bQcDone = bChecks.filter(Boolean).length;
      const bQcTotal = packingTemplate.length;
      const bPhotos = batchDeliveryPhotos[String(batch?.materialId)] || [];
      const bStageInfo = batchDispatchStages[String(batch?.materialId)] || {};
      const bStage = bStageInfo.stage ? String(bStageInfo.stage) : "";

      jobBatchesHtml += `
        <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:14px 0 18px;page-break-inside:avoid">
          <div style="background:#eef2ff;border-bottom:1px solid #c7d2fe;padding:10px 14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#3730a3;text-transform:uppercase">BATCH ${batchNumber} · ${esc(batchName)} ${bStage ? `· ${esc(bStage)}` : ""}</div>
              <div style="font-size:11px;color:#334155;margin-top:2px">
                <span style="font-family:monospace;font-weight:800;color:#4338ca">${esc(allocSku)}</span>
                <span style="margin:0 6px;color:#94a3b8">·</span>
                <span style="font-weight:700">${esc(allocName)}</span>
                <span style="margin:0 6px;color:#94a3b8">·</span>
                <span>${esc(String(qty))} ${esc(allocUnit || unit)}</span>
                ${dims ? `<span style="margin:0 6px;color:#94a3b8">·</span><span style="font-family:monospace;background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 6px;border-radius:6px">${esc(dims)}</span>` : ""}
                ${loc ? `<span style="margin-left:6px;color:#64748b">· Loc: ${esc(loc)}</span>` : ""}
              </div>
            </div>
            <div style="text-align:right;font-size:10px;color:#334155">
              <div>${steps.length} pass${steps.length===1?"":"es"} · ${batchMinutes} min</div>
              ${bQcTotal ? `<div>QC ${bQcDone}/${bQcTotal} · Photos ${bPhotos.length}</div>` : `<div>Photos ${bPhotos.length}</div>`}
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#312e81;color:#a5b4fc">
              <th style="padding:7px 6px;width:28px">#</th>
              <th style="padding:7px 8px;text-align:left">Operation</th>
              <th style="padding:7px 8px;text-align:left">Machine type</th>
              <th style="padding:7px 8px;text-align:left">Station</th>
              <th style="padding:7px 6px;width:58px">Est</th>
              <th style="padding:7px 8px;text-align:left">Slot</th>
              <th style="padding:7px 6px;width:34px">St</th>
              <th style="padding:7px 6px;width:40px">Done</th>
              <th style="padding:7px 8px;width:90px">Operator</th>
            </tr></thead>
            <tbody>${stepRows || `<tr><td colspan="9" style="padding:12px;text-align:center;color:#94a3b8">No passes</td></tr>`}</tbody>
          </table>
        </div>`;
    }
  } else {
    const materials: any[] = Array.isArray(order?.materials) ? order.materials : [];
    const ops: any[] = Array.isArray(order?.operations) ? order.operations : [];
    const matsRows = materials.map((m: any, i: number) => {
      const itemId = Number(m?.itemId);
      const sku = String(m?.itemSku ?? invById.get(itemId)?.sku ?? "—");
      const name = String(m?.itemName ?? invById.get(itemId)?.name ?? "Material");
      const qty = String(m?.quantityUsed ?? "—");
      const unit = String(m?.itemUnit ?? invById.get(itemId)?.unit ?? "");
      const dims = dimFor(itemId);
      const loc = locFor(itemId);
      return `<tr>
        <td style="text-align:center;font-weight:700;padding:7px 6px;border-top:1px solid #e2e8f0">${i + 1}</td>
        <td style="font-family:monospace;font-weight:800;color:#4338ca;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(sku)}</td>
        <td style="font-weight:700;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(name)}</td>
        <td style="text-align:right;font-family:monospace;padding:7px 6px;border-top:1px solid #e2e8f0">${esc(qty)}</td>
        <td style="padding:7px 6px;border-top:1px solid #e2e8f0">${esc(unit)}</td>
        <td style="font-family:monospace;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(dims || "—")}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(loc || "—")}</td>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
      </tr>`;
    }).join("");
    const opsRows = ops.slice().sort((a: any, b: any) => (Number(a?.stepOrder) || 0) - (Number(b?.stepOrder) || 0)).map((op: any, i: number) => {
      const pos = Number(op?.stepOrder ?? i + 1);
      const opName = String(op?.operationName ?? "");
      const cat = String(op?.machineCategory ?? "—");
      const mid = op?.machineId != null ? Number(op.machineId) : null;
      const machine = mid != null ? machineById.get(mid) : null;
      const station = machine ? `${esc(machine.code)} — ${esc(machine.name)}` : mid == null ? `<span style="color:#64748b">Auto</span>` : `Machine #${esc(String(mid))}`;
      const est = Number(op?.estimatedMinutes ?? 0);
      const sched = formatScheduled(op?.scheduledStart, op?.scheduledEnd);
      const st = String(op?.status ?? "");
      const dot = st === "Completed" ? "✓" : st === "In Progress" ? "●" : st === "Ready" ? "○" : "·";
      return `<tr>
        <td style="text-align:center;font-weight:800;padding:7px 6px;border-top:1px solid #e2e8f0">${pos}</td>
        <td style="font-weight:700;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(opName)}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(cat)}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${station}</td>
        <td style="text-align:center;font-family:monospace;padding:7px 6px;border-top:1px solid #e2e8f0">${est || "—"}</td>
        <td style="font-size:10px;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(sched)}</td>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0">${esc(dot)}</td>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
        <td style="min-width:80px;border-bottom:1px solid #94a3b8;border-top:1px solid #e2e8f0"></td>
      </tr>`;
    }).join("");

    jobBatchesHtml = `
      <div style="margin:14px 0">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:6px">Materials / Cut list</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
          <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">SKU</th><th style="padding:7px 8px;text-align:left">Item</th><th style="padding:7px 6px;width:58px">Qty</th><th style="padding:7px 6px;width:46px">Unit</th><th style="padding:7px 8px;text-align:left">Dimensions</th><th style="padding:7px 8px;text-align:left">Location</th><th style="padding:7px 6px;width:50px">Picked</th>
        </tr></thead><tbody>${matsRows || `<tr><td colspan="8" style="padding:12px;text-align:center;color:#94a3b8">No materials</td></tr>`}</tbody></table>
      </div>
      <div style="margin:18px 0 8px">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#334155;text-transform:uppercase;margin-bottom:6px">Production routing — sequential passes</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
          <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">Operation</th><th style="padding:7px 8px;text-align:left">Machine type</th><th style="padding:7px 8px;text-align:left">Station</th><th style="padding:7px 6px;width:58px">Est</th><th style="padding:7px 8px;text-align:left">Slot</th><th style="padding:7px 6px;width:34px">St</th><th style="padding:7px 6px;width:40px">Done</th><th style="padding:7px 8px;width:90px">Operator</th>
        </tr></thead><tbody>${opsRows || `<tr><td colspan="9" style="padding:12px;text-align:center;color:#94a3b8">No passes</td></tr>`}</tbody></table>
      </div>`;
  }

  // Delivery list qty-only (similar to deliveryNote)
  let deliveryHtml = "";
  if (hasPlan) {
    let rows = "";
    for (let idx = 0; idx < plan.items.length; idx++) {
      const batch: any = plan.items[idx];
      const itemId = Number(batch?.itemId);
      const qty = Number(batch?.quantityUsed ?? 0);
      const inv = invById.get(itemId);
      const sku = inv ? String(inv.sku ?? "—") : "—";
      const unit = inv ? String(inv.unit ?? "") : "";
      const dims = dimFor(itemId);
      const matAlloc = (order?.materials ?? []).find((m: any) => Number(m?.id) === Number(batch?.materialId) || Number(m?.itemId) === itemId);
      const allocSku = matAlloc?.itemSku ? String(matAlloc.itemSku) : sku;
      const allocName = matAlloc?.itemName ? String(matAlloc.itemName) : inv ? String(inv.name ?? batch?.name ?? "") : String(batch?.name ?? "");
      const allocUnit = matAlloc?.itemUnit ? String(matAlloc.itemUnit) : unit;
      rows += `<tr>
        <td style="text-align:center;font-weight:700;padding:8px 6px;border-top:1px solid #e2e8f0">${idx + 1}</td>
        <td style="font-family:monospace;font-weight:800;color:#4338ca;padding:8px;border-top:1px solid #e2e8f0">${esc(allocSku)}</td>
        <td style="font-weight:700;padding:8px;border-top:1px solid #e2e8f0">${esc(allocName)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:900;padding:8px;border-top:1px solid #e2e8f0">${esc(String(qty))}</td>
        <td style="padding:8px;border-top:1px solid #e2e8f0">${esc(allocUnit || unit)}</td>
        <td style="font-family:monospace;padding:8px;border-top:1px solid #e2e8f0">${esc(dims || "—")}</td>
        <td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
      </tr>`;
    }
    deliveryHtml = `<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
      <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">SKU</th><th style="padding:7px 8px;text-align:left">Description</th><th style="padding:7px 6px;width:70px;text-align:right">Qty</th><th style="padding:7px 6px;width:56px">Unit</th><th style="padding:7px 8px;text-align:left">Dimensions</th><th style="padding:7px 6px;width:50px;text-align:center">Check</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    const materials: any[] = Array.isArray(order?.materials) ? order.materials : [];
    const rows = materials.map((m: any, i: number) => {
      const itemId = Number(m?.itemId);
      const sku = String(m?.itemSku ?? invById.get(itemId)?.sku ?? "—");
      const name = String(m?.itemName ?? invById.get(itemId)?.name ?? "Material");
      const qty = String(m?.quantityUsed ?? "—");
      const unit = String(m?.itemUnit ?? invById.get(itemId)?.unit ?? "");
      const dims = dimFor(itemId);
      return `<tr>
        <td style="text-align:center;font-weight:700;padding:8px 6px;border-top:1px solid #e2e8f0">${i + 1}</td>
        <td style="font-family:monospace;font-weight:800;color:#4338ca;padding:8px;border-top:1px solid #e2e8f0">${esc(sku)}</td>
        <td style="font-weight:700;padding:8px;border-top:1px solid #e2e8f0">${esc(name)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:900;padding:8px;border-top:1px solid #e2e8f0">${esc(qty)}</td>
        <td style="padding:8px;border-top:1px solid #e2e8f0">${esc(unit)}</td>
        <td style="font-family:monospace;padding:8px;border-top:1px solid #e2e8f0">${esc(dims || "—")}</td>
        <td style="text-align:center;padding:8px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px"></span></td>
      </tr>`;
    }).join("");
    deliveryHtml = `<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
      <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">SKU</th><th style="padding:7px 8px;text-align:left">Description</th><th style="padding:7px 6px;width:70px;text-align:right">Qty</th><th style="padding:7px 6px;width:56px">Unit</th><th style="padding:7px 8px;text-align:left">Dimensions</th><th style="padding:7px 6px;width:50px;text-align:center">Check</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="7" style="padding:12px;text-align:center;color:#94a3b8">No materials</td></tr>`}</tbody></table>`;
  }

  // QC checklist
  let qcHtml = "";
  if (qcTotal > 0) {
    const qcRows = packingTemplate.map((item, i) => {
      const checked = Boolean(packingChecks[i]);
      return `<tr>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0">${i + 1}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(item)}</td>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0">${checked ? "✓" : "☐"}</td>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #334155;border-radius:3px">${checked ? "✓" : ""}</span></td>
        <td style="min-width:80px;border-bottom:1px solid #94a3b8;border-top:1px solid #e2e8f0"></td>
      </tr>`;
    }).join("");
    qcHtml = `
      <div style="margin:12px 0">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#3730a3;text-transform:uppercase;margin-bottom:6px">Packing QC Checklist — ${qcDone}/${qcTotal} done</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
          <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">Check item</th><th style="padding:7px 6px;width:50px">Status</th><th style="padding:7px 6px;width:50px">Tick</th><th style="padding:7px 8px;width:90px">Inspector</th>
        </tr></thead><tbody>${qcRows}</tbody></table>
      </div>`;
  } else {
    qcHtml = `<div style="margin:12px 0;border:1px dashed #cbd5e1;border-radius:10px;padding:10px 12px;font-size:11px;color:#64748b">No packing QC template configured — checklist disabled</div>`;
  }

  // Delivery photos
  let photosHtml = "";
  const allPhotos: any[] = [...deliveryPhotos];
  for (const arr of Object.values(batchDeliveryPhotos)) {
    if (Array.isArray(arr)) allPhotos.push(...arr);
  }
  if (allPhotos.length > 0) {
    const photoRows = allPhotos.map((p: any, i: number) => {
      const file = String(p?.file ?? p?.name ?? `photo-${i + 1}`);
      const by = String(p?.by ?? "");
      const at = p?.at ? formatPackDateTime(p.at) : "—";
      const size = p?.size ? `${Math.round(Number(p.size) / 1024)} KB` : "";
      return `<tr>
        <td style="text-align:center;padding:7px 6px;border-top:1px solid #e2e8f0">${i + 1}</td>
        <td style="font-family:monospace;padding:7px 8px;border-top:1px solid #e2e8f0">${esc(file)}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(by || "—")}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(at)}</td>
        <td style="padding:7px 8px;border-top:1px solid #e2e8f0">${esc(size)}</td>
      </tr>`;
    }).join("");
    photosHtml = `
      <div style="margin:12px 0">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:#3730a3;text-transform:uppercase;margin-bottom:6px">Delivery Photos — ${allPhotos.length} proof image(s)</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#312e81;color:#a5b4fc">
          <th style="padding:7px 6px;width:28px">#</th><th style="padding:7px 8px;text-align:left">File</th><th style="padding:7px 8px;text-align:left">By</th><th style="padding:7px 8px;text-align:left">When</th><th style="padding:7px 8px;text-align:left">Size</th>
        </tr></thead><tbody>${photoRows}</tbody></table>
        <div style="font-size:10px;color:#64748b;margin-top:6px">Photos are stored in the system — this list is for dispatch verification. Open the order's Delivery Photos panel to view thumbnails.</div>
      </div>`;
  } else {
    photosHtml = `<div style="margin:12px 0;border:1px dashed #cbd5e1;border-radius:10px;padding:10px 12px;font-size:11px;color:#64748b">No delivery photos yet — add proof pictures from the Dispatch board</div>`;
  }

  // Dispatch stage / proof
  const proofHtml = dispatchProof
    ? `<div style="margin:10px 0;border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px;padding:10px 12px;font-size:11px">
        <div style="font-weight:800;color:#3730a3">Delivery proof</div>
        <div style="margin-top:4px;color:#334155">Received by: <strong>${esc(dispatchProof.receivedBy || "—")}</strong> · At: <strong>${esc(dispatchProof.deliveredAt ? formatPackDateTime(dispatchProof.deliveredAt) : "—")}</strong></div>
        ${dispatchProof.notes ? `<div style="margin-top:4px;white-space:pre-wrap">Notes: ${esc(dispatchProof.notes)}</div>` : ""}
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dispatch Pack ${esc(orderNumber)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", Arial, Helvetica, sans-serif; color:#0f172a; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @media print { .no-print { display:none !important; } .page-break { page-break-before: always; } }
  a { color: inherit; }
  .cut { border-top: 1px dashed #94a3b8; margin: 10px 0; position:relative; }
  .cut span { position:absolute; top:-7px; left:50%; transform:translateX(-50%); background:#fff; padding:0 8px; font-size:9px; letter-spacing:0.1em; color:#94a3b8; }
</style>
</head>
<body>
  <div style="max-width:800px;margin:0 auto;padding:18px 18px 24px">

    <!-- Brand band indigo -->
    <div style="background:#0f172a;border-radius:14px;overflow:hidden;border:1px solid #1e293b">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px 14px">
        <div>
          <div style="color:#818cf8;font-weight:900;letter-spacing:0.14em;font-size:18px;line-height:1">WOODTEK</div>
          <div style="color:#cbd5e1;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;margin-top:3px">Furniture Service Center</div>
          <div style="margin-top:10px;display:inline-flex;align-items:center;gap:8px;background:#6366f1;color:#fff;font-weight:900;font-size:11px;letter-spacing:0.1em;padding:5px 10px;border-radius:999px;text-transform:uppercase">Dispatch Pack</div>
        </div>
        <div style="text-align:right;min-width:180px">
          <div style="font-family:monospace;font-weight:900;font-size:22px;color:#818cf8;letter-spacing:0.02em;line-height:1">${esc(orderNumber)}</div>
          <div style="color:#e2e8f0;font-size:11px;font-weight:700;margin-top:3px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title || "—")}</div>
          <div style="margin-top:6px;display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap">
            <span style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:#312e81;color:#a5b4fc;border:1px solid #4338ca">${esc(status)}</span>
            <span style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0">Due: ${esc(formatPackDate(dueDate))}</span>
            ${dispatchStage ? `<span style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe">${esc(dispatchStage)}</span>` : ""}
          </div>
        </div>
      </div>
      <div style="height:4px;background:#6366f1"></div>
      <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 18px;background:#1e293b;color:#cbd5e1;font-size:10px">
        <span>Issued: ${esc(formatPackDate(createdAt))} · Delivery: ${esc(formatPackDate(dueDate))} · Batches: ${totalBatches} · Qty: ${totalQty} · Passes: ${totalOps}</span>
        <span>Printed: ${esc(genStamp)}</span>
      </div>
    </div>

    <!-- Bill to / Deliver to / QR -->
    <div style="display:grid;grid-template-columns:1fr 1fr 0.7fr;gap:12px;margin-top:14px">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Bill to</div>
        <div style="font-size:13px;font-weight:900;color:#0f172a;margin-top:4px">${esc(customerCompany)}</div>
        ${customerName ? `<div style="font-size:11px;color:#334155;margin-top:2px">Attn: ${esc(customerName)}</div>` : ""}
        ${customerPhone ? `<div style="font-size:11px;color:#334155">Tel: ${esc(customerPhone)}</div>` : ""}
        ${customerEmail ? `<div style="font-size:11px;color:#334155">Email: ${esc(customerEmail)}</div>` : ""}
      </div>
      <div style="border:1px solid #c7d2fe;border-radius:12px;padding:12px 14px;background:#eef2ff">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#4338ca;text-transform:uppercase">Deliver to</div>
        <div style="font-size:13px;font-weight:900;color:#0f172a;margin-top:4px">${esc(customerCompany)}</div>
        ${customerAddress ? `<div style="font-size:11px;color:#334155;margin-top:4px;white-space:pre-wrap;line-height:1.4">${esc(customerAddress)}</div>` : `<div style="font-size:11px;color:#94a3b8;margin-top:4px">No delivery address on file</div>`}
        <div style="margin-top:8px;font-size:10px;color:#475569">Type: <strong>${esc(projectType)}</strong> · Priority: <strong>${esc(priority)}</strong></div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc;display:flex;gap:12px;align-items:center;flex-direction:column;justify-content:center;text-align:center">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Scan to open</div>
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="Order QR" style="width:96px;height:96px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;padding:6px">` : `<div style="width:96px;height:96px;border-radius:10px;border:1px dashed #cbd5e1;background:#fff;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;text-align:center;padding:8px">QR<br>available<br>on screen</div>`}
        <div style="font-size:10px;color:#64748b;font-family:monospace;word-break:break-all">${esc(orderNumber)}</div>
      </div>
    </div>

    <!-- Summary chips -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <span style="background:#312e81;color:#a5b4fc;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${totalBatches} batch${totalBatches===1?"":"es"}</span>
      <span style="background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${totalOps} pass${totalOps===1?"":"es"} · ${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m</span>
      <span style="background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${totalQty} total qty</span>
      <span style="background:${qcDone===qcTotal && qcTotal>0 ? "#dcfce7" : "#fef3c7"};color:${qcDone===qcTotal && qcTotal>0 ? "#166534" : "#92400e"};font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">QC ${qcDone}/${qcTotal || 0}</span>
      <span style="background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">${photosCount} photo${photosCount===1?"":"s"}</span>
      ${progress ? `<span style="background:${progress===100?"#dcfce7":"#fef3c7"};color:${progress===100?"#166534":"#92400e"};font-weight:800;font-size:11px;padding:6px 10px;border-radius:999px">Progress ${esc(String(progress))}%</span>` : ""}
    </div>

    <!-- TOC -->
    <div style="margin-top:14px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff">
      <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#3730a3;text-transform:uppercase">Dispatch pack contents</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:#334155">
        <span style="background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 8px;border-radius:999px">1. Job Ticket — cut lists & station routing</span>
        <span style="background:#eef2ff;border:1px solid #c7d2fe;padding:4px 8px;border-radius:999px">2. Delivery Note — qty-only client list</span>
        <span style="background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 8px;border-radius:999px">3. Packing QC — checklist</span>
        <span style="background:#eef2ff;border:1px solid #c7d2fe;padding:4px 8px;border-radius:999px">4. Delivery Photos — proof list</span>
        <span style="background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 8px;border-radius:999px">5. Dispatch & signatures</span>
      </div>
    </div>

    ${notes ? `<div style="margin-top:14px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:12px;padding:12px 14px">
      <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#4338ca;text-transform:uppercase">Order notes</div>
      <div style="font-size:11px;color:#334155;margin-top:6px;white-space:pre-wrap;line-height:1.5">${esc(notes)}</div>
    </div>` : ""}

    ${proofHtml}

    <!-- SECTION 1: Job Ticket -->
    <div class="page-break" style="margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="background:#f59e0b;color:#0f172a;font-weight:900;font-size:11px;letter-spacing:0.08em;padding:6px 10px;border-radius:999px">SECTION 1</div>
        <div style="font-size:14px;font-weight:900;color:#0f172a">Job Ticket — cut lists & station routing (internal)</div>
      </div>
      ${jobBatchesHtml}
    </div>

    <!-- SECTION 2: Delivery Note -->
    <div class="page-break" style="margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="background:#2dd4bf;color:#0f172a;font-weight:900;font-size:11px;letter-spacing:0.08em;padding:6px 10px;border-radius:999px">SECTION 2</div>
        <div style="font-size:14px;font-weight:900;color:#0f172a">Delivery Note — qty-only client list</div>
      </div>
      ${deliveryHtml}
      <div style="margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#334155;text-transform:uppercase">Delivery instructions</div>
        <ul style="margin:6px 0 0 16px;padding:0;font-size:11px;color:#334155;line-height:1.6">
          <li>Please check <strong>quantities</strong> against this note upon arrival. Report any discrepancy immediately.</li>
          <li>Goods remain property of <strong>WoodTek</strong> until fully paid. Handle with care — keep dry and protected.</li>
          <li>Sign below to confirm receipt. Keep one copy for your records.</li>
        </ul>
      </div>
    </div>

    <!-- SECTION 3: QC -->
    <div class="page-break" style="margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="background:#6366f1;color:#fff;font-weight:900;font-size:11px;letter-spacing:0.08em;padding:6px 10px;border-radius:999px">SECTION 3</div>
        <div style="font-size:14px;font-weight:900;color:#0f172a">Packing QC Checklist</div>
      </div>
      ${qcHtml}
    </div>

    <!-- SECTION 4: Photos -->
    <div class="page-break" style="margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="background:#6366f1;color:#fff;font-weight:900;font-size:11px;letter-spacing:0.08em;padding:6px 10px;border-radius:999px">SECTION 4</div>
        <div style="font-size:14px;font-weight:900;color:#0f172a">Delivery Photos — proof images</div>
      </div>
      ${photosHtml}
    </div>

    <!-- SECTION 5: Dispatch & signatures -->
    <div class="page-break" style="margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="background:#0f172a;color:#818cf8;font-weight:900;font-size:11px;letter-spacing:0.08em;padding:6px 10px;border-radius:999px">SECTION 5</div>
        <div style="font-size:14px;font-weight:900;color:#0f172a">Dispatch & Sign-off</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff">
        <div style="font-size:11px;color:#334155;line-height:1.6">
          <div>Dispatch stage: <strong>${esc(dispatchStage || "—")}</strong></div>
          <div style="margin-top:4px">This pack travels with the goods from the shop floor to the client. It contains the internal job ticket, the client delivery note, the packing QC checklist and the delivery photo proof list.</div>
        </div>
      </div>

      <!-- 6 signatures -->
      <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Prepared by (WoodTek)</div>
          <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
          <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">QC checked by</div>
          <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
          <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time</div>
        </div>
      </div>
      <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Packed by</div>
          <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
          <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Date & time</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">Delivered by (Driver)</div>
          <div style="margin-top:18px;border-bottom:1.5px solid #0f172a;height:18px"></div>
          <div style="font-size:9px;color:#64748b;margin-top:4px">Name / signature · Vehicle · Date & time</div>
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
    </div>

    <div style="margin-top:18px;text-align:center;font-size:9px;color:#94a3b8">
      WoodTek ERP — Furniture Service Center · Dispatch Pack travels with the goods · Generated ${esc(genStamp)} · ${esc(orderNumber)} · QC ${qcDone}/${qcTotal || 0} · Photos ${photosCount}
    </div>

    <div class="cut no-print" style="margin-top:16px"><span>✂ cut here — client copy / WoodTek copy</span></div>

    <div class="no-print" style="margin-top:16px;display:flex;justify-content:center;gap:8px">
      <button onclick="window.print()" style="background:#312e81;color:#a5b4fc;border:1px solid #4338ca;font-weight:800;font-size:12px;padding:10px 18px;border-radius:10px;cursor:pointer">🖨 Print dispatch pack</button>
      <button onclick="window.close()" style="background:#fff;border:1px solid #e2e8f0;color:#334155;font-weight:700;font-size:12px;padding:10px 18px;border-radius:10px;cursor:pointer">Close</button>
    </div>
  </div>
</body>
</html>`;
}
