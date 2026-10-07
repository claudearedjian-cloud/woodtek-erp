"use client";

// ============================================================================
// Warehouse board — every open order with its requested materials.
// The warehouse supervisor moves each line: Requested -> Prepared -> Delivered,
// optionally choosing which machine the material goes to.
//
// The screen also owns the warehouse register (the places stock lives): add,
// rename, edit and delete warehouses, with the stock count per warehouse.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  Undo2,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { sentQty } from "@/lib/bomDelivery";
import { useT } from "@/lib/langContext";
import ViewToggle, { ResultCount, useViewMode } from "@/components/ViewToggle";

/** One row of GET /api/warehouses — the register plus stock usage. */
interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  address: string;
  active: boolean;
  itemCount: number;
  unitCount: number;
}

const EMPTY_WAREHOUSE_FORM = { id: "", name: "", code: "", address: "", active: true };

/** Prepare / Send / Partial / Undo — identical in every view. */
function LineActions({
  line,
  canUpdate,
  busy,
  onStatus,
  onPartial,
  compact = false,
}: {
  line: Line;
  canUpdate: boolean;
  busy: boolean;
  onStatus: (line: Line, status: Line["status"]) => void;
  onPartial: (line: Line) => void;
  compact?: boolean;
}) {
  const t = useT();
  if (!canUpdate) return null;
  const buttonBase = compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[10px]";
  return (
    <div className="flex items-center gap-1.5">
      {line.status === "Requested" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onStatus(line, "Prepared")}
          className={`flex items-center gap-1 rounded-lg bg-sky-600 font-black text-white hover:bg-sky-500 disabled:opacity-50 ${buttonBase}`}
        >
          <PackageCheck className="h-3.5 w-3.5" /> {t("Prepare")}
        </button>
      )}
      {line.status === "Prepared" && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus(line, "Delivered")}
            className={`flex items-center gap-1 rounded-lg bg-emerald-600 font-black text-white hover:bg-emerald-500 disabled:opacity-50 ${buttonBase}`}
          >
            <Send className="h-3.5 w-3.5" /> {t("Send")}
          </button>
          {line.quantityUsed > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPartial(line)}
              title="Send part of this quantity now, the rest later"
              className={`rounded-lg border border-sky-500/50 bg-sky-500/10 font-black text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 ${buttonBase}`}
            >
              Partial…
            </button>
          )}
        </>
      )}
      {line.status !== "Requested" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onStatus(line, "Requested")}
          title="Move back to Requested"
          className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface Line {
  id: number;
  itemName: string | null;
  itemSku: string | null;
  itemUnit: string | null;
  itemCategory: string | null;
  stockQuantity: number | null;
  quantityUsed: number;
  consumed: boolean;
  released: boolean;
  status: "Requested" | "Prepared" | "Delivered";
  machineId: number | null;
  deliveredQty?: number | null;
  productionItemName?: string | null;
  productionRecipeName?: string | null;
}

interface BoardOrder {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  customerCompany: string | null;
  materials: Line[];
  machines: { id: number; code: string | null; name: string | null }[];
  received: boolean | null;
  receivedState?: string | null;
}

const STATUS_STYLE: Record<Line["status"], string> = {
  Requested: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Prepared: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  Delivered: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
};

