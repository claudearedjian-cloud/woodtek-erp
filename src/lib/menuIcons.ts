// ============================================================================
// Icon picker palette — maps MENU_ICON_KEYS (allowlist in menuConfig.ts,
// validated server-side) to lucide components for the client UI.
// Client-only import: Sidebar, MenuDesignerView. Never import from server
// routes (keeps menuConfig.ts node-free for the API route).
// Every key here MUST exist in MENU_ICON_KEYS (render-test checks the sync).
// ============================================================================

import {
  Activity,
  AlertTriangle,
  Archive,
  Armchair,
  BarChart3,
  Banknote,
  Box,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Cpu,
  DoorOpen,
  Drill,
  ExternalLink,
  Factory,
  FileText,
  Forklift,
  Gauge,
  GanttChartSquare,
  Globe,
  Hammer,
  HardHat,
  Home,
  Import,
  Lamp,
  Layers,
  LayoutDashboard,
  LineChart,
  Link as LinkIcon,
  Package,
  PackageCheck,
  PaintRoller,
  Paintbrush,
  PenTool,
  PieChart,
  Receipt,
  Ruler,
  Scissors,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sofa,
  Sparkle,
  Star,
  Tablet,
  Tag,
  Target,
  Timer,
  Truck,
  Users,
  Warehouse,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { MenuSectionColor } from "@/lib/menuConfig";

export interface MenuIconChoice {
  key: string;
  label: string;
  Icon: LucideIcon;
}

// Built-in screens first (so "automatic" defaults stay reachable explicitly),
// then the generic palette in a sensible factory-ish order.
export const MENU_ICON_CHOICES: MenuIconChoice[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "wip", label: "Pulse", Icon: Activity },
  { key: "orders", label: "Clipboard", Icon: ClipboardList },
  { key: "recipes", label: "Workflow", Icon: Workflow },
  { key: "schedule", label: "Calendar", Icon: CalendarDays },
  { key: "gantt", label: "Timeline", Icon: GanttChartSquare },
  { key: "production", label: "Production", Icon: BarChart3 },
  { key: "machines", label: "Machine", Icon: Cpu },
  { key: "cmms", label: "Bolt", Icon: Zap },
  { key: "downtime", label: "Alert", Icon: AlertTriangle },
  { key: "quality", label: "Quality", Icon: ShieldCheck },
  { key: "workforce", label: "Shift clock", Icon: CalendarClock },
  { key: "hr", label: "HR & Payroll", Icon: Banknote },
  { key: "station", label: "Touchscreen", Icon: Tablet },
  { key: "customers", label: "People", Icon: Users },
  { key: "inventory", label: "Package", Icon: Package },
  { key: "purchasing", label: "Purchasing", Icon: Truck },
  { key: "invoicing", label: "Invoicing", Icon: Receipt },
  { key: "jobcosting", label: "Job costing", Icon: PieChart },
  { key: "warehouse", label: "Warehouse", Icon: Warehouse },
  { key: "reception", label: "Received", Icon: PackageCheck },
  { key: "pims", label: "Import", Icon: Import },
  { key: "reports", label: "Document", Icon: FileText },
  { key: "settings", label: "Gear", Icon: Settings },
  { key: "designer", label: "Sliders", Icon: SlidersHorizontal },
  { key: "plant", label: "Gauge", Icon: Gauge },
  { key: "assembly", label: "Assembly", Icon: Boxes },
  { key: "box", label: "Box", Icon: Box },
  { key: "boxes", label: "Boxes", Icon: Boxes },
  { key: "hammer", label: "Hammer", Icon: Hammer },
  { key: "wrench", label: "Wrench", Icon: Wrench },
  { key: "drill", label: "Drill", Icon: Drill },
  { key: "ruler", label: "Ruler", Icon: Ruler },
  { key: "scissors", label: "Scissors", Icon: Scissors },
  { key: "paint-roller", label: "Paint roller", Icon: PaintRoller },
  { key: "paintbrush", label: "Paintbrush", Icon: Paintbrush },
  { key: "armchair", label: "Armchair", Icon: Armchair },
  { key: "sofa", label: "Sofa", Icon: Sofa },
  { key: "lamp", label: "Lamp", Icon: Lamp },
  { key: "door-open", label: "Door", Icon: DoorOpen },
  { key: "forklift", label: "Forklift", Icon: Forklift },
  { key: "truck", label: "Truck", Icon: Truck },
  { key: "hard-hat", label: "Hard hat", Icon: HardHat },
  { key: "clipboard-check", label: "Checklist", Icon: ClipboardCheck },
  { key: "archive", label: "Archive", Icon: Archive },
  { key: "banknote", label: "Money", Icon: Banknote },
  { key: "receipt", label: "Receipt", Icon: Receipt },
  { key: "bar-chart", label: "Bar chart", Icon: BarChart3 },
  { key: "line-chart", label: "Line chart", Icon: LineChart },
  { key: "pie-chart", label: "Pie chart", Icon: PieChart },
  { key: "target", label: "Target", Icon: Target },
  { key: "timer", label: "Timer", Icon: Timer },
  { key: "clock", label: "Clock", Icon: Clock },
  { key: "shield", label: "Shield", Icon: ShieldCheck },
  { key: "star", label: "Star", Icon: Star },
  { key: "home", label: "Home", Icon: Home },
  { key: "building", label: "Building", Icon: Building2 },
  { key: "factory", label: "Factory", Icon: Factory },
  { key: "globe", label: "Globe", Icon: Globe },
  { key: "link", label: "Link", Icon: LinkIcon },
  { key: "tag", label: "Tag", Icon: Tag },
  { key: "pen-tool", label: "Pen tool", Icon: PenTool },
  { key: "sparkle", label: "Sparkle", Icon: Sparkle },
  { key: "external-link", label: "External link", Icon: ExternalLink },
  { key: "layers", label: "Layers", Icon: Layers },
];

