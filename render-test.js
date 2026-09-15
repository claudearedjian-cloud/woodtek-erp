// Runtime check of the REAL Sidebar + menuConfig: transpile the actual
// component files (no re-implementation) and SSR-render them per role/config.
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

function compile(file, outName) {
  const src = fs.readFileSync(file, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const js = out
    .replace(/require\("@\/components\/([^"]+)"\)/g, 'require("./$1")')
    .replace(/require\("@\/lib\/([^"]+)"\)/g, 'require("../lib/$1")');
  const outPath = path.join(__dirname, "compiled", outName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, js);
}

compile("src/lib/moduleAccess.ts", "lib/moduleAccess.js");
compile("src/lib/machineCategories.ts", "lib/machineCategories.js");
compile("src/lib/permissions.ts", "lib/permissions.js");
compile("src/lib/menuConfig.ts", "lib/menuConfig.js");
compile("src/lib/menuIcons.ts", "lib/menuIcons.js");
compile("src/lib/bomDelivery.ts", "lib/bomDelivery.js");
compile("src/lib/downtimeReasons.ts", "lib/downtimeReasons.js");
compile("src/lib/digest.ts", "lib/digest.js");
compile("src/lib/clientStatement.ts", "lib/clientStatement.js");
compile("src/components/BrandMark.tsx", "components/BrandMark.js");
compile("src/components/Sidebar.tsx", "components/Sidebar.js");

const React = require("react");
const { renderToString } = require("react-dom/server");
const Sidebar = require("./compiled/components/Sidebar.js").default;

let fails = 0;
const check = (cond, name) => {
  console.log((cond ? "PASS" : "FAIL") + ": " + name);
  if (!cond) fails++;
};

const props = (role, menuConfig = null) => ({
  activeTab: "station",
  setActiveTab: () => {},
  currentUser: role
    ? { id: 1, name: "maroun rahme", role, avatarColor: "bg-teal-600" }
    : null,
  allUsers: [{ id: 2, name: "Claude Aredjian", role: "Manager", avatarColor: "bg-rose-600" }],
  onSwitchUser: () => {},
  onRequestSwitch: () => {},
  menuConfig,
  isOpen: true,
  onClose: () => {},
});

const op = renderToString(React.createElement(Sidebar, props("Machine Operator")));
const mgr = renderToString(React.createElement(Sidebar, props("Manager")));

const hiddenForOperator = [
  "Executive Dashboard",
  "Live WIP Board",
  "Orders &amp; Routing",
  "Downtime Log",
  "Wood &amp; Edge Stock",
  "Active Role Persona",
  "Menu Designer",
];
hiddenForOperator.forEach((l) => check(!op.includes(l), `operator hides "${l}"`));

["Operator Station Mode", "Scrap &amp; Rework", "Workforce &amp; Shifts", "Switch profile (PIN required)"].forEach((l) =>
  check(op.includes(l), `operator keeps "${l}"`),
);

["Executive Dashboard", "Live WIP Board", "Orders &amp; Routing", "Downtime Log", "Wood &amp; Edge Stock", "Active Role Persona", "Switch profile (PIN required)", "Menu Designer"].forEach((l) =>
  check(mgr.includes(l), `manager still sees "${l}"`),
);

check(!op.includes("Switch Operational Role"), "operator has no hover role-switcher popup");
check(mgr.includes("Switch Operational Role"), "manager keeps hover role-switcher popup");

// --- Manager defaults: plant modules grouped under General Settings ---
const tech = renderToString(React.createElement(Sidebar, props("Technician")));
const NEST = "border-l-2 border-slate-700/60";
check(mgr.includes(NEST), "manager renders nested settings group");
check(
  mgr.indexOf("General Settings") !== -1 && mgr.indexOf("General Settings") < mgr.indexOf("Routing Recipes"),
  "manager: group sits under General Settings",
);
["Routing Recipes", "Downtime Log", "Workforce &amp; Shifts", "PIMS Import", "Shop Floor Monitor"].forEach((l) =>
  check(mgr.includes(l), `manager group contains "${l}"`),
);

check(!tech.includes(NEST), "technician: no settings group (cannot open settings)");
check(tech.includes("Shop Floor Monitor"), "technician: grouped item promoted to top level");
check(!op.includes(NEST), "operator has no nested group");

// --- Menu Designer config overrides ---
const cfg = {
  version: 1,
  items: [
    { id: "reports", label: "Factory Reports", badge: "RPT", group: "top" },
    { id: "quality", label: "QA Corner", group: "settings" },
    { id: "dashboard", roles: { Manager: false } },
    { id: "wip", roles: { "Machine Operator": true } },
  ],
};
const mgrCfg = renderToString(React.createElement(Sidebar, props("Manager", cfg)));
const opCfg = renderToString(React.createElement(Sidebar, props("Machine Operator", cfg)));

check(mgrCfg.includes("Factory Reports"), "config: rename applied (manager)");
check(!mgrCfg.includes("Executive Dashboard"), "config: role override hides dashboard for manager");
check(mgrCfg.indexOf("Factory Reports") < mgrCfg.indexOf("Live WIP Board"), "config: reorder puts reports first");
check(mgrCfg.includes("QA Corner") && mgrCfg.indexOf("General Settings") < mgrCfg.indexOf("QA Corner"), "config: item moved into settings group");
check(opCfg.includes("Live WIP Board"), "config: override shows WIP for operator");
check(!opCfg.includes("Executive Dashboard"), "config: manager-only override does not leak to operator");
check(opCfg.includes("QA Corner"), "config: operator gets group-promoted moved item");

// ---- Warehouse & BOM module ----
const qa = renderToString(React.createElement(Sidebar, props("QA & Dispatch")));
check(mgr.includes("Warehouse &amp; BOM"), "manager sees Warehouse & BOM");
check(qa.includes("Warehouse &amp; BOM"), "QA & Dispatch sees Warehouse & BOM");
check(!op.includes("Warehouse &amp; BOM"), "operator does not see Warehouse & BOM");
check(!tech.includes("Warehouse &amp; BOM"), "technician does not see Warehouse & BOM");

// ---- custom roles (named aliases of built-in roles) ----
const perms = require("./compiled/lib/permissions.js");
const menuCfg = require("./compiled/lib/menuConfig.js");
perms.registerCustomRoles([
  { name: "Foreman", base: "Machine Operator" },
  { name: "Manager", base: "Technician" }, // collides with built-in -> must drop
  { name: "Ghost", base: "Nonexistent" },  // invalid base -> must drop
]);
check(perms.allRoles().includes("Foreman"), "custom role appears in allRoles()");
check(!perms.allRoles().includes("Ghost"), "invalid custom role is dropped");
check(perms.allRoles().filter((r) => r === "Manager").length === 1, "custom role cannot shadow a built-in name");
check(perms.baseRoleOf("Foreman") === "Machine Operator", "baseRoleOf maps custom -> base");
check(perms.baseRoleOf("Manager") === "Manager", "baseRoleOf leaves built-ins alone");
check(perms.can("Foreman", "users:manage") === false, "custom name has no direct matrix entry");
check(perms.can(perms.baseRoleOf("Foreman"), "operations:update-status") === true, "base role actions apply to custom role");

const fMenu = menuCfg.resolveMenu("Foreman", null);
const fIds = [...fMenu.top.map((i) => i.id), ...fMenu.settings.map((i) => i.id)];
check(fIds.includes("station"), "custom operator role sees Operator Station");
check(fIds.includes("quality"), "custom operator role sees Scrap & Rework");
check(!fIds.includes("orders"), "custom operator role cannot see Orders");

const hideStation = { version: 1, items: [{ id: "station", roles: { Foreman: false } }] };
const fMenu2 = menuCfg.resolveMenu("Foreman", hideStation);
check(![...fMenu2.top.map((i) => i.id), ...fMenu2.settings.map((i) => i.id)].includes("station"), "per-custom-role override hides station");
const oMenu = menuCfg.resolveMenu("Machine Operator", hideStation);
check([...oMenu.top.map((i) => i.id), ...oMenu.settings.map((i) => i.id)].includes("station"), "custom-role override does not leak to base role");

const foreman = renderToString(React.createElement(Sidebar, props("Foreman")));
check(foreman.includes("Operator Station Mode"), "Sidebar renders for custom role");
check(!foreman.includes("Orders &amp; Routing"), "Sidebar hides base-denied modules for custom role");

// ---- Menu Designer capacity upgrade: 60-char labels, 20-char badges, custom sections + custom entries ----
const LONG = "A".repeat(61);
const cfgCap = {
  version: 1,
  items: [
    { id: "custom-abc123", label: LONG, badge: "B".repeat(25), group: "Planning", custom: true, kind: "tab", target: "orders" },
    { id: "reports", group: "Planning" },
    { id: "schedule", group: "Planning" },
    { id: "custom-link1", label: "Open PIMS Portal", custom: true, kind: "link", target: "https://pims.example.com" },
    { id: "custom-bad1", label: "Evil", custom: true, kind: "link", target: "javascript:alert(1)" },
  ],
};
const capMenu = menuCfg.resolveMenu("Manager", cfgCap);
check(capMenu.sections.length === 1 && capMenu.sections[0].name === "Planning", "capacity: custom section resolved");
check(capMenu.sections[0].items.map((i) => i.id).join("|") === "custom-abc123|reports|schedule", "capacity: section keeps configured order");
check(capMenu.sections[0].items[0].label.length === 60, "capacity: label clamped to 60 chars");
check(capMenu.sections[0].items[0].badge.length === 20, "capacity: badge clamped to 20 chars");
check(capMenu.top.some((i) => i.id === "custom-link1" && i.kind === "link" && i.target === "https://pims.example.com"), "capacity: link entry resolves at top level");
check(capMenu.top.some((i) => i.id === "custom-bad1" && i.kind === "tab" && i.target === "dashboard"), "capacity: javascript: URL forced to safe dashboard tab");

const opCap = menuCfg.resolveMenu("Machine Operator", cfgCap);
check(!opCap.sections.some((s) => s.items.some((i) => i.id === "custom-abc123")), "capacity: custom entry hidden from operator by default");
check(!opCap.top.some((i) => i.id === "custom-link1"), "capacity: link entry hidden from operator by default");

const ss = menuCfg.sanitizeMenuConfig({ items: [
  { id: "custom-UPPER", label: "x" },
  { id: "orders", label: "   " + "P".repeat(65) + "   ", group: "  Planning  " },
  { id: "custom-ok1", label: "", custom: true, kind: "link", target: "http://ok.example.com/a" },
]});
check(!ss.items.some((i) => i.id === "custom-UPPER"), "capacity sanitize: invalid custom id dropped");
const sOrd = ss.items.find((i) => i.id === "orders");
check(!!sOrd && sOrd.label.length === 60 && sOrd.group === "Planning", "capacity sanitize: label trimmed+clamped, group trimmed");
const sOk = ss.items.find((i) => i.id === "custom-ok1");
check(!!sOk && sOk.label === "New menu item" && sOk.custom === true && sOk.kind === "link" && sOk.target === "http://ok.example.com/a", "capacity sanitize: blank custom label defaults, http link kept");

const mgrCapSsr = renderToString(React.createElement(Sidebar, props("Manager", cfgCap)));
check(mgrCapSsr.includes(">Planning<"), "capacity SSR: sidebar renders custom section header");
check(mgrCapSsr.includes("A".repeat(60)), "capacity SSR: 60-char label shown");
check(mgrCapSsr.includes("https://pims.example.com") && mgrCapSsr.includes('target="_blank"'), "capacity SSR: link entry renders as new-tab anchor");

// ---- Landing tabs, icon picker, section icons ----
const iconsMod = require("./compiled/lib/menuIcons.js");
const iconKeySet = new Set(menuCfg.MENU_ICON_KEYS);
const choiceKeySet = new Set(iconsMod.MENU_ICON_CHOICES.map((c) => c.key));
check(
  iconKeySet.size === menuCfg.MENU_ICON_KEYS.length &&
    [...iconKeySet].every((k) => choiceKeySet.has(k)) &&
    choiceKeySet.size === iconsMod.MENU_ICON_CHOICES.length,
  "icons: MENU_ICON_KEYS and MENU_ICON_CHOICES are in sync (no dupes)",
);

const cfgNav = {
  version: 1,
  items: [
    { id: "quality", icon: "hammer", group: "Planning" },
    { id: "reports", icon: "not-an-icon" },
    { id: "custom-ico1", label: "Board", custom: true, kind: "tab", target: "wip", icon: "boxes" },
  ],
  landing: {
    Manager: "reports",
    "Machine Operator": "orders", // operator cannot open orders -> must drop
    "Ghost Role": "dashboard",     // unknown role -> must drop
  },
  sectionIcons: { Planning: "target", top: "hammer" },
};
const sanNav = menuCfg.sanitizeMenuConfig(cfgNav);
check(sanNav.items.find((i) => i.id === "quality").icon === "hammer", "icons sanitize: valid icon kept");
check(!sanNav.items.find((i) => i.id === "reports").icon, "icons sanitize: unknown icon dropped");
check(sanNav.items.find((i) => i.id === "custom-ico1").icon === "boxes", "icons sanitize: custom entry icon kept");
check(sanNav.landing && sanNav.landing.Manager === "reports", "landing sanitize: allowed role+tab kept");
check(!sanNav.landing || !sanNav.landing["Machine Operator"], "landing sanitize: tab the role cannot open dropped");
check(!sanNav.landing || !sanNav.landing["Ghost Role"], "landing sanitize: unknown role dropped");
check(sanNav.sectionIcons && sanNav.sectionIcons.Planning === "target", "sectionIcons sanitize: valid kept");
check(!sanNav.sectionIcons || !sanNav.sectionIcons.top, "sectionIcons sanitize: reserved name dropped");

check(menuCfg.getLandingTab("Manager", sanNav) === "reports", "landing: configured tab returned for manager");
check(menuCfg.getLandingTab("Manager", null) === null, "landing: no config -> null (factory behaviour)");
check(menuCfg.getLandingTab("Machine Operator", { version: 1, items: [], landing: { "Machine Operator": "orders" } }) === null, "landing: hand-edited forbidden tab refused at read time");

const resNav = menuCfg.resolveMenu("Manager", sanNav);
check(resNav.sections.length === 1 && resNav.sections[0].icon === "target", "icons: section header icon resolved");
check(resNav.top.concat(...resNav.sections.map((s) => s.items)).find((i) => i.id === "quality").icon === "hammer", "icons: item icon resolved");
const ssrNav = renderToString(React.createElement(Sidebar, props("Manager", sanNav)));
check(ssrNav.includes("Board"), "icons SSR: sidebar renders with pinned icons (no crash)");

// ---- partial BOM delivery helpers ----
const bd = require("./compiled/lib/bomDelivery.js");
check(bd.clampDeliveredQty("7", 10) === 7, "bomDelivery: numeric string clamped to line qty range");
check(bd.clampDeliveredQty(99, 10) === 10, "bomDelivery: over-qty clamped down to line qty");
check(bd.clampDeliveredQty(-3, 10) === 0, "bomDelivery: negative floored to 0");
check(bd.clampDeliveredQty("abc", 10) === 0, "bomDelivery: garbage floored to 0");
check(bd.sentQty({ status: "Delivered", quantityUsed: 10, deliveredQty: null }) === 10, "bomDelivery: Delivered line is fully sent");
check(bd.sentQty({ status: "Prepared", quantityUsed: 10, deliveredQty: 4 }) === 4, "bomDelivery: partial Prepared line reports its tally");
check(bd.sentQty({ status: "Prepared", quantityUsed: 10 }) === 0, "bomDelivery: Prepared without tally = 0 sent");
check(bd.statusAfterPartial(10, 10) === "Delivered" && bd.statusAfterPartial(4, 10) === "Prepared", "bomDelivery: status flips to Delivered only at full qty");

// ---- downtime reason codes + Pareto ----
const dr = require("./compiled/lib/downtimeReasons.js");
check(dr.normalizeReason("mechanical failure") === "Mechanical Failure", "downtime: exact match is case-insensitive");
check(dr.normalizeReason("hydraulic leak on spindle") === "Mechanical Failure", "downtime: legacy free text buckets mechanically");
check(dr.normalizeReason("no material for panels") === "Material Shortage", "downtime: material wording buckets correctly");
check(dr.normalizeReason("cable short") === "Electrical Fault", "downtime: electrical wording buckets correctly");
check(dr.normalizeReason("weird one-off note") === "Other", "downtime: unmatched text falls to Other");
check(dr.normalizeReason("") === "Other", "downtime: empty reason falls to Other");
const now = new Date("2026-09-14T12:00:00Z");
const dEvents = [
  { reason: "Mechanical Failure", durationMinutes: 120, startedAt: "2026-09-13T10:00:00Z" },
  { reason: "Mechanical Failure", durationMinutes: 60, startedAt: "2026-09-12T10:00:00Z" },
  { reason: "Electrical Fault", durationMinutes: 30, startedAt: "2026-09-10T10:00:00Z" },
  { reason: "Quality Issue", durationMinutes: 10, startedAt: "2026-09-01T10:00:00Z" },
  { reason: "Mechanical Failure", durationMinutes: null, startedAt: "2026-09-14T11:00:00Z", endedAt: null }, // open, running 60m
  { reason: "Other", durationMinutes: 5, startedAt: "2026-06-01T10:00:00Z" }, // outside 30d window
];
const p30 = dr.buildPareto(dEvents, 30, now);
check(p30.totalEvents === 5 && p30.totalMinutes === 280, "downtime pareto: window filters + open event counts running time");
check(p30.rows[0].reason === "Mechanical Failure" && p30.rows[0].minutes === 240, "downtime pareto: sorted by minutes desc");
check(p30.rows[0].band === "A" && p30.rows[0].cumulative === Math.round((240 / 280) * 1000) / 10, "downtime pareto: biggest cause is band A with correct cumulative");
check(p30.rows.every((r, i) => (i === 0 ? r.band === "A" : r.band === "B")), "downtime pareto: cause crossing the 80% line stays band A, the rest are B");
check(p30.rows.every((r) => r.share + r.events > 0), "downtime pareto: rows carry share + counts");
const pAll = dr.buildPareto(dEvents, null, now);
check(pAll.totalEvents === 6, "downtime pareto: all-time window includes old events");
const csv = dr.paretoToCsv(p30);
check(csv.startsWith("Reason,Events,DowntimeMinutes") && csv.includes("TOTAL,5,280"), "downtime pareto: CSV has header + totals row");
const emptyP = dr.buildPareto([], 30, now);
check(emptyP.rows.length === 0 && emptyP.totalMinutes === 0, "downtime pareto: no events -> empty rows (no crash)");

// ---- daily digest formatting ----
const dg = require("./compiled/lib/digest.js");
const fakeDigest = {
  date: "2026-09-14T06:00:00.000Z",
  overdue: [{ id: 1, orderNumber: "PO-0007/2026", title: "Wardrobe", customerCompany: "ACME", daysLate: 5 }],
  dueSoon: [],
  materials: [{ orderId: 2, orderNumber: "PO-0009/2026", title: "Desk", state: "Declined" }],
  warehousePending: [{ orderId: 3, orderNumber: "PO-0010/2026", title: null, pending: 2, total: 5 }],
  machinesDown: [{ code: "BEAM-01", name: "Beam saw", reason: "Mechanical Failure", minutes: 95 }],
  serviceDue: [{ assetTag: "GEN-01", name: "Generator", interval: 250, pastBy: 40 }],
  awaitingDelivery: [{ id: 4, orderNumber: "PO-0002/2026", title: "Chairs" }],
  lowStock: [{ name: "MDF 18mm", qty: 2, unit: "sheet", reorderLevel: 5 }],
};
const dLines = dg.digestToLines(fakeDigest, 8);
check(dLines.some((l) => l === "OVERDUE ORDERS (1)"), "digest: section headers carry counts");
check(dLines.some((l) => l === "  PO-0007/2026 \u00b7 Wardrobe \u00b7 ACME \u00b7 5d late"), "digest: order detail line with days late");
check(dLines.some((l) => l.includes("DUE WITHIN 7 DAYS: none")), "digest: empty sections say none");
check(dLines.some((l) => l.includes("BEAM-01") && l.includes("1h 35m")), "digest: downtime line formats hours+minutes");
check(dLines.filter((l) => !l.startsWith("  ")).length === 8, "digest: exactly 8 section headers");
const capped = dg.digestToLines({ ...fakeDigest, overdue: Array.from({ length: 12 }, (_, i) => ({ id: i, orderNumber: `PO-${i}` })) }, 8);
check(capped.some((l) => l.includes("…and 4 more")), "digest: long sections are capped with a trailing count");
check(dg.digestTotalIssues(fakeDigest) === 1 + 1 + 1 + 1 + 1, "digest: total issues counts the 5 attention sections");
check(dg.digestToLines(dg.EMPTY_DIGEST).every((l) => l.endsWith(": none")), "digest: empty digest renders all-none");

// ---- client statement builder ----
const cs = require("./compiled/lib/clientStatement.js");
const st = cs.buildStatement([
  { type: "invoice", amount: 1000, reference: "INV-1", at: "2026-09-02T10:00:00Z" },
  { type: "payment", amount: "400", reference: "CHK-9", at: "2026-09-05T10:00:00Z" },
  { type: "invoice", amount: 250.5, reference: "INV-2", at: "2026-09-01T10:00:00Z" }, // out of order on purpose
]);
check(st.rows.length === 3, "statement: all entries become rows");
check(new Date(st.rows[0].at).getDate() === 1, "statement: rows sorted chronologically");
check(st.rows[0].balance === 250.5 && st.rows[1].balance === 1250.5 && st.rows[2].balance === 850.5, "statement: running balance correct (invoice +, payment -)");
check(st.invoiced === 1250.5 && st.paid === 400 && st.balance === 850.5, "statement: totals correct");
check(st.rows[2].invoiced === 0 && st.rows[2].paid === 400, "statement: payment rows carry no invoiced amount");
check(cs.buildStatement([]).balance === 0 && cs.buildStatement([]).rows.length === 0, "statement: empty ledger is safe");
const neg = cs.buildStatement([{ type: "invoice", amount: -50, at: "2026-09-01T00:00:00Z" }]);
check(neg.invoiced === 50, "statement: negative amounts clamp to positive");

// ---- machine categories helpers ----
const mc = require("./compiled/lib/machineCategories.js");
const cats = mc.sanitizeCategories(["  Beam Saw ", "beam saw", "CNC", "", null, 42, "x".repeat(60)]);
check(cats.length === 4 && cats.includes("42"), "sanitizeCategories trims + dedupes case-insensitively + drops empties (42 coerces to a name)");
check(cats[0] === "Beam Saw" && cats[3].length === 40, "sanitizeCategories keeps first casing + clamps to 40 chars");
check(mc.sanitizeCategories("not-a-list").length === 0, "sanitizeCategories rejects non-arrays");
const m1 = { id: 3 }, m2 = { id: 1 }, m3 = { id: 2 };
check(mc.chooseFreestMachine([m1, m2, m3], { 3: 5, 1: 2, 2: 7 }).id === 1, "chooseFreestMachine picks lowest load");
check(mc.chooseFreestMachine([m1, m2], { 3: 4, 1: 4 }).id === 1, "chooseFreestMachine tie-breaks by id");
check(mc.chooseFreestMachine([], {}) === null, "chooseFreestMachine handles empty list");
check(mc.chooseFreestMachine([m3], {}).id === 2, "chooseFreestMachine treats unknown load as zero");

// ---- custom role with explicit screen allowlist ----
perms.registerCustomRoles([
  { name: "Foreman", base: "Machine Operator" },
  { name: "WH Super", base: "QA & Dispatch", modules: ["warehouse"] },
]);
check(perms.getCustomRoles().find((r) => r.name === "WH Super").modules.length === 1, "role allowlist survives sanitising");
const whr = renderToString(React.createElement(Sidebar, props("WH Super")));
check(whr.includes("Warehouse &amp; BOM"), "restricted role sees its allowlisted screen");
check(!whr.includes("Scrap &amp; Rework"), "restricted role loses base screens (quality)");
check(!whr.includes("Live WIP Board"), "restricted role loses WIP");
check(!whr.includes("Executive Dashboard"), "restricted role loses dashboard");

console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
process.exitCode = fails === 0 ? 0 : 1;
