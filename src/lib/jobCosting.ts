// ============================================================================
// Job costing & profitability — the pure, client-safe model.
//
// "Which jobs and clients actually make money?" For every production order:
//
//   revenue  = the order's agreed value (orders.total_value, before VAT)
//   cost     = materials  (allocated BOM lines that were not released:
//                          consumed + still reserved, × the unit cost snapshot)
//            + machine time  (operation minutes × the machine's hourly rate)
//            + operator labor (operation minutes × the shop labor rate)
//            + overhead      (an optional % of the three direct costs)
//   profit   = revenue − cost
//
// Two time bases are computed side by side:
//   • ACTUAL    — what the floor really recorded (plus the elapsed time of a job
//                 that is running right now).
//   • PROJECTED — the same, but never below the plan: a step that has not run
//                 yet costs its estimate, a step that overruns costs the overrun.
// A finished order (Completed / Delivered) is judged on ACTUAL — that is the
// final margin. An open order is judged on PROJECTED, so a half-built job never
// looks more profitable than it will turn out.
//
// All money is integer cents end to end (same rule as invoicing); every line is
// rounded once, and every total is a sum of already-rounded lines, so the
// detail drawer always adds up to the board.
//
// Scrap/rework is reported as a MEMO and deliberately NOT added again: the
// replacement board is normally allocated to the order and so is already in the
// materials line — adding the scrap estimate would charge it twice.
//
// This file has no server imports so the screen, the Order Profitability report
// and the render-test harness share one implementation.
// ============================================================================

export class JobCostingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "JobCostingError";
    this.status = status;
  }
}

// ----------------------------------------------------------------- settings

export interface JobCostSettings {
  /** Operator labor cost per hour, in cents. 0 = not set (labor line is $0). */
  laborRateCentsPerHour: number;
  /** Overhead as a percentage of direct cost, in basis points (1000 = 10%). */
  overheadBps: number;
}

export const DEFAULT_JOB_COST_SETTINGS: JobCostSettings = {
  laborRateCentsPerHour: 0,
  overheadBps: 0,
};

export const MAX_LABOR_RATE_CENTS = 100_000_00; // $100,000 / hour is a typo, not a rate
export const MAX_OVERHEAD_BPS = 500_00; // 500 %

/** "12.5" / 12.5 -> 1250 cents. Throws on negatives, NaN and > 2 decimals. */
export function moneyToCents(raw: unknown, label = "Amount"): number {
  const text = String(raw ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new JobCostingError(`${label} must be a positive number with at most 2 decimals.`);
  }
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new JobCostingError(`${label} is too large.`);
  return cents;
}

/** "12.5" -> 1250 basis points. At most 2 decimals. */
export function percentToBps(raw: unknown, label = "Percentage"): number {
  const text = String(raw ?? "").trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new JobCostingError(`${label} must be a positive number with at most 2 decimals.`);
  }
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Strict parse of the Manager's settings form. Blank = 0 (switch the line off). */
export function parseJobCostSettings(input: unknown): JobCostSettings {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const labor = String(body.laborRate ?? "").trim() === "" ? 0 : moneyToCents(body.laborRate, "Labor rate");
  const overhead = String(body.overheadPercent ?? "").trim() === "" ? 0 : percentToBps(body.overheadPercent, "Overhead");
  if (labor > MAX_LABOR_RATE_CENTS) throw new JobCostingError("Labor rate is unrealistically high — check the decimal point.");
  if (overhead > MAX_OVERHEAD_BPS) throw new JobCostingError("Overhead cannot exceed 500%.");
  return { laborRateCentsPerHour: labor, overheadBps: overhead };
}

/** Lenient read of the stored file: garbage falls back to the safe defaults. */
export function sanitizeJobCostSettings(input: unknown): JobCostSettings {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const labor = Number(body.laborRateCentsPerHour);
  const overhead = Number(body.overheadBps);
  return {
    laborRateCentsPerHour: Number.isSafeInteger(labor) && labor >= 0 && labor <= MAX_LABOR_RATE_CENTS ? labor : 0,
    overheadBps: Number.isSafeInteger(overhead) && overhead >= 0 && overhead <= MAX_OVERHEAD_BPS ? overhead : 0,
  };
}

