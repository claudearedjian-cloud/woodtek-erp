"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ArrowRight,
  Delete,
  ShieldCheck,
  X,
  Mail,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import BrandMark from "@/components/BrandMark";

interface AuthGateProps {
  users: any[];
  initialUser?: any;
  required: boolean;
  onAuthenticated: (user: any) => void;
  onCancel?: () => void;
  demoMode?: boolean;
}

export default function AuthGate({ users, initialUser, required, onAuthenticated, onCancel, demoMode = false }: AuthGateProps) {
  const [selectedId, setSelectedId] = useState<number | null>(initialUser?.id || null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // First-run owner setup (shown only while the roster is empty)
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [ownerPinConfirm, setOwnerPinConfirm] = useState("");

  useEffect(() => {
    if (initialUser?.id) {
      setSelectedId(initialUser.id);
    } else if (!selectedId && users.length > 0) {
      const defaultUser = users.find(u => u.role === "Manager") || users[0];
      setSelectedId(defaultUser.id);
    }
  }, [initialUser, users, selectedId]);

  const selected = users.find(user => user.id === selectedId) || users[0];

  const authenticateWithPin = useCallback(async (targetPin: string, targetUserId?: number | null) => {
    if (targetPin.length !== 4) {
      setError("Please enter all four PIN digits.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUserId || selectedId, pin: targetPin }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Authentication failed.");
      onAuthenticated(payload.user);
    } catch (authError) {
      setPin("");
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }, [selectedId, onAuthenticated]);

  // Handle physical keyboard input
  useEffect(() => {
    // The first-run form uses normal inputs; do not intercept its keystrokes.
    if (users.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (submitting) return;
      if (e.key >= "0" && e.key <= "9") {
        setPin(prev => {
          const next = (prev + e.key).slice(0, 4);
          if (next.length === 4) {
            setTimeout(() => authenticateWithPin(next, selectedId), 50);
          }
          return next;
        });
        setError("");
      } else if (e.key === "Backspace") {
        setPin(prev => prev.slice(0, -1));
        setError("");
      } else if (e.key === "Enter" && pin.length === 4) {
        authenticateWithPin(pin, selectedId);
      } else if (e.key === "Escape" && !required && onCancel) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submitting, pin, selectedId, authenticateWithPin, required, onCancel, users.length]);

  const addDigit = (digit: string) => {
    if (pin.length < 4) {
      const next = pin + digit;
      setPin(next);
      setError("");
      if (next.length === 4) {
        setTimeout(() => authenticateWithPin(next, selectedId), 50);
      }
    }
  };

  const DEMO_PINS: Record<string, string> = {
    Manager: "1001",
    "Machine Operator": "2002",
  };

  const createOwner = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (ownerPin !== ownerPinConfirm) {
      setError("PIN confirmation does not match.");
      return;
    }
    if (!/^\d{4}$/.test(ownerPin)) {
      setError("Owner PIN must be exactly four digits.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ownerName, email: ownerEmail, pin: ownerPin }),
      });

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : { error: `Server returned status ${response.status}.` };

      if (!response.ok) throw new Error(payload.error || "Owner setup failed.");
      onAuthenticated(payload.user);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Owner setup failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // A brand-new installation has no roster. Show setup, not a broken login.
  if (users.length === 0) {
    return (
      <div className="modal-backdrop fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
        <div className="my-auto w-full max-w-xl overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60">
          <div className="border-b border-slate-800 bg-slate-950/80 px-6 py-5">
            <div className="flex items-center gap-3">
              <BrandMark size={44} />
              <div>
                <h2 className="text-lg font-black text-white">Create Factory Owner</h2>
                <p className="text-xs text-slate-400">First-run setup · creates the only initial Manager account</p>
              </div>
            </div>
          </div>

          <form onSubmit={createOwner} className="space-y-5 p-6">
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3 text-xs leading-relaxed text-blue-100">
              <ShieldCheck className="mr-1 inline h-4 w-4 text-blue-300" />
              No staff accounts exist yet. Create the Owner account below. This setup closes permanently after the first account is created.
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="owner-name" className="mb-1.5 block text-xs font-bold text-slate-300">Owner full name</label>
              <input
                id="owner-name"
                type="text"
                required
                minLength={2}
                autoComplete="name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="owner-email" className="mb-1.5 block text-xs font-bold text-slate-300">Owner email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="owner-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@factory.local"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="owner-pin" className="mb-1.5 block text-xs font-bold text-slate-300">Choose 4-digit PIN</label>
                <input
                  id="owner-pin"
                  type="password"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={ownerPin}
                  onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="owner-pin-confirm" className="mb-1.5 block text-xs font-bold text-slate-300">Confirm PIN</label>
                <input
                  id="owner-pin-confirm"
                  type="password"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={ownerPinConfirm}
                  onChange={(e) => setOwnerPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Avoid 0000, 1111, 1234 and 9999. You can add operators, technicians and other managers later under General Settings.
            </p>

            <button
              type="submit"
              disabled={submitting || ownerPin.length !== 4 || ownerPinConfirm.length !== 4}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {submitting ? "Creating secure owner account…" : "Create Owner & Open ERP"}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
      <div className="my-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-5">
          <div className="flex items-center gap-3">
            <BrandMark size={44} />
            <div>
              <h2 className="text-lg font-black text-white">{required ? "WoodTek ERP Sign In" : "Authorize Role Switch"}</h2>
              <p className="text-xs text-slate-400">
                {demoMode ? "Choose a demo mode or sign in with your employee PIN." : "Select your profile and enter your personal shop PIN."}
              </p>
            </div>
          </div>
          {!required && onCancel && (
            <button onClick={onCancel} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white" aria-label="Cancel role switch">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1.25fr_0.75fr]">
          <div>
            <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">Or sign in as a specific employee</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {users.map(user => (
                <button
                  key={user.id}
                  onClick={() => { setSelectedId(user.id); setPin(""); setError(""); }}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${selectedId === user.id ? "border-amber-500 bg-amber-500/10 shadow-md shadow-amber-950/30" : "border-slate-800 bg-slate-950/60 hover:border-slate-700"}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${user.avatarColor} font-black text-white`}>
                    {user.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">{user.name}</span>
                    <span className="block truncate text-[11px] font-semibold text-slate-400">{user.role}</span>
                  </span>
                </button>
              ))}
            </div>
            {demoMode ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-300">
                <strong>Demo PINs:</strong> Manager <code>1001</code> · Elena <code>2002</code> · Diego <code>3003</code> · Sales <code>4004</code> · QA <code>5005</code> · Tech <code>6006</code>
                <div className="mt-1 text-slate-400">💡 You can also type your PIN directly on your keyboard.</div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-400">
                Enter your personal four-digit PIN. Accounts lock for 5 minutes after 5 failed attempts.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="mb-3 text-center">
              <div className="text-sm font-black text-white">{selected?.name || "Select employee"}</div>
              <div className="text-[11px] font-semibold text-amber-400">{selected?.role || "No role selected"}</div>
            </div>
            <div className="mb-4 flex justify-center gap-3" aria-label={`${pin.length} PIN digits entered`}>
              {[0, 1, 2, 3].map(index => <span key={index} className={`h-3 w-3 rounded-full border ${index < pin.length ? "border-amber-400 bg-amber-400" : "border-slate-600 bg-slate-900"}`} />)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => (
                <button key={digit} onClick={() => addDigit(digit)} className="h-11 rounded-xl border border-slate-700 bg-slate-800 text-base font-black text-white transition hover:border-amber-500 hover:bg-slate-700 active:scale-95">{digit}</button>
              ))}
              <button onClick={() => setPin("")} className="h-11 rounded-xl border border-slate-700 bg-slate-900 text-[10px] font-black uppercase text-slate-400 hover:text-white">Clear</button>
              <button onClick={() => addDigit("0")} className="h-11 rounded-xl border border-slate-700 bg-slate-800 text-base font-black text-white transition hover:border-amber-500 hover:bg-slate-700 active:scale-95">0</button>
              <button onClick={() => setPin(value => value.slice(0, -1))} className="flex h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-400 hover:text-white"><Delete className="h-4 w-4" /></button>
            </div>
            {error && <div className="mt-3 rounded-lg bg-rose-500/10 p-2 text-center text-[11px] font-bold text-rose-300">{error}</div>}
            <button
              onClick={() => authenticateWithPin(pin, selectedId)}
              disabled={submitting || pin.length !== 4 || !selectedId}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-xs font-black text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{submitting ? "Verifying…" : "Unlock Workspace"}</span>
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
