"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import AuthGate from "@/components/AuthGate";
import FullscreenSplash from "@/components/FullscreenSplash";
import { canAccessModule, listModulesForRole, type ModuleId } from "@/lib/moduleAccess";
import { getLandingTab, type MenuConfig } from "@/lib/menuConfig";
import { loadSavedLang, saveLang, type Lang } from "@/lib/i18n";
import { idleState, loadIdleMinutes, IDLE_WARN_SEC } from "@/lib/idle";
import { registerCustomRoles, registerModuleOverrides } from "@/lib/permissions";

const ScreenLoading = () => (
  <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-slate-800 bg-slate-900/70 px-6 py-5 text-center text-sm font-bold text-slate-400">
    Opening workspace…
  </div>
);

// A user sees one workspace at a time. Keep the other large screens out of the
// initial client bundle and load each only when its tab is actually opened.
const DashboardView = dynamic(() => import("@/components/DashboardView"), { loading: ScreenLoading });
const PlantView = dynamic(() => import("@/components/PlantView"), { loading: ScreenLoading });
const OrdersView = dynamic(() => import("@/components/OrdersView"), { loading: ScreenLoading });
const OrderWorkflowDetail = dynamic(() => import("@/components/OrderWorkflowDetail"), { loading: ScreenLoading });
const MachinesView = dynamic(() => import("@/components/MachinesView"), { loading: ScreenLoading });
const OperatorStationView = dynamic(() => import("@/components/OperatorStationView"), { loading: ScreenLoading });
const CustomersView = dynamic(() => import("@/components/CustomersView"), { loading: ScreenLoading });
const InventoryView = dynamic(() => import("@/components/InventoryView"), { loading: ScreenLoading });
const WarehouseView = dynamic(() => import("@/components/WarehouseView"), { loading: ScreenLoading });
const FloorReceptionView = dynamic(() => import("@/components/FloorReceptionView"), { loading: ScreenLoading });
const ScheduleView = dynamic(() => import("@/components/ScheduleView"), { loading: ScreenLoading });
const GanttView = dynamic(() => import("@/components/GanttView"), { loading: ScreenLoading });
const ProductionReportView = dynamic(() => import("@/components/ProductionReportView"), { loading: ScreenLoading });
const CmmsView = dynamic(() => import("@/components/CmmsView"), { loading: ScreenLoading });
const ReportView = dynamic(() => import("@/components/ReportView"), { loading: ScreenLoading });
const WorkforceView = dynamic(() => import("@/components/WorkforceView"), { loading: ScreenLoading });
const SettingsView = dynamic(() => import("@/components/SettingsView"), { loading: ScreenLoading });
const WipBoardView = dynamic(() => import("@/components/WipBoardView"), { loading: ScreenLoading });
const QualityView = dynamic(() => import("@/components/QualityView"), { loading: ScreenLoading });
const DowntimeView = dynamic(() => import("@/components/DowntimeView"), { loading: ScreenLoading });
const RecipeManagerView = dynamic(() => import("@/components/RecipeManagerView"), { loading: ScreenLoading });
const PimsImportView = dynamic(() => import("@/components/PimsImportView"), { loading: ScreenLoading });
const MenuDesignerView = dynamic(() => import("@/components/MenuDesignerView"), { loading: ScreenLoading });
const MachineDowntimeLoginAlert = dynamic(() => import("@/components/MachineDowntimeLoginAlert"));

