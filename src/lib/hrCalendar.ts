// ============================================================================
// Working calendar, public holidays and overtime rules — pure + client-safe.
// No react, no node: the same maths runs in the HR screen (live preview while
// the Manager types) and on the server (overtime amounts, leave-day counts and
// the "is this employee at work today?" gate).
//
// Money is integer cents and time is integer minutes everywhere; nothing here
// touches the database. Storage lives in <data>/hr-calendar.json (see
// hrCalendar.server.ts) — the same no-migration JSON pattern as the warehouse
// register and the HR job-title list.
// ============================================================================

import { HRPayrollError, isValidYmd, MAX_PAY_CENTS } from "@/lib/hrPayroll";

/** Sunday = 0 … Saturday = 6 (matches Date#getDay / Date#getUTCDay). */
export const WEEKDAY_LABELS = [
  { index: 0, long: "Sunday", short: "Sun" },
  { index: 1, long: "Monday", short: "Mon" },
  { index: 2, long: "Tuesday", short: "Tue" },
  { index: 3, long: "Wednesday", short: "Wed" },
  { index: 4, long: "Thursday", short: "Thu" },
  { index: 5, long: "Friday", short: "Fri" },
  { index: 6, long: "Saturday", short: "Sat" },
] as const;

export const HOLIDAY_TYPES = ["National", "Religious", "Company", "Other"] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

/** What a calendar date is, according to the saved working calendar. */
export const DAY_KINDS = ["Working", "Holiday", "Day off"] as const;
export type DayKind = (typeof DAY_KINDS)[number];

export const MAX_HOLIDAYS = 400;
export const HOLIDAY_NAME_MAX = 80;
export const HOLIDAY_NOTES_MAX = 200;
export const MAX_BREAK_MINUTES = 600;
/** Overtime cap per calendar day; 0 means "no cap". */
export const MAX_OVERTIME_MINUTES_PER_DAY = 720;

/** Lebanese-style office/factory week: Monday to Friday, 8:00 → 17:00, 1 h lunch. */
export const DEFAULT_WORK_DAYS: number[] = [1, 2, 3, 4, 5];
export const DEFAULT_WORKDAY_START = "08:00";
export const DEFAULT_WORKDAY_END = "17:00";
export const DEFAULT_BREAK_MINUTES = 60;

export interface HrHoliday {
  /** Stable id inside the JSON register (never shown to the user). */
  id: string;
  name: string;
  type: HolidayType;
  /** Inclusive first day, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive last day, YYYY-MM-DD (same as startDate for a single day). */
  endDate: string;
  /**
   * True when the holiday returns every year on the same month/day (New Year,
   * Independence Day, fixed religious feasts). False = that exact date only.
   */
  recurring: boolean;
  /** Paid holiday: shown on the calendar and in payroll notes only. */
  paid: boolean;
  notes: string;
}

export interface OvertimePolicy {
  /**
   * Explicit company rate per overtime hour in cents, or 0 to derive each
   * employee's hourly rate from their monthly salary ÷ standard monthly hours.
   */
  defaultRateCentsPerHour: number;
  /** Percentages: 150 = time-and-a-half, 200 = double time. */
  weekdayMultiplierPercent: number;
  weekendMultiplierPercent: number;
  holidayMultiplierPercent: number;
  /** Per-day overtime cap in minutes; 0 = no cap. */
  maxMinutesPerDay: number;
  /** When true, entries must be approved before payroll picks them up. */
  approvalRequired: boolean;
}

export interface LeaveAccessPolicy {
  /** Refuse sign-in (and end existing sessions) during approved leave. */
  blockLogin: boolean;
  /** Refuse assigning or processing work for someone on approved leave. */
  blockWork: boolean;
}

export interface HrCalendarConfig {
  version: 1;
  workDays: number[];
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: number;
  holidays: HrHoliday[];
  overtime: OvertimePolicy;
  leaveAccess: LeaveAccessPolicy;
}

export const DEFAULT_OVERTIME_POLICY: OvertimePolicy = {
  defaultRateCentsPerHour: 0,
  weekdayMultiplierPercent: 150,
  weekendMultiplierPercent: 150,
  holidayMultiplierPercent: 200,
  maxMinutesPerDay: 240,
  approvalRequired: true,
};

export const DEFAULT_LEAVE_ACCESS_POLICY: LeaveAccessPolicy = {
  blockLogin: true,
  blockWork: true,
};

