"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Cpu,
  Clock,
  ClipboardList,
  MapPin,
  PieChart,
  BarChart3,
  Server,
  Search,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Trash2,
  Edit,
  RefreshCw,
  Gauge,
  History,
  DollarSign,
  LayoutDashboard,
  Zap,
  FileDown,
  SlidersHorizontal,
} from "lucide-react";
import PowerGeneratorsView from "@/components/cmms/PowerGeneratorsView";
import CmmsReportsView from "@/components/cmms/CmmsReportsView";
import CmmsSettingsView from "@/components/cmms/CmmsSettingsView";
import AssetDetailView from "@/components/cmms/AssetDetailView";

interface CmmsViewProps {
  currentUser: any;
  machines: any[];
  searchQuery?: string;
}

const ASSET_TYPES = ["Generators", "CNC Routers", "Edge Banders", "Panel Saws", "Compressors", "Dust Extraction", "HVAC", "Spray & Finish"];
const BRANDS = ["Perkins / Leroy Somer", "Cummins", "Caterpillar", "Biesse", "Homag", "Holz-Her", "Altendorf", "Brandt", "Generic"];
const FALLBACK_EVENT_TYPES = ["Inspection", "Preventive Service", "Repair", "Breakdown", "Part Replacement", "Meter Reading"];

const DONUT_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6", "#ef4444", "#64748b", "#8b5cf6"];

const SUB_TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "power", label: "Power & Generators", icon: Zap },
  { id: "reports", label: "Reports", icon: FileDown },
  { id: "settings", label: "App Settings", icon: SlidersHorizontal },
] as const;

type SubTab = (typeof SUB_TABS)[number]["id"];

