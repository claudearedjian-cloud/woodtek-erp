"use strict";
// ============================================================================
// Auto-lock on idle — pure, client-safe helpers.
// The page keeps a "last activity" timestamp (mouse/keyboard/touch) and asks
// idleState() on a timer whether to warn and/or lock. The per-device setting
// lives in localStorage (key below) so the office PC and the floor PC can
// differ. 0 = never lock.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDLE_WARN_SEC = exports.IDLE_CHOICES = exports.DEFAULT_IDLE_MIN = exports.IDLE_STORAGE_KEY = void 0;
exports.normalizeIdleMinutes = normalizeIdleMinutes;
exports.loadIdleMinutes = loadIdleMinutes;
exports.idleState = idleState;
exports.IDLE_STORAGE_KEY = "woodtek-idle-mins";
exports.DEFAULT_IDLE_MIN = 15;
exports.IDLE_CHOICES = [
    { value: 5, label: "5 minutes" },
    { value: 10, label: "10 minutes" },
    { value: 15, label: "15 minutes (recommended)" },
    { value: 30, label: "30 minutes" },
    { value: 0, label: "Never (not recommended on shared PCs)" },
];
/** Clamp any stored value to a legal choice; default when missing/garbage. */
function normalizeIdleMinutes(v) {
    if (v == null || v === "")
        return exports.DEFAULT_IDLE_MIN; // null would coerce to 0 = never
    const legal = exports.IDLE_CHOICES.map((c) => c.value);
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && legal.includes(n) ? n : exports.DEFAULT_IDLE_MIN;
}
/** Read the saved per-device setting (never throws). */
function loadIdleMinutes(storage) {
    try {
        const s = storage ?? globalThis.localStorage;
        return normalizeIdleMinutes(s?.getItem(exports.IDLE_STORAGE_KEY));
    }
    catch {
        return exports.DEFAULT_IDLE_MIN;
    }
}
/** How long the "locking soon" warning shows before the lock fires. */
exports.IDLE_WARN_SEC = 60;
function idleState(mins, lastActivityMs, nowMs) {
    if (!Number.isFinite(mins) || mins <= 0) {
        return { enabled: false, warn: false, lock: false, remainingSec: 0 };
    }
    const totalSec = mins * 60;
    const elapsedSec = Math.max(0, (nowMs - lastActivityMs) / 1000);
    const remainingSec = Math.max(0, Math.ceil(totalSec - elapsedSec));
    return {
        enabled: true,
        warn: remainingSec <= exports.IDLE_WARN_SEC && remainingSec > 0,
        lock: remainingSec <= 0,
        remainingSec,
    };
}
