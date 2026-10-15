"use client";

// Manager-only "Reset all orders" panel (System Settings → Reset orders).
// Shows a preview from GET /api/orders/reset, asks the two questions the
// reset needs (invoices, inventory records), and requires the typed phrase
// before POST /api/orders/reset runs. Stock quantities are never changed.

import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

type Preview = {
  orderCount: number;
  operationCount: number;
  allocationCount: number;
  consumptionCount: number;
  customerCount: number;
  invoices: { id: number; number: string; kind: string; status: string; customerName: string; totalCents: number }[];
  confirmText: string;
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OrderResetPanel({ onOrdersChanged }: { onOrdersChanged?: () => void | Promise<void> }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [deleteInvoices, setDeleteInvoices] = useState(false);
  const [deleteInventory, setDeleteInventory] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/orders/reset", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || "Could not load the reset preview.");
        return;
      }
      setPreview(data as Preview);
    } catch {
      setLoadError("Could not reach the server to load the reset preview.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const confirmText = preview?.confirmText ?? "DELETE ALL ORDERS";
  const canRun = !busy && !!preview && typed.trim() === confirmText;

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orders/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: typed.trim(), deleteInvoices, deleteInventoryRecords: deleteInventory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error || "The reset failed. Nothing was changed." });
        return;
      }
      setTyped("");
      setMessage({
        kind: "ok",
        text:
          `Done: ${data.deletedOrders} order(s), ${data.deletedOperations} step(s), ${data.deletedAllocations} allocation(s), ` +
          `${data.deletedConsumptions} consumption record(s) removed; ${data.deletedInvoices} invoice(s) deleted, ${data.keptInvoices} kept. ` +
          "Stock quantities were not changed.",
      });
      await load();
      // The Orders & Routing screens keep the order list in the page's state.
      // Reload it now, or the deleted orders stay on screen until a page reload.
      await onOrdersChanged?.();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was confirmed as changed; check the order list before trying again." });
    } finally {
      setBusy(false);
    }
  };

  const inventoryNeedsChoice = !!preview && (preview.allocationCount > 0 || preview.consumptionCount > 0);

  return (
    <div className="bg-slate-900/90 border border-rose-500/30 rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-sm font-black text-white">
        <AlertTriangle className="h-4 w-4 text-rose-400" /> Reset all orders
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Deletes every order, whatever its status, with its steps, material allocations and consumption history.
        It does not touch customers, stock quantities, users, machines or settings. There is no undo.
      </p>

      {loadError && <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{loadError}</div>}

      {!preview && !loadError && (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading preview…</div>
      )}

      {preview && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
            <div className="font-bold text-white">Will be deleted</div>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              <li>{preview.orderCount} order(s)</li>
              <li>{preview.operationCount} workflow step(s)</li>
              <li>{preview.allocationCount} material allocation(s) and {preview.consumptionCount} consumption record(s)</li>
            </ul>
          </div>

          <fieldset className="rounded-lg border border-slate-800 p-3">
            <legend className="px-1 text-xs font-black text-white">Invoices of these clients</legend>
            <p className="text-[11px] text-slate-400">
              Invoices are not linked to orders in this system. The clients of these orders are {preview.customerCount}.
              {" "}{preview.invoices.length} invoice(s) or quote(s) belong to them.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-200">
              <input type="radio" name="reset-invoices" checked={!deleteInvoices} onChange={() => setDeleteInvoices(false)} />
              Keep all invoices (recommended)
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-200">
              <input type="radio" name="reset-invoices" checked={deleteInvoices} disabled={preview.invoices.length === 0} onChange={() => setDeleteInvoices(true)} />
              Delete those {preview.invoices.length} invoice(s) with their lines and payments
            </label>
            {deleteInvoices && preview.invoices.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto rounded border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-200">
                {preview.invoices.map((inv) => (
                  <div key={inv.id}>{inv.number} · {inv.customerName} · {inv.status} · {money(inv.totalCents)}</div>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="rounded-lg border border-slate-800 p-3">
            <legend className="px-1 text-xs font-black text-white">Inventory records of these orders</legend>
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input type="radio" name="reset-inventory" checked={deleteInventory} onChange={() => setDeleteInventory(true)} />
              Delete allocations and consumption history (stock quantities stay as they are)
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-200">
              <input type="radio" name="reset-inventory" checked={!deleteInventory} onChange={() => setDeleteInventory(false)} />
              Keep them
            </label>
            {!deleteInventory && inventoryNeedsChoice && (
              <p className="mt-2 text-[11px] text-amber-300">
                Keeping them is not possible while records exist: the database removes them with their order. The reset will refuse.
              </p>
            )}
          </fieldset>

          <div>
            <label className="block text-xs font-bold text-slate-300">
              Type <span className="font-mono text-rose-300">{confirmText}</span> to confirm
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmText}
                className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white placeholder-slate-600"
              />
              <button
                type="button"
                onClick={() => void run()}
                disabled={!canRun}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-black text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Resetting…" : "Reset all orders"}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${message.kind === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
