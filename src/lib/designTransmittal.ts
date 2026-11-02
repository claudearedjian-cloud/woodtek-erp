// Printable Design Department transmittals and package manifests. This module
// is pure so the same content can be rendered in the browser, included in a
// ZIP package and covered by render-test.
import {
  DESIGN_SUBMISSION_CHECKLIST,
  designApprovalCodeDef,
  designDrawingStage,
  designRecordNumber,
  designSubmissionChecklistProgress,
  readDesignSubmissionChecklist,
} from "@/lib/designDepartment";

export interface DesignTransmittalDrawing {
  id?: number | string | null;
  recordNumber?: string | null;
  drawingNo?: string | null;
  revision?: string | null;
  title?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  architectName?: string | null;
  orderSnapshot?: string | null;
  discipline?: string | null;
  area?: string | null;
  sheetCount?: number | string | null;
  status?: string | null;
  priority?: string | null;
  requiredDate?: string | null;
  externalLink?: string | null;
  notes?: string | null;
  submittedTo?: string | null;
  submittedByName?: string | null;
  submittedDate?: string | null;
  transmittalNo?: string | null;
  responseDueDate?: string | null;
  approvalCode?: string | null;
  approvalLabel?: string | null;
  approvalBy?: string | null;
  approvalDate?: string | null;
  approvalComments?: string | null;
  commentsIncorporated?: boolean | null;
  commentsIncorporatedByName?: string | null;
  commentsIncorporatedAt?: string | Date | null;
  submissionChecklist?: unknown;
  submissionChecklistJson?: unknown;
  submissionChecklistByName?: string | null;
  submissionChecklistAt?: string | Date | null;
  issuedTo?: string | null;
  issuedByName?: string | null;
  issuedAt?: string | Date | null;
  issueNote?: string | null;
  createdByName?: string | null;
}

export interface DesignTransmittalFile {
  id?: number | string | null;
  kind?: string | null;
  fileName?: string | null;
  originalName?: string | null;
  size?: number | string | null;
  createdAt?: string | Date | null;
  uploadedByName?: string | null;
}

function value(input: unknown): string {
  if (input instanceof Date) return input.toISOString();
  return String(input ?? "").trim();
}

function shown(input: unknown): string {
  return value(input) || "—";
}

function dateShown(input: unknown): string {
  const raw = value(input);
  if (!raw) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(raw.includes("T") ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "UTC",
  });
}

