"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  AlertTriangle,
  Cpu,
  User,
  Plus,
  Trash2,
  Save,
  Layers,
  Package,
  Sparkles,
  RefreshCw,
  Check,
  RotateCcw,
  ChevronRight,
  Boxes,
  DollarSign,
} from "lucide-react";
import { can } from "@/lib/permissions";

interface OrderWorkflowDetailProps {
  orderId: number;
  onBack: () => void;
  onRefresh: () => void;
  currentUser: any;
  machines: any[];
  inventoryItems: any[];
}

export default function OrderWorkflowDetail({
  orderId,
  onBack,
  onRefresh,
  currentUser,
  machines = [],
  inventoryItems = [],
}: OrderWorkflowDetailProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [busyOperationId, setBusyOperationId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"workflow" | "materials" | "details">("workflow");

  // BOM Allocator state
  const [allocItemId, setAllocItemId] = useState<string>("");
  const [allocQty, setAllocQty] = useState<string>("1");
  const [allocError, setAllocError] = useState<string>("");
  const [allocNotice, setAllocNotice] = useState<string>("");
  const [allocBusy, setAllocBusy] = useState<boolean>(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const canManageBom = can(currentUser?.role, "orders:write");

  // Add Step Modal State
  const [showAddStep, setShowAddStep] = useState(false);
  const [newOpName, setNewOpName] = useState("");
  const [newOpMachineId, setNewOpMachineId] = useState(machines[0]?.id || "");
  const [newOpMins, setNewOpMins] = useState(60);

  // Edit notes state
  const [editingOpId, setEditingOpId] = useState<number | null>(null);
  const [tempNotes, setTempNotes] = useState("");
  const [tempActualMins, setTempActualMins] = useState(0);

  const fetchOrderDetail = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (res.ok) {
        const data = await res.json();
        setOrder(data);
      }
    } catch (err) {
      console.error("Failed to fetch order detail", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      fetchOrderDetail();
    }
  }, [orderId]);

  const handleUpdateOpStatus = async (opId: number, newStatus: string, allowRework = false) => {
    if (busyOperationId !== null) return;
    let rejectReason: string | undefined;
    if (newStatus === "Rejected/Rework") {
      const entered = window.prompt("Describe the defect or required rework:");
      if (!entered?.trim()) return;
      rejectReason = entered.trim();
    }

    const previousOrder = order;
    setBusyOperationId(opId);
    setActionError("");
    if (order?.operations) {
      setOrder({ ...order, operations: order.operations.map((operation: any) =>
        operation.id === opId ? { ...operation, status: newStatus, operatorName: currentUser?.name || operation.operatorName } : operation
      ) });
    }

    try {
      const payload: Record<string, unknown> = {
        status: newStatus,
        allowRework,
        rejectReason,
        operatorId: currentUser?.id ? Number(currentUser.id) : undefined,
      };
      const targetOp = previousOrder.operations.find((operation: any) => operation.id === opId);
      if (newStatus === "Completed" && targetOp && !targetOp.actualMinutes) payload.actualMinutes = targetOp.estimatedMinutes || 60;

      const response = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update this operation.");

      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setOrder(previousOrder);
      setActionError(error instanceof Error ? error.message : "Unable to update this operation.");
    } finally {
      setBusyOperationId(null);
    }
  };

  const handleSaveOpDetails = async (opId: number) => {
    try {
      await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qualityNotes: tempNotes,
          actualMinutes: tempActualMins,
        }),
      });
      setEditingOpId(null);
      fetchOrderDetail();
      onRefresh();
    } catch (err) {
      console.error("Failed to save op details", err);
    }
  };

  const handleSwapMachine = async (opId: number, machineId: string) => {
    try {
      await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: machineId ? Number(machineId) : null }),
      });
      fetchOrderDetail();
      onRefresh();
    } catch (err) {
      console.error("Failed to swap machine", err);
    }
  };

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpName) return;
    try {
      await fetch(`/api/operations/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          operationName: newOpName,
          machineId: newOpMachineId ? Number(newOpMachineId) : null,
          estimatedMinutes: Number(newOpMins),
        }),
      });
      setShowAddStep(false);
      setNewOpName("");
      fetchOrderDetail();
      onRefresh();
    } catch (err) {
      console.error("Failed to add new step", err);
    }
  };

  const handleDeleteOperation = async (operation: any) => {
    if (!confirm(`Remove step ${operation.stepOrder}: ${operation.operationName}? Remaining steps will be renumbered.`)) return;
    setActionError("");
    try {
      const response = await fetch(`/api/operations/${operation.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete operation.");
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to delete operation.");
    }
  };

  const handleOrderStatusChange = async (newStatus: string) => {
    if (!newStatus || newStatus === order.status) return;
    setActionError("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to set status to "${newStatus}".`);
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update order status.");
    }
  };

  const handleDeleteOrder = async () => {
    if (!confirm("Are you sure you want to permanently delete this production order?")) return;
    setActionError("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || `Server returned status ${response.status}.`);
      }
      onRefresh();
      onBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete order.");
    }
  };

  const flashAlloc = (msg: string) => {
    setAllocNotice(msg);
    setTimeout(() => setAllocNotice(""), 4000);
  };

  const handleAllocateMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    setAllocError("");

    const qty = Number(allocQty);
    if (!allocItemId) return setAllocError("Choose a stock item to allocate.");
    if (!Number.isFinite(qty) || qty <= 0) return setAllocError("Enter a quantity greater than zero.");

    setAllocBusy(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: Number(allocItemId), quantityUsed: qty }),
      });
      if (!response.ok) {
        let message = `Server returned status ${response.status}.`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch { /* non-JSON body — keep the status message */ }
        throw new Error(message);
      }
      setAllocQty("1");
      await fetchOrderDetail();
      onRefresh();
      flashAlloc("Stock allocated to this order.");
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : "Failed to allocate stock.");
    } finally {
      setAllocBusy(false);
    }
  };

  const handleReleaseMaterial = async (allocationId: number, label: string) => {
    if (!confirm(`Release ${label} back to warehouse stock?`)) return;
    setAllocError("");
    setReleasingId(allocationId);
    try {
      const response = await fetch(`/api/orders/${orderId}/materials?allocationId=${allocationId}`, { method: "DELETE" });
      if (!response.ok) {
        let message = `Server returned status ${response.status}.`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch { /* non-JSON body */ }
        throw new Error(message);
      }
      await fetchOrderDetail();
      onRefresh();
      flashAlloc("Reserved stock returned to warehouse.");
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : "Failed to release stock.");
    } finally {
      setReleasingId(null);
    }
  };

  if (loading || !order) {
    return <div className="p-6 text-slate-400 animate-pulse font-medium">Loading operation workflow...</div>;
  }

  const getStatusBadge = (s: string) => {
    if (s === "Completed") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    if (s === "In Progress") return "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse";
    if (s === "Ready") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
    if (s === "Rejected/Rework") return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
    return "bg-slate-800 text-slate-400 border border-slate-700";
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back Button & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-sm">
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white mb-2 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Orders Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-base font-black text-amber-400">{order.orderNumber}</span>
            <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded uppercase ${
              order.status === "Completed" ? "bg-emerald-500 text-slate-950 font-black" : "bg-amber-500 text-slate-950 font-black"
            }`}>
              {order.status}
            </span>
            <span className="text-xs text-slate-400 font-semibold bg-slate-800 px-2.5 py-0.5 rounded border border-slate-700">
              Priority: <strong className="text-white">{order.priority}</strong>
            </span>
          </div>
          <h1 className="text-xl font-extrabold text-white mt-1 tracking-tight">{order.title}</h1>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
            <span>Client: <strong className="text-slate-200">{order.customerCompany || order.customerName}</strong></span>
            <span>•</span>
            <span>Due Date: <strong className="text-amber-400">{new Date(order.dueDate).toLocaleDateString()}</strong></span>
            {order.totalValue != null && (
              <>
                <span>•</span>
                <span>Quote: <strong className="text-white font-mono font-bold">${Number(order.totalValue).toLocaleString()}</strong></span>
              </>
            )}
          </p>
        </div>

        {/* Action Tabs, Status & Delete */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={order.status || "Pending"}
            onChange={(e) => handleOrderStatusChange(e.target.value)}
            title="Change order status (Completed consumes reserved materials; On Hold / Cancelled releases them)"
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {["Pending", "In Production", "Quality Review", "Completed", "On Hold", "Cancelled"].map((s) => (
              <option key={s} value={s} className="bg-slate-900 text-white">
                {s}
              </option>
            ))}
          </select>
          <div className="flex items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("workflow")}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                activeTab === "workflow" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Machine Routing</span>
            </button>
            <button
              onClick={() => setActiveTab("materials")}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                activeTab === "materials" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4" />
              <span>BOM Materials ({order.materials?.length || 0})</span>
            </button>
          </div>

          <button
            onClick={handleDeleteOrder}
            className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 transition"
            title="Delete Production Order"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress & Conveyor Banner */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Operational Workflow Conveyor</span>
          </div>
          <span className="text-xs font-mono font-black text-amber-400">
            {order.operations?.filter((o: any) => o.status === "Completed").length} / {order.operations?.length} operations finished ({order.progressPercent}%)
          </span>
        </div>
        <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              order.progressPercent === 100 ? "bg-emerald-500 shadow-md shadow-emerald-500/50" : "bg-gradient-to-r from-amber-600 via-amber-500 to-amber-300"
            }`} 
            style={{ width: `${order.progressPercent || 0}%` }} 
          />
        </div>
        {order.notes && (
          <div className="mt-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-300">
            <strong className="text-amber-400 font-bold">Client / Engineering Notes:</strong> {order.notes}
          </div>
        )}
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm font-bold text-rose-200" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />{actionError}</span>
          <button onClick={() => setActionError("")} className="rounded-lg px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20">Dismiss</button>
        </div>
      )}

      {/* TAB CONTENT */}
      {activeTab === "workflow" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Sequential Manufacturing Operations</h3>
            <button
              onClick={() => setShowAddStep(true)}
              className="bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs px-3.5 py-1.5 rounded-xl border border-slate-700 transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Insert Operation Step
            </button>
          </div>

          <div className="space-y-4 relative before:absolute before:left-6 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-800">
            {order.operations?.map((op: any, index: number) => {
              const isCompleted = op.status === "Completed";
              const isRunning = op.status === "In Progress";
              const isReady = op.status === "Ready";
              const isEditing = editingOpId === op.id;

              return (
                <div 
                  key={op.id}
                  className={`relative pl-14 transition-all duration-200 ${
                    isRunning ? "translate-x-1" : ""
                  }`}
                >
                  {/* Timeline Icon */}
                  <div className={`absolute left-2.5 top-5 w-7 h-7 rounded-full border-2 flex items-center justify-center font-black text-xs transition z-10 shadow-lg ${
                    isCompleted ? "bg-emerald-500 border-emerald-400 text-slate-950" :
                    isRunning ? "bg-amber-500 border-amber-300 text-slate-950 animate-bounce" :
                    isReady ? "bg-blue-500 border-blue-400 text-white" :
                    "bg-slate-900 border-slate-700 text-slate-500"
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4 stroke-[3]" /> : index + 1}
                  </div>

                  {/* Operation Card */}
                  <div className={`p-5 rounded-2xl border transition shadow-sm ${
                    isRunning 
                      ? "bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 border-amber-500 shadow-amber-950/30 shadow-md" 
                      : isCompleted
                      ? "bg-slate-900/60 border-emerald-500/20 opacity-90"
                      : "bg-slate-900/90 border-slate-800/80 hover:border-slate-700"
                  }`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Title & Status */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                          <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded uppercase ${getStatusBadge(op.status)}`}>
                            {op.status}
                          </span>
                          <span className="text-xs text-slate-500 font-medium">Step #{op.stepOrder}</span>
                        </div>
                        <h4 className={`text-base font-extrabold tracking-tight ${
                          isRunning ? "text-amber-300 font-black" : isCompleted ? "text-emerald-300" : "text-white"
                        }`}>
                          {op.operationName}
                        </h4>

                        {/* Assigned Station Swap Dropdown */}
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                          <div className="flex items-center gap-1 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                            <Cpu className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-slate-500 font-semibold">Station:</span>
                            <select
                              value={op.machineId || ""}
                              onChange={(e) => handleSwapMachine(op.id, e.target.value)}
                              className="bg-transparent font-bold text-white focus:outline-none cursor-pointer text-xs"
                            >
                              <option value="">Unassigned</option>
                              {machines.map(m => (
                                <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                                  {m.code} ({m.name})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            <span>Est: <strong className="text-slate-200 font-mono">{op.estimatedMinutes}m</strong></span>
                            {op.actualMinutes > 0 && (
                              <span className="text-emerald-400 font-mono"> | Actual: {op.actualMinutes}m</span>
                            )}
                          </div>

                          {op.operatorName && (
                            <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-0.5 rounded text-[11px] text-slate-300">
                              <User className="w-3 h-3 text-emerald-400" />
                              <span>Operator: <strong>{op.operatorName}</strong></span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Operator Touch Actions */}
                      <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0 pt-3 lg:pt-0 border-t lg:border-0 border-slate-800">
                        {/* Start / Pause / Complete Action Buttons */}
                        {(op.status === "Ready" || op.status === "Rejected/Rework") && (
                          <button
                            onClick={() => handleUpdateOpStatus(op.id, "In Progress")}
                            disabled={busyOperationId !== null}
                            className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-md shadow-amber-600/20 transition active:scale-95 disabled:opacity-40"
                          >
                            <Play className="w-4 h-4 fill-slate-950 stroke-[2]" />
                            <span>{op.status === "Rejected/Rework" ? "START REWORK" : "START STATION"}</span>
                          </button>
                        )}
                        {op.status === "Pending" && (
                          <span className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-500">
                            <Clock className="h-3.5 w-3.5" /> Locked by previous step
                          </span>
                        )}

                        {isRunning && (
                          <>
                            <button
                              onClick={() => handleUpdateOpStatus(op.id, "Completed")}
                              disabled={busyOperationId !== null}
                              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition animate-pulse active:scale-95 disabled:opacity-40"
                            >
                              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                              <span>COMPLETE & ADVANCE NEXT</span>
                            </button>
                            <button
                              onClick={() => handleUpdateOpStatus(op.id, "Ready")}
                              disabled={busyOperationId !== null}
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition disabled:opacity-40"
                              title="Pause Operation"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          </>
                        )}

                        {isCompleted && (
                          <button
                            onClick={() => handleUpdateOpStatus(op.id, "In Progress", true)}
                            disabled={busyOperationId !== null}
                            className="text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700 flex items-center gap-1 transition disabled:opacity-40"
                            title="Re-open Step for Rework"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                            <span>Re-open</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingOpId(null);
                            } else {
                              setEditingOpId(op.id);
                              setTempNotes(op.qualityNotes || "");
                              setTempActualMins(op.actualMinutes || op.estimatedMinutes || 60);
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition"
                        >
                          {isEditing ? "Close" : "Log QA & Mins"}
                        </button>

                        <button
                          onClick={() => handleUpdateOpStatus(op.id, "Rejected/Rework")}
                          disabled={busyOperationId !== null}
                          className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 transition disabled:opacity-40"
                          title="Mark Rejected / Quality Rework"
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                        {currentUser?.role === "Manager" && (op.status === "Pending" || op.status === "Ready" || op.status === "Rejected/Rework") && (
                          <button
                            onClick={() => handleDeleteOperation(op)}
                            className="p-2 bg-slate-950 hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 rounded-xl border border-slate-700 transition"
                            title="Remove unscheduled operation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Editor for QA & Minutes */}
                    {isEditing && (
                      <div className="mt-4 p-4 bg-slate-950 rounded-xl border border-amber-500/40 space-y-3">
                        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                          Operator Quality Check & Time Logging
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                          <div className="sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Actual Mins Taken</label>
                            <input
                              type="number"
                              value={tempActualMins}
                              onChange={(e) => setTempActualMins(Number(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-xs font-semibold text-slate-400 mb-1">QA Inspector / Operator Notes</label>
                            <input
                              type="text"
                              placeholder="e.g. Clean laser cuts, tolerance +-0.1mm verified."
                              value={tempNotes}
                              onChange={(e) => setTempNotes(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleSaveOpDetails(op.id)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition shadow"
                          >
                            <Save className="w-3.5 h-3.5" /> Save Quality Record
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Display QA notes if present and not editing */}
                    {!isEditing && op.qualityNotes && (
                      <div className="mt-3 text-xs bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span><strong>QA Log:</strong> {op.qualityNotes}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* MATERIALS / BOM TAB — interactive stock allocator */
        (() => {
          const materials: any[] = order.materials ?? [];
          const totalCost = materials.reduce(
            (sum, m) => sum + (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0"),
            0,
          );
          const allocatedItemIds = new Set(materials.map((m) => m.itemId));
          const selectedItem = inventoryItems.find((i) => String(i.id) === allocItemId);
          const existingForSelected = selectedItem ? materials.find((m) => m.itemId === selectedItem.id) : null;
          const alreadyReserved = existingForSelected?.quantityUsed ?? 0;
          const requestedQty = Number(allocQty) || 0;
          const delta = requestedQty - alreadyReserved;
          const wouldExceedStock = selectedItem && delta > 0 && selectedItem.stockQuantity < delta;

          return (
            <div className="space-y-4">
              {/* Materials Status Banner */}
              {(() => {
                const status: string = order.materialsStatus || "unknown";
                const bannerMap: Record<string, { bg: string; text: string; border: string; label: string }> = {
                  unknown:        { bg: "bg-slate-800/30", text: "text-slate-300", border: "border-slate-700", label: "No materials allocated" },
                  in_stock:       { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30", label: "All materials in stock" },
                  partial:        { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/30", label: "Partial shortage" },
                  out_of_stock:   { bg: "bg-rose-500/15", text: "text-rose-200", border: "border-rose-500/40", label: "Out of stock" },
                  consumed:       { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30", label: "Materials fully consumed (order complete)" },
                };
                const b = bannerMap[status] || bannerMap.unknown;
                return (
                  <div className={`flex items-center justify-between gap-3 ${b.bg} ${b.text} border ${b.border} rounded-2xl px-4 py-2.5`}>
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <Boxes className="w-4 h-4" />
                      Stock status: {b.label}
                    </div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-70">{status}</span>
                  </div>
                );
              })()}

              {/* Allocator */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                      <Boxes className="w-5 h-5 text-amber-400" /> Allocate stock to this order
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Reserves inventory against the order. Stock is consumed automatically when the order is marked Completed.
                    </p>
                  </div>
                  {materials.length > 0 && (
                    <div className="text-right rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5">
                      <div className="text-[10px] font-bold uppercase text-slate-500">BOM total</div>
                      <div className="font-mono text-sm font-black text-emerald-400 flex items-center gap-1 justify-end">
                        <DollarSign className="w-3.5 h-3.5" />
                        {totalCost.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>

                {(allocError || allocNotice) && (
                  <div
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${
                      allocError
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    }`}
                    role="status"
                  >
                    <span className="flex items-center gap-2">
                      {allocError ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      {allocError || allocNotice}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setAllocError(""); setAllocNotice(""); }}
                      className="rounded-lg px-2 py-0.5 text-xs hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {inventoryItems.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-600 stroke-[1.5]" />
                    No stock items are registered yet — add materials in the Wood &amp; Edge Stock tab first.
                  </div>
                ) : !canManageBom ? (
                  <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400">
                    Read-only view. Manager, Sales Coordinator or QA &amp; Dispatch roles can allocate stock.
                  </p>
                ) : (
                  <form onSubmit={handleAllocateMaterial} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-3 items-end">
                    <div>
                      <label htmlFor="alloc-item" className="block text-xs font-bold text-slate-300 mb-1.5">Stock item</label>
                      <select
                        id="alloc-item"
                        value={allocItemId}
                        onChange={(e) => { setAllocItemId(e.target.value); setAllocError(""); }}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="">— Choose warehouse item —</option>
                        {inventoryItems.map((item) => {
                          const already = allocatedItemIds.has(item.id) ? " · already on BOM" : "";
                          const low = item.stockQuantity <= item.reorderLevel ? " · LOW STOCK" : "";
                          return (
                            <option key={item.id} value={item.id}>
                              {item.sku} — {item.name} ({item.stockQuantity} {item.unit} in stock{low}{already})
                            </option>
                          );
                        })}
                      </select>
                      {selectedItem && (
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          {selectedItem.stockQuantity} {selectedItem.unit} on hand · unit cost
                          <span className="ml-1 font-mono font-bold text-slate-200">${Number(selectedItem.unitCost).toFixed(2)}</span>
                          {alreadyReserved > 0 && (
                            <span className="ml-2 text-amber-400">Already reserved to this order: {alreadyReserved}</span>
                          )}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="alloc-qty" className="block text-xs font-bold text-slate-300 mb-1.5">Quantity</label>
                      <input
                        id="alloc-qty"
                        type="number"
                        min={1}
                        step={1}
                        value={allocQty}
                        onChange={(e) => setAllocQty(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                      />
                      {selectedItem && (
                        <p className={`mt-1.5 text-[11px] font-mono ${wouldExceedStock ? "text-rose-400" : "text-slate-500"}`}>
                          Line cost: ${(requestedQty * parseFloat(selectedItem.unitCost || "0")).toFixed(2)}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={allocBusy || !selectedItem || Boolean(wouldExceedStock)}
                      className="h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
                    >
                      {allocBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 stroke-[2.5]" />}
                      {existingForSelected ? "Update reservation" : "Allocate stock"}
                    </button>
                  </form>
                )}
              </div>

              {/* BOM list */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-extrabold text-white">Reserved on this order</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {materials.length === 0
                        ? "Nothing reserved yet."
                        : `${materials.length} item${materials.length === 1 ? "" : "s"} · ${materials.reduce((s, m) => s + m.quantityUsed, 0)} unit(s) held for production.`}
                    </p>
                  </div>
                </div>

                {materials.length === 0 ? (
                  <div className="py-10 text-center text-slate-500 text-xs">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-600 stroke-[1.5]" />
                    No materials allocated to this specific order yet.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {materials.map((m: any) => {
                      const lineTotal = (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0");
                      const label = `${m.itemSku ?? "item"} × ${m.quantityUsed} ${m.itemUnit ?? ""}`.trim();
                      const isConsumed = !!m.consumed;
                      const isReleased = !!m.released;
                      const remaining = (m.itemStockRemaining !== null && m.itemStockRemaining !== undefined)
                        ? Number(m.itemStockRemaining)
                        : null;
                      return (
                        <li
                          key={m.id}
                          className={`p-3.5 border rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isReleased
                              ? "bg-slate-950/40 border-slate-800/60 opacity-60"
                              : isConsumed
                              ? "bg-blue-500/5 border-blue-500/20"
                              : "bg-slate-950/60 border-slate-800"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-amber-400">{m.itemSku ?? "—"}</span>
                              <span className="font-bold text-white text-sm truncate">{m.itemName ?? "Unknown item"}</span>
                              {m.itemCategory && (
                                <span className="text-[10px] font-semibold text-slate-500">{m.itemCategory}</span>
                              )}
                              {isConsumed && (
                                <span className="text-[10px] font-extrabold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">Consumed</span>
                              )}
                              {isReleased && (
                                <span className="text-[10px] font-extrabold uppercase bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Released</span>
                              )}
                            </div>
                            {remaining !== null && !isReleased && (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Warehouse remaining after this reservation:
                                <span className={`ml-1 font-mono font-bold ${remaining <= (m.itemReorderLevel ?? 0) ? "text-rose-400" : "text-slate-300"}`}>
                                  {remaining} {m.itemUnit ?? ""}
                                </span>
                                {remaining <= (m.itemReorderLevel ?? 0) && (
                                  <span className="ml-1 text-rose-400">· at reorder level</span>
                                )}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-black text-white font-mono">
                                {m.quantityUsed} {m.itemUnit}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                @ ${Number(m.costPerUnit).toFixed(2)} · ${lineTotal.toFixed(2)}
                              </div>
                            </div>
                            {canManageBom && !isConsumed && !isReleased && (
                              <button
                                type="button"
                                onClick={() => handleReleaseMaterial(m.id, label)}
                                disabled={releasingId === m.id}
                                className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition disabled:opacity-40"
                                title="Release back to warehouse stock"
                                aria-label={`Release ${label}`}
                              >
                                {releasingId === m.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* ADD STEP MODAL */}
      {showAddStep && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-500" /> Insert Operation Step
            </h3>
            <form onSubmit={handleAddStep} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Operation Description</label>
                <input
                  type="text"
                  placeholder="e.g. Dowel Insertion & Pneumatic Clamp Press"
                  value={newOpName}
                  onChange={(e) => setNewOpName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Target Machine Station</label>
                <select
                  value={newOpMachineId}
                  onChange={(e) => setNewOpMachineId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="">Any Shop Floor Station</option>
                  {machines.map(m => (
                    <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Estimated Minutes</label>
                <input
                  type="number"
                  value={newOpMins}
                  onChange={(e) => setNewOpMins(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddStep(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md"
                >
                  Add Step
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
