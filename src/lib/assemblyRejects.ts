// ============================================================================
// Rejected parts at the cabinet assembly check. Pure helpers (no server or
// browser APIs) so they run in both the UI and the render tests.
//
// A checker rejects a part that shows a defect or has the wrong dimensions.
// A rejected part is never counted as available. The rejected list collects
// every rejected part of a project so it can be fixed or remade and tracked.
// ============================================================================

import type { PolyboardProject, PolyboardRejectReason } from "./polyboard";

export const REJECT_REASONS: { value: PolyboardRejectReason; label: string }[] = [
  { value: "defect", label: "Defect" },
  { value: "wrong_dimensions", label: "Wrong dimensions" },
  { value: "other", label: "Other" },
];

export function rejectReasonLabel(reason: string | undefined): string {
  return REJECT_REASONS.find((r) => r.value === reason)?.label ?? "Other";
}

export interface RejectedPartRow {
  projectName: string;
  cabinetId: string;
  cabinetName: string;
  partId: string;
  partName: string;
  material: string;
  length: number;
  width: number;
  thickness: number;
  quantity: number;
  barcode: string;
  reason: PolyboardRejectReason;
  reasonLabel: string;
  note: string;
  rejectedAt: string;
  rejectedBy: string;
}

/** Every rejected part in the project, in cabinet order then rejection time. */
export function collectRejectedParts(project: PolyboardProject | null | undefined): RejectedPartRow[] {
  if (!project) return [];
  const rows: RejectedPartRow[] = [];
  for (const cabinet of project.cabinets ?? []) {
    for (const part of cabinet.parts ?? []) {
      if (!part.rejection) continue;
      rows.push({
        projectName: project.name,
        cabinetId: cabinet.id,
        cabinetName: cabinet.name,
        partId: part.id,
        partName: part.name,
        material: part.material,
        length: part.length,
        width: part.width,
        thickness: part.thickness,
        quantity: part.quantity,
        barcode: part.barcode,
        reason: part.rejection.reason,
        reasonLabel: rejectReasonLabel(part.rejection.reason),
        note: part.rejection.note ?? "",
        rejectedAt: part.rejection.rejectedAt,
        rejectedBy: part.rejection.rejectedBy ?? "",
      });
    }
  }
  rows.sort((a, b) => {
    const byCabinet = a.cabinetName.localeCompare(b.cabinetName);
    if (byCabinet !== 0) return byCabinet;
    return a.rejectedAt.localeCompare(b.rejectedAt);
  });
  return rows;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Printable list for the fixing / remaking team. Pure HTML; every user-entered
 * value is escaped. The "Fixed / remade" column is blank so it can be ticked on
 * paper and cleared in the app afterwards.
 */
export function buildRejectedPartsHtml(rows: RejectedPartRow[], printedAt: Date, projectName: string): string {
  const esc = escapeHtml;
  const body = rows.length
    ? rows
        .map(
          (row, index) => `<tr>
  <td>${index + 1}</td>
  <td>${esc(row.cabinetName)}</td>
  <td>${esc(row.partName)}<div class="bc">${esc(row.barcode)}</div></td>
  <td>${row.length} × ${row.width} × ${row.thickness} mm</td>
  <td>${esc(row.material)}</td>
  <td>${row.quantity}</td>
  <td><b>${esc(row.reasonLabel)}</b></td>
  <td>${esc(row.note)}</td>
  <td>${esc(row.rejectedBy)}<div class="bc">${esc(new Date(row.rejectedAt).toLocaleString())}</div></td>
  <td class="tick"></td>
</tr>`,
        )
        .join("\n")
    : `<tr><td colspan="10" class="empty">No rejected parts.</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Rejected parts - ${esc(projectName)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #475569; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #94a3b8; padding: 5px 6px; vertical-align: top; text-align: left; }
  th { background: #e2e8f0; }
  .bc { font-family: monospace; font-size: 10px; color: #475569; margin-top: 2px; }
  .tick { width: 70px; }
  .empty { text-align: center; padding: 18px; color: #475569; }
  .sign { margin-top: 28px; font-size: 12px; }
  @media print { body { margin: 10mm; } }
</style></head>
<body>
  <h1>Rejected parts - ${esc(projectName)}</h1>
  <div class="meta">Printed ${esc(printedAt.toLocaleString())} &middot; ${rows.length} rejected part(s) for fixing or remaking</div>
  <table>
    <thead><tr>
      <th>#</th><th>Cabinet</th><th>Part</th><th>Size</th><th>Material</th><th>Qty</th>
      <th>Reason</th><th>Note</th><th>Rejected by</th><th>Fixed / remade</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="sign">Checked by: ____________________ &nbsp;&nbsp; Date: ____________</div>
</body></html>`;
}