export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Postgres numeric text ("65.00", null) -> cents. Bad/negative values -> 0. */
export function numericToCents(raw: unknown): number {
  const value = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

// -------------------------------------------------------------------- inputs

export const FINAL_ORDER_STATUSES = ["Completed", "Delivered"] as const;

export function isFinalOrderStatus(status: string | null | undefined): boolean {
  return (FINAL_ORDER_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export interface CostOrderInput {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  projectType: string;
  customerId: number | null;
  customerName: string;
  totalValue: unknown;
  createdAt: Date | string;
  dueDate?: Date | string | null;
}

export interface CostMaterialInput {
  id: number;
  itemName: string;
  itemSku: string;
  unit: string;
  quantityUsed: number;
  costPerUnit: unknown;
  consumed: boolean;
  released: boolean;
}

export interface CostOperationInput {
  id: number;
  stepOrder: number;
  operationName: string;
  machineId: number | null;
  machineCode: string | null;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  startTime: Date | string | null;
  endTime: Date | string | null;
}

export interface CostQualityInput {
  id: number;
  eventType: string;
  quantity: number;
  estimatedCost: unknown;
  reason: string;
}

// ------------------------------------------------------------------- outputs

export type MaterialState = "consumed" | "reserved";

export interface MaterialCostLine {
  id: number;
  itemName: string;
  itemSku: string;
  unit: string;
  quantity: number;
  unitCostCents: number;
  totalCents: number;
  state: MaterialState;
}

export type TimeBasis = "recorded" | "elapsed" | "planned";

export interface OperationCostLine {
  id: number;
  stepOrder: number;
  operationName: string;
  machineCode: string | null;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  projectedMinutes: number;
  /** Where the actual minutes came from. "planned" = finished with no time recorded. */
  basis: TimeBasis;
  machineRateCentsPerHour: number;
  machineActualCents: number;
  machineProjectedCents: number;
  laborActualCents: number;
  laborProjectedCents: number;
}

export type JobFlag = "loss" | "low-margin" | "no-revenue" | "no-materials" | "no-time" | "time-overrun" | "rate-missing";

export interface JobCost {
  orderId: number;
  orderNumber: string;
  title: string;
  status: string;
  projectType: string;
  customerId: number | null;
  customer: string;
  createdAt: string;
  dueDate: string | null;
  /** "Final" for Completed/Delivered orders, otherwise "Projected". */
  basis: "Final" | "Projected";
  revenueCents: number;
  materialsCents: number;
  materialsConsumedCents: number;
  materialsReservedCents: number;
  machineCents: number;
  laborCents: number;
  overheadCents: number;
  costCents: number;
  profitCents: number;
  /** Margin in basis points of revenue, or null when the order has no value. */
  marginBps: number | null;
  /** Cost to date — only time actually recorded, materials as allocated. */
  actualCostCents: number;
  /** Cost if every open step ran to plan (or its overrun). */
  projectedCostCents: number;
  estimatedMinutes: number;
  actualMinutes: number;
  projectedMinutes: number;
  scrapCents: number;
  reworkCents: number;
  flags: JobFlag[];
  materialLines: MaterialCostLine[];
  operationLines: OperationCostLine[];
}

// ------------------------------------------------------------------- helpers

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function wholeMinutes(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** cents/hour × minutes -> cents, rounded once. */
export function minutesCostCents(minutes: number, centsPerHour: number): number {
  if (minutes <= 0 || centsPerHour <= 0) return 0;
  return Math.round((minutes * centsPerHour) / 60);
}

/**
 * Minutes a single routed step has really cost, and where the number came from.
 *  • recorded  — actual_minutes written by the floor (or start→end of a finished step)
 *  • elapsed   — a step running right now: time since it started
 *  • planned   — a FINISHED step nobody timed: fall back to the estimate (flagged)
 * A step that has not started has 0 actual minutes.
 */
export function operationActualMinutes(op: CostOperationInput, now: Date): { minutes: number; basis: TimeBasis } {
  const recorded = wholeMinutes(op.actualMinutes);
  const start = toDate(op.startTime);
  const end = toDate(op.endTime);
  if (op.status === "Completed") {
    if (recorded > 0) return { minutes: recorded, basis: "recorded" };
    if (start && end && end > start) {
      return { minutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)), basis: "recorded" };
    }
    return { minutes: wholeMinutes(op.estimatedMinutes), basis: "planned" };
  }
  if (op.status === "In Progress" && start && start <= now) {
    const elapsed = Math.round((now.getTime() - start.getTime()) / 60000);
    return { minutes: Math.max(recorded, elapsed), basis: "elapsed" };
  }
  return { minutes: recorded, basis: "recorded" };
}

export interface CostOrderArgs {
  order: CostOrderInput;
  materials: CostMaterialInput[];
  operations: CostOperationInput[];
  quality: CostQualityInput[];
  /** machine id -> hourly rate in cents */
  machineRates: ReadonlyMap<number, number>;
  settings: JobCostSettings;
  now: Date;
}

/** Margin below this (in bps) is flagged as thin: 10%. */
export const LOW_MARGIN_BPS = 1000;

export function costOrder(args: CostOrderArgs): JobCost {
  const { order, settings, now } = args;
  const basis = isFinalOrderStatus(order.status) ? "Final" : "Projected";
  const revenueCents = numericToCents(order.totalValue);

  // ---- materials: released rows were handed back to stock and cost nothing.
  const materialLines: MaterialCostLine[] = args.materials
    .filter((m) => !m.released)
    .map((m) => {
      const quantity = Math.max(0, Math.round(Number(m.quantityUsed) || 0));
      const unitCostCents = numericToCents(m.costPerUnit);
      return {
        id: m.id,
        itemName: m.itemName,
        itemSku: m.itemSku,
        unit: m.unit,
        quantity,
        unitCostCents,
        totalCents: quantity * unitCostCents,
        state: (m.consumed ? "consumed" : "reserved") as MaterialState,
      };
    });
  const materialsConsumedCents = materialLines.filter((l) => l.state === "consumed").reduce((s, l) => s + l.totalCents, 0);
  const materialsReservedCents = materialLines.filter((l) => l.state === "reserved").reduce((s, l) => s + l.totalCents, 0);
  const materialsCents = materialsConsumedCents + materialsReservedCents;

  // ---- operations: machine time + operator labor, per step, rounded once.
  const laborRate = settings.laborRateCentsPerHour;
  let rateMissing = false;
  const operationLines: OperationCostLine[] = [...args.operations]
    .sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id)
    .map((op) => {
      const estimated = wholeMinutes(op.estimatedMinutes);
      const actual = operationActualMinutes(op, now);
      const projectedMinutes = op.status === "Completed" ? actual.minutes : Math.max(actual.minutes, estimated);
      const rate = op.machineId != null ? args.machineRates.get(op.machineId) ?? 0 : 0;
      if (rate <= 0 && projectedMinutes > 0) rateMissing = true;
      return {
        id: op.id,
        stepOrder: op.stepOrder,
        operationName: op.operationName,
        machineCode: op.machineCode,
        status: op.status,
        estimatedMinutes: estimated,
        actualMinutes: actual.minutes,
        projectedMinutes,
        basis: actual.basis,
        machineRateCentsPerHour: rate,
        machineActualCents: minutesCostCents(actual.minutes, rate),
        machineProjectedCents: minutesCostCents(projectedMinutes, rate),
        laborActualCents: minutesCostCents(actual.minutes, laborRate),
        laborProjectedCents: minutesCostCents(projectedMinutes, laborRate),
      };
    });

  const sum = (pick: (l: OperationCostLine) => number) => operationLines.reduce((s, l) => s + pick(l), 0);
  const machineActual = sum((l) => l.machineActualCents);
  const machineProjected = sum((l) => l.machineProjectedCents);
  const laborActual = sum((l) => l.laborActualCents);
  const laborProjected = sum((l) => l.laborProjectedCents);

  const overhead = (direct: number) => Math.round((direct * settings.overheadBps) / 10000);
  const actualDirect = materialsCents + machineActual + laborActual;
  const projectedDirect = materialsCents + machineProjected + laborProjected;
  const actualCostCents = actualDirect + overhead(actualDirect);
  const projectedCostCents = projectedDirect + overhead(projectedDirect);

  const final = basis === "Final";
  const machineCents = final ? machineActual : machineProjected;
  const laborCents = final ? laborActual : laborProjected;
  const direct = materialsCents + machineCents + laborCents;
  const overheadCents = overhead(direct);
  const costCents = direct + overheadCents;
  const profitCents = revenueCents - costCents;
  const marginBps = revenueCents > 0 ? Math.round((profitCents * 10000) / revenueCents) : null;

  // ---- quality memo (not added to cost — see header).
  const qualityCost = (type: string) =>
    args.quality
      .filter((q) => q.eventType === type)
      .reduce((s, q) => s + numericToCents(q.estimatedCost) * Math.max(1, Math.round(Number(q.quantity) || 1)), 0);

  const estimatedMinutes = operationLines.reduce((s, l) => s + l.estimatedMinutes, 0);
  const actualMinutes = operationLines.reduce((s, l) => s + l.actualMinutes, 0);
  const projectedMinutes = operationLines.reduce((s, l) => s + l.projectedMinutes, 0);

  const flags: JobFlag[] = [];
  if (revenueCents === 0) flags.push("no-revenue");
  else if (profitCents < 0) flags.push("loss");
  else if (marginBps !== null && marginBps < LOW_MARGIN_BPS) flags.push("low-margin");
  if (materialLines.length === 0) flags.push("no-materials");
  if (final && operationLines.some((l) => l.status === "Completed" && l.basis === "planned")) flags.push("no-time");
  if (estimatedMinutes > 0 && actualMinutes > estimatedMinutes * 1.15) flags.push("time-overrun");
  if (rateMissing) flags.push("rate-missing");

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    status: order.status,
    projectType: order.projectType,
    customerId: order.customerId,
    customer: order.customerName || "—",
    createdAt: iso(order.createdAt) ?? "",
    dueDate: iso(order.dueDate),
    basis,
    revenueCents,
    materialsCents,
    materialsConsumedCents,
    materialsReservedCents,
    machineCents,
    laborCents,
    overheadCents,
    costCents,
    profitCents,
    marginBps,
    actualCostCents,
    projectedCostCents,
    estimatedMinutes,
    actualMinutes,
    projectedMinutes,
    scrapCents: qualityCost("scrap"),
    reworkCents: qualityCost("rework"),
    flags,
    materialLines,
    operationLines,
  };
}

