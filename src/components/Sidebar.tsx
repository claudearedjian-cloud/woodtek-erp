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
  Warehouse as WarehouseIcon,
  Gauge,
  PackageCheck,
  ExternalLink,
  Box,
  Boxes,
  Hammer,
  Wrench,
  Drill,
  Ruler,
  Scissors,
  PaintRoller,
  Paintbrush,
  Armchair,
  Sofa,
  Lamp,
  DoorOpen,
  Forklift,
  Truck,
  HardHat,
  ClipboardCheck,
  Archive,
  Banknote,
  Receipt,
  BarChart3,
  LineChart,
  PieChart,
  Target,
  Timer,
  Clock,
  Star,
  Home,
  Building2,
  Factory,
  Globe,
  Link as LinkIcon,
  Tag,
  PenTool,
  Sparkle,
} from "lucide-react";
import { resolveMenu, type MenuConfig, type ResolvedMenuItem } from "@/lib/menuConfig";
import { screenAllowedForSubject, type OptionalModulesConfig } from "@/lib/optionalModules";
import { tt, type Lang } from "@/lib/i18n";
import BrandMark from "@/components/BrandMark";
import { currentAppearance } from "@/lib/appearance";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import {
  SIDEBAR_MODES,
  SIDEBAR_MODE_HINTS,
  SIDEBAR_MODE_LABELS,
  sidebarDesktopClasses,
  type SidebarMode,
} from "@/lib/sidebarMode";

