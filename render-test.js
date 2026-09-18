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
compile("src/lib/audit.server.ts", "lib/audit.server.js");
compile("src/lib/i18n.ts", "lib/i18n.js");
compile("src/lib/idle.ts", "lib/idle.js");
compile("src/lib/bomKits.ts", "lib/bomKits.js");
compile("src/lib/packingQc.ts", "lib/packingQc.js");
compile("src/lib/orderArchive.ts", "lib/orderArchive.js");
compile("src/lib/deliveryPhotos.ts", "lib/deliveryPhotos.js");
compile("src/lib/dispatch.ts", "lib/dispatch.js");
compile("src/lib/dispatchScheduling.ts", "lib/dispatchScheduling.js");
compile("src/lib/operationMachineCandidates.ts", "lib/operationMachineCandidates.js");
compile("src/lib/wallboard.ts", "lib/wallboard.js");
compile("src/lib/jobLock.ts", "lib/jobLock.js");
compile("src/lib/stationAssignment.ts", "lib/stationAssignment.js");
compile("src/lib/inventoryImport.ts", "lib/inventoryImport.js");
compile("src/lib/materialProgress.ts", "lib/materialProgress.js");
compile("src/lib/materialRoutes.ts", "lib/materialRoutes.js");
compile("src/lib/productionPlan.ts", "lib/productionPlan.js");
compile("src/lib/projectTypes.ts", "lib/projectTypes.js");
compile("src/components/BrandMark.tsx", "components/BrandMark.js");
compile("src/components/Sidebar.tsx", "components/Sidebar.js");
compile("src/components/NewOrderWizard.tsx", "components/NewOrderWizard.js");
compile("src/components/MachineDowntimeLoginAlert.tsx", "components/MachineDowntimeLoginAlert.js");

const React = require("react");
const { renderToString } = require("react-dom/server");
const Sidebar = require("./compiled/components/Sidebar.js").default;
const NewOrderWizard = require("./compiled/components/NewOrderWizard.js").default;
const MachineDowntimeLoginAlert = require("./compiled/components/MachineDowntimeLoginAlert.js").default;

let fails = 0;
const check = (cond, name) => {
  console.log((cond ? "PASS" : "FAIL") + ": " + name);
  if (!cond) fails++;
};

// ---- performance architecture regressions ----
const pageSource = fs.readFileSync("src/app/page.tsx", "utf8");
const stationSource = fs.readFileSync("src/components/OperatorStationView.tsx", "utf8");
const machineMonitorSource = fs.readFileSync("src/components/MachinesView.tsx", "utf8");
const inventoryViewSource = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
const inventoryImportApiSource = fs.readFileSync("src/app/api/inventory/import/route.ts", "utf8");
const inventoryImportServerSource = fs.readFileSync("src/lib/inventoryImport.server.ts", "utf8");
const operationsSource = fs.readFileSync("src/app/api/operations/route.ts", "utf8");
const operationActionSource = fs.readFileSync("src/app/api/operations/[id]/route.ts", "utf8");
const machinesSource = fs.readFileSync("src/app/api/machines/route.ts", "utf8");
const machineActionSource = fs.readFileSync("src/app/api/machines/[id]/route.ts", "utf8");
const machineCrewStoreSource = fs.readFileSync("src/lib/machineOperators.server.ts", "utf8");
const dashboardSource = fs.readFileSync("src/components/DashboardView.tsx", "utf8");
const dashboardApiSource = fs.readFileSync("src/app/api/dashboard/route.ts", "utf8");
const orderDeleteSource = fs.readFileSync("src/app/api/orders/[id]/route.ts", "utf8");
const seedSource = fs.readFileSync("src/app/api/seed/route.ts", "utf8");
const newOrderSource = fs.readFileSync("src/components/NewOrderWizard.tsx", "utf8");
const orderCreateSource = fs.readFileSync("src/app/api/orders/route.ts", "utf8");
const dispatchApiSource = fs.readFileSync("src/app/api/dispatch/route.ts", "utf8");
const autoScheduleApiSource = fs.readFileSync("src/app/api/operations/auto-schedule/route.ts", "utf8");
const dispatchSchedulingServerSource = fs.readFileSync("src/lib/dispatchScheduling.server.ts", "utf8");
const scheduleSource = fs.readFileSync("src/components/ScheduleView.tsx", "utf8");
const dataAccessSource = fs.readFileSync("src/lib/dataAccess.ts", "utf8");
const orderWorkflowSource = fs.readFileSync("src/components/OrderWorkflowDetail.tsx", "utf8");
const ordersViewSource = fs.readFileSync("src/components/OrdersView.tsx", "utf8");
const packingApiSource = fs.readFileSync("src/app/api/packing-qc/route.ts", "utf8");
const deliveryPhotoApiSource = fs.readFileSync("src/app/api/delivery-photos/route.ts", "utf8");
check(pageSource.includes("dynamic(() => import(\"@/components/OperatorStationView\")"), "performance: application workspaces are code-split");
check(!pageSource.includes("onRefresh={fetchAllData}"), "performance: actions never launch the whole-app refresh flood");
check(pageSource.includes("compactStation ? Promise.resolve(null)"), "performance: locked Operator login skips unrelated administration datasets");
check(stationSource.includes("activeOnly=true&station=true") && !stationSource.includes("fetchBomBoard"), "performance: station queue carries its lightweight BOM data in one payload");
check(stationSource.includes("queueInFlight.current") && stationSource.includes("visibilityState"), "performance: station polling prevents overlap and pauses while hidden");
check((stationSource.match(/<ElapsedTimer/g) || []).length === 1, "performance: each running station job owns only one live timer");
check(operationsSource.includes("listOperationsForUser(user") && operationsSource.includes("statuses: activeOnly ? activeStatuses"), "performance: operation filtering stays scoped and runs in SQL");
check(operationActionSource.includes("One compact order snapshot") && !operationActionSource.includes("Re-read after readiness"), "performance: station action avoids duplicate full-order reads");
check(machinesSource.includes("summaryOnly") && machinesSource.includes("operationsByMachine"), "performance: machine summaries avoid repeated scans and queue payloads");
check(
  pageSource.includes("/api/downtime?activeOnly=true")
    && pageSource.includes('user.role === "Manager"')
    && pageSource.includes("<MachineDowntimeLoginAlert"),
  "manager login: dedicated active-downtime check drives the warning prompt",
);

