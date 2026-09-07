"use client";

import React, { useState } from "react";
import { Package, Plus, AlertTriangle, CheckCircle2, DollarSign, Tag, Layers, Trash2, X, RefreshCw, Lock, ChevronRight } from "lucide-react";

interface InventoryViewProps {
  items: any[];
  loading: boolean;
  onRefresh: () => void;
}

export default function InventoryView({ items = [], loading, onRefresh }: InventoryViewProps) {
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

  const categories = ["All", "Wood & MDF Panels", "Edge Banding", "Hardware & Fittings", "Coatings & Adhesives"];

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
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, name, category, stockQuantity: Number(stockQuantity), unit, unitCost, reorderLevel: Number(reorderLevel), location }),
      });
      if (!res.ok) throw new Error("Failed to create item");
      setShowModal(false);
      setSku("");
      setName("");
      onRefresh();
    } catch (err) {
      console.error("Create inventory error", err);
      alert("Error adding item. SKU must be unique.");
    }
  };

  const handleDelete = async (id: number, itemName: string) => {
    if (!confirm(`Remove ${itemName} from shop stock?`)) return;
    try {
      await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error("Delete inventory error", err);
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
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 ring-1 ring-inset ring-amber-300/40 transition hover:from-amber-300 hover:to-amber-500 active:scale-[0.97]"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" /> Receive / Add Stock Item
        </button>
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
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
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

      {/* Add Item Modal */}
      {showModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Register Raw Material Item</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">SKU *</label>
                  <input type="text" required placeholder="BRD-WHT-18" value={sku} onChange={(e) => setSku(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase" />
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
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-bold rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow">Register Item</button>
              </div>
            </form>
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