export default function WarehouseView({ currentUser }: { currentUser: any }) {
  // Label language (top-bar EN / AR / FR) — English by default.
  const t = useT();
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const canUpdate =
    can(currentUser?.role, "inventory:write") || can(currentUser?.role, "orders:write");
  const isManager = can(currentUser?.role, "users:manage");

  // ---- warehouse register (the places stock lives) -------------------------
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [showWarehouses, setShowWarehouses] = useState(false);
  const [whForm, setWhForm] = useState({ ...EMPTY_WAREHOUSE_FORM });
  const [whEditingId, setWhEditingId] = useState<string | null>(null);
  const [whBusy, setWhBusy] = useState(false);
  const [whMsg, setWhMsg] = useState("");
  const [whError, setWhError] = useState("");
  const canManageWarehouses = can(currentUser?.role, "inventory:write");

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await fetch("/api/warehouses", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.warehouses)) setWarehouses(data.warehouses);
    } catch {
      /* best effort — the board still works without the register */
    }
  }, []);

  const resetWarehouseForm = () => {
    setWhForm({ ...EMPTY_WAREHOUSE_FORM });
    setWhEditingId(null);
    setWhError("");
  };

  const startEditWarehouse = (row: WarehouseRow) => {
    setWhEditingId(row.id);
    setWhForm({ id: row.id, name: row.name, code: row.code, address: row.address, active: row.active });
    setWhError("");
    setWhMsg("");
  };

  const saveWarehouse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (whBusy) return;
    setWhBusy(true);
    setWhError("");
    setWhMsg("");
    try {
      const res = await fetch("/api/warehouses", {
        method: whEditingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...whForm, id: whEditingId ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the warehouse.");
      if (Array.isArray(data.warehouses)) setWarehouses(data.warehouses);
      setWhMsg(whEditingId ? "Warehouse updated — stock rows moved with the new name." : "Warehouse added.");
      resetWarehouseForm();
      await loadWarehouses();
    } catch (e) {
      setWhError(e instanceof Error ? e.message : "Could not save the warehouse.");
    } finally {
      setWhBusy(false);
    }
  };

  const deleteWarehouse = async (row: WarehouseRow) => {
    if (whBusy) return;
    if (!confirm(`Delete the warehouse "${row.name}"?`)) return;
    setWhBusy(true);
    setWhError("");
    setWhMsg("");
    try {
      const attempt = async (force: boolean) => {
        const res = await fetch(`/api/warehouses?id=${encodeURIComponent(row.id)}${force ? "&force=1" : ""}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      let { res, data } = await attempt(false);
      if (res.status === 409) {
        if (!confirm(`${data.error}\n\nMove them and delete anyway?`)) return;
        ({ res, data } = await attempt(true));
      }
      if (!res.ok) throw new Error(data.error || "Could not delete the warehouse.");
      if (Array.isArray(data.warehouses)) setWarehouses(data.warehouses);
      setWhMsg(`Warehouse "${row.name}" deleted.`);
      if (whEditingId === row.id) resetWarehouseForm();
      await loadWarehouses();
    } catch (e) {
      setWhError(e instanceof Error ? e.message : "Could not delete the warehouse.");
    } finally {
      setWhBusy(false);
    }
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/bom", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load the BOM board");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the BOM board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    void loadWarehouses();
  }, [load, loadWarehouses]);

  const setStatus = async (line: Line, status: Line["status"], machineId?: number | null, deliverQty?: number) => {
    setBusyId(line.id);
    try {
      const res = await fetch("/api/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationId: line.id,
          status,
          machineId: machineId ?? line.machineId,
          ...(deliverQty != null ? { deliverQty } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setWarn(data.warning || "");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  // Partial send: ask for the quantity, clamp it, pick the resulting status.
  const sendPartial = (line: Line) => {
    const remaining = line.quantityUsed - sentQty(line);
    const raw = window.prompt(
      `Send how many of "${line.itemName || "this line"}" to the floor? (0–${line.quantityUsed}, ${remaining} not sent yet)`,
      String(remaining),
    );
    if (raw == null) return; // cancelled
    const n = Math.max(0, Math.min(line.quantityUsed, Math.floor(Number(raw) || 0)));
    if (n <= 0) return;
    setStatus(line, n >= line.quantityUsed ? "Delivered" : "Prepared", line.machineId, n);
  };

  const withLines = useMemo(() => orders.filter((o) => o.materials.length > 0), [orders]);

  // ---- filters: search + line status -------------------------------------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "notdelivered" | Line["status"]>("all");

  const lineMatches = useCallback(
    (line: Line, order: BoardOrder) => {
      if (statusFilter === "notdelivered" && line.status === "Delivered") return false;
      if (statusFilter !== "all" && statusFilter !== "notdelivered" && line.status !== statusFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [
        order.orderNumber,
        order.title,
        order.customerCompany,
        line.itemName,
        line.itemSku,
        line.itemCategory,
        line.productionItemName,
      ].some((value) => String(value ?? "").toLowerCase().includes(q));
    },
    [search, statusFilter],
  );

  const visible = useMemo(
    () =>
      withLines
        .map((order) => ({
          ...order,
          materials: order.materials.filter(
            (line) => lineMatches(line, order) && !(hideDone && line.status === "Delivered"),
          ),
        }))
        .filter((order) => order.materials.length > 0),
    [withLines, lineMatches, hideDone],
  );

  const filtersActive = Boolean(search.trim()) || statusFilter !== "all" || hideDone;

  const allLines = withLines.reduce((total, order) => total + order.materials.length, 0);
  const shownLines = visible.reduce((total, order) => total + order.materials.length, 0);

  const counts = withLines.reduce(
    (acc, o) => {
      for (const m of o.materials) acc[m.status] += 1;
      return acc;
    },
    { Requested: 0, Prepared: 0, Delivered: 0 } as Record<Line["status"], number>,
  );

  /** Flat line list — the List and Table views read this. */
  const flatLines = useMemo(
    () => visible.flatMap((order) => order.materials.map((line) => ({ order, line }))),
    [visible],
  );

  const [view, setView] = useViewMode("warehouse", "cards");

  const stationLabel = (order: BoardOrder, line: Line) =>
    line.machineId != null
      ? order.machines.find((m) => m.id === line.machineId)?.code || `Machine #${line.machineId}`
      : "—";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-white">
              <WarehouseIcon className="h-5 w-5 text-amber-400" /> Warehouse
            </h1>
            <p className="text-xs text-slate-400">
              Materials requested by open orders — prepare them, then send them to the machine.
              Sending consumes the shop stock immediately; undoing a send restores it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageWarehouses && (
              <button
                type="button"
                onClick={() => { setShowWarehouses((v) => !v); setWhMsg(""); setWhError(""); }}
                className="flex items-center gap-1.5 rounded-xl border border-amber-600/60 bg-amber-500/10 px-3 py-1.5 text-[11px] font-black text-amber-300 hover:bg-amber-500/20"
                title="Add, rename or delete the warehouses stock is stored in"
              >
                <WarehouseIcon className="h-3.5 w-3.5" /> Warehouses ({warehouses.length})
              </button>
            )}
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              {t("Hide delivered")}
            </label>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-500"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t("Refresh")}
            </button>
          </div>
        </div>

        {/* ---- warehouse register: add / rename / delete places stock lives ---- */}
        {showWarehouses && canManageWarehouses && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-black text-white">
                <WarehouseIcon className="h-4 w-4 text-amber-400" /> Warehouses — where stock is stored
              </h2>
              <button type="button" onClick={() => { setShowWarehouses(false); resetWarehouseForm(); }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Renaming a warehouse moves the stock rows already stored there. Deleting asks first when items are still
              inside. Stock items pick their warehouse from this list on the Inventory screen.
            </p>

            <div className="mt-3 space-y-2">
              {warehouses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                  Loading the warehouse list…
                </div>
              ) : (
                warehouses.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-[10px] font-black text-amber-300">
                      {(row.code || row.name).slice(0, 4).toUpperCase()}
                    </span>
                    <span className="min-w-[180px] flex-1">
                      <span className="block text-xs font-black text-white">{row.name}</span>
                      <span className="block text-[10px] text-slate-500">{row.address || "No address noted"}</span>
                    </span>
                    <span className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-bold text-slate-300">
                      {row.itemCount} item{row.itemCount === 1 ? "" : "s"} · {row.unitCount} unit{row.unitCount === 1 ? "" : "s"}
                    </span>
                    {!row.active && <span className="rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-400">INACTIVE</span>}
                    <button
                      type="button"
                      onClick={() => startEditWarehouse(row)}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-sky-500/20 hover:text-sky-300"
                      title="Edit / rename this warehouse"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {isManager && (
                      <button
                        type="button"
                        disabled={whBusy || warehouses.length <= 1}
                        onClick={() => void deleteWarehouse(row)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-40"
                        title={warehouses.length <= 1 ? "Keep at least one warehouse" : "Delete this warehouse (Manager)"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={saveWarehouse} className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_0.6fr_1.4fr_auto]">
              <input
                value={whForm.name}
                onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                placeholder="Warehouse name — e.g. Panel Store"
                maxLength={60}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              />
              <input
                value={whForm.code}
                onChange={(e) => setWhForm({ ...whForm, code: e.target.value.toUpperCase().slice(0, 12) })}
                placeholder="CODE"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs font-semibold uppercase text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              />
              <input
                value={whForm.address}
                onChange={(e) => setWhForm({ ...whForm, address: e.target.value })}
                placeholder="Address / note (optional)"
                maxLength={160}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={whBusy}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {whEditingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {whEditingId ? "Save" : "Add warehouse"}
                </button>
                {whEditingId && (
                  <button type="button" onClick={resetWarehouseForm} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">
                    Cancel
                  </button>
                )}
              </div>
            </form>
            <label className="mt-2 flex items-center gap-2 text-[11px] font-bold text-slate-400">
              <input
                type="checkbox"
                checked={whForm.active}
                onChange={(e) => setWhForm({ ...whForm, active: e.target.checked })}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              Active — offer this warehouse when a stock item picks its location
            </label>
            {whError && <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-400"><TriangleAlert className="h-3.5 w-3.5" /> {whError}</div>}
            {whMsg && <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-400"><Check className="h-3.5 w-3.5" /> {whMsg}</div>}
          </div>
        )}

        {/* ---- filters: search + line status + view ---- */}
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, client, item, SKU…"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none sm:w-64"
            />
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-1">
              {([
                { id: "all", label: t("All"), count: allLines },
                { id: "notdelivered", label: t("Not delivered"), count: counts.Requested + counts.Prepared },
                { id: "Requested", label: t("Requested"), count: counts.Requested },
                { id: "Prepared", label: t("Prepared"), count: counts.Prepared },
                { id: "Delivered", label: t("Delivered"), count: counts.Delivered },
              ] as const).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatusFilter(chip.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition ${
                    statusFilter === chip.id ? "bg-amber-500 text-slate-950 shadow" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {chip.label}
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${statusFilter === chip.id ? "bg-slate-950/20 text-slate-900" : "bg-slate-800 text-slate-400"}`}>
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setSearch(""); setStatusFilter("all"); setHideDone(false); }}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
              >
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
            <ResultCount shown={shownLines} total={allLines} noun="material line" filtered={filtersActive} />
          </div>
          <ViewToggle
            mode={view}
            onChange={setView}
            title="Board, list or table view of the material lines"
            labels={{ cards: "Board", list: "List", table: "Table" }}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <TriangleAlert className="h-4 w-4" /> {error}
          </div>
        )}
        {warn && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <span className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 shrink-0" /> {warn}</span>
            <button onClick={() => setWarn("")} className="rounded px-1.5 text-amber-400 hover:bg-amber-500/20">✕</button>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading the board…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-2 text-sm font-bold text-slate-400">
              {filtersActive ? "Nothing matches these filters" : "Nothing to prepare"}
            </p>
            <p className="text-xs text-slate-500">
              {filtersActive
                ? "Clear the search or pick another status."
                : "BOM lines added on new production orders will appear here."}
            </p>
          </div>
        ) : view === "list" ? (
          <div className="space-y-2">
            {flatLines.map(({ order, line }) => (
              <div key={`${order.id}-${line.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <span className="min-w-[150px]">
                  <span className="block font-mono text-xs font-black text-amber-400">{order.orderNumber}</span>
                  <span className="block truncate text-[11px] text-slate-400">{order.customerCompany || order.title}</span>
                </span>
                <span className="min-w-[180px] flex-1">
                  <span className="block truncate text-xs font-bold text-white">{line.productionItemName || line.itemName || `Item #${line.id}`}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {line.itemSku || "—"}{line.productionRecipeName ? ` · Route: ${line.productionRecipeName}` : ""}
                  </span>
                </span>
                <span className="font-mono text-sm font-black text-amber-300">
                  {line.quantityUsed}<span className="ml-1 text-[10px] text-slate-500">{line.itemUnit || "pcs"}</span>
                </span>
                <span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold text-slate-300">
                  → {stationLabel(order, line)}
                </span>
                <span className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[line.status]}`}>{t(line.status)}</span>
                <LineActions
                  compact
                  line={line}
                  canUpdate={canUpdate}
                  busy={busyId === line.id}
                  onStatus={(row, status) => void setStatus(row, status)}
                  onPartial={sendPartial}
                />
              </div>
            ))}
          </div>
        ) : view === "table" ? (
          <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/90">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Material</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-center">Sent</th>
                    <th className="px-4 py-3">Station</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-xs text-slate-200">
                  {flatLines.map(({ order, line }) => {
                    const sent = sentQty(line);
                    return (
                      <tr key={`${order.id}-${line.id}`} className="transition hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-black text-amber-400">{order.orderNumber}</td>
                        <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-300">{order.customerCompany || order.title}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 font-bold text-white">{line.productionItemName || line.itemName || `Item #${line.id}`}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{line.itemSku || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-black text-amber-300">
                          {line.quantityUsed}<span className="ml-1 text-[10px] text-slate-500">{line.itemUnit || "pcs"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-[11px] text-slate-400">
                          {line.quantityUsed > 1 ? `${sent}/${line.quantityUsed}` : sent > 0 ? "✓" : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">{stationLabel(order, line)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[line.status]}`}>{t(line.status)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end">
                            <LineActions
                              compact
                              line={line}
                              canUpdate={canUpdate}
                              busy={busyId === line.id}
                              onStatus={(row, status) => void setStatus(row, status)}
                              onPartial={sendPartial}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          visible.map((order) => (
            <div key={order.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/60 px-4 py-3">
                <div>
                  <span className="font-mono text-sm font-black text-amber-400 tracking-tight">{order.orderNumber}</span>
                  <span className="ml-2 text-sm font-bold text-white">{order.title}</span>
                  {order.customerCompany && (
                    <span className="ml-2 text-xs text-slate-400">— {order.customerCompany}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-bold">
                  <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">{t(order.status)}</span>
                  <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">
                    Due {order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "—"}
                  </span>
                  {order.received === true && (
                    <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-300">✓ {t("Reception approved")}</span>
                  )}
                  {order.received === false && order.receivedState === "Declined" && (
                    <span className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-300">✗ {t("Reception DECLINED")}</span>
                  )}
                  {order.received === false && order.receivedState !== "Declined" && (
                    <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">✗ {t("NOT received")}</span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-800/70">
                {order.materials.map((line) => (
                  <div key={line.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white">
                        {line.productionItemName || line.itemName || `Item #${line.id}`}
                        {line.itemSku && <span className="ml-2 font-mono text-[10px] text-slate-500">{line.itemSku}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {line.productionItemName && <span className="font-bold text-slate-300">Stock: {line.itemName} · </span>}
                        {line.itemCategory || "Material"}
                        {line.stockQuantity != null && ` · ${line.stockQuantity} ${line.itemUnit || ""} in stock`}
                        {line.productionRecipeName && <span className="ml-1 text-amber-400">· Route: {line.productionRecipeName}</span>}
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="font-mono text-sm font-black text-amber-300">
                        {line.quantityUsed}
                        <span className="ml-1 text-[10px] font-bold text-slate-500">{line.itemUnit || "pcs"}</span>
                      </div>
                      {(() => {
                        const sent = sentQty(line);
                        if (line.status === "Requested" || line.quantityUsed <= 1 || sent <= 0 || sent >= line.quantityUsed) return null;
                        return (
                          <div className="mt-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-black text-sky-300" title="Units already sent to the floor">
                            {sent}/{line.quantityUsed} sent
                          </div>
                        );
                      })()}
                    </div>

                    {line.productionItemName ? (
                      <span
                        className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] font-bold text-sky-200"
                        title="This destination follows the material job's first production pass"
                      >
                        {line.machineId != null
                          ? `→ ${order.machines.find((m) => m.id === line.machineId)?.code || `Machine #${line.machineId}`}`
                          : "First station: assign later"}
                      </span>
                    ) : isManager ? (
                      order.machines.length > 0 && (
                        <select
                          value={line.machineId ?? ""}
                          disabled={busyId === line.id}
                          onChange={(e) =>
                            setStatus(line, line.status, e.target.value ? Number(e.target.value) : null)
                          }
                          className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-white disabled:opacity-50"
                          title="Re-route this material (Manager only)"
                        >
                          <option value="">— machine —</option>
                          {order.machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} — {m.name}
                            </option>
                          ))}
                        </select>
                      )
                    ) : line.machineId != null ? (
                      <span
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-bold text-slate-300"
                        title="Assigned by the routing sequence — only a Manager can change this"
                      >
                        → {order.machines.find((m) => m.id === line.machineId)?.code || `Machine #${line.machineId}`}
                      </span>
                    ) : null}

                    <span className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[line.status]}`}>
                      {t(line.status)}
                    </span>

                    <LineActions
                      line={line}
                      canUpdate={canUpdate}
                      busy={busyId === line.id}
                      onStatus={(row, status) => void setStatus(row, status)}
                      onPartial={sendPartial}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
