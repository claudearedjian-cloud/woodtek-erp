// Pure, client-safe HR and payroll rules. Money is represented as integer cents
// throughout; payroll adjustment lines are deliberately manual so the system
// never invents tax, contribution, overtime, or leave-deduction rules.

export const MAX_PAY_CENTS = 99_999_999;
export const LEAVE_TYPES = ["Annual", "Sick", "Unpaid", "Other"] as const;
export const LEAVE_STATUSES = ["Pending", "Approved", "Declined"] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export interface PayAdjustment {
  label: string;
  amountCents: number;
}

export interface PayrollAdjustments {
  additions: PayAdjustment[];
  deductions: PayAdjustment[];
}

export class HRPayrollError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HRPayrollError";
    this.status = status;
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveId(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HRPayrollError(`${field} must be a valid employee.`);
  return n;
}

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function inclusiveDays(from: string, to: string): number {
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) return 0;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export interface EmployeeProfileInput {
  userId: number;
  jobTitle: string;
  hireDate: string | null;
  baseSalaryCents: number;
}

export function parseEmployeeProfile(input: unknown): EmployeeProfileInput {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the employee's HR details.");
  const userId = positiveId(raw.userId, "Employee");
  const jobTitle = String(raw.jobTitle ?? "").trim();
  if (jobTitle.length > 80) throw new HRPayrollError("Job title must be 80 characters or fewer.");
  const hireDateText = String(raw.hireDate ?? "").trim();
  if (hireDateText && !isValidYmd(hireDateText)) throw new HRPayrollError("Hire date must be a real date in YYYY-MM-DD format.");
  const baseSalaryCents = Number(raw.baseSalaryCents);
  if (!Number.isSafeInteger(baseSalaryCents) || baseSalaryCents < 0 || baseSalaryCents > MAX_PAY_CENTS) {
    throw new HRPayrollError("Monthly salary must be between $0.00 and $999,999.99.");
  }
  return { userId, jobTitle, hireDate: hireDateText || null, baseSalaryCents };
}

export interface LeaveRequestInput {
  userId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
}

export function parseLeaveRequest(input: unknown): LeaveRequestInput {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the leave or absence details.");
  const userId = positiveId(raw.userId, "Employee");
  const leaveType = String(raw.leaveType ?? "") as LeaveType;
  if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) throw new HRPayrollError("Choose a valid leave type.");
  const startDate = String(raw.startDate ?? "");
  const endDate = String(raw.endDate ?? "");
  if (!isValidYmd(startDate) || !isValidYmd(endDate) || startDate > endDate) {
    throw new HRPayrollError("Choose a valid date range; the end date cannot be before the start date.");
  }
  const days = inclusiveDays(startDate, endDate);
  if (days < 1 || days > 366) throw new HRPayrollError("A leave record cannot be longer than 366 calendar days.");
  const reason = String(raw.reason ?? "").trim();
  if (reason.length > 500) throw new HRPayrollError("Notes must be 500 characters or fewer.");
  return { userId, leaveType, startDate, endDate, days, reason };
}

export function parseAdjustmentLines(input: unknown, label: string): PayAdjustment[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 20) {
    throw new HRPayrollError(`${label} may contain up to 20 lines.`);
  }
  return input.map((entry, index) => {
    const raw = recordOf(entry);
    if (!raw) throw new HRPayrollError(`${label} line ${index + 1} is incomplete.`);
    const lineLabel = String(raw.label ?? "").trim();
    const amountCents = Number(raw.amountCents);
    if (!lineLabel || lineLabel.length > 80) {
      throw new HRPayrollError(`${label} line ${index + 1} needs a description (80 characters max).`);
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_PAY_CENTS) {
      throw new HRPayrollError(`${label} line ${index + 1} must be between $0.01 and $999,999.99.`);
    }
    return { label: lineLabel, amountCents };
  });
}

export function parsePayrollAdjustments(input: unknown): PayrollAdjustments {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter valid payroll adjustments.");
  return {
    additions: parseAdjustmentLines(raw.additions, "Earnings"),
    deductions: parseAdjustmentLines(raw.deductions, "Deductions"),
  };
}

export function totalAdjustments(lines: readonly PayAdjustment[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

export function calculateNetPay(baseSalaryCents: number, adjustments: PayrollAdjustments): number {
  if (!Number.isSafeInteger(baseSalaryCents) || baseSalaryCents < 0 || baseSalaryCents > MAX_PAY_CENTS) {
    throw new HRPayrollError("The saved base salary is invalid.", 409);
  }
  const additions = totalAdjustments(adjustments.additions);
  const deductions = totalAdjustments(adjustments.deductions);
  const net = baseSalaryCents + additions - deductions;
  if (!Number.isSafeInteger(net) || net < 0 || net > MAX_PAY_CENTS) {
    throw new HRPayrollError("Payroll net pay must be between $0.00 and $999,999.99.");
  }
  return net;
}

export interface PayrollPeriod {
  year: number;
  month: number;
}

export function parsePayrollPeriod(yearValue: unknown, monthValue: unknown): PayrollPeriod {
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new HRPayrollError("Payroll year must be between 2000 and 2200.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new HRPayrollError("Payroll month must be between 1 and 12.");
  return { year, month };
}

export function payrollPeriodLabel(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "Invalid period";
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
