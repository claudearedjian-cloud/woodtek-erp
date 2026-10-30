// Design Department rules shared by the API, UI and render-test. No server
// imports. Each database record is one drawing revision moving through:
// Draft -> Submitted -> Returned with Code A/B/C/D -> Issued to Production.
// Code C/D revisions are never production releases; a Code B revision may be
// released only after its approval comments have been incorporated.

export class DesignDepartmentError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "DesignDepartmentError";
  }
}

export const DESIGN_APPROVAL_CODES = ["A", "B", "C", "D"] as const;
export type DesignApprovalCode = (typeof DESIGN_APPROVAL_CODES)[number];
export type DesignApprovalTone = "emerald" | "sky" | "amber" | "rose";

export interface DesignApprovalCodeDef {
  code: DesignApprovalCode;
  label: string;
  shortLabel: string;
  description: string;
  productionRule: string;
  canIssue: boolean;
  requiresCommentsIncorporated: boolean;
  tone: DesignApprovalTone;
}

export const DESIGN_APPROVAL_CODE_DEFS: readonly DesignApprovalCodeDef[] = [
  {
    code: "A",
    label: "Code A — Approved",
    shortLabel: "Approved",
    description: "Approved without comments.",
    productionRule: "May be issued to production.",
    canIssue: true,
    requiresCommentsIncorporated: false,
    tone: "emerald",
  },
  {
    code: "B",
    label: "Code B — Approved as noted",
    shortLabel: "Approved as noted",
    description: "Approved subject to the returned comments being incorporated.",
    productionRule: "May be issued only after the comments are incorporated.",
    canIssue: true,
    requiresCommentsIncorporated: true,
    tone: "sky",
  },
  {
    code: "C",
    label: "Code C — Revise & resubmit",
    shortLabel: "Revise & resubmit",
    description: "Revise the drawing and submit a new revision for approval.",
    productionRule: "Not for production.",
    canIssue: false,
    requiresCommentsIncorporated: false,
    tone: "amber",
  },
  {
    code: "D",
    label: "Code D — Rejected",
    shortLabel: "Rejected",
    description: "Rejected; do not proceed with this revision.",
    productionRule: "Not for production.",
    canIssue: false,
    requiresCommentsIncorporated: false,
    tone: "rose",
  },
] as const;

export function designApprovalCodeDef(
  code: string | null | undefined,
): DesignApprovalCodeDef | null {
  const wanted = String(code ?? "").trim().toUpperCase();
  return DESIGN_APPROVAL_CODE_DEFS.find((def) => def.code === wanted) ?? null;
}

export const DESIGN_DRAWING_STATUSES = [
  "Draft",
  "Submitted",
  "Returned",
  "Issued to Production",
  "On Hold",
  "Superseded",
  "Cancelled",
] as const;
export type DesignDrawingStatus = (typeof DESIGN_DRAWING_STATUSES)[number];

export const DESIGN_PRIORITIES = ["Normal", "High", "Urgent"] as const;
export type DesignPriority = (typeof DESIGN_PRIORITIES)[number];

export const DESIGN_DISCIPLINES = [
  "General Joinery",
  "Kitchen",
  "Wardrobes & Cabinets",
  "Doors",
  "Wall Cladding",
  "Furniture",
  "Metalwork",
  "Glass",
  "Stone",
  "Other",
] as const;
export type DesignDiscipline = (typeof DESIGN_DISCIPLINES)[number];

export const DESIGN_FILE_KINDS = [
  "Drawing PDF/CAD",
  "Submitted package",
  "Approval comments",
  "Production issue",
  "Reference",
  "Other",
] as const;
export type DesignFileKind = (typeof DESIGN_FILE_KINDS)[number];

export interface DesignDrawingInput {
  drawingNo: string;
  revision: string;
  title: string;
  projectName: string;
  clientName: string;
  architectName: string;
  orderId: number | null;
  discipline: DesignDiscipline;
  area: string;
  sheetCount: number;
  priority: DesignPriority;
  requiredDate: string | null;
  externalLink: string;
  notes: string;
}

export interface DesignSubmitInput {
  submittedTo: string;
  submittedDate: string;
  transmittalNo: string;
  responseDueDate: string | null;
  note: string;
}

export interface DesignApprovalInput {
  approvalCode: DesignApprovalCode;
  approvalBy: string;
  approvalDate: string;
  approvalComments: string;
  commentsIncorporated: boolean;
}

