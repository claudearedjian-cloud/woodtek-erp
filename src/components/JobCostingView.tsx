"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowDown, ArrowUp, Download, PieChart, RefreshCw, Search, Settings2, TrendingDown, TrendingUp, X,
} from "lucide-react";
import {
  FLAG_LABELS, centsToMoney, jobCostCsv, marginText,
  type JobCost, type JobCostGroup, type JobCostRange, type JobCostScope, type JobCostSettings, type JobCostTotals, type JobFlag,
} from "@/lib/jobCosting";

type BoardRow = Omit<JobCost, "materialLines" | "operationLines">;
type Board = {
  generatedAt: string;
  range: JobCostRange;
  scope: JobCostScope;
  settings: JobCostSettings;
  totals: JobCostTotals;
  byClient: JobCostGroup[];
  byProjectType: JobCostGroup[];
  orders: BoardRow[];
};

const RANGES: Array<{ id: JobCostRange; label: string }> = [
  { id: "all", label: "All time" },
  { id: "ytd", label: "This year" },
  { id: "days90", label: "Last 90 days" },
  { id: "month", label: "This month" },
];
const SCOPES: Array<{ id: JobCostScope; label: string }> = [
  { id: "all", label: "All orders" },
  { id: "final", label: "Finished" },
  { id: "open", label: "In progress" },
];

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

function marginTone(bps: number | null): string {
  if (bps == null) return "text-slate-500";
  if (bps < 0) return "text-rose-400";
  if (bps < 1000) return "text-amber-400";
  return "text-emerald-400";
}

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="my-auto max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, tone = "text-white", hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-black ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function FlagDots({ flags }: { flags: JobFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="inline-flex gap-1" title={flags.map((f) => FLAG_LABELS[f]).join("\n")}>
      {flags.map((f) => (
        <span key={f} className={`h-2 w-2 rounded-full ${f === "loss" ? "bg-rose-500" : f === "low-margin" || f === "time-overrun" ? "bg-amber-400" : "bg-slate-500"}`} />
      ))}
    </span>
  );
}

function CostBar({ row }: { row: Pick<JobCost, "materialsCents" | "machineCents" | "laborCents" | "overheadCents" | "revenueCents" | "costCents"> }) {
  const base = Math.max(row.revenueCents, row.costCents, 1);
  const parts = [
    { key: "Materials", cents: row.materialsCents, cls: "bg-amber-500" },
    { key: "Machine time", cents: row.machineCents, cls: "bg-sky-500" },
    { key: "Operator labor", cents: row.laborCents, cls: "bg-violet-500" },
    { key: "Overhead", cents: row.overheadCents, cls: "bg-slate-500" },
  ];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: `${(p.cents / base) * 100}%` }} title={`${p.key}: ${money(p.cents)}`} />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">Bar is scaled to the larger of revenue and cost.</div>
    </div>
  );
}

type SortKey = "profit" | "margin" | "revenue" | "order";
type SortState = { key: SortKey; dir: 1 | -1 };

