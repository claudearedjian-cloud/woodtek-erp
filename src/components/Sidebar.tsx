"use client";

import React from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Cpu,
  Tablet,
  Users,
  Package,
  ShieldCheck,
  UserCheck,
  ChevronRight,
  Sparkles,
  Layers,
  CalendarDays,
  FileText,
  Settings as SettingsIcon,
  GanttChartSquare,
  Activity,
  CalendarClock,
  AlertTriangle,
  Zap,
  LockKeyhole,
  Workflow,
  Import,
  SlidersHorizontal,
} from "lucide-react";
import { resolveMenu, type MenuConfig } from "@/lib/menuConfig";
import BrandMark from "@/components/BrandMark";

const ICONS: Record<string, any> = {
  dashboard: LayoutDashboard,
  wip: Activity,
  orders: ClipboardList,
  recipes: Workflow,
  schedule: CalendarDays,
  gantt: GanttChartSquare,
  machines: Cpu,
  cmms: Zap,
  downtime: Zap,
  quality: AlertTriangle,
  workforce: CalendarClock,
  station: Tablet,
  customers: Users,
  inventory: Package,
  pims: Import,
  reports: FileText,
  settings: SettingsIcon,
  designer: SlidersHorizontal,
};

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: any;
  allUsers: any[];
  onSwitchUser: (user: any) => void;
  onRequestSwitch: () => void;
  menuConfig: MenuConfig | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  currentUser,
  allUsers,
  onSwitchUser,
  onRequestSwitch,
  menuConfig,
  isOpen,
  onClose,
}: SidebarProps) {
  // Custom roles: menu overrides are keyed by the custom name, and the base
  // role decides module access — resolveMenu handles both.
  const resolved = resolveMenu(currentUser?.displayRole || currentUser?.role, menuConfig);

  // Shop-floor operators get a clean touchscreen: the Active Role Persona
  // panel (profile card + hover role switcher) is hidden for them. They
  // keep the PIN switch button so they can still sign in/out.
  const isOperator = currentUser?.role === "Machine Operator";

  const renderItem = (
    item: { id: string; label: string; badge: string },
    sub: boolean,
  ) => {
    const Icon = ICONS[item.id] ?? Layers;
    const isActive =
      activeTab === item.id ||
      (activeTab.startsWith("order-") && item.id === "orders") ||
      (item.id === "settings" && resolved.settings.some((s) => s.id === activeTab));
    const cls = sub
      ? `relative w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 ${
          isActive
            ? "bg-slate-800 font-bold text-amber-400"
            : "text-slate-400 hover:bg-slate-800/70 hover:text-white"
        }`
      : `relative w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 group ${
          isActive
            ? "bg-gradient-to-r from-amber-500 to-amber-600 font-bold text-slate-950 shadow-lg shadow-amber-950/40"
            : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
        }`;
    return (
      <button key={item.id} onClick={() => { setActiveTab(item.id); onClose(); }} className={cls}>
        {!sub && isActive && (
          <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amber-400" />
        )}
        <div className={`flex min-w-0 flex-1 items-center ${sub ? "gap-2" : "gap-2.5"}`}>
          <Icon
            className={`${sub ? "h-4 w-4" : "h-5 w-5"} shrink-0 transition-transform group-hover:scale-110 ${
              isActive ? (sub ? "text-amber-400" : "text-slate-950") : "text-slate-400 group-hover:text-amber-400"
            }`}
          />
          <span className="truncate">{item.label}</span>
        </div>
        {item.badge && (
          <span
            className={`shrink-0 rounded-full font-bold uppercase ${
              sub
                ? "border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] text-amber-400"
                : isActive
                  ? "bg-slate-950/25 px-2 py-0.5 text-[10px] text-slate-950"
                  : "border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-amber-400"
            }`}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const empty = resolved.top.length === 0 && resolved.settings.length === 0;

  return (
    <aside className={`fixed inset-y-0 left-0 w-72 bg-slate-900 text-slate-200 flex flex-col h-screen border-r border-slate-800 shadow-2xl flex-shrink-0 z-50 select-none transition-transform duration-200 md:relative md:translate-x-0 md:shadow-xl ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
      {/* Brand & Factory Header */}
      <div className="relative border-b border-slate-800 p-5">
        <div className="flex items-center gap-3">
          <BrandMark size={44} />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-extrabold tracking-tight text-white">WoodTek ERP</h1>
              <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                PRO
              </span>
            </div>
            <p className="flex items-center gap-1 text-xs font-medium text-slate-400">
              <Layers className="h-3 w-3 text-amber-500" /> Furniture Service Center
            </p>
          </div>
        </div>
        <span className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-amber-500/40 via-slate-700/40 to-transparent" />
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-5 px-3 space-y-1.5 custom-scrollbar">
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Operations & Control
        </div>
        {empty ? (
          <div className="mx-1 my-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-5 text-center">
            <LockKeyhole className="mx-auto mb-2 h-5 w-5 text-amber-500/80" />
            <p className="text-xs font-bold text-slate-300">Sign in to continue</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Enter your shop PIN on the sign-in screen to load your modules and stations.
            </p>
          </div>
        ) : (
          resolved.top.map((item) => (
            <React.Fragment key={item.id}>
              {renderItem(item, false)}
              {item.id === "settings" && resolved.settings.length > 0 && (
                <div className="ml-5 mt-1 space-y-1 border-l-2 border-slate-700/60 pl-3 pb-1">
                  {resolved.settings.map((s) => renderItem(s, true))}
                </div>
              )}
            </React.Fragment>
          ))
        )}

        <div className="mx-3 mt-5 border-t border-slate-800/80 pt-4" />
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Factory Automation
        </div>
        <div className="px-3.5 py-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-2 font-semibold text-slate-300 mb-1">
            <Sparkles className="w-4 h-4 text-amber-400" /> Auto Workflow Engine
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Completing an order operation automatically advances the part to the next machine along the line.
          </p>
        </div>
      </div>

      {/* Role Switcher & Auth Section */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/80">
        {!isOperator && (<>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
          <span>Active Role Persona</span>
          <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
        </div>

        {/* Current logged in profile */}
        <div className="relative group mb-3">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-amber-500/50 transition cursor-pointer">
            <div className={`w-9 h-9 rounded-lg ${currentUser?.avatarColor || "bg-slate-700"} flex items-center justify-center text-white font-bold text-sm shadow-md`}>
              {currentUser?.name?.charAt(0) || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white truncate">{currentUser?.name || "Not signed in"}</div>
              <div className="text-[11px] text-slate-400 font-semibold truncate flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 inline" /> {currentUser?.displayRole || currentUser?.role || "Sign in required"}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transform group-hover:translate-x-0.5 transition" />
          </div>

          {/* Popup Persona Selector */}
          <div className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 space-y-1 max-h-52 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 mb-1">
              Switch Operational Role
            </div>
            {allUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => onSwitchUser(user)}
                className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left text-xs transition ${
                  currentUser?.id === user.id ? "bg-amber-500/20 text-white font-bold border border-amber-500/30" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <div className={`w-6 h-6 rounded-md ${user.avatarColor} flex items-center justify-center text-[10px] text-white font-bold`}>
                  {user.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-200">{user.name}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user.role}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        </>)}

        <button
          onClick={onRequestSwitch}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/30 transition"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Switch profile (PIN required)</span>
        </button>
      </div>
    </aside>
  );
}
