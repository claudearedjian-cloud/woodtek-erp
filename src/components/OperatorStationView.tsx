"use client";

import React, { useState, useEffect, useRef } from "react";
import { baseRoleOf } from "@/lib/permissions";
import { allowedStages } from "@/lib/materialProgress";
import { jobLockedByOther } from "@/lib/jobLock";
import {
  Tablet,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  Activity,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Timer,
  X,
  BellRing,
  Star,
  Zap,
  Trash2,
  RefreshCcw,
  ScanLine,
  Package,
} from "lucide-react";

interface OperatorStationViewProps {
  machines: any[];
  currentUser: any;
  onRefresh: () => void | Promise<void>;
  onSelectOrder: (orderId: number) => void;
}

const REJECT_REASONS = [
  "Tool wear",
  "Material defect",
  "Setup issue",
  "Waiting on parts",
  "Operator error",
  "Other",
];

const DOWNTIME_REASONS = [
  "Mechanical Failure",
  "Electrical Fault",
  "Material Shortage",
  "Setup & Changeover",
  "Operator Unavailable",
  "Quality Issue",
  "Other",
];

/** Live elapsed-time counter for an operation that is "In Progress". */
function ElapsedTimer({ startTime }: { startTime: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startTime) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  if (!startTime) return <span className="text-slate-500">—</span>;
  const elapsedMs = Math.max(0, now - new Date(startTime).getTime());
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(elapsedMs / 3600000);
  const m = Math.floor((elapsedMs % 3600000) / 60000);
  const s = Math.floor((elapsedMs % 60000) / 1000);
  return (
    <span className="font-mono tabular-nums text-amber-300">
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}

export default function OperatorStationView({
  machines = [],
  currentUser,
  onRefresh,
  onSelectOrder,
}: OperatorStationViewProps) {
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [operations, setOperations] = useState<any[]>([]);
  const [bomByOrder, setBomByOrder] = useState<Record<number, any[]>>({});
  const [receivedByOrder, setReceivedByOrder] = useState<Record<number, boolean | null>>({});
  const [receptionStateByOrder, setReceptionStateByOrder] = useState<Record<number, string | null>>({});
  const canApproveReception = !!currentUser && (currentUser.role === "Manager" || currentUser.role === "Floor Supervisor" || currentUser.displayRole === "Floor Supervisor");
  // Crew job lock: same rule as the API — operators control only their own running jobs.
  const operatorBasedViewer = baseRoleOf(currentUser?.role ?? "") === "Machine Operator";
  const [loadingOps, setLoadingOps] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyOperationId, setBusyOperationId] = useState<number | null>(null);

  // C3 — structured reject flow
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // B — scrap vs rework disposition + quantity captured at the station
  const [rejectDisposition, setRejectDisposition] = useState<"rework" | "scrap">("rework");
  const [rejectQuantity, setRejectQuantity] = useState(1);

  // B — machine downtime quick action
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [downtimeReason, setDowntimeReason] = useState(DOWNTIME_REASONS[0]);
  const [downtimeNotes, setDowntimeNotes] = useState("");
  const [downtimeBusy, setDowntimeBusy] = useState(false);
  const [activeDowntime, setActiveDowntime] = useState<any>(null);

  // C4 — finish double-tap confirmation guard
  const [confirmingFinishId, setConfirmingFinishId] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // C6 — new-job arrival flash
  const knownOpIds = useRef<Set<number>>(new Set());
  const queueRequestId = useRef(0);
  const queueInFlight = useRef(false);
  const queueMachineId = useRef<number | null>(null);
  const queueFingerprint = useRef("");
  const downtimeFingerprint = useRef("");
  const actionInFlight = useRef(false);
  const newJobTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newJobFlash, setNewJobFlash] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scannedOpId, setScannedOpId] = useState<number | null>(null);

  // QR / barcode scan: accepts a full sticker URL, an order number, or a bare order id.
  const handleScan = (event: React.FormEvent) => {
    event.preventDefault();
    const raw = scanValue.trim();
    if (!raw) return;
    const idMatch = raw.match(/order=(\d+)/);
    const match = operations.find((op: any) =>
      (idMatch && String(op.orderId) === idMatch[1]) ||
      (op.orderNumber && raw.toLowerCase().includes(String(op.orderNumber).toLowerCase())),
    );
    setScanValue("");
    if (!match) {
      setActionError(`No job from "${raw}" on this station.`);
      setTimeout(() => setActionError(""), 4000);
      return;
    }
    setScannedOpId(match.id);
    setActionSuccess(`Scanned ${match.orderNumber} — ${match.operationName}`);
    setTimeout(() => { setScannedOpId(null); setActionSuccess(""); }, 5000);
    const el = document.getElementById(`station-op-${match.id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const opIdsOf = (m: any): number[] =>
    Array.isArray(m.assignedOperatorIds)
      ? m.assignedOperatorIds.map(Number)
      : m.assignedOperatorId != null
        ? [Number(m.assignedOperatorId)]
        : [];

  const myMachineId = currentUser
    ? machines.find((m: any) => opIdsOf(m).includes(Number(currentUser.id)))?.id ?? null
    : null;

  // C2 (option A) — auto-select the operator's assigned machine on open,
  // but the operator can still switch to any other station afterwards.
  useEffect(() => {
    if (selectedMachineId) return; // keep the operator's manual choice
    if (machines.length === 0) return;
    const mine = machines.find((m: any) => opIdsOf(m).includes(Number(currentUser?.id)));
    setSelectedMachineId(mine ? mine.id : machines[0].id);
  }, [machines, currentUser, selectedMachineId]);

  // One scoped station request now carries operation, material/BOM and receipt
  // state. Downtime runs beside it instead of serially, and overlapping polls
  // are suppressed so a slow response cannot pile up behind the next interval.
  const fetchMachineQueue = async ({
    showLoading = false,
    force = false,
  }: { showLoading?: boolean; force?: boolean } = {}): Promise<void> => {
    const machineId = selectedMachineId;
    if (!machineId) return;
    if (!force && queueInFlight.current && queueMachineId.current === machineId) return;

    const requestId = ++queueRequestId.current;
    queueInFlight.current = true;
    queueMachineId.current = machineId;
    if (showLoading) setLoadingOps(true);

    try {
      const [dtRes, operationsRes] = await Promise.all([
        fetch(`/api/downtime?machineId=${machineId}&activeOnly=true`, { cache: "no-store" }),
        fetch(`/api/operations?machineId=${machineId}&activeOnly=true&station=true`, { cache: "no-store" }),
      ]);
      if (!operationsRes.ok) throw new Error("The station queue could not be refreshed.");

      const [downtime, data] = await Promise.all([
        dtRes.ok ? dtRes.json() : Promise.resolve([]),
        operationsRes.json(),
      ]);
      if (requestId !== queueRequestId.current || machineId !== selectedMachineId) return;

      const activeDowntimeRow = Array.isArray(downtime) && downtime.length > 0 ? downtime[0] : null;
      const nextDowntimeFingerprint = JSON.stringify(activeDowntimeRow);
      if (nextDowntimeFingerprint !== downtimeFingerprint.current) {
        downtimeFingerprint.current = nextDowntimeFingerprint;
        setActiveDowntime(activeDowntimeRow);
      }
      const rows = Array.isArray(data) ? data : [];
      const nextQueueFingerprint = JSON.stringify(rows);
      if (nextQueueFingerprint === queueFingerprint.current) return;
      queueFingerprint.current = nextQueueFingerprint;

      const previousIds = knownOpIds.current;
      const ids = new Set<number>(rows.map((operation: any) => Number(operation.id)));
      const fresh = previousIds.size > 0 && rows.some((operation: any) => !previousIds.has(Number(operation.id)));
      knownOpIds.current = ids;
      if (fresh) {
        setNewJobFlash(true);
        if (newJobTimer.current) clearTimeout(newJobTimer.current);
        newJobTimer.current = setTimeout(() => setNewJobFlash(false), 5000);
      }

      const byOrder: Record<number, any[]> = {};
      const received: Record<number, boolean | null> = {};
      const receivedState: Record<number, string | null> = {};
      for (const operation of rows) {
        if (byOrder[operation.orderId]) continue;
        byOrder[operation.orderId] = operation.orderBom ?? operation.materials ?? [];
        received[operation.orderId] = operation.received ?? null;
        receivedState[operation.orderId] = operation.receivedState ?? null;
      }
      setOperations(rows);
      setBomByOrder(byOrder);
      setReceivedByOrder(received);
      setReceptionStateByOrder(receivedState);
    } catch (error) {
      if (requestId === queueRequestId.current) {
        console.error("Error fetching station tasks:", error);
      }
    } finally {
      if (requestId === queueRequestId.current) {
        queueInFlight.current = false;
        queueMachineId.current = null;
        setLoadingOps(false);
      }
    }
  };

  const confirmReceived = async (orderId: number, state: "Received" | "Not Received" | "Declined") => {
    setActionError("");
    try {
      const res = await fetch("/api/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, state }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "Reception update failed.");
        setTimeout(() => setActionError(""), 6000);
        return;
      }
      await fetchMachineQueue({ force: true });
    } catch {
      setActionError("Reception update failed.");
    }
  };

  useEffect(() => {
    queueRequestId.current += 1;
    queueInFlight.current = false;
    queueMachineId.current = null;
    queueFingerprint.current = "";
    downtimeFingerprint.current = "";
    knownOpIds.current = new Set();
    setNewJobFlash(false);
    void fetchMachineQueue({ showLoading: true, force: true });

    const refreshVisibleStation = () => {
      if (document.visibilityState === "visible") void fetchMachineQueue();
    };
    const interval = setInterval(refreshVisibleStation, 10000);
    document.addEventListener("visibilitychange", refreshVisibleStation);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleStation);
      queueRequestId.current += 1;
      queueInFlight.current = false;
      if (newJobTimer.current) clearTimeout(newJobTimer.current);
    };
  }, [selectedMachineId]);

  const handleTouchAction = async (
    opId: number,
    status: string,
    reason?: string,
    extra?: Record<string, unknown>,
    beforeRequest?: () => Promise<boolean>,
  ) => {
    if (actionInFlight.current) return;
    if (status === "Rejected/Rework" && !reason?.trim()) {
      setActionError("Choose a reason for rejection.");
      return;
    }

    actionInFlight.current = true;
    setBusyOperationId(opId);
    setActionError("");
    try {
      if (beforeRequest && !(await beforeRequest())) return;
      const response = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          rejectReason: reason?.trim() || undefined,
          operatorId: currentUser?.id ? Number(currentUser.id) : undefined,
          ...(extra || {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The station could not update this operation.");

      setOperations((current) => status === "Completed"
        ? current.filter((operation) => operation.id !== opId)
        : current.map((operation) => operation.id === opId ? { ...operation, status } : operation));
      setActionSuccess(status === "Completed" ? "Step completed — the next workstation is now ready." : `Operation marked ${status}.`);
      setTimeout(() => setActionSuccess(""), 3500);
      await fetchMachineQueue({ force: true });
      // Keep surrounding counts current without making the station wait for it.
      void Promise.resolve().then(onRefresh).catch(() => undefined);
    } catch (error) {
      // A legacy last-material action advances its material immediately before
      // closing the shared job. If close fails, show that persisted stage now.
      if (beforeRequest) void fetchMachineQueue({ force: true });
      const message = error instanceof Error ? error.message : "Touch action failed.";
      setActionError(message);
      setTimeout(() => setActionError(""), 6000);
    } finally {
      actionInFlight.current = false;
      setBusyOperationId(null);
    }
  };

  // C3 — open the structured reject picker
  const openReject = (opId: number) => {
    setRejectingId(opId);
    setRejectReason("");
    setRejectDisposition("rework");
    setRejectQuantity(1);
    setActionError("");
  };

  const confirmReject = async (opId: number) => {
    if (!rejectReason) {
      setActionError("Choose a reason for rejection.");
      return;
    }
    setRejectingId(null);
    await handleTouchAction(opId, "Rejected/Rework", rejectReason, {
      rejectDisposition: rejectDisposition === "scrap" ? "Scrap" : "Rework",
      rejectQuantity: Math.max(1, rejectQuantity),
    });
  };

  // One tap: "this material is finished on THIS step" — the server picks
  // the next ladder stage (never a skip). Best-effort; the queue refetches.
  // Per-material taps: "▶ Start" moves ONE material into the current step;
  // "✓ Finished here" lets the server pick the next ladder stage — never a skip.
  const advanceMaterial = async (materialId: number, stage?: string, refreshQueue = true): Promise<boolean> => {
    try {
      const res = await fetch("/api/material-progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stage ? { orderMaterialsId: materialId, stage } : { orderMaterialsId: materialId, advance: true }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any));
        setActionError(d.error || "Could not update the material.");
        return false;
      }
      if (refreshQueue) await fetchMachineQueue({ force: true });
      return true;
    } catch {
      setActionError("Could not update the material.");
      return false;
    }
  };
  // START on a material line: opens the machine job if needed, then moves
  // that ONE material into the step. FINISH on a line sends it to its next
  // stage; when the last material leaves, the machine job completes itself.
  const startMaterial = async (op0: any, matId: number, targetStage: string) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyOperationId(op0.id);
    setActionError("");
    try {
      if (op0.status !== "In Progress") {
        const res = await fetch(`/api/operations/${op0.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "In Progress", operatorId: currentUser?.id ? Number(currentUser.id) : undefined }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as any));
          setActionError(data.error || "Could not start the machine job.");
          return;
        }
      }
      if (!(await advanceMaterial(matId, targetStage, false))) {
        await fetchMachineQueue({ force: true });
        return;
      }
      setOperations((current) => current.map((operation) => operation.id === op0.id
        ? {
            ...operation,
            status: "In Progress",
            materials: (operation.materials ?? []).map((material: any) => material.id === matId
              ? { ...material, stage: targetStage }
              : material),
          }
        : operation));
      await fetchMachineQueue({ force: true });
      void Promise.resolve().then(onRefresh).catch(() => undefined);
    } catch {
      setActionError("Could not start this material.");
    } finally {
      actionInFlight.current = false;
      setBusyOperationId(null);
    }
  };

  const finishMaterial = async (op0: any, matId: number, stepStage: string) => {
    // Legacy shared jobs close only after every material that needs this step
    // has reached and passed it. Merely having no material here at this exact
    // moment used to close the job before upstream materials arrived.
    const stillNeedsThisPass = (op0.materials ?? []).some((material: any) => {
      if (material.id === matId || material.stage === "DONE") return false;
      const route: string[] = material.route ?? op0.orderSteps ?? [];
      const target = route.indexOf(stepStage);
      if (target === -1) return false;
      const current = material.stage ? route.indexOf(material.stage) : -1;
      return current <= target;
    });

    if (!stillNeedsThisPass) {
      await handleTouchAction(op0.id, "Completed", undefined, undefined, () => advanceMaterial(matId, undefined, false));
      return;
    }

    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyOperationId(op0.id);
    setActionError("");
    try {
      if (!(await advanceMaterial(matId, undefined, false))) return;
      await fetchMachineQueue({ force: true });
      void Promise.resolve().then(onRefresh).catch(() => undefined);
    } finally {
      actionInFlight.current = false;
      setBusyOperationId(null);
    }
  };

  // C4 — finish requires a second tap within 3s
  const handleFinishTap = (op: any) => {
    if (confirmingFinishId === op.id) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmingFinishId(null);
      handleTouchAction(op.id, "Completed");
    } else {
      setConfirmingFinishId(op.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingFinishId(null), 3000);
    }
  };

  // B — downtime quick actions
  const startDowntime = async () => {
    if (!selectedMachineId || downtimeBusy) return;
    setDowntimeBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/downtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: Number(selectedMachineId),
          reason: downtimeReason,
          notes: downtimeNotes.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not start downtime.");
      setDowntimeOpen(false);
      setDowntimeNotes("");
      setDowntimeReason(DOWNTIME_REASONS[0]);
      setActionSuccess("Station marked DOWN — downtime is now being logged.");
      setTimeout(() => setActionSuccess(""), 4000);
      await fetchMachineQueue({ force: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start downtime.");
      setTimeout(() => setActionError(""), 6000);
    } finally {
      setDowntimeBusy(false);
    }
  };

  const endDowntime = async () => {
    if (!activeDowntime || downtimeBusy) return;
    setDowntimeBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/downtime/${activeDowntime.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not end downtime.");
      setActionSuccess("Station back up — downtime closed.");
      setTimeout(() => setActionSuccess(""), 4000);
      await fetchMachineQueue({ force: true });
      void Promise.resolve().then(onRefresh).catch(() => undefined);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not end downtime.");
      setTimeout(() => setActionError(""), 6000);
    } finally {
      setDowntimeBusy(false);
    }
  };

  const currentMachine = machines.find((m: any) => m.id === selectedMachineId);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto select-none">
      {/* Touch Screen Banner & Station Switcher */}
      <div className="bg-slate-900/90 border-2 border-amber-500/40 rounded-3xl p-6 shadow-xl shadow-amber-950/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Tablet className="w-5 h-5 text-amber-400 animate-bounce" />
              <span className="text-xs font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30">
                Touchscreen Shop Floor Mode
              </span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">Select Workstation</h2>
            {myMachineId && (
              <p className="text-[11px] font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 fill-emerald-400" /> Your assigned station opens first — you can switch to any other.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 bg-slate-950 px-4 py-2.5 rounded-2xl border border-slate-800">
              <User className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Logged Operator</div>
                <div className="text-sm font-black text-white">{currentUser?.name || "Machine Operator"}</div>
              </div>
            </div>

            {/* B — machine down / back up */}
            {activeDowntime ? (
              <button
                onClick={endDowntime}
                disabled={downtimeBusy}
                className="flex items-center gap-2 bg-rose-500 hover:bg-rose-400 text-slate-950 font-black text-sm px-5 py-2.5 rounded-2xl border-2 border-rose-300 shadow-lg shadow-rose-600/30 transition active:scale-95 disabled:opacity-50"
              >
                <Zap className="w-5 h-5 fill-slate-950" /> END DOWNTIME
              </button>
            ) : (
              <button
                onClick={() => setDowntimeOpen(true)}
                className="flex items-center gap-2 bg-slate-950 hover:bg-slate-900 text-rose-400 font-black text-sm px-5 py-2.5 rounded-2xl border-2 border-rose-500/50 transition active:scale-95"
              >
                <Zap className="w-5 h-5" /> MACHINE DOWN
              </button>
            )}
          </div>
        </div>

        {/* C6 — new job arrival flash */}
        {newJobFlash && (
          <div className="mt-4 p-3 bg-amber-500/15 border border-amber-500/50 rounded-2xl text-amber-300 font-black text-sm flex items-center justify-center gap-2 animate-pulse">
            <BellRing className="w-5 h-5" /> NEW JOB ARRIVED AT THIS STATION — check the queue below.
          </div>
        )}

        {/* Tactile Station Buttons Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3 pt-6">
          {machines.map((m: any) => {
            const isSelected = m.id === selectedMachineId;
            const unavailable = m.status === "Maintenance" || m.status === "Offline";
            const isMine = opIdsOf(m).includes(Number(currentUser?.id));
            return (
              <button
                key={m.id}
                onClick={() => !unavailable && setSelectedMachineId(m.id)}
                disabled={unavailable}
                className={`relative p-4 rounded-2xl border-2 transition-all duration-150 flex flex-col items-center justify-center text-center active:scale-95 shadow-md ${
                  unavailable ? "bg-slate-950/40 border-rose-500/30 text-slate-600 cursor-not-allowed opacity-60" : isSelected
                    ? "bg-gradient-to-b from-amber-500 to-amber-600 border-amber-300 text-slate-950 font-black shadow-lg shadow-amber-500/30 scale-105 z-10"
                    : "bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white"
                }`}
              >
                {isMine && (
                  <span className={`absolute -top-2 -right-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${isSelected ? "bg-slate-950 text-emerald-400 border-emerald-400/60" : "bg-emerald-500 text-slate-950 border-emerald-300"}`}>
                    Yours
                  </span>
                )}
                <span className={`font-mono font-black text-lg tracking-wider mb-1 ${isSelected ? "text-slate-950" : "text-amber-400"}`}>
                  {m.code}
                </span>
                <span className={`text-xs font-extrabold line-clamp-1 ${isSelected ? "text-slate-900" : "text-slate-300"}`}>
                  {m.category}
                </span>
                <span className={`text-[10px] mt-1.5 font-bold px-2 py-0.5 rounded-full ${
                  isSelected ? "bg-slate-950 text-white" : "bg-slate-900 text-slate-400"
                }`}>
                  {unavailable ? m.status : `${m.queueCount} queued`}
                </span>
                {/* C5 — rough ETA badge */}
                {!unavailable && Number(m.queueCount) > 0 && (
                  <span className={`text-[9px] font-bold mt-1 ${isSelected ? "text-slate-900" : "text-amber-400/80"}`}>
                    ~{Math.max(5, Number(m.queueCount) * 15)}m ETA
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Success Notification */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-500 text-slate-950 font-black text-center text-base rounded-2xl shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2" role="status">
          <Sparkles className="w-6 h-6 stroke-[2.5]" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-4 bg-rose-500/15 text-rose-200 font-bold text-center text-sm rounded-2xl border-2 border-rose-500/50 shadow-xl flex items-center justify-center gap-2" role="alert">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* B — active downtime banner for the selected station */}
      {activeDowntime && (
        <div className="p-4 bg-rose-500/15 border-2 border-rose-500/50 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-rose-400 shrink-0" />
            <div>
              <div className="font-black text-rose-200 text-sm uppercase tracking-wider">
                {currentMachine?.code} is DOWN — {activeDowntime.reason}
              </div>
              {activeDowntime.notes && <div className="text-[11px] text-rose-300/80 mt-0.5">{activeDowntime.notes}</div>}
            </div>
          </div>
          <span className="text-[11px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg whitespace-nowrap">
            Logged {new Date(activeDowntime.startedAt).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Machine Queue Display */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-lg font-black text-white flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
            <span>Active Queue for {currentMachine?.name || "Selected Machine"}</span>
            {myMachineId === selectedMachineId && (
              <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                Your station
              </span>
            )}
          </h3>
          <button
            onClick={() => void fetchMachineQueue({ showLoading: true, force: true })}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            title="Refresh Machine Queue"
          >
            <RefreshCw className={`w-4 h-4 ${loadingOps ? "animate-spin text-amber-400" : ""}`} />
          </button>
        </div>

        {/* Scan box: QR sticker or barcode scanner input */}
        <form onSubmit={handleScan} className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-2.5">
          <ScanLine className="ml-1 h-5 w-5 flex-shrink-0 text-sky-400" />
          <input
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            placeholder="Scan the order sticker (or type the order number)…"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white placeholder-slate-500 focus:outline-none"
          />
          <button type="submit" className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-black text-white hover:bg-sky-500">
            Find job
          </button>
        </form>

        {operations.length === 0 ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-16 text-center my-6 shadow-sm">
            <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-4 stroke-[1.5] animate-bounce" />
            <h3 className="text-2xl font-black text-white mb-2">Workstation All Clear!</h3>
            <p className="text-sm font-semibold text-slate-400 max-w-md mx-auto">
              There are no pending or running jobs at <strong className="text-amber-400">{currentMachine?.code}</strong> right now. Enjoy a clean floor or help assist another station.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {operations.map((op: any) => {
              const isRunning = op.status === "In Progress";
              const isRejecting = rejectingId === op.id;
              const isConfirmingFinish = confirmingFinishId === op.id;
              const lockedByMate = jobLockedByOther(op, currentUser?.id, operatorBasedViewer);

              return (
                <div
                  key={op.id}
                  id={`station-op-${op.id}`}
                  className={`p-6 rounded-3xl border-2 transition shadow-xl ${scannedOpId === op.id ? "ring-4 ring-sky-400 " : ""}${
                    isRunning
                      ? "bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 border-amber-500 shadow-amber-950/30"
                      : "bg-slate-900/95 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    {/* Job Details */}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className={`text-xs font-extrabold px-3 py-1 rounded-xl uppercase tracking-wider ${
                          isRunning ? "bg-amber-500 text-slate-950 animate-pulse font-black" : "bg-blue-600 text-white"
                        }`}>
                          {op.status}
                        </span>
                        <span className="font-mono text-lg font-black text-amber-400 bg-slate-950 px-3 py-1 rounded-xl border border-slate-800">
                          {op.orderNumber}
                        </span>
<span className="text-xs text-slate-400 font-bold bg-slate-800 px-2.5 py-1 rounded-xl">
                          {op.productionItem ? `Pass ${op.productionItem.routePosition}/${op.productionItem.routeLength}` : `Step #${op.stepOrder}`}
                        </span>
                        {isRunning && (
                          <span className="flex items-center gap-1.5 text-xs font-black bg-slate-950 border border-amber-500/40 px-2.5 py-1 rounded-xl text-amber-300">
                            <Timer className="w-4 h-4" /> <ElapsedTimer startTime={op.startTime} />
                          </span>
                        )}
                      </div>

                      <h4
                        onClick={() => onSelectOrder(op.orderId)}
                        className="text-xl font-black text-white hover:text-amber-300 transition cursor-pointer flex items-center gap-2"
                      >
                        <span>{op.operationName}</span>
                        <ArrowRight className="w-5 h-5 text-slate-500 inline" />
                      </h4>

                      {op.productionItem && (
                        <div className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-base font-black text-amber-200">
                          <Package className="h-4 w-4" /> Material job: {op.productionItem.name}
                        </div>
                      )}

                      <div className="text-base font-extrabold text-white truncate">
                        Project: {op.orderTitle}
                      </div>
                      {(op.customerCompany || op.customerName) && (
                        <div className="text-base font-black text-amber-300 truncate">
                          Client: {op.customerCompany || op.customerName}
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 pt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-slate-500" /> Est: <strong className="text-slate-200">{op.estimatedMinutes} mins</strong>
                        </span>
                        {isRunning && op.startTime && (
                          <span className="flex items-center gap-1">
                            <Timer className="w-4 h-4 text-slate-500" /> Started: <strong className="text-slate-200">{new Date(op.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
                          </span>
                        )}
                        {op.operatorName && (
                          <span className="text-emerald-400">Assigned: {op.operatorName}</span>
                        )}
                      </div>

                      {op.rejectReason && (
                        <div className="text-[11px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-lg inline-block">
                          Reject reason: {op.rejectReason}
                        </div>
                      )}

                      {(bomByOrder[op.orderId] ?? []).length > 0 && (
                        <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                              Requested materials (BOM)
                            </span>
                            {receivedByOrder[op.orderId] === true && (
                              <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300">RECEIVED ✓</span>
                            )}
                            {receivedByOrder[op.orderId] === false && receptionStateByOrder[op.orderId] === "Declined" && (
                              <span className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-300">RECEPTION DECLINED ✗</span>
                            )}
                            {receivedByOrder[op.orderId] === false && receptionStateByOrder[op.orderId] !== "Declined" && (
                              <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-300">NOT RECEIVED ✗</span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1">
                            {(bomByOrder[op.orderId] ?? []).map((m: any) => (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate font-bold text-slate-200">
                                  {m.quantityUsed} {m.itemUnit || "pcs"} — {m.itemName || m.itemSku}
                                </span>
                                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${m.status === "Delivered" ? "bg-emerald-500/10 text-emerald-300" : m.status === "Prepared" ? "bg-sky-500/10 text-sky-300" : "bg-amber-500/10 text-amber-300"}`}>
                                  {m.status}
                                </span>
                              </div>
                            ))}
                          </div>
                          {canApproveReception && receivedByOrder[op.orderId] !== true ? (
                            <>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                disabled={(bomByOrder[op.orderId] ?? []).some((m: any) => m.status !== "Delivered")}
                                title="Unlocks when the warehouse has delivered every requested line"
                                onClick={() => confirmReceived(op.orderId, "Received")}
                                className="rounded-xl border-2 border-emerald-600 bg-emerald-600/20 px-2 py-2.5 text-[11px] font-black text-emerald-300 hover:bg-emerald-600/40 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                ✓ APPROVE RECEPTION
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmReceived(op.orderId, "Not Received")}
                                className="rounded-xl border-2 border-amber-600 bg-amber-600/10 px-2 py-2.5 text-[11px] font-black text-amber-300 hover:bg-amber-600/30"
                              >
                                ✗ NOT RECEIVED
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmReceived(op.orderId, "Declined")}
                                className="rounded-xl border-2 border-rose-600 bg-rose-600/10 px-2 py-2.5 text-[11px] font-black text-rose-300 hover:bg-rose-600/30"
                              >
                                ⛔ DECLINE
                              </button>
                            </div>
                            {(bomByOrder[op.orderId] ?? []).some((m: any) => m.status !== "Delivered") && (
                              <div className="mt-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] font-black text-sky-300">
                                🚚 APPROVE unlocks once the warehouse has DELIVERED every requested line.
                              </div>
                            )}
                            </>
                          ) : receivedByOrder[op.orderId] !== true ? (
                            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] font-black text-amber-300">
                              ⏳ Materials not approved yet — the Floor Supervisor must approve reception before this job can start.
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* GIANT TACTILE OPERATOR BUTTONS */}
                    <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
                      {isRejecting ? (
                        <div className="w-full sm:w-80 p-4 bg-slate-950 border-2 border-rose-500/50 rounded-2xl">
                          <div className="text-[11px] font-black uppercase tracking-wider text-rose-300 mb-2 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4" /> Why is this rejected / rework?
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {REJECT_REASONS.map((r) => (
                              <button
                                key={r}
                                onClick={() => setRejectReason(r)}
                                className={`px-2 py-2 rounded-xl text-xs font-black uppercase tracking-wide border-2 transition active:scale-95 ${
                                  rejectReason === r
                                    ? "bg-rose-500 text-slate-950 border-rose-300"
                                    : "bg-slate-900 text-slate-300 border-slate-700 hover:border-rose-500/60"
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>

                          {/* B — scrap vs rework + quantity */}
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={() => setRejectDisposition("rework")}
                              className={`flex-1 px-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition active:scale-95 flex items-center justify-center gap-1 ${
                                rejectDisposition === "rework"
                                  ? "bg-orange-500 text-slate-950 border-orange-300"
                                  : "bg-slate-900 text-slate-300 border-slate-700"
                              }`}
                            >
                              <RefreshCcw className="w-3.5 h-3.5" /> Rework
                            </button>
                            <button
                              onClick={() => setRejectDisposition("scrap")}
                              className={`flex-1 px-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition active:scale-95 flex items-center justify-center gap-1 ${
                                rejectDisposition === "scrap"
                                  ? "bg-rose-500 text-slate-950 border-rose-300"
                                  : "bg-slate-900 text-slate-300 border-slate-700"
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Scrap
                            </button>
                            <div className="flex items-center gap-1 bg-slate-900 border-2 border-slate-700 rounded-xl px-1.5 py-1">
                              <button
                                onClick={() => setRejectQuantity(q => Math.max(1, q - 1))}
                                className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-lg active:scale-95"
                              >
                                −
                              </button>
                              <span className="w-7 text-center font-black text-amber-400 text-sm">{rejectQuantity}</span>
                              <button
                                onClick={() => setRejectQuantity(q => q + 1)}
                                className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-lg active:scale-95"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500 font-bold mt-1.5 uppercase tracking-wider">
                            {rejectQuantity} pcs → {rejectDisposition === "scrap" ? "scrapped" : "sent for rework"}
                          </div>

                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => confirmReject(op.id)}
                              disabled={busyOperationId !== null}
                              className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-400 text-slate-950 font-black text-xs uppercase rounded-xl active:scale-95 disabled:opacity-40"
                            >
                              Confirm Reject
                            </button>
                            <button
                              onClick={() => setRejectingId(null)}
                              className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase rounded-xl flex items-center gap-1 active:scale-95"
                            >
                              <X className="w-4 h-4" /> Cancel
                            </button>
                          </div>
                        </div>
) : (op.productionItem || (op.materials?.length ?? 0) === 0) ? (
                        !isRunning ? (
                          <button
                            onClick={() => handleTouchAction(op.id, "In Progress")}
                            disabled={busyOperationId !== null || lockedByMate}
                            className="flex items-center justify-center gap-2.5 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700 active:scale-95 text-slate-950 font-black px-8 py-5 rounded-2xl text-base shadow-xl shadow-amber-600/30 transition uppercase tracking-wider w-full sm:w-auto disabled:opacity-40 disabled:cursor-wait"
                          >
                            <Play className="w-6 h-6 fill-slate-950 stroke-[2.5]" />
                            <span>{op.productionItem ? "START MATERIAL JOB" : "START MACHINING"}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleFinishTap(op)}
                            disabled={busyOperationId !== null || lockedByMate}
                            className={`flex items-center justify-center gap-2.5 bg-gradient-to-b px-8 py-5 rounded-2xl text-base shadow-xl transition uppercase tracking-wider w-full sm:w-auto disabled:opacity-40 disabled:cursor-wait ${
                              isConfirmingFinish
                                ? "from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-slate-950 font-black animate-pulse shadow-amber-600/30"
                                : "from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 text-slate-950 font-black shadow-emerald-600/30"
                            }`}
                          >
                            <CheckCircle2 className="w-6 h-6 stroke-[3]" />
                            <span>{isConfirmingFinish ? "TAP AGAIN TO CONFIRM" : op.productionItem ? "FINISH MATERIAL PASS" : "FINISH & PASS NEXT"}</span>
                          </button>
                        )
                      ) : (
                        <div className="flex max-w-sm items-center rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-5 text-center text-sm font-black uppercase leading-relaxed tracking-wide text-amber-300">
                          Start / finish each material below — the machine job opens and closes by itself
                        </div>
                      )}

                      {lockedByMate && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-300">
                          Run by {op.operatorName || "another operator"} — view only
                        </div>
                      )}
                      {!isRejecting && (
                        <button
                          onClick={() => openReject(op.id)}
                          disabled={busyOperationId !== null || lockedByMate}
                          className="p-5 bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 text-rose-400 rounded-2xl border-2 border-rose-500/40 font-black text-sm flex items-center gap-2 transition uppercase disabled:opacity-40 disabled:cursor-wait"
                          title="Flag defect or tool wear"
                        >
                          <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
                          <span className="hidden md:inline">REJECT / REWORK</span>
                        </button>
                      )}
                    </div>
                    </div>
                      {op.productionItem && (
                        <div className="mt-4 w-full border-t border-slate-800 pt-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Independent route for {op.productionItem.name}</span>
                            <span className="text-[10px] font-bold text-slate-500">Only this material job is controlled by the buttons above</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                            {(op.productionItem.steps ?? []).map((step: any, stepIndex: number) => {
                              const isCurrent = step.operationId === op.id;
                              const passed = step.position < op.productionItem.routePosition;
                              return (
                                <React.Fragment key={step.operationId}>
                                  <span className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide ${isCurrent ? "border-amber-400 bg-amber-500/20 text-amber-200" : passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-500"}`}>
                                    {passed ? "✓ " : ""}{step.position}. {step.operationName}
                                  </span>
                                  {stepIndex < op.productionItem.steps.length - 1 && <ArrowRight className="h-3 w-3 text-slate-600" />}
                                </React.Fragment>
                              );
                            })}
                          </div>
                          {(op.materials ?? []).map((material: any) => (
                            <div key={material.id} className="mt-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-bold text-slate-300">
                              <span className="font-mono text-amber-400">{material.itemSku ?? "—"}</span> · {material.itemName} × {material.quantityUsed}{material.itemUnit ? ` ${material.itemUnit}` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                      {(op.materials?.length ?? 0) > 0 && !op.productionItem && (
                        <div className="mt-4 w-full border-t border-slate-800 pt-3">
                          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Materials — start & finish each cut list</span>
                            <span className="text-[11px] font-bold text-slate-500">the machine job opens and closes by itself</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                            {op.materials.map((mat: any) => {
                              const mStage: string = mat.stage ?? "";
                              const matSteps: string[] = mat.route ?? op.orderSteps ?? [];
                              const stepStage = mat.route ? (op.machineCategory || op.operationName) : op.operationName;
                              const atThisStep = mStage === stepStage;
                              const mDone = mStage === "DONE";
                              const canStartMat =
                                !mDone && !atThisStep &&
                                matSteps.length > 0 &&
                                allowedStages(matSteps, mStage).includes(stepStage);
                              const matLadder = ["", ...matSteps, "DONE"];
                              const matPos = matLadder.indexOf(mStage);
                              const matPct = matPos <= 0 ? 0 : Math.round((matPos / (matLadder.length - 1)) * 100);
                              const matChip = mDone ? "✓ Done" : atThisStep ? `→ ${stepStage}` : mStage ? `At ${mStage}` : "Not started";
                              const matTitle = `Stage: ${mStage || "not started"}${mat.stageBy ? ` — by ${mat.stageBy}` : ""}${mat.stageAt ? ` · ${new Date(mat.stageAt).toLocaleString()}` : ""}`;
                              return (
                                <div key={mat.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4" title={matTitle}>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="min-w-0 truncate text-sm font-black text-white">
                                      <span className="font-mono text-amber-400">{mat.itemSku ?? "—"}</span> · {mat.itemName} × {mat.quantityUsed}{mat.itemUnit ? ` ${mat.itemUnit}` : ""}
                                    </span>
                                    <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-extrabold uppercase border ${
                                      mDone ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : atThisStep ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-slate-800 text-slate-400 border-slate-700"
                                    }`}>{matChip}</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {matSteps.map((sName: string, si: number) => {
                                      const sPos = si + 1;
                                      const sDone = matPos > sPos || mDone;
                                      const sCurrent = !mDone && sName === mStage;
                                      return (
                                        <span
                                          key={si}
                                          className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide border ${
                                            sCurrent ? "border-amber-400 bg-amber-500/20 text-amber-200" : sDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-slate-700 bg-slate-950 text-slate-500"
                                          }`}
                                        >
                                          {sDone ? "✓ " : ""}{sName}
                                        </span>
                                      );
                                    })}
                                    <span className="ml-1 text-[10px] font-black uppercase tracking-wider text-slate-600">{matPos <= 0 ? "queued" : mDone ? "complete" : `${matPos}/${matSteps.length}`}</span>
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    {(canStartMat || (atThisStep && !isRunning)) && !lockedByMate && (
                                      <button
                                        onClick={() => startMaterial(op, mat.id, stepStage)}
                                        disabled={busyOperationId !== null}
                                        className="flex flex-1 items-center justify-center gap-2 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700 active:scale-95 text-slate-950 font-black px-6 py-4 rounded-xl text-base shadow-lg shadow-amber-600/30 transition uppercase tracking-wider disabled:opacity-40 disabled:cursor-wait"
                                        title="Start THIS material on this machine — opens the machine job if it is not running yet"
                                      >
                                        <Play className="w-5 h-5 fill-slate-950 stroke-[2.5]" /> START
                                      </button>
                                    )}
                                    {atThisStep && isRunning && !lockedByMate && (
                                      <button
                                        onClick={() => finishMaterial(op, mat.id, stepStage)}
                                        disabled={busyOperationId !== null}
                                        className="flex flex-1 items-center justify-center gap-2 bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 active:scale-95 text-slate-950 font-black px-6 py-4 rounded-xl text-base shadow-lg shadow-emerald-600/30 transition uppercase tracking-wider disabled:opacity-40 disabled:cursor-wait"
                                        title="Finished THIS material here — it moves to its next stage; the machine job closes when the last one leaves"
                                      >
                                        <CheckCircle2 className="w-5 h-5 stroke-[3]" /> FINISH
                                      </button>
                                    )}
                                    {lockedByMate && (
                                      <span className="flex flex-1 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-4 text-[11px] font-black uppercase tracking-wider text-slate-400">Run by another operator</span>
                                    )}
                                  </div>
                                  <div className="mt-2 flex items-center gap-2">
                                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                                      <div className={`h-full rounded-full transition-all ${mDone ? "bg-emerald-500" : matPos > 0 ? "bg-amber-500/70" : ""}`} style={{ width: `${matPct}%` }} />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* B — Machine Down modal */}
      {downtimeOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border-2 border-rose-500/50 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-rose-400" /> Machine Down — {currentMachine?.code}
              </h3>
              <button onClick={() => setDowntimeOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Why is the station down?</label>
                <div className="grid grid-cols-2 gap-2">
                  {DOWNTIME_REASONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setDowntimeReason(r)}
                      className={`px-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide border-2 transition active:scale-95 text-left ${
                        downtimeReason === r
                          ? "bg-rose-500 text-slate-950 border-rose-300"
                          : "bg-slate-950 text-slate-300 border-slate-700 hover:border-rose-500/60"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Notes (optional)</label>
                <textarea
                  value={downtimeNotes}
                  onChange={(e) => setDowntimeNotes(e.target.value)}
                  placeholder="What failed? Who was called?"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white h-20"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setDowntimeOpen(false)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black text-xs uppercase rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={startDowntime}
                  disabled={downtimeBusy}
                  className="flex-1 py-3 bg-rose-500 hover:bg-rose-400 text-slate-950 font-black text-xs uppercase rounded-xl transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" /> Confirm Down
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