function SortHead({ k, children, right, sort, onSort }: { k: SortKey; children: ReactNode; right?: boolean; sort: SortState; onSort: (k: SortKey) => void }) {
  return (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-black uppercase tracking-wider hover:text-white">
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

export default function JobCostingView({ canEditRates = false }: { canEditRates?: boolean }) {
  const [range, setRange] = useState<JobCostRange>("all");
  const [scope, setScope] = useState<JobCostScope>("all");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders" | "clients" | "types">("orders");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "profit", dir: 1 });
  const [detail, setDetail] = useState<JobCost | null>(null);
  const [detailBusy, setDetailBusy] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getJson(`/api/job-costing?range=${range}&scope=${scope}`)
      .then((data) => { if (!cancelled) { setBoard(data); setError(""); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load job costing."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, scope, reloadKey]);

  const refresh = () => { setLoading(true); setReloadKey((n) => n + 1); };
  const pickRange = (next: JobCostRange) => { if (next !== range) { setLoading(true); setRange(next); } };
  const pickScope = (next: JobCostScope) => { if (next !== scope) { setLoading(true); setScope(next); } };

  const openDetail = async (orderId: number) => {
    setDetailBusy(orderId);
    try {
      setDetail(await getJson(`/api/job-costing/${orderId}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the order.");
    } finally {
      setDetailBusy(null);
    }
  };

  const rows = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    const filtered = board.orders.filter((o) =>
      !q || `${o.orderNumber} ${o.title} ${o.customer} ${o.projectType}`.toLowerCase().includes(q));
    const value = (o: BoardRow) =>
      sort.key === "profit" ? o.profitCents
        : sort.key === "margin" ? (o.marginBps ?? Number.POSITIVE_INFINITY)
          : sort.key === "revenue" ? o.revenueCents : 0;
    return [...filtered].sort((a, b) =>
      sort.key === "order" ? sort.dir * a.orderNumber.localeCompare(b.orderNumber) : sort.dir * (value(a) - value(b)));
  }, [board, search, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const downloadCsv = () => {
    if (!board) return;
    const full = rows.map((r) => ({ ...r, materialLines: [], operationLines: [] }) as JobCost);
    const blob = new Blob(["\uFEFF" + jobCostCsv(full)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-costing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = board?.totals;
  const laborUnset = board != null && board.settings.laborRateCentsPerHour === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black tracking-tight text-white">
            <PieChart className="h-5 w-5 text-amber-400" /> Job Costing &amp; Profit
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Order value minus materials, machine time, operator labor and overhead — which jobs and clients really make money.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
            {RANGES.map((r) => (
              <button key={r.id} type="button" onClick={() => pickRange(r.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${range === r.id ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"}`}>{r.label}</button>
            ))}
          </div>
          <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" onClick={() => pickScope(s.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${scope === s.id ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"}`}>{s.label}</button>
            ))}
          </div>
          <button type="button" onClick={refresh} title="Refresh" className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:text-white">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={downloadCsv} disabled={!board || rows.length === 0} title="Download the rows shown as CSV"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40">
            <Download className="h-4 w-4" /> CSV
          </button>
          {canEditRates && (
            <button type="button" onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white">
              <Settings2 className="h-4 w-4" /> Rates
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-xs font-bold text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {laborUnset && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The operator labor rate is not set, so people&apos;s time is counted as $0 and margins look better than they are.
            {canEditRates ? " Click Rates to set it." : " Ask a Manager to set it."} Machine time is already costed from each machine&apos;s hourly rate.
          </span>
        </div>
      )}

      {!board && !error ? (
        <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/30" />
      ) : board && t ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Order value" value={money(t.revenueCents)} hint={`${t.orders} order${t.orders === 1 ? "" : "s"}`} />
            <Stat label="Total cost" value={money(t.costCents)} hint={`Materials ${money(t.materialsCents)}`} />
            <Stat label="Profit" value={money(t.profitCents)} tone={t.profitCents < 0 ? "text-rose-400" : "text-emerald-400"} />
            <Stat label="Margin" value={marginText(t.marginBps)} tone={marginTone(t.marginBps)} />
            <Stat label="Losing money" value={String(t.lossMaking)} tone={t.lossMaking > 0 ? "text-rose-400" : "text-emerald-400"} hint="orders below cost" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
              {([["orders", "Orders"], ["clients", "By client"], ["types", "By project type"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setTab(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === id ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"}`}>{label}</button>
              ))}
            </div>
            {tab === "orders" && (
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, client, type…"
                  className="w-64 rounded-xl border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none" />
              </label>
            )}
          </div>

          {tab === "orders" ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-800 text-[10px] text-slate-500">
                  <tr>
                    <SortHead k="order" sort={sort} onSort={toggleSort}>Order</SortHead>
                    <th className="px-3 py-2 text-left font-black uppercase tracking-wider">Client</th>
                    <SortHead k="revenue" right sort={sort} onSort={toggleSort}>Value</SortHead>
                    <th className="px-3 py-2 text-right font-black uppercase tracking-wider">Materials</th>
                    <th className="px-3 py-2 text-right font-black uppercase tracking-wider">Machine</th>
                    <th className="px-3 py-2 text-right font-black uppercase tracking-wider">Labor</th>
                    <th className="px-3 py-2 text-right font-black uppercase tracking-wider">Cost</th>
                    <SortHead k="profit" right sort={sort} onSort={toggleSort}>Profit</SortHead>
                    <SortHead k="margin" right sort={sort} onSort={toggleSort}>Margin</SortHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">No orders match this period and filter.</td></tr>
                  )}
                  {rows.map((o) => (
                    <tr key={o.orderId} onClick={() => void openDetail(o.orderId)}
                      className={`cursor-pointer hover:bg-slate-800/40 ${detailBusy === o.orderId ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-400">{o.orderNumber}</span>
                          <FlagDots flags={o.flags} />
                        </div>
                        <div className="max-w-[240px] truncate text-slate-400">{o.title}</div>
                        <div className="text-[10px] text-slate-600">{o.status} · {o.basis}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{o.customer}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200">{money(o.revenueCents)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400">{money(o.materialsCents)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400">{money(o.machineCents)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400">{money(o.laborCents + o.overheadCents)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200">{money(o.costCents)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${o.profitCents < 0 ? "text-rose-400" : "text-emerald-400"}`}>{money(o.profitCents)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${marginTone(o.marginBps)}`}>{marginText(o.marginBps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-800 px-3 py-2 text-[10px] text-slate-500">
                Labor column includes overhead. Click an order for the full cost sheet. Coloured dots: red = losing money, amber = thin margin or time overrun, grey = data to check.
              </div>
            </div>
          ) : (
            <GroupTable groups={tab === "clients" ? board.byClient : board.byProjectType} noun={tab === "clients" ? "Client" : "Project type"} />
          )}
        </>
      ) : null}

      {detail && <DetailModal job={detail} onClose={() => setDetail(null)} />}
      {showSettings && board && (
        <SettingsModal
          settings={board.settings}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); refresh(); }}
        />
      )}
    </div>
  );
}

function GroupTable({ groups, noun }: { groups: JobCostGroup[]; noun: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
      <table className="w-full text-xs">
        <thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-black">{noun}</th>
            <th className="px-3 py-2 text-right font-black">Orders</th>
            <th className="px-3 py-2 text-right font-black">Value</th>
            <th className="px-3 py-2 text-right font-black">Cost</th>
            <th className="px-3 py-2 text-right font-black">Profit</th>
            <th className="px-3 py-2 text-right font-black">Margin</th>
            <th className="px-3 py-2 text-right font-black">Losing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {groups.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">Nothing to show for this period.</td></tr>}
          {groups.map((g) => (
            <tr key={g.key}>
              <td className="px-3 py-2.5 font-bold text-slate-200">{g.label}</td>
              <td className="px-3 py-2.5 text-right font-mono text-slate-400">{g.orders}</td>
              <td className="px-3 py-2.5 text-right font-mono text-slate-200">{money(g.revenueCents)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-slate-400">{money(g.costCents)}</td>
              <td className={`px-3 py-2.5 text-right font-mono font-bold ${g.profitCents < 0 ? "text-rose-400" : "text-emerald-400"}`}>{money(g.profitCents)}</td>
              <td className={`px-3 py-2.5 text-right font-mono font-bold ${marginTone(g.marginBps)}`}>{marginText(g.marginBps)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-slate-400">{g.lossMaking > 0 ? <span className="text-rose-400">{g.lossMaking}</span> : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-800 px-3 py-2 text-[10px] text-slate-500">Ranked by profit, biggest first. Margin = profit ÷ order value.</div>
    </div>
  );
}

function DetailModal({ job, onClose }: { job: JobCost; onClose: () => void }) {
  const Trend = job.profitCents < 0 ? TrendingDown : TrendingUp;
  return (
    <Modal title={`${job.orderNumber} — ${job.title}`} onClose={onClose}>
      <div className="space-y-5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
          <span>{job.customer}</span><span>{job.projectType}</span><span>{job.status}</span>
          <span className={`rounded-md px-2 py-0.5 font-black ${job.basis === "Final" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>
            {job.basis === "Final" ? "Final margin (actual time)" : "Projected margin (plan for unfinished steps)"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Order value" value={money(job.revenueCents)} />
          <Stat label="Total cost" value={money(job.costCents)} />
          <Stat label="Profit" value={money(job.profitCents)} tone={job.profitCents < 0 ? "text-rose-400" : "text-emerald-400"} />
          <Stat label="Margin" value={marginText(job.marginBps)} tone={marginTone(job.marginBps)} />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="mb-3 flex items-center gap-2 font-black uppercase tracking-wider text-slate-300"><Trend className="h-4 w-4" /> Cost build-up</div>
          <div className="mb-3 space-y-1.5 font-mono">
            {([
              ["Materials", job.materialsCents, `consumed ${money(job.materialsConsumedCents)} · reserved ${money(job.materialsReservedCents)}`],
              ["Machine time", job.machineCents, ""],
              ["Operator labor", job.laborCents, ""],
              ["Overhead", job.overheadCents, ""],
            ] as const).map(([label, cents, hint]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="font-sans text-slate-300">{label} {hint && <span className="text-[10px] text-slate-500">({hint})</span>}</span>
                <span className="text-slate-100">{money(cents)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t border-slate-800 pt-1.5 font-black">
              <span className="font-sans text-white">Total cost</span><span className="text-white">{money(job.costCents)}</span>
            </div>
          </div>
          <CostBar row={job} />
        </div>

        {job.flags.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-amber-200">
            {job.flags.map((f) => <li key={f}>• {FLAG_LABELS[f]}</li>)}
          </ul>
        )}

        <div>
          <div className="mb-2 font-black uppercase tracking-wider text-slate-300">Materials</div>
          {job.materialLines.length === 0 ? <p className="text-slate-500">No materials are allocated to this order.</p> : (
            <table className="w-full">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-1 text-left">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit cost</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">State</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {job.materialLines.map((m) => (
                  <tr key={m.id}>
                    <td className="py-1.5"><span className="font-mono text-slate-400">{m.itemSku}</span> <span className="text-slate-200">{m.itemName}</span></td>
                    <td className="py-1.5 text-right font-mono text-slate-300">{m.quantity} {m.unit}</td>
                    <td className="py-1.5 text-right font-mono text-slate-400">{money(m.unitCostCents)}</td>
                    <td className="py-1.5 text-right font-mono text-slate-100">{money(m.totalCents)}</td>
                    <td className={`py-1.5 text-right font-bold ${m.state === "consumed" ? "text-emerald-400" : "text-amber-400"}`}>{m.state === "consumed" ? "Consumed" : "Reserved"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between font-black uppercase tracking-wider text-slate-300">
            <span>Operations</span>
            <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">
              plan {hours(job.estimatedMinutes)} · actual {hours(job.actualMinutes)}
            </span>
          </div>
          {job.operationLines.length === 0 ? <p className="text-slate-500">No routed operations on this order.</p> : (
            <table className="w-full">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-1 text-left">Step</th><th className="py-1 text-left">Machine</th>
                  <th className="py-1 text-right">Plan</th><th className="py-1 text-right">Actual</th>
                  <th className="py-1 text-right">Rate/h</th><th className="py-1 text-right">Machine $</th><th className="py-1 text-right">Labor $</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {job.operationLines.map((op) => {
                  const final = job.basis === "Final";
                  return (
                    <tr key={op.id}>
                      <td className="py-1.5"><span className="text-slate-500">#{op.stepOrder}</span> <span className="text-slate-200">{op.operationName}</span>
                        <div className="text-[10px] text-slate-600">{op.status}{op.basis === "planned" ? " · no time recorded, plan used" : op.basis === "elapsed" ? " · running now" : ""}</div></td>
                      <td className="py-1.5 font-mono text-slate-400">{op.machineCode ?? "—"}</td>
                      <td className="py-1.5 text-right font-mono text-slate-400">{hours(op.estimatedMinutes)}</td>
                      <td className={`py-1.5 text-right font-mono ${op.actualMinutes > op.estimatedMinutes * 1.15 && op.estimatedMinutes > 0 ? "text-amber-400" : "text-slate-200"}`}>{hours(final ? op.actualMinutes : op.projectedMinutes)}</td>
                      <td className="py-1.5 text-right font-mono text-slate-500">{op.machineRateCentsPerHour > 0 ? money(op.machineRateCentsPerHour) : "—"}</td>
                      <td className="py-1.5 text-right font-mono text-slate-200">{money(final ? op.machineActualCents : op.machineProjectedCents)}</td>
                      <td className="py-1.5 text-right font-mono text-slate-200">{money(final ? op.laborActualCents : op.laborProjectedCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {job.basis === "Projected" && <p className="mt-1 text-[10px] text-slate-500">Unfinished steps are shown at plan (or at their overrun) until they are done.</p>}
        </div>

        {(job.scrapCents > 0 || job.reworkCents > 0) && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-300">
            <span className="font-black uppercase tracking-wider">Quality losses (memo): </span>
            scrap {money(job.scrapCents)} · rework {money(job.reworkCents)}.
            <span className="text-slate-500"> Not added again — replacement material is normally already in the materials above.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSaved }: { settings: JobCostSettings; onClose: () => void; onSaved: () => void }) {
  const [labor, setLabor] = useState(settings.laborRateCentsPerHour ? centsToMoney(settings.laborRateCentsPerHour) : "");
  const [overhead, setOverhead] = useState(settings.overheadBps ? (settings.overheadBps / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/job-costing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laborRate: labor, overheadPercent: overhead }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      onSaved();
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Costing rates" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-xs">
        <p className="text-slate-400">
          Machine time is costed from each machine&apos;s hourly rate (Shop Floor Monitor). These two settings cover the rest.
          Changing them re-prices <b>every</b> order on the next refresh — historic and open alike — because costs are calculated, not stored.
        </p>
        <label className="block">
          <span className="mb-1 block font-black uppercase tracking-wider text-slate-300">Operator labor — $ per hour</span>
          <input value={labor} onChange={(e) => setLabor(e.target.value)} inputMode="decimal" placeholder="0.00 = not counted"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
          <span className="mt-1 block text-slate-500">Average loaded cost of the person running a step. One operator per step is assumed.</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-black uppercase tracking-wider text-slate-300">Overhead — % of direct cost</span>
          <input value={overhead} onChange={(e) => setOverhead(e.target.value)} inputMode="decimal" placeholder="0 = not counted"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
          <span className="mt-1 block text-slate-500">Rent, power, admin… added on top of materials + machine + labor. Leave blank to judge on direct cost only.</span>
        </label>
        {err && <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 font-bold text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 font-bold text-slate-300 hover:text-white">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">{busy ? "Saving…" : "Save rates"}</button>
        </div>
      </form>
    </Modal>
  );
}
