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

export const DESIGN_SUBMISSION_CHECKLIST = [
  {
    id: "titleBlock",
    label: "Drawing number, revision, title block and sheet list verified",
  },
  {
    id: "dimensions",
    label: "Dimensions, levels and site measurements checked",
  },
  {
    id: "materials",
    label: "Materials, finishes, hardware and specifications complete",
  },
  {
    id: "coordination",
    label: "Sections and details coordinated with the project and adjoining trades",
  },
  {
    id: "package",
    label: "PDF/CAD package, sheet count and external drawing location verified",
  },
  {
    id: "comments",
    label: "Previous client/consultant comments addressed, or first issue confirmed",
  },
] as const;
export type DesignSubmissionChecklistId =
  (typeof DESIGN_SUBMISSION_CHECKLIST)[number]["id"];
export type DesignSubmissionChecklistState =
  Record<DesignSubmissionChecklistId, boolean>;

export interface DesignSubmissionChecklistProgress {
  checked: number;
  total: number;
  complete: boolean;
  missing: string[];
}

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
  submissionChecklist: DesignSubmissionChecklistState;
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

export interface DesignChecklistInput {
  submissionChecklist: DesignSubmissionChecklistState;
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

export function designDateDiffDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!isValidDesignDate(start) || !isValidDesignDate(end)) return null;
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

export function emptyDesignSubmissionChecklist(): DesignSubmissionChecklistState {
  const state = {} as DesignSubmissionChecklistState;
  for (const item of DESIGN_SUBMISSION_CHECKLIST) state[item.id] = false;
  return state;
}

export function readDesignSubmissionChecklist(
  value: unknown,
): DesignSubmissionChecklistState {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return emptyDesignSubmissionChecklist();
    }
  }
  const state = emptyDesignSubmissionChecklist();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return state;
  const source = raw as Record<string, unknown>;
  for (const item of DESIGN_SUBMISSION_CHECKLIST) {
    state[item.id] = source[item.id] === true;
  }
  return state;
}

export function designSubmissionChecklistProgress(
  value: unknown,
): DesignSubmissionChecklistProgress {
  const state = readDesignSubmissionChecklist(value);
  const missing = DESIGN_SUBMISSION_CHECKLIST
    .filter((item) => !state[item.id])
    .map((item) => item.label);
  return {
    checked: DESIGN_SUBMISSION_CHECKLIST.length - missing.length,
    total: DESIGN_SUBMISSION_CHECKLIST.length,
    complete: missing.length === 0,
    missing,
  };
}

export function parseDesignSubmissionChecklist(
  input: unknown,
  requireComplete = false,
): DesignSubmissionChecklistState {
  let raw: unknown = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      throw new DesignDepartmentError("Submission checklist must be a valid checklist object.");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DesignDepartmentError("Complete the design submission checklist before submitting.");
  }
  const source = raw as Record<string, unknown>;
  const known = new Set<string>(DESIGN_SUBMISSION_CHECKLIST.map((item) => item.id));
  for (const key of Object.keys(source)) {
    if (!known.has(key)) {
      throw new DesignDepartmentError(`Unknown submission checklist item: ${key}.`);
    }
  }
  const state = emptyDesignSubmissionChecklist();
  for (const item of DESIGN_SUBMISSION_CHECKLIST) {
    const value = source[item.id];
    if (value !== undefined && typeof value !== "boolean") {
      throw new DesignDepartmentError(`Checklist item “${item.label}” must be true or false.`);
    }
    state[item.id] = value === true;
  }
  if (requireComplete) assertDesignSubmissionChecklistComplete(state);
  return state;
}