export interface DesignIssueInput {
  issuedTo: string;
  note: string;
  confirmCommentsIncorporated: boolean;
}

export interface DesignResubmissionInput {
  revision: string;
  note: string;
}

export interface DesignStatusChangeInput {
  status: "Draft" | "On Hold" | "Cancelled";
  note: string;
}

export interface DesignCommentsInput {
  incorporated: boolean;
  note: string;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesignDepartmentError("Enter the required drawing details and try again.");
  }
  return input as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  max: number,
  required = false,
  singleLine = false,
): string {
  let result = typeof value === "string" ? value.trim() : "";
  if (singleLine) result = result.replace(/\s+/g, " ");
  if (required && !result) throw new DesignDepartmentError(`${label} is required.`);
  if (result.length > max) {
    throw new DesignDepartmentError(`${label} must be ${max} characters or fewer.`);
  }
  return result;
}

export function isValidDesignDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (!isValidDesignDate(value)) {
    throw new DesignDepartmentError(`${label} must be a real date in YYYY-MM-DD format.`);
  }
  return value;
}

function requiredDate(value: unknown, label: string): string {
  const parsed = optionalDate(value, label);
  if (!parsed) throw new DesignDepartmentError(`${label} is required.`);
  return parsed;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value.trim()))) {
    return null;
  }
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

export function positiveDesignId(value: unknown, label = "Id"): number {
  const result = wholeNumber(value);
  if (result === null || result <= 0) {
    throw new DesignDepartmentError(`${label} must be a positive integer.`);
  }
  return result;
}

function optionalPositiveId(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  return positiveDesignId(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new DesignDepartmentError(`${label} must be true or false.`);
  return value;
}

export function cleanDesignExternalLink(value: unknown): string {
  const raw = text(value, "External link/path", 1000, false, true);
  if (!raw) return "";
  if (/[\u0000-\u001f\u007f<>"]/u.test(raw)) {
    throw new DesignDepartmentError("External link/path contains unsupported characters.");
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!url.hostname) throw new Error("missing host");
      return url.toString();
    } catch {
      throw new DesignDepartmentError("Enter a valid http(s) link or a Windows/network file path.");
    }
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) {
    throw new DesignDepartmentError("Use an http(s) link or a Windows/network file path.");
  }
  return raw;
}

export function isWebDesignLink(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value ?? ""));
}

export function parseDesignDrawing(input: unknown): DesignDrawingInput {
  const raw = record(input);
  const disciplineRaw = raw.discipline == null || raw.discipline === ""
    ? "General Joinery"
    : text(raw.discipline, "Discipline", 60, true, true);
  if (!(DESIGN_DISCIPLINES as readonly string[]).includes(disciplineRaw)) {
    throw new DesignDepartmentError("Choose a valid drawing discipline.");
  }
  const priorityRaw = raw.priority == null || raw.priority === ""
    ? "Normal"
    : text(raw.priority, "Priority", 30, true, true);
  if (!(DESIGN_PRIORITIES as readonly string[]).includes(priorityRaw)) {
    throw new DesignDepartmentError("Priority must be Normal, High or Urgent.");
  }
  const sheetCount = raw.sheetCount == null || raw.sheetCount === ""
    ? 1
    : wholeNumber(raw.sheetCount);
  if (sheetCount === null || sheetCount < 1 || sheetCount > 1000) {
    throw new DesignDepartmentError("Sheet count must be a whole number from 1 to 1,000.");
  }
  return {
    drawingNo: text(raw.drawingNo, "Drawing number", 60, true, true),
    revision: text(raw.revision, "Revision", 24, true, true),
    title: text(raw.title, "Drawing title", 180, true, true),
    projectName: text(raw.projectName, "Project", 180, false, true),
    clientName: text(raw.clientName, "Client", 180, false, true),
    architectName: text(raw.architectName, "Architect / consultant", 180, false, true),
    orderId: optionalPositiveId(raw.orderId, "Production order id"),
    discipline: disciplineRaw as DesignDiscipline,
    area: text(raw.area, "Area / location", 160, false, true),
    sheetCount,
    priority: priorityRaw as DesignPriority,
    requiredDate: optionalDate(raw.requiredDate, "Required date"),
    externalLink: cleanDesignExternalLink(raw.externalLink),
    notes: text(raw.notes, "Notes", 3000),
  };
}