// ------------------------------------------------------------------- roll-ups

export interface JobCostTotals {
  orders: number;
  lossMaking: number;
  revenueCents: number;
  materialsCents: number;
  machineCents: number;
  laborCents: number;
  overheadCents: number;
  costCents: number;
  profitCents: number;
  marginBps: number | null;
  estimatedMinutes: number;
  actualMinutes: number;
}

export function totalsOf(rows: readonly JobCost[]): JobCostTotals {
  const add = (pick: (r: JobCost) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const revenueCents = add((r) => r.revenueCents);
  const profitCents = add((r) => r.profitCents);
  return {
    orders: rows.length,
    lossMaking: rows.filter((r) => r.revenueCents > 0 && r.profitCents < 0).length,
    revenueCents,
    materialsCents: add((r) => r.materialsCents),
    machineCents: add((r) => r.machineCents),
    laborCents: add((r) => r.laborCents),
    overheadCents: add((r) => r.overheadCents),
    costCents: add((r) => r.costCents),
    profitCents,
    marginBps: revenueCents > 0 ? Math.round((profitCents * 10000) / revenueCents) : null,
    estimatedMinutes: add((r) => r.estimatedMinutes),
    actualMinutes: add((r) => r.actualMinutes),
  };
}

export interface JobCostGroup extends JobCostTotals {
  key: string;
  label: string;
}

/** Group orders (client / project type) and rank the biggest profit first. */
export function groupJobCosts(rows: readonly JobCost[], keyOf: (r: JobCost) => { key: string; label: string }): JobCostGroup[] {
  const buckets = new Map<string, { label: string; rows: JobCost[] }>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const bucket = buckets.get(key) ?? { label, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: bucket.label, ...totalsOf(bucket.rows) }))
    .sort((a, b) => b.profitCents - a.profitCents || a.label.localeCompare(b.label));
}

