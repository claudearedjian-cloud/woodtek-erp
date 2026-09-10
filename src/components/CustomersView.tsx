"use client";

import React, { useMemo, useState } from "react";
import {
  Users,
  Plus,
  Mail,
  Phone,
  MapPin,
  Trash2,
  X,
  Search,
  Pencil,
  NotebookPen,
  DollarSign,
  Wallet,
  ClipboardList,
  ChevronRight,
} from "lucide-react";

interface CustomersViewProps {
  customers: any[];
  loading: boolean;
  onRefresh: () => void;
  onSelectOrder: (orderId: number) => void;
}

function statusChip(s: string) {
  if (s === "Completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s === "Delivered") return "bg-teal-500/15 text-teal-300 border-teal-500/30";
  if (s === "In Production") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (s === "Quality Review") return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  if (s === "On Hold") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  if (s === "Cancelled") return "bg-slate-700/50 text-slate-400 border-slate-600";
  return "bg-blue-500/15 text-blue-300 border-blue-500/30";
}

export default function CustomersView({
  customers = [],
  loading,
  onRefresh,
  onSelectOrder,
}: CustomersViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("25000.00");

  // ---- search -------------------------------------------------------------
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      [c.company, c.name, c.email, c.phone, c.address]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q)),
    );
  }, [customers, search]);

  // ---- client detail modal -------------------------------------------------
  const [detail, setDetail] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<"profile" | "orders">("profile");
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [detailMsg, setDetailMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const openDetail = async (c: any) => {
    setDetailTab("profile");
    setEditing(false);
    setDetailMsg("");
    setDetail({ ...c, orders: c.orders ?? [] });
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers/${c.id}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data);
    } catch {
      /* keep the card data on failure */
    } finally {
      setDetailLoading(false);
    }
  };

  const startEdit = () => {
    setEditForm({
      company: detail.company ?? "",
      name: detail.name ?? "",
      email: detail.email ?? "",
      phone: detail.phone ?? "",
      address: detail.address ?? "",
      creditLimit: String(detail.creditLimit ?? ""),
      currentBalance: String(detail.currentBalance ?? ""),
      notes: detail.notes ?? "",
    });
    setEditing(true);
    setDetailMsg("");
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setDetailMsg("");
    try {
      const res = await fetch(`/api/customers/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update client");
      setDetail((d: any) => ({ ...d, ...data }));
      setEditing(false);
      setDetailMsg("Client information updated.");
      onRefresh();
    } catch (err) {
      setDetailMsg(err instanceof Error ? err.message : "Failed to update client");
    } finally {
      setSaving(false);
    }
  };

  const deleteFromDetail = async () => {
    if (!detail) return;
    if (!confirm(`Delete client account for ${detail.company}? This cannot be undone.`)) return;
    setDetailMsg("");
    try {
      const res = await fetch(`/api/customers/${detail.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailMsg(data.error || "Cannot delete this client.");
        return;
      }
      setDetail(null);
      onRefresh();
    } catch (err) {
      setDetailMsg(err instanceof Error ? err.message : "Failed to delete client");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, email, phone, address, creditLimit }),
      });
      if (!res.ok) throw new Error("Failed to register customer");
      setShowModal(false);
      setName("");
      setCompany("");
      setEmail("");
      setPhone("");
      setAddress("");
      onRefresh();
    } catch (err) {
      console.error("Create customer error:", err);
    }
  };

  const handleDelete = async (id: number, comp: string) => {
    if (!confirm(`Delete client account for ${comp}?`)) return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Cannot delete client with active orders.");
        return;
      }
      onRefresh();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  if (loading) return <div className="p-6 text-slate-400 animate-pulse">Loading commercial accounts...</div>;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-extrabold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" />
            <span>Commercial Architects & Trade Clients</span>
          </h3>
          <p className="text-xs text-slate-400">Manage accounts, credit balances, and order histories.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients, contacts, email, phone…"
              className="w-full sm:w-72 rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-8 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-white"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-xs px-4 py-2 rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" /> Add Trade Account
          </button>
        </div>
      </div>

      {search && (
        <p className="text-[11px] font-bold text-slate-400">
          Showing {filtered.length} of {customers.length} client{customers.length === 1 ? "" : "s"}
        </p>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-16 text-center">
          <Search className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm font-bold text-slate-300">No clients match “{search}”</p>
          <button onClick={() => setSearch("")} className="mt-2 text-xs font-bold text-amber-400 hover:text-amber-300">Clear search</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {filtered.map(c => (
            <div
              key={c.id}
              onClick={() => openDetail(c)}
              className="bg-slate-900/90 border border-slate-800/80 hover:border-amber-500/40 rounded-2xl p-5 shadow-sm space-y-4 cursor-pointer transition group"
              title="Open client file"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-[10px] text-amber-400 font-extrabold uppercase tracking-wider block mb-1">
                    Trade Client ID #{c.id}
                  </span>
                  <h4 className="text-lg font-black text-white group-hover:text-amber-300 transition truncate">{c.company}</h4>
                  <div className="text-xs text-slate-300 font-semibold truncate">{c.name}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-lg font-black text-emerald-400 font-mono">{c.totalSpend != null ? `$${Number(c.totalSpend).toLocaleString()}` : <span className="text-slate-600 italic text-[10px]">restricted</span>}</div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Total WIP Spend</div>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-400 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-200 truncate">{c.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-200">{c.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-300 truncate">{c.address}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
                <span className="bg-slate-950 px-3 py-1 rounded-xl text-slate-300 font-bold border border-slate-800">
                  {c.activeOrdersCount || 0} active {c.activeOrdersCount === 1 ? "project" : "projects"} ({c.orderCount} total)
                </span>
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 px-2 py-1 rounded-xl text-amber-400 font-bold group-hover:bg-amber-500/10 transition">
                    Open file <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.company); }}
                    className="p-2 hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 rounded-xl transition"
                    title="Remove Client"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================= CLIENT FILE MODAL ================= */}
      {detail && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 z-50">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-950/50 p-5 rounded-t-2xl">
              <div className="min-w-0">
                <div className="text-[10px] text-amber-400 font-extrabold uppercase tracking-wider mb-0.5">Trade Client ID #{detail.id}</div>
                <h3 className="text-lg font-black text-white truncate">{detail.company}</h3>
                <p className="text-xs text-slate-400 truncate">{detail.name}</p>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-800 px-5 pt-3">
              <button
                onClick={() => setDetailTab("profile")}
                className={`rounded-t-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${detailTab === "profile" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"}`}
              >
                Profile
              </button>
              <button
                onClick={() => setDetailTab("orders")}
                className={`rounded-t-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${detailTab === "orders" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"}`}
              >
                Orders ({(detail.orders ?? []).length})
              </button>
            </div>

            {detailMsg && (
              <div className={`mx-5 mt-4 rounded-xl border p-3 text-xs font-bold ${detailMsg.includes("updated") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
                {detailMsg}
              </div>
            )}

            {/* ---- PROFILE TAB ---- */}
            {detailTab === "profile" && (
              <div className="p-5 space-y-4">
                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Company / Studio *</label>
                        <input required value={editForm.company} onChange={e => setEditForm({ ...editForm, company: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Primary Contact *</label>
                        <input required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Email *</label>
                        <input type="email" required value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Phone *</label>
                        <input required value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Credit Limit ($)</label>
                        <input type="number" step="0.01" min="0" value={editForm.creditLimit} onChange={e => setEditForm({ ...editForm, creditLimit: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Current Balance ($)</label>
                        <input type="number" step="0.01" value={editForm.currentBalance} onChange={e => setEditForm({ ...editForm, currentBalance: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Address</label>
                      <input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Notes</label>
                      <textarea rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                    </div>
                    <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                      <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl hover:bg-slate-700">Cancel</button>
                      <button type="submit" disabled={saving} className="px-5 py-2 bg-emerald-500 text-slate-950 text-xs font-black rounded-xl shadow hover:bg-emerald-400 disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <InfoRow icon={Mail} label="Email" value={detail.email} />
                      <InfoRow icon={Phone} label="Phone" value={detail.phone} />
                      <InfoRow icon={MapPin} label="Address" value={detail.address} />
                      <InfoRow icon={DollarSign} label="Total WIP Spend" value={detail.totalSpend != null ? `$${Number(detail.totalSpend).toLocaleString()}` : "restricted"} mono />
                      <InfoRow icon={Wallet} label="Credit Limit" value={detail.creditLimit != null ? `$${Number(detail.creditLimit).toLocaleString()}` : "—"} mono />
                      <InfoRow icon={Wallet} label="Current Balance" value={detail.currentBalance != null ? `$${Number(detail.currentBalance).toLocaleString()}` : "—"} mono />
                    </div>
                    {detail.notes && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                          <NotebookPen className="h-3.5 w-3.5" /> Notes
                        </div>
                        <p className="text-xs text-slate-300 whitespace-pre-wrap">{detail.notes}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                      <button
                        onClick={deleteFromDetail}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-rose-300 transition hover:border-rose-500/50 hover:bg-rose-500/10"
                        title="Delete this client (blocked while orders exist)"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete Client
                      </button>
                      <button
                        onClick={startEdit}
                        className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 shadow hover:bg-amber-400"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit Information
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ---- ORDERS TAB ---- */}
            {detailTab === "orders" && (
              <div className="p-5">
                {detailLoading ? (
                  <div className="py-10 text-center text-xs text-slate-500 animate-pulse">Loading order history…</div>
                ) : (detail.orders ?? []).length === 0 ? (
                  <div className="py-10 text-center">
                    <ClipboardList className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                    <p className="text-xs text-slate-500">This client has no orders yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[52vh] overflow-y-auto pr-1">
                    {(detail.orders ?? []).map((o: any) => (
                      <div
                        key={o.id}
                        onClick={() => { setDetail(null); onSelectOrder(o.id); }}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 cursor-pointer transition hover:border-amber-500/40 hover:bg-slate-800/60 group"
                        title="Open order"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-black text-amber-400 tracking-tight">{o.orderNumber}</span>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${statusChip(o.status)}`}>{o.status}</span>
                          </div>
                          <div className="text-xs text-slate-300 truncate mt-0.5">{o.title}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {o.progressPercent ?? 0}% complete{o.dueDate ? ` · due ${new Date(o.dueDate).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-mono text-sm font-black text-white">${Number(o.totalValue || 0).toLocaleString()}</div>
                          <ChevronRight className="ml-auto h-4 w-4 text-slate-600 group-hover:text-amber-400 transition" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= ADD CLIENT MODAL ================= */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Register Trade Client Account</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Company / Studio Name *</label>
                <input type="text" required placeholder="e.g. Nordic Form Studio" value={company} onChange={e => setCompany(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Primary Contact Name *</label>
                <input type="text" required placeholder="e.g. Lars Kjellgren" value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Email Address *</label>
                <input type="email" required placeholder="lars@nordicform.se" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Phone Number *</label>
                <input type="text" required placeholder="+46 8 555 1204" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Address</label>
                <input type="text" placeholder="Hamngatan 14, Stockholm" value={address} onChange={e => setAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-amber-600 text-slate-950 text-xs font-black rounded-xl shadow">Create Client</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: any; label: string; value: any; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`text-xs font-bold text-slate-200 truncate ${mono ? "font-mono" : ""}`} title={value ?? ""}>
        {value || "—"}
      </div>
    </div>
  );
}