// ---- bundle 27: batch Dispatch + candidate claim + live station crew ----
check(
  orderCreateSource.includes("ensureDispatchBatches")
    && orderCreateSource.includes("created.createdMaterials.map")
    && dispatchApiSource.includes("dispatchBatchKey(material.id)"),
  "batch dispatch: every material allocation receives a Dispatch identity at order creation",
);
check(
  dispatchApiSource.includes("batchProductionReady")
    && dispatchApiSource.includes("allCurrentBatchesDelivered")
    && dispatchApiSource.includes("parentDelivered"),
  "batch dispatch: production gate and all-sibling parent roll-up are server enforced",
);
check(
  scheduleSource.includes("Mark batch delivered")
    && scheduleSource.includes("Order batches:")
    && scheduleSource.includes("batchId: proofFor.batchId"),
  "batch dispatch: UI delivers one named batch and shows sibling progress",
);
check(
  ordersViewSource.includes("Batch-aware Dispatch summary")
    && ordersViewSource.includes("Mixed stages")
    && ordersViewSource.includes(".delivered}/{dispatchByOrder"),
  "batch dispatch: Orders view aggregates mixed sibling stages instead of overwriting by order id",
);
check(
  packingApiSource.includes("batchChecks")
    && deliveryPhotoApiSource.includes("meta.batches")
    && scheduleSource.includes("This material batch has its own packing QC checklist"),
  "batch dispatch: QC and delivery photos remain independent per batch",
);
check(
  operationActionSource.includes("const claimWhere = firstStartClaim || compareWaitingAssignment")
    && operationActionSource.includes("eq(orderOperations.status, currentOp.status)")
    && operationActionSource.includes("eq(orderOperations.machineId, currentOp.machineId)")
    && operationActionSource.includes("Another station claimed this operation first"),
  "candidate claim concurrency: first Start uses a database compare-and-set and losers receive 409",
);
check(
  operationsSource.includes("candidateMachineIds")
    && dataAccessSource.includes("candidateOperationIdsForMachine")
    && dataAccessSource.includes("CANDIDATE_CLAIMABLE_STATUSES"),
  "candidate queues: every selected station can see the waiting operation only before claim",
);
check(
  stationSource.includes("stationMachineId: selectedMachineId")
    && orderWorkflowSource.includes("candidateMachineIds")
    && orderWorkflowSource.includes("First Start claims one"),
  "candidate stations: discoverable multi-select UI sends the actual station on Start",
);
check(
  stationSource.includes('/api/machines?summary=true')
    && stationSource.includes("assignmentStateRef")
    && stationSource.includes("reconcileStationSelection")
    && dataAccessSource.includes("crewMachineIds.length > 0"),
  "station crew refresh: secondary/reassigned operators reconcile the complete assignment set",
);
check(
  stationSource.includes("setInterval(refreshMachineRoster, 3000)")
    && stationSource.includes("woodtek:machine-crew-updated")
    && machineMonitorSource.includes("announceMachineCrewUpdate"),
  "station crew refresh: short cross-device poll plus immediate browser signal replaces hard refresh",
);
check(
  machinesSource.includes("assignedOperatorId: crewIds[0] ?? null")
    && machinesSource.includes("assignedOperatorIds: crewIds")
    && machineActionSource.includes("assignedOperatorIds: effectiveCrew")
    && machineCrewStoreSource.includes("fs.renameSync(temporary, file)"),
  "station crew persistence: create/update responses mirror primary and full crew through an atomic overlay write",
);