export function defaultHrCalendar(): HrCalendarConfig {
  return {
    version: 1,
    workDays: [...DEFAULT_WORK_DAYS],
    workdayStart: DEFAULT_WORKDAY_START,
    workdayEnd: DEFAULT_WORKDAY_END,
    breakMinutes: DEFAULT_BREAK_MINUTES,
    holidays: [],
    overtime: { ...DEFAULT_OVERTIME_POLICY },
    leaveAccess: { ...DEFAULT_LEAVE_ACCESS_POLICY },
  };
}

// ---------------------------------------------------------------- time maths

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isValidHhmm(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isInteger(hours) && hours >= 0 && hours <= 23 && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59;
}

export function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToHhmm(total: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** "7.5 h" / "90 min" style label used across the HR screen. */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(Number(total) || 0));
  if (minutes === 0) return "0 h";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} h`;
  return `${hours}.${Math.round((rest / 60) * 10)} h`;
}

/** Deterministic "12 Oct 2026" — identical on the server and in the browser. */
export function ymdLabel(value: string | null | undefined): string {
  const text = String(value ?? "").slice(0, 10);
  if (!isValidYmd(text)) return "—";
  const [year, month, day] = text.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${MONTH_SHORT[month - 1]} ${year}`;
}

function utcDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

/** Calendar date (YYYY-MM-DD) of a UTC day number. */
function dayToYmd(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDaysYmd(value: string, days: number): string {
  return dayToYmd(utcDay(value) + days);
}

export function weekdayOf(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

export function weekdayLabel(value: string): string {
  return WEEKDAY_LABELS[weekdayOf(value)]?.long ?? "";
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ------------------------------------------------------------- sanitizing

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number, field: string): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > max) throw new HRPayrollError(`${field} must be ${max} characters or fewer.`);
  return text;
}

