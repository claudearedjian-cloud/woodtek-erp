// ============================================================================
// Auto-lock on idle — pure, client-safe helpers.
// The page keeps a "last activity" timestamp (mouse/keyboard/touch) and asks
// idleState() on a timer whether to warn and/or lock. The per-device setting
// lives in localStorage (key below) so the office PC and the floor PC can
// differ. 0 = never lock.
// ============================================================================

export const IDLE_STORAGE_KEY = "woodtek-idle-mins";
export const DEFAULT_IDLE_MIN = 15;
export const IDLE_CHOICES: { value: number; label: string }[] = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes (recommended)" },
  { value: 30, label: "30 minutes" },
  { value: 0, label: "Never (not recommended on shared PCs)" },
];

/** Clamp any stored value to a legal choice; default when missing/garbage. */
export function normalizeIdleMinutes(v: unknown): number {
  if (v == null || v === "") return DEFAULT_IDLE_MIN; // null would coerce to 0 = never
  const legal = IDLE_CHOICES.map((c) => c.value);
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && legal.includes(n) ? n : DEFAULT_IDLE_MIN;
}

/** Read the saved per-device setting (never throws). */
export function loadIdleMinutes(storage?: {
  getItem: (k: string) => string | null;
}): number {
  try {
    const s = storage ?? globalThis.localStorage;
    return normalizeIdleMinutes(s?.getItem(IDLE_STORAGE_KEY));
  } catch {
    return DEFAULT_IDLE_MIN;
  }
}

export interface IdleStatus {
  enabled: boolean;
  warn: boolean; // ~60s or less before the lock
  lock: boolean; // threshold reached
  remainingSec: number; // seconds until lock (0 when disabled)
}

/** How long the "locking soon" warning shows before the lock fires. */
export const IDLE_WARN_SEC = 60;

export function idleState(mins: number, lastActivityMs: number, nowMs: number): IdleStatus {
  if (!Number.isFinite(mins) || mins <= 0) {
    return { enabled: false, warn: false, lock: false, remainingSec: 0 };
  }
  const totalSec = mins * 60;
  const elapsedSec = Math.max(0, (nowMs - lastActivityMs) / 1000);
  const remainingSec = Math.max(0, Math.ceil(totalSec - elapsedSec));
  return {
    enabled: true,
    warn: remainingSec <= IDLE_WARN_SEC && remainingSec > 0,
    lock: remainingSec <= 0,
    remainingSec,
  };
}