export function parseDesignSubmit(input: unknown): DesignSubmitInput {
  const raw = record(input);
  const submittedDate = requiredDate(raw.submittedDate, "Submitted date");
  const responseDueDate = optionalDate(raw.responseDueDate, "Response due date");
  if (responseDueDate && responseDueDate < submittedDate) {
    throw new DesignDepartmentError("Response due date cannot be before the submitted date.");
  }
  return {
    submittedTo: text(raw.submittedTo, "Submitted to", 180, true, true),
    submittedDate,
    transmittalNo: text(raw.transmittalNo, "Transmittal number", 80, false, true),
    responseDueDate,
    note: text(raw.note, "Submittal note", 2000),
  };
}

export function parseDesignApproval(input: unknown): DesignApprovalInput {
  const raw = record(input);
  const code = text(raw.approvalCode, "Approval code", 4, true, true).toUpperCase();
  if (!(DESIGN_APPROVAL_CODES as readonly string[]).includes(code)) {
    throw new DesignDepartmentError("Choose approval Code A, B, C or D.");
  }
  const approvalComments = text(raw.approvalComments, "Approval comments", 4000);
  if (code !== "A" && !approvalComments) {
    throw new DesignDepartmentError(`Approval comments are required for Code ${code}.`);
  }
  const incorporated = booleanValue(raw.commentsIncorporated, "Comments incorporated");
  return {
    approvalCode: code as DesignApprovalCode,
    approvalBy: text(raw.approvalBy, "Returned / approved by", 180, true, true),
    approvalDate: requiredDate(raw.approvalDate, "Approval return date"),
    approvalComments,
    commentsIncorporated: code === "B" ? incorporated : false,
  };
}

export function parseDesignIssue(input: unknown): DesignIssueInput {
  const raw = record(input);
  return {
    issuedTo: text(raw.issuedTo, "Issued to", 180, true, true),
    note: text(raw.note, "Production issue note", 2000),
    confirmCommentsIncorporated: booleanValue(
      raw.confirmCommentsIncorporated,
      "Comments incorporated confirmation",
    ),
  };
}

export function parseDesignResubmission(input: unknown): DesignResubmissionInput {
  const raw = record(input);
  return {
    revision: text(raw.revision, "New revision", 24, true, true),
    note: text(raw.note, "Resubmission note", 2000),
  };
}

export function parseDesignStatusChange(input: unknown): DesignStatusChangeInput {
  const raw = record(input);
  const status = text(raw.status, "Status", 30, true, true);
  if (status !== "Draft" && status !== "On Hold" && status !== "Cancelled") {
    throw new DesignDepartmentError("Choose Draft, On Hold or Cancelled for a manual status change.");
  }
  return { status, note: text(raw.note, "Status note", 2000) };
}

export function parseDesignComments(input: unknown): DesignCommentsInput {
  const raw = record(input);
  if (typeof raw.incorporated !== "boolean") {
    throw new DesignDepartmentError("State whether the Code B comments are incorporated.");
  }
  return {
    incorporated: raw.incorporated,
    note: text(raw.note, "Comment incorporation note", 2000),
  };
}

export interface DesignIssueEligibilityDrawing {
  status?: string | null;
  approvalCode?: string | null;
  commentsIncorporated?: boolean | null;
}

export interface DesignIssueEligibility {
  ok: boolean;
  reason: string;
  code: DesignApprovalCode | null;
}

export function canIssueToProduction(
  drawing: DesignIssueEligibilityDrawing | null | undefined,
): DesignIssueEligibility {
  const status = String(drawing?.status ?? "");
  const def = designApprovalCodeDef(drawing?.approvalCode);
  const code = def?.code ?? null;
  if (status === "Issued to Production") {
    return { ok: false, reason: "This revision has already been issued to production.", code };
  }
  if (status === "Superseded") {
    return { ok: false, reason: "A superseded revision must not be issued to production.", code };
  }
  if (status === "Cancelled") {
    return { ok: false, reason: "A cancelled drawing cannot be issued to production.", code };
  }
  if (status === "On Hold") {
    return { ok: false, reason: "Resume this drawing from On Hold before issuing it.", code };
  }
  if (!def) {
    return { ok: false, reason: "Record the returned approval code before issuing to production.", code: null };
  }
  if (!def.canIssue) {
    return {
      ok: false,
      reason: `${def.label} is not for production. Create and submit a revised drawing.`,
      code,
    };
  }
  if (def.requiresCommentsIncorporated && !drawing?.commentsIncorporated) {
    return {
      ok: false,
      reason: "Code B comments must be incorporated and confirmed before production issue.",
      code,
    };
  }
  if (status !== "Returned") {
    return {
      ok: false,
      reason: "Only a returned approved revision can be issued to production.",
      code,
    };
  }
  return { ok: true, reason: `${def.label} may be issued to production.`, code };
}

