"use client";

import React, { useEffect, useState } from "react";
import { 
  ClipboardList, 
  Plus, 
  Filter, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  ChevronRight, 
  Layers, 
  Cpu, 
  User, 
  Calendar, 
  DollarSign,
  Search,
  ArrowUpRight,
  LayoutGrid,
  List,
  Sparkles,
  X,
  Trash2,
  Wrench,
  ChevronUp,
  ChevronDown,
  Save
} from "lucide-react";

interface OrdersViewProps {
  orders: any[];
  loading: boolean;
  onSelectOrder: (orderId: number) => void;
  onRefresh: () => void;
  showNewModal: boolean;
  setShowNewModal: (val: boolean) => void;
  customers: any[];
  templates: any[];
  machines: any[];
  searchQuery?: string;
}

export default function OrdersView({
  orders = [],
  loading,
  onSelectOrder,
  onRefresh,
  showNewModal,
  setShowNewModal,
  customers = [],
  templates = [],
  machines = [],
  searchQuery = "",
}: OrdersViewProps) {
  const [viewMode, setViewMode] = useState<"kanban" | "list">("list");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");

  // Form State for new order
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("Custom Kitchens");
  const [priority, setPriority] = useState("Normal");
  const [totalValue, setTotalValue] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Routing: a recipe loads a chain of editable steps. Each step carries the
  // exact machine (Beam Saw / Rover A vs G vs Baz / Orma) the operator chose.
  type StepDraft = { operationName: string; machineId: string; machineCategory: string; estimatedMinutes: string };
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [recipeId, setRecipeId] = useState<string>("");
  const [recipeName, setRecipeName] = useState("");

  const machineCategories = Array.from(new Set((machines || []).map((m: any) => m.category).filter(Boolean))).sort();

  const machineForCategory = (cat: string) => {
    if (!machines?.length) return null;
    return (
      machines.find((m: any) => m.category === cat) ||
      machines.find((m: any) => String(m.category || "").toLowerCase().includes(String(cat || "").toLowerCase())) ||
      machines[0]
    );
  };

  const blankStep = (): StepDraft => {
    const first = machines[0];
    return { operationName: "", machineId: first ? String(first.id) : "", machineCategory: first ? first.category : "", estimatedMinutes: "60" };
  };

  const loadRecipe = (tpl: any) => {
    setRecipeId(String(tpl.id));
    const loaded: StepDraft[] = (Array.isArray(tpl.defaultStepsJson) ? tpl.defaultStepsJson : []).map((s: any) => {
      const m = machineForCategory(s.machineCategory);
      return {
        operationName: s.operationName || "New Operation",
        machineId: m ? String(m.id) : "",
        machineCategory: s.machineCategory || (m ? m.category : machineCategories[0] || ""),
        estimatedMinutes: String(s.estimatedMinutes || 60),
      };
    });
    setSteps(loaded.length > 0 ? loaded : [blankStep()]);
  };

  const addStep = () => setSteps(s => [...s, blankStep()]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps(s => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const updateStep = (i: number, field: keyof StepDraft, val: string) =>
    setSteps(s => s.map((st, idx) => {
      if (idx !== i) return st;
      if (field === "machineId") {
        const m = machines.find((mm: any) => String(mm.id) === String(val));
        return { ...st, machineId: val, machineCategory: m ? m.category : st.machineCategory };
      }
      return { ...st, [field]: val };
    }));

  useEffect(() => {
    if (!customerId && customers[0]?.id) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  // Filtered orders
  const filteredOrders = orders.filter(order => {
    const matchesSearch = !searchQuery || 
      order.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (order.customerCompany && order.customerCompany.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === "All" || order.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || order.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId || !title) {
      setErrorMsg("Please select a customer and provide a project title.");
      return;
    }
    const validSteps = steps.filter(s => s.operationName.trim());
    if (validSteps.length === 0) {
      setErrorMsg("Add at least one routing step (or pick a recipe).");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const payload: any = {
        customerId: Number(customerId),
        title,
        projectType,
        priority,
        totalValue: totalValue || "0.00",
        dueDate: new Date(dueDate),
        notes,
        customSteps: validSteps.map(s => ({
          operationName: s.operationName.trim(),
          machineId: s.machineId ? Number(s.machineId) : null,
          estimatedMinutes: Number(s.estimatedMinutes) || 60,
        })),
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create order");
      }

      setShowNewModal(false);
      setTitle("");
      setTotalValue("");
      setNotes("");
      setSteps([]);
      setRecipeId("");
      setRecipeName("");
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create order");
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveAsRecipe = async () => {
    const validSteps = steps.filter(s => s.operationName.trim());
    if (validSteps.length === 0) {
      setErrorMsg("Add steps before saving a recipe.");
      return;
    }
    const name = recipeName.trim();
    if (!name) {
      setErrorMsg("Type a recipe name before saving.");
      return;
    }
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: "Saved from order entry",
          defaultStepsJson: validSteps.map((s, i) => ({
            stepOrder: i + 1,
            operationName: s.operationName.trim(),
            machineCategory: s.machineCategory,
            estimatedMinutes: Number(s.estimatedMinutes) || 60,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save recipe");
      }
      setRecipeName("");
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save recipe");
    }
  };

  const getPriorityBadge = (p: string) => {
    if (p === "Urgent") return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
    if (p === "High") return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
    return "bg-slate-800 text-slate-300 border border-slate-700";
  };

  const getStatusBadge = (s: string) => {
    if (s === "Completed") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (s === "In Production") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    if (s === "Quality Review") return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    if (s === "On Hold") return "bg-rose-500/20 text-rose-300 border-rose-500/30";
    return "bg-slate-800 text-slate-300 border-slate-700";
  };

  const isOverdue = (order: any) =>
    order.status !== "Completed" && new Date(order.dueDate).getTime() < Date.now();

  const kanbanColumns = [
    { title: "Pending Start", status: "Pending", color: "border-slate-600" },
    { title: "In Production", status: "In Production", color: "border-amber-500" },
    { title: "Quality Review", status: "Quality Review", color: "border-purple-500" },
    { title: "Completed & Ready", status: "Completed", color: "border-emerald-500" },
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading orders…</h2>
        </div>
        <div className="h-16 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-4 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-amber-500" /> Status:
          </span>
          {["All", "Pending", "In Production", "Quality Review", "Completed", "On Hold", "Cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                statusFilter === s
                  ? "bg-amber-500 text-slate-950 font-extrabold shadow-sm"
                  : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Priority Toggle */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="All">Priority: All</option>
            <option value="Urgent">Priority: Urgent</option>
            <option value="High">Priority: High</option>
            <option value="Normal">Priority: Normal</option>
          </select>

          {/* View Toggle */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 rounded-lg p-1.5 text-xs font-bold transition ${
                viewMode === "list" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
              title="List View"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1 rounded-lg p-1.5 text-xs font-bold transition ${
                viewMode === "kanban" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
              title="Kanban Board"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Results count */}
          <span className="rounded-full border border-slate-700/70 bg-slate-800/50 px-3 py-1 text-[11px] font-bold text-slate-300">
            {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"}
          </span>
        </div>
      </div>

      {/* Empty State */}
      {filteredOrders.length === 0 ? (
        <div className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-800/80 bg-slate-900/90 p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/60">
            <ClipboardList className="h-8 w-8 text-amber-500/80 stroke-[1.5]" />
          </div>
          <h3 className="mb-1 text-lg font-bold text-white">No Orders Matching Filter</h3>
          <p className="mb-6 text-xs text-slate-400">
            There are currently no manufacturing orders matching your criteria. Try resetting filters or create a new order to schedule operations.
          </p>
          <button
            onClick={() => { setStatusFilter("All"); setPriorityFilter("All"); setShowNewModal(true); }}
            className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 transition hover:from-amber-300 hover:to-amber-500"
          >
            + Create Production Order
          </button>
        </div>
      ) : viewMode === "list" ? (
        /* LIST VIEW */
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => onSelectOrder(order.id)}
              className="group flex cursor-pointer flex-col justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm transition-all duration-150 hover:border-amber-500/50 hover:bg-slate-800/70 md:flex-row md:items-center"
            >
              {/* Left Order Info */}
              <div className="flex items-start md:items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 flex items-center justify-center flex-shrink-0 font-mono font-black text-amber-400 text-xs shadow-inner">
                  {order.orderNumber.split("-")[2] || "ORD"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-black text-amber-400">{order.orderNumber}</span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${getStatusBadge(order.status)}`}>
                      {order.status}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${getPriorityBadge(order.priority)}`}>
                      {order.priority}
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium hidden lg:inline-block">
                      • {order.projectType}
                    </span>
                  </div>
                  <h3 className="font-bold text-white text-base truncate group-hover:text-amber-300 transition">
                    {order.title}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
                    <span className="font-semibold text-slate-300 flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-500" /> {order.customerCompany || order.customerName}
                    </span>
                    <span className={`flex items-center gap-1 ${isOverdue(order) ? "font-bold text-rose-300" : "text-slate-400"}`}>
                      <Calendar className={`h-3.5 w-3.5 ${isOverdue(order) ? "text-rose-400" : "text-slate-500"}`} />
                      Due: {new Date(order.dueDate).toLocaleDateString()}
                      {isOverdue(order) && " · overdue"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center: Current Machine Station & Progress Bar */}
              <div className="w-full md:w-64 flex-shrink-0 flex flex-col justify-center">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-400 font-medium flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-blue-400" /> Station:
                  </span>
                  <span className="font-bold text-white truncate max-w-[140px]">
                    {order.currentStation ? order.currentStation.machineCode : "Scheduled"}
                  </span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      order.progressPercent === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-amber-600 to-amber-400"
                    }`} 
                    style={{ width: `${order.progressPercent || 0}%` }} 
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mt-1">
                  <span>{order.completedSteps} of {order.totalSteps} ops done</span>
                  <span className={order.progressPercent === 100 ? "text-emerald-400 font-extrabold" : "text-amber-400"}>
                    {order.progressPercent || 0}%
                  </span>
                </div>
              </div>

              {/* Right Value & Arrow */}
              <div className="flex items-center justify-between md:justify-end gap-6 flex-shrink-0 border-t md:border-0 pt-3 md:pt-0 border-slate-800">
                <div className="text-right">
                  <div className="text-sm font-black text-white font-mono">
                    {order.totalValue != null ? `$${Number(order.totalValue).toLocaleString()}` : <span className="text-slate-600 italic text-[10px]">restricted</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Total Value</div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-slate-800 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-400 flex items-center justify-center transition-all">
                  <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-8">
          {kanbanColumns.map((col) => {
            const colOrders = filteredOrders.filter(o => o.status === col.status);
            return (
              <div key={col.status} className="flex flex-col bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
                <div className={`flex items-center justify-between pb-3 mb-3 border-b-2 ${col.color}`}>
                  <span className="font-extrabold text-sm text-white tracking-tight">{col.title}</span>
                  <span className="bg-slate-800 text-slate-200 text-xs font-mono font-bold px-2 py-0.5 rounded">
                    {colOrders.length}
                  </span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[680px] pr-1">
                  {colOrders.map(order => (
                    <div
                      key={order.id}
                      onClick={() => onSelectOrder(order.id)}
                      className="p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 rounded-xl transition cursor-pointer shadow-sm group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[11px] font-extrabold text-amber-400">{order.orderNumber}</span>
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase ${getPriorityBadge(order.priority)}`}>
                          {order.priority}
                        </span>
                      </div>
                      <h4 className="font-bold text-white text-sm line-clamp-2 group-hover:text-amber-300 transition mb-2">
                        {order.title}
                      </h4>
                      <div className="text-[11px] text-slate-400 font-semibold mb-3 truncate">
                        {order.customerCompany || order.customerName}
                      </div>
                      
                      {/* Station pill & progress */}
                      <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80 text-[11px] mb-2">
                        <div className="flex items-center justify-between text-slate-300">
                          <span className="text-slate-500">Station:</span>
                          <span className="font-bold text-amber-400">{order.currentStation?.machineCode || "Ready"}</span>
                        </div>
                        <div className="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
                          <div className="bg-amber-500 h-full rounded-full" style={{ width: `${order.progressPercent}%` }} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                        <span>Due {new Date(order.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        <span className="font-black text-white font-mono">{order.totalValue != null ? `$${Number(order.totalValue).toLocaleString()}` : "—"}</span>
                      </div>
                    </div>
                  ))}
                  {colOrders.length === 0 && (
                    <div className="py-12 text-center text-slate-600 text-xs font-medium italic">
                      No orders in {col.title}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE ORDER MODAL WITH TEMPLATE SWITCHER */}
      {showNewModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
          <div className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <span>New Production Order & Routing</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Define customer project details and choose a manufacturing machine flow.</p>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
              {errorMsg && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Customer Select */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Client / Architect *</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company} ({c.name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Project Type */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Project Category</label>
                  <select
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Custom Hospitality Furniture">Hospitality Furniture</option>
                    <option value="Custom Kitchens">Custom Kitchens & Pantry</option>
                    <option value="Wardrobe Fit-out">Wardrobe & Closet Fit-out</option>
                    <option value="Commercial Office & Retail">Commercial Office & Retail</option>
                    <option value="Precision Sizing & Banding Only">Express Trade Cutting & Banding</option>
                  </select>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Project Title & Description *</label>
                <input
                  type="text"
                  placeholder="e.g. 24 Executive Mahogany Conference Tables & Paneling"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Priority */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Priority Level</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>

                {/* Total Value */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Total Quote Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 14500.00"
                    value={totalValue}
                    onChange={(e) => setTotalValue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Target Due Date *</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              {/* MACHINE ROUTING: RECIPES + STEP CHAIN */}
              <div className="pt-4 border-t border-slate-800">
                <div className="mb-3">
                  <label className="block text-sm font-black text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-500" />
                    <span>Machine Routing</span>
                  </label>
                  <p className="text-[11px] text-slate-400">Pick a recipe, then confirm the exact machine per step. Each step is tracked individually on the floor.</p>
                </div>

                {/* Recipe chips */}
                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => { setSteps([blankStep()]); setRecipeId(""); }}
                    className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-bold transition ${recipeId === "" ? "border-amber-400 bg-amber-500 text-slate-950" : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600"}`}
                  >
                    Build from scratch
                  </button>
                  {templates.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => loadRecipe(tpl)}
                      className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-bold transition ${recipeId === String(tpl.id) ? "border-amber-400 bg-amber-500 text-slate-950" : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600"}`}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>

                {/* Step chain */}
                <div className="mt-3 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-400">Step sequence ({steps.length}):</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Recipe name"
                        value={recipeName}
                        onChange={e => setRecipeName(e.target.value)}
                        className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white placeholder-slate-500"
                      />
                      <button type="button" onClick={saveAsRecipe} className="flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300">
                        <Save className="h-3.5 w-3.5" /> Save recipe
                      </button>
                      <button type="button" onClick={addStep} className="flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300">
                        <Plus className="h-3.5 w-3.5" /> Add step
                      </button>
                    </div>
                  </div>

                  {steps.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-slate-500">Pick a recipe above, or add a step, to define the routing.</div>
                  ) : (
                    steps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-xs font-black text-amber-400">{idx + 1}</span>
                        <input
                          type="text"
                          value={step.operationName}
                          onChange={e => updateStep(idx, "operationName", e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                          placeholder="Operation name"
                        />
                        <select
                          value={step.machineId}
                          onChange={e => updateStep(idx, "machineId", e.target.value)}
                          className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                        >
                          <option value="">Assign later</option>
                          {machineCategories.map(cat => (
                            <optgroup key={cat} label={cat}>
                              {machines.filter((m: any) => m.category === cat).map((m: any) => (
                                <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={step.estimatedMinutes}
                          onChange={e => updateStep(idx, "estimatedMinutes", e.target.value)}
                          className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center font-mono text-xs text-white"
                          title="Estimated minutes"
                        />
                        <div className="flex flex-col">
                          <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-0.5 text-slate-500 hover:text-amber-400 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} className="p-0.5 text-slate-500 hover:text-amber-400 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                        </div>
                        <button type="button" onClick={() => removeStep(idx)} className="p-1.5 text-slate-500 transition hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs shadow-lg shadow-amber-600/30 transition disabled:opacity-50"
                >
                  {isSubmitting ? "Generating Schedule..." : "Schedule & Route Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