function bytesShown(input: unknown): string {
  const bytes = Number(input) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function esc(input: unknown): string {
  return value(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csv(input: unknown): string {
  return `"${value(input).replace(/"/g, '""')}"`;
}

export function designTransmittalReference(drawing: DesignTransmittalDrawing): string {
  const explicit = value(drawing.transmittalNo);
  if (explicit) return explicit;
  const id = Number(drawing.id);
  const record = value(drawing.recordNumber)
    || (Number.isSafeInteger(id) && id > 0 ? designRecordNumber(id) : "DES");
  return `WT-${record}${drawing.revision ? `-REV-${value(drawing.revision)}` : ""}`;
}

export function designTransmittalFilename(
  drawing: DesignTransmittalDrawing,
  extension: string,
): string {
  const stem = [
    value(drawing.drawingNo) || "drawing",
    value(drawing.revision) ? `Rev-${value(drawing.revision)}` : "",
    "transmittal",
  ].filter(Boolean).join("-");
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "drawing-transmittal";
  const ext = extension.replace(/^\./, "").replace(/[^A-Za-z0-9]/g, "") || "html";
  return `${safe}.${ext}`;
}

function productionBanner(drawing: DesignTransmittalDrawing): { title: string; detail: string; tone: string } {
  const status = value(drawing.status);
  const def = designApprovalCodeDef(drawing.approvalCode);
  if (status === "Issued to Production") {
    return {
      title: "ISSUED TO PRODUCTION",
      detail: `Production issue to ${shown(drawing.issuedTo)}${drawing.issuedAt ? ` on ${dateShown(drawing.issuedAt)}` : ""}. Use this revision only until a later issued revision supersedes it.`,
      tone: "#047857",
    };
  }
  if (def?.code === "B" && !drawing.commentsIncorporated) {
    return {
      title: "CODE B — COMMENTS MUST BE INCORPORATED BEFORE PRODUCTION",
      detail: "Approved as noted only. Do not issue this revision to the factory until every returned comment is incorporated and confirmed.",
      tone: "#0369a1",
    };
  }
  if (def && !def.canIssue) {
    return {
      title: `${def.label.toUpperCase()} — NOT FOR PRODUCTION`,
      detail: def.productionRule,
      tone: def.code === "D" ? "#be123c" : "#b45309",
    };
  }
  if (status === "Submitted") {
    return {
      title: "SUBMITTED FOR APPROVAL — NOT A PRODUCTION RELEASE",
      detail: "Production remains blocked until an A, or comment-cleared B, revision is issued through Design Department.",
      tone: "#0369a1",
    };
  }
  return {
    title: designDrawingStage(drawing).toUpperCase(),
    detail: "This transmittal records the drawing package and approval state held in WoodTek ERP.",
    tone: "#475569",
  };
}

export function designTransmittalText(
  drawing: DesignTransmittalDrawing,
  files: readonly DesignTransmittalFile[] = [],
  generatedAt = new Date(),
): string {
  const checklist = readDesignSubmissionChecklist(
    drawing.submissionChecklist ?? drawing.submissionChecklistJson,
  );
  const progress = designSubmissionChecklistProgress(checklist);
  const banner = productionBanner(drawing);
  const lines = [
    "WOODTEK — DESIGN DEPARTMENT TRANSMITTAL",
    "==========================================",
    `Transmittal reference: ${designTransmittalReference(drawing)}`,
    `Generated: ${generatedAt.toISOString()}`,
    "",
    banner.title,
    banner.detail,
    "",
    "DRAWING",
    "-------",
    `Record: ${shown(drawing.recordNumber)}`,
    `Drawing: ${shown(drawing.drawingNo)}  Revision: ${shown(drawing.revision)}`,
    `Title: ${shown(drawing.title)}`,
    `Status/stage: ${shown(drawing.status)} / ${designDrawingStage(drawing)}`,
    `Project: ${shown(drawing.projectName)}`,
    `Client: ${shown(drawing.clientName)}`,
    `Architect / consultant: ${shown(drawing.architectName)}`,
    `Linked production order: ${shown(drawing.orderSnapshot)}`,
    `Discipline / area: ${shown(drawing.discipline)} / ${shown(drawing.area)}`,
    `Sheets: ${shown(drawing.sheetCount)}  Priority: ${shown(drawing.priority)}  Required: ${dateShown(drawing.requiredDate)}`,
    `External drawing location: ${shown(drawing.externalLink)}`,
    "",
    "SUBMITTAL AND APPROVAL",
    "----------------------",
    `Submitted to: ${shown(drawing.submittedTo)}`,
    `Submitted by: ${shown(drawing.submittedByName)} on ${dateShown(drawing.submittedDate)}`,
    `Response due: ${dateShown(drawing.responseDueDate)}`,
    `Approval return: ${shown(drawing.approvalLabel || (drawing.approvalCode ? `Code ${drawing.approvalCode}` : ""))}`,
    `Returned by: ${shown(drawing.approvalBy)} on ${dateShown(drawing.approvalDate)}`,
    `Approval comments: ${shown(drawing.approvalComments)}`,
    `Code B comments incorporated: ${drawing.approvalCode === "B" ? (drawing.commentsIncorporated ? "Yes" : "No") : "Not applicable"}`,
    "",
    `SUBMISSION CHECKLIST (${progress.checked}/${progress.total}${progress.complete ? " — COMPLETE" : ""})`,
    "------------------------------------------------",
    ...DESIGN_SUBMISSION_CHECKLIST.map((item) => `[${checklist[item.id] ? "x" : " "}] ${item.label}`),
    `Checklist recorded by: ${shown(drawing.submissionChecklistByName)} on ${dateShown(drawing.submissionChecklistAt)}`,
    "",
    `FILES (${files.length})`,
    "----------------",
    ...(files.length
      ? files.map((file, index) => `${index + 1}. ${shown(file.originalName || file.fileName)} — ${shown(file.kind)} — ${bytesShown(file.size)} — uploaded ${dateShown(file.createdAt)}${file.uploadedByName ? ` by ${value(file.uploadedByName)}` : ""}`)
      : ["No uploaded files are recorded for this revision."]),
    "",
    "PRODUCTION ISSUE",
    "----------------",
    `Issued to: ${shown(drawing.issuedTo)}`,
    `Issued by: ${shown(drawing.issuedByName)} on ${dateShown(drawing.issuedAt)}`,
    `Issue note: ${shown(drawing.issueNote)}`,
    "",
    "Prepared by: ______________________________    Date: __________________",
    "Received by: _______________________________    Date: __________________",
  ];
  if (drawing.notes) lines.splice(lines.indexOf("SUBMITTAL AND APPROVAL"), 0, `Notes: ${value(drawing.notes)}`, "");
  return `${lines.join("\n")}\n`;
}

export function designPackageManifestCsv(
  drawing: DesignTransmittalDrawing,
  files: readonly DesignTransmittalFile[] = [],
): string {
  const headers = ["Transmittal", "Record", "Drawing No", "Revision", "Title", "Status", "Approval Code", "File Kind", "File Name", "Stored Name", "Bytes", "Uploaded", "Uploaded By"];
  const rows = files.length ? files : [{} as DesignTransmittalFile];
  return [
    headers.map(csv).join(","),
    ...rows.map((file) => [
      designTransmittalReference(drawing),
      drawing.recordNumber,
      drawing.drawingNo,
      drawing.revision,
      drawing.title,
      drawing.status,
      drawing.approvalCode,
      file.kind,
      file.originalName || file.fileName,
      file.fileName,
      file.size ?? "",
      file.createdAt ? value(file.createdAt) : "",
      file.uploadedByName,
    ].map(csv).join(",")),
  ].join("\r\n") + "\r\n";
}

function detailRows(rows: Array<[string, unknown]>): string {
  return rows.map(([label, raw]) => `
    <div class="field"><div class="label">${esc(label)}</div><div class="value">${esc(shown(raw))}</div></div>`).join("");
}

export function buildDesignTransmittalHtml(
  drawing: DesignTransmittalDrawing,
  files: readonly DesignTransmittalFile[] = [],
  generatedAt = new Date(),
): string {
  const checklist = readDesignSubmissionChecklist(
    drawing.submissionChecklist ?? drawing.submissionChecklistJson,
  );
  const progress = designSubmissionChecklistProgress(checklist);
  const banner = productionBanner(drawing);
  const approval = drawing.approvalLabel || (drawing.approvalCode ? `Code ${drawing.approvalCode}` : "Not returned");
  const fileRows = files.length ? files.map((file, index) => `
    <tr><td>${index + 1}</td><td><strong>${esc(shown(file.originalName || file.fileName))}</strong><br><span class="muted">${esc(shown(file.fileName))}</span></td><td>${esc(shown(file.kind))}</td><td>${esc(bytesShown(file.size))}</td><td>${esc(dateShown(file.createdAt))}${file.uploadedByName ? `<br><span class="muted">${esc(file.uploadedByName)}</span>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No uploaded files are recorded for this revision.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(designTransmittalFilename(drawing, "html"))}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#e2e8f0;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
  .sheet{max-width:980px;margin:24px auto;background:#fff;padding:34px;box-shadow:0 18px 50px rgba(15,23,42,.2)}
  header{display:flex;justify-content:space-between;gap:20px;border-bottom:4px solid #0f766e;padding-bottom:18px}
  .brand{font-size:30px;font-weight:900;letter-spacing:.08em;color:#0f766e}.sub{color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:700}
  h1{font-size:22px;margin:6px 0 0} h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#0f766e;border-bottom:1px solid #cbd5e1;padding-bottom:7px;margin:26px 0 13px}
  .ref{text-align:right;font-size:12px;color:#475569}.ref strong{display:block;color:#0f172a;font-size:16px;margin-top:3px}
  .banner{border:2px solid ${banner.tone};background:#f8fafc;padding:14px 16px;margin-top:20px;border-radius:10px}.banner strong{color:${banner.tone};font-size:15px}.banner p{margin:5px 0 0;font-size:13px;line-height:1.5}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.field{background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:10px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;font-weight:800}.value{font-size:13px;font-weight:700;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}
  table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0f172a;color:#fff;text-align:left;padding:9px}td{border-bottom:1px solid #e2e8f0;padding:8px;vertical-align:top}.muted,.empty{color:#64748b}.empty{text-align:center;padding:18px}
  .checklist{display:grid;grid-template-columns:1fr 1fr;gap:8px}.check{border:1px solid #e2e8f0;border-radius:8px;padding:9px;font-size:12px}.tick{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:#dcfce7;color:#166534;font-weight:900;margin-right:6px}.miss{background:#fee2e2;color:#991b1b}
  .note{white-space:pre-wrap;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:12px;font-size:13px;line-height:1.55}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:34px;font-size:12px}.line{border-top:1px solid #334155;padding-top:7px;margin-top:42px}
  .actions{max-width:980px;margin:18px auto 0;text-align:right}.actions button{background:#0f766e;color:white;border:0;border-radius:9px;padding:11px 18px;font-weight:800;cursor:pointer}
  footer{margin-top:28px;border-top:1px solid #cbd5e1;padding-top:10px;color:#64748b;font-size:11px;display:flex;justify-content:space-between;gap:12px}
  @media(max-width:720px){.sheet{padding:20px}.grid,.checklist,.sign{grid-template-columns:1fr}header{display:block}.ref{text-align:left;margin-top:12px}}
  @media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none}.actions{display:none}@page{margin:14mm}}
</style>
</head>
<body>
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="sheet">
  <header>
    <div><div class="brand">WOODTEK</div><div class="sub">Factory Automation · Design Department</div><h1>Drawing Transmittal</h1></div>
    <div class="ref">Transmittal reference<strong>${esc(designTransmittalReference(drawing))}</strong>Generated ${esc(dateShown(generatedAt))}<br>Record ${esc(shown(drawing.recordNumber))}</div>
  </header>
  <section class="banner"><strong>${esc(banner.title)}</strong><p>${esc(banner.detail)}</p></section>

  <h2>Drawing revision</h2>
  <div class="grid">${detailRows([
    ["Drawing number", drawing.drawingNo],
    ["Revision", drawing.revision],
    ["Status / stage", `${shown(drawing.status)} / ${designDrawingStage(drawing)}`],
    ["Title", drawing.title],
    ["Project", drawing.projectName],
    ["Client", drawing.clientName],
    ["Architect / consultant", drawing.architectName],
    ["Linked production order", drawing.orderSnapshot || "None"],
    ["Discipline / area", `${shown(drawing.discipline)} / ${shown(drawing.area)}`],
    ["Sheets", drawing.sheetCount],
    ["Priority", drawing.priority],
    ["Required date", dateShown(drawing.requiredDate)],
  ])}</div>
  ${drawing.externalLink ? `<p style="font-size:12px;overflow-wrap:anywhere"><strong>External drawing location:</strong> ${esc(drawing.externalLink)}</p>` : ""}
  ${drawing.notes ? `<div class="note"><strong>Notes</strong>\n${esc(drawing.notes)}</div>` : ""}

  <h2>Submittal and approval</h2>
  <div class="grid">${detailRows([
    ["Submitted to", drawing.submittedTo],
    ["Submitted by", drawing.submittedByName],
    ["Submitted date", dateShown(drawing.submittedDate)],
    ["Response due", dateShown(drawing.responseDueDate)],
    ["Approval return", approval],
    ["Returned by / date", `${shown(drawing.approvalBy)} / ${dateShown(drawing.approvalDate)}`],
    ["Code B comments", drawing.approvalCode === "B" ? (drawing.commentsIncorporated ? `Incorporated by ${shown(drawing.commentsIncorporatedByName)} on ${dateShown(drawing.commentsIncorporatedAt)}` : "Not incorporated yet") : "Not applicable"],
    ["Issued to production", drawing.issuedTo],
    ["Issued by / date", `${shown(drawing.issuedByName)} / ${dateShown(drawing.issuedAt)}`],
  ])}</div>
  ${drawing.approvalComments ? `<div class="note"><strong>Approval comments</strong>\n${esc(drawing.approvalComments)}</div>` : ""}
  ${drawing.issueNote ? `<div class="note"><strong>Production issue note</strong>\n${esc(drawing.issueNote)}</div>` : ""}

  <h2>Submission checklist — ${progress.checked}/${progress.total}${progress.complete ? " complete" : " incomplete"}</h2>
  <div class="checklist">${DESIGN_SUBMISSION_CHECKLIST.map((item) => `<div class="check"><span class="tick${checklist[item.id] ? "" : " miss"}">${checklist[item.id] ? "✓" : "!"}</span>${esc(item.label)}</div>`).join("")}</div>
  <p style="font-size:12px;color:#475569">Recorded by ${esc(shown(drawing.submissionChecklistByName))} on ${esc(dateShown(drawing.submissionChecklistAt))}.</p>

  <h2>Files in this revision (${files.length})</h2>
  <table><thead><tr><th>#</th><th>File</th><th>Kind</th><th>Size</th><th>Uploaded</th></tr></thead><tbody>${fileRows}</tbody></table>

  <div class="sign">
    <div><div class="line">Prepared / issued by — name, signature and date</div></div>
    <div><div class="line">Received by — name, signature and date</div></div>
  </div>
  <footer><span>WoodTek ERP · Design Department controlled drawing record</span><span>${esc(designTransmittalReference(drawing))}</span></footer>
</main>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script>
</body>
</html>`;
}