// -------------------------------------------------------------------- filters

export type JobCostRange = "all" | "month" | "days90" | "ytd";
export type JobCostScope = "all" | "final" | "open";

export const JOB_COST_RANGES: readonly JobCostRange[] = ["all", "month", "days90", "ytd"];
export const JOB_COST_SCOPES: readonly JobCostScope[] = ["all", "final", "open"];

export function parseRange(raw: unknown): JobCostRange {
  const value = String(raw ?? "").toLowerCase();
  return (JOB_COST_RANGES as readonly string[]).includes(value) ? (value as JobCostRange) : "all";
}

export function parseScope(raw: unknown): JobCostScope {
  const value = String(raw ?? "").toLowerCase();
  return (JOB_COST_SCOPES as readonly string[]).includes(value) ? (value as JobCostScope) : "all";
}

/** Start of the window (orders are filtered by their creation date), or null for "all". */
export function rangeStart(range: JobCostRange, now: Date): Date | null {
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "ytd") return new Date(now.getFullYear(), 0, 1);
  if (range === "days90") return new Date(now.getTime() - 90 * 86_400_000);
  return null;
}

export function inScope(status: string, scope: JobCostScope): boolean {
  if (scope === "final") return isFinalOrderStatus(status);
  if (scope === "open") return !isFinalOrderStatus(status);
  return true;
}

