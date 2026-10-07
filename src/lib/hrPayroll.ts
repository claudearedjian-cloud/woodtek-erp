// Pure, client-safe HR and payroll rules. Money is represented as integer cents
// throughout; payroll adjustment lines are deliberately manual so the system
// never invents tax, contribution, overtime, or leave-deduction rules.

export const MAX_PAY_CENTS = 99_999_999;
export const LEAVE_TYPES = ["Annual", "Sick", "Unpaid", "Other"] as const;
export const LEAVE_STATUSES = ["Pending", "Approved", "Declined"] as const;

// --- Employee card master data -------------------------------------------
// Genders, marital states, employment states, document kinds and the default
// job-description list (Manager-editable via HR > Employees > Job titles).
export const HR_GENDERS = ["Male", "Female"] as const;
export const HR_MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"] as const;
export const HR_BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const HR_EMPLOYMENT_STATUSES = ["Active", "Probation", "On Leave", "Inactive", "Terminated"] as const;
export const HR_DOCUMENT_TYPES = [
  "Identity Card",
  "Passport",
  "Visa",
  "Residency Permit",
  "Work Permit",
  "Contract",
  "Certificate",
  "Other",
] as const;

export type HrGender = (typeof HR_GENDERS)[number];
export type HrMaritalStatus = (typeof HR_MARITAL_STATUSES)[number];
export type HrEmploymentStatus = (typeof HR_EMPLOYMENT_STATUSES)[number];
export type HrDocumentType = (typeof HR_DOCUMENT_TYPES)[number];

/** Factory-floor default job descriptions for staff without a system role. */
export const DEFAULT_JOB_TITLES = [
  "Worker",
  "Cleaner",
  "Driver",
  "Security Guard",
  "Carpenter",
  "Painter",
  "Helper",
  "Storekeeper",
  "Foreman",
  "Electrician",
] as const;

export const MAX_JOB_TITLES = 60;
export const MAX_JOB_TITLE_LEN = 60;

/** Common nationalities for the HR datalist (free text is always allowed). */
export const COMMON_NATIONALITIES = [
  "Lebanese",
  "Syrian",
  "Palestinian",
  "Egyptian",
  "Iraqi",
  "Jordanian",
  "Turkish",
  "Bangladeshi",
  "Indian",
  "Pakistani",
  "Sri Lankan",
  "Nepalese",
  "Ethiopian",
  "Filipino",
] as const;

/** Department suggestions for the HR datalist (free text is always allowed). */
export const HR_DEPARTMENTS = [
  "Production",
  "Warehouse",
  "Maintenance",
  "Quality",
  "Dispatch",
  "Office",
  "Sales",
  "Management",
] as const;

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
  // --- Employee card: identity & employment ---
  employeeCode: string;
  department: string;
  employmentStatus: string;
  nationality: string;
  dateOfBirth: string | null;
  gender: string;
  maritalStatus: string;
  phone: string;
  address: string;
  // --- Employee card: civil / residency papers ---
  idNumber: string;
  passportNumber: string;
  visaNumber: string;
  residencyNumber: string;
  residencyExpiry: string | null;
  // --- Employee card: emergency & notes ---
  emergencyContactName: string;
  emergencyContactPhone: string;
  bloodType: string;
  religion: string;
  socialSecurityNumber: string;
  bankName: string;
  iban: string;
  notes: string;
}

function cappedText(value: unknown, max: number, field: string): string {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new HRPayrollError(`${field} must be ${max} characters or fewer.`);
  return text;
}

function optionalYmd(value: unknown, field: string): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!isValidYmd(text)) throw new HRPayrollError(`${field} must be a real date in YYYY-MM-DD format.`);
  return text;
}

function optionalEnum(value: unknown, allowed: readonly string[], field: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!allowed.includes(text)) throw new HRPayrollError(`${field} is not a valid choice.`);
  return text;
}