const ICONS: Record<string, any> = {
  dashboard: LayoutDashboard,
  wip: Activity,
  orders: ClipboardList,
  recipes: Workflow,
  schedule: CalendarDays,
  gantt: GanttChartSquare,
  production: BarChart3,
  machines: Cpu,
  cmms: Zap,
  downtime: Zap,
  quality: AlertTriangle,
  workforce: CalendarClock,
  hr: Banknote,
  station: Tablet,
  customers: Users,
  inventory: Package,
  purchasing: Truck,
  invoicing: Receipt,
  jobcosting: PieChart,
  assembly: Boxes,
  pims: Import,
  reports: FileText,
  settings: SettingsIcon,
  designer: SlidersHorizontal,
  warehouse: WarehouseIcon,
  reception: PackageCheck,
  plant: Gauge,
  // Icon-picker palette (keys validated by MENU_ICON_KEYS in menuConfig.ts)
  box: Box,
  boxes: Boxes,
  hammer: Hammer,
  wrench: Wrench,
  drill: Drill,
  ruler: Ruler,
  scissors: Scissors,
  "paint-roller": PaintRoller,
  paintbrush: Paintbrush,
  armchair: Armchair,
  sofa: Sofa,
  lamp: Lamp,
  "door-open": DoorOpen,
  forklift: Forklift,
  truck: Truck,
  "hard-hat": HardHat,
  "clipboard-check": ClipboardCheck,
  archive: Archive,
  banknote: Banknote,
  receipt: Receipt,
  "bar-chart": BarChart3,
  "line-chart": LineChart,
  "pie-chart": PieChart,
  target: Target,
  timer: Timer,
  clock: Clock,
  shield: ShieldCheck,
  star: Star,
  home: Home,
  building: Building2,
  factory: Factory,
  globe: Globe,
  link: LinkIcon,
  tag: Tag,
  "pen-tool": PenTool,
  sparkle: Sparkle,
  "external-link": ExternalLink,
  layers: Layers,
};

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: any;
  menuConfig: MenuConfig | null;
  optionalModulesConfig?: OptionalModulesConfig | null;
  isOpen: boolean;
  onClose: () => void;
  lang?: Lang;
  /** Desktop behaviour: keep, auto-hide or hide (per device). */
  mode?: SidebarMode;
  onModeChange?: (mode: SidebarMode) => void;
  /** Opens the menu (auto-hide edge trigger). */
  onOpen?: () => void;
  /**
   * Menu Designer live preview: render this same sidebar inside the designer
   * instead of as the app's fixed navigation. Clicks never navigate away and
   * no drawer behaviour applies.
   */
  preview?: boolean;
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  currentUser,
  menuConfig,
  optionalModulesConfig,
  isOpen,
  onClose,
  lang = "en",
  mode = "keep",
  onModeChange,
  onOpen,
  preview = false,
}: SidebarProps) {
  // Factory branding (Settings → Appearance). Read from the module cache the
  // AppearanceProvider fills at start-up — defaults until it loads.
  const brand = currentAppearance();
  // Custom roles: menu overrides are keyed by the custom name, and the base
  // role decides module access — resolveMenu handles both.
  const rawMenu = resolveMenu(currentUser?.displayRole || currentUser?.role, menuConfig);
  const visible = (item: ResolvedMenuItem) => screenAllowedForSubject(
    item.kind === "link" ? item.id : (item.target || item.id), currentUser, optionalModulesConfig,
  );
  const resolved = {
    top: rawMenu.top.filter(visible),
    settings: rawMenu.settings.filter(visible),
    sections: rawMenu.sections.map((s) => ({ ...s, items: s.items.filter(visible) })),
  };

  const renderItem = (
    item: ResolvedMenuItem,
    sub: boolean,
  ) => {
    const isLink = item.kind === "link";
    const navId = isLink ? "" : item.target || item.id; // custom entries navigate to their target tab
    const Icon = isLink
      ? ICONS[item.icon ?? ""] ?? ExternalLink
      : ICONS[item.icon ?? ""] ?? ICONS[navId] ?? ICONS[item.id] ?? Layers;
    const isActive =
      activeTab === item.id ||
      (!isLink && !!item.target && item.target !== item.id && activeTab === item.target) ||
      (activeTab.startsWith("order-") && (item.id === "orders" || item.target === "orders")) ||
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
    return isLink ? (
      <a
        key={item.id}
        href={preview ? "#" : item.target || "#"}
        target={preview ? undefined : "_blank"}
        rel={preview ? undefined : "noopener noreferrer"}
        onClick={(event) => {
          if (preview) event.preventDefault();
          else onClose();
        }}
        aria-disabled={preview || undefined}
        tabIndex={preview ? -1 : undefined}
        className={cls}
      >
        {!sub && isActive && (
          <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amber-400" />
        )}
        <div className={`flex min-w-0 flex-1 items-center ${sub ? "gap-2" : "gap-2.5"}`}>
          <Icon
            className={`${sub ? "h-4 w-4" : "h-5 w-5"} shrink-0 transition-transform group-hover:scale-110 ${
              isActive ? (sub ? "text-amber-400" : "text-slate-950") : "text-slate-400 group-hover:text-amber-400"
            }`}
          />
          <span className="truncate">{tt(lang, item.label)}</span>
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
      </a>
    ) : (
      <button
        key={item.id}
        type="button"
        disabled={preview}
        aria-disabled={preview || undefined}
        tabIndex={preview ? -1 : undefined}
        onClick={() => {
          if (preview) return;
          setActiveTab(navId);
          onClose();
        }}
        className={cls}
      >
        {!sub && isActive && (
          <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amber-400" />
        )}
        <div className={`flex min-w-0 flex-1 items-center ${sub ? "gap-2" : "gap-2.5"}`}>
          <Icon
            className={`${sub ? "h-4 w-4" : "h-5 w-5"} shrink-0 transition-transform group-hover:scale-110 ${
              isActive ? (sub ? "text-amber-400" : "text-slate-950") : "text-slate-400 group-hover:text-amber-400"
            }`}
          />
          <span className="truncate">{tt(lang, item.label)}</span>
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

  const empty =
    resolved.top.length === 0 &&
    resolved.settings.length === 0 &&
    resolved.sections.every((s) => s.items.length === 0);

  return (
    <>
    {/* Auto-hide: a thin strip at the left edge opens the menu when the mouse reaches it. */}
    {!preview && mode === "autohide" && !isOpen && onOpen && (
      <div
        aria-hidden="true"
        onMouseEnter={onOpen}
        className="hidden md:block fixed inset-y-0 left-0 w-2 z-40"
      />
    )}
    <aside
      data-sidebar-preview={preview ? "true" : undefined}
      aria-label={preview ? "Menu preview" : undefined}
      onMouseLeave={() => { if (!preview && mode === "autohide" && isOpen) onClose(); }}
      className={preview
        ? "relative flex h-full min-h-0 w-full flex-col border-r border-slate-800 bg-slate-900 text-slate-200 shadow-2xl flex-shrink-0 select-none"
        : `fixed inset-y-0 left-0 w-72 bg-slate-900 text-slate-200 flex flex-col h-screen border-r border-slate-800 shadow-2xl flex-shrink-0 z-50 select-none transition-transform duration-200 md:shadow-xl ${isOpen ? "translate-x-0" : "-translate-x-full"} ${sidebarDesktopClasses(mode, isOpen)}`}
    >
      {/* Brand & Factory Header */}
      <div className="relative border-b border-slate-800 p-5">
        <div className="flex items-center gap-3">
          <BrandMark size={44} logo={brand.logoDataUrl || undefined} />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-extrabold tracking-tight text-white">WoodTek ERP</h1>
              <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                PRO
              </span>
            </div>
            <p className="flex items-center gap-1 text-xs font-medium text-slate-400">
              <Layers className="h-3 w-3 text-amber-500" /> {brand.factoryName?.trim() || brand.tagline?.trim() || "Furniture Service Center"}
            </p>
          </div>
        </div>
        {!preview && onModeChange && (
          <div className="mt-4 hidden items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1 md:flex" role="group" aria-label="Menu behaviour">
            {SIDEBAR_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                title={SIDEBAR_MODE_HINTS[m]}
                aria-pressed={mode === m}
                className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                  mode === m ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
                }`}
              >
                {SIDEBAR_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}
        <span className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-amber-500/40 via-slate-700/40 to-transparent" />
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-5 px-3 space-y-1.5 custom-scrollbar">
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {tt(lang, "Operations & Control")}
        </div>
        {empty ? (
          <div className="mx-1 my-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-5 text-center">
            <LockKeyhole className="mx-auto mb-2 h-5 w-5 text-amber-500/80" />
            <p className="text-xs font-bold text-slate-300">{tt(lang, "Sign in to continue")}</p>
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

        {/* Menu Designer custom sections */}
        {resolved.sections.map((sec) =>
          sec.items.length > 0 ? (
            <React.Fragment key={`sec-${sec.name}`}>
              <div className="mx-1 mt-4 border-t border-slate-800/60 pt-3" />
              <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-amber-500/80 truncate flex items-center gap-1.5">
                {(() => {
                  const SecIcon = ICONS[sec.icon ?? ""] ?? Layers;
                  return <SecIcon className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />;
                })()}
                <span className="truncate">{sec.name}</span>
              </div>
              {sec.items.map((item) => renderItem(item, false))}
            </React.Fragment>
          ) : null,
        )}

        <div className="mx-3 mt-5 border-t border-slate-800/80 pt-4" />
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {tt(lang, "Factory Automation")}
        </div>
        <div className="px-3.5 py-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-2 font-semibold text-slate-300 mb-1">
            <Sparkles className="w-4 h-4 text-amber-400" /> {tt(lang, "Auto Workflow Engine")}
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Completing an order operation automatically advances the part to the next machine along the line.
          </p>
        </div>

        {currentUser?.name && (
          <div className="mx-1 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">Signed in as</div>
            <div className="mt-0.5 truncate text-base font-extrabold text-white">{currentUser.name}</div>
            <div className="truncate text-[11px] font-semibold text-slate-400">{currentUser.displayRole || currentUser.role}</div>
          </div>
        )}
      </div>

      {/* Footer: copyright only. The active-role persona card and the
          "switch profile" button were removed on the owner's request from
          every screen; the top bar still carries the switch-profile control
          (Header → "Switch profile"), so signing in as someone else is
          unchanged. */}
      <div className="border-t border-slate-800 bg-slate-950/80 px-4 py-3">
        <div className="text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
          © {new Date().getFullYear()} Claude Aredjian
        </div>
        <div className="mt-1 text-center text-[11px] font-black tracking-wider text-amber-400">
          {APP_VERSION_LABEL}
        </div>
      </div>
    </aside>
    </>
  );
}
