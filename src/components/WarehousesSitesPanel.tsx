"use client";

// ============================================================================
// Settings → Warehouses. The factory company, its branches (locations), and
// for each branch the floors and warehouses that belong to it.
// Names are edited in place: changing a field and leaving it saves it.
// ============================================================================

import React, { useCallback, useEffect, useState } from "react";
import { Building2, Layers, Plus, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import { floorsOfBranch, type SiteBranch, type SiteFloor, type SitesConfig } from "@/lib/sites";

interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  address: string;
  branchId: string;
  itemCount?: number;
}

const inputClass =
  "bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400";
const smallButton =
  "rounded-lg px-2.5 py-1.5 text-[11px] font-bold border transition disabled:opacity-50";

export default function WarehousesSitesPanel() {
  const [config, setConfig] = useState<SitesConfig | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newBranch, setNewBranch] = useState({ name: "", code: "" });
  const [newFloor, setNewFloor] = useState<Record<string, { name: string; code: string }>>({});
  const [newWarehouse, setNewWarehouse] = useState<Record<string, { name: string; code: string }>>({});

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3000);
  };

  const load = useCallback(async () => {
    try {
      const [sitesRes, warehouseRes] = await Promise.all([
        fetch("/api/sites", { cache: "no-store" }),
        fetch("/api/warehouses", { cache: "no-store" }),
      ]);
      const sites = await sitesRes.json();
      const warehouseData = await warehouseRes.json();
      if (!sitesRes.ok) throw new Error(sites.error || "Failed to load the factory structure");
      if (!warehouseRes.ok) throw new Error(warehouseData.error || "Failed to load warehouses");
      setConfig(sites.config);
      setWarehouses(warehouseData.warehouses ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async (next: SitesConfig, message: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setConfig(data.config);
      flash(message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveWarehouse = async (
    method: "POST" | "PUT",
    body: Record<string, unknown>,
    message: string,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/warehouses", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save the warehouse");
      setWarehouses(data.warehouses ?? []);
      flash(message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the warehouse");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteWarehouse = async (warehouse: WarehouseRow) => {
    if (!confirm(`Delete the warehouse "${warehouse.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      let res = await fetch(`/api/warehouses?id=${encodeURIComponent(warehouse.id)}`, { method: "DELETE" });
      let data = await res.json();
      if (res.status === 409) {
        if (!confirm(`${data.error}\n\nMove those stock items into another warehouse and delete it?`)) return;
        res = await fetch(`/api/warehouses?id=${encodeURIComponent(warehouse.id)}&force=1`, { method: "DELETE" });
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || "Failed to delete the warehouse");
      setWarehouses(data.warehouses ?? []);
      flash("Warehouse deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the warehouse");
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
        {error || "Loading the factory structure..."}
      </div>
    );
  }

  const updateBranch = (branch: SiteBranch, patch: Partial<SiteBranch>) => {
    const next = { ...config, branches: config.branches.map((item) => (item.id === branch.id ? { ...item, ...patch } : item)) };
    saveConfig(next, "Branch saved");
  };

  const removeBranch = (branch: SiteBranch) => {
    if (config.branches.length <= 1) {
      setError("Keep at least one branch.");
      return;
    }
    if (!confirm(`Delete the branch "${branch.name}"? Its floors go with it.`)) return;
    const next = {
      ...config,
      branches: config.branches.filter((item) => item.id !== branch.id),
      floors: config.floors.filter((floor) => floor.branchId !== branch.id),
    };
    saveConfig(next, "Branch deleted");
  };

  const addBranch = async () => {
    const name = newBranch.name.trim();
    if (!name) return;
    const ok = await saveConfig(
      {
        ...config,
        branches: [
          ...config.branches,
          { id: "", name, code: newBranch.code.trim(), address: "", active: true, createdAt: new Date().toISOString() },
        ],
      },
      "Branch added",
    );
    if (ok) setNewBranch({ name: "", code: "" });
  };

  const updateFloor = (floor: SiteFloor, patch: Partial<SiteFloor>) => {
    const next = { ...config, floors: config.floors.map((item) => (item.id === floor.id ? { ...item, ...patch } : item)) };
    saveConfig(next, "Floor saved");
  };

  const removeFloor = (floor: SiteFloor) => {
    if (!confirm(`Delete the floor "${floor.name}"? Supervisors assigned to it will be unassigned.`)) return;
    saveConfig({ ...config, floors: config.floors.filter((item) => item.id !== floor.id) }, "Floor deleted");
  };

  const addFloor = async (branch: SiteBranch) => {
    const draft = newFloor[branch.id] ?? { name: "", code: "" };
    const name = draft.name.trim();
    if (!name) return;
    const ok = await saveConfig(
      {
        ...config,
        floors: [
          ...config.floors,
          { id: "", branchId: branch.id, name, code: draft.code.trim(), active: true, createdAt: new Date().toISOString() },
        ],
      },
      "Floor added",
    );
    if (ok) setNewFloor((prev) => ({ ...prev, [branch.id]: { name: "", code: "" } }));
  };

  const addWarehouse = async (branch: SiteBranch) => {
    const draft = newWarehouse[branch.id] ?? { name: "", code: "" };
    const name = draft.name.trim();
    if (!name) return;
    const ok = await saveWarehouse(
      "POST",
      { name, code: draft.code.trim(), address: "", branchId: branch.id },
      "Warehouse added",
    );
    if (ok) setNewWarehouse((prev) => ({ ...prev, [branch.id]: { name: "", code: "" } }));
  };

  const updateWarehouse = (warehouse: WarehouseRow, patch: Partial<WarehouseRow>) => {
    saveWarehouse("PUT", { ...warehouse, ...patch }, "Warehouse saved");
  };

  return (
    <div className="mt-6 space-y-5">
      {(error || notice) && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${
            error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {error || notice}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Building2 className="h-4 w-4 text-amber-400" /> Factory company
        </h3>
        <p className="mt-1 text-[11px] text-slate-400">
          Branches, floors and warehouses below belong to this company.
        </p>
        <CompanyName company={config.company} disabled={busy} onSave={(name) => saveConfig({ ...config, company: name }, "Company saved")} />
      </div>

      {config.branches.map((branch) => {
        const floors = floorsOfBranch(config, branch.id);
        const branchWarehouses = warehouses.filter((warehouse) => warehouse.branchId === branch.id);
        const floorDraft = newFloor[branch.id] ?? { name: "", code: "" };
        const warehouseDraft = newWarehouse[branch.id] ?? { name: "", code: "" };
        return (
          <div key={branch.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[180px]">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Branch name</span>
                <input
                  key={`${branch.id}-name-${branch.name}`}
                  defaultValue={branch.name}
                  disabled={busy}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== branch.name) updateBranch(branch, { name: value });
                  }}
                  className={`${inputClass} w-full text-sm font-bold`}
                />
              </label>
              <label className="w-28">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Code</span>
                <input
                  key={`${branch.id}-code-${branch.code}`}
                  defaultValue={branch.code}
                  disabled={busy}
                  onBlur={(e) => {
                    const value = e.target.value.trim().toUpperCase();
                    if (value !== branch.code) updateBranch(branch, { code: value });
                  }}
                  className={`${inputClass} w-full uppercase`}
                />
              </label>
              <label className="flex-[2] min-w-[200px]">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Address / note</span>
                <input
                  key={`${branch.id}-address-${branch.address}`}
                  defaultValue={branch.address}
                  disabled={busy}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== branch.address) updateBranch(branch, { address: value });
                  }}
                  className={`${inputClass} w-full`}
                />
              </label>
              <button
                type="button"
                disabled={busy || config.branches.length <= 1}
                onClick={() => removeBranch(branch)}
                className={`${smallButton} border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`}
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" /> Delete branch
              </button>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <section>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-black text-white">
                  <WarehouseIcon className="h-3.5 w-3.5 text-sky-400" /> Warehouses in this branch
                </h4>
                <div className="space-y-2">
                  {branchWarehouses.length === 0 && <p className="text-[11px] text-slate-500">No warehouse yet.</p>}
                  {branchWarehouses.map((warehouse) => (
                    <div key={warehouse.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2">
                      <input
                        key={`${warehouse.id}-${warehouse.name}`}
                        defaultValue={warehouse.name}
                        disabled={busy}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value && value !== warehouse.name) updateWarehouse(warehouse, { name: value });
                        }}
                        className={`${inputClass} flex-1 min-w-[120px]`}
                      />
                      <input
                        key={`${warehouse.id}-code-${warehouse.code}`}
                        defaultValue={warehouse.code}
                        disabled={busy}
                        onBlur={(e) => {
                          const value = e.target.value.trim().toUpperCase();
                          if (value !== warehouse.code) updateWarehouse(warehouse, { code: value });
                        }}
                        className={`${inputClass} w-24 uppercase`}
                      />
                      <select
                        value={warehouse.branchId}
                        disabled={busy}
                        onChange={(e) => updateWarehouse(warehouse, { branchId: e.target.value })}
                        className={inputClass}
                        aria-label="Branch of this warehouse"
                      >
                        {config.branches.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      <span className="text-[10px] text-slate-500">{warehouse.itemCount ?? 0} item(s)</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deleteWarehouse(warehouse)}
                        className={`${smallButton} border-rose-500/40 text-rose-200 hover:bg-rose-500/10`}
                        aria-label={`Delete ${warehouse.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={warehouseDraft.name}
                    onChange={(e) => setNewWarehouse((prev) => ({ ...prev, [branch.id]: { ...warehouseDraft, name: e.target.value } }))}
                    placeholder="New warehouse name"
                    className={`${inputClass} flex-1 min-w-[140px]`}
                  />
                  <input
                    value={warehouseDraft.code}
                    onChange={(e) => setNewWarehouse((prev) => ({ ...prev, [branch.id]: { ...warehouseDraft, code: e.target.value } }))}
                    placeholder="Code"
                    className={`${inputClass} w-24 uppercase`}
                  />
                  <button
                    type="button"
                    disabled={busy || !warehouseDraft.name.trim()}
                    onClick={() => addWarehouse(branch)}
                    className={`${smallButton} border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`}
                  >
                    <Plus className="mr-1 inline h-3.5 w-3.5" /> Add warehouse
                  </button>
                </div>
              </section>

              <section>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-black text-white">
                  <Layers className="h-3.5 w-3.5 text-amber-400" /> Floors in this branch
                </h4>
                <div className="space-y-2">
                  {floors.length === 0 && <p className="text-[11px] text-slate-500">No floor yet.</p>}
                  {floors.map((floor) => (
                    <div key={floor.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2">
                      <input
                        key={`${floor.id}-${floor.name}`}
                        defaultValue={floor.name}
                        disabled={busy}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value && value !== floor.name) updateFloor(floor, { name: value });
                        }}
                        className={`${inputClass} flex-1 min-w-[120px]`}
                      />
                      <input
                        key={`${floor.id}-code-${floor.code}`}
                        defaultValue={floor.code}
                        disabled={busy}
                        onBlur={(e) => {
                          const value = e.target.value.trim().toUpperCase();
                          if (value !== floor.code) updateFloor(floor, { code: value });
                        }}
                        className={`${inputClass} w-24 uppercase`}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeFloor(floor)}
                        className={`${smallButton} border-rose-500/40 text-rose-200 hover:bg-rose-500/10`}
                        aria-label={`Delete ${floor.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={floorDraft.name}
                    onChange={(e) => setNewFloor((prev) => ({ ...prev, [branch.id]: { ...floorDraft, name: e.target.value } }))}
                    placeholder="New floor name"
                    className={`${inputClass} flex-1 min-w-[140px]`}
                  />
                  <input
                    value={floorDraft.code}
                    onChange={(e) => setNewFloor((prev) => ({ ...prev, [branch.id]: { ...floorDraft, code: e.target.value } }))}
                    placeholder="Code"
                    className={`${inputClass} w-24 uppercase`}
                  />
                  <button
                    type="button"
                    disabled={busy || !floorDraft.name.trim()}
                    onClick={() => addFloor(branch)}
                    className={`${smallButton} border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`}
                  >
                    <Plus className="mr-1 inline h-3.5 w-3.5" /> Add floor
                  </button>
                </div>
              </section>
            </div>
          </div>
        );
      })}

      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5">
        <h3 className="mb-2 text-sm font-black text-white">Add a branch</h3>
        <p className="mb-3 text-[11px] text-slate-400">A branch is a factory location, for example a second site or a yard.</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newBranch.name}
            onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
            placeholder="Branch name"
            className={`${inputClass} flex-1 min-w-[180px]`}
          />
          <input
            value={newBranch.code}
            onChange={(e) => setNewBranch({ ...newBranch, code: e.target.value })}
            placeholder="Code"
            className={`${inputClass} w-28 uppercase`}
          />
          <button
            type="button"
            disabled={busy || !newBranch.name.trim()}
            onClick={addBranch}
            className={`${smallButton} border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Add branch
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyName({ company, disabled, onSave }: { company: string; disabled: boolean; onSave: (name: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <input
        key={company}
        defaultValue={company}
        disabled={disabled}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value && value !== company) onSave(value);
        }}
        className={`${inputClass} min-w-[240px] text-sm font-black`}
      />
    </div>
  );
}
