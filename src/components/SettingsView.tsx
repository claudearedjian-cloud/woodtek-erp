"use client";

import React, { useState, useEffect } from "react";
import { 
  Settings, 
  Users, 
  Building2, 
  Wrench, 
  UserCog, 
  Plus, 
  Trash2, 
  Edit, 
  Save, 
  X, 
  Search,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Phone,
  MapPin
} from "lucide-react";
import { ROLES, registerCustomRoles } from "@/lib/permissions";

interface SettingsViewProps {
  currentUser: any;
}

const avatarColors = ["bg-blue-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-purple-600", "bg-slate-600", "bg-indigo-600", "bg-teal-600"];

export default function SettingsView({ currentUser }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<"users" | "clients" | "operators" | "technicians">("users");
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Form state
  const [formData, setFormData] = useState<any>({
    name: "",
    email: "",
    role: "",
    avatarColor: "bg-slate-600",
    pin: "",
    active: true,
    phone: "",
    notes: "",
    company: "",
    address: "",
    creditLimit: "15000.00",
  });

  // ---- custom roles (Manager can add/remove named roles) ----
  const [customRoles, setCustomRoles] = useState<{ name: string; base: string }[]>([]);
  const [showRoleMgr, setShowRoleMgr] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleBase, setNewRoleBase] = useState<string>("Machine Operator");
  const [roleMsg, setRoleMsg] = useState("");

  useEffect(() => {
    fetch("/api/roles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d) => {
        const rs = Array.isArray(d.roles) ? d.roles : [];
        setCustomRoles(rs);
        registerCustomRoles(rs);
      })
      .catch(() => {});
  }, []);

  const saveRoles = async (next: { name: string; base: string }[]) => {
    setRoleMsg("");
    try {
      const res = await fetch("/api/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRoleMsg(data.error || "Failed to save roles.");
        return;
      }
      const rs = Array.isArray(data.roles) ? data.roles : [];
      setCustomRoles(rs);
      registerCustomRoles(rs);
      setRoleMsg("Roles updated.");
    } catch {
      setRoleMsg("Network error — roles not saved.");
    }
  };

  const fetchEntities = async () => {
    setLoading(true);
    try {
      const entityType = activeTab === "clients" ? "clients" : activeTab === "operators" ? "operators" : activeTab === "technicians" ? "technicians" : "users";
      const res = await fetch(`/api/settings?entity=${entityType}`);
      if (res.ok) {
        const data = await res.json();
        setEntities(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to fetch entities", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntities();
  }, [activeTab]);

  const openModal = (entity?: any) => {
    if (entity) {
      setEditingEntity(entity);
      setFormData({
        name: entity.name || "",
        email: entity.email || "",
        role: entity.role || "Machine Operator",
        avatarColor: entity.avatarColor || "bg-slate-600",
        pin: "",
        active: entity.active !== false,
        phone: entity.phone || "",
        notes: entity.notes || "",
        company: entity.company || "",
        address: entity.address || "",
        creditLimit: entity.creditLimit || "15000.00",
      });
    } else {
      setEditingEntity(null);
      setFormData({
        name: "",
        email: "",
        role: activeTab === "operators" ? "Machine Operator" : activeTab === "technicians" ? "Technician" : "User",
        avatarColor: "bg-slate-600",
        pin: "",
        active: true,
        phone: "",
        notes: "",
        company: "",
        address: "",
        creditLimit: "15000.00",
      });
    }
    setShowModal(true);
    setError("");
  };

  const saveEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    const entityType = activeTab === "clients" ? "clients" : activeTab === "operators" ? "operators" : activeTab === "technicians" ? "technicians" : "users";
    
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          data: editingEntity ? { ...formData, id: editingEntity.id } : formData,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      
      setShowModal(false);
      setNotice(editingEntity ? "Updated successfully" : "Created successfully");
      setTimeout(() => setNotice(""), 3000);
      fetchEntities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const deleteEntity = async (entity: any) => {
    const confirmMsg = activeTab === "clients" 
      ? `Delete client ${entity.company}? This cannot be undone.`
      : `Delete ${entity.name}? This cannot be undone.`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
      const entityType = activeTab === "clients" ? "clients" : activeTab === "operators" ? "operators" : activeTab === "technicians" ? "technicians" : "users";
      const res = await fetch(`/api/settings?entity=${entityType}&entityId=${entity.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete");
      
      setNotice("Deleted successfully");
      setTimeout(() => setNotice(""), 3000);
      fetchEntities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const filteredEntities = entities.filter((e) => {
    const query = searchQuery.toLowerCase();
    if (activeTab === "clients") {
      return e.company?.toLowerCase().includes(query) || e.name?.toLowerCase().includes(query) || e.email?.toLowerCase().includes(query);
    }
    return e.name?.toLowerCase().includes(query) || e.email?.toLowerCase().includes(query) || e.role?.toLowerCase().includes(query);
  });

  const getTabIcon = () => {
    if (activeTab === "clients") return Building2;
    if (activeTab === "operators") return UserCog;
    if (activeTab === "technicians") return Wrench;
    return Users;
  };

  const getTabLabel = () => {
    if (activeTab === "clients") return "Clients & Accounts";
    if (activeTab === "operators") return "Machine Operators";
    if (activeTab === "technicians") return "Technicians";
    return "All Users";
  };

  const TabIcon = getTabIcon();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Settings className="w-6 h-6 text-amber-400" />
              <span>General Settings</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">Manage users, clients, operators, and technicians.</p>
          </div>
          {(error || notice) && (
            <div className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
              {error ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{error || notice}</span>
              <button onClick={() => { setError(""); setNotice(""); }} className="ml-2 hover:opacity-70"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-6">
          {(["users", "operators", "technicians", "clients"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === tab
                  ? "bg-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/30"
                  : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {tab === "clients" ? <Building2 className="w-4 h-4" /> : tab === "operators" ? <UserCog className="w-4 h-4" /> : tab === "technicians" ? <Wrench className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              <span className="capitalize">{tab === "users" ? "All Users" : tab}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search & Add */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-amber-600/30 transition"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add {activeTab === "clients" ? "Client" : activeTab === "technicians" ? "Technician" : activeTab === "operators" ? "Operator" : "User"}</span>
        </button>
      </div>

      {/* Entity List */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 animate-pulse">Loading...</div>
      ) : filteredEntities.length === 0 ? (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-16 text-center">
          <TabIcon className="w-16 h-16 text-slate-600 mx-auto mb-4 stroke-[1.5]" />
          <h3 className="text-lg font-bold text-white mb-1">No {getTabLabel().toLowerCase()}</h3>
          <p className="text-sm text-slate-400">Click "Add" to create a new record.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEntities.map((entity) => (
            <div key={entity.id} className="bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 shadow-sm transition">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl ${entity.avatarColor || "bg-slate-600"} flex items-center justify-center text-white font-black text-lg`}>
                    {entity.name?.charAt(0) || entity.company?.charAt(0) || "?"}
                  </div>
                  <div>
                    <div className="font-bold text-white">{entity.name || entity.company}</div>
                    <div className="text-xs text-slate-400">{entity.email || entity.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openModal(entity)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteEntity(entity)} className="p-2 hover:bg-rose-500/20 rounded-lg text-slate-400 hover:text-rose-400 transition" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-400">
                {entity.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-300">{entity.phone}</span>
                  </div>
                )}
                {entity.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-300 truncate">{entity.address}</span>
                  </div>
                )}
                {entity.role && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-slate-300">{entity.role}</span>
                  </div>
                )}
                {entity.creditLimit && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Credit Limit:</span>
                    <span className="text-emerald-400 font-mono font-bold">${Number(entity.creditLimit).toLocaleString()}</span>
                  </div>
                )}
                {entity.active !== undefined && (
                  <div className={`text-[10px] font-bold px-2 py-1 rounded inline-block ${entity.active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                    {entity.active ? "ACTIVE" : "INACTIVE"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-800">
              <h3 className="text-lg font-black text-white">{editingEntity ? "Edit" : "Add"} {activeTab === "clients" ? "Client" : activeTab === "technicians" ? "Technician" : activeTab === "operators" ? "Operator" : "User"}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={saveEntity} className="p-6 space-y-4">
              {activeTab === "clients" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Company Name *</label>
                      <input type="text" required value={formData.company} onChange={(e) => setFormData({ ...formData, company: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Contact Name *</label>
                      <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Email *</label>
                      <input type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Phone *</label>
                      <input type="text" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Address</label>
                    <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Credit Limit ($)</label>
                    <input type="number" step="0.01" value={formData.creditLimit} onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Notes</label>
                    <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white h-20" />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Full Name *</label>
                      <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Email *</label>
                      <input type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                    </div>
                  </div>
                  {!editingEntity && (
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">4-Digit PIN *</label>
                      <input type="text" maxLength={4} pattern="\d{4}" required={!editingEntity} value={formData.pin} onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-mono tracking-widest" placeholder="0000" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Role</label>
                      <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                        {customRoles.map((r) => (
                          <option key={r.name} value={r.name}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">Avatar Color</label>
                      <div className="flex flex-wrap gap-2">
                        {avatarColors.map((color) => (
                          <button key={color} type="button" onClick={() => setFormData({ ...formData, avatarColor: color })} className={`w-8 h-8 rounded-lg ${color} ${formData.avatarColor === color ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900" : ""}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40">
                    <button type="button" onClick={() => setShowRoleMgr((v) => !v)} className="text-xs font-bold text-teal-300 hover:text-teal-200 flex items-center gap-1.5">
                      <UserCog className="w-3.5 h-3.5" /> {showRoleMgr ? "Hide role manager" : "Manage roles (add / remove)"}
                    </button>
                    {showRoleMgr && (
                      <div className="mt-3 space-y-2">
                        {ROLES.map((r) => (
                          <div key={r} className="flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 rounded-lg px-3 py-2">
                            <span>{r}</span>
                            <span className="text-[10px] text-slate-500">built-in</span>
                          </div>
                        ))}
                        {customRoles.map((r) => (
                          <div key={r.name} className="flex items-center justify-between text-xs text-slate-200 bg-slate-900/60 rounded-lg px-3 py-2">
                            <span>
                              {r.name} <span className="text-[10px] text-slate-500">inherits {r.base}</span>
                            </span>
                            <button
                              type="button"
                              title={`Remove ${r.name}`}
                              onClick={() => saveRoles(customRoles.filter((x) => x.name !== r.name))}
                              className="text-rose-400 hover:text-rose-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <input
                            value={newRoleName}
                            onChange={(e) => setNewRoleName(e.target.value)}
                            placeholder="New role name"
                            maxLength={30}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                          />
                          <select
                            value={newRoleBase}
                            onChange={(e) => setNewRoleBase(e.target.value)}
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>inherits {r}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const n = newRoleName.trim();
                              if (!n) return;
                              saveRoles([...customRoles, { name: n, base: newRoleBase }]);
                              setNewRoleName("");
                            }}
                            className="bg-teal-600 hover:bg-teal-500 text-white rounded-lg px-3 text-xs font-bold"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {roleMsg && <div className="text-[11px] text-amber-300">{roleMsg}</div>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Phone</label>
                    <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">Notes</label>
                    <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white h-20" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="active" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} className="w-4 h-4 rounded" />
                    <label htmlFor="active" className="text-xs font-bold text-slate-300">Active User</label>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  <span>{editingEntity ? "Save Changes" : "Create"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