function boundedInt(value: unknown, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new HRPayrollError(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Holiday id for a new record; the caller may pass its own to keep one stable. */
export function makeHolidayId(): string {
  return `hol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeHoliday(raw: unknown, fallbackId = ""): HrHoliday | null {
  const source = recordOf(raw);
  if (!source) return null;
  const name = cleanText(source.name, HOLIDAY_NAME_MAX, "Holiday name");
  if (!name) return null;
  const type = (HOLIDAY_TYPES as readonly string[]).includes(String(source.type ?? ""))
    ? (String(source.type) as HolidayType)
    : "Other";
  const startDate = String(source.startDate ?? "").trim();
  if (!isValidYmd(startDate)) throw new HRPayrollError(`"${name}" needs a real start date in YYYY-MM-DD format.`);
  const rawEnd = String(source.endDate ?? "").trim();
  const endDate = rawEnd && isValidYmd(rawEnd) ? rawEnd : startDate;
  if (endDate < startDate) throw new HRPayrollError(`"${name}" cannot end before it starts.`);
  const span = utcDay(endDate) - utcDay(startDate) + 1;
  if (span > 30) throw new HRPayrollError(`"${name}" cannot be longer than 30 days.`);
  const id = String(source.id ?? "").trim().slice(0, 60) || fallbackId || makeHolidayId();
  return {
    id,
    name,
    type,
    startDate,
    endDate,
    recurring: flag(source.recurring, false),
    paid: flag(source.paid, true),
    notes: cleanText(source.notes, HOLIDAY_NOTES_MAX, "Holiday notes"),
  };
}

function sanitizeWorkDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORK_DAYS];
  const days = Array.from(new Set(
    value.map((entry) => Number(entry)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  )).sort((a, b) => a - b);
  if (days.length === 0) throw new HRPayrollError("Pick at least one working day.");
  if (days.length > 7) throw new HRPayrollError("A week has at most seven days.");
  return days;
}

function sanitizeDailyHours(startValue: unknown, endValue: unknown, breakValue: unknown) {
  const workdayStart = String(startValue ?? DEFAULT_WORKDAY_START).trim();
  const workdayEnd = String(endValue ?? DEFAULT_WORKDAY_END).trim();
  if (!isValidHhmm(workdayStart)) throw new HRPayrollError("Daily start time must be a real time in HH:MM format.");
  if (!isValidHhmm(workdayEnd)) throw new HRPayrollError("Daily end time must be a real time in HH:MM format.");
  if (hhmmToMinutes(workdayEnd) <= hhmmToMinutes(workdayStart)) {
    throw new HRPayrollError("The daily end time must be later than the start time.");
  }
  const breakMinutes = boundedInt(breakValue ?? DEFAULT_BREAK_MINUTES, 0, MAX_BREAK_MINUTES, "Daily break");
  if (breakMinutes >= hhmmToMinutes(workdayEnd) - hhmmToMinutes(workdayStart)) {
    throw new HRPayrollError("The daily break cannot be as long as the whole working day.");
  }
  return { workdayStart, workdayEnd, breakMinutes };
}

function sanitizeOvertimePolicy(value: unknown): OvertimePolicy {
  const source = recordOf(value) ?? {};
  const defaultRateCentsPerHour = boundedInt(
    source.defaultRateCentsPerHour ?? 0, 0, MAX_PAY_CENTS, "Default overtime rate",
  );
  const weekdayMultiplierPercent = boundedInt(source.weekdayMultiplierPercent ?? 150, 100, 1000, "Weekday overtime multiplier");
  const weekendMultiplierPercent = boundedInt(source.weekendMultiplierPercent ?? 150, 100, 1000, "Day-off overtime multiplier");
  const holidayMultiplierPercent = boundedInt(source.holidayMultiplierPercent ?? 200, 100, 1000, "Holiday overtime multiplier");
  const maxMinutesPerDayRaw = boundedInt(source.maxMinutesPerDay ?? 240, 0, MAX_OVERTIME_MINUTES_PER_DAY, "Daily overtime cap");
  const maxMinutesPerDay = maxMinutesPerDayRaw === 0 ? 0 : Math.max(15, maxMinutesPerDayRaw);
  return {
    defaultRateCentsPerHour,
    weekdayMultiplierPercent,
    weekendMultiplierPercent,
    holidayMultiplierPercent,
    maxMinutesPerDay,
    approvalRequired: flag(source.approvalRequired, true),
  };
}

function sanitizeLeaveAccess(value: unknown): LeaveAccessPolicy {
  const source = recordOf(value) ?? {};
  return {
    blockLogin: flag(source.blockLogin, true),
    blockWork: flag(source.blockWork, true),
  };
}

/**
 * Full calendar from untrusted input (API body or saved JSON file). Anything
 * missing falls back to the factory default; anything impossible throws an
 * HRPayrollError the route turns into a 400 with the Manager-readable reason.
 */
export function sanitizeHrCalendar(input: unknown): HrCalendarConfig {
  const source = recordOf(input) ?? {};
  const { workdayStart, workdayEnd, breakMinutes } = sanitizeDailyHours(
    source.workdayStart, source.workdayEnd, source.breakMinutes,
  );
  const rawHolidays = Array.isArray(source.holidays) ? source.holidays : [];
  if (rawHolidays.length > MAX_HOLIDAYS) throw new HRPayrollError(`At most ${MAX_HOLIDAYS} holidays can be kept.`);
  const holidays: HrHoliday[] = [];
  const seen = new Set<string>();
  for (const entry of rawHolidays) {
    const holiday = sanitizeHoliday(entry);
    if (!holiday) continue;
    const key = `${holiday.startDate}|${holiday.endDate}|${holiday.name.toLowerCase()}|${holiday.recurring ? "r" : "o"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    holidays.push(holiday);
  }
  holidays.sort((a, b) => (a.startDate === b.startDate ? a.name.localeCompare(b.name) : a.startDate < b.startDate ? -1 : 1));
  return {
    version: 1,
    workDays: sanitizeWorkDays(source.workDays),
    workdayStart,
    workdayEnd,
    breakMinutes,
    holidays,
    overtime: sanitizeOvertimePolicy(source.overtime),
    leaveAccess: sanitizeLeaveAccess(source.leaveAccess),
  };
}

// ------------------------------------------------------------ calendar rules

/** Paid minutes an employee is expected to work on one working day. */
export function standardDailyMinutes(calendar: Pick<HrCalendarConfig, "workdayStart" | "workdayEnd" | "breakMinutes">): number {
  return Math.max(0, hhmmToMinutes(calendar.workdayEnd) - hhmmToMinutes(calendar.workdayStart) - calendar.breakMinutes);
}

export function standardDailyHours(calendar: Pick<HrCalendarConfig, "workdayStart" | "workdayEnd" | "breakMinutes">): number {
  return standardDailyMinutes(calendar) / 60;
}

/** The saved holiday covering a date (recurring ones repeat every year). */
export function holidayOn(value: string, holidays: readonly HrHoliday[]): HrHoliday | null {
  if (!isValidYmd(value)) return null;
  const day = utcDay(value);
  const year = Number(value.slice(0, 4));
  for (const holiday of holidays) {
    if (!holiday.recurring) {
      if (day >= utcDay(holiday.startDate) && day <= utcDay(holiday.endDate)) return holiday;
      continue;
    }
    // Anniversary in the requested year; a 29 Feb feast falls back to 28 Feb.
    const monthDay = holiday.startDate.slice(5);
    let anniversary = `${year}-${monthDay}`;
    if (!isValidYmd(anniversary)) anniversary = `${year}-02-28`;
    const span = utcDay(holiday.endDate) - utcDay(holiday.startDate);
    if (day >= utcDay(anniversary) && day <= utcDay(anniversary) + span) return holiday;
  }
  return null;
}

export function isHoliday(value: string, calendar: Pick<HrCalendarConfig, "holidays">): boolean {
  return holidayOn(value, calendar.holidays) != null;
}

export function isScheduledWorkDay(value: string, calendar: Pick<HrCalendarConfig, "workDays">): boolean {
  return isValidYmd(value) && calendar.workDays.includes(weekdayOf(value));
}

/** Working = a scheduled day that is not a public holiday. */
export function isWorkingDay(value: string, calendar: Pick<HrCalendarConfig, "workDays" | "holidays">): boolean {
  return isScheduledWorkDay(value, calendar) && !isHoliday(value, calendar);
}

export function dayKind(value: string, calendar: Pick<HrCalendarConfig, "workDays" | "holidays">): DayKind {
  if (!isValidYmd(value)) return "Day off";
  if (isHoliday(value, calendar)) return "Holiday";
  return isScheduledWorkDay(value, calendar) ? "Working" : "Day off";
}

/** Inclusive count of working days between two dates (0 for an invalid range). */
export function workingDaysBetween(from: string, to: string, calendar: Pick<HrCalendarConfig, "workDays" | "holidays">): number {
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) return 0;
  let count = 0;
  for (let day = utcDay(from); day <= utcDay(to); day += 1) {
    if (isWorkingDay(dayToYmd(day), calendar)) count += 1;
  }
  return count;
}

/** Inclusive count of scheduled days (weekends excluded, holidays included). */
export function scheduledDaysBetween(from: string, to: string, calendar: Pick<HrCalendarConfig, "workDays">): number {
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) return 0;
  let count = 0;
  for (let day = utcDay(from); day <= utcDay(to); day += 1) {
    if (isScheduledWorkDay(dayToYmd(day), calendar)) count += 1;
  }
  return count;
}

