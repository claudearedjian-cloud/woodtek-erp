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
  MapPin,
  History,
  Download
} from "lucide-react";
import { ROLES, registerCustomRoles, registerModuleOverrides } from "@/lib/permissions";
import { MODULE_LABELS, MODULES_BY_ROLE, type ModuleId } from "@/lib/moduleAccess";
import { IDLE_CHOICES, IDLE_STORAGE_KEY, loadIdleMinutes, normalizeIdleMinutes } from "@/lib/idle";
import { Timer } from "lucide-react";
import { ListChecks } from "lucide-react";

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

  // ---- auto-lock this device (everyone; stored per device) ----
  const [idleMins, setIdleMins] = useState<number>(() => loadIdleMinutes());
  const changeIdleMins = (v: number) => {
    const mins = normalizeIdleMinutes(v);
    setIdleMins(mins);
    try {
      localStorage.setItem(IDLE_STORAGE_KEY, String(mins));
    } catch {
      /* private mode */
    }
  };

  // ---- audit log (Manager-only trail of who did what) ----
  const isManager = currentUser?.role === "Manager";
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);

  // Packing QC checklist template (Manager): what the warehouse must tick
  // before an order leaves the Packing stage. Empty list = gate disabled.
  const [qcTpl, setQcTpl] = useState<string[]>([]);
  const [qcTplMsg, setQcTplMsg] = useState("");
  useEffect(() => {
    if (!isManager) return;
    fetch("/api/packing-qc", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.template)) setQcTpl(d.template); })
      .catch(() => {});
  }, [isManager]);
  const saveQcTemplate = async (template: string[]) => {
    setQcTplMsg("");
    try {
      const res = await fetch("/api/packing-qc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const d = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setQcTplMsg(d.error || "Save failed.");
        return;
      }
      setQcTpl(Array.isArray(d.template) ? d.template : template);
      setQcTplMsg(d.template?.length === 0 ? "Checklist disabled — orders can leave Packing freely." : "Checklist saved.");
    } catch {
      setQcTplMsg("Save failed.");
    }
  };

  const loadAudit = async (q: string = auditQuery) => {
    if (!isManager) return;
    setAuditLoading(true);
    try {
      const res = await fetch(`/api/audit${q ? `?q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setAuditEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      /* keep old entries */
    } finally {
      setAuditLoading(false);
    }
  };

  const clearAuditTrail = async () => {
    if (!confirm("Clear the ENTIRE audit log? This cannot be undone.")) return;
    await fetch("/api/audit", { method: "DELETE" });
    setAuditEntries([]);
  };

  const downloadAuditCsv = () => {
    const head = "Time,User,Role,Action,Entity,EntityId,Detail";
    const rows = auditEntries.map((e) =>
      [new Date(e.at).toLocaleString(), e.actorName, e.actorRole, e.action, e.entity, e.entityId ?? "", (e.detail ?? "").replace(/"/g, '""')]
        .map((v) => `"${String(v)}"`)
        .join(","),
    );
    const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `woodtek-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- custom roles (Manager can add/remove named roles) ----
  const [customRoles, setCustomRoles] = useState<{ name: string; base: string; modules?: string[] }[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [addScreens, setAddScreens] = useState<string[]>([]);
  const [screensRole, setScreensRole] = useState<string | null>(null);
  const [screenSel, setScreenSel] = useState<string[]>([]);
  const SCREEN_CHOICES = (Object.keys(MODULE_LABELS) as ModuleId[]).filter((m) => m !== "designer");
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
        const ov = d.overrides && typeof d.overrides === "object" ? d.overrides : {};
        setOverrides(ov);
        registerModuleOverrides(ov);
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

  const saveOverrides = async (next: Record<string, string[]>) => {
    setRoleMsg("");
    try {
      const res = await fetch("/api/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: customRoles, overrides: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRoleMsg(data.error || "Failed to save role screens.");
        return;
      }
      const ov = data.overrides && typeof data.overrides === "object" ? data.overrides : {};
      setOverrides(ov);
      registerModuleOverrides(ov);
      setRoleMsg("Role screens updated.");
    } catch {
      setRoleMsg("Network error — role screens not saved.");
    }
  };

  const roleManagerPanel = (
    <>
                  <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40">
        <button type="button" onClick={() => setShowRoleMgr((v) => !v)} className="text-xs font-bold text-teal-300 hover:text-teal-200 flex items-center gap-1.5">
          <UserCog className="w-3.5 h-3.5" /> {showRoleMgr ? "Hide role manager" : "Manage roles (add / remove)"}
        </button>
        {showRoleMgr && (
          <div className="mt-3 space-y-2">
            {ROLES.map((r) => (
              <div key={r}>
                <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 rounded-lg px-3 py-2">
                  <span>
                    {r}{" "}
                    <span className="text-[10px] text-slate-500">
                      built-in{r !== "Manager" && overrides[r] ? ` · modified (${overrides[r].length} screen(s))` : ""}
                    </span>
                  </span>
                  {r === "Manager" ? (
                    <span className="text-[10px] text-slate-600">always full access</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      {overrides[r] && (
                        <button
                          type="button"
                          title="Restore the default screens for this role"
                          onClick={() => saveOverrides(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== r)))}
                          className="text-[10px] font-bold text-amber-400 hover:text-amber-300"
                        >
                          reset
                        </button>
                      )}
                      <button
                        type="button"
                        title="Choose which screens this role sees"
                        onClick={() => {
                          if (screensRole === r) { setScreensRole(null); return; }
                          setScreensRole(r);
                          setScreenSel(overrides[r] ?? ((MODULES_BY_ROLE as Record<string, string[]>)[r] ?? []));
                        }}
                        className="text-slate-400 hover:text-teal-300"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                {screensRole === r && r !== "Manager" && (
                  <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                    <div className="text-[10px] font-bold uppercase text-slate-500">
                      Screens {r} sees — keep at least one selected
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {SCREEN_CHOICES.map((m) => (
                        <label
                          key={m}
                          className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${screenSel.includes(m) ? "border-teal-500 bg-teal-500/10 text-teal-200" : "border-slate-800 bg-slate-950 text-slate-500"}`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={screenSel.includes(m)}
                            onChange={() => setScreenSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))}
                          />
                          {MODULE_LABELS[m]}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (screenSel.length === 0) { setRoleMsg("Select at least one screen."); return; }
                        saveOverrides({ ...overrides, [r]: screenSel });
                        setScreensRole(null);
                      }}
                      className="mt-2 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-500"
                    >
                      Save screens
                    </button>
                  </div>
                )}
              </div>
            ))}
            {customRoles.map((r) => (
              <div key={r.name}>
                <div className="flex items-center justify-between text-xs text-slate-200 bg-slate-900/60 rounded-lg px-3 py-2">
                  <span>
                    {r.name}{" "}
                    <span className="text-[10px] text-slate-500">
                      inherits {r.base}
                      {r.modules && r.modules.length > 0 ? ` · ${r.modules.length} screen(s) only` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      title="Choose which screens this role sees"
                      onClick={() => {
                        if (screensRole === r.name) { setScreensRole(null); return; }
                        setScreensRole(r.name);
                        setScreenSel(r.modules ?? []);
                      }}
                      className="text-slate-400 hover:text-teal-300"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title={`Remove ${r.name}`}
                      onClick={() => saveRoles(customRoles.filter((x) => x.name !== r.name))}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                {screensRole === r.name && (
                  <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                    <div className="text-[10px] font-bold uppercase text-slate-500">
                      Screens this role sees — none selected = full {r.base} access
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {SCREEN_CHOICES.map((m) => (
                        <label
                          key={m}
                          className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${screenSel.includes(m) ? "border-teal-500 bg-teal-500/10 text-teal-200" : "border-slate-800 bg-slate-950 text-slate-500"}`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={screenSel.includes(m)}
                            onChange={() => setScreenSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))}
                          />
                          {MODULE_LABELS[m]}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        saveRoles(customRoles.map((x) => (x.name === screensRole ? { ...x, modules: screenSel.length ? screenSel : undefined } : x)));
                        setScreensRole(null);
                      }}
                      className="mt-2 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-500"
                    >
                      Save screens
                    </button>
                  </div>
                )}
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
                  saveRoles([...customRoles, { name: n, base: newRoleBase, ...(addScreens.length ? { modules: addScreens } : {}) }]);
                  setNewRoleName("");
                  setAddScreens([]);
                }}
                className="bg-teal-600 hover:bg-teal-500 text-white rounded-lg px-3 text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="pt-1">
              <div className="text-[10px] font-bold uppercase text-slate-500">
                Screens (optional — none selected = full {newRoleBase} access)
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SCREEN_CHOICES.map((m) => (
                  <label
                    key={m}
                    className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${addScreens.includes(m) ? "border-teal-500 bg-teal-500/10 text-teal-200" : "border-slate-800 bg-slate-950 text-slate-500"}`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={addScreens.includes(m)}
                      onChange={() => setAddScreens((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))}
                    />
                    {MODULE_LABELS[m]}
                  </label>
                ))}
              </div>
            </div>
            {roleMsg && <div className="text-[11px] text-amber-300">{roleMsg}</div>}
          </div>
        )}
      </div>
    </>
  );

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
        {activeTab === "users" && (
          <button
            type="button"
            onClick={() => setShowRoleMgr((v) => !v)}
            className="flex items-center gap-2 border border-teal-700 bg-teal-500/10 text-teal-300 font-black px-4 py-2.5 rounded-xl text-xs transition hover:bg-teal-500/20"
          >
            <UserCog className="w-4 h-4" /> Manage roles
          </button>
        )}
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-amber-600/30 transition"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add {activeTab === "clients" ? "Client" : activeTab === "technicians" ? "Technician" : activeTab === "operators" ? "Operator" : "User"}</span>
        </button>
      </div>

      {activeTab === "users" && showRoleMgr && !showModal && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">{roleManagerPanel}</div>
      )}

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
      {/* Auto-lock this device */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <Timer className="h-4 w-4 text-emerald-400" /> Auto-lock this device
          </h3>
          <select
            value={idleMins}
            onChange={(e) => changeIdleMins(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white outline-none"
          >
            {IDLE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          After that much time without mouse or keyboard activity, the app locks and asks for the PIN again —
          a warning appears 60 seconds before. This setting applies to THIS computer only.
        </p>
      </div>

      {/* Packing QC checklist (Manager only) */}
      {isManager && (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <ListChecks className="h-4 w-4 text-amber-400" /> Packing QC checklist
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            The warehouse must tick every item before an order can leave the Packing stage (Schedule tab).
            Removing all items turns the check off.
          </p>
          <div className="mt-3 space-y-2">
            {qcTpl.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={item}
                  maxLength={120}
                  onChange={(e) => setQcTpl(qcTpl.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder={`Check ${i + 1} — e.g. all materials packed`}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={() => setQcTpl(qcTpl.filter((_, j) => j !== i))}
                  className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:bg-rose-600 hover:text-white"
                  title="Remove this item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setQcTpl([...qcTpl, ""])}
              disabled={qcTpl.length >= 12}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              + Add item
            </button>
            <button
              onClick={() => saveQcTemplate(qcTpl.map((s) => s.trim()).filter(Boolean))}
              className="rounded-xl bg-amber-500 px-4 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-400"
            >
              Save checklist
            </button>
            <button
              onClick={() => saveQcTemplate([])}
              className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
              title="No checklist — orders can leave Packing without QC"
            >
              Disable gate
            </button>
            {qcTpl.length === 0 && <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">Gate is currently OFF</span>}
          </div>
          {qcTplMsg && <div className="mt-2 text-[11px] font-bold text-emerald-400">{qcTplMsg}</div>}
        </div>
      )}

      {/* Audit log (Manager only) */}
      {isManager && (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-black text-white">
              <History className="h-4 w-4 text-amber-400" /> Audit log — who did what
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") loadAudit(); }}
                placeholder="Filter by name, action, detail…"
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-white placeholder-slate-500"
              />
              <button type="button" onClick={() => loadAudit()} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-400">Search</button>
              <button type="button" onClick={() => { setAuditQuery(""); loadAudit(""); }} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:text-white">All</button>
              <button type="button" onClick={downloadAuditCsv} disabled={auditEntries.length === 0} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:text-white disabled:opacity-40"><Download className="h-3.5 w-3.5" /> CSV</button>
              <button type="button" onClick={clearAuditTrail} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20">Clear</button>
            </div>
          </div>
          {!auditOpen ? (
            <button type="button" onClick={() => { setAuditOpen(true); loadAudit(); }} className="w-full rounded-xl border border-dashed border-slate-700 py-3 text-xs font-bold text-slate-400 hover:text-white hover:border-slate-500">
              Show the audit trail (logins, status changes, deletes, backups…)
            </button>
          ) : auditLoading && auditEntries.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 animate-pulse">Loading the trail…</div>
          ) : auditEntries.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">Nothing recorded{auditQuery ? " for this filter" : " yet"}.</div>
          ) : (
            <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-950">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                      <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-slate-400">{new Date(e.at).toLocaleString()}</td>
                      <td className="px-3 py-1.5 font-bold text-white">{e.actorName}<span className="ml-1 font-normal text-slate-500">({e.actorRole})</span></td>
                      <td className="px-3 py-1.5"><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">{e.action}</span></td>
                      <td className="max-w-[420px] truncate px-3 py-1.5 text-slate-300" title={e.detail ?? ""}>{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      {editingEntity ? "Reset PIN (leave empty to keep the current PIN)" : "4-Digit PIN *"}
                    </label>
                    <input type="text" maxLength={4} pattern="\d{4}" required={!editingEntity} value={formData.pin} onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-mono tracking-widest" placeholder="0000" />
                  </div>
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
{roleManagerPanel}
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
