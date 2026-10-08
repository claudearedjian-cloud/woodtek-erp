// ============================================================================
// Leave availability for the client — pure helpers + one tiny fetch.
//
// Every screen that hands work to a person (shift planner, station crew,
// machine roster) reads /api/hr/availability for the day it is planning and
// marks that person BEFORE the save is attempted, so the supervisor gets the
// prompt "… is on annual leave until 12 Oct 2026" instead of a bare 409 after
// the fact. The server gate stays authoritative: this file only improves the
// conversation, it never authorizes anything.
// ============================================================================

export interface LeaveAvailabilityEntry {
  userId: number;
  employeeName: string;
  /** "Annual" | "Sick" | "Unpaid" | "Other" — the type is shown, never notes. */
  leaveType: string;
  startDate: string;
  endDate: string;
  /** Ready-made sentence from the server, identical to the API refusal. */
  message: string;
}

/** Approved-leave list for one day (defaults to today on the server). */
export async function fetchLeaveAvailability(date?: string): Promise<LeaveAvailabilityEntry[]> {
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`/api/hr/availability${query}`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json().catch(() => ({}))) as { onLeave?: unknown };
    if (!Array.isArray(body.onLeave)) return [];
    return body.onLeave.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const userId = Number(row.userId);
      if (!Number.isInteger(userId) || userId <= 0) return [];
      return [{
        userId,
        employeeName: String(row.employeeName ?? ""),
        leaveType: String(row.leaveType ?? ""),
        startDate: String(row.startDate ?? ""),
        endDate: String(row.endDate ?? ""),
        message: String(row.message ?? ""),
      }];
    });
  } catch {
    return [];
  }
}

/** userId → entry, for O(1) lookups inside a picker. */
export function leaveAvailabilityMap(entries: readonly LeaveAvailabilityEntry[]): Map<number, LeaveAvailabilityEntry> {
  return new Map(entries.map((entry) => [entry.userId, entry]));
}

export function leaveEntryFor(
  entries: readonly LeaveAvailabilityEntry[],
  userId: unknown,
): LeaveAvailabilityEntry | null {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return entries.find((entry) => entry.userId === id) ?? null;
}

/** Lower-case wording used inside a sentence: "annual leave". */
export function leavePhrase(leaveType: string): string {
  switch (String(leaveType ?? "")) {
    case "Annual": return "annual leave";
    case "Sick": return "sick leave";
    case "Unpaid": return "unpaid leave";
    default: return "approved leave";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic "12 Oct 2026" so the label matches the server's wording. */
export function leaveDateText(value: string): string {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const [year, month, day] = text.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
}

/** Dropdown suffix: " — on annual leave until 12 Oct 2026". */
export function leaveOptionSuffix(entry: LeaveAvailabilityEntry | null): string {
  if (!entry) return "";
  return ` — on ${leavePhrase(entry.leaveType)} until ${leaveDateText(entry.endDate)}`;
}

/** The prompt shown when somebody picks an employee who is on leave. */
export function leavePrompt(entry: LeaveAvailabilityEntry | null, fallbackName = "This employee"): string {
  if (!entry) return "";
  const name = entry.employeeName || fallbackName;
  return `${name} is on ${leavePhrase(entry.leaveType)} until ${leaveDateText(entry.endDate)}. `
    + "Work cannot be assigned to an employee on leave — pick someone else, or HR can decline the leave first.";
}