export function workingDaysInMonth(year: number, month: number, calendar: Pick<HrCalendarConfig, "workDays" | "holidays">): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let day = 1; day <= total; day += 1) {
    if (isWorkingDay(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, calendar)) count += 1;
  }
  return count;
}

export function standardMonthlyMinutes(year: number, month: number, calendar: HrCalendarConfig): number {
  return workingDaysInMonth(year, month, calendar) * standardDailyMinutes(calendar);
}

export function standardMonthlyHours(year: number, month: number, calendar: HrCalendarConfig): number {
  return standardMonthlyMinutes(year, month, calendar) / 60;
}

/** Holidays falling inside a month, for the calendar preview list. */
export function holidaysInMonth(year: number, month: number, calendar: Pick<HrCalendarConfig, "holidays">): Array<{ date: string; holiday: HrHoliday }> {
  const total = daysInMonth(year, month);
  const out: Array<{ date: string; holiday: HrHoliday }> = [];
  for (let day = 1; day <= total; day += 1) {
    const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const holiday = holidayOn(value, calendar.holidays);
    if (holiday) out.push({ date: value, holiday });
  }
  return out;
}

/** "Mon–Fri · 08:00–17:00 (8 h/day)" — one-line summary of the saved rules. */
export function describeCalendar(calendar: HrCalendarConfig): string {
  const days = calendar.workDays.map((index) => WEEKDAY_LABELS[index]?.short ?? "").filter(Boolean);
  const dayText = days.length === 7
    ? "every day"
    : days.length > 2 && isContiguous(calendar.workDays)
      ? `${days[0]}–${days[days.length - 1]}`
      : days.join(", ");
  return `${dayText} · ${calendar.workdayStart}–${calendar.workdayEnd} (${formatMinutes(standardDailyMinutes(calendar))}/day)`;
}

function isContiguous(days: readonly number[]): boolean {
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
}

// ----------------------------------------------------------- overtime maths