// ------------------------------------------------------------------------ CSV

/** One CSV cell. Quotes when needed; neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function jobCostCsv(rows: readonly JobCost[]): string {
  const header = [
    "Order #", "Title", "Client", "Project type", "Status", "Basis", "Revenue", "Materials", "Machine time",
    "Operator labor", "Overhead", "Total cost", "Profit", "Margin %", "Planned hours", "Actual hours", "Flags",
  ];
  const lines = rows.map((r) => [
    r.orderNumber, r.title, r.customer, r.projectType, r.status, r.basis,
    centsToMoney(r.revenueCents), centsToMoney(r.materialsCents), centsToMoney(r.machineCents),
    centsToMoney(r.laborCents), centsToMoney(r.overheadCents), centsToMoney(r.costCents), centsToMoney(r.profitCents),
    r.marginBps == null ? "" : (r.marginBps / 100).toFixed(1),
    (r.estimatedMinutes / 60).toFixed(1), (r.actualMinutes / 60).toFixed(1), r.flags.join(" "),
  ]);
  return [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

export function marginText(bps: number | null): string {
  return bps == null ? "—" : `${(bps / 100).toFixed(1)}%`;
}

export const FLAG_LABELS: Record<JobFlag, string> = {
  loss: "Losing money",
  "low-margin": "Margin under 10%",
  "no-revenue": "Order has no value — set it to see a margin",
  "no-materials": "No materials allocated",
  "no-time": "Finished steps with no recorded time — planned minutes used",
  "time-overrun": "Actual time is more than 15% over plan",
  "rate-missing": "A machine has no hourly rate — its time costs $0",
};