export default function CmmsView({ currentUser, machines = [], searchQuery = "" }: CmmsViewProps) {
  const [subTab, setSubTab] = useState<SubTab>("dashboard");
  const [data, setData] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [localSearch, setLocalSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");

  const [assetModal, setAssetModal] = useState<"closed" | "create" | "edit">("closed");
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [logAsset, setLogAsset] = useState<any>(null);
  const [logForm, setLogForm] = useState<any>({});
  const [assetHistory, setAssetHistory] = useState<any[]>([]);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);

  const canManage = ["Manager", "Technician", "QA & Dispatch"].includes(currentUser?.role);

  const sites: string[] = settings?.site_locations ?? ["Main Plant Bay A"];
  const eventTypes: string[] = useMemo(() => {
    const configured: string[] = settings?.operation_categories ?? [];
    return Array.from(new Set([...FALLBACK_EVENT_TYPES, ...configured]));
  }, [settings]);
  const defaultInterval = settings?.service_interval_hours ?? 500;

  const emptyAsset = useCallback(
    () => ({
      id: 0,
      assetTag: "",
      name: "",
      brand: BRANDS[0],
      assetType: ASSET_TYPES[0],
      site: sites[0] ?? "Main Plant Bay A",
      machineId: "",
      runtimeHours: "0",
      serviceIntervalHours: String(defaultInterval),
      lastServiceHours: "0",
      status: "Operational",
      criticality: "Medium",
      serialNumber: "",
      notes: "",
      ratingKva: "0",
      powerStatus: "Standby",
      series: "",
      productionYear: String(new Date().getFullYear()),
    }),
    [sites, defaultInterval],
  );

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [cmmsRes, setRes] = await Promise.all([
        fetch("/api/cmms", { cache: "no-store" }),
        fetch("/api/cmms/settings", { cache: "no-store" }),
      ]);
      if (!cmmsRes.ok) throw new Error(`Server returned status ${cmmsRes.status}.`);
      const ct = cmmsRes.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Invalid response from server.");
      setData(await cmmsRes.json());
      if (setRes.ok) setSettings(await setRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load CMMS data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(() => fetchAll(true), 30000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const openCreate = () => {
    setForm(emptyAsset());
    setAssetModal("create");
    setError("");
  };

  const openEdit = (a: any) => {
    setForm({
      id: a.id,
      assetTag: a.assetTag,
      name: a.name,
      brand: a.brand,
      assetType: a.assetType,
      site: a.site,
      machineId: a.machineId ? String(a.machineId) : "",
      runtimeHours: String(a.runtimeHours),
      serviceIntervalHours: String(a.serviceIntervalHours),
      lastServiceHours: String(a.lastServiceHours),
      status: a.status,
      criticality: a.criticality,
      serialNumber: a.serialNumber || "",
      notes: a.notes || "",
      ratingKva: String(a.ratingKva ?? 0),
      powerStatus: a.powerStatus ?? "Standby",
      series: a.series || "",
      productionYear: String(a.productionYear ?? (a.installedAt ? new Date(a.installedAt).getFullYear() : new Date().getFullYear())),
      imageUrl: a.imageUrl ?? null,
    });
    setAssetModal("edit");
    setError("");
  };

  const saveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cmms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetModal === "edit" ? form : { ...form, id: undefined }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save asset");
      setAssetModal("closed");
      flash(assetModal === "edit" ? "Asset updated." : "Asset registered into the fleet.");
      await fetchAll(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save asset");
    } finally {
      setSaving(false);
    }
  };

  const deleteAsset = async (a: any) => {
    if (!confirm(`Remove ${a.assetTag} — ${a.name}? Its maintenance history will also be deleted.`)) return;
    try {
      const res = await fetch(`/api/cmms?assetId=${a.id}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to delete");
      flash("Asset removed from registry.");
      await fetchAll(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete asset");
    }
  };

  const openLog = async (a: any) => {
    setLogAsset(a);
    setLogForm({
      eventType: eventTypes[0] ?? "Inspection",
      description: "",
      runtimeAtEvent: String(a.runtimeHours),
      downtimeMinutes: "0",
      partsCost: "0.00",
      laborCost: "0.00",
      resetService: false,
    });
    setError("");
    try {
      const res = await fetch(`/api/cmms?assetId=${a.id}`, { cache: "no-store" });
      if (res.ok) {
        const detail = await res.json();
        setAssetHistory(detail.logs || []);
      }
    } catch {
      setAssetHistory([]);
    }
  };

  const submitLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logAsset) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cmms/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: logAsset.id, ...logForm, performedById: currentUser?.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to record event");
      setLogAsset(null);
      flash(logForm.resetService ? "Service completed — maintenance meter reset." : "Maintenance event recorded.");
      await fetchAll(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record event");
    } finally {
      setSaving(false);
    }
  };

  const kpis = data?.kpis ?? {};
  const allAssets: any[] = data?.assets ?? [];
  const brandShare: any[] = data?.brandShare ?? [];
  const siteAllocation: any[] = data?.siteAllocation ?? [];

  const effectiveSearch = (localSearch || searchQuery || "").trim().toLowerCase();

  const filteredAssets = useMemo(
    () =>
      allAssets.filter((a) => {
        const matchesType = typeFilter === "All Types" || a.assetType === typeFilter;
        const matchesSearch =
          !effectiveSearch ||
          [a.assetTag, a.name, a.brand, a.site, a.assetType]
            .filter(Boolean)
            .some((v: string) => String(v).toLowerCase().includes(effectiveSearch));
        return matchesType && matchesSearch;
      }),
    [allAssets, typeFilter, effectiveSearch],
  );

  const maxSiteCount = Math.max(...siteAllocation.map((s) => s.count), 1);
  const totalBrandCount = brandShare.reduce((s, b) => s + b.count, 0) || 1;

  const donutSegments = useMemo(() => {
    let cumulative = 0;
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    return brandShare.map((b, i) => {
      const fraction = b.count / totalBrandCount;
      const seg = {
        brand: b.brand,
        count: b.count,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
        dashArray: `${fraction * circumference} ${circumference}`,
        dashOffset: -cumulative * circumference,
        percent: Math.round(fraction * 100),
      };
      cumulative += fraction;
      return seg;
    });
  }, [brandShare, totalBrandCount]);

  const stateBadge = (state: string) => {
    if (state === "Service Overdue") return "bg-rose-500 text-white";
    if (state === "Service Due") return "bg-amber-500 text-slate-950";
    if (state === "Under Maintenance") return "bg-blue-500 text-white";
    if (state === "Decommissioned") return "bg-slate-700 text-slate-300";
    return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
  };

  const meterColor = (a: any) => (a.isOverdue ? "bg-rose-500" : a.isDue ? "bg-amber-500" : "bg-emerald-500");

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      {/* Module header + sub navigation */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 shadow-sm print:hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-900/40">
              <Activity className="h-6 w-6 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Plant Asset Analytics &amp; CMMS</h1>
              <p className="text-xs font-semibold text-slate-400">Maintenance Management • Diagnostic Suite</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAll(true)}
              title="Refresh"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
            </button>
            {canManage && (
              <button
                onClick={openCreate}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4 stroke-[2.5]" /> Register Asset
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-slate-800 px-4 py-3">
          {SUB_TABS.map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  active
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {(error || notice) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}
        >
          <span className="flex items-center gap-2">
            {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {error || notice}
          </span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ---------------- POWER & GENERATORS ---------------- */}
      {subTab === "power" && <PowerGeneratorsView currentUser={currentUser} onChanged={() => fetchAll(true)} />}

      {/* ---------------- REPORTS ---------------- */}
      {subTab === "reports" && <CmmsReportsView assets={allAssets} locations={sites} currentUser={currentUser} />}

      {/* ---------------- APP SETTINGS ---------------- */}
      {subTab === "settings" && (
        <CmmsSettingsView settings={settings} onSettingsChanged={setSettings} currentUser={currentUser} />
      )}

      {/* ---------------- ASSET DETAIL WORKSPACE ---------------- */}
      {subTab === "dashboard" && detailAssetId !== null && (
        <AssetDetailView
          assetId={detailAssetId}
          currentUser={currentUser}
          eventTypes={eventTypes}
          onBack={() => setDetailAssetId(null)}
          onChanged={() => fetchAll(true)}
          onEdit={(a) => openEdit(a)}
        />
      )}

      {/* ---------------- DASHBOARD ---------------- */}
      {subTab === "dashboard" && detailAssetId === null && (
        loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />)}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
              <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
            </div>
          </div>
        ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Active Fleet Assets" value={String(kpis.activeFleetAssets ?? 0)} caption="Operational" captionColor="text-emerald-400" icon={Cpu} />
            <KpiTile label="Total Run Time" value={`${Number(kpis.totalRuntimeHours ?? 0).toLocaleString()} hrs`} caption="Cumulative" captionColor="text-amber-400" icon={Clock} />
            <KpiTile label="Events Logged" value={String(kpis.eventsLogged ?? 0)} caption="Recorded" captionColor="text-blue-400" icon={ClipboardList} />
            <KpiTile label="Configured Sites" value={`${kpis.configuredSites ?? 0} Sites`} caption="Active Locations" captionColor="text-emerald-400" icon={MapPin} />
          </div>

          {/* Service alert strip */}
          {(kpis.overdueCount > 0 || kpis.dueSoonCount > 0) && (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/20 p-2.5 text-rose-400">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-extrabold text-white">Preventive maintenance attention required</div>
                  <p className="text-xs text-slate-300">
                    <strong className="text-rose-300">{kpis.overdueCount} overdue</strong> and{" "}
                    <strong className="text-amber-300">{kpis.dueSoonCount} approaching</strong> their service interval.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 text-center">
                <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Downtime</div>
                  <div className="font-mono text-sm font-black text-white">{Math.round((kpis.totalDowntimeMinutes ?? 0) / 60)}h</div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Maint. cost</div>
                  <div className="font-mono text-sm font-black text-emerald-400">${Number(kpis.totalMaintenanceCost ?? 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white">
                  <PieChart className="h-4 w-4 text-emerald-400" /> Brand Inventory Share
                </h3>
                <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-400">Live Mix</span>
              </div>
              {brandShare.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">No assets registered yet.</div>
              ) : (
                <>
                  <div className="flex justify-center py-2">
                    <svg viewBox="0 0 160 160" className="h-52 w-52 -rotate-90">
                      {donutSegments.map((s) => (
                        <circle key={s.brand} cx="80" cy="80" r="60" fill="none" stroke={s.color} strokeWidth="28" strokeDasharray={s.dashArray} strokeDashoffset={s.dashOffset}>
                          <title>{`${s.brand}: ${s.count} (${s.percent}%)`}</title>
                        </circle>
                      ))}
                      <circle cx="80" cy="80" r="42" fill="#0f172a" />
                    </svg>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                    {donutSegments.map((s) => (
                      <span key={s.brand} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                        <span className="h-3 w-5 rounded-sm" style={{ backgroundColor: s.color }} />
                        <span className="font-semibold">{s.brand}</span>
                        <span className="font-mono text-slate-500">({s.count})</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-white">
                  <BarChart3 className="h-4 w-4 text-blue-400" /> Active Location Allocation
                </h3>
                <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-400">Live Share</span>
              </div>
              {siteAllocation.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">No sites configured yet.</div>
              ) : (
                <div className="flex h-56 items-end gap-3 border-b border-l border-slate-800 px-2 pb-0 pt-2">
                  {siteAllocation.map((s) => (
                    <div key={s.site} className="group flex flex-1 flex-col items-center justify-end gap-2">
                      <span className="font-mono text-[10px] font-black text-emerald-300 opacity-0 transition group-hover:opacity-100">{s.count}</span>
                      <div className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-500" style={{ height: `${Math.max(8, (s.count / maxSiteCount) * 100)}%` }} title={`${s.site}: ${s.count} asset(s)`} />
                      <span className="line-clamp-2 h-8 text-center text-[10px] font-semibold leading-tight text-slate-400">{s.site}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Registry */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-3 border-b border-slate-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-black text-white">
                  <Server className="h-5 w-5 text-emerald-400" /> Plant Asset Registry
                </h3>
                <p className="text-xs text-slate-400">All equipment service due / overdue monitoring</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input type="text" placeholder="Search assets…" value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none sm:w-56" />
                </div>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none">
                  <option>All Types</option>
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {filteredAssets.length === 0 ? (
              <div className="py-16 text-center">
                <Server className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
                <h4 className="text-base font-bold text-white">No assets match</h4>
                <p className="mt-1 text-xs text-slate-400">
                  {allAssets.length === 0 ? "Register your first plant asset to begin tracking maintenance." : "Try clearing the search or type filter."}
                </p>
                {canManage && allAssets.length === 0 && (
                  <button onClick={openCreate} className="mt-4 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400">+ Register Asset</button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredAssets.map((a) => (
                  <div key={a.id} className={`flex flex-col justify-between rounded-2xl border bg-slate-950/60 p-4 transition hover:border-slate-600 ${a.isOverdue ? "border-rose-500/50" : a.isDue ? "border-amber-500/40" : "border-slate-800"}`}>
                    <button type="button" onClick={() => setDetailAssetId(a.id)} className="group text-left">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-wider ${stateBadge(a.serviceState)}`}>{a.serviceState}</span>
                        <span className="text-right text-[11px] font-semibold text-slate-400">{a.site}</span>
                      </div>
                      {a.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt={a.name} className="mb-3 h-24 w-full rounded-lg border border-slate-800 object-cover" />
                      )}
                      <h4 className="text-base font-black leading-tight text-white transition group-hover:text-emerald-300">{a.name}</h4>
                      <p className="mt-0.5 text-xs text-slate-400">{a.brand} • {a.assetType}</p>
                      <p className="mt-1 font-mono text-[10px] font-bold text-emerald-400">{a.assetTag}</p>

                      <div className="mt-4">
                        <div className="mb-1.5 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-400">Maintenance Meter</span>
                          <span className={`font-mono font-bold ${a.isOverdue ? "text-rose-400" : "text-slate-200"}`}>{a.sinceService} / {a.serviceIntervalHours} hrs</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className={`h-full rounded-full transition-all duration-500 ${meterColor(a)}`} style={{ width: `${Math.min(100, a.percentUsed)}%` }} />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          {a.isOverdue ? `Overdue by ${Math.abs(a.hoursRemaining)} hrs` : `${a.hoursRemaining} hrs until next service`}
                        </div>
                      </div>
                    </button>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                        <span className={`h-2 w-2 rounded-full ${a.isOverdue ? "bg-rose-500" : a.isDue ? "bg-amber-500" : "bg-emerald-500"}`} />
                        {Number(a.runtimeHours).toLocaleString()} Total Hrs
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setDetailAssetId(a.id)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700">Inspect &amp; Log</button>
                        {canManage && (
                          <>
                            <button onClick={() => openEdit(a)} title="Edit" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-emerald-400"><Edit className="h-4 w-4" /></button>
                            <button onClick={() => deleteAsset(a)} title="Delete" className="rounded-lg p-1.5 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
        )
      )}

      {/* Register / Edit asset modal */}
      {assetModal !== "closed" && form && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:items-center">
          <form onSubmit={saveAsset} className="my-8 w-full max-w-2xl space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="flex items-center gap-2 text-lg font-black text-white">
                <Server className="h-5 w-5 text-emerald-400" />
                {assetModal === "edit" ? "Edit Plant Asset" : "Register Plant Asset"}
              </h3>
              <button type="button" onClick={() => setAssetModal("closed")} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Asset Tag *</label>
                <input type="text" required placeholder="GEN-200KVA-01" value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs uppercase text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Asset Name *</label>
                <input type="text" required placeholder="200 kVA Power Generator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Brand / Manufacturer</label>
                <select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Asset Type</label>
                <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Site / Location</label>
                <select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                  {!sites.includes(form.site) && <option value={form.site}>{form.site}</option>}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Linked Production Machine</label>
                <select value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  <option value="">Not linked (standalone plant asset)</option>
                  {machines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Current Runtime (hrs)</label>
                <input type="number" min="0" value={form.runtimeHours} onChange={(e) => setForm({ ...form, runtimeHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Service Interval (hrs)</label>
                <input type="number" min="1" value={form.serviceIntervalHours} onChange={(e) => setForm({ ...form, serviceIntervalHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Meter at Last Service</label>
                <input type="number" min="0" value={form.lastServiceHours} onChange={(e) => setForm({ ...form, lastServiceHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Operational Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  <option value="Operational">Operational</option>
                  <option value="Under Maintenance">Under Maintenance</option>
                  <option value="Decommissioned">Decommissioned</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Criticality</label>
                <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Power Rating (kVA)</label>
                <input type="number" min="0" value={form.ratingKva} onChange={(e) => setForm({ ...form, ratingKva: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Serial Number (SN)</label>
                <input type="text" placeholder="PK-200-8841" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Series / Model Line</label>
                <input type="text" placeholder="2000 Series Industrial" value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Production Year</label>
                <input type="number" min="1900" max="2100" placeholder="2021" value={form.productionYear} onChange={(e) => setForm({ ...form, productionYear: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Technical Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Fuel type, coolant spec, filter part numbers…" className="h-20 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white" />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button type="button" onClick={() => setAssetModal("closed")} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                {saving ? "Saving…" : assetModal === "edit" ? "Save Asset" : "Register Asset"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Inspect & Log modal */}
      {logAsset && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:items-center">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-6">
              <div className="min-w-0">
                <div className="mb-1 font-mono text-xs font-black text-emerald-400">{logAsset.assetTag}</div>
                <h3 className="text-lg font-black text-white">{logAsset.name}</h3>
                <p className="mt-0.5 text-xs text-slate-400">{logAsset.brand} • {logAsset.site} • meter at {Number(logAsset.runtimeHours).toLocaleString()} hrs</p>
              </div>
              <button onClick={() => setLogAsset(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={submitLog} className="space-y-4 p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-300">Event Type</label>
                  <select value={logForm.eventType} onChange={(e) => setLogForm({ ...logForm, eventType: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                    {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-300">Meter Reading (hrs)</label>
                  <input type="number" min="0" value={logForm.runtimeAtEvent} onChange={(e) => setLogForm({ ...logForm, runtimeAtEvent: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-300">Description *</label>
                <textarea required value={logForm.description} onChange={(e) => setLogForm({ ...logForm, description: e.target.value })} placeholder="Replaced oil filter and air element, checked coolant level, load-tested at 80%…" className="h-20 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-300">Downtime (mins)</label>
                  <input type="number" min="0" value={logForm.downtimeMinutes} onChange={(e) => setLogForm({ ...logForm, downtimeMinutes: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-300">Parts Cost ($)</label>
                  <input type="number" step="0.01" min="0" value={logForm.partsCost} onChange={(e) => setLogForm({ ...logForm, partsCost: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-300">Labor Cost ($)</label>
                  <input type="number" step="0.01" min="0" value={logForm.laborCost} onChange={(e) => setLogForm({ ...logForm, laborCost: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <input type="checkbox" checked={logForm.resetService} onChange={(e) => setLogForm({ ...logForm, resetService: e.target.checked })} className="h-4 w-4 rounded" />
                <span className="text-xs font-bold text-emerald-200">
                  <Gauge className="mr-1 inline h-3.5 w-3.5" />
                  Service completed — reset the maintenance meter to this reading
                </span>
              </label>

              <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                <button type="button" onClick={() => setLogAsset(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                  {saving ? "Recording…" : "Record Event"}
                </button>
              </div>
            </form>

            <div className="border-t border-slate-800 p-6">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-300">
                <History className="h-4 w-4 text-blue-400" /> Maintenance history ({assetHistory.length})
              </h4>
              {assetHistory.length === 0 ? (
                <p className="py-4 text-center text-xs italic text-slate-500">No events recorded for this asset yet.</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {assetHistory.map((l) => (
                    <li key={l.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase text-slate-300">{l.eventType}</span>
                        <span className="font-mono text-[10px] text-slate-500">{new Date(l.createdAt).toLocaleDateString()} · {Number(l.runtimeAtEvent).toLocaleString()} hrs</span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-200">{l.description}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-slate-500">
                        {l.performedByName && <span>By {l.performedByName}</span>}
                        {l.downtimeMinutes > 0 && <span>{l.downtimeMinutes}m downtime</span>}
                        {(parseFloat(l.partsCost) > 0 || parseFloat(l.laborCost) > 0) && (
                          <span className="text-emerald-400"><DollarSign className="inline h-3 w-3" />{(parseFloat(l.partsCost) + parseFloat(l.laborCost)).toFixed(2)}</span>
                        )}
                        {l.resetService && <span className="font-bold text-emerald-400">Meter reset</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, caption, captionColor, icon: Icon }: { label: string; value: string; caption: string; captionColor: string; icon: any }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <Icon className="h-5 w-5 text-slate-500" />
      </div>
      <div className="text-3xl font-black tracking-tight text-white">{value}</div>
      <div className={`mt-1 text-xs font-bold ${captionColor}`}>{caption}</div>
    </div>
  );
}