export function parseEmployeeProfile(input: unknown): EmployeeProfileInput {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the employee's HR details.");
  const userId = positiveId(raw.userId, "Employee");
  const jobTitle = cappedText(raw.jobTitle, 80, "Job title");
  const hireDate = optionalYmd(raw.hireDate, "Hire date");
  const baseSalaryCents = Number(raw.baseSalaryCents);
  if (!Number.isSafeInteger(baseSalaryCents) || baseSalaryCents < 0 || baseSalaryCents > MAX_PAY_CENTS) {
    throw new HRPayrollError("Monthly salary must be between $0.00 and $999,999.99.");
  }
  return {
    userId,
    jobTitle,
    hireDate,
    baseSalaryCents,
    employeeCode: cappedText(raw.employeeCode, 30, "Employee code"),
    department: cappedText(raw.department, 60, "Department"),
    employmentStatus: cappedText(raw.employmentStatus, 30, "Employment status"),
    nationality: cappedText(raw.nationality, 60, "Nationality"),
    dateOfBirth: optionalYmd(raw.dateOfBirth, "Date of birth"),
    gender: optionalEnum(raw.gender, HR_GENDERS, "Gender"),
    maritalStatus: optionalEnum(raw.maritalStatus, HR_MARITAL_STATUSES, "Marital status"),
    phone: cappedText(raw.phone, 30, "Phone"),
    address: cappedText(raw.address, 200, "Address"),
    idNumber: cappedText(raw.idNumber, 60, "ID number"),
    passportNumber: cappedText(raw.passportNumber, 60, "Passport number"),
    visaNumber: cappedText(raw.visaNumber, 60, "Visa number"),
    residencyNumber: cappedText(raw.residencyNumber, 60, "Residency number"),
    residencyExpiry: optionalYmd(raw.residencyExpiry, "Residency expiry"),
    emergencyContactName: cappedText(raw.emergencyContactName, 80, "Emergency contact"),
    emergencyContactPhone: cappedText(raw.emergencyContactPhone, 30, "Emergency phone"),
    bloodType: optionalEnum(raw.bloodType, HR_BLOOD_TYPES, "Blood type"),
    religion: cappedText(raw.religion, 60, "Religion"),
    socialSecurityNumber: cappedText(raw.socialSecurityNumber, 40, "Social security number"),
    bankName: cappedText(raw.bankName, 80, "Bank name"),
    iban: cappedText(raw.iban, 40, "IBAN / account number"),
    notes: cappedText(raw.notes, 1000, "HR notes"),
  };
}

/** One salary-history ledger row: what the monthly salary became, and since when. */
export interface SalaryHistoryInput {
  userId: number;
  effectiveDate: string;
  monthlyAmountCents: number;
  note: string;
}

export function parseSalaryHistoryEntry(input: unknown): SalaryHistoryInput {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the salary change details.");
  const userId = positiveId(raw.userId, "Employee");
  const effectiveDate = String(raw.effectiveDate ?? "").trim();
  if (!isValidYmd(effectiveDate)) {
    throw new HRPayrollError("Effective date must be a real date in YYYY-MM-DD format.");
  }
  const monthlyAmountCents = Number(raw.monthlyAmountCents);
  if (!Number.isSafeInteger(monthlyAmountCents) || monthlyAmountCents < 0 || monthlyAmountCents > MAX_PAY_CENTS) {
    throw new HRPayrollError("Monthly salary must be between $0.00 and $999,999.99.");
  }
  return { userId, effectiveDate, monthlyAmountCents, note: cappedText(raw.note, 200, "Note") };
}

/** Placeholder domain for HR-only employees created without an e-mail. */
export const NO_LOGIN_EMAIL_DOMAIN = "no-login.local";

export interface NoLoginIdentity {
  name: string;
  email: string;
}

/**
 * Identity of an HR-only employee (no sign-in): a display name is required,
 * the e-mail is optional — the server mints a unique placeholder when empty.
 */
export function parseNoLoginIdentity(input: unknown): NoLoginIdentity {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the employee's name.");
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new HRPayrollError("Enter the employee's name.");
  if (name.length > 120) throw new HRPayrollError("Name must be 120 characters or fewer.");
  const email = String(raw.email ?? "").trim().toLowerCase();
  if (email.length > 120) throw new HRPayrollError("E-mail must be 120 characters or fewer.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HRPayrollError("Enter a valid e-mail address or leave it empty.");
  }
  return { name, email };
}

/**
 * Editable job-description list (HR > Employees > Job titles). Accepts the raw
 * API body / file content and returns a clean, de-duplicated list. Free text
 * stays allowed in the profile itself — this list is only the suggestions.
 */
export function parseJobTitles(input: unknown): string[] {
  const raw = recordOf(input);
  const list = raw ? raw.titles ?? raw.jobTitles ?? input : input;
  if (!Array.isArray(list)) throw new HRPayrollError("Job titles must be a list.");
  if (list.length > MAX_JOB_TITLES) throw new HRPayrollError(`At most ${MAX_JOB_TITLES} job titles can be kept.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const title = String(entry ?? "").trim().replace(/\s+/g, " ");
    if (!title || title.length > MAX_JOB_TITLE_LEN) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
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
