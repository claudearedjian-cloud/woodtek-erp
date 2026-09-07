"use client";

import React, { useState } from "react";
import { 
  Cpu, 
  Plus, 
  Wrench, 
  User, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  DollarSign, 
  Layers, 
  Settings,
  Trash2,
  X,
  Filter,
  Activity
} from "lucide-react";

interface MachinesViewProps {
  machines: any[];
  loading: boolean;
  onRefresh: () => void;
  users: any[];
  onSelectOrder: (orderId: number) => void;
}

export default function MachinesView({
  machines = [],
  loading,
  onRefresh,
  users = [],
  onSelectOrder,
}: MachinesViewProps) {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showAddModal, setShowAddModal] = useState(false);
  
  // New machine state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("CNC Router");
  const [hourlyCost, setHourlyCost] = useState("75.00");
  const [location, setLocation] = useState("Bay A - Milling Cell");
  const [assignedOperatorId, setAssignedOperatorId] = useState(users[0]?.id || "");
  const [notes, setNotes] = useState("");

  const categories = ["All", "Beam Saw", "Edge Bander", "CNC Router", "Press", "Panel Saw", "Drill Press", "Spray & Finish", "Assembly Table"];
  
  const filteredMachines = categoryFilter === "All" ? machines : machines.filter(m => m.category === categoryFilter);

  const handleStatusChange = async (machineId: number, newStatus: string) => {
    try {
      await fetch(`/api/machines/${machineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      onRefresh();
    } catch (err) {
      console.error("Failed to change machine status", err);
    }
  };

  const handleAssignOperator = async (machineId: number, operatorId: string) => {
    try {
      const res = await fetch(`/api/machines/${machineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedOperatorId: operatorId ? Number(operatorId) : null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reassign operator");
      }
      onRefresh();
    } catch (err) {
      console.error("Failed to reassign operator", err);
      alert(`Could not reassign operator: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleCreateMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !code) return;
    try {
      const res = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code,
          category,
          hourlyCost,
          location,
          assignedOperatorId: assignedOperatorId ? Number(assignedOperatorId) : null,
          notes,
          status: "Active"
        }),
      });
      if (!res.ok) throw new Error("Failed to add machine");
      setShowAddModal(false);
      setName("");
      setCode("");
      setNotes("");
      onRefresh();
    } catch (err) {
      console.error("Failed to create machine", err);
      alert("Error registering machine. Code must be unique.");
    }
  };

  const handleDeleteMachine = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}? Queued jobs will be marked as unassigned.`)) return;
    try {
      await fetch(`/api/machines/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error("Failed to delete machine", err);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading shop floor monitors…</h2>
        </div>
        <div className="h-16 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-56 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-4 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-amber-500" /> Equipment:
          </span>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                categoryFilter === c
                  ? "bg-blue-600 text-white font-extrabold shadow-sm shadow-blue-600/30"
                  : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold px-4 py-2 rounded-xl shadow-lg shadow-blue-600/20 transition text-xs whitespace-nowrap"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Register Machine</span>
        </button>
      </div>

      {/* Machine Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredMachines.map((m) => {
          const isMaintenance = m.status === "Maintenance";
          const isInUse = m.status === "In-Use" || (m.status === "Active" && m.activeJob);
          const isOffline = m.status === "Offline";
          
          return (
            <div 
              key={m.id}
              className={`bg-slate-900/90 border rounded-2xl p-5 shadow-sm transition flex flex-col justify-between ${
                isMaintenance ? "border-rose-500/40 bg-gradient-to-b from-slate-900 to-rose-950/10" :
                isInUse ? "border-amber-500/40 shadow-md shadow-amber-950/10" : "border-slate-800/80 hover:border-slate-700"
              }`}
            >
              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center font-mono font-black text-amber-400 text-xs shadow-inner">
                      {m.code.split("-")[0] || "M"}
                    </span>
                    <div>
                      <span className="font-mono text-xs font-black text-amber-400 block">{m.code}</span>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block">{m.category}</span>
                    </div>
                  </div>

                  {/* Status Pill & Switcher */}
                  <select
                    value={m.status}
                    onChange={(e) => handleStatusChange(m.id, e.target.value)}
                    className={`text-xs font-black px-3 py-1 rounded-xl uppercase tracking-wider cursor-pointer focus:outline-none transition ${
                      isMaintenance ? "bg-rose-500 text-slate-950" :
                      isInUse ? "bg-amber-500 text-slate-950 animate-pulse" :
                      isOffline ? "bg-slate-800 text-slate-400" :
                      "bg-emerald-500 text-slate-950"
                    }`}
                  >
                    <option value="Active" className="bg-slate-900 text-emerald-400 font-bold">Active</option>
                    <option value="In-Use" className="bg-slate-900 text-amber-400 font-bold">In-Use</option>
                    <option value="Maintenance" className="bg-slate-900 text-rose-400 font-bold">Maintenance</option>
                    <option value="Offline" className="bg-slate-900 text-slate-400 font-bold">Offline</option>
                  </select>
                </div>

                <h3 className="text-base font-extrabold text-white tracking-tight line-clamp-1 mb-2">
                  {m.name}
                </h3>
                
                <div className="flex items-center justify-between text-xs text-slate-400 pb-3 border-b border-slate-800">
                  <span className="text-slate-300 font-semibold">{m.location}</span>
                  <span className="font-mono font-bold text-white">${m.hourlyCost}/hr</span>
                </div>

                {/* Active Job or Queue */}
                <div className="py-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider">
                    <span>Workstation Schedule</span>
                    <span className="text-amber-400">{m.queueCount} items ({m.totalQueueMinutes}m)</span>
                  </div>

                  {m.activeJob ? (
                    <div 
                      onClick={() => onSelectOrder(m.activeJob.orderId)}
                      className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl cursor-pointer hover:bg-amber-500/20 transition group"
                    >
                      <div className="flex items-center gap-2 mb-1 text-[10px] font-black uppercase tracking-wider text-amber-400">
                        <Activity className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        <span>Running Now</span>
                      </div>
                      <div className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition">
                        {m.activeJob.orderNumber} • {m.activeJob.orderTitle}
                      </div>
                    </div>
                  ) : m.queueCount > 0 ? (
                    <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-300">
                      <strong className="text-emerald-400 font-bold">{m.readyQueueCount} jobs ready to run</strong> in line.
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 text-center text-xs text-slate-500 italic">
                      Station free. No queued jobs.
                    </div>
                  )}

                  {m.notes && (
                    <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                      <Wrench className="w-3 h-3 inline text-slate-400 mr-1" /> {m.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Card Footer */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0 text-slate-300 flex-1">
                  <User className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  <select
                    value={m.assignedOperatorId ?? ""}
                    onChange={(e) => handleAssignOperator(m.id, e.target.value)}
                    className={`bg-transparent border-0 text-xs font-semibold truncate focus:outline-none cursor-pointer min-w-0 max-w-[160px] ${
                      m.assignedOperatorId
                        ? "text-slate-200"
                        : "text-slate-500 italic"
                    }`}
                    title="Click to assign an operator to this machine"
                  >
                    <option value="" className="bg-slate-900 text-slate-400 italic">Unassigned</option>
                    {users
                      .filter(u => u.role === "Machine Operator" || u.role === "Technician" || u.role === "Manager")
                      .map(u => (
                        <option key={u.id} value={u.id} className="bg-slate-900 text-white">
                          {u.name} ({u.role})
                        </option>
                      ))}
                  </select>
                </div>

                <button
                  onClick={() => handleDeleteMachine(m.id, m.name)}
                  className="p-1.5 hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 rounded-lg transition"
                  title="Remove Equipment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* REGISTER MACHINE MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-blue-400" />
                <span>Register Shop Floor Machine</span>
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMachine} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Machine Code *</label>
                  <input
                    type="text"
                    placeholder="e.g. CNC-03 or EDGE-03"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Machine Type</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {categories.filter(c => c !== "All").map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Equipment Brand & Model *</label>
                <input
                  type="text"
                  placeholder="e.g. Holz-Her Lumina 1380 Laser Edge Bander"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Hourly Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={hourlyCost}
                    onChange={(e) => setHourlyCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Shop Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Assigned Primary Operator</label>
                <select
                  value={assignedOperatorId}
                  onChange={(e) => setAssignedOperatorId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="">No dedicated operator</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Maintenance / Technical Notes</label>
                <textarea
                  placeholder="Spindle RPM tolerances, lubricant schedules..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white h-20"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-blue-600/30 transition"
                >
                  Register Station
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
