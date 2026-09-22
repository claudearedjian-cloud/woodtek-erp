"use client";

import React, { useEffect, useRef, useState } from "react";
import { Package, Plus, AlertTriangle, CheckCircle2, Layers, Trash2, X, Lock, ChevronRight, FileSpreadsheet, Download, Upload, Loader2, Pencil, Database } from "lucide-react";
import { can } from "@/lib/permissions";
import type { InventoryImportValidation } from "@/lib/inventoryImport";
import { isPanelCategory, validateDimensions } from "@/lib/inventoryDimensions";
import { DEFAULT_INVENTORY_CATEGORIES } from "@/lib/inventoryCategories";

interface InventoryViewProps {
  items: any[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  currentUser?: { role?: string | null } | null;
}

type ImportResult = { total: number; created: number; updated: number };

export default function InventoryView({ items = [], loading, onRefresh, currentUser }: InventoryViewProps) {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [showOrdersModal, setShowOrdersModal] = useState<any | null>(null); // item being inspected
  const [ordersForItem, setOrdersForItem] = useState<{ active: any[]; consumed: any[] } | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Wood & MDF Panels");
  const [stockQuantity, setStockQuantity] = useState("100");
  const [unit, setUnit] = useState("sheets");
  const [unitCost, setUnitCost] = useState("65.00");
  const [reorderLevel, setReorderLevel] = useState("20");
  const [location, setLocation] = useState("Rack 1-A");
  const [dimensions, setDimensions] = useState("");
  const [dimensionsError, setDimensionsError] = useState("");
  const [stockCategories, setStockCategories] = useState<string[]>(DEFAULT_INVENTORY_CATEGORIES);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageRows, setManageRows] = useState<Array<{ key: string; original: string; name: string }>>([]);
  const [manageError, setManageError] = useState("");
  const [manageSaving, setManageSaving] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeError, setWipeError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaTables, setSchemaTables] = useState<Array<{
    table: string; expected: string[]; actual: string[];
    missing: string[]; unexpected: string[]; foreignKeys: Array<{ conname: string; def: string }>;
  }>>([]);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [schemaMessage, setSchemaMessage] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<InventoryImportValidation | null>(null);
  const [importBusy, setImportBusy] = useState<"preview" | "commit" | null>(null);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const canImportStock = can(currentUser?.role, "inventory:write");

  // Manager-editable category list (defaults until the first fetch).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory-categories", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.categories) || d.categories.length === 0) return;
        setStockCategories(d.categories);
        setCategory((c) => (d.categories.some((x: string) => x === c) ? c : d.categories[0]));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const categories = ["All", ...stockCategories];

  const filtered = categoryFilter === "All" ? items : items.filter((i) => i.category === categoryFilter);

  // Summary metrics
  const totalItems = items.length;
  const lowStockCount = items.filter((i) => Number(i.availableQuantity ?? i.stockQuantity) <= i.reorderLevel).length;
  const reservedUnits = items.reduce((s, i) => s + (Number(i.reservedQuantity) || 0), 0);
  const totalUnits = items.reduce((s, i) => s + (Number(i.stockQuantity) || 0), 0);

  const handleAdjustStock = async (id: number, currentQty: number, delta: number) => {
    const newQty = Math.max(0, currentQty + delta);
    try {
      await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockQuantity: newQty }),
      });
      onRefresh();
    } catch (err) {
      console.error("Adjust error", err);
      alert("Stock adjustment failed. Try again.");
    }
  };

  const resetItemForm = () => {
    setEditingId(null);
    setSku("");
    setName("");
    setStockQuantity("100");
    setUnit("sheets");
    setUnitCost("65.00");
    setReorderLevel("20");
    setLocation("Rack 1-A");
    setDimensions("");
    setDimensionsError("");
  };

  const openEditItem = (item: any) => {
    setEditingId(item.id);
    setSku(String(item.sku ?? ""));
    setName(String(item.name ?? ""));
    setCategory(String(item.category ?? ""));
    setStockQuantity(String(item.stockQuantity ?? 0));
    setUnit(String(item.unit ?? ""));
    setUnitCost(String(item.unitCost ?? "0"));
    setReorderLevel(String(item.reorderLevel ?? 0));
    setLocation(String(item.location ?? ""));
    setDimensions(String(item.dimensions ?? ""));
    setDimensionsError("");
    setShowModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const dimensionsError = validateDimensions(dimensions);
    if (dimensionsError) {
      setDimensionsError(dimensionsError);
      return;
    }
    const payload = {
      sku,
      name,
      category,
      stockQuantity: Number(stockQuantity),
      unit,
      unitCost,
      reorderLevel: Number(reorderLevel),
      location,
      dimensions,
    };
    try {
      const res = editingId
        ? await fetch(`/api/inventory/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (editingId ? "Failed to update item" : "Failed to create item"));
      setShowModal(false);
      resetItemForm();
      onRefresh();
    } catch (err) {
      console.error("Save inventory error", err);
      alert(err instanceof Error && err.message !== "Failed to create item" ? err.message : "Error saving item.");
    }
  };

  // ---- live schema check & repair (Manager) ----
  const runSchemaCheck = async () => {
    try {
      const res = await fetch("/api/inventory/schema-check", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Schema check failed");
      setSchemaTables(data.tables ?? []);
    } catch (err) {
      setSchemaMessage(err instanceof Error ? err.message : "Schema check failed");
    }
  };

  const openSchemaCheck = async () => {
    setSchemaOpen(true);
    setSchemaTables([]);
    setSchemaMessage("Checking live database…");
    setSchemaBusy(true);
    try {
      await runSchemaCheck();
    } finally {
      setSchemaBusy(false);
      setSchemaMessage("");
    }
  };

  const runSchemaRepair = async () => {
    setSchemaBusy(true);
    setSchemaMessage("Repairing…");
    try {
      const res = await fetch("/api/inventory/schema-check", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Schema repair failed");
      setSchemaTables(data.after ?? []);
      setSchemaMessage(
        data.applied?.length
          ? `Applied ${data.applied.length} statement(s):\n${data.applied.join("\n")}`
          : "Nothing to repair — all expected columns exist.",
      );
    } catch (err) {
      setSchemaMessage(err instanceof Error ? err.message : "Schema repair failed");
    } finally {
      setSchemaBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    setWipeBusy(true);
    setWipeError("");
    try {
      const res = await fetch("/api/inventory/all", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete all stock items");
      setDeleteAllOpen(false);
      setWipeConfirm("");
      onRefresh();
    } catch (err) {
      setWipeError(err instanceof Error ? err.message : "Failed to delete all stock items");
    } finally {
      setWipeBusy(false);
    }
  };

  // Single-item delete uses an in-app confirmation dialog (not the browser's
  // native confirm) and reports server failures instead of swallowing them.
  const deleteItem = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Server error (HTTP ${res.status})`);
      setConfirmDelete(null);
      onRefresh();
    } catch (err) {
      console.error("Delete inventory error", err);
      setDeleteError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeleteBusy(false);
    }
  };

  // ---- manager-editable category list (add / rename / remove) ----
  const canManageStockCategories = currentUser?.role === "Manager";

  const openManageCategories = () => {
    setManageRows(stockCategories.map((c) => ({ key: c, original: c, name: c })));
    setNewCategory("");
    setManageError("");
    setManageOpen(true);
  };

  const saveManageCategories = async () => {
    const rows = manageRows.map((row) => ({ ...row, name: row.name.trim() }));
    const nextCategories = rows.map((row) => row.name).filter(Boolean);
    const renames = rows
      .filter((row) => row.original && row.name && row.name !== row.original)
      .map((row) => ({ from: row.original, to: row.name }));
    if (nextCategories.length === 0) {
      setManageError("Keep at least one stock category.");
      return;
    }
    setManageSaving(true);
    setManageError("");
    try {
      const res = await fetch("/api/inventory-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: nextCategories, renames }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save stock categories.");
      const list: string[] = Array.isArray(data.categories) ? data.categories : nextCategories;
      setStockCategories(list);
      setCategory((c) => (list.some((x) => x === c) ? c : list[0]));
      setManageOpen(false);
      await onRefresh();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Failed to save stock categories.");
    } finally {
      setManageSaving(false);
    }
  };

  const openOrdersForItem = async (item: any) => {
    setShowOrdersModal(item);
    setOrdersForItem(null);
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/inventory/${item.id}/orders`);
      if (res.ok) setOrdersForItem(await res.json());
    } catch (err) {
      console.error("Failed to load orders for item", err);
    } finally {
      setOrdersLoading(false);
    }
  };

  const openImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportError("");
    setImportResult(null);
    setShowImportModal(true);
  };

  const chooseImportFile = (file: File | null) => {
    setImportPreview(null);
    setImportResult(null);
    setImportError("");
    if (!file) {
      setImportFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setImportFile(null);
      setImportError("Choose an .xlsx workbook. Download the WoodTek template if needed.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportFile(null);
      setImportError("The workbook is larger than the 5 MB limit.");
      return;
    }
    setImportFile(file);
  };

  const runInventoryImport = async (mode: "preview" | "commit") => {
    if (!importFile || importBusy) return;
    setImportBusy(mode);
    setImportError("");
    try {
      const form = new FormData();
      form.append("mode", mode);
      form.append("file", importFile);
      const response = await fetch("/api/inventory/import", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (mode === "preview") {
        if (typeof data?.valid === "boolean") setImportPreview(data as InventoryImportValidation);
        if (!response.ok && typeof data?.valid !== "boolean") {
          throw new Error(data?.error || "The workbook could not be validated.");
        }
        if (data?.valid === false) {
          setImportError(`Nothing was imported. Fix ${data.errors?.length || 1} row${data.errors?.length === 1 ? "" : "s"} and validate again.`);
        }
        return;
      }

      if (!response.ok || data?.success !== true) {
        if (typeof data?.valid === "boolean") setImportPreview(data as InventoryImportValidation);
        throw new Error(data?.error || "The workbook was not imported. Zero rows were written.");
      }
      const result: ImportResult = {
        total: Number(data.total) || 0,
        created: Number(data.created) || 0,
        updated: Number(data.updated) || 0,
      };
      setImportResult(result);
      setLastImportResult(result);
      setImportPreview(null);
      await onRefresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "The workbook was not imported. Zero rows were written.");
    } finally {
      setImportBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading material inventory…</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {lastImportResult && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <span className="font-bold">
              Excel import complete: {lastImportResult.created} created, {lastImportResult.updated} updated ({lastImportResult.total} total).
            </span>
          </div>
          <button onClick={() => setLastImportResult(null)} className="rounded-lg p-1 text-emerald-300 hover:bg-emerald-500/20 hover:text-white" aria-label="Dismiss import result">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total SKUs</div>
            <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-400"><Package className="h-4 w-4" /></div>
          </div>
          <div className="text-2xl font-black text-white mt-1">{totalItems}</div>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">On-hand Units</div>
            <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400"><Layers className="h-4 w-4" /></div>
          </div>
          <div className="text-2xl font-black text-white mt-1">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">Reserved by Orders</div>
            <div className="rounded-lg bg-amber-500/20 p-1.5 text-amber-300"><Lock className="h-4 w-4" /></div>
          </div>
          <div className="text-2xl font-black text-amber-300 mt-1">{reservedUnits.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-400">Reorder Needed</div>
            <div className="rounded-lg bg-rose-500/20 p-1.5 text-rose-300"><AlertTriangle className="h-4 w-4" /></div>
          </div>
          <div className="text-2xl font-black text-rose-300 mt-1">{lowStockCount}</div>
        </div>
      </div>

      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-4 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-400 mr-1">Category:</span>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                categoryFilter === c
                  ? "bg-amber-500 text-slate-950 font-black shadow"
                  : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {c}
            </button>
          ))}
          {canManageStockCategories && (
            <>
              <button
                onClick={openManageCategories}
                title="Add, rename or remove stock categories"
                className="ml-1 flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5" /> Manage
              </button>
              <button
                onClick={() => { setWipeConfirm(""); setWipeError(""); setDeleteAllOpen(true); }}
                title="Delete every stock item (Manager)"
                className="flex items-center gap-1.5 rounded-xl border border-rose-900/70 bg-rose-950/40 px-3 py-1 text-xs font-bold text-rose-300 transition hover:border-rose-600 hover:bg-rose-900/40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete All
              </button>
              <button
                onClick={openSchemaCheck}
                title="Compare the live database tables with what the app expects, and add any missing columns"
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs font-bold text-slate-300 transition hover:border-sky-500/60 hover:text-sky-300"
              >
                <Database className="h-3.5 w-3.5" /> Schema Check
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canImportStock && (
            <>
              <a
                href="/api/inventory/import"
                download="WoodTek-Stock-Import-Template.xlsx"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-extrabold text-slate-200 transition hover:border-emerald-500/50 hover:text-emerald-300"
                title="Download the required Excel workbook template"
              >
                <Download className="h-4 w-4" /> Excel Template
              </a>
              <button
                onClick={openImport}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-xs font-black text-emerald-200 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-500/25 active:scale-[0.97]"
              >
                <FileSpreadsheet className="h-4 w-4 stroke-[2.5]" /> Import Excel
              </button>
            </>
          )}
          <button
            onClick={() => { resetItemForm(); setShowModal(true); }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 ring-1 ring-inset ring-amber-300/40 transition hover:from-amber-300 hover:to-amber-500 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" /> Receive / Add Stock Item
          </button>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-14 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/60">
              <Package className="h-7 w-7 text-amber-500/80 stroke-[1.5]" />
            </div>
            <h3 className="text-base font-bold text-white">No Stock Items Found</h3>
            <p className="mt-1 text-xs text-slate-400">No materials match this category. Adjust the filter or receive new stock.</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-3.5 px-5">SKU & Item Name</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Shop Location</th>
                <th className="py-3.5 px-4 text-right">Unit Cost</th>
                <th className="py-3.5 px-4 text-center">Stock / Reserved / Available</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs text-slate-200">
              {filtered.map((item) => {
                const stock = Number(item.stockQuantity) || 0;
                const reserved = Number(item.reservedQuantity) || 0;
                const available = Number(item.availableQuantity ?? stock) || 0;
                const isLow = available <= item.reorderLevel;
                const hasReservations = reserved > 0;
                return (
                  <tr key={item.id} className="transition hover:bg-slate-800/50">
                    <td className="py-4 px-5 font-medium">
                      <div className="font-mono text-[11px] font-black text-amber-400">{item.sku}</div>
                      <div className="text-sm font-extrabold text-white mt-0.5">{item.name}</div>
                      {item.dimensions ? <div className="font-mono text-[10px] text-sky-300/90 mt-0.5">{item.dimensions}</div> : null}
                    </td>
                    <td className="py-4 px-4 text-slate-300 font-semibold">{item.category}</td>
                    <td className="py-4 px-4 text-slate-400 font-mono">{item.location}</td>
                    <td className="py-4 px-4 text-right font-mono font-black text-white">
                      {item.unitCost !== null ? `$${Number(item.unitCost).toFixed(2)}` : <span className="text-slate-600 italic text-[10px]">restricted</span>}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="inline-flex flex-col items-center gap-1 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800">
                        <div className="flex items-center gap-2 px-1.5">
                          <button
                            onClick={() => handleAdjustStock(item.id, stock, -5)}
                            className="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px]"
                            title="Reduce stock (-5)"
                          >
                            -
                          </button>
                          <span className="w-14 text-center font-mono font-black text-sm text-white">
                            {stock} <span className="text-[10px] text-slate-500 font-normal">{item.unit}</span>
                          </span>
                          <button
                            onClick={() => handleAdjustStock(item.id, stock, 10)}
                            className="w-5 h-5 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px]"
                            title="Add received stock (+10)"
                          >
                            +
                          </button>
                        </div>
                        {hasReservations && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold">
                            <span className="text-amber-400">R {reserved}</span>
                            <span className="text-slate-600">/</span>
                            <span className={available <= item.reorderLevel ? "text-rose-300" : "text-emerald-300"}>A {available}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      {isLow ? (
                        <span className="inline-flex items-center gap-1 bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase">
                          <AlertTriangle className="w-3 h-3 text-rose-400" /> Reorder Needed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Optimal Stock
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openOrdersForItem(item)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded-lg transition text-[10px] font-bold uppercase tracking-wider flex items-center gap-1"
                          title="See which orders are using this material"
                        >
                          Orders
                          <ChevronRight className="w-3 h-3" />
                        </button>
                        {canImportStock && (
                          <button
                            onClick={() => openEditItem(item)}
                            className="p-1.5 hover:bg-sky-500/20 text-slate-600 hover:text-sky-300 rounded-lg transition"
                            title="Edit item"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => { setDeleteError(""); setConfirmDelete({ id: item.id, name: item.name }); }}
                          className="p-1.5 hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 rounded-lg transition"
                          title="Delete item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Excel stock import — visible from the tab-level action above. */}
      {showImportModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-300">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Import Wood & Edge Stock from Excel</h3>
                  <p className="mt-1 text-xs text-slate-400">Upload → validate every row → review creates and updates → import atomically.</p>
                </div>
              </div>
              <button
                onClick={() => !importBusy && setShowImportModal(false)}
                disabled={Boolean(importBusy)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
                aria-label="Close Excel import"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {importResult ? (
                <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <h4 className="mt-4 text-xl font-black text-white">Stock import complete</h4>
                  <p className="mt-2 text-sm text-emerald-100">The visible Stock table has been refreshed.</p>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-slate-950/60 p-3"><div className="text-2xl font-black text-white">{importResult.total}</div><div className="text-[10px] font-bold uppercase text-slate-500">Total</div></div>
                    <div className="rounded-xl bg-slate-950/60 p-3"><div className="text-2xl font-black text-emerald-300">{importResult.created}</div><div className="text-[10px] font-bold uppercase text-slate-500">Created</div></div>
                    <div className="rounded-xl bg-slate-950/60 p-3"><div className="text-2xl font-black text-sky-300">{importResult.updated}</div><div className="text-[10px] font-bold uppercase text-slate-500">Updated</div></div>
                  </div>
                  <button onClick={() => setShowImportModal(false)} className="mt-6 rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400">Done</button>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["1", "Select workbook", "Use the WoodTek .xlsx template"],
                      ["2", "Validation preview", "No database writes happen yet"],
                      ["3", "Atomic import", "All rows succeed or zero are written"],
                    ].map(([number, title, detail], index) => (
                      <div key={number} className={`rounded-xl border p-3 ${index === 0 || importPreview ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-950/30"}`}>
                        <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[11px] font-black text-emerald-300">{number}</span><span className="text-xs font-black text-white">{title}</span></div>
                        <p className="mt-1.5 pl-8 text-[10px] text-slate-500">{detail}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                    <span className="font-black">Important:</span> Stock Quantity is the new absolute on-hand value—it replaces the current quantity. Existing SKUs match after trimming and without regard to letter case.
                  </div>

                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      chooseImportFile(event.dataTransfer.files?.[0] ?? null);
                    }}
                    className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/40 p-6 text-center transition hover:border-emerald-500/50"
                  >
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="hidden"
                      onChange={(event) => chooseImportFile(event.target.files?.[0] ?? null)}
                    />
                    <Upload className="mx-auto h-8 w-8 text-emerald-400" />
                    {importFile ? (
                      <>
                        <div className="mt-2 text-sm font-black text-white">{importFile.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">{(importFile.size / 1024).toFixed(1)} KB · ready to validate</div>
                      </>
                    ) : (
                      <>
                        <div className="mt-2 text-sm font-black text-white">Drop an .xlsx workbook here</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">Maximum 5 MB and 2,000 data rows</div>
                      </>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <button type="button" onClick={() => importInputRef.current?.click()} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100 hover:bg-slate-700">
                        {importFile ? "Choose another file" : "Choose workbook"}
                      </button>
                      <a href="/api/inventory/import" download="WoodTek-Stock-Import-Template.xlsx" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10">
                        <Download className="h-4 w-4" /> Download template
                      </a>
                    </div>
                  </div>

                  {importError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-bold text-rose-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{importError}</span>
                    </div>
                  )}

                  {importPreview && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase ${importPreview.valid ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                          {importPreview.valid ? "Validation passed" : "Validation failed"}
                        </span>
                        {importPreview.valid && (
                          <>
                            <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-bold text-white">{importPreview.summary.total} rows</span>
                            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">{importPreview.summary.creates} create</span>
                            <span className="rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-bold text-sky-300">{importPreview.summary.updates} update</span>
                          </>
                        )}
                      </div>

                      {importPreview.errors.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-rose-500/30">
                          <div className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs font-black text-rose-200">Row-specific errors — zero rows can be imported until all are fixed</div>
                          <div className="max-h-56 divide-y divide-slate-800 overflow-y-auto bg-slate-950/50">
                            {importPreview.errors.map((error) => (
                              <div key={`${error.rowNumber}-${error.sku || "row"}`} className="grid gap-1 px-4 py-2.5 text-xs sm:grid-cols-[100px_1fr]">
                                <div className="font-black text-rose-300">Row {error.rowNumber}{error.sku ? ` · ${error.sku}` : ""}</div>
                                <ul className="list-disc space-y-0.5 pl-4 text-slate-300">{error.messages.map((message) => <li key={message}>{message}</li>)}</ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {importPreview.rows.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-slate-700">
                          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-2">
                            <span className="text-xs font-black text-white">Validated workbook preview</span>
                            {importPreview.rows.length > 250 && <span className="text-[10px] text-slate-500">Showing first 250 rows</span>}
                          </div>
                          <div className="max-h-72 overflow-auto">
                            <table className="w-full min-w-[1100px] text-left text-[11px]">
                              <thead className="sticky top-0 bg-slate-950 text-[9px] uppercase tracking-wider text-slate-500">
                                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Reorder</th><th className="px-3 py-2">Location</th></tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/70">
                                {importPreview.rows.slice(0, 250).map((row) => (
                                  <tr key={row.rowNumber} className="text-slate-300">
                                    <td className="px-3 py-2 font-mono text-slate-500">{row.rowNumber}</td>
                                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${row.action === "create" ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"}`}>{row.action}</span></td>
                                    <td className="px-3 py-2 font-mono font-bold text-amber-300">{row.sku}</td>
                                    <td className="max-w-[260px] truncate px-3 py-2 font-semibold text-white">{row.name}</td>
                                    <td className="px-3 py-2">{row.category}</td>
                                    <td className="px-3 py-2 text-right font-mono">{row.stockQuantity}</td>
                                    <td className="px-3 py-2">{row.unit}</td>
                                    <td className="px-3 py-2 text-right font-mono">${row.unitCost}</td>
                                    <td className="px-3 py-2 text-right font-mono">{row.reorderLevel}</td>
                                    <td className="px-3 py-2">{row.location}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {!importResult && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/40 px-5 py-4">
                <button type="button" onClick={() => setShowImportModal(false)} disabled={Boolean(importBusy)} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40">Cancel</button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runInventoryImport("preview")}
                    disabled={!importFile || Boolean(importBusy)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {importBusy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    {importPreview ? "Validate again" : "Validate workbook"}
                  </button>
                  <button
                    type="button"
                    onClick={() => runInventoryImport("commit")}
                    disabled={!importFile || !importPreview?.valid || Boolean(importBusy)}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                    title={!importPreview?.valid ? "Validate a completely valid workbook first" : "Import all validated rows"}
                  >
                    {importBusy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Import {importPreview?.valid ? `${importPreview.summary.total} rows` : "all rows"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">{editingId ? "Edit Stock Item" : "Register Raw Material Item"}</h3>
              <button onClick={() => { setShowModal(false); setEditingId(null); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">SKU *</label>
                  <input
                    type="text"
                    required
                    placeholder="BRD-WHT-18"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    disabled={!!editingId}
                    title={editingId ? "The SKU is the stock identity of an existing item and cannot be changed here." : undefined}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                    {categories.filter((c) => c !== "All").map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Item Specification Name *</label>
                <input type="text" required placeholder="e.g. Matte White Supermatt Melamine 18mm" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              {isPanelCategory(category) && (
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Dimensions (L × W × Thickness)</label>
                  <input
                    type="text"
                    placeholder="e.g. 2440 x 1220 x 18"
                    value={dimensions}
                    onChange={(e) => { setDimensions(e.target.value); setDimensionsError(""); }}
                    className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-white font-mono ${dimensionsError ? "border-rose-500" : "border-slate-700"}`}
                  />
                  {dimensionsError && <p className="mt-1 text-[11px] font-bold text-rose-400">{dimensionsError}</p>}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Initial Qty</label>
                  <input type="number" value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Unit</label>
                  <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Unit Cost ($)</label>
                  <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Reorder Level</label>
                  <input type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Shop Location</label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => { setShowModal(false); setEditingId(null); }} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow">{editingId ? "Save Changes" : "Register Item"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage categories modal (Manager) */}
      {manageOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Manage Stock Categories</h3>
              <button onClick={() => setManageOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Rename in place, remove empty rows or add new ones. A category that still has items cannot be
              removed (rename it instead). Names containing “Panel” show the Dimensions field on the item form.
            </p>
            <div className="space-y-2">
              {manageRows.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      setManageRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))
                    }
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setManageRows((rows) => rows.filter((r) => r.key !== row.key))}
                    title="Remove this category"
                    className="rounded-xl border border-slate-700 bg-slate-950 p-2 text-slate-400 hover:border-rose-500/60 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="New category, e.g. Hardware & Fittings"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => {
                  const name = newCategory.trim();
                  if (!name) return;
                  if (manageRows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) return;
                  setManageRows((rows) => [...rows, { key: `new-${name}`, original: "", name }]);
                  setNewCategory("");
                }}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
            {manageError && <p className="text-[11px] font-bold text-rose-400">{manageError}</p>}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setManageOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveManageCategories()}
                disabled={manageSaving}
                className="px-5 py-2 bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow disabled:opacity-50"
              >
                {manageSaving ? "Saving…" : "Save Categories"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete ALL stock confirmation (Manager) */}
      {deleteAllOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-rose-900/70 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-rose-300">Delete ALL Stock Items</h3>
              <button
                onClick={() => setDeleteAllOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              This permanently removes <span className="font-black text-white">{items.length}</span> stock
              item(s), their material allocations on orders, and their consumption records. It cannot be
              undone from the app — the nightly backup is the only recovery path. Use it to wipe physical
              stock before a fresh Excel import.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Type <span className="font-mono text-rose-300">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={wipeConfirm}
                onChange={(e) => setWipeConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-slate-950 border border-rose-900/70 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase"
              />
            </div>
            {wipeError && <p className="text-[11px] font-bold text-rose-400">{wipeError}</p>}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setDeleteAllOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAll()}
                disabled={wipeConfirm !== "DELETE" || wipeBusy}
                className="px-5 py-2 bg-rose-600 text-white font-black text-xs rounded-xl shadow hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {wipeBusy ? "Deleting…" : "Delete Everything"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single-item delete confirmation (in-app, with visible errors) */}
      {confirmDelete && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Remove Stock Item</h3>
              <button onClick={() => setConfirmDelete(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-300">
              Remove <span className="font-black text-white">{confirmDelete.name}</span> from shop stock? Its
              allocations on orders and its consumption history are removed too.
            </p>
            {deleteError && <p className="text-[11px] font-bold text-rose-400">Delete failed: {deleteError}</p>}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setConfirmDelete(null)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteItem()}
                disabled={deleteBusy}
                className="px-5 py-2 bg-rose-600 text-white font-black text-xs rounded-xl shadow hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteBusy ? "Deleting…" : "Delete Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Database schema check & repair (Manager) */}
      {schemaOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Database Schema Check</h3>
              <button onClick={() => setSchemaOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Compares the live stock tables with the columns the app expects. Repair only
              <span className="font-bold text-slate-200"> adds missing columns</span> (nothing is dropped or
              altered) — use it when deletes fail with “column … does not exist”.
            </p>
            {schemaBusy && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] font-bold text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> Working…
              </div>
            )}
            {schemaTables.map((t) => (
              <div key={t.table} className={`rounded-xl border p-3 ${t.missing.length ? "border-rose-500/40 bg-rose-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-white">{t.table}</span>
                  {t.missing.length ? (
                    <span className="text-[10px] font-black uppercase text-rose-300">{t.missing.length} missing</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> OK
                    </span>
                  )}
                </div>
                {t.missing.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-rose-300">missing: {t.missing.join(", ")}</p>
                )}
                {t.unexpected.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-amber-300/90">extra (left untouched): {t.unexpected.join(", ")}</p>
                )}
                {t.foreignKeys.length > 0 && (
                  <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-500">
                    {t.foreignKeys.map((f) => `${f.conname}: ${f.def}`).join(" | ")}
                  </p>
                )}
              </div>
            ))}
            {schemaMessage && (
              <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-sky-300">{schemaMessage}</p>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" onClick={() => setSchemaOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">
                Close
              </button>
              {schemaTables.some((t) => t.missing.length > 0) && (
                <button
                  type="button"
                  onClick={() => void runSchemaRepair()}
                  disabled={schemaBusy}
                  className="px-5 py-2 bg-sky-600 text-white font-black text-xs rounded-xl shadow hover:bg-sky-500 disabled:opacity-40"
                >
                  {schemaBusy ? "Working…" : "Add Missing Columns"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* "Which orders use this material?" modal */}
      {showOrdersModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center p-5 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">Orders using this material</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  <span className="font-mono text-amber-400">{showOrdersModal.sku}</span> · {showOrdersModal.name}
                </p>
              </div>
              <button onClick={() => setShowOrdersModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-5 flex-1">
              {ordersLoading ? (
                <div className="text-center text-slate-400 py-8 animate-pulse">Loading orders…</div>
              ) : !ordersForItem ? (
                <div className="text-center text-rose-300 py-8">Failed to load.</div>
              ) : (
                <>
                  <section>
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400 mb-2">
                      Active reservations ({ordersForItem.active?.length || 0})
                    </h4>
                    {!ordersForItem.active?.length ? (
                      <div className="text-xs text-slate-500 italic bg-slate-950/40 rounded-xl p-3 text-center border border-slate-800/50">
                        No active orders are reserving this material.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 text-[10px] uppercase">
                            <th className="text-left py-1.5 px-2">Order</th>
                            <th className="text-left py-1.5 px-2">Customer</th>
                            <th className="text-left py-1.5 px-2">Status</th>
                            <th className="text-left py-1.5 px-2">Due</th>
                            <th className="text-right py-1.5 px-2">Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {ordersForItem.active.map((a) => (
                            <tr key={a.allocationId} className="text-slate-200">
                              <td className="py-2 px-2 font-mono text-amber-400">{a.orderNumber}</td>
                              <td className="py-2 px-2">{a.customerCompany || a.customerName || "—"}</td>
                              <td className="py-2 px-2">
                                <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">{a.orderStatus}</span>
                              </td>
                              <td className="py-2 px-2 text-slate-400">
                                {a.orderDueDate ? new Date(a.orderDueDate).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-2 px-2 text-right font-mono font-bold text-amber-300">{a.quantityUsed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>

                  {ordersForItem.consumed?.length > 0 && (
                    <section>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                        Already consumed ({ordersForItem.consumed.length})
                      </h4>
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-800/60">
                          {ordersForItem.consumed.map((a) => (
                            <tr key={a.allocationId} className="text-slate-400">
                              <td className="py-2 px-2 font-mono">{a.orderNumber}</td>
                              <td className="py-2 px-2">{a.customerCompany || a.customerName || "—"}</td>
                              <td className="py-2 px-2 text-right font-mono">{a.quantityUsed} (consumed)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