// ---- issued-order automatic production Dispatch slots ----
check(
  (orderCreateSource.match(/scheduleIssuedOrder\(/g) || []).length >= 3
    && orderCreateSource.includes("dispatchScheduling,")
    && orderCreateSource.includes("Dispatch slot(s) booked"),
  "dispatch issue: both material-plan and legacy order creation auto-book real operation slots",
);
check(
  autoScheduleApiSource.includes("autoScheduleDispatchSlots")
    && dispatchSchedulingServerSource.includes("pg_advisory_xact_lock(874221902)")
    && operationActionSource.includes("lockDispatchSchedule(tx)"),
  "dispatch scheduling: issue, backlog auto-plan and manual edits share one database lock",
);
check(
  dispatchSchedulingServerSource.includes("isNull(orderOperations.scheduledStart)")
    && dispatchSchedulingServerSource.includes("expectedMachine")
    && dispatchSchedulingServerSource.includes("operation changed while its slot was being booked"),
  "dispatch scheduling: automatic writes compare the waiting snapshot instead of overwriting Start/reassignment",
);
check(
  orderCreateSource.includes("ensureLegacyDispatchOrder")
    && dispatchApiSource.includes("Orders intentionally issued without a material/cut-list")
    && dispatchApiSource.includes("Order-level slot (no material batch)"),
  "dispatch issue: an order without material rows still reserves an immediate production-blocked delivery row",
);
check(
  newOrderSource.includes("Issue Order & Auto-book Dispatch")
    && scheduleSource.includes("Automatic slot exceptions")
    && scheduleSource.includes("operation.productionItem.batchNumber")
    && ordersViewSource.includes("Machine slots:"),
  "dispatch issue: automatic booking and per-batch slot identity are visible in the UI",
);

// ---- dashboard batch labels + clean deletion regressions ----
check(
  dashboardApiSource.includes("productionBatchNumber: binding?.batchNumber")
    && dashboardApiSource.includes("productionBatchName: binding?.item.name"),
  "dashboard: API attaches stable production-batch identity to each live job",
);
check(
  dashboardSource.includes("BATCH {job.productionBatchNumber}")
    && dashboardSource.includes("job.productionBatchName"),
  "dashboard: live feed prints BATCH N beside the order number",
);
check(
  orderDeleteSource.includes("clearDeletedOrderRuntimeState")
    && orderDeleteSource.includes("materialRows.map((row) => row.id)"),
  "order deletion: relational delete also clears every per-order/per-material overlay",
);
check(
  seedSource.indexOf("if (!force)") < seedSource.indexOf("await db.delete(orderMaterials)")
    && seedSource.includes("Automatic demo seeding was skipped"),
  "demo seed: an initialized database cannot refill an intentionally empty orders table",
);
check(
  newOrderSource.includes("if (Array.isArray(projectData.types))")
    && !newOrderSource.includes("new Set([...projectTypes, projectType])"),
  "new order: an intentionally empty/deleted project-category list stays empty",
);

// ---- Manager login machine-downtime warning ----
const downtimeWarning = renderToString(React.createElement(MachineDowntimeLoginAlert, {
  events: [
    { id: 1, machineCode: "BEAM-01", machineName: "Beam Saw", reason: "Mechanical Failure", startedAt: "2026-09-17T08:00:00Z", orderNumber: "PO-0042/2026", operatorName: "Maroun", notes: "Clamp fault", endedAt: null },
    { id: 2, machineCode: "OLD-01", machineName: "Old event", reason: "Closed", startedAt: "2026-09-16T08:00:00Z", endedAt: "2026-09-16T09:00:00Z" },
  ],
  onAcknowledge: () => {},
  onOpenDowntime: () => {},
}));
check(downtimeWarning.includes("MACHINE DOWNTIME WARNING") && downtimeWarning.includes("machine is") && downtimeWarning.includes("currently marked down"), "manager login warning: active count and critical heading render");
check(downtimeWarning.includes("BEAM-01") && downtimeWarning.includes("Mechanical Failure") && downtimeWarning.includes("Open Downtime Log") && !downtimeWarning.includes("OLD-01"), "manager login warning: live machine details + action render, closed events stay hidden");
check(renderToString(React.createElement(MachineDowntimeLoginAlert, { events: [], onAcknowledge: () => {}, onOpenDowntime: () => {} })) === "", "manager login warning: no down machine means no prompt");

const props = (role, menuConfig = null, lang) => ({
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
  lang,
});

const wizard = renderToString(React.createElement(NewOrderWizard, {
  open: true,
  onClose: () => {},
  onCreated: () => {},
  customers: [{ id: 1, company: "Test Joinery", name: "Owner" }],
  templates: [{ id: 9, name: "Saw + Press + Saw", defaultStepsJson: [
    { stepOrder: 1, operationName: "First Saw", machineCategory: "Beam Saw", estimatedMinutes: 60 },
    { stepOrder: 2, operationName: "Press", machineCategory: "Press", estimatedMinutes: 90 },
    { stepOrder: 3, operationName: "Second Saw", machineCategory: "Beam Saw", estimatedMinutes: 45 },
  ] }],
  machines: [{ id: 1, code: "BEAM-01", name: "Beam Saw", category: "Beam Saw" }],
  inventoryItems: [{ id: 1, name: "Oak MDF", sku: "MDF-01", stockQuantity: 10, unit: "sheets" }],
  currentUser: { role: "Manager" },
}));
check(wizard.includes("Production Order Builder"), "new order v2: wide production builder renders");
check(wizard.includes("Default route") && wizard.includes("Material jobs") && wizard.includes("Review"), "new order v2: four explicit planning stages render");
check(wizard.includes("Each named material batch receives its own complete, independent machine job chain"), "new order v2: independent-job rule is visible");
check(!wizard.includes("Order Routing (default)"), "new order v2: conflicting legacy order-routing tab is gone");

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
  staleQuotes: [
    { id: 9, orderNumber: "PO-0011/2026", title: "Reception desk", customerCompany: "GLOBEX", daysOld: 14 },
    { id: 8, orderNumber: "PO-0004/2026", title: "Shelves", customerCompany: "INITECH", daysOld: 9 },
  ],
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
check(dLines.some((l) => l.startsWith("STALE QUOTES - FOLLOW UP (2)")), "digest: stale quotes section with count");
check(dLines.some((l) => l.includes("PO-0011/2026") && l.includes("14 days old")), "digest: stale quote line carries days old");
check(dg.digestTotalIssues(fakeDigest) === 7, "digest: stale quotes count toward the attention total");
check(dLines.some((l) => l.includes("DUE WITHIN 7 DAYS: none")), "digest: empty sections say none");
check(dLines.some((l) => l.includes("BEAM-01") && l.includes("1h 35m")), "digest: downtime line formats hours+minutes");
check(dLines.filter((l) => !l.startsWith("  ")).length === 9, "digest: all 9 section headers render");
const capped = dg.digestToLines({ ...fakeDigest, overdue: Array.from({ length: 12 }, (_, i) => ({ id: i, orderNumber: `PO-${i}` })) }, 8);
check(capped.some((l) => l.includes("…and 4 more")), "digest: long sections are capped with a trailing count");
check(dg.digestTotalIssues(fakeDigest) === 1 + 2 + 1 + 1 + 1 + 1, "digest: total issues counts all attention sections");
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

// ---- audit trail (real filesystem via WOODTEK_DATA_DIR tmp dir) ----
const os = require("os");
const auditTmp = fs.mkdtempSync(path.join(os.tmpdir(), "woodtek-audit-"));
process.env.WOODTEK_DATA_DIR = auditTmp;
const audit = require("./compiled/lib/audit.server.js");
audit.logAudit({ id: 1, name: "Boss", role: "Manager" }, "login", "user", "Signed in", 1);
audit.logAudit({ id: 2, name: "maroun", role: "Machine Operator" }, "operation.update", "operation", "Cutting: In Progress", 42);
audit.logAudit(null, "login.failed", "user", "Failed sign-in for ghost@x");
audit.logAudit({ id: 1, name: "Boss", role: "Manager" }, "db.backup", "system", "Backup woodtek-db.sql (12 KB)");
const trail = audit.readAudit();
check(trail.length === 4 && trail[0].action === "db.backup", "audit: newest-first read");
check(trail[3].actorName === "Boss" && trail[3].action === "login", "audit: actor + action stored");
const filtered = audit.readAudit({ q: "backup" });
check(filtered.length === 1 && filtered[0].action === "db.backup", "audit: substring filter");
audit.clearAudit();
check(audit.readAudit().length === 0, "audit: clear empties the trail");
audit.logAudit({ id: 9, name: "X".repeat(400), role: "r" }, "order.edit", "order", "d".repeat(400), 7);
const one = audit.readAudit()[0];
check(one.actorName.length === 400 && one.detail.length === 300, "audit: detail clamped to 300 (actor name preserved)");
delete process.env.WOODTEK_DATA_DIR;
fs.rmSync(auditTmp, { recursive: true, force: true });

// ---- i18n dictionary sanity ----
const i18n = require("./compiled/lib/i18n.js");
const arKeys = i18n.translatedKeys("ar");
const frKeys = i18n.translatedKeys("fr");
check(arKeys.length > 40 && frKeys.length === arKeys.length, "i18n: AR and FR cover the same key set (>40 labels)");
check(arKeys.every((k) => i18n.tt("ar", k) && i18n.tt("ar", k) !== k || k === "PIN"), "i18n: every AR translation differs from English (or is PIN)");
check(frKeys.every((k) => i18n.tt("fr", k) && i18n.tt("fr", k) !== k || k === "PIN"), "i18n: every FR translation differs from English (or is PIN)");
check(i18n.tt("en", "Executive Dashboard") === "Executive Dashboard", "i18n: EN passthrough");
check(i18n.tt("ar", "Executive Dashboard") === "\u0644\u0648\u062d\u0629 \u0627\u0644\u0642\u064a\u0627\u062f\u0629", "i18n: AR menu label");
check(i18n.tt("fr", "Orders & Routing") === "Commandes & routage", "i18n: FR menu label");
check(i18n.tt("ar", "My Custom Menu Name") === "My Custom Menu Name", "i18n: custom Menu Designer names are untouched");
check(i18n.tt("ar", "Some random UI string") === "Some random UI string", "i18n: unknown strings fall through to English");

// SSR: sidebar renders Arabic labels when lang=ar
const ssrAr = renderToString(React.createElement(Sidebar, props("Manager", null, "ar")));
check(ssrAr.includes("\u0644\u0648\u062d\u0629 \u0627\u0644\u0642\u064a\u0627\u062f\u0629"), "i18n SSR: Arabic sidebar menu labels");
check(ssrAr.includes("\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0648\u0627\u0644\u062a\u0648\u062c\u064a\u0647"), "i18n SSR: Arabic Orders & Routing label");

// ---- auto-lock on idle ----
const idl = require("./compiled/lib/idle.js");
check(idl.normalizeIdleMinutes("banana") === 15, "idle: garbage falls back to 15 min");
check(idl.normalizeIdleMinutes(7) === 15, "idle: off-grid value falls back to default");
check(idl.normalizeIdleMinutes("30") === 30, "idle: numeric string accepted");
check(idl.normalizeIdleMinutes(0) === 0, "idle: 0 (never) is a legal choice");
const base = Date.now();
const s1 = idl.idleState(15, base - 13 * 60000, base);
check(s1.enabled && !s1.warn && !s1.lock && s1.remainingSec === 120, "idle: 13 of 15 min -> quiet, 2 min left");
const s2 = idl.idleState(15, base - 14 * 60000 - 15 * 1000, base);
check(s2.warn && !s2.lock && s2.remainingSec === 45, "idle: inside the last minute -> warning, 45s left");
const s3 = idl.idleState(15, base - 16 * 60000, base);
check(s3.lock && !s3.warn && s3.remainingSec === 0, "idle: past the threshold -> lock");
const s4 = idl.idleState(0, base - 9 * 3600 * 1000, base);
check(!s4.enabled && !s4.lock, "idle: never-mode never locks");
const s5 = idl.idleState(5, base, base);
check(s5.remainingSec === 300 && !s5.warn, "idle: fresh activity -> full countdown, no warning");
const fakeStorage = { getItem: (k) => (k === idl.IDLE_STORAGE_KEY ? "5" : null) };
check(idl.loadIdleMinutes(fakeStorage) === 5, "idle: reads the per-device setting from storage");
check(idl.loadIdleMinutes({ getItem: () => null }) === 15, "idle: missing setting -> default");

// ---- BOM kits + order-entry stock check ----
const bk = require("./compiled/lib/bomKits.js");
const kits = bk.sanitizeKitList([
  { name: "  Standard cabinet ", items: [{ itemId: 3, qty: "4" }, { itemId: 3, qty: 2 }, { itemId: "7", qty: 1.9 }, { itemId: 0, qty: 5 }, { itemId: 9, qty: -3 }] },
  { name: "standard cabinet" },                       // duplicate name (case-insensitive) -> dropped
  { name: "" },                                        // no name -> dropped
  "junk",                                              // non-object -> dropped
]);
check(kits.length === 1 && kits[0].name === "Standard cabinet", "bomKits: names trimmed, dupes dropped");
check(kits[0].items.length === 2 && kits[0].items[0].qty === 6 && kits[0].items[1].qty === 1, "bomKits: quantities merged as integers, invalid items dropped");
check(bk.sanitizeKitList("not-a-list").length === 0, "bomKits: non-array rejected");
const mergedDraft = bk.mergeBomKit(
  [{ itemId: "3", qty: "2" }, { itemId: "12", qty: "1" }],
  { name: "kit", items: [{ itemId: 3, qty: 4 }, { itemId: 8, qty: 2 }] },
);
check(mergedDraft.length === 3, "bomKits: merging keeps existing lines and adds new ones");
const line3 = mergedDraft.find((l) => l.itemId === "3");
check(line3 && line3.qty === "6", "bomKits: duplicate item quantities SUM (2+4=6)");
const itemsMap = new Map([
  [3, { name: "MDF 18mm", stockQuantity: 8, unit: "sheet" }],
  [8, { name: "Edge banding", stockQuantity: 100, unit: "m" }],
  [12, { name: "Hinges", stockQuantity: 0, unit: "pcs" }],
]);
const short = bk.stockShortfall(mergedDraft, itemsMap);
check(short.length === 1 && short[0].itemId === 12, "stock check: only genuinely short lines flagged (MDF needs 6, has 8 -> fine)");
check(short[0].needed === 1 && short[0].stock === 0 && short[0].missing === 1, "stock check: missing = needed - stock");
const hinge = short.find((s) => s.itemId === 12);
check(hinge && hinge.missing === 1 && hinge.stock === 0, "stock check: zero-stock flagged with the gap");
check(bk.stockShortfall([{ itemId: "", qty: "5" }, { itemId: "3", qty: "0" }], itemsMap).length === 0, "stock check: empty/zero lines ignored");
check(bk.stockShortfall([{ itemId: "99", qty: "5" }], itemsMap).length === 0, "stock check: unknown items skipped (API rejects them at creation)");

// ---- quotation strings (EN/AR/FR) ----
const qEn = i18n.QUOTE_STRINGS.en, qAr = i18n.QUOTE_STRINGS.ar, qFr = i18n.QUOTE_STRINGS.fr;
const qKeys = Object.keys(qEn).sort();
check(
  JSON.stringify(Object.keys(qAr).sort()) === JSON.stringify(qKeys) &&
    JSON.stringify(Object.keys(qFr).sort()) === JSON.stringify(qKeys),
  "quote strings: EN/AR/FR cover the exact same key set",
);
check(qEn.quotation === "QUOTATION" && qFr.quotation === "DEVIS" && qAr.quotation === "\u0639\u0631\u0636 \u0633\u0639\u0631", "quote strings: translated titles");
check(qEn.totalQuoted !== qFr.totalQuoted && qFr.terms.includes("30"), "quote strings: totals + terms differ per language");

// ---- packing QC checklist ----
const pq = require("./compiled/lib/packingQc.js");
check(pq.DEFAULT_QC_TEMPLATE.length === 5, "packingQc: factory default template has 5 items");
check(
  JSON.stringify(pq.sanitizeTemplate(["  All  items packed ", "", "x", "X", "  ALL ITEMS PACKED", "a".repeat(200)])) ===
    JSON.stringify(["All items packed", "x", "a".repeat(120)]),
  "packingQc: template trims, drops empties, dedupes case-insensitive, caps length",
);
check(JSON.stringify(pq.sanitizeTemplate("nope")) === "[]" && JSON.stringify(pq.sanitizeTemplate([1, 2])) === "[]", "packingQc: non-string junk rejected");
check(pq.normalizeChecks([true, "yes"], 4).length === 4 && pq.normalizeChecks([true, "yes"], 4)[0] === true && pq.normalizeChecks([true, "yes"], 4)[1] === false, "packingQc: checks normalize to strict booleans at fixed length");
check(pq.checklistComplete([true, true]) && !pq.checklistComplete([true, false]) && !pq.checklistComplete([]), "packingQc: complete requires every tick");
check(pq.checklistProgress([true, false, true]) === 2, "packingQc: progress counts ticks");
check(pq.templateGates([]) === false && pq.templateGates(["a"]) === true, "packingQc: empty template disables the gate");

// ---- order archive ----
const oa = require("./compiled/lib/orderArchive.js");
check(
  JSON.stringify(oa.sanitizeArchivedIds([3, "5", 3, -1, 2.5, 0, 1])) === JSON.stringify([1, 3, 5]),
  "orderArchive: ids cleaned, deduped, sorted",
);
check(oa.sanitizeArchivedIds("junk").length === 0, "orderArchive: non-array input gives an empty list");
check(JSON.stringify(oa.withArchived([1, 2], 7, true)) === JSON.stringify([1, 2, 7]), "orderArchive: withArchived adds");
check(JSON.stringify(oa.withArchived([1, 2, 7], 2, false)) === JSON.stringify([1, 7]), "orderArchive: withArchived removes");

// ---- delivery photos ----
const dp = require("./compiled/lib/deliveryPhotos.js");
check(dp.validatePhoto("image/jpeg", 1024) === null, "deliveryPhotos: jpeg accepted");
check(dp.validatePhoto("image/heic", 10) !== null, "deliveryPhotos: heic rejected with a reason");
check(dp.validatePhoto("image/png", dp.MAX_PHOTO_BYTES + 1) !== null, "deliveryPhotos: oversize rejected");
check(dp.photoExtFor("image/webp") === "webp" && dp.photoExtFor("application/pdf") === null, "deliveryPhotos: mime map");
check(dp.isSafeStoredPhotoName("delivery-12-1699999999999-1.jpg") && dp.isSafeStoredPhotoName("delivery-batch-71-1699999999999-1.webp") && !dp.isSafeStoredPhotoName("../secret.jpg") && !dp.isSafeStoredPhotoName("delivery-1-2-3.exe"), "deliveryPhotos: legacy + batch stored-name patterns block traversal");

// ---- wall board ----
const wb = require("./compiled/lib/wallboard.js");
const wall = wb.buildWallBoard({
  generatedAt: "2026-09-15T08:00:00Z",
  kpis: { runningStations: 2, idleStations: 1, machinesDown: 1, activeOrders: 3 },
  machineBoard: [
    { id: 4, code: "BEAM-01", name: "Beam saw", category: "Beam Saw", state: "Running", currentJob: { orderNumber: "PO-0042/2026", customerName: "AUB", operationName: "Cutting", startTime: "2026-09-15T07:30:00Z" }, queue: [{}, {}], queueMinutes: 90 },
    { id: 5, code: "EDGE-02", name: "Edger", category: "Edge Banding", state: "Idle", currentJob: null, queue: [], queueMinutes: 0 },
  ],
  orderBoard: [{ orderNumber: "PO-0042/2026", title: "Kitchen", customerName: "AUB", status: "In Production", priority: "Urgent", progressPercent: 40, completedSteps: 2, totalSteps: 5 }],
});
check(wall.machines.length === 2 && wall.orders.length === 1, "wallboard: rows mapped");
check(wall.machines[0].currentOrder === "PO-0042/2026" && wall.machines[0].currentClient === "AUB" && wall.machines[0].currentOperation === "Cutting", "wallboard: current job fields");
check(wall.machines[0].currentStartMs !== null && wall.machines[1].currentStartMs === null, "wallboard: start time only when running");
check(wall.machines[0].queued === 2 && wall.machines[1].queued === 0, "wallboard: queue depth");
check(wall.kpis.running === 2 && wall.kpis.down === 1 && wall.kpis.activeOrders === 3, "wallboard: kpis mapped");
check(wb.buildWallBoard(null).machines.length === 0, "wallboard: empty payload is safe");

// ---- material production stage ----
const mp = require("./compiled/lib/materialProgress.js");
check(mp.sanitizeStage("  Edge   Banding ") === "Edge Banding" && mp.sanitizeStage("x".repeat(99)).length === mp.STAGE_MAX_LENGTH, "material stage: trims and caps");
check(mp.sanitizeStage(42) === "" && mp.sanitizeStage(null) === "", "material stage: junk becomes not-started");
const mpMap = mp.sanitizeProgressMap({ 7: { stage: "Cutting", at: "t", by: "A" }, "x": 1, 8: "junk", 9: { stage: "" }, "-3": { stage: "No" } });
check(Object.keys(mpMap).length === 1 && mpMap["7"].stage === "Cutting", "material stage: map keeps only valid numeric lines");
check(mp.stageDisplay("").label === "Not started" && mp.stageDisplay("").tone === "slate", "material stage: not-started renders slate");
check(mp.stageDisplay("Edge Banding").label === "\u2192 Edge Banding" && mp.stageDisplay("Edge Banding").tone === "amber", "material stage: in-progress renders amber");
check(mp.stageDisplay("DONE").label === "\u2713 Done" && mp.stageDisplay("DONE").tone === "emerald", "material stage: done renders emerald");

// ---- material stage ordering (one step at a time) ----
check(JSON.stringify(mp.allowedStages(["Cutting", "Edging"], "")) === JSON.stringify(["", "Cutting"]), "stage order: not-started can only enter the first step");
check(JSON.stringify(mp.allowedStages(["Cutting", "Edging"], "Cutting")) === JSON.stringify(["", "Cutting", "Edging"]), "stage order: mid-step can go one back or one forward");
check(JSON.stringify(mp.allowedStages(["Cutting", "Edging"], "Edging")) === JSON.stringify(["Cutting", "Edging", "DONE"]), "stage order: last step may finish");
check(JSON.stringify(mp.allowedStages(["Cutting", "Edging"], "DONE")) === JSON.stringify(["Edging", "DONE"]), "stage order: done can only step back");
check(mp.allowedStages(["Cutting", "Edging"], "Renamed Step").length === 4, "stage order: unknown/manual stage may go anywhere");
check(JSON.stringify(mp.allowedStages([], "")) === JSON.stringify(["", "DONE"]), "stage order: order without steps goes straight to done");
check(JSON.stringify(mp.allowedStages(["Cutting", "Edging"], "Cutting")).includes("DONE") === false, "stage order: can NOT jump to Done from the middle");

// ---- per-material machine routing ----
const mr = require("./compiled/lib/materialRoutes.js");
check(JSON.stringify(mr.sanitizeRouteSteps(["  Beam  Saw ", "", "beam saw", "Edge Banding", "x".repeat(99)])) === JSON.stringify(["Beam Saw", "Edge Banding", "x".repeat(40)]), "material routes: trims, drops empties, collapses consecutive duplicates, caps");
check(mr.sanitizeRouteSteps("junk").length === 0 && mr.sanitizeRouteSteps([1, 2]).length === 0, "material routes: junk rejected");
check(JSON.stringify(mr.routeLadder(["Cutting", "Edging"])) === JSON.stringify(["", "Cutting", "Edging", "DONE"]), "material routes: ladder wraps the steps");
check(mr.nextInRoute(["Cutting", "Edging"], "Cutting") === "Edging" && mr.nextInRoute(["Cutting", "Edging"], "Edging") === "DONE", "material routes: next follows the material's own path");
check(mr.nextInRoute(["Cutting"], "DONE") === null && mr.nextInRoute(["Cutting"], "Mystery") === null, "material routes: end and unknown are null");

// ---- recipe-derived material routes ----
check(JSON.stringify(mr.recipeRouteSteps([
  { machineCategory: "Beam Saw", operationName: "Cutting", estimatedMinutes: 30 },
  { machineCategory: "Beam Saw", operationName: "Cutting 2" },
  { machineCategory: "Edge Banding", operationName: "Edging" },
])) === JSON.stringify(["Beam Saw", "Edge Banding"]), "recipe routes: categories deduped in order");
check(mr.recipeRouteSteps([{ operationName: "Assembly", machineCategory: "" }])[0] === "Assembly", "recipe routes: falls back to operation name");
check(mr.recipeRouteSteps("junk").length === 0, "recipe routes: junk rejected");

// ---- material stage positioning ----
const mpxLadder = mp.stageLadder(["Cutting", "Edging"]);
check(mp.ladderIndex(mpxLadder, "Cutting") === 1 && mp.ladderIndex(mpxLadder, "DONE") === 3 && mp.ladderIndex(mpxLadder, "Custom") === -1, "stage order: ladderIndex locates stages");

// ---- v2 independent material production plans ----
const pp = require("./compiled/lib/productionPlan.js");
const repeatedRecipe = pp.productionRouteFromTemplate([
  { stepOrder: 1, operationName: "First Saw", machineCategory: "Beam Saw", estimatedMinutes: 90 },
  { stepOrder: 2, operationName: "Press", machineCategory: "Press", estimatedMinutes: 240 },
  { stepOrder: 3, operationName: "Second Saw", machineCategory: "Beam Saw", estimatedMinutes: 60 },
  { stepOrder: 4, operationName: "Final Edge", machineCategory: "Edge Bander", estimatedMinutes: 80 },
]);
check(repeatedRecipe.length === 4, "production plan: repeated machine visits are never deleted");
check(repeatedRecipe[0].operationName === "First Saw" && repeatedRecipe[2].operationName === "Second Saw", "production plan: real operation names survive recipe snapshot");
check(repeatedRecipe[1].estimatedMinutes === 240 && repeatedRecipe[3].estimatedMinutes === 80, "production plan: recipe estimates survive unchanged");
const exactPasses = pp.sanitizeProductionRoute([
  { operationName: "Saw pass", machineCategory: "Beam Saw", estimatedMinutes: 0, auto: true },
  { operationName: "Saw pass", machineCategory: "Beam Saw", estimatedMinutes: 99999, auto: false, machineId: 7 },
]);
check(exactPasses.length === 2, "production plan: even identical consecutive passes remain distinct");
check(exactPasses[0].estimatedMinutes === 1 && exactPasses[1].estimatedMinutes === 1440, "production plan: estimates clamp to safe limits");
check(exactPasses[1].auto === false && exactPasses[1].machineId === 7, "production plan: exact machine assignment survives sanitising");
const productionItems = pp.sanitizeProductionItems([
  { clientKey: "doors", name: " Kitchen doors ", itemId: 12, quantityUsed: 8, routeSource: "recipe", recipeId: 3, recipeName: "Cut + edge", steps: repeatedRecipe },
]);
check(productionItems.length === 1 && productionItems[0].name === "Kitchen doors" && productionItems[0].quantityUsed === 8, "production plan: named material batch + stock quantity sanitise together");
check(pp.sanitizeProductionItems([{ name: "Missing route", itemId: 1, steps: [] }]).length === 0, "production plan: incomplete material job is rejected");
check(pp.productionStageKey(1, "Saw") !== pp.productionStageKey(3, "Saw"), "production plan: repeated operation names receive unique stage keys");
const samplePlan = {
  orderId: 22,
  createdAt: "2026-09-16T10:00:00.000Z",
  defaultSteps: repeatedRecipe,
  items: [{
    materialId: 71,
    itemId: 12,
    name: "Kitchen doors",
    quantityUsed: 8,
    routeSource: "recipe",
    recipeId: 3,
    recipeName: "Cut + edge",
    steps: repeatedRecipe.map((step, index) => ({ ...step, operationId: 800 + index, position: index + 1, stageKey: pp.productionStageKey(index + 1, step.operationName) })),
  }],
};
check(pp.findProductionItemByMaterial(samplePlan, 71).name === "Kitchen doors", "production plan: material resolves to its private chain");
check(pp.findProductionStepByOperation(samplePlan, 802).index === 2, "production plan: operation resolves to its material and pass position");
const twoBatchPlan = {
  ...samplePlan,
  items: [
    samplePlan.items[0],
    {
      ...samplePlan.items[0],
      materialId: 72,
      name: "Wall panels",
      steps: [{ ...samplePlan.items[0].steps[0], operationId: 900 }],
    },
  ],
};
check(
  pp.findProductionStepByOperation(twoBatchPlan, 900).batchNumber === 2,
  "production plan: dashboard batch number follows the stable material-plan order",
);
check(pp.previousProductionOperationId(samplePlan, 802) === 801 && pp.nextProductionOperationId(samplePlan, 802) === 803, "production plan: predecessor/next stay inside one material chain");
check(pp.routeStageKeys(samplePlan.items[0]).length === 4 && new Set(pp.routeStageKeys(samplePlan.items[0])).size === 4, "production plan: progress ladder preserves all repeated passes");
const cleanPlanStore = pp.sanitizeProductionPlanStore({ version: 99, orders: { 22: samplePlan, bad: {}, 23: { orderId: 99, items: [] } } });
check(Object.keys(cleanPlanStore.orders).length === 1 && cleanPlanStore.orders["22"].items.length === 1, "production plan: stored overlay rejects malformed and mismatched orders");

// ---- batch Dispatch invariants ----
const dispatch = require("./compiled/lib/dispatch.js");
check(dispatch.dispatchBatchKey(71) === "batch:71" && dispatch.dispatchLegacyOrderKey(22) === "order:22", "batch dispatch: row keys cannot collide across sibling orders/materials");
check(dispatch.allCurrentBatchesDelivered([71, 72], { 71: { stage: "delivered" }, 72: { stage: "awaiting_delivery" } }) === false, "batch dispatch: one delivered batch never delivers its sibling or parent");
check(dispatch.allCurrentBatchesDelivered([71, 72], { 71: { stage: "delivered" }, 72: { stage: "delivered" } }) === true, "batch dispatch: parent becomes deliverable only after every current batch");
check(dispatch.allCurrentBatchesDelivered([], {}) === false, "batch dispatch: an empty material set cannot satisfy the all-batches roll-up");

// ---- automatic production Dispatch slot planner ----
const dsp = require("./compiled/lib/dispatchScheduling.js");
const slotNow = new Date("2026-09-18T06:00:00.000Z").getTime();
const automaticPlan = dsp.buildAutomaticDispatchPlan({
  nowMs: slotNow,
  orders: [
    { id: 1, priority: "High", dueDate: "2026-09-20T12:00:00Z" },
    { id: 2, priority: "Normal", dueDate: "2026-09-22T12:00:00Z" },
    { id: 99, priority: "Normal", dueDate: "2026-09-30T12:00:00Z" },
  ],
  machines: [
    { id: 1, category: "Beam Saw", status: "Active" },
    { id: 2, category: "Beam Saw", status: "Active" },
    { id: 3, category: "Edge Bander", status: "Active" },
  ],
  operations: [
    // Existing work from another order reserves Saw 1 for the first 30 min.
    { id: 900, orderId: 99, machineId: 1, stepOrder: 1, operationName: "Existing", estimatedMinutes: 30, status: "Ready", scheduledStart: new Date(slotNow), scheduledEnd: new Date(slotNow + 30 * 60000) },
    // Two private material chains on one order.
    { id: 101, orderId: 1, machineId: 1, stepOrder: 1, operationName: "Doors saw", estimatedMinutes: 60, status: "Ready", predecessorOperationId: null },
    { id: 102, orderId: 1, machineId: 3, stepOrder: 2, operationName: "Doors edge", estimatedMinutes: 30, status: "Pending", predecessorOperationId: 101 },
    { id: 201, orderId: 1, machineId: 2, stepOrder: 3, operationName: "Panels saw", estimatedMinutes: 45, status: "Ready", predecessorOperationId: null },
    { id: 202, orderId: 1, machineId: 3, stepOrder: 4, operationName: "Panels edge", estimatedMinutes: 30, status: "Pending", predecessorOperationId: 201 },
    // Not targeted and therefore must remain untouched.
    { id: 301, orderId: 2, machineId: 2, stepOrder: 1, operationName: "Other order", estimatedMinutes: 20, status: "Ready" },
  ],
  targetOrderIds: [1],
});
const placement = (id) => automaticPlan.placements.find((entry) => entry.operationId === id);
check(automaticPlan.attempted === 4 && automaticPlan.placements.length === 4 && !placement(301), "dispatch slots: issue-time planner targets only the newly issued order");
check(placement(101).startMs === slotNow + 30 * 60000 && placement(201).startMs === slotNow, "dispatch slots: existing machine bookings are respected while sibling batches can start in parallel");
check(placement(102).startMs >= placement(101).endMs && placement(202).startMs >= placement(201).endMs, "dispatch slots: each batch waits only for its own private predecessor");
check(placement(102).endMs <= placement(202).startMs || placement(202).endMs <= placement(102).startMs, "dispatch slots: two batch passes can never overlap on one machine");
const automaticMachinePlan = dsp.buildAutomaticDispatchPlan({
  nowMs: slotNow,
  orders: [{ id: 7, priority: "Normal" }],
  machines: [
    { id: 1, category: "Beam Saw", status: "Maintenance" },
    { id: 2, category: "Beam Saw", status: "Active" },
  ],
  operations: [
    { id: 701, orderId: 7, machineId: null, stepOrder: 1, operationName: "Auto saw", estimatedMinutes: 20, status: "Ready", requiredMachineCategory: "Beam Saw", automaticMachine: true },
    { id: 702, orderId: 7, machineId: null, stepOrder: 2, operationName: "Exact pending", estimatedMinutes: 20, status: "Ready", automaticMachine: false },
  ],
});
check(automaticMachinePlan.placements[0].machineId === 2, "dispatch slots: an unassigned Auto pass chooses an active compatible machine");
check(automaticMachinePlan.skipped.some((entry) => entry.operationId === 702 && entry.reason.includes("exact machine")), "dispatch slots: an unassigned Exact pass stays a visible exception instead of using a wrong machine");

// ---- operation machine candidates ----
const omc = require("./compiled/lib/operationMachineCandidates.js");
check(JSON.stringify(omc.sanitizeCandidateMachineIds([2, "1", 2, 0, "bad"])) === JSON.stringify([2, 1]), "machine candidates: ids sanitize, dedupe and preserve supervisor order");
check(JSON.stringify(omc.effectiveCandidateMachineIds(1, "Ready", { machineIds: [1, 2] })) === JSON.stringify([1, 2]), "machine candidates: waiting operation is actionable at every selected equivalent station");
check(JSON.stringify(omc.effectiveCandidateMachineIds(2, "In Progress", { machineIds: [1, 2] })) === JSON.stringify([2]), "machine candidates: running operation collapses to the atomically claimed station");
check(omc.candidateIncludesStation(1, "Ready", { machineIds: [1, 2] }, 2) === true && omc.candidateIncludesStation(1, "Completed", { machineIds: [1, 2] }, 2) === false, "machine candidates: unchosen station loses visibility after first Start");

// ---- complete machine-assignment set reconciliation ----
const stationAssignment = require("./compiled/lib/stationAssignment.js");
let stationPick = stationAssignment.reconcileStationSelection({
  availableMachineIds: [1, 2], assignedMachineIds: [2], previousAssignedMachineIds: [], selectedMachineId: null, initialized: false,
});
check(stationPick.selectedMachineId === 2 && stationPick.reason === "initial-assignment", "station assignment: initial operator station opens automatically");
stationPick = stationAssignment.reconcileStationSelection({
  availableMachineIds: [1, 2], assignedMachineIds: [1, 2], previousAssignedMachineIds: [1], selectedMachineId: 1, initialized: true,
});
check(stationPick.selectedMachineId === 2 && stationPick.reason === "assignment-added", "station assignment: adding a second machine is detected even while the old first match remains");
stationPick = stationAssignment.reconcileStationSelection({
  availableMachineIds: [2, 1], assignedMachineIds: [2, 1], previousAssignedMachineIds: [1, 2], selectedMachineId: 2, initialized: true,
});
check(stationPick.selectedMachineId === 2 && stationPick.reason === "unchanged", "station assignment: response reordering never overrides a stable manual choice");
stationPick = stationAssignment.reconcileStationSelection({
  availableMachineIds: [2], assignedMachineIds: [2], previousAssignedMachineIds: [1, 2], selectedMachineId: 1, initialized: true,
});
check(stationPick.selectedMachineId === 2 && stationPick.removedMachineIds.includes(1), "station assignment: removing or moving the selected station falls through to a remaining assignment");
stationPick = stationAssignment.reconcileStationSelection({
  availableMachineIds: [], assignedMachineIds: [], previousAssignedMachineIds: [2], selectedMachineId: 2, initialized: true,
});
check(stationPick.selectedMachineId === null && stationPick.reason === "selection-removed", "station assignment: removing the final assignment clears the stale station");

// ---- atomic Excel stock import ----
const inventoryImport = require("./compiled/lib/inventoryImport.js");
const stockHeaders = [...inventoryImport.INVENTORY_IMPORT_HEADERS];
const validStockWorkbook = [
  stockHeaders,
  [" brd-oak-18 ", "Updated Oak Board", "Wood & MDF Panels", "1,250", "sheets", "123.4", 50, "Rack A"],
  ["edg-new-22", "New ABS Edge", "edge banding", 80, "meters", 0.85, 10, "Spool 4"],
];
let stockValidation = inventoryImport.validateInventoryImportMatrix(validStockWorkbook, [{ id: 9, sku: "BRD-OAK-18" }]);
check(stockValidation.valid && stockValidation.summary.total === 2 && stockValidation.summary.updates === 1 && stockValidation.summary.creates === 1, "Excel stock import: valid workbook previews exact create/update counts");
check(stockValidation.rows[0].action === "update" && stockValidation.rows[0].existingId === 9 && stockValidation.rows[0].stockQuantity === 1250, "Excel stock import: trimmed case-insensitive SKU matching updates the existing row");
check(stockValidation.rows[1].action === "create" && stockValidation.rows[1].sku === "EDG-NEW-22" && stockValidation.rows[1].unitCost === "0.85" && stockValidation.rows[1].category === "Edge Banding", "Excel stock import: unknown SKU and known category casing are normalized for creation");
stockValidation = inventoryImport.validateInventoryImportMatrix([
  stockHeaders,
  ["DUP-1", "First", "Edge Banding", 1, "meters", 1, 1, "A"],
  [" dup-1 ", "Second", "Edge Banding", 2, "meters", 2, 2, "B"],
], []);
check(!stockValidation.valid && stockValidation.rows.length === 0 && stockValidation.errors.every((error) => error.messages.some((message) => message.includes("Duplicate SKU"))), "Excel stock import: normalized duplicate SKUs invalidate the whole workbook with both row numbers");
stockValidation = inventoryImport.validateInventoryImportMatrix([
  stockHeaders,
  ["BAD-1", "", "", -1, "", "not-money", 1.5, ""],
  ["BAD-2", "Valid name", "Edge Banding", 2, "meters", 1, 1, ""],
], []);
check(!stockValidation.valid && stockValidation.errors.some((error) => error.rowNumber === 2) && stockValidation.errors.some((error) => error.rowNumber === 3), "Excel stock import: every invalid row receives row-specific errors before any write");
stockValidation = inventoryImport.validateInventoryImportMatrix([
  stockHeaders,
  ["COST-3DP", "Too precise", "Edge Banding", 1, "meters", 1.005, 1, "A"],
], []);
check(!stockValidation.valid && stockValidation.errors[0].messages.some((message) => message.includes("2 decimal places")), "Excel stock import: unit cost rejects hidden third-decimal rounding");
stockValidation = inventoryImport.validateInventoryImportMatrix([
  stockHeaders.filter((header) => header !== "Location"),
  ["A", "A", "Edge Banding", 1, "meters", 1, 1],
], []);
check(!stockValidation.valid && stockValidation.errors[0].rowNumber === 1 && stockValidation.errors[0].messages.some((message) => message.includes("Location")), "Excel stock import: missing required headers reject the workbook");
stockValidation = inventoryImport.validateInventoryImportMatrix([
  stockHeaders,
  ["FORMULA-1", "Formula", "Edge Banding", inventoryImport.unsupportedInventoryImportCell("formulas are not supported"), "meters", 1, 1, "A"],
], []);
check(!stockValidation.valid && stockValidation.errors[0].messages.some((message) => message.includes("formulas are not supported")), "Excel stock import: formula cells cannot bypass deterministic validation");
check(
  inventoryViewSource.includes("Import Excel")
    && inventoryViewSource.includes("Excel Template")
    && inventoryViewSource.includes("importPreview?.valid"),
  "Excel stock import: Stock tab exposes template, upload, preview and validity-gated commit controls",
);
check(
  inventoryImportApiSource.includes("db.transaction")
    && inventoryImportApiSource.includes("lock table inventory_items")
    && (inventoryImportApiSource.match(/validateInventoryImportMatrix/g) || []).length >= 2
    && inventoryImportApiSource.includes("zero rows were written"),
  "Excel stock import: commit locks, revalidates and writes all rows in one rollback-safe transaction",
);
check(
  inventoryImportServerSource.includes('addWorksheet("Stock Import"')
    && inventoryImportServerSource.includes('addWorksheet("Instructions"')
    && inventoryImportServerSource.includes("Stock Quantity")
    && inventoryImportServerSource.includes("REPLACES"),
  "Excel stock import: downloadable template documents headers and absolute stock semantics",
);

// ---- crew job lock ----
const jl = require("./compiled/lib/jobLock.js");
check(jl.jobLockedByOther({ status: "In Progress", operatorId: 7 }, 9, true) === true, "job lock: crew mate is locked out of a running job");
check(jl.jobLockedByOther({ status: "In Progress", operatorId: 7 }, 7, true) === false, "job lock: the starter keeps control");
check(jl.jobLockedByOther({ status: "In Progress", operatorId: 7 }, 9, false) === false, "job lock: managers/supervisors never locked");
check(jl.jobLockedByOther({ status: "Ready", operatorId: 7 }, 9, true) === false, "job lock: queued jobs free for any crew member");
check(jl.jobLockedByOther({ status: "In Progress", operatorId: null }, 9, true) === false, "job lock: no recorded starter = no lock");
check(jl.jobLockedByOther({ status: "In Progress", operatorId: "7" }, "9", true) === true, "job lock: string ids coerce");

// ---- machine assignment permissions ----
const savedCustomRoles = perms.getCustomRoles();
perms.registerCustomRoles([...savedCustomRoles, { name: "Line Supervisor", base: "Floor Supervisor" }]);
check(perms.canAssignMachines("Manager") === true, "machine assign: Manager can assign");
check(perms.canAssignMachines("Floor Supervisor") === true, "machine assign: Floor Supervisor can assign");
check(perms.canAssignMachines("Line Supervisor") === true, "machine assign: custom role based on Floor Supervisor can assign");
check(perms.canAssignMachines("Machine Operator") === false, "machine assign: operator cannot assign");
check(perms.canAssignMachines("Warehouse Supervisor") === false, "machine assign: warehouse cannot assign");
check(perms.canAssignMachines(undefined) === false, "machine assign: signed-out cannot assign");
perms.registerCustomRoles(savedCustomRoles);

// ---- project category selection ----
const pt = require("./compiled/lib/projectTypes.js");
check(pt.reconcileProjectType(["Kitchen", "Wardrobe"], "wardrobe") === "Wardrobe", "project types: valid selection follows saved casing");
check(pt.reconcileProjectType(["Kitchen"], "Deleted category") === "Kitchen" && pt.reconcileProjectType([], "Deleted category") === "", "project types: deleted selection cannot reappear, including an empty list");

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
