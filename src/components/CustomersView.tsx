"use client";

import React, { useState } from "react";
import { Users, Plus, Mail, Phone, MapPin, DollarSign, Briefcase, Trash2, X, ChevronRight } from "lucide-react";

interface CustomersViewProps {
  customers: any[];
  loading: boolean;
  onRefresh: () => void;
  onSelectOrder: (orderId: number) => void;
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
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-sm">
        <div>
          <h3 className="text-base font-extrabold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" />
            <span>Commercial Architects & Trade Clients</span>
          </h3>
          <p className="text-xs text-slate-400">Manage accounts, credit balances, and order histories.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-xs px-4 py-2 rounded-xl shadow-lg transition flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" /> Add Trade Account
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
        {customers.map(c => (
          <div key={c.id} className="bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] text-amber-400 font-extrabold uppercase tracking-wider block mb-1">
                  Trade Client ID #{c.id}
                </span>
                <h4 className="text-lg font-black text-white">{c.company}</h4>
                <div className="text-xs text-slate-300 font-semibold">{c.name}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-black text-emerald-400 font-mono">{c.totalSpend != null ? `$${Number(c.totalSpend).toLocaleString()}` : <span className="text-slate-600 italic text-[10px]">restricted</span>}</div>
                <div className="text-[10px] text-slate-500 uppercase font-bold">Total WIP Spend</div>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-400 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-200">{c.email}</span>
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
              <button
                onClick={() => handleDelete(c.id, c.company)}
                className="p-2 hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 rounded-xl transition"
                title="Remove Client"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

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