export function assertDesignSubmissionChecklistComplete(
  value: unknown,
): DesignSubmissionChecklistState {
  const state = readDesignSubmissionChecklist(value);
  const progress = designSubmissionChecklistProgress(state);
  if (!progress.complete) {
    throw new DesignDepartmentError(
      `Complete the submission checklist before submitting. Still required: ${progress.missing.join("; ")}`,
      409,
    );
  }
  return state;
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
    submissionChecklist: parseDesignSubmissionChecklist(raw.submissionChecklist, true),
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

export function parseDesignChecklist(input: unknown): DesignChecklistInput {
  const raw = record(input);
  return {
    submissionChecklist: parseDesignSubmissionChecklist(raw.submissionChecklist),
  };
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

export interface DesignProductionGateDrawing extends DesignStageDrawing {
  id?: number | string | null;
  orderId?: number | string | null;
  projectName?: string | null;
  drawingNo?: string | null;
  revision?: string | null;
  title?: string | null;
  createdAt?: string | Date | null;
}

export interface DesignProductionGateDrawingRef {
  drawingId: number | null;
  drawingNo: string;
  revision: string;
  projectName: string;
  title: string;
  status: string;
  approvalCode: string;
  stage: string;
  reason: string;
}

export interface DesignProductionGate {
  state: "not-controlled" | "ready" | "blocked";
  controlled: boolean;
  ready: boolean;
  requiredFamilies: number;
  issuedFamilies: number;
  issuedDrawingCount: number;
  blockers: DesignProductionGateDrawingRef[];
  issuedRevisions: DesignProductionGateDrawingRef[];
  message: string;
}

function gateDrawingTime(drawing: DesignProductionGateDrawing): number {
  const id = Number(drawing.id);
  if (Number.isSafeInteger(id) && id > 0) return id;
  const time = drawing.createdAt instanceof Date
    ? drawing.createdAt.getTime()
    : Date.parse(String(drawing.createdAt ?? ""));
  return Number.isFinite(time) ? time : 0;
}

function gateDrawingRef(
  drawing: DesignProductionGateDrawing,
  reason: string,
  today: string,
): DesignProductionGateDrawingRef {
  const id = Number(drawing.id);
  return {
    drawingId: Number.isSafeInteger(id) && id > 0 ? id : null,
    drawingNo: String(drawing.drawingNo ?? "Drawing"),
    revision: String(drawing.revision ?? ""),
    projectName: String(drawing.projectName ?? ""),
    title: String(drawing.title ?? ""),
    status: String(drawing.status ?? "Draft"),
    approvalCode: String(drawing.approvalCode ?? ""),
    stage: designDrawingStage(drawing, today),
    reason,
  };
}

/**
 * The owner-selected hard production gate. Linking any current Design
 * Department drawing family to an order makes that order design-controlled:
 * production may start only when every linked family has an issued revision.
 * An older issued revision remains valid while a replacement is being revised;
 * cancelled/superseded-only families no longer control the order. Orders with
 * no linked drawings stay outside this optional gate, so historical and
 * non-design orders are not trapped by enabling the module.
 */
export function designProductionGate(
  drawings: readonly DesignProductionGateDrawing[],
  today = new Date().toISOString().slice(0, 10),
): DesignProductionGate {
  const families = new Map<string, DesignProductionGateDrawing[]>();
  for (const drawing of drawings) {
    const key = `${String(drawing.projectName ?? "").trim().toLowerCase()}|${String(drawing.drawingNo ?? "").trim().toLowerCase()}`;
    const rows = families.get(key) ?? [];
    rows.push(drawing);
    families.set(key, rows);
  }

  let requiredFamilies = 0;
  let issuedFamilies = 0;
  let issuedDrawingCount = 0;
  const blockers: DesignProductionGateDrawingRef[] = [];
  const issuedRevisions: DesignProductionGateDrawingRef[] = [];

  for (const rows of families.values()) {
    const issued = rows.filter((row) => String(row.status ?? "") === "Issued to Production");
    const current = rows.filter((row) => !["Cancelled", "Superseded"].includes(String(row.status ?? "")));
    if (issued.length === 0 && current.length === 0) continue;
    requiredFamilies += 1;
    issuedDrawingCount += issued.length;
    if (issued.length > 0) {
      issuedFamilies += 1;
      const latestIssued = [...issued].sort((a, b) => gateDrawingTime(b) - gateDrawingTime(a))[0];
      issuedRevisions.push(gateDrawingRef(
        latestIssued,
        "This issued revision is the current production release for its drawing family.",
        today,
      ));
      continue;
    }
    const latest = [...current].sort((a, b) => gateDrawingTime(b) - gateDrawingTime(a))[0];
    const status = String(latest.status ?? "Draft");
    const eligibility = canIssueToProduction(latest);
    const reason = status === "Draft"
      ? "This revision has not been submitted or issued to production."
      : status === "Submitted"
        ? "Approval is still pending; no revision of this drawing has been issued."
        : eligibility.ok
          ? "The approved revision is ready, but it has not yet been issued to production."
          : eligibility.reason;
    blockers.push(gateDrawingRef(latest, reason, today));
  }

  blockers.sort((a, b) => `${a.drawingNo} ${a.revision}`.localeCompare(`${b.drawingNo} ${b.revision}`));
  issuedRevisions.sort((a, b) => `${a.drawingNo} ${a.revision}`.localeCompare(`${b.drawingNo} ${b.revision}`));
  if (requiredFamilies === 0) {
    return {
      state: "not-controlled",
      controlled: false,
      ready: true,
      requiredFamilies,
      issuedFamilies,
      issuedDrawingCount,
      blockers,
      issuedRevisions,
      message: "No current Design Department drawings are linked to this order.",
    };
  }
  if (blockers.length > 0) {
    const names = blockers
      .slice(0, 3)
      .map((blocker) => `${blocker.drawingNo} Rev ${blocker.revision || "—"} (${blocker.stage})`)
      .join(", ");
    return {
      state: "blocked",
      controlled: true,
      ready: false,
      requiredFamilies,
      issuedFamilies,
      issuedDrawingCount,
      blockers,
      issuedRevisions,
      message: `Production is blocked until every linked drawing has an issued revision. Waiting on ${names}${blockers.length > 3 ? ` and ${blockers.length - 3} more` : ""}.`,
    };
  }
  return {
    state: "ready",
    controlled: true,
    ready: true,
    requiredFamilies,
    issuedFamilies,
    issuedDrawingCount,
    blockers,
    issuedRevisions,
    message: `All ${requiredFamilies} linked drawing ${requiredFamilies === 1 ? "family has" : "families have"} an issued production revision.`,
  };
}

export interface DesignAlertDrawing extends DesignProductionGateDrawing {
  clientName?: string | null;
  architectName?: string | null;
  orderSnapshot?: string | null;
  priority?: string | null;
  requiredDate?: string | null;
  submittedDate?: string | null;
  submittedTo?: string | null;
  approvalDate?: string | null;
  discipline?: string | null;
  submissionChecklist?: unknown;
  submissionChecklistJson?: unknown;
}

export type DesignAlertSeverity = "rose" | "amber" | "sky" | "violet";

export interface DesignDepartmentAlert {
  kind: string;
  severity: DesignAlertSeverity;
  title: string;
  detail: string;
  drawingId: number | null;
  orderId: number | null;
  dueDate: string | null;
  days: number | null;
}

export interface DesignAlertOptions {
  dueSoonDays?: number;
  includeChecklist?: boolean;
}

export function designDrawingAlerts(
  drawing: DesignAlertDrawing | null | undefined,
  today = new Date().toISOString().slice(0, 10),
  options: DesignAlertOptions = {},
): DesignDepartmentAlert[] {
  if (!drawing) return [];
  const status = String(drawing.status ?? "Draft");
  if (status === "Superseded" || status === "Cancelled") return [];
  const dueSoonDays = Math.max(0, Math.min(30, Math.floor(options.dueSoonDays ?? 3) || 0));
  const drawingIdRaw = Number(drawing.id);
  const drawingId = Number.isSafeInteger(drawingIdRaw) && drawingIdRaw > 0 ? drawingIdRaw : null;
  const orderIdRaw = Number(drawing.orderId);
  const orderId = Number.isSafeInteger(orderIdRaw) && orderIdRaw > 0 ? orderIdRaw : null;
  const label = `${String(drawing.drawingNo ?? "Drawing")} Rev ${String(drawing.revision ?? "—")}`;
  const project = String(drawing.projectName ?? "").trim();
  const place = project ? ` · ${project}` : "";
  const alerts: DesignDepartmentAlert[] = [];
  const push = (
    kind: string,
    severity: DesignAlertSeverity,
    title: string,
    detail: string,
    dueDate: string | null = null,
    days: number | null = null,
  ) => alerts.push({ kind, severity, title, detail, drawingId, orderId, dueDate, days });

  const code = designApprovalCodeDef(drawing.approvalCode)?.code;
  if (status === "Returned" && (code === "C" || code === "D")) {
    push(
      "resubmit",
      "rose",
      `${label}: revise and resubmit`,
      `${designApprovalCodeDef(code)?.label ?? `Code ${code}`}${place} — this revision is not for production. Create the corrected revision.`,
      drawing.approvalDate ?? null,
    );
  } else if (status === "Returned" && code === "B" && !drawing.commentsIncorporated) {
    push(
      "code-b-comments",
      "amber",
      `${label}: Code B comments pending`,
      `Incorporate and confirm the returned comments before this drawing can be issued${place}.`,
      drawing.approvalDate ?? null,
    );
  } else if (canIssueToProduction(drawing).ok) {
    push(
      "ready-to-issue",
      "sky",
      `${label}: ready to issue to production`,
      `${designApprovalCodeDef(code)?.label ?? "Approved drawing"}${place} — production is waiting for the controlled issue action.`,
      drawing.approvalDate ?? null,
    );
  }

  if (status === "Submitted" && drawing.responseDueDate) {
    const daysUntilDue = designDateDiffDays(today, drawing.responseDueDate);
    if (daysUntilDue !== null && daysUntilDue < 0) {
      push(
        "approval-overdue",
        "rose",
        `${label}: approval response overdue`,
        `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"} past the response date${drawing.submittedTo ? ` from ${drawing.submittedTo}` : ""}${place}. Chase the return.`,
        drawing.responseDueDate,
        Math.abs(daysUntilDue),
      );
    } else if (daysUntilDue !== null && daysUntilDue <= dueSoonDays) {
      push(
        "approval-due-soon",
        "amber",
        `${label}: approval response due soon`,
        daysUntilDue === 0
          ? `The approval response is due today${place}.`
          : `The approval response is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}${place}.`,
        drawing.responseDueDate,
        daysUntilDue,
      );
    }
  }

  if (["Draft", "Submitted", "Returned", "On Hold"].includes(status) && drawing.requiredDate) {
    const daysUntilRequired = designDateDiffDays(today, drawing.requiredDate);
    if (daysUntilRequired !== null && daysUntilRequired < 0) {
      push(
        "required-overdue",
        "rose",
        `${label}: required date passed`,
        `The drawing was required ${Math.abs(daysUntilRequired)} day${Math.abs(daysUntilRequired) === 1 ? "" : "s"} ago and is not issued${place}.`,
        drawing.requiredDate,
        Math.abs(daysUntilRequired),
      );
    } else if (daysUntilRequired !== null && daysUntilRequired <= dueSoonDays) {
      push(
        "required-soon",
        "amber",
        `${label}: required soon`,
        daysUntilRequired === 0
          ? `This drawing is required today and is not issued${place}.`
          : `This drawing is required in ${daysUntilRequired} day${daysUntilRequired === 1 ? "" : "s"} and is not issued${place}.`,
        drawing.requiredDate,
        daysUntilRequired,
      );
    }
  }

  if (status === "Draft" && options.includeChecklist !== false) {
    const progress = designSubmissionChecklistProgress(
      drawing.submissionChecklist ?? drawing.submissionChecklistJson,
    );
    if (!progress.complete) {
      push(
        "checklist",
        "sky",
        `${label}: submission checklist incomplete`,
        `${progress.checked}/${progress.total} checks complete. Finish the design/checking list before this revision can be submitted${place}.`,
        drawing.requiredDate ?? null,
        progress.total - progress.checked,
      );
    }
  }

  if (status === "On Hold") {
    push(
      "on-hold",
      "violet",
      `${label}: on hold`,
      `This drawing is paused and cannot move toward production until it is resumed${place}.`,
      drawing.requiredDate ?? null,
    );
  }

  return alerts;
}

export function designDepartmentAlerts(
  drawings: readonly DesignAlertDrawing[],
  today = new Date().toISOString().slice(0, 10),
  options: DesignAlertOptions = {},
): DesignDepartmentAlert[] {
  const severityRank: Record<DesignAlertSeverity, number> = {
    rose: 0,
    amber: 1,
    sky: 2,
    violet: 3,
  };
  return drawings
    .flatMap((drawing) => designDrawingAlerts(drawing, today, options))
    .sort((a, b) => (
      severityRank[a.severity] - severityRank[b.severity]
      || String(a.dueDate ?? "9999-12-31").localeCompare(String(b.dueDate ?? "9999-12-31"))
      || a.title.localeCompare(b.title)
    ));
}

export interface DesignReportGroup {
  name: string;
  total: number;
  active: number;
  submitted: number;
  returnedOutcomes: number;
  issued: number;
  readyToIssue: number;
  codes: Record<DesignApprovalCode | "none", number>;
  approvalRate: number;
  responseSamples: number;
  averageResponseDays: number | null;
}

export interface DesignDepartmentReport {
  totals: {
    records: number;
    families: number;
    active: number;
    draft: number;
    awaitingApproval: number;
    overdueApprovals: number;
    returnedOutcomes: number;
    readyToIssue: number;
    reviseAndResubmit: number;
    issuedToProduction: number;
    onHold: number;
  };
  codes: Record<DesignApprovalCode | "none", number>;
  approvalOutcomes: {
    productionEligible: number;
    reviseOrReject: number;
    firstPassApprovalRate: number;
    codeARate: number;
  };
  turnaround: {
    responseSamples: number;
    totalResponseDays: number;
    averageResponseDays: number | null;
    issueSamples: number;
    totalApprovalToIssueDays: number;
    averageApprovalToIssueDays: number | null;
  };
  aging: {
    awaiting0To7: number;
    awaiting8To14: number;
    awaiting15To30: number;
    awaitingOver30: number;
    overdue: number;
  };
  byDiscipline: DesignReportGroup[];
  byProject: DesignReportGroup[];
  byConsultant: DesignReportGroup[];
}

function emptyDesignReportGroup(name: string): DesignReportGroup & { responseDays: number } {
  return {
    name,
    total: 0,
    active: 0,
    submitted: 0,
    returnedOutcomes: 0,
    issued: 0,
    readyToIssue: 0,
    codes: { A: 0, B: 0, C: 0, D: 0, none: 0 },
    approvalRate: 0,
    responseSamples: 0,
    averageResponseDays: null,
    responseDays: 0,
  };
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function averageOrNull(total: number, samples: number): number | null {
  if (samples <= 0) return null;
  return Math.round((total / samples) * 10) / 10;
}

export function buildDesignDepartmentReport(
  drawings: readonly DesignAlertDrawing[],
  today = new Date().toISOString().slice(0, 10),
): DesignDepartmentReport {
  const summary = summarizeDesignDrawings(drawings, today);
  const families = new Set(drawings.map((drawing) => (
    `${String(drawing.projectName ?? "").trim().toLowerCase()}|${String(drawing.drawingNo ?? "").trim().toLowerCase()}`
  )));
  let codedOutcomes = 0;
  let eligibleOutcomes = 0;
  let reviseOutcomes = 0;
  let codeAOutcomes = 0;
  let responseSamples = 0;
  let totalResponseDays = 0;
  let issueSamples = 0;
  let totalApprovalToIssueDays = 0;
  const aging = { awaiting0To7: 0, awaiting8To14: 0, awaiting15To30: 0, awaitingOver30: 0, overdue: 0 };
  const disciplineGroups = new Map<string, ReturnType<typeof emptyDesignReportGroup>>();
  const projectGroups = new Map<string, ReturnType<typeof emptyDesignReportGroup>>();
  const consultantGroups = new Map<string, ReturnType<typeof emptyDesignReportGroup>>();

  const addToGroup = (
    groups: Map<string, ReturnType<typeof emptyDesignReportGroup>>,
    rawName: string,
    drawing: DesignAlertDrawing,
    code: DesignApprovalCode | null,
    responseDays: number | null,
  ) => {
    const name = rawName.trim() || "Not recorded";
    const group = groups.get(name) ?? emptyDesignReportGroup(name);
    const status = String(drawing.status ?? "Draft");
    group.total += 1;
    if (status !== "Superseded" && status !== "Cancelled") group.active += 1;
    if (drawing.submittedDate || ["Submitted", "Returned", "Issued to Production"].includes(status)) group.submitted += 1;
    if (code) {
      group.returnedOutcomes += 1;
      group.codes[code] += 1;
    } else group.codes.none += 1;
    if (status === "Issued to Production") group.issued += 1;
    if (canIssueToProduction(drawing).ok) group.readyToIssue += 1;
    if (responseDays !== null && responseDays >= 0) {
      group.responseSamples += 1;
      group.responseDays += responseDays;
    }
    groups.set(name, group);
  };

  for (const drawing of drawings) {
    const code = designApprovalCodeDef(drawing.approvalCode)?.code ?? null;
    const responseDays = designDateDiffDays(drawing.submittedDate, drawing.approvalDate);
    if (code) {
      codedOutcomes += 1;
      if (code === "A" || code === "B") eligibleOutcomes += 1;
      if (code === "C" || code === "D") reviseOutcomes += 1;
      if (code === "A") codeAOutcomes += 1;
    }
    if (responseDays !== null && responseDays >= 0) {
      responseSamples += 1;
      totalResponseDays += responseDays;
    }
    const issuedDate = typeof (drawing as { issuedAt?: unknown }).issuedAt === "string"
      ? String((drawing as { issuedAt?: unknown }).issuedAt).slice(0, 10)
      : (drawing as { issuedAt?: unknown }).issuedAt instanceof Date
        ? ((drawing as { issuedAt: Date }).issuedAt).toISOString().slice(0, 10)
        : null;
    const issueDays = designDateDiffDays(drawing.approvalDate, issuedDate);
    if (issueDays !== null && issueDays >= 0) {
      issueSamples += 1;
      totalApprovalToIssueDays += issueDays;
    }
    if (String(drawing.status ?? "") === "Submitted") {
      const age = designDateDiffDays(drawing.submittedDate, today);
      if (age !== null && age >= 0) {
        if (age <= 7) aging.awaiting0To7 += 1;
        else if (age <= 14) aging.awaiting8To14 += 1;
        else if (age <= 30) aging.awaiting15To30 += 1;
        else aging.awaitingOver30 += 1;
      }
      if (drawing.responseDueDate && drawing.responseDueDate < today) aging.overdue += 1;
    }
    addToGroup(disciplineGroups, String(drawing.discipline ?? "General Joinery"), drawing, code, responseDays);
    addToGroup(projectGroups, String(drawing.projectName ?? drawing.orderSnapshot ?? ""), drawing, code, responseDays);
    addToGroup(consultantGroups, String(drawing.architectName ?? drawing.submittedTo ?? ""), drawing, code, responseDays);
  }

  const finishGroups = (groups: Map<string, ReturnType<typeof emptyDesignReportGroup>>): DesignReportGroup[] => (
    [...groups.values()]
      .map(({ responseDays, ...group }) => ({
        ...group,
        approvalRate: percent(group.codes.A + group.codes.B, group.returnedOutcomes),
        averageResponseDays: averageOrNull(responseDays, group.responseSamples),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  );

  return {
    totals: {
      records: summary.total,
      families: drawings.length ? families.size : 0,
      active: summary.active,
      draft: summary.draft,
      awaitingApproval: summary.awaitingApproval,
      overdueApprovals: summary.overdueApprovals,
      returnedOutcomes: codedOutcomes,
      readyToIssue: summary.readyToIssue,
      reviseAndResubmit: summary.reviseAndResubmit,
      issuedToProduction: summary.issuedToProduction,
      onHold: summary.onHold,
    },
    codes: summary.codes,
    approvalOutcomes: {
      productionEligible: eligibleOutcomes,
      reviseOrReject: reviseOutcomes,
      firstPassApprovalRate: percent(eligibleOutcomes, codedOutcomes),
      codeARate: percent(codeAOutcomes, codedOutcomes),
    },
    turnaround: {
      responseSamples,
      totalResponseDays,
      averageResponseDays: averageOrNull(totalResponseDays, responseSamples),
      issueSamples,
      totalApprovalToIssueDays,
      averageApprovalToIssueDays: averageOrNull(totalApprovalToIssueDays, issueSamples),
    },
    aging,
    byDiscipline: finishGroups(disciplineGroups),
    byProject: finishGroups(projectGroups),
    byConsultant: finishGroups(consultantGroups),
  };
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
