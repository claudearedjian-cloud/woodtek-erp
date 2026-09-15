// ============================================================================
// Downtime reason codes + Pareto analysis — pure, client-safe.
// The reason code list matches the Downtime Log's start form and the values
// already stored in the downtime_events.reason column (no migration).
// Legacy/free-text reasons are bucketed into the closest known code so the
// Pareto never fragments.
// ============================================================================

export const DOWNTIME_REASON_CODES = [
  "Mechanical Failure",
  "Electrical Fault",
  "Material Shortage",
  "Setup & Changeover",
  "Operator Unavailable",
  "Quality Issue",
  "Other",
] as const;

export type DowntimeReason = (typeof DOWNTIME_REASON_CODES)[number];

// Loose keyword buckets for historical free-text reasons.
const KEYWORD_BUCKETS: [RegExp, DowntimeReason][] = [
  [/mech|bear|motor|belt|hydraul|pneumat|spindle|gear|leak/i, "Mechanical Failure"],
  [/elec|power|volt|wire|cable|fuse|short|breaker/i, "Electrical Fault"],
  [/material|stock|supply|wood|panel|edge|waiting.*mat|no mat/i, "Material Shortage"],
  [/setup|changeover|change.?over|tool|jig|fixtur|program|calibr/i, "Setup & Changeover"],
  [/operator|absent|absence|staff|crew|unavailable|break|lunch/i, "Operator Unavailable"],
  [/qual|reject|rework|scrap|qc|inspect/i, "Quality Issue"],
];

export function normalizeReason(reason: string | null | undefined): DowntimeReason {
  const raw = String(reason ?? "").trim();
  if (!raw) return "Other";
  const exact = DOWNTIME_REASON_CODES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  for (const [re, bucket] of KEYWORD_BUCKETS) {
    if (re.test(raw)) return bucket;
  }
  return "Other";
}

export interface DowntimeEventLike {
  reason: string;
  durationMinutes: number | null;
  startedAt: string | Date;
  endedAt?: string | Date | null;
}

export interface ParetoRow {
  reason: DowntimeReason;
  events: number;
  minutes: number;
  share: number; // % of total downtime minutes, 0-100
  cumulative: number; // running % across rows, 0-100
  band: "A" | "B"; // A = causes inside the first 80% of downtime
}

export interface ParetoResult {
  rows: ParetoRow[];
  totalMinutes: number;
  totalEvents: number;
}

/**
 * Pareto table of downtime minutes per reason code.
 * `days` limits the window to the last N days (null/undefined = all time).
 * Open (not yet ended) stoppages are counted with their running time so a
 * long ongoing breakdown shows up immediately.
 */
export function buildPareto(
  events: DowntimeEventLike[],
  days?: number | null,
  now: Date = new Date(),
): ParetoResult {
  const cutoff =
    days && days > 0 ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000).getTime() : null;
  const buckets = new Map<DowntimeReason, { events: number; minutes: number }>();
  for (const e of events) {
    const start = new Date(e.startedAt).getTime();
    if (Number.isNaN(start)) continue;
    if (cutoff != null && start < cutoff) continue;
    const minutes =
      Math.max(0, Math.floor(Number(e.durationMinutes) || 0)) ||
      (e.endedAt ? 0 : Math.max(0, Math.round((now.getTime() - start) / 60000)));
    const key = normalizeReason(e.reason);
    const b = buckets.get(key) ?? { events: 0, minutes: 0 };
    b.events += 1;
    b.minutes += minutes;
    buckets.set(key, b);
  }
  const totalMinutes = [...buckets.values()].reduce((s, b) => s + b.minutes, 0);
  const totalEvents = [...buckets.values()].reduce((s, b) => s + b.events, 0);
  const sorted = DOWNTIME_REASON_CODES.map((reason) => ({
    reason,
    ...(buckets.get(reason) ?? { events: 0, minutes: 0 }),
  }))
    .filter((r) => r.events > 0)
    .sort((a, b) => b.minutes - a.minutes || b.events - a.events);
  let running = 0;
  const rows: ParetoRow[] = sorted.map((r) => {
    const share = totalMinutes > 0 ? (r.minutes / totalMinutes) * 100 : 0;
    // Classic Pareto: a row is band A when it starts before the 80% line is
    // crossed — including the row that actually crosses it.
    const band: "A" | "B" = running < 80 ? "A" : "B";
    running += share;
    return {
      reason: r.reason,
      events: r.events,
      minutes: r.minutes,
      share: Math.round(share * 10) / 10,
      cumulative: Math.round(Math.min(100, running) * 10) / 10,
      band,
    };
  });
  return { rows, totalMinutes, totalEvents };
}

/** CSV export for the Pareto table. */
export function paretoToCsv(result: ParetoResult): string {
  const head = "Reason,Events,DowntimeMinutes,SharePercent,CumulativePercent,Band";
  const lines = result.rows.map((r) =>
    [r.reason, r.events, r.minutes, r.share, r.cumulative, r.band].join(","),
  );
  const totals = `TOTAL,${result.totalEvents},${result.totalMinutes},100,100,`;
  return [head, ...lines, totals].join("\n");
}