const BY_KEY = new Map(MENU_ICON_CHOICES.map((c) => [c.key, c]));

export function iconChoice(key: string | undefined | null): MenuIconChoice | null {
  return (key && BY_KEY.get(key)) || null;
}

// Section-header colour bundles. Keys must stay in sync with
// MENU_SECTION_COLOR_KEYS in menuConfig.ts (render-test checks this). Every
// Tailwind class is a complete literal so production CSS keeps it.
export interface MenuSectionColorChoice {
  key: MenuSectionColor;
  label: string;
  headerClass: string;
  iconClass: string;
  swatchClass: string;
  borderClass: string;
}

export const MENU_SECTION_COLOR_CHOICES: MenuSectionColorChoice[] = [
  { key: "amber", label: "Amber", headerClass: "text-amber-400", iconClass: "text-amber-400", swatchClass: "bg-amber-400", borderClass: "border-amber-500/40" },
  { key: "sky", label: "Sky", headerClass: "text-sky-300", iconClass: "text-sky-300", swatchClass: "bg-sky-400", borderClass: "border-sky-500/40" },
  { key: "emerald", label: "Emerald", headerClass: "text-emerald-300", iconClass: "text-emerald-300", swatchClass: "bg-emerald-400", borderClass: "border-emerald-500/40" },
  { key: "rose", label: "Rose", headerClass: "text-rose-300", iconClass: "text-rose-300", swatchClass: "bg-rose-400", borderClass: "border-rose-500/40" },
  { key: "violet", label: "Violet", headerClass: "text-violet-300", iconClass: "text-violet-300", swatchClass: "bg-violet-400", borderClass: "border-violet-500/40" },
  { key: "slate", label: "Slate", headerClass: "text-slate-300", iconClass: "text-slate-300", swatchClass: "bg-slate-400", borderClass: "border-slate-600" },
];

const SECTION_COLOR_BY_KEY = new Map(
  MENU_SECTION_COLOR_CHOICES.map((choice) => [choice.key, choice]),
);

export function sectionColorChoice(
  key: string | undefined | null,
): MenuSectionColorChoice {
  return (key && SECTION_COLOR_BY_KEY.get(key as MenuSectionColor)) || MENU_SECTION_COLOR_CHOICES[0];
}