export default function WoodTekERP() {
  const [activeTab, setActiveTab] = useState("dashboard");
  // Dashboard status buttons navigate to Orders pre-filtered by status.
  const [ordersPresetStatus, setOrdersPresetStatus] = useState<string | null>(null);
  const navigateWithStatus = (tab: string, status?: string) => {
    setOrdersPresetStatus(status ?? null);
    setActiveTab(tab);
  };
  useEffect(() => {
    if (activeTab !== "orders") setOrdersPresetStatus(null);
  }, [activeTab]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  // Clone order: seed payload from OrderWorkflowDetail's Clone button, consumed
  // by OrdersView's New Order form prefill.
  const [cloneSeed, setCloneSeed] = useState<any>(null);
  const handleCloneOrder = (seed: any) => {
    setCloneSeed(seed);
    setActiveTab("orders");
    setShowNewModal(true);
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authCandidate, setAuthCandidate] = useState<any>(null);
  const [managerDowntimeWarnings, setManagerDowntimeWarnings] = useState<any[]>([]);
  const loginSequenceRef = useRef(0);

  const [dashboardData, setDashboardData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const dashboardDirtyRef = useRef(true);
  const fullRefreshInFlightRef = useRef(false);
  const operationalRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const operationalRefreshPendingRef = useRef(false);
  const machineSummaryRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const machineSummaryRefreshPendingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  // Label language (sidebar / sign-in / top bar). EN default, per device.
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => { setLang(loadSavedLang()); }, []);
  const changeLang = (l: Lang) => { setLang(l); saveLang(l); };

  // ---- Auto-lock on idle (per-device minutes in localStorage) ----
  // Any pointer/key activity refreshes the timestamp; a 5s timer checks
  // whether to show the "locking soon" banner or lock the workspace.
  const lastActivityRef = useRef<number>(Date.now());
  const lockWorkspaceRef = useRef<(() => void) | null>(null);
  const [idleWarnSec, setIdleWarnSec] = useState<number | null>(null);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    const bump = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "mousemove", "keydown", "wheel", "touchstart"];
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const timer = setInterval(() => {
      if (!currentUser || authOpen) { setIdleWarnSec(null); return; }
      const st = idleState(loadIdleMinutes(), lastActivityRef.current, Date.now());
      if (st.lock) {
        setIdleWarnSec(null);
        lockWorkspaceRef.current?.();
      } else {
        setIdleWarnSec(st.warn ? st.remainingSec : null);
      }
    }, 5000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(timer);
    };
  }, [currentUser, authOpen]);
  const [demoMode, setDemoMode] = useState(false);
  // Show the fullscreen welcome splash when a user signs in.
  // It closes once the dashboard finishes loading.
  const [showSplash, setShowSplash] = useState(false);
  const [hasShownSplash, setHasShownSplash] = useState(false);

  const fetchRoster = async () => {
    try {
      const res = await fetch("/api/auth/roster", { cache: "no-store" });
      if (res.ok) setUsers(await res.json());
    } catch (error) {
      console.error("Roster fetch failed", error);
    }
  };

  const fetchAllData = async ({
    includeDashboard = true,
    compactStation = false,
  }: { includeDashboard?: boolean; compactStation?: boolean } = {}) => {
    fullRefreshInFlightRef.current = true;
    if (!includeDashboard) {
      dashboardDirtyRef.current = true;
      setDashboardData(null);
    }
    if (compactStation) {
      // The locked Operator profile needs the station queue and its machine
      // selector, not the customer/template/inventory administration datasets.
      setOrders([]);
      setCustomers([]);
      setTemplates([]);
      setInventory([]);
    }
    try {
      const [dashRes, ordRes, machRes, userRes, custRes, tplRes, invRes] = await Promise.all([
        includeDashboard ? fetch("/api/dashboard") : Promise.resolve(null),
        compactStation ? Promise.resolve(null) : fetch("/api/orders"),
        fetch("/api/machines?summary=true"),
        fetch(compactStation ? "/api/auth/roster" : "/api/users", { cache: "no-store" }),
        compactStation ? Promise.resolve(null) : fetch("/api/customers"),
        compactStation ? Promise.resolve(null) : fetch("/api/templates"),
        compactStation ? Promise.resolve(null) : fetch("/api/inventory"),
      ]);

      const [dashData, orderData, machineData, userData, customerData, templateData, inventoryData] = await Promise.all([
        dashRes?.ok ? dashRes.json() : null,
        ordRes?.ok ? ordRes.json() : null,
        machRes.ok ? machRes.json() : null,
        userRes.ok ? userRes.json() : null,
        custRes?.ok ? custRes.json() : null,
        tplRes?.ok ? tplRes.json() : null,
        invRes?.ok ? invRes.json() : null,
      ]);
      if (userData) setUsers(userData);
      if (orderData) setOrders(orderData);
      if (machineData) setMachines(machineData);
      if (customerData) setCustomers(customerData);
      if (templateData) setTemplates(templateData);
      if (inventoryData) setInventory(inventoryData);
      if (dashData) {
        setDashboardData(dashData);
        dashboardDirtyRef.current = false;
      }
    } catch (error) {
      console.error("Failed to fetch ERP datasets:", error);
    } finally {
      fullRefreshInFlightRef.current = false;
      setLoading(false);
    }
  };

  // Explicit actions refresh only the datasets they can actually change. This
  // avoids the former seven-request refresh flood after each station tap.
  const refreshOperationalData = (): Promise<void> => {
    dashboardDirtyRef.current = true;
    if (operationalRefreshInFlightRef.current) {
      operationalRefreshPendingRef.current = true;
      return operationalRefreshInFlightRef.current;
    }

    const run = (async () => {
      do {
        operationalRefreshPendingRef.current = false;
        try {
          const [ordersRes, machinesRes] = await Promise.all([
            fetch("/api/orders", { cache: "no-store" }),
            fetch("/api/machines?summary=true", { cache: "no-store" }),
          ]);
          const [orderData, machineData] = await Promise.all([
            ordersRes.ok ? ordersRes.json() : null,
            machinesRes.ok ? machinesRes.json() : null,
          ]);
          if (orderData) setOrders(orderData);
          if (machineData) setMachines(machineData);
        } catch (error) {
          console.error("Operational refresh failed", error);
        }
      } while (operationalRefreshPendingRef.current);
    })();
    operationalRefreshInFlightRef.current = run;
    void run.finally(() => {
      if (operationalRefreshInFlightRef.current === run) operationalRefreshInFlightRef.current = null;
    });
    return run;
  };

  const refreshStationShellData = (): Promise<void> => {
    const compactOperator = currentUser?.role === "Machine Operator"
      && (!currentUser?.displayRole || currentUser.displayRole === "Machine Operator");
    if (!compactOperator) return refreshOperationalData();
    dashboardDirtyRef.current = true;
    if (machineSummaryRefreshInFlightRef.current) {
      machineSummaryRefreshPendingRef.current = true;
      return machineSummaryRefreshInFlightRef.current;
    }

    const run = (async () => {
      do {
        machineSummaryRefreshPendingRef.current = false;
        try {
          const response = await fetch("/api/machines?summary=true", { cache: "no-store" });
          if (response.ok) setMachines(await response.json());
        } catch (error) {
          console.error("Station shell refresh failed", error);
        }
      } while (machineSummaryRefreshPendingRef.current);
    })();
    machineSummaryRefreshInFlightRef.current = run;
    void run.finally(() => {
      if (machineSummaryRefreshInFlightRef.current === run) machineSummaryRefreshInFlightRef.current = null;
    });
    return run;
  };

  const refreshOrderWorkspace = async () => {
    dashboardDirtyRef.current = true;
    try {
      const [ordersRes, machinesRes, templatesRes, inventoryRes] = await Promise.all([
        fetch("/api/orders", { cache: "no-store" }),
        fetch("/api/machines?summary=true", { cache: "no-store" }),
        fetch("/api/templates", { cache: "no-store" }),
        fetch("/api/inventory", { cache: "no-store" }),
      ]);
      const [orderData, machineData, templateData, inventoryData] = await Promise.all([
        ordersRes.ok ? ordersRes.json() : null,
        machinesRes.ok ? machinesRes.json() : null,
        templatesRes.ok ? templatesRes.json() : null,
        inventoryRes.ok ? inventoryRes.json() : null,
      ]);
      if (orderData) setOrders(orderData);
      if (machineData) setMachines(machineData);
      if (templateData) setTemplates(templateData);
      if (inventoryData) setInventory(inventoryData);
    } catch (error) {
      console.error("Order workspace refresh failed", error);
    }
  };

  const refreshMachineData = async () => {
    dashboardDirtyRef.current = true;
    try {
      const [machinesRes, usersRes] = await Promise.all([
        fetch("/api/machines?summary=true", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      const [machineData, userData] = await Promise.all([
        machinesRes.ok ? machinesRes.json() : null,
        usersRes.ok ? usersRes.json() : null,
      ]);
      if (machineData) setMachines(machineData);
      if (userData) setUsers(userData);
    } catch (error) {
      console.error("Machine refresh failed", error);
    }
  };

  const refreshCustomerData = async () => {
    dashboardDirtyRef.current = true;
    try {
      const [customersRes, ordersRes] = await Promise.all([
        fetch("/api/customers", { cache: "no-store" }),
        fetch("/api/orders", { cache: "no-store" }),
      ]);
      const [customerData, orderData] = await Promise.all([
        customersRes.ok ? customersRes.json() : null,
        ordersRes.ok ? ordersRes.json() : null,
      ]);
      if (customerData) setCustomers(customerData);
      if (orderData) setOrders(orderData);
    } catch (error) {
      console.error("Customer refresh failed", error);
    }
  };

  const refreshInventoryData = async () => {
    dashboardDirtyRef.current = true;
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      if (response.ok) setInventory(await response.json());
    } catch (error) {
      console.error("Inventory refresh failed", error);
    }
  };

  const refreshTemplateData = async () => {
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      if (response.ok) setTemplates(await response.json());
    } catch (error) {
      console.error("Template refresh failed", error);
    }
  };

  useEffect(() => {
    if (!currentUser || activeTab !== "dashboard" || !dashboardDirtyRef.current || fullRefreshInFlightRef.current) return;
    let cancelled = false;
    void fetch("/api/dashboard", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) {
          setDashboardData(data);
          dashboardDirtyRef.current = false;
        }
      })
      .catch((error) => console.error("Dashboard refresh failed", error));
    return () => { cancelled = true; };
  }, [activeTab, currentUser, loading]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        // A production installation starts empty and presents Create Owner.
        // Demo data is opt-in and may bootstrap only a truly uninitialized DB;
        // the server will never refill orders deleted from an existing system.
        if (process.env.NEXT_PUBLIC_WOODTEK_DEMO === "on") {
          await fetch("/api/seed", { method: "POST" });
        }

        // Menu config, custom roles and session are independent reads. Start
        // them together rather than making every page refresh wait three times.
        const safeGet = (url: string) => fetch(url, { cache: "no-store" }).catch(() => null);
        const [menuResponse, rolesResponse, sessionResponse] = await Promise.all([
          safeGet("/api/menu-config"),
          safeGet("/api/roles"),
          safeGet("/api/auth"),
        ]);

        let loadedMenuConfig: MenuConfig | null = null;
        if (menuResponse?.ok) {
          loadedMenuConfig = (await menuResponse.json()).config ?? null;
          setMenuConfig(loadedMenuConfig);
        }
        if (rolesResponse?.ok) {
          const roleData = await rolesResponse.json();
          registerCustomRoles(Array.isArray(roleData.roles) ? roleData.roles : []);
          registerModuleOverrides(roleData.overrides && typeof roleData.overrides === "object" ? roleData.overrides : {});
        }

        // Restore an existing signed session so a refresh does not log you out.
        if (sessionResponse?.ok) {
          const me = await sessionResponse.json();
          setDemoMode(Boolean(me.demoMode));
          if (me.user) {
            setCurrentUser(me.user);
            const guardRole = me.user.displayRole || me.user.role;
            const configuredLanding =
              getLandingTab(guardRole, loadedMenuConfig) ?? getLandingTab(me.user.role, loadedMenuConfig);
            const restoredLanding = configuredLanding ?? ({
              "Machine Operator": "station",
              "Floor Supervisor": "reception",
              "Warehouse Supervisor": "warehouse",
            } as Record<string, string>)[me.user.role];
            if (restoredLanding) setActiveTab(restoredLanding);
            // Show the welcome splash on page refresh too
            setShowSplash(true);
            setHasShownSplash(true);
            const compactStation = me.user.role === "Machine Operator" && (!me.user.displayRole || me.user.displayRole === "Machine Operator");
            await fetchAllData({
              includeDashboard: !restoredLanding || restoredLanding === "dashboard",
              compactStation,
            });
            return;
          }
        }
        // Not signed in: load only the roster needed to render the sign-in screen.
        await fetchRoster();
      } catch (error) {
        console.error("Initialization error", error);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  const requestProfileSwitch = (candidate?: any) => {
    loginSequenceRef.current += 1;
    setManagerDowntimeWarnings([]);
    setAuthCandidate(candidate || null);
    setAuthOpen(true);
    setSidebarOpen(false);
  };

  const handleAuthenticated = async (user: any) => {
    const loginSequence = ++loginSequenceRef.current;
    setManagerDowntimeWarnings([]);
    setCurrentUser(user);
    setAuthOpen(false);
    setAuthCandidate(null);

    // A fresh Manager PIN login performs a dedicated live-downtime check. It
    // is separate from dashboard loading so the safety prompt appears quickly
    // even when the rest of the Manager workspace is still bootstrapping.
    if (user.role === "Manager") {
      void fetch("/api/downtime?activeOnly=true", { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() : [])
        .then((payload) => {
          if (loginSequenceRef.current !== loginSequence) return;
          const active = Array.isArray(payload) ? payload.filter((event) => !event?.endedAt) : [];
          if (active.length > 0) {
            setShowSplash(false);
            setManagerDowntimeWarnings(active);
          }
        })
        .catch((error) => console.error("Manager login downtime check failed", error));
    }
    const LANDING_TAB: Record<string, string> = {
      "Machine Operator": "station",
      "Floor Supervisor": "reception",
      "Warehouse Supervisor": "warehouse",
    };
    // Menu Designer override wins (checked for the display role, then the
    // base role); built-in factory behaviour is the fallback.
    const landing =
      getLandingTab(user.displayRole || user.role, menuConfig) ??
      getLandingTab(user.role, menuConfig) ??
      LANDING_TAB[user.role];
    if (landing) {
      setActiveTab(landing);
    } else if (activeTab === "station" || activeTab === "reception") {
      // Never strand a non-station role on the touchscreen / reception boards.
      setActiveTab("dashboard");
    }
    // Show the fullscreen welcome splash for this user
    setShowSplash(true);
    setHasShownSplash(true);
    const compactStation = user.role === "Machine Operator" && (!user.displayRole || user.displayRole === "Machine Operator");
    await fetchAllData({ includeDashboard: !landing || landing === "dashboard", compactStation });
  };

  const lockWorkspace = async () => {
    loginSequenceRef.current += 1;
    setManagerDowntimeWarnings([]);
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch (error) {
      console.error("Sign out failed", error);
    }
    setCurrentUser(null);
    setAuthCandidate(null);
    setAuthOpen(false);
    setSidebarOpen(false);
    setShowSplash(false);
    setHasShownSplash(false);
    await fetchRoster();
  };
  lockWorkspaceRef.current = lockWorkspace;

  const exitApp = async () => {
    // Confirm first - signing out + closing the window is destructive
    const ok = window.confirm(
      "Exit WoodTek ERP?\n\n" +
      "You will be signed out and the window will close.\n" +
      "If the dev server is running, it will keep running in the background — " +
      "you can restart it from C:\\woodtek-erp\\backup\\start-woodtek.bat."
    );
    if (!ok) return;
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch (error) {
      console.error("Sign out failed during exit", error);
    }
    // Try to close the window. This works if the app was opened in
    // Chrome/Edge --app=URL mode or a popup. In a regular tab, the
    // browser will prompt the user to confirm.
    window.close();
  };

  // QR deep link: /?order=<id> opens that order directly (used by the printed order stickers).
  useEffect(() => {
    const o = new URLSearchParams(window.location.search).get("order");
    if (o && /^\d+$/.test(o)) setActiveTab(`order-${Number(o)}`);
  }, []);

  // Keyboard shortcuts: Ctrl+K (or Cmd+K) and "/" focus the global search;
  // Escape while the search is focused dismisses it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.getElementById("woodtek-global-search") as HTMLInputElement | null;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (el) {
          el.focus();
          el.select();
        }
      } else if (e.key === "/" && !(e.ctrlKey || e.metaKey || e.altKey)) {
        const t = e.target as HTMLElement | null;
        const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
        if (!typing && el) {
          e.preventDefault();
          el.focus();
        }
      } else if (e.key === "Escape" && el && document.activeElement === el) {
        el.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelectOrder = (orderId: number) => {
    setActiveTab(`order-${orderId}`);
    setSidebarOpen(false);
  };

  const canCreateOrders = currentUser?.role === "Manager" || currentUser?.role === "Sales Coordinator";

  // Map the legacy tab id to a ModuleId for the access check
  const tabToModule = (tab: string): ModuleId | null => {
    if (tab === "station") return "operator";
    if (tab.startsWith("order-")) return "orders";
    const allowed: ModuleId[] = ["dashboard", "orders", "machines", "operator", "customers", "inventory", "schedule", "gantt", "production", "cmms", "reports", "settings", "workforce", "wip", "quality", "downtime", "recipes", "pims", "designer", "warehouse", "plant", "reception"];
    return (allowed as string[]).includes(tab) ? (tab as ModuleId) : null;
  };

  // If the current user is signed in but landed on a tab they cannot access,
  // bounce them back to their dashboard.
  useEffect(() => {
    if (!currentUser) return;
    const m = tabToModule(activeTab);
    const guardRole = currentUser.displayRole || currentUser.role;
    // Bounce when the tab is inaccessible OR unknown (e.g. left over from the
    // previous profile after a user switch — "reception" stuck on a warehouse
    // user would otherwise render a screen that is not theirs).
    if (!m || !canAccessModule(guardRole, m)) {
      // Bounce to the role's landing tab when it has one (operator -> station,
      // warehouse supervisor -> warehouse, floor supervisor -> reception);
      // otherwise the first module this role may actually see.
      const LANDING: Record<string, string> = {
        "Machine Operator": "station",
        "Floor Supervisor": "reception",
        "Warehouse Supervisor": "warehouse",
      };
      const first = listModulesForRole(guardRole)[0];
      const configured =
        getLandingTab(guardRole, menuConfig) ?? getLandingTab(currentUser.role, menuConfig);
      const fallback =
        configured ?? LANDING[guardRole] ?? (first === "operator" ? "station" : first ?? "station");
      setActiveTab(fallback);
    }
  }, [currentUser, activeTab, menuConfig]);

  return (
    <div className="app-bg flex h-screen text-slate-100 font-sans overflow-hidden antialiased">
      {idleWarnSec != null && (
        <button
          onClick={() => { lastActivityRef.current = Date.now(); setIdleWarnSec(null); }}
          className="fixed left-1/2 top-3 z-[200] -translate-x-1/2 rounded-xl border border-amber-500/50 bg-slate-900/95 px-4 py-2 text-xs font-black text-amber-300 shadow-2xl backdrop-blur"
          title="Tap to cancel the auto-lock now"
        >
          ⏳ {idleWarnSec <= IDLE_WARN_SEC ? Math.ceil(idleWarnSec) : IDLE_WARN_SEC}s — auto-lock soon. Move the mouse or tap here to stay signed in.
        </button>
      )}
      {showSplash && currentUser && (
        <FullscreenSplash
          user={currentUser}
          isLoading={loading}
          onClose={() => setShowSplash(false)}
        />
      )}
      {managerDowntimeWarnings.length > 0 && currentUser?.role === "Manager" && (
        <MachineDowntimeLoginAlert
          events={managerDowntimeWarnings}
          onAcknowledge={() => setManagerDowntimeWarnings([])}
          onOpenDowntime={() => {
            setManagerDowntimeWarnings([]);
            setShowSplash(false);
            setActiveTab("downtime");
          }}
        />
      )}
      {sidebarOpen && <button className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        allUsers={users}
        onSwitchUser={(user) => requestProfileSwitch(user)}
        onRequestSwitch={() => requestProfileSwitch()}
        menuConfig={menuConfig}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        lang={lang}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto custom-scrollbar">
        <Header
          activeTab={activeTab}
          onNewOrder={() => {
            if (!canCreateOrders) return;
            setActiveTab("orders");
            setShowNewModal(true);
          }}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          lang={lang}
          onSetLang={changeLang}
          orders={orders}
          customers={customers}
          machinesList={machines}
          onOpenOrder={handleSelectOrder}
          onNavigate={(t: string) => setActiveTab(t)}
          currentUser={currentUser}
          bottleneckCount={dashboardData?.primaryBottleneck?.queueLength > 1 ? 1 : 0}
          lowStockCount={dashboardData?.lowStockItems?.length || 0}
          onOpenMenu={() => setSidebarOpen(true)}
          onSwitchProfile={() => requestProfileSwitch()}
          onLock={lockWorkspace}
          onExit={exitApp}
          canCreateOrder={canCreateOrders}
        />

        <main key={activeTab} className="flex-1 pb-16 animate-fade-up">
          {currentUser && (
            <>
          {activeTab === "dashboard" && <DashboardView data={dashboardData} loading={loading} onNavigate={navigateWithStatus} currentUser={currentUser} />}
          {activeTab === "plant" && <PlantView onNavigate={setActiveTab} />}
          {activeTab === "orders" && (
            <OrdersView orders={orders} loading={loading} onSelectOrder={handleSelectOrder} onRefresh={refreshOrderWorkspace}
              showNewModal={showNewModal && canCreateOrders} setShowNewModal={setShowNewModal} customers={customers}
              templates={templates} machines={machines} searchQuery={searchQuery} currentUser={currentUser} inventoryItems={inventory}
              presetStatus={ordersPresetStatus} cloneSeed={cloneSeed} onCloneConsumed={() => setCloneSeed(null)} />
          )}
          {activeTab === "schedule" && (
            <ScheduleView machines={machines} currentUser={currentUser} onRefresh={refreshOperationalData} searchQuery={searchQuery} />
          )}
          {activeTab.startsWith("order-") && (
            <OrderWorkflowDetail orderId={Number(activeTab.split("-")[1])} onBack={() => setActiveTab("orders")}
              onRefresh={refreshOperationalData} currentUser={currentUser} machines={machines} inventoryItems={inventory}
              onCloneOrder={canCreateOrders ? handleCloneOrder : undefined} />
          )}
          {activeTab === "machines" && <MachinesView machines={machines} loading={loading} onRefresh={refreshMachineData} users={users} onSelectOrder={handleSelectOrder} currentUser={currentUser} />}
          {activeTab === "station" && <OperatorStationView machines={machines} currentUser={currentUser} onRefresh={refreshStationShellData} onSelectOrder={handleSelectOrder} />}
          {activeTab === "customers" && <CustomersView customers={customers} loading={loading} onRefresh={refreshCustomerData} onSelectOrder={handleSelectOrder} />}
          {activeTab === "inventory" && <InventoryView items={inventory} loading={loading} onRefresh={refreshInventoryData} currentUser={currentUser} />}
          {activeTab === "warehouse" && <WarehouseView currentUser={currentUser} />}
          {activeTab === "reception" && <FloorReceptionView currentUser={currentUser} onSelectOrder={handleSelectOrder} />}
          {activeTab === "gantt" && (
            <GanttView machines={machines} onSelectOrder={handleSelectOrder} searchQuery={searchQuery} />
          )}
          {activeTab === "production" && <ProductionReportView currentUser={currentUser} />}
          {activeTab === "cmms" && (
            <CmmsView currentUser={currentUser} machines={machines} searchQuery={searchQuery} />
          )}
          {activeTab === "reports" && <ReportView currentUser={currentUser} searchQuery={searchQuery} />}
          {activeTab === "workforce" && <WorkforceView currentUser={currentUser} machines={machines} />}
          {activeTab === "wip" && <WipBoardView onSelectOrder={handleSelectOrder} onNavigate={setActiveTab} />}
          {activeTab === "quality" && <QualityView currentUser={currentUser} onSelectOrder={handleSelectOrder} />}
          {activeTab === "downtime" && <DowntimeView currentUser={currentUser} />}
          {activeTab === "recipes" && <RecipeManagerView onRefresh={refreshTemplateData} />}
          {activeTab === "pims" && <PimsImportView onSelectOrder={handleSelectOrder} />}
          {activeTab === "designer" && (
            <MenuDesignerView currentUser={currentUser} menuConfig={menuConfig} onSaved={setMenuConfig} />
          )}
          {activeTab === "settings" && <SettingsView currentUser={currentUser} />}
            </>
          )}
        </main>
      </div>

      {!loading && (!currentUser || authOpen) && (
        <AuthGate
          users={users}
          initialUser={authCandidate}
          lang={lang}
          required={!currentUser}
          onAuthenticated={handleAuthenticated}
          onCancel={currentUser ? () => { setAuthOpen(false); setAuthCandidate(null); } : undefined}
          demoMode={demoMode}
        />
      )}
    </div>
  );
}