export interface DesignStageDrawing extends DesignIssueEligibilityDrawing {
  responseDueDate?: string | null;
}

export function designDrawingStage(
  drawing: DesignStageDrawing | null | undefined,
  today = new Date().toISOString().slice(0, 10),
): string {
  const status = String(drawing?.status ?? "Draft");
  if (status === "Issued to Production") return "Issued to production";
  if (status === "Superseded") return "Superseded";
  if (status === "Cancelled") return "Cancelled";
  if (status === "On Hold") return "On hold";
  const code = designApprovalCodeDef(drawing?.approvalCode)?.code;
  if (code === "C" || code === "D") return "Revise & resubmit";
  if (canIssueToProduction(drawing).ok) return "Ready to issue";
  if (code === "B") return "Incorporate Code B comments";
  if (status === "Submitted") {
    return drawing?.responseDueDate && drawing.responseDueDate < today
      ? "Approval overdue"
      : "Awaiting approval";
  }
  if (status === "Returned") return "Returned";
  return "Draft — not submitted";
}

export interface DesignDrawingSummary {
  total: number;
  active: number;
  draft: number;
  awaitingApproval: number;
  overdueApprovals: number;
  readyToIssue: number;
  reviseAndResubmit: number;
  issuedToProduction: number;
  onHold: number;
  codes: Record<DesignApprovalCode | "none", number>;
}

export function summarizeDesignDrawings(
  drawings: readonly DesignStageDrawing[],
  today = new Date().toISOString().slice(0, 10),
): DesignDrawingSummary {
  const summary: DesignDrawingSummary = {
    total: drawings.length,
    active: 0,
    draft: 0,
    awaitingApproval: 0,
    overdueApprovals: 0,
    readyToIssue: 0,
    reviseAndResubmit: 0,
    issuedToProduction: 0,
    onHold: 0,
    codes: { A: 0, B: 0, C: 0, D: 0, none: 0 },
  };
  for (const drawing of drawings) {
    const status = String(drawing.status ?? "Draft");
    const code = designApprovalCodeDef(drawing.approvalCode)?.code;
    if (code) summary.codes[code] += 1;
    else summary.codes.none += 1;
    if (status !== "Superseded" && status !== "Cancelled") summary.active += 1;
    if (status === "Draft") summary.draft += 1;
    if (status === "Submitted") {
      summary.awaitingApproval += 1;
      if (drawing.responseDueDate && drawing.responseDueDate < today) {
        summary.overdueApprovals += 1;
      }
    }
    if (status === "On Hold") summary.onHold += 1;
    if (status === "Issued to Production") summary.issuedToProduction += 1;
    if (status === "Returned" && (code === "C" || code === "D")) {
      summary.reviseAndResubmit += 1;
    }
    if (canIssueToProduction(drawing).ok) summary.readyToIssue += 1;
  }
  return summary;
}

export function suggestNextDesignRevision(current: string | null | undefined): string {
  const raw = String(current ?? "").trim();
  if (!raw) return "R1";
  const numeric = raw.match(/^(.*?)(\d+)$/);
  if (numeric) {
    const next = Number(numeric[2]) + 1;
    return `${numeric[1]}${String(next).padStart(numeric[2].length, "0")}`;
  }
  if (/^[A-Za-z]$/.test(raw)) {
    const upper = raw.toUpperCase();
    return upper === "Z" ? "A1" : String.fromCharCode(upper.charCodeAt(0) + 1);
  }
  const trailingLetter = raw.match(/^(.*[^A-Za-z])([A-Za-z])$/);
  if (trailingLetter) {
    const letter = trailingLetter[2].toUpperCase();
    return letter === "Z"
      ? `${trailingLetter[1]}A1`
      : `${trailingLetter[1]}${String.fromCharCode(letter.charCodeAt(0) + 1)}`;
  }
  return `${raw}-1`;
}

export const designRecordNumber = (id: number) => `DES-${String(id).padStart(5, "0")}`;
