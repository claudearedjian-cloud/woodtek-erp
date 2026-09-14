"use strict";
// ============================================================================
// Icon picker palette — maps MENU_ICON_KEYS (allowlist in menuConfig.ts,
// validated server-side) to lucide components for the client UI.
// Client-only import: Sidebar, MenuDesignerView. Never import from server
// routes (keeps menuConfig.ts node-free for the API route).
// Every key here MUST exist in MENU_ICON_KEYS (render-test checks the sync).
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENU_ICON_CHOICES = void 0;
exports.iconChoice = iconChoice;
const lucide_react_1 = require("lucide-react");
// Built-in screens first (so "automatic" defaults stay reachable explicitly),
// then the generic palette in a sensible factory-ish order.
exports.MENU_ICON_CHOICES = [
    { key: "dashboard", label: "Dashboard", Icon: lucide_react_1.LayoutDashboard },
    { key: "wip", label: "Pulse", Icon: lucide_react_1.Activity },
    { key: "orders", label: "Clipboard", Icon: lucide_react_1.ClipboardList },
    { key: "recipes", label: "Workflow", Icon: lucide_react_1.Workflow },
    { key: "schedule", label: "Calendar", Icon: lucide_react_1.CalendarDays },
    { key: "gantt", label: "Timeline", Icon: lucide_react_1.GanttChartSquare },
    { key: "machines", label: "Machine", Icon: lucide_react_1.Cpu },
    { key: "cmms", label: "Bolt", Icon: lucide_react_1.Zap },
    { key: "downtime", label: "Alert", Icon: lucide_react_1.AlertTriangle },
    { key: "quality", label: "Quality", Icon: lucide_react_1.ShieldCheck },
    { key: "workforce", label: "Shift clock", Icon: lucide_react_1.CalendarClock },
    { key: "station", label: "Touchscreen", Icon: lucide_react_1.Tablet },
    { key: "customers", label: "People", Icon: lucide_react_1.Users },
    { key: "inventory", label: "Package", Icon: lucide_react_1.Package },
    { key: "warehouse", label: "Warehouse", Icon: lucide_react_1.Warehouse },
    { key: "reception", label: "Received", Icon: lucide_react_1.PackageCheck },
    { key: "pims", label: "Import", Icon: lucide_react_1.Import },
    { key: "reports", label: "Document", Icon: lucide_react_1.FileText },
    { key: "settings", label: "Gear", Icon: lucide_react_1.Settings },
    { key: "designer", label: "Sliders", Icon: lucide_react_1.SlidersHorizontal },
    { key: "plant", label: "Gauge", Icon: lucide_react_1.Gauge },
    { key: "box", label: "Box", Icon: lucide_react_1.Box },
    { key: "boxes", label: "Boxes", Icon: lucide_react_1.Boxes },
    { key: "hammer", label: "Hammer", Icon: lucide_react_1.Hammer },
    { key: "wrench", label: "Wrench", Icon: lucide_react_1.Wrench },
    { key: "drill", label: "Drill", Icon: lucide_react_1.Drill },
    { key: "ruler", label: "Ruler", Icon: lucide_react_1.Ruler },
    { key: "scissors", label: "Scissors", Icon: lucide_react_1.Scissors },
    { key: "paint-roller", label: "Paint roller", Icon: lucide_react_1.PaintRoller },
    { key: "paintbrush", label: "Paintbrush", Icon: lucide_react_1.Paintbrush },
    { key: "armchair", label: "Armchair", Icon: lucide_react_1.Armchair },
    { key: "sofa", label: "Sofa", Icon: lucide_react_1.Sofa },
    { key: "lamp", label: "Lamp", Icon: lucide_react_1.Lamp },
    { key: "door-open", label: "Door", Icon: lucide_react_1.DoorOpen },
    { key: "forklift", label: "Forklift", Icon: lucide_react_1.Forklift },
    { key: "truck", label: "Truck", Icon: lucide_react_1.Truck },
    { key: "hard-hat", label: "Hard hat", Icon: lucide_react_1.HardHat },
    { key: "clipboard-check", label: "Checklist", Icon: lucide_react_1.ClipboardCheck },
    { key: "archive", label: "Archive", Icon: lucide_react_1.Archive },
    { key: "banknote", label: "Money", Icon: lucide_react_1.Banknote },
    { key: "receipt", label: "Receipt", Icon: lucide_react_1.Receipt },
    { key: "bar-chart", label: "Bar chart", Icon: lucide_react_1.BarChart3 },
    { key: "line-chart", label: "Line chart", Icon: lucide_react_1.LineChart },
    { key: "pie-chart", label: "Pie chart", Icon: lucide_react_1.PieChart },
    { key: "target", label: "Target", Icon: lucide_react_1.Target },
    { key: "timer", label: "Timer", Icon: lucide_react_1.Timer },
    { key: "clock", label: "Clock", Icon: lucide_react_1.Clock },
    { key: "shield", label: "Shield", Icon: lucide_react_1.ShieldCheck },
    { key: "star", label: "Star", Icon: lucide_react_1.Star },
    { key: "home", label: "Home", Icon: lucide_react_1.Home },
    { key: "building", label: "Building", Icon: lucide_react_1.Building2 },
    { key: "factory", label: "Factory", Icon: lucide_react_1.Factory },
    { key: "globe", label: "Globe", Icon: lucide_react_1.Globe },
    { key: "link", label: "Link", Icon: lucide_react_1.Link },
    { key: "tag", label: "Tag", Icon: lucide_react_1.Tag },
    { key: "pen-tool", label: "Pen tool", Icon: lucide_react_1.PenTool },
    { key: "sparkle", label: "Sparkle", Icon: lucide_react_1.Sparkle },
    { key: "external-link", label: "External link", Icon: lucide_react_1.ExternalLink },
    { key: "layers", label: "Layers", Icon: lucide_react_1.Layers },
];
const BY_KEY = new Map(exports.MENU_ICON_CHOICES.map((c) => [c.key, c]));
function iconChoice(key) {
    return (key && BY_KEY.get(key)) || null;
}
