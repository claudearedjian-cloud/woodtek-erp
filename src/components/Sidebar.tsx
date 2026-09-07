"use client";

import React from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Cpu,
  Tablet,
  Users,
  Package,
  Wrench,
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
  Import
} from "lucide-react";
import { canAccessModule, type ModuleId } from "@/lib/moduleAccess";
import BrandMark from "@/components/BrandMark";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: any;
  allUsers: any[];
  onSwitchUser: (user: any) => void;
  onRequestSwitch: () => void;
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
  isOpen,
  onClose,
}: SidebarProps) {
  const navItems = [
    { id: "dashboard", label: "Executive Dashboard", icon: LayoutDashboard, badge: "" },
    { id: "wip", label: "Live WIP Board", icon: Activity, badge: "Live" },
    { id: "orders", label: "Orders & Routing", icon: ClipboardList, badge: "Live" },
    { id: "recipes", label: "Routing Recipes", icon: Workflow, badge: "Recipe" },
    { id: "schedule", label: "Dispatch Schedule", icon: CalendarDays, badge: "Plan" },
    { id: "gantt", label: "Gantt Chart", icon: GanttChartSquare, badge: "Timeline" },
    { id: "machines", label: "Shop Floor Monitor", icon: Cpu, badge: "" },
    { id: "cmms", label: "Asset CMMS", icon: Zap, badge: "PM" },
    { id: "downtime", label: "Downtime Log", icon: Zap, badge: "Down" },
    { id: "quality", label: "Scrap & Rework", icon: AlertTriangle, badge: "QA" },
    { id: "workforce", label: "Workforce & Shifts", icon: CalendarClock, badge: "Shift" },
    { id: "station", label: "Operator Station Mode", icon: Tablet, badge: "Touch" },
    { id: "customers", label: "Clients & Architects", icon: Users, badge: "" },
    { id: "inventory", label: "Wood & Edge Stock", icon: Package, badge: "" },
    { id: "pims", label: "PIMS Import", icon: Import, badge: "Link" },
    { id: "reports", label: "System Reports", icon: FileText, badge: "PDF" },
    { id: "settings", label: "General Settings", icon: SettingsIcon, badge: "" },
  ];

  // Map the legacy tab id to our canonical ModuleId and filter by role
  const visibleNavItems = navItems.filter(item => {
    const moduleId = item.id === "station" ? "operator" : (item.id as ModuleId);
    return canAccessModule(currentUser?.role, moduleId);
  });

  // Shop-floor operators get a clean touchscreen: the Active Role Persona
  // panel (profile card + hover role switcher) is hidden for them. They
  // keep the PIN switch button so they can still sign in/out.
  const isOperator = currentUser?.role === "Machine Operator";

  // In the Manager view, plant-configuration modules are grouped under
  // General Settings instead of cluttering the top-level list.
  const isManager = currentUser?.role === "Manager";
  const SETTINGS_GROUP = ["recipes", "downtime", "workforce", "pims", "machines"];
  const topNavItems = isManager
    ? visibleNavItems.filter((item) => !SETTINGS_GROUP.includes(item.id))
    : visibleNavItems;
  const settingsSubItems = isManager
    ? SETTINGS_GROUP.map((id) => visibleNavItems.find((i) => i.id === id)).filter(
        (i): i is (typeof navItems)[number] => Boolean(i),
      )
    : [];

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
        {visibleNavItems.length === 0 ? (
          <div className="mx-1 my-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-5 text-center">
            <LockKeyhole className="mx-auto mb-2 h-5 w-5 text-amber-500/80" />
            <p className="text-xs font-bold text-slate-300">Sign in to continue</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Enter your shop PIN on the sign-in screen to load your modules and stations.
            </p>
          </div>
        ) : (
          topNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id ||
              (activeTab.startsWith("order-") && item.id === "orders") ||
              (item.id === "settings" && SETTINGS_GROUP.includes(activeTab));
            return (
              <React.Fragment key={item.id}>
              <button
                onClick={() => { setActiveTab(item.id); onClose(); }}
                className={`relative w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 group ${
                  isActive
                    ? "bg-gradient-to-r from-amber-500 to-amber-600 font-bold text-slate-950 shadow-lg shadow-amber-950/40"
                    : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                }`}
              >
                {isActive && (
                  <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amber-400" />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Icon className={`h-5 w-5 shrink-0 transition-transform group-hover:scale-110 ${isActive ? "text-slate-950" : "text-slate-400 group-hover:text-amber-400"}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    isActive ? "bg-slate-950/25 text-slate-950" : "border border-slate-700 bg-slate-800 text-amber-400"
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
              {item.id === "settings" && settingsSubItems.length > 0 && (
                <div className="ml-5 mt-1 space-y-1 border-l-2 border-slate-700/60 pl-3 pb-1">
                  {settingsSubItems.map((sub) => {
                    const SubIcon = sub.icon;
                    const subActive = activeTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => { setActiveTab(sub.id); onClose(); }}
                        className={`relative w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 ${
                          subActive
                            ? "bg-slate-800 font-bold text-amber-400"
                            : "text-slate-400 hover:bg-slate-800/70 hover:text-white"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <SubIcon className={`h-4 w-4 shrink-0 ${subActive ? "text-amber-400" : "text-slate-500"}`} />
                          <span className="truncate">{sub.label}</span>
                        </div>
                        {sub.badge && (
                          <span className="shrink-0 rounded-full border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
                            {sub.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              </React.Fragment>
            );
          })
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
                <ShieldCheck className="w-3 h-3 inline" /> {currentUser?.role || "Sign in required"}
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