/** Percentage applied to the base hourly rate for a kind of day. */
export function overtimeMultiplierPercent(dayKindValue: DayKind, policy: OvertimePolicy): number {
  if (dayKindValue === "Holiday") return policy.holidayMultiplierPercent;
  if (dayKindValue === "Day off") return policy.weekendMultiplierPercent;
  return policy.weekdayMultiplierPercent;
}

/**
 * Hourly rate used to derive overtime when the company has no explicit rate:
 * monthly salary ÷ the standard hours of that month (working days × daily
 * hours). Returns 0 when the calendar or the salary cannot produce a rate.
 */
export function derivedHourlyRateCents(baseSalaryCents: number, year: number, month: number, calendar: HrCalendarConfig): number {
  const salary = Number(baseSalaryCents);
  if (!Number.isFinite(salary) || salary <= 0) return 0;
  const hours = standardMonthlyHours(year, month, calendar);
  if (hours <= 0) return 0;
  return Math.round(salary / hours);
}

/** Rate per hour for one overtime entry: explicit rate wins, else derived. */
export function overtimeRateCentsPerHour(
  dayKindValue: DayKind,
  baseRateCentsPerHour: number,
  policy: OvertimePolicy,
): number {
  const base = Number(baseRateCentsPerHour);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const multiplier = overtimeMultiplierPercent(dayKindValue, policy);
  const rate = Math.round((base * multiplier) / 100);
  return Math.max(0, Math.min(MAX_PAY_CENTS, rate));
}

/** Integer cents for `minutes` of overtime at an hourly rate. */
export function overtimeAmountCents(minutes: number, rateCentsPerHour: number): number {
  const time = Number(minutes);
  const rate = Number(rateCentsPerHour);
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, Math.min(MAX_PAY_CENTS, Math.round((time * rate) / 60)));
}

/** Minutes between two HH:MM times on the same day (0 when invalid/reversed). */
export function minutesBetweenTimes(start: string, end: string): number {
  if (!isValidHhmm(start) || !isValidHhmm(end)) return 0;
  return Math.max(0, hhmmToMinutes(end) - hhmmToMinutes(start));
}

/**
 * Overtime minutes inside a time range: only the part beyond the standard
 * daily hours counts, and the unpaid break is skipped when the shift covers it.
 */
export function overtimeMinutesInRange(
  start: string,
  end: string,
  calendar: Pick<HrCalendarConfig, "workdayStart" | "workdayEnd" | "breakMinutes">,
): number {
  const worked = minutesBetweenTimes(start, end);
  if (worked <= 0) return 0;
  const from = hhmmToMinutes(start);
  const to = hhmmToMinutes(end);
  const dayStart = hhmmToMinutes(calendar.workdayStart);
  const dayEnd = hhmmToMinutes(calendar.workdayEnd);
  // Minutes of the range that fall inside the normal (paid) window.
  const insideFrom = Math.max(from, dayStart);
  const insideTo = Math.min(to, dayEnd);
  const normalMinutes = Math.max(0, insideTo - insideFrom);
  // Subtract the break only when the range really covers the end of the day.
  const breakMinutes = to >= dayEnd && from <= dayEnd - calendar.breakMinutes ? calendar.breakMinutes : 0;
  return Math.max(0, worked - Math.max(0, normalMinutes - breakMinutes));
}

// -------------------------------------------------------- leave-aware labels

/** Lower-case leave wording used inside sentences: "annual leave". */
export function leaveTypePhrase(leaveType: string): string {
  switch (String(leaveType ?? "")) {
    case "Annual": return "annual leave";
    case "Sick": return "sick leave";
    case "Unpaid": return "unpaid leave";
    default: return "approved leave";
  }
}

export interface LeaveBlockInfo {
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}

/**
 * The prompt every blocked action shows: "Rami is on annual leave until
 * 12 Oct 2026 …". One wording for login, assignment and processing so the
 * shop floor hears the same sentence everywhere.
 */
export function leaveBlockMessage(info: LeaveBlockInfo, action: "login" | "assign" | "process" = "assign"): string {
  const name = String(info.employeeName ?? "").trim() || "This employee";
  const phrase = leaveTypePhrase(info.leaveType);
  const until = ymdLabel(info.endDate);
  if (action === "login") {
    return `${name} is on ${phrase} until ${until}. Sign-in is blocked while the leave is approved.`;
  }
  if (action === "process") {
    return `${name} is on ${phrase} until ${until}. Work cannot be started, processed or reported for an employee on leave — reassign this task or decline the leave first.`;
  }
  return `${name} is on ${phrase} until ${until}. Work cannot be assigned to an employee on leave — pick someone else or decline the leave first.`;
}
