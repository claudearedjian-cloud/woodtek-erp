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
compile("src/lib/productionReport.ts", "lib/productionReport.js");
compile("src/lib/dueDateFit.ts", "lib/dueDateFit.js");
compile("src/lib/machineCategories.ts", "lib/machineCategories.js");
compile("src/lib/permissions.ts", "lib/permissions.js");
compile("src/lib/menuConfig.ts", "lib/menuConfig.js");
compile("src/lib/menuIcons.ts", "lib/menuIcons.js");
compile("src/lib/bomDelivery.ts", "lib/bomDelivery.js");
compile("src/lib/downtimeReasons.ts", "lib/downtimeReasons.js");
compile("src/lib/digest.ts", "lib/digest.js");
compile("src/lib/clientStatement.ts", "lib/clientStatement.js");
compile("src/lib/atomicFile.server.ts", "lib/atomicFile.server.js");
compile("src/lib/dbIndexes.ts", "lib/dbIndexes.js");
compile("src/lib/audit.server.ts", "lib/audit.server.js");
compile("src/lib/i18n.ts", "lib/i18n.js");
compile("src/lib/langContext.tsx", "lib/langContext.js");
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
compile("src/lib/ganttModel.ts", "lib/ganttModel.js");
compile("src/lib/inventoryImport.ts", "lib/inventoryImport.js");
compile("src/lib/materialProgress.ts", "lib/materialProgress.js");
compile("src/lib/materialRoutes.ts", "lib/materialRoutes.js");
compile("src/lib/productionPlan.ts", "lib/productionPlan.js");
compile("src/lib/jobTicket.ts", "lib/jobTicket.js");
compile("src/lib/deliveryNote.ts", "lib/deliveryNote.js");
compile("src/lib/dispatchPack.ts", "lib/dispatchPack.js");
compile("src/lib/emailConfig.ts", "lib/emailConfig.js");
compile("src/lib/emailDispatch.ts", "lib/emailDispatch.js");
compile("src/lib/projectTypes.ts", "lib/projectTypes.js");
compile("src/lib/optionalModules.ts", "lib/optionalModules.js");
compile("src/lib/optionalModules.server.ts", "lib/optionalModules.server.js");
compile("src/lib/purchasing.ts", "lib/purchasing.js");
compile("src/lib/payables.ts", "lib/payables.js");
compile("src/lib/invoicing.ts", "lib/invoicing.js");
compile("src/lib/jobCosting.ts", "lib/jobCosting.js");
compile("src/lib/reportMoney.ts", "lib/reportMoney.js");
compile("src/components/BrandMark.tsx", "components/BrandMark.js");
compile("src/components/Sidebar.tsx", "components/Sidebar.js");
compile("src/components/SupplierBillsView.tsx", "components/SupplierBillsView.js");
compile("src/components/NewOrderWizard.tsx", "components/NewOrderWizard.js");
compile("src/components/MachineDowntimeLoginAlert.tsx", "components/MachineDowntimeLoginAlert.js");
compile("src/components/InvoicingView.tsx", "components/InvoicingView.js");

const React = require("react");
const { renderToString } = require("react-dom/server");
const Sidebar = require("./compiled/components/Sidebar.js").default;
const SupplierBillsView = require("./compiled/components/SupplierBillsView.js").default;
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
const ganttViewSource = fs.readFileSync("src/components/GanttView.tsx", "utf8");
const ganttApiSource = fs.readFileSync("src/app/api/gantt/route.ts", "utf8");
const emailConfigServerSource = fs.readFileSync("src/lib/emailConfig.server.ts", "utf8");
const emailConfigApiSource = fs.readFileSync("src/app/api/email-config/route.ts", "utf8");
const emailDispatchApiSource = fs.readFileSync("src/app/api/email-dispatch/route.ts", "utf8");
const settingsViewSource = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
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
  scheduleSource.includes("dispatchOrderFilter")
    && scheduleSource.includes("dispatchOrderOptions")
    && scheduleSource.includes('All orders — {dispatchOrders.length}')
    && scheduleSource.includes('value={String(o.orderId)}'),
  "dispatch filter: order selector lists every order in the queue and isolates one order at a time",
);
check(
  scheduleSource.includes("visibleDispatchOrders.map((o: any)")
    && scheduleSource.includes("No batches match this filter")
    && scheduleSource.includes("Clear filter"),
  "dispatch filter: the queue renders filtered rows with a no-match state and a clear action",
);
check(
  scheduleSource.includes("const stops = visibleDispatchOrders")
    && scheduleSource.includes("const q = dispatchSearch.trim().toLowerCase()"),
  "dispatch filter: driver manifest follows the active filter and free-text search matches order/batch/customer/SKU",
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
    && machineCrewStoreSource.includes("writeJsonAtomic(file, map)"),
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

// ---- atomic JSON writes (2026-09-30: crash-safe data files) ----
const atomicTmp = fs.mkdtempSync(path.join(os.tmpdir(), "woodtek-atomic-"));
const atomic = require("./compiled/lib/atomicFile.server.js");
const atomicFile = path.join(atomicTmp, "nested", "store.json");
atomic.writeJsonAtomic(atomicFile, { version: 1, hello: "world" });
check(
  JSON.parse(fs.readFileSync(atomicFile, "utf8")).hello === "world",
  "atomic: write creates the nested data dir and valid JSON",
);
check(
  fs.readdirSync(path.join(atomicTmp, "nested")).every((f) => !f.endsWith(".tmp")),
  "atomic: no temp files left behind after the rename",
);
atomic.writeJsonAtomic(atomicFile, { version: 2, replaced: true });
check(
  JSON.parse(fs.readFileSync(atomicFile, "utf8")).replaced === true,
  "atomic: rewriting replaces the previous content",
);
let atomicThrew = false;
try {
  atomic.writeJsonAtomic(path.join(atomicFile, "deeper", "x.json"), {});
} catch {
  atomicThrew = true;
}
check(atomicThrew, "atomic: write failures surface the error (target stays untouched)");
// Every JSON store — library or route-local — must write through the shared
// helper. A raw writeFileSync(<file>, JSON.stringify(…)) truncates the target
// before writing, so a power cut mid-save could empty that store.
const RAW_JSON_WRITE = /writeFileSync\(\s*[A-Za-z_$][\w$]*\s*,\s*JSON\.stringify/;
const ATOMIC_STORES = [
  "src/lib/audit.server.ts",
  "src/lib/bomStatus.server.ts",
  "src/lib/dispatch.server.ts",
  "src/lib/emailConfig.server.ts",
  "src/lib/inventoryCategories.server.ts",
  "src/lib/inventoryDimensions.server.ts",
  "src/lib/machineOperators.server.ts",
  "src/lib/materialProgress.server.ts",
  "src/lib/materialRoutes.server.ts",
  "src/lib/operationMachineCandidates.server.ts",
  "src/lib/optionalModules.server.ts",
  "src/lib/orderCleanup.server.ts",
  "src/lib/packingQc.server.ts",
  "src/lib/productionPlan.server.ts",
  "src/lib/rolesConfig.server.ts",
  "src/app/api/bom-kits/route.ts",
  "src/lib/clientLedger.server.ts",
  "src/app/api/delivery-photos/route.ts",
  "src/app/api/machine-categories/route.ts",
  "src/app/api/menu-config/route.ts",
  "src/app/api/order-archive/route.ts",
  "src/app/api/packing-qc/route.ts",
  "src/app/api/project-types/route.ts",
];
for (const store of ATOMIC_STORES) {
  const storeSource = fs.readFileSync(store, "utf8");
  check(
    storeSource.includes("writeJsonAtomic(") && !RAW_JSON_WRITE.test(storeSource),
    "atomic: " + store + " writes via writeJsonAtomic (no in-place JSON write)",
  );
}
// Global guard: the only remaining raw JSON write in the whole source tree is
// the helper itself, so a new store cannot quietly reintroduce the bug.
const walkSources = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "compiled"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full.replace(/\\/g, "/"));
  }
  return out;
};
const rawJsonWriters = walkSources("src").filter((file) => RAW_JSON_WRITE.test(fs.readFileSync(file, "utf8")));
check(
  rawJsonWriters.length === 1 && rawJsonWriters[0].endsWith("src/lib/atomicFile.server.ts"),
  "atomic: every JSON store writes through the shared helper (remaining raw writers: " + rawJsonWriters.join(", ") + ")",
);
fs.rmSync(atomicTmp, { recursive: true, force: true });

// ---- database index plan (2026-09-30 speed bundle) ----
const dbx = require("./compiled/lib/dbIndexes.js");
check(Array.isArray(dbx.DB_INDEX_PLAN) && dbx.DB_INDEX_PLAN.length >= 25, "dbx: plan has >= 25 index definitions");
const planNames = dbx.DB_INDEX_PLAN.map((d) => d.name);
check(new Set(planNames).size === planNames.length, "dbx: index names are unique");
check(
  dbx.DB_INDEX_PLAN.every((d) => d.name && d.table && Array.isArray(d.columns) && d.columns.length > 0 && d.why),
  "dbx: every definition has name, table, columns and a reason",
);
check(
  dbx.DB_INDEX_PLAN.every((d) => d.name.startsWith(d.table + "_") && d.name.endsWith("_idx")),
  "dbx: names follow the <table>_<columns>_idx convention",
);
check(
  dbx.DB_INDEX_PLAN.every((d) => d.columns.every((c) => /^[a-z_]+$/.test(c))),
  "dbx: columns are snake_case database columns (no drizzle camelCase leaked)",
);
check(
  dbx.createIndexSql(dbx.DB_INDEX_PLAN.find((d) => d.name === "orders_customer_id_idx")) ===
    'CREATE INDEX IF NOT EXISTS "orders_customer_id_idx" ON "orders" ("customer_id")',
  "dbx: createIndexSql single column is quoted and idempotent",
);
check(
  dbx.createIndexSql(dbx.DB_INDEX_PLAN.find((d) => d.name === "shift_assignments_work_date_user_id_idx")) ===
    'CREATE INDEX IF NOT EXISTS "shift_assignments_work_date_user_id_idx" ON "shift_assignments" ("work_date", "user_id")',
  "dbx: createIndexSql composite keeps the column order",
);
check(dbx.missingDbIndexes(planNames).length === 0, "dbx: nothing missing when every plan name is live");
const partialLive = planNames.slice(3); // first 3 count as missing
check(
  dbx.missingDbIndexes(partialLive).length === 3 && dbx.missingDbIndexes(partialLive)[0].name === planNames[0],
  "dbx: missing computation returns exactly the absent ones",
);
check(
  dbx.missingDbIndexes(planNames.map((n) => n.toUpperCase())).length === 0,
  "dbx: live index names are compared case-insensitively",
);
for (const mustHave of ["order_operations_order_id_idx", "order_operations_machine_id_idx", "attendance_user_id_idx", "downtime_events_machine_id_idx", "order_materials_item_id_idx"]) {
  check(planNames.includes(mustHave), "dbx: hot path covered — " + mustHave);
}
// Source-level guarantees: Manager-gated route, additive-only SQL, schema parity
const dbIndexesRouteSource = fs.readFileSync("src/app/api/db-indexes/route.ts", "utf8");
check(
  (dbIndexesRouteSource.match(/authorize\("users:manage"\)/g) || []).length === 2,
  "dbx: GET and POST /api/db-indexes both require users:manage",
);
const dbIndexesServerSource = fs.readFileSync("src/lib/dbIndexes.server.ts", "utf8");
check(
  !/DROP\s+(INDEX|TABLE|COLUMN)|ALTER\s+(TABLE|INDEX)|TRUNCATE/i.test(dbIndexesServerSource),
  "dbx: server lib never drops or alters anything",
);
const dbxSchemaSource = fs.readFileSync("src/db/schema.ts", "utf8");
const schemaIndexCount = (dbxSchemaSource.match(/index\("/g) || []).length;
const moduleExtraIndexCount = (dbxSchemaSource.match(/index\("(?:purchase_orders_|purchase_order_lines_|goods_receipts_|goods_receipt_lines_|supplier_bills_|supplier_bill_payments_|invoices_|invoice_lines_|payments_)/g) || []).length;
check(
  schemaIndexCount === dbx.DB_INDEX_PLAN.length + moduleExtraIndexCount && planNames.every((n) => dbxSchemaSource.includes('"' + n + '"')),
  "dbx: schema.ts keeps every planned index, plus purchasing, payables and invoicing-only indexes",
);
const dbxViewSource = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(
  dbxViewSource.includes("/api/db-indexes") && dbxViewSource.includes("Create "),
  "dbx: Schema Check dialog exposes the index check + create button",
);

// ---- i18n dictionary sanity ----
const i18n = require("./compiled/lib/i18n.js");
const arKeys = i18n.translatedKeys("ar");
const frKeys = i18n.translatedKeys("fr");
check(arKeys.length >= 100 && frKeys.length === arKeys.length, "i18n: AR and FR cover the same key set (>=100 labels)");
// A few words are genuinely spelled the same in English and another language
// (PIN, and the French "Urgent" / "Normal"); everything else must differ.
const IDENTICAL_BY_LANGUAGE = { ar: ["PIN"], fr: ["PIN", "Urgent", "Normal"] };
check(arKeys.every((k) => (i18n.tt("ar", k) && i18n.tt("ar", k) !== k) || IDENTICAL_BY_LANGUAGE.ar.includes(k)), "i18n: every AR translation differs from English (PIN excepted)");
check(frKeys.every((k) => (i18n.tt("fr", k) && i18n.tt("fr", k) !== k) || IDENTICAL_BY_LANGUAGE.fr.includes(k)), "i18n: every FR translation differs from English (PIN / Urgent / Normal excepted)");
check(i18n.tt("en", "Executive Dashboard") === "Executive Dashboard", "i18n: EN passthrough");
check(i18n.tt("ar", "Executive Dashboard") === "\u0644\u0648\u062d\u0629 \u0627\u0644\u0642\u064a\u0627\u062f\u0629", "i18n: AR menu label");
check(i18n.tt("fr", "Orders & Routing") === "Commandes & routage", "i18n: FR menu label");
check(i18n.tt("ar", "My Custom Menu Name") === "My Custom Menu Name", "i18n: custom Menu Designer names are untouched");
check(i18n.tt("ar", "Some random UI string") === "Some random UI string", "i18n: unknown strings fall through to English");

// Domain vocabulary + wiring (2026-09-30 coverage bundle): the shop-floor and
// dispatch screens carry the labels people read all day in AR/FR.
check(i18n.tt("ar", "In Production") === "\u0642\u064a\u062f \u0627\u0644\u0625\u0646\u062a\u0627\u062c" && i18n.tt("fr", "In Production") === "En production", "i18n: order status vocabulary");
check(i18n.tt("ar", "Requested") === "\u0645\u0637\u0644\u0648\u0628" && i18n.tt("fr", "Prepared") === "Pr\u00e9par\u00e9", "i18n: warehouse vocabulary");
check(i18n.tt("ar", "Awaiting delivery") === "\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u062a\u0633\u0644\u064a\u0645" && i18n.tt("fr", "QC") === "CQ", "i18n: dispatch stage vocabulary");
check(i18n.tt("ar", "START MATERIAL JOB") === "\u0627\u0628\u062f\u0623 \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0645\u0627\u062f\u0629" && i18n.tt("fr", "REJECT / REWORK") === "REJET / REPRISE", "i18n: shop-floor action vocabulary");
check(i18n.tt("ar", "Morning digest") === "\u0645\u0644\u062e\u0651\u0635 \u0627\u0644\u0635\u0628\u0627\u062d" && i18n.tt("fr", "Print manifest") === "Imprimer le manifeste", "i18n: dashboard / dispatch labels");

// Every label wired through t()/tt() must exist in the dictionary — a typo in
// a key would silently render English on an Arabic screen.
const wiredLabels = new Set();
for (const file of walkSources("src")) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) wiredLabels.add(m[1]);
  for (const m of source.matchAll(/\btt\(\s*[A-Za-z_$.]+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) wiredLabels.add(m[1]);
}
const missingLabels = [...wiredLabels].filter((label) => !arKeys.includes(label));
check(wiredLabels.size >= 50 && missingLabels.length === 0, "i18n: every wired label has an AR/FR entry (" + wiredLabels.size + " wired, missing: " + missingLabels.join(" | ") + ")");

// Language context: deep screens read the top-bar language without prop drilling.
const langCtx = require("./compiled/lib/langContext.js");
check(typeof langCtx.LangProvider === "function" && typeof langCtx.useLang === "function" && typeof langCtx.useT === "function", "i18n: langContext module compiles and exposes LangProvider/useLang/useT");
const langCtxSource = fs.readFileSync("src/lib/langContext.tsx", "utf8");
check(langCtxSource.includes("createContext<Lang>(\"en\")") && langCtxSource.includes("export function useT") && langCtxSource.includes("export function useLang"), "i18n: langContext exposes useT/useLang with an English SSR default");
check(pageSource.includes("import { LangProvider }") && pageSource.includes("<LangProvider lang={lang}>"), "i18n: page.tsx wraps the workspace in LangProvider");
for (const view of ["DashboardView", "OrdersView", "OperatorStationView", "WarehouseView", "ScheduleView"]) {
  const viewSource = fs.readFileSync("src/components/" + view + ".tsx", "utf8");
  check(viewSource.includes("useT") && viewSource.includes("const t = useT();") && viewSource.includes("t(\""), "i18n: " + view + " translates its labels through useT");
}

// Polish: a branded 404 instead of the framework default.
const notFoundSource = fs.readFileSync("src/app/not-found.tsx", "utf8");
check(notFoundSource.includes("Page not found") && notFoundSource.includes("WoodTek ERP") && notFoundSource.includes("href=\"/\""), "polish: branded 404 page explains the dead link and links home");

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

// ---- bundle 29: daily Gantt timeline + Deadline Health board ----
const gm = require("./compiled/lib/ganttModel.js");
const mkStep = (over = {}) => ({
  id: 1, stepOrder: 1, operationName: "Cut", status: "Pending",
  machineCode: "CNC-01", estimatedMinutes: 30,
  scheduledStart: null, scheduledEnd: null, startTime: null, endTime: null,
  batchId: null, batchName: null, batchNumber: null, ...over,
});
const mkOrder = (over = {}) => ({
  id: 10, orderNumber: "ORD-1", title: "Kitchen", customerLabel: "ACME",
  projectType: "Kitchen", priority: "Normal", status: "In Production",
  createdAt: "2026-09-10T09:00:00Z", dueDate: "2026-09-30T17:00:00Z",
  progressPercent: 30, totalValue: null, totalSteps: 2, completedSteps: 1,
  dispatch: { stage: null, mixed: false, deliveredCount: 0, totalBatches: 0, deliveredAt: null },
  steps: [], ...over,
});
const nowFix = new Date("2026-09-18T12:00:00Z").getTime();

const swActual = gm.stepWindow(mkStep({ scheduledStart: "2026-09-10T08:00:00Z", scheduledEnd: "2026-09-10T12:00:00Z", startTime: "2026-09-11T09:00:00Z", endTime: "2026-09-11T11:30:00Z" }));
check(swActual && swActual.kind === "actual" && new Date(swActual.startMs).toISOString() === "2026-09-11T09:00:00.000Z", "gantt model: actual execution dates win over the schedule");
const swScheduled = gm.stepWindow(mkStep({ scheduledStart: "2026-09-10T08:00:00Z", scheduledEnd: "2026-09-10T12:00:00Z" }));
check(swScheduled && swScheduled.kind === "scheduled", "gantt model: scheduled window is used when no actuals exist");
check(gm.stepWindow(mkStep()) === null, "gantt model: an undated step is unscheduled, never invented on the timeline");

const spanOpen = gm.orderSpan(mkOrder());
check(spanOpen.startMs === gm.startOfDayMs("2026-09-10T09:00:00Z") && spanOpen.endMs === gm.endOfDayMs("2026-09-30T17:00:00Z"), "gantt model: candle runs from issue date to due date");
const spanDelivered = gm.orderSpan(mkOrder({ status: "Delivered", dispatch: { stage: "delivered", mixed: false, deliveredCount: 1, totalBatches: 1, deliveredAt: "2026-09-20T10:00:00Z" } }));
check(spanDelivered.endMs === gm.endOfDayMs("2026-09-20T10:00:00Z"), "gantt model: delivered candle ends on the actual delivery date");

const win = gm.computeTimelineWindow([
  mkOrder(),
  mkOrder({ id: 11, createdAt: "2026-09-05T08:00:00Z", dueDate: "2026-09-20T08:00:00Z", status: "Delivered", dispatch: { stage: "delivered", mixed: false, deliveredCount: 1, totalBatches: 1, deliveredAt: "2026-09-17T15:00:00Z" } }),
], nowFix);
check(win.startMs === gm.startOfDayMs("2026-09-04T00:00:00Z") && win.endMs === gm.endOfDayMs("2026-09-30T17:00:00Z") + gm.DAY_MS, "gantt model: auto-fit window pads one day around earliest issue and latest due/delivery");
check(gm.buildDays(win).length === 28, "gantt model: day grid lists every day of the window");

const lanes = gm.assignLanes([
  { startMs: 0, endMs: 10, kind: "scheduled" },
  { startMs: 5, endMs: 15, kind: "scheduled" },
  { startMs: 15, endMs: 20, kind: "scheduled" },
  null,
]);
check(lanes[0] === 0 && lanes[1] === 1 && lanes[2] === 0 && lanes[3] === -1, "gantt model: overlapping steps get distinct lanes, sequential steps reuse lanes");
check(gm.maxLanes(lanes) === 2, "gantt model: lane count reflects peak concurrency");

check(gm.healthBucket(mkOrder({ dueDate: "2026-09-17T09:00:00Z", progressPercent: 40 }), nowFix) === "overdue", "health: past due with open work is Overdue");
check(gm.healthBucket(mkOrder({ dueDate: "2026-09-22T09:00:00Z", progressPercent: 20 }), nowFix) === "at-risk", "health: due within 7 days with low progress is At Risk");
check(gm.healthBucket(mkOrder({ dueDate: "2026-09-22T09:00:00Z", progressPercent: 90, steps: [mkStep({ id: 5, operationName: "Pack" })] }), nowFix) === "at-risk", "health: due within 7 days with an unscheduled step is At Risk");
check(gm.healthBucket(mkOrder({ dueDate: "2026-09-22T09:00:00Z", progressPercent: 80, steps: [mkStep({ id: 5, scheduledStart: "2026-09-19T08:00:00Z", scheduledEnd: "2026-09-19T11:00:00Z" })] }), nowFix) === "on-track", "health: due soon but progressing with everything scheduled stays On Track");
check(gm.healthBucket(mkOrder({ status: "Completed", dueDate: "2026-09-10T09:00:00Z", totalSteps: 3, completedSteps: 3 }), nowFix) === "ready", "health: complete-but-undelivered is Ready even past due, because the remaining action is dispatch");
const delOrder = mkOrder({ status: "Delivered", dueDate: "2026-09-20T09:00:00Z", dispatch: { stage: "delivered", mixed: false, deliveredCount: 1, totalBatches: 1, deliveredAt: "2026-09-17T10:00:00Z" } });
check(gm.healthBucket(delOrder, nowFix) === "delivered", "health: delivered order buckets to delivered");
check(gm.recentlyDelivered(delOrder, nowFix, 14) === true && gm.recentlyDelivered(mkOrder({ status: "Delivered", dispatch: { stage: "delivered", mixed: false, deliveredCount: 1, totalBatches: 1, deliveredAt: "2026-08-20T10:00:00Z" } }), nowFix, 14) === false, "health: recently-delivered window is 14 days");

check(gm.scheduleCrossesDue(mkOrder({ steps: [mkStep({ id: 7, scheduledStart: "2026-09-30T08:00:00Z", scheduledEnd: "2026-10-01T18:00:00Z" })] })) === true, "health: a schedule that crosses the due date is flagged");
check(gm.scheduleCrossesDue(mkOrder({ status: "Delivered", steps: [mkStep({ id: 7, scheduledStart: "2026-09-30T08:00:00Z", scheduledEnd: "2026-10-01T18:00:00Z" })] })) === false, "health: delivered orders are never flagged for a crossing plan");
const nextOrder = mkOrder({ steps: [mkStep({ id: 1, stepOrder: 1, status: "Completed" }), mkStep({ id: 2, stepOrder: 3, operationName: "QA" }), mkStep({ id: 3, stepOrder: 2, operationName: "Edge" })] });
check(gm.nextOpenStep(nextOrder)?.operationName === "Edge", "health: next open step follows route order, not id order");
check(gm.unscheduledStepCount(nextOrder) === 2, "health: unscheduled count only counts undated steps");

check(
  ganttApiSource.includes('authorize("orders:read")')
    && ganttApiSource.includes("listOrdersForUser(user)")
    && ganttApiSource.includes("listOperationsForUser(user)")
    && ganttApiSource.includes("readDispatchStore()"),
  "gantt api: orders and operations reach the endpoint only through the scoped access helpers",
);
check(
  !ganttApiSource.includes("from(orders)") && !ganttApiSource.includes("from(orderOperations)"),
  "gantt api: no direct order/operation table query bypasses the deny-by-default subqueries",
);
check(
  ganttViewSource.includes('fetch("/api/gantt", { cache: "no-store" })')
    && ganttViewSource.includes("computeTimelineWindow")
    && ganttViewSource.includes("healthBucket")
    && ganttViewSource.includes("assignLanes")
    && ganttViewSource.includes("orderSpan"),
  "gantt view: timeline is driven by the pure model (true-dated steps, auto-fit window, health buckets)",
);

// ---- bundle 29b: grey "claimed elsewhere" card on the operator station ----
const nowT = Date.parse("2026-09-18T12:00:00Z");
check(omc.isWithinClaimedElsewhereGrace("2026-09-18T11:55:00Z", null, nowT) === true, "claimed elsewhere: a job started 5 minutes ago still shows grey");
check(omc.isWithinClaimedElsewhereGrace("2026-09-18T11:49:00Z", null, nowT) === false, "claimed elsewhere: older than the 10-minute grace window fades away");
check(omc.isWithinClaimedElsewhereGrace(null, "2026-09-18T11:58:00Z", nowT) === true, "claimed elsewhere: falls back to updatedAt when the start stamp is missing");
check(omc.isWithinClaimedElsewhereGrace(null, null, nowT) === false, "claimed elsewhere: never shown without a time stamp");
check(omc.isWithinClaimedElsewhereGrace("2026-09-18T12:00:30Z", null, nowT) === true && omc.isWithinClaimedElsewhereGrace("2026-09-18T12:05:00Z", null, nowT) === false, "claimed elsewhere: small clock skew tolerated, no far-future work");
check(
  operationsSource.includes("listClaimedElsewhereOperationsForUser")
    && operationsSource.includes("claimedByMachineCode")
    && dataAccessSource.includes("isWithinClaimedElsewhereGrace")
    && dataAccessSource.includes("ne(orderOperations.machineId, machineId)"),
  "claimed elsewhere: the station queue receives taken jobs from a scoped, time-boxed read only",
);
check(
  stationSource.includes("setClaimedElsewhere")
    && stationSource.includes("grayscale")
    && stationSource.includes("Just taken at another station"),
  "claimed elsewhere: the station renders the taken job as a grey, non-actionable card",
);

// ---- bundle 30: tolerant machine-category matching for multi-station candidates ----
check(omc.normalizeMachineCategory("  Beam Saw ") === "beam saw", "category match: names are trimmed and lower-cased");
check(omc.machineCategoryMatches("Beam Saw", "beam saw") === true, "category match: case/spacing drift never blocks a second station");
check(omc.machineCategoryMatches("", "Beam Saw") === true && omc.machineCategoryMatches("Beam Saw", null) === true, "category match: a missing category cannot disqualify a machine");
check(omc.machineCategoryMatches("Beam Saw", "Edge Banding") === false, "category match: an explicit different category is still rejected");
check(
  operationActionSource.includes("normalizeMachineCategory(requiredCategoryDisplay)")
    && !operationActionSource.includes("machine.category.toLowerCase() !=="),
  "candidate server: normalized comparison, machine actually running the step anchors the equivalence class",
);
check(
  orderWorkflowSource.includes("machineCategoryMatches(op.machineCategory, machine.category)"),
  "candidate UI: station chips use the same tolerant category match as the server",
);

// ---- bundle 31: multi-station machine assignment on Material Reception ----
const bomBoardSource = fs.readFileSync("src/app/api/bom/route.ts", "utf8");
const floorReceptionSource = fs.readFileSync("src/components/FloorReceptionView.tsx", "utf8");
check(
  bomBoardSource.includes("candidateMachineIds: operationMachineCandidates(op.id, op.machineId, op.status)"),
  "reception board: every operation carries its effective candidate station set",
);
check(
  floorReceptionSource.includes("body: JSON.stringify({ candidateMachineIds: nextIds })") &&
    floorReceptionSource.includes("First Start claims one"),
  "reception board: machine assignment is a multi-select candidate offer, not a single reassignment",
);

// ---- bundle 32: production & utilization report model ----
const pr = require("./compiled/lib/productionReport.js");
const dt = (y, mo, day, h, mi) => new Date(y, mo, day, h, mi, 0, 0);
const now32 = dt(2026, 8, 16, 14, 0); // Wednesday, local time
const prMachines = [
  { id: 1, code: "BEAM-01", name: "Beam 1", category: "Beam Saw", status: "Active" },
  { id: 2, code: "BEAM-02", name: "Beam 2", category: "Beam Saw", status: "In-Use" },
  { id: 3, code: "EDGE-01", name: "Edge 1", category: "Edge Banding", status: "Maintenance" },
];
const prOp = (over) => ({
  id: 0, orderId: 1, operationName: "Step", status: "Pending",
  estimatedMinutes: 60, actualMinutes: 0,
  machineId: null, machineCode: null, machineCategory: null,
  operatorId: null, operatorName: null,
  startTime: null, endTime: null, scheduledStart: null, scheduledEnd: null,
  ...over,
});
const prOps = [
  prOp({ id: 1, machineId: 1, operatorId: 10, operatorName: "Rami", status: "Completed", estimatedMinutes: 60, actualMinutes: 75, startTime: dt(2026, 8, 16, 9, 0), endTime: dt(2026, 8, 16, 10, 10), scheduledStart: dt(2026, 8, 16, 9, 0) }),
  prOp({ id: 2, machineId: 2, operatorId: 20, operatorName: "Khalil", status: "Completed", startTime: dt(2026, 8, 16, 10, 0), endTime: dt(2026, 8, 16, 11, 30), scheduledStart: dt(2026, 8, 16, 11, 0) }),
  prOp({ id: 3, machineId: 1, operatorId: 10, operatorName: "Rami", status: "In Progress", estimatedMinutes: 90, startTime: dt(2026, 8, 16, 13, 0) }),
  prOp({ id: 4, machineId: 3, operatorId: 10, operatorName: "Rami", status: "Pending", scheduledStart: dt(2026, 8, 16, 8, 0) }),
  prOp({ id: 5, machineId: 1, operatorId: 10, operatorName: "Rami", status: "Completed", estimatedMinutes: 45, actualMinutes: 50, startTime: dt(2026, 8, 15, 16, 0), endTime: dt(2026, 8, 15, 17, 0), scheduledStart: dt(2026, 8, 15, 16, 0) }),
  prOp({ id: 6, machineId: 2, operatorId: 20, operatorName: "Khalil", status: "In Progress", estimatedMinutes: 30, startTime: dt(2026, 8, 16, 10, 15), scheduledStart: dt(2026, 8, 16, 10, 0) }),
  prOp({ id: 7, machineId: 2, operatorId: 20, operatorName: "Khalil", status: "In Progress", estimatedMinutes: 30, startTime: dt(2026, 8, 16, 12, 16), scheduledStart: dt(2026, 8, 16, 12, 0) }),
];
const prToday = pr.buildProductionReport({ ops: prOps, machines: prMachines, range: "today", now: now32 });
check(pr.rangeWindow("today", now32).from.getTime() === dt(2026, 8, 16, 0, 0).getTime(), "production report: today window starts at local midnight");
check(pr.rangeWindow("week", now32).from.getDay() === 0, "production report: week window starts on Sunday");
check(pr.rangeWindow("yesterday", now32).from.getTime() === dt(2026, 8, 15, 0, 0).getTime() && pr.rangeWindow("yesterday", now32).to.getTime() === dt(2026, 8, 16, 0, 0).getTime(), "production report: yesterday window is the full prior day");
check(prToday.kpis.completed === 2 && prToday.kpis.actualMinutes === 165, "production report: only Completed jobs with endTime in window count, start→end span fills missing actuals");
check(prToday.kpis.plannedMinutes === 120 && Math.abs(prToday.kpis.planCoverage - 1.375) < 1e-9, "production report: plan coverage is actual/planned for completed jobs");
check(prToday.kpis.onTimeEligible === 4 && prToday.kpis.onTimeStarts === 3 && Math.abs(prToday.kpis.onTimeRate - 0.75) < 1e-9, "production report: on-time grace is inclusive at 15 minutes and early starts count");
check(prToday.kpis.inProgress === 3 && prToday.kpis.overdue === 1, "production report: in-flight jobs are live, overdue means scheduled but not started");
const prBeam2 = prToday.machines.find((m) => m.code === "BEAM-02");
const prBeam1 = prToday.machines.find((m) => m.code === "BEAM-01");
const prEdge1 = prToday.machines.find((m) => m.code === "EDGE-01");
check(prToday.machines[0].code === "BEAM-02" && prBeam2.actualMinutes === 90 && prBeam2.onTimeStarts === 2, "production report: machine rows aggregate per station and sort by worked time");
check(prBeam1.completed === 1 && prBeam1.actualMinutes === 75 && prBeam1.avgEstimatedMinutes === 60, "production report: stored actuals win over the start→end span");
check(prEdge1.completed === 0 && prEdge1.overdue === 1, "production report: idle machines stay listed with their overdue backlog");
check(prToday.operators[0].name === "Khalil" && prToday.operators[0].actualMinutes === 90 && prToday.operators[1].name === "Rami", "production report: operator ranking by completions then worked time");
const prYesterday = pr.buildProductionReport({ ops: prOps, machines: prMachines, range: "yesterday", now: now32 });
check(prYesterday.kpis.completed === 1 && prYesterday.kpis.overdue === 0 && prYesterday.kpis.onTimeRate === 1, "production report: period windowing keeps jobs in their own day");
const prEmpty = pr.buildProductionReport({ ops: [], machines: prMachines, range: "today", now: now32 });
check(prEmpty.kpis.planCoverage === null && prEmpty.kpis.onTimeRate === null && prEmpty.machines.length === 3, "production report: no work yields null rates and the full roster of zeros");

// ---- bundle 33: due-date fit detection (issue-time + Dispatch panel) ----
const ddf = require("./compiled/lib/dueDateFit.js");
const ddfNow = new Date(2026, 8, 18, 12, 0, 0).getTime();
const ddfDue = new Date(2026, 8, 25, 17, 0, 0);
const ddfFits = (ops) => ddf.evaluateDueDateFit(ddfDue, ops, ddfNow);
check(ddfFits([
  { status: "Completed", scheduledEnd: null, endTime: new Date(2026, 8, 18, 10, 0, 0) },
  { status: "Ready", scheduledEnd: new Date(2026, 8, 24, 15, 0, 0), endTime: null },
]).fits === true, "due-date fit: known work finishing before the due date fits");
const ddfOverrun = ddfFits([{ status: "Ready", scheduledEnd: new Date(2026, 8, 26, 15, 0, 0), endTime: null }]);
check(ddfOverrun.fits === false && ddfOverrun.overrunMs === 22 * 3600 * 1000, "due-date fit: a scheduled end past the due date is an overrun with the exact margin");
check(ddfFits([{ status: "Pending", scheduledEnd: null, endTime: null }]).fits === null, "due-date fit: waiting passes without a slot make the date unconfirmable");
check(ddfFits([
  { status: "Ready", scheduledEnd: new Date(2026, 8, 26, 9, 0, 0), endTime: null },
  { status: "Pending", scheduledEnd: null, endTime: null },
]).fits === false, "due-date fit: a known overrun stays definite even with unscheduled passes left");
const ddfLate = ddfFits([{ status: "Completed", scheduledEnd: null, endTime: new Date(2026, 8, 26, 8, 0, 0) }]);
check(ddfLate.fits === false && ddfLate.hasCompletedLate === true, "due-date fit: work already finished late is an overrun");
const ddfInFlight = ddfFits([{ status: "In Progress", scheduledEnd: null, endTime: null }]);
check(ddfInFlight.fits === true && ddfInFlight.hasInFlight === true, "due-date fit: in-flight work is assumed to finish after now and can still fit");
check(ddf.formatOverrun(76 * 3600 * 1000) === "3d 4h" && ddf.formatOverrun(260 * 60 * 1000) === "4h 20m" && ddf.formatOverrun(25 * 60 * 1000) === "25m", "due-date fit: human overrun formatting");
check(ddf.evaluateDueDateFit(null, [{ status: "Pending", scheduledEnd: null, endTime: null }], ddfNow).hasDueDate === false, "due-date fit: a missing due date is not a risk");
const ddfServerSource = fs.readFileSync("src/lib/dispatchScheduling.server.ts", "utf8");
const ddfWizardSource = fs.readFileSync("src/components/NewOrderWizard.tsx", "utf8");
const ddfScheduleSource = fs.readFileSync("src/components/ScheduleView.tsx", "utf8");
check(ddfServerSource.includes("evaluateDueDateFit(") && ddfServerSource.includes("dueDateWarnings"), "due-date fit: the planner reports due-date warnings at issue time");
check(ddfWizardSource.includes("Due-date check:"), "due-date fit: order issue surfaces the due-date warning to the user");
check(ddfScheduleSource.includes("Due-date risk") && ddfScheduleSource.includes("evaluateDueDateFit("), "due-date fit: the Dispatch board shows a live due-date risk panel");

// ---- bundle 34: automated nightly backup (Postgres + JSON overlay) ----
const backupScriptSource = fs.readFileSync("backup/backup-woodtek.ps1", "utf8");
const backupInstallerSource = fs.readFileSync("backup/install-backup-task.bat", "utf8");
check(
  backupScriptSource.includes("pg_dump") && backupScriptSource.includes("RetentionDays") && backupScriptSource.includes("Compress-Archive") && backupScriptSource.includes("DATABASE_URL"),
  "nightly backup: script dumps Postgres, zips the data overlay and applies retention",
);
check(
  backupInstallerSource.includes('schtasks /Create /F /TN "WoodTek Nightly Backup"') && backupInstallerSource.includes("/SC DAILY"),
  "nightly backup: installer registers the daily scheduled task and runs a first backup",
);

// ---- bundle 35: station new-job alerts (beep + browser notification) ----
compile("src/lib/stationAlerts.ts", "lib/stationAlerts.js");
const sa = require("./compiled/lib/stationAlerts.js");
check(sa.newStationJobRows(new Set(), [{ id: 1, orderNumber: "PO-1", operationName: "Cut" }]).length === 0, "station alerts: the initial queue is never announced");
check(sa.newStationJobRows(new Set([1, 2]), [{ id: 1 }, { id: 2 }, { id: 3, orderNumber: "PO-2", operationName: "Edge" }]).map((r) => r.id).join(",") === "3", "station alerts: only rows new since the previous poll are announced");
check(sa.stationAlertTitle(1) === "WoodTek — 1 new job" && sa.stationAlertTitle(2) === "WoodTek — 2 new jobs", "station alerts: title singular/plural");
check(sa.stationAlertBody([{ id: 3, orderNumber: "PO-2", operationName: "Edge" }]) === "PO-2 · Edge", "station alerts: one body line per fresh job");
const stationAlertSource = fs.readFileSync("src/components/OperatorStationView.tsx", "utf8");
check(
  stationAlertSource.includes("playAlertBeep()") &&
    stationAlertSource.includes("announceNewJobs(freshRows)") &&
    stationAlertSource.includes("Notification.requestPermission()"),
  "station alerts: beep + browser notification are wired to the fresh-queue detection",
);

// ---- bundle 36: stock check at order issue ----
compile("src/lib/stockCheck.ts", "lib/stockCheck.js");
const sc = require("./compiled/lib/stockCheck.js");
const scShort = sc.evaluateStockLine({ sku: "MDF-18", name: "MDF 18mm", quantity: 30, stockQuantity: 40, reservedBefore: 15, reorderLevel: 10 });
check(scShort.status === "short" && scShort.availableBefore === 25 && scShort.message.includes("short by 5"), "stock check: request beyond available-after-other-reservations is short with exact margin");
check(sc.evaluateStockLine({ sku: "MDF-18", name: "MDF 18mm", quantity: 5, stockQuantity: 12, reservedBefore: 0, reorderLevel: 10 }).status === "below-reorder", "stock check: fulfilling still leaves stock below the reorder point");
const scOk = sc.evaluateStockLine({ sku: "MDF-18", name: "MDF 18mm", quantity: 2, stockQuantity: 50, reservedBefore: 0, reorderLevel: 10 });
check(scOk.status === "ok" && scOk.message === null && scOk.availableAfter === 48, "stock check: healthy lines carry no warning and report the post-issue balance");
const scSummary = sc.stockCheckSummary([scShort, scOk]);
check(scSummary.warnings.length === 1 && scSummary.warnings[0].startsWith("MDF-18: "), "stock check: summary warnings are SKU-prefixed, one per unhealthy line");
check(sc.evaluateStockLine({ sku: "MDF-18", name: "MDF 18mm", quantity: 10, stockQuantity: 12, reservedBefore: 0, reorderLevel: 0 }).status === "ok", "stock check: no reorder point set means no below-reorder warning");
const createRouteSource = fs.readFileSync("src/app/api/orders/route.ts", "utf8");
const wizardAlertSource = fs.readFileSync("src/components/NewOrderWizard.tsx", "utf8");
check(createRouteSource.includes("computeAvailability()") && createRouteSource.includes("stockCheck"), "stock check: order issue evaluates stock from a pre-issue snapshot on both create paths");
check(wizardAlertSource.includes("Stock check:"), "stock check: the wizard surfaces the stock check in the post-issue alert");

// ---- bundle 37: no order can be issued without materials ----
const ordersPostSource = fs.readFileSync("src/app/api/orders/route.ts", "utf8");
const wizardMaterialsSource = fs.readFileSync("src/components/NewOrderWizard.tsx", "utf8");
check(
  ordersPostSource.includes("hasMaterialJobs") &&
    ordersPostSource.includes("An order cannot be issued without materials"),
  "material rule: the API rejects orders with no material jobs or BOM lines",
);
check(
  wizardMaterialsSource.includes("An order cannot be issued without materials") &&
    wizardMaterialsSource.includes("disabled={submitting || materials.length === 0}"),
  "material rule: the wizard blocks review and disables Issue with zero materials",
);

// ---- bundle 38: panel dimensions on Wood & Edge Stock ----
compile("src/lib/inventoryDimensions.ts", "lib/inventoryDimensions.js");
const idd = require("./compiled/lib/inventoryDimensions.js");
check(idd.isPanelCategory("Wood & MDF Panels") === true && idd.isPanelCategory("Edge Banding") === false, "panel dimensions: the field is panel-category driven");
check(idd.validateDimensions("2440 x 1220 x 18") === null, "panel dimensions: canonical L x W x Thickness accepted");
check(idd.validateDimensions("2440×1220×18") === null && idd.validateDimensions("2440 x 1220 x 18 mm") === null && idd.validateDimensions("18") === null, "panel dimensions: × separator, unit suffix and single value tolerated");
check(idd.validateDimensions("wide board") !== null && idd.validateDimensions("1 x 2 x 3 x 4 x 5") !== null, "panel dimensions: non-numeric or more than 4 parts rejected");
check(idd.validateDimensions("") === null && idd.normalizeDimensions(" 2440  x 1220 ") === "2440 x 1220", "panel dimensions: empty clears and whitespace normalizes");
const invRouteSource = fs.readFileSync("src/app/api/inventory/route.ts", "utf8");
const invItemRouteSource = fs.readFileSync("src/app/api/inventory/[id]/route.ts", "utf8");
const invViewSource = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(invRouteSource.includes("readInventoryDimensions()") && invRouteSource.includes("setInventoryDimension("), "panel dimensions: the stock API reads and persists the dimensions overlay");
check(invItemRouteSource.includes("validateDimensions(dims)") && invItemRouteSource.includes("deleteInventoryDimension("), "panel dimensions: item update validates/clears and deletion removes the overlay entry");
check(invViewSource.includes("isPanelCategory(category)") && invViewSource.includes("item.dimensions"), "panel dimensions: the form shows the field for panels only and the list displays it");

// ---- bundle 39: manager-editable stock categories (add / rename / remove) ----
compile("src/lib/inventoryCategories.ts", "lib/inventoryCategories.js");
const ic = require("./compiled/lib/inventoryCategories.js");
check(ic.DEFAULT_INVENTORY_CATEGORIES.length === 4 && ic.DEFAULT_INVENTORY_CATEGORIES[0] === "Wood & MDF Panels", "stock categories: defaults seed existing deployments");
check(ic.sanitizeInventoryCategories(["Panel", "panel ", "Edge"]).length === 2, "stock categories: sanitize trims and dedupes case-insensitively");
const invCatsRouteSource = fs.readFileSync("src/app/api/inventory-categories/route.ts", "utf8");
check(
  invCatsRouteSource.includes('authorize("users:manage")') &&
    invCatsRouteSource.includes("cannot be removed") &&
    invCatsRouteSource.includes("renameItemsCategory("),
  "stock categories: Manager-only edits, in-use protection, renames migrate item rows",
);
const importRouteSource2 = fs.readFileSync("src/app/api/inventory/import/route.ts", "utf8");
check(importRouteSource2.includes("effectiveInventoryCategories()"), "stock categories: the Excel import validates against the live category list");
const invViewManageSource = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(
  invViewManageSource.includes("/api/inventory-categories") &&
    invViewManageSource.includes("Manage Stock Categories") &&
    invViewManageSource.includes("canManageStockCategories"),
  "stock categories: the stock screen fetches the list and exposes a Manager-only Manage dialog",
);

// ---- bundle 40: modal containment fix, item editing, delete-all stock ----
const globalsSource = fs.readFileSync("src/app/globals.css", "utf8");
check(/to\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*\}/.test(globalsSource), "modal fix: fade-up keyframe ends with transform:none so fixed modals anchor to the viewport");
const delAllSource = fs.readFileSync("src/app/api/inventory/all/route.ts", "utf8");
check(
  delAllSource.includes('authorize("users:manage")') &&
    delAllSource.includes("db.delete(materialConsumptions)") &&
    delAllSource.includes("db.delete(inventoryItems)") &&
    delAllSource.includes("clearInventoryDimensions()"),
  "delete-all stock: Manager-only, clears ledger rows before items, wipes dimensions overlay",
);
const invIdSource = fs.readFileSync("src/app/api/inventory/[id]/route.ts", "utf8");
check(invIdSource.includes("db.delete(materialConsumptions)"), "delete-all stock: single-item delete also clears consumption FK rows");
const invViewEditSource = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(
  invViewEditSource.includes("openEditItem") &&
    invViewEditSource.includes("/api/inventory/${editingId}") &&
    invViewEditSource.includes("Edit Stock Item"),
  "item editing: rows expose an Edit dialog that PATCHes the existing item",
);
check(
  invViewEditSource.includes("/api/inventory/all") &&
    invViewEditSource.includes('wipeConfirm !== "DELETE"') &&
    invViewEditSource.includes("Delete ALL Stock Items"),
  "delete-all stock: Manager-only button with type-to-confirm dialog",
);
check(
  invViewEditSource.includes("Reorder Level") && invViewEditSource.includes("Shop Location"),
  "item form: reorder level and shop location are visible fields on create and edit (Bundle 40b)",
);
const layoutSource = fs.readFileSync("src/app/layout.tsx", "utf8");
check(
  layoutSource.includes("woodtek-err-banner") &&
    layoutSource.includes("unhandledrejection") &&
    layoutSource.includes("window.addEventListener(\"error\""),
  "layout: inline window-error banner surfaces JS failures (incl. chunk 404) instead of a silent freeze (Bundle 40c)",
);
const invIdRoute40d = fs.readFileSync("src/app/api/inventory/[id]/route.ts", "utf8");
check(
  invIdRoute40d.includes('logAudit(user, "inventory.item.delete"') &&
    invIdRoute40d.includes("import { logAudit }") &&
    invIdRoute40d.includes("error?.cause?.message"),
  "single-item delete: audit entry + root-cause DB error surfaced (Bundle 40d/40e)",
);
const invAllRoute40e = fs.readFileSync("src/app/api/inventory/all/route.ts", "utf8");
check(invAllRoute40e.includes("causeMessage"), "delete-all: root-cause DB error surfaced (Bundle 40e)");

// ---- bundle 40f: live schema check & repair for the stock tables ----
const schemaLib = fs.readFileSync("src/lib/inventorySchemaCheck.server.ts", "utf8");
check(
  schemaLib.includes("ADD COLUMN IF NOT EXISTS") &&
    schemaLib.includes("information_schema.columns") &&
    schemaLib.includes("material_consumptions"),
  "schema check: compares live stock tables to expected columns; repair only adds missing columns",
);
const schemaRouteSource = fs.readFileSync("src/app/api/inventory/schema-check/route.ts", "utf8");
check(
  schemaRouteSource.includes('authorize("users:manage")') &&
    schemaRouteSource.includes("repairInventorySchema()"),
  "schema check: Manager-only endpoint with GET check + POST repair",
);
const invView40f = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(
  invView40f.includes("Schema Check") &&
    invView40f.includes("/api/inventory/schema-check") &&
    invView40f.includes("Add Missing Columns") &&
    invView40f.includes("blocking (NOT NULL, no default)"),
  "schema check: Manager-only dialog on the stock screen with one-click repair (missing + blocking columns)",
);

// ---- bundle 40g: NOT NULL repair, consume cause surfacing, re-consume ----
check(
  schemaLib.includes("DROP NOT NULL") &&
    schemaLib.includes("is_nullable") &&
    schemaLib.includes("idHasDefault"),
  "schema check: detects legacy NOT NULL columns without defaults and relaxes them on repair",
);
const ordersIdRoute40g = fs.readFileSync("src/app/api/orders/[id]/route.ts", "utf8");
check(ordersIdRoute40g.includes('console.error("PATCH order error:", error);\r\n    const detail = error?.cause?.message'), "order PATCH: consume failures surface the root-cause DB error");
const owd40g = fs.readFileSync("src/components/OrderWorkflowDetail.tsx", "utf8");
check(
  owd40g.includes("retryConsumeMaterials") &&
    owd40g.includes("Run consumption now") &&
    owd40g.includes('order.status !== "On Hold"') &&
    owd40g.includes("materials.length > 0") &&
    owd40g.includes("actionWarning") &&
    owd40g.includes("result.warning"),
  "orders: re-consume button + amber warning banner for degraded completions",
);

// ---- bundle 40i: automatic completion must never be blocked by the audit table ----
const materials40i = fs.readFileSync("src/lib/materials.ts", "utf8");
check(
  materials40i.includes("Phase 1") &&
    materials40i.includes("Phase 2") &&
    materials40i.includes("auditError"),
  "consume: ledger commits first, audit write is best-effort (two phases) so completion stays automatic",
);
check(
  ordersIdRoute40g.includes("completionWarning") &&
    ordersIdRoute40g.includes("warning: completionWarning"),
  "order PATCH: degraded completion returns 200 with a warning instead of failing",
);
const invView40d = fs.readFileSync("src/components/InventoryView.tsx", "utf8");
check(
  invView40d.includes("setConfirmDelete(") &&
    invView40d.includes("Remove Stock Item") &&
    invView40d.includes("Delete failed:") &&
    !/if \(!confirm\(/.test(invView40d),
  "single-item delete: in-app confirm dialog replaces native confirm; server errors are shown, not swallowed (Bundle 40d)",
);

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
// ---- bundle 40j: send-time consumption, modal placement, full order history ----
const materialsLib40j = fs.readFileSync("src/lib/materials.ts", "utf8");
const warehouseViewSource40j = fs.readFileSync("src/components/WarehouseView.tsx", "utf8");
const invOrdersApi40j = fs.readFileSync("src/app/api/inventory/[id]/orders/route.ts", "utf8");
check(
  bomBoardSource.includes("applyBomSendDelta") &&
    bomBoardSource.includes("itemId: orderMaterials.itemId") &&
    bomBoardSource.includes("prevSent") && bomBoardSource.includes("newSent !== prevSent") &&
    bomBoardSource.includes("warning: sendWarning"),
  "warehouse send consumes stock: BOM PUT applies the send delta to the stock ledger",
);
check(
  materialsLib40j.includes("applyBomSendDelta") &&
    materialsLib40j.includes("GREATEST(0, ${inventoryItems.stockQuantity} - ${delta})") &&
    materialsLib40j.includes("BOM line sent to floor") &&
    materialsLib40j.includes("BOM send undone, stock restored"),
  "applyBomSendDelta: consumes on send (never below zero), restores on undo, audit best-effort",
);
check(
  warehouseViewSource40j.includes("setWarn(data.warning") &&
    warehouseViewSource40j.includes("Sending consumes the shop stock immediately"),
  "warehouse screen: send warnings are surfaced + subtitle explains send = consumption",
);
check(
  !invOrdersApi40j.includes("eq(orderMaterials.released, false)") &&
    !invOrdersApi40j.includes('ne(orders.status, "Cancelled")') &&
    invOrdersApi40j.includes("a.consumed || a.released"),
  "per-material Orders: lists ALL orders using the item, incl. completed/delivered history",
);
check(
  (inventoryViewSource.match(/createPortal\(/g) || []).length >= 7 &&
    inventoryViewSource.includes("document.body") &&
    inventoryViewSource.includes("consumed, completed & delivered orders"),
  "inventory modals portal to document.body (always centered on the visible screen)",
);



// ---- bundle 41: printable job ticket (one sheet per order, per-batch cut lists) ----
const jt = require("./compiled/lib/jobTicket.js");
check(jt.jobTicketFilename("PO-0099/2026") === "JobTicket-PO-0099-2026.pdf", "job ticket: filename sanitises slashes to dashes");
check(jt.jobTicketFilename("  a/b:c  ").startsWith("JobTicket-"), "job ticket: filename handles weird characters");
check(jt.formatJobDate("2026-09-30T12:00:00Z").includes("2026") || jt.formatJobDate("2026-09-30T12:00:00Z") === "—", "job ticket: date formatting never throws");
check(jt.formatJobDate("invalid") === "—", "job ticket: invalid date falls back to dash");
const sampleTicketOrder = {
  id: 99,
  orderNumber: "PO-0099/2026",
  title: "Kitchen & Wardrobe <test>",
  projectType: "Custom Kitchens",
  priority: "Urgent",
  status: "In Production",
  dueDate: "2026-09-30T12:00:00Z",
  createdAt: "2026-09-18T08:00:00Z",
  progressPercent: 40,
  customerCompany: "ACME Joinery",
  customerName: "Owner",
  customerPhone: "03 12345",
  customerEmail: "a@b.com",
  notes: "Handle with care & check <edges>",
  productionPlan: {
    orderId: 99,
    createdAt: "2026-09-18T08:00:00Z",
    defaultSteps: [],
    items: [
      {
        materialId: 71,
        itemId: 12,
        name: "Kitchen doors",
        quantityUsed: 8,
        routeSource: "recipe",
        recipeId: 3,
        recipeName: "Cut + edge",
        steps: [
          { operationId: 800, position: 1, stageKey: "1. First Saw", operationName: "First Saw", machineCategory: "Beam Saw", estimatedMinutes: 90, auto: true, machineId: 1 },
          { operationId: 801, position: 2, stageKey: "2. Edge Banding", operationName: "Edge Banding", machineCategory: "Edge Bander", estimatedMinutes: 60, auto: true, machineId: 2 },
        ],
      },
      {
        materialId: 72,
        itemId: 13,
        name: "Wall panels",
        quantityUsed: 5,
        routeSource: "custom",
        recipeId: null,
        recipeName: "",
        steps: [
          { operationId: 802, position: 1, stageKey: "1. Press", operationName: "Press", machineCategory: "Press", estimatedMinutes: 120, auto: false, machineId: 5 },
        ],
      },
    ],
  },
  operations: [
    { id: 800, stepOrder: 1, operationName: "First Saw", machineCategory: "Beam Saw", machineId: 1, machineCode: "BEAM-01", machineName: "Beam Saw", estimatedMinutes: 90, status: "Ready", scheduledStart: "2026-09-19T08:00:00Z", scheduledEnd: "2026-09-19T09:30:00Z" },
    { id: 801, stepOrder: 2, operationName: "Edge Banding", machineCategory: "Edge Bander", machineId: 2, machineCode: "EDGE-01", machineName: "Edge", estimatedMinutes: 60, status: "Pending", scheduledStart: null, scheduledEnd: null },
    { id: 802, stepOrder: 3, operationName: "Press", machineCategory: "Press", machineId: 5, machineCode: "PRESS-01", machineName: "Press", estimatedMinutes: 120, status: "Pending", scheduledStart: null, scheduledEnd: null },
  ],
  materials: [
    { id: 71, itemId: 12, itemName: "MDF 18mm", itemSku: "MDF-18", itemUnit: "sheets", quantityUsed: 8, costPerUnit: "12.00" },
    { id: 72, itemId: 13, itemName: "Oak Veneer", itemSku: "VEN-OAK", itemUnit: "sheets", quantityUsed: 5, costPerUnit: "20.00" },
  ],
};
const ticketInv = [
  { id: 12, sku: "MDF-18", name: "MDF 18mm", unit: "sheets", dimensions: "2440 x 1220 x 18", location: "Rack A1" },
  { id: 13, sku: "VEN-OAK", name: "Oak Veneer", unit: "sheets", dimensions: "", location: "Rack B2" },
];
const ticketMachines = [
  { id: 1, code: "BEAM-01", name: "Beam Saw", category: "Beam Saw", status: "Active" },
  { id: 2, code: "EDGE-01", name: "Edge", category: "Edge Bander", status: "Active" },
  { id: 5, code: "PRESS-01", name: "Press", category: "Press", status: "Active" },
];
const ticketHtml = jt.buildJobTicketHtml(sampleTicketOrder, { inventoryItems: ticketInv, machines: ticketMachines, qrDataUrl: "data:image/png;base64,abc123" });
check(ticketHtml.includes("WOODTEK") && ticketHtml.includes("Job Ticket") && ticketHtml.includes("PO-0099/2026"), "job ticket: HTML header with branding, ticket label and order number");
check(ticketHtml.includes("ACME Joinery") && ticketHtml.includes("03 12345"), "job ticket: client block with company and phone");
check(ticketHtml.includes("Kitchen &amp; Wardrobe &lt;test&gt;"), "job ticket: title is HTML-escaped");
check(ticketHtml.includes("Handle with care &amp; check &lt;edges&gt;"), "job ticket: notes are HTML-escaped");
check(ticketHtml.includes("CUT LIST") && ticketHtml.includes("BATCH 1") && ticketHtml.includes("Kitchen doors") && ticketHtml.includes("BATCH 2") && ticketHtml.includes("Wall panels"), "job ticket: every material batch has its own cut-list card with batch number and name");
check(ticketHtml.includes("2440 x 1220 x 18") && ticketHtml.includes("Rack A1") && ticketHtml.includes("Rack B2"), "job ticket: panel dimensions and shop location appear per batch");
check(ticketHtml.includes("BEAM-01") && ticketHtml.includes("First Saw") && ticketHtml.includes("EDGE-01") && ticketHtml.includes("PRESS-01"), "job ticket: each pass shows operation name and assigned station code");
check(ticketHtml.includes("Done") && ticketHtml.includes("Operator") && ticketHtml.includes("data:image/png;base64,abc123"), "job ticket: tick-boxes, operator column and QR code embedded");
check(ticketHtml.includes("Floor instructions") && ticketHtml.includes("one batch at a time") && ticketHtml.includes("Operator signature") && ticketHtml.includes("Supervisor"), "job ticket: floor instructions and sign-off lines for the shop");
check(ticketHtml.includes("2 material batch") && ticketHtml.includes("3 station pass"), "job ticket: summary chips count batches, passes and estimated time");
const legacyOrder = {
  id: 100,
  orderNumber: "PO-0100/2026",
  title: "Legacy table",
  projectType: "Wardrobes",
  priority: "Normal",
  status: "Pending",
  dueDate: "2026-10-01T00:00:00Z",
  createdAt: "2026-09-18T08:00:00Z",
  progressPercent: 0,
  customerCompany: "Globex",
  operations: [
    { id: 901, stepOrder: 1, operationName: "Cutting", machineCategory: "Beam Saw", machineId: null, estimatedMinutes: 60, status: "Ready", scheduledStart: null, scheduledEnd: null },
    { id: 902, stepOrder: 2, operationName: "Assembly", machineCategory: "Assembly", machineId: null, estimatedMinutes: 45, status: "Pending", scheduledStart: null, scheduledEnd: null },
  ],
  materials: [
    { id: 81, itemId: 20, itemName: "Chipboard", itemSku: "CHIP-01", itemUnit: "sheets", quantityUsed: 3 },
  ],
};
const legacyHtml = jt.buildJobTicketHtml(legacyOrder, { inventoryItems: [{ id: 20, sku: "CHIP-01", name: "Chipboard", unit: "sheets", dimensions: "", location: "" }], machines: [] });
check(legacyHtml.includes("Materials / Cut list") && legacyHtml.includes("CHIP-01") && legacyHtml.includes("Cutting") && legacyHtml.includes("Assembly"), "job ticket: legacy orders without a plan fall back to combined Materials + Routing tables");
check(legacyHtml.includes('JobTicket-PO-') === false, "job ticket: HTML does not leak the filename helper text");
const owdSource = fs.readFileSync("src/components/OrderWorkflowDetail.tsx", "utf8");
check(owdSource.includes("printJobTicket") && owdSource.includes("buildJobTicketHtml") && owdSource.includes("Job Ticket") && owdSource.includes("Printer"), "job ticket: order workflow exposes printable job ticket (button + print window via buildJobTicketHtml + QR)");
check(owdSource.includes("inventoryItems, machines, qrDataUrl"), "job ticket: ticket builder receives live inventory dimensions and machine assignments");

// ---- bundle 42: printable delivery note (client-facing, address & signatures) ----
const dn = require("./compiled/lib/deliveryNote.js");
check(dn.DELIVERY_NOTE_VERSION === 1, "delivery note: VERSION is 1");
check(dn.deliveryNoteFilename("PO-0101/2026") === "DeliveryNote-PO-0101-2026.pdf", "delivery note: filename sanitises slashes to dashes");
check(dn.deliveryNoteFilename("  a/b:c  ").startsWith("DeliveryNote-"), "delivery note: filename handles weird characters");
check(dn.formatDeliveryDate("2026-09-30T12:00:00Z").includes("2026") || dn.formatDeliveryDate("2026-09-30T12:00:00Z") === "—", "delivery note: date formatting never throws");
check(dn.formatDeliveryDate("invalid") === "—", "delivery note: invalid date falls back to dash");
check(dn.formatDeliveryDate(null) === "—" && dn.formatDeliveryDate("") === "—", "delivery note: empty date falls back to dash");
const sampleDeliveryOrder = {
  id: 101,
  orderNumber: "PO-0101/2026",
  title: "Dining set <special>",
  projectType: "Dining",
  priority: "High",
  status: "Completed",
  dueDate: "2026-10-05T12:00:00Z",
  createdAt: "2026-09-20T08:00:00Z",
  progressPercent: 100,
  customerCompany: "ACME Joinery",
  customerName: "Owner",
  customerPhone: "03 123456",
  customerEmail: "owner@acme.test",
  customerAddress: "Beirut, Main St 123\nLebanon",
  notes: "Deliver after 5pm & call <owner>",
  productionPlan: {
    orderId: 101,
    createdAt: "2026-09-20T08:00:00Z",
    defaultSteps: [],
    items: [
      {
        materialId: 91,
        itemId: 22,
        name: "Dining table top",
        quantityUsed: 1,
        routeSource: "recipe",
        recipeId: 4,
        recipeName: "Cut + finish",
        steps: [
          { operationId: 910, position: 1, stageKey: "1. Cutting", operationName: "Cutting", machineCategory: "Beam Saw", estimatedMinutes: 60, auto: true, machineId: 1 },
        ],
      },
      {
        materialId: 92,
        itemId: 23,
        name: "Chairs x4",
        quantityUsed: 4,
        routeSource: "custom",
        recipeId: null,
        recipeName: "",
        steps: [
          { operationId: 911, position: 1, stageKey: "1. Assembly", operationName: "Assembly", machineCategory: "Assembly", estimatedMinutes: 120, auto: false, machineId: 6 },
        ],
      },
    ],
  },
  operations: [],
  materials: [
    { id: 91, itemId: 22, itemName: "Oak Panel 40mm", itemSku: "OAK-40", itemUnit: "pcs", quantityUsed: 1 },
    { id: 92, itemId: 23, itemName: "Chair frame", itemSku: "CHAIR-F", itemUnit: "pcs", quantityUsed: 4 },
  ],
};
const deliveryInv = [
  { id: 22, sku: "OAK-40", name: "Oak Panel 40mm", unit: "pcs", dimensions: "2000 x 1000 x 40", location: "Rack C1" },
  { id: 23, sku: "CHAIR-F", name: "Chair frame", unit: "pcs", dimensions: "500 x 500 x 900", location: "Rack D2" },
];
const deliveryHtml = dn.buildDeliveryNoteHtml(sampleDeliveryOrder, { inventoryItems: deliveryInv, machines: [], qrDataUrl: "data:image/png;base64,xyz789" });
check(deliveryHtml.includes("WOODTEK") && deliveryHtml.includes("Delivery Note") && deliveryHtml.includes("PO-0101/2026"), "delivery note: HTML header with branding, delivery label and order number");
check(deliveryHtml.includes("#134e4a") || deliveryHtml.includes("#2dd4bf") || deliveryHtml.includes("teal") || deliveryHtml.includes("134e4a"), "delivery note: teal header styling");
check(deliveryHtml.includes("Bill to") && deliveryHtml.includes("Deliver to") && deliveryHtml.includes("ACME Joinery"), "delivery note: Bill to / Deliver to sections with company");
check(deliveryHtml.includes("Beirut, Main St 123"), "delivery note: delivery address from customerAddress");
check(deliveryHtml.includes("Dining set &lt;special&gt;"), "delivery note: title is HTML-escaped");
check(deliveryHtml.includes("Deliver after 5pm &amp; call &lt;owner&gt;"), "delivery note: notes are HTML-escaped");
check(deliveryHtml.includes("BATCH 1") && deliveryHtml.includes("Dining table top") && deliveryHtml.includes("BATCH 2") && deliveryHtml.includes("Chairs x4"), "delivery note: every material batch has its own card with batch number and name");
check(deliveryHtml.includes("2000 x 1000 x 40") && deliveryHtml.includes("Rack C1") || deliveryHtml.includes("Rack D2"), "delivery note: panel dimensions and location appear per batch");
check(deliveryHtml.includes("Qty") && deliveryHtml.includes("Check") && !deliveryHtml.includes("$") || deliveryHtml.includes("qty-only") || deliveryHtml.includes("Qty only"), "delivery note: qty-only table, no cost leaked (client-facing)");
check(deliveryHtml.includes("data:image/png;base64,xyz789"), "delivery note: QR code embedded");
check(deliveryHtml.includes("Delivery instructions") && deliveryHtml.includes("quantities") && deliveryHtml.includes("property of"), "delivery note: delivery instructions present");
check(deliveryHtml.includes("Prepared by") && deliveryHtml.includes("Delivered by") && deliveryHtml.includes("Received by") && deliveryHtml.includes("Client stamp"), "delivery note: 4-signature footer (prepared, delivered, received, stamp)");
const legacyDeliveryOrder = {
  id: 102,
  orderNumber: "PO-0102/2026",
  title: "Legacy wardrobe",
  projectType: "Wardrobes",
  priority: "Normal",
  status: "Completed",
  dueDate: "2026-10-10T00:00:00Z",
  createdAt: "2026-09-21T08:00:00Z",
  progressPercent: 100,
  customerCompany: "Globex",
  customerAddress: "Mount Lebanon, Baabda",
  operations: [],
  materials: [
    { id: 95, itemId: 30, itemName: "Wardrobe panel", itemSku: "WARD-P", itemUnit: "pcs", quantityUsed: 6 },
  ],
};
const legacyDeliveryHtml = dn.buildDeliveryNoteHtml(legacyDeliveryOrder, { inventoryItems: [{ id: 30, sku: "WARD-P", name: "Wardrobe panel", unit: "pcs", dimensions: "2200 x 600 x 18", location: "" }], machines: [] });
check(legacyDeliveryHtml.includes("Delivery list") || legacyDeliveryHtml.includes("WARD-P") && legacyDeliveryHtml.includes("Wardrobe panel"), "delivery note: legacy orders without a plan fall back to combined Materials table");
check(legacyDeliveryHtml.includes("Mount Lebanon") && legacyDeliveryHtml.includes("Baabda"), "delivery note: legacy still shows customer address");
check(owdSource.includes("printDeliveryNote") && owdSource.includes("buildDeliveryNoteHtml") && owdSource.includes("Delivery Note") && owdSource.includes("Truck"), "delivery note: order workflow exposes printable delivery note (button + print window via buildDeliveryNoteHtml + QR)");
check(owdSource.includes("bg-teal-500") && owdSource.includes("Delivery Note"), "delivery note: teal Delivery Note button styling");
const orderDetailApiSource = fs.readFileSync("src/app/api/orders/[id]/route.ts", "utf8");
check(orderDetailApiSource.includes("customerAddress") && orderDetailApiSource.includes("customers.address") || orderDetailApiSource.includes("customerAddress: customers.address"), "delivery note: orders/[id] API selects customerAddress for Bill to / Deliver to");

// ---- bundle 43: combined dispatch pack (job ticket + delivery note + QC + photos + proof) ----
const dpack = require("./compiled/lib/dispatchPack.js");
check(dpack.DISPATCH_PACK_VERSION === 1, "dispatch pack: VERSION is 1");
check(dpack.dispatchPackFilename("PO-0103/2026") === "DispatchPack-PO-0103-2026.pdf", "dispatch pack: filename sanitises slashes to dashes");
check(dpack.dispatchPackFilename("  a/b:c  ").startsWith("DispatchPack-"), "dispatch pack: filename handles weird characters");
check(dpack.formatPackDate("2026-09-30T12:00:00Z").includes("2026") || dpack.formatPackDate("2026-09-30T12:00:00Z") === "—", "dispatch pack: date formatting never throws");
check(dpack.formatPackDate("invalid") === "—", "dispatch pack: invalid date falls back to dash");
check(dpack.formatPackDate(null) === "—" && dpack.formatPackDate("") === "—", "dispatch pack: empty date falls back to dash");
check(dpack.formatPackDateTime("invalid") === "—" && dpack.formatPackDateTime(null) === "—", "dispatch pack: invalid datetime falls back to dash");
const samplePackOrder = {
  id: 103,
  orderNumber: "PO-0103/2026",
  title: "Combined kitchen <pack>",
  projectType: "Kitchens",
  priority: "Urgent",
  status: "Completed",
  dueDate: "2026-10-15T12:00:00Z",
  createdAt: "2026-09-22T08:00:00Z",
  progressPercent: 100,
  customerCompany: "ACME Joinery",
  customerName: "Owner",
  customerPhone: "03 123456",
  customerEmail: "owner@acme.test",
  customerAddress: "Beirut, Main St 123\nLebanon",
  notes: "Pack all & verify <edges>",
  productionPlan: {
    orderId: 103,
    createdAt: "2026-09-22T08:00:00Z",
    defaultSteps: [],
    items: [
      {
        materialId: 101,
        itemId: 32,
        name: "Kitchen top",
        quantityUsed: 1,
        routeSource: "recipe",
        recipeId: 5,
        recipeName: "Cut + edge",
        steps: [
          { operationId: 1001, position: 1, stageKey: "1. Saw", operationName: "Saw", machineCategory: "Beam Saw", estimatedMinutes: 90, auto: true, machineId: 1 },
        ],
      },
      {
        materialId: 102,
        itemId: 33,
        name: "Shelves x4",
        quantityUsed: 4,
        routeSource: "custom",
        recipeId: null,
        recipeName: "",
        steps: [
          { operationId: 1002, position: 1, stageKey: "1. Press", operationName: "Press", machineCategory: "Press", estimatedMinutes: 60, auto: false, machineId: 2 },
        ],
      },
    ],
  },
  operations: [
    { id: 1001, stepOrder: 1, operationName: "Saw", machineCategory: "Beam Saw", machineId: 1, machineCode: "BEAM-01", machineName: "Beam Saw", estimatedMinutes: 90, status: "Completed" },
    { id: 1002, stepOrder: 2, operationName: "Press", machineCategory: "Press", machineId: 2, machineCode: "PRESS-01", machineName: "Press", estimatedMinutes: 60, status: "Completed" },
  ],
  materials: [
    { id: 101, itemId: 32, itemName: "MDF 18mm", itemSku: "MDF-18", itemUnit: "pcs", quantityUsed: 1 },
    { id: 102, itemId: 33, itemName: "Shelf", itemSku: "SHELF-01", itemUnit: "pcs", quantityUsed: 4 },
  ],
};
const packInv = [
  { id: 32, sku: "MDF-18", name: "MDF 18mm", unit: "pcs", dimensions: "2440 x 1220 x 18", location: "Rack A1" },
  { id: 33, sku: "SHELF-01", name: "Shelf", unit: "pcs", dimensions: "800 x 300 x 18", location: "Rack B1" },
];
const packMachines = [
  { id: 1, code: "BEAM-01", name: "Beam Saw", category: "Beam Saw", status: "Active" },
  { id: 2, code: "PRESS-01", name: "Press", category: "Press", status: "Active" },
];
const packHtml = dpack.buildDispatchPackHtml(samplePackOrder, {
  inventoryItems: packInv,
  machines: packMachines,
  qrDataUrl: "data:image/png;base64,pack123",
  packingTemplate: ["All items packed", "Edges checked", "Corners protected"],
  packingChecks: [true, false, true],
  batchPackingChecks: { "101": [true, true, true] },
  deliveryPhotos: [{ id: "ph1", name: "front.jpg", size: 12345, createdAt: "2026-10-14T10:00:00Z", createdBy: "Maroun" }],
  batchDeliveryPhotos: { "101": [{ id: "ph2", name: "top-detail.jpg", size: 54321, createdAt: "2026-10-14T11:00:00Z", createdBy: "Maroun" }] },
  dispatchStage: "delivered",
  dispatchProof: { at: "2026-10-15T09:00:00Z", by: "Driver Joe", note: "Left at reception" },
  batchDispatchStages: { "101": { stage: "delivered", proof: { at: "2026-10-15T09:00:00Z", by: "Driver Joe" } } },
});
check(packHtml.includes("WOODTEK") && packHtml.includes("Dispatch Pack") && packHtml.includes("PO-0103/2026"), "dispatch pack: HTML header with branding, pack label and order number");
check(packHtml.includes("#312e81") || packHtml.includes("#818cf8") || packHtml.includes("indigo") || packHtml.includes("312e81"), "dispatch pack: indigo header styling distinct from job ticket amber and delivery note teal");
check(packHtml.includes("Bill to") && packHtml.includes("Deliver to") && packHtml.includes("ACME Joinery"), "dispatch pack: Bill to / Deliver to sections");
check(packHtml.includes("Beirut, Main St 123"), "dispatch pack: delivery address from customerAddress");
check(packHtml.includes("Combined kitchen &lt;pack&gt;"), "dispatch pack: title is HTML-escaped");
check(packHtml.includes("Pack all &amp; verify &lt;edges&gt;"), "dispatch pack: notes are HTML-escaped");
check(packHtml.includes("BATCH 1") && packHtml.includes("Kitchen top") && packHtml.includes("BATCH 2") && packHtml.includes("Shelves x4"), "dispatch pack: every material batch has its own card with batch number and name");
check(packHtml.includes("2440 x 1220 x 18") && packHtml.includes("Rack A1"), "dispatch pack: panel dimensions and shop location appear per batch");
check(packHtml.includes("BEAM-01") && packHtml.includes("Saw") && packHtml.includes("PRESS-01"), "dispatch pack: routing shows operation name and station code");
check(packHtml.includes("data:image/png;base64,pack123"), "dispatch pack: QR code embedded");
check(packHtml.toLowerCase().includes("dispatch pack contents") || packHtml.includes("Table of Contents") || packHtml.includes("Contents"), "dispatch pack: table of contents present");
check(packHtml.includes("Packing QC") || packHtml.includes("Packing Checklist"), "dispatch pack: packing QC checklist section");
check(packHtml.includes("All items packed") && packHtml.includes("Edges checked"), "dispatch pack: QC template items listed");
check(packHtml.includes("Delivery Photos") || packHtml.includes("delivery photos") || packHtml.includes("front.jpg"), "dispatch pack: delivery photos section with file name");
check(packHtml.includes("Dispatch") && (packHtml.includes("delivered") || packHtml.includes("Delivered")), "dispatch pack: dispatch stage and proof");
check(packHtml.includes("Prepared by") && packHtml.includes("Packed by") && packHtml.includes("Delivered by") && packHtml.includes("Received by"), "dispatch pack: 6-signature footer (prepared, packed, delivered, received, QC, stamp)");
check(packHtml.includes("page-break-before") && packHtml.includes("@page"), "dispatch pack: page breaks for print sections");
check(packHtml.includes("Delivery Note") && packHtml.includes("Job Ticket"), "dispatch pack: combines job ticket and delivery note in one document");
const legacyPackOrder = {
  id: 104,
  orderNumber: "PO-0104/2026",
  title: "Legacy pack",
  projectType: "Wardrobes",
  priority: "Normal",
  status: "Completed",
  dueDate: "2026-10-20T00:00:00Z",
  createdAt: "2026-09-23T08:00:00Z",
  progressPercent: 100,
  customerCompany: "Globex",
  customerAddress: "Mount Lebanon, Baabda",
  operations: [{ id: 1101, stepOrder: 1, operationName: "Cutting", machineCategory: "Beam Saw", machineId: null, estimatedMinutes: 60, status: "Completed" }],
  materials: [{ id: 110, itemId: 40, itemName: "Panel", itemSku: "PAN-01", itemUnit: "pcs", quantityUsed: 2 }],
};
const legacyPackHtml = dpack.buildDispatchPackHtml(legacyPackOrder, {
  inventoryItems: [{ id: 40, sku: "PAN-01", name: "Panel", unit: "pcs", dimensions: "", location: "" }],
  machines: [],
  packingTemplate: ["Check qty"],
  packingChecks: [true],
  deliveryPhotos: [],
  dispatchStage: "ready",
});
check(legacyPackHtml.includes("PAN-01") && legacyPackHtml.includes("Mount Lebanon"), "dispatch pack: legacy orders fall back and still show address");
check(owdSource.includes("printDispatchPack") && owdSource.includes("buildDispatchPackHtml") && owdSource.includes("Dispatch Pack") && owdSource.includes("Package"), "dispatch pack: order workflow exposes printable dispatch pack (button + print window via buildDispatchPackHtml + QR + Package icon)");
check(owdSource.includes("bg-indigo-500") && owdSource.includes("Dispatch Pack"), "dispatch pack: indigo Dispatch Pack button styling");

// ---- bundle 44: email dispatch (SMTP settings + Email Docs) ----
const ecfg = require("./compiled/lib/emailConfig.js");
const edisp = require("./compiled/lib/emailDispatch.js");
const sampleOrder44 = { id: 44, orderNumber: "ORD-2026-0044", title: "Executive <mahogany> Conference Table & Wall Paneling" };

check(ecfg.EMAIL_CONFIG_VERSION === 1, "email: emailConfig VERSION is 1");
check(edisp.EMAIL_DISPATCH_VERSION === 1, "email: emailDispatch VERSION is 1");

const cleaned = ecfg.sanitizeEmailConfig({ host: " mail.factory.com ", port: "99999", user: " smtp-user ", pass: " s3cret ", fromName: " WoodTek ", fromEmail: "FROM@Factory.COM " });
check(cleaned.host === "mail.factory.com" && cleaned.user === "smtp-user", "email: sanitize trims host and user");
check(cleaned.fromEmail === "from@factory.com", "email: sanitize lowercases the from address");
check(cleaned.port === 65535, "email: sanitize clamps an oversized port to 65535");
check(ecfg.sanitizeEmailConfig({ port: 0 }).port === 1, "email: sanitize clamps port 0 up to 1");
check(ecfg.sanitizeEmailConfig({ port: "junk" }).port === 587, "email: sanitize falls back to port 587 for non-numeric input");
check(ecfg.sanitizeEmailConfig(null).version === 1 && ecfg.sanitizeEmailConfig(null).fromEmail === "", "email: sanitize accepts garbage input (null) and returns the default shape");

check(ecfg.validateEmailConfig(ecfg.sanitizeEmailConfig({})).includes("host"), "email: validation requires the SMTP host");
check(ecfg.validateEmailConfig(ecfg.sanitizeEmailConfig({ host: "smtp.x.com" })).includes("From email"), "email: validation requires the from email");
check(ecfg.validateEmailConfig(ecfg.sanitizeEmailConfig({ host: "smtp.x.com", fromEmail: "not-an-email" })).includes("valid address"), "email: validation rejects a malformed from email");
check(ecfg.validateEmailConfig(ecfg.sanitizeEmailConfig({ host: "smtp.x.com", fromEmail: "a@b.com", user: "u" })).includes("password"), "email: validation requires a password when an SMTP user is set");
check(ecfg.validateEmailConfig(ecfg.sanitizeEmailConfig({ host: "smtp.x.com", fromEmail: "a@b.com", user: "u", pass: "p" })) === null, "email: a complete config passes validation");
check(ecfg.isEmailConfigured(ecfg.sanitizeEmailConfig({ host: "smtp.x.com", fromEmail: "a@b.com" })) && !ecfg.isEmailConfigured(ecfg.sanitizeEmailConfig({})), "email: isEmailConfigured needs host + from email");

const masked = ecfg.maskEmailConfig({ version: 1, host: "h", port: 465, secure: true, user: "u", pass: "super-secret", fromName: "W", fromEmail: "w@x.com" });
check(masked.pass === "***" && masked.hasPass === true, "email: mask turns the password into *** and sets hasPass");
check(!JSON.stringify(masked).includes("super-secret"), "email: mask never leaks the clear password");
check(ecfg.maskEmailConfig({ version: 1, host: "", port: 587, secure: false, user: "", pass: "", fromName: "", fromEmail: "" }).hasPass === false, "email: mask without a stored password reports hasPass false");
check(ecfg.buildFromHeader({ version: 1, host: "h", port: 587, secure: false, user: "", pass: "", fromName: "WoodTek", fromEmail: "dispatch@woodtek.local" }) === "WoodTek <dispatch@woodtek.local>", "email: from header is Name <address>");
check(ecfg.buildFromHeader({ version: 1, host: "h", port: 587, secure: false, user: "", pass: "", fromName: "", fromEmail: "Dispatch@woodtek.local" }) === "dispatch@woodtek.local", "email: from header falls back to the bare lowercased address");

check(edisp.sanitizeRecipient("  Name@Factory.com  ") === "name@factory.com", "email: sanitizeRecipient trims and lowercases one address");
const parsed = edisp.parseRecipients("a@x.com, B@x.com;C@X.COM\nd@y.org,not-an-email, d@y.org");
check(parsed.recipients.length === 4 && parsed.recipients[0] === "a@x.com" && parsed.recipients[2] === "c@x.com", "email: parseRecipients splits on comma/semicolon/newline and dedupes case-insensitively");
check(parsed.rejected.includes("not-an-email"), "email: parseRecipients reports invalid addresses in rejected");
check(edisp.parseRecipients("").recipients.length === 0, "email: parseRecipients on empty input returns nothing");
check(edisp.parseRecipients(Array.from({ length: 40 }, (_, i) => `u${i}@x.com`).join(",")).recipients.length === edisp.MAX_EMAIL_RECIPIENTS, "email: parseRecipients caps the recipient count");

check(edisp.buildDeliveryEmailSubject(sampleOrder44) === `Delivery note — ORD-2026-0044 — Executive <mahogany> Conference Table & Wall Paneling`, "email: delivery email subject carries label, order number and title");
check(edisp.buildDispatchPackEmailSubject(sampleOrder44).startsWith("Dispatch pack — ORD-2026-0044"), "email: dispatch pack email subject carries label and order number");
check(edisp.buildDeliveryEmailSubject({ id: 7 }).includes("ORDER-7"), "email: subject falls back to ORDER-<id> when no number exists");

const mailHtml = edisp.buildEmailHtmlBody({ title: "Delivery note — ORD-2026-0044 — <b>Table</b> & Wall", message: "Line 1\nLine 2 <script>alert(1)</script>", orderNumber: "ORD-2026-0044", senderName: "Joan <M>", attachments: ["DeliveryNote-ORD.html"] });
check(mailHtml.includes("Delivery note — ORD-2026-0044 — &lt;b&gt;Table&lt;/b&gt; &amp; Wall"), "email: HTML body escapes the title");
check(mailHtml.includes("Line 2 &lt;script&gt;alert(1)&lt;/script&gt;") && !mailHtml.includes("<script>alert(1)"), "email: HTML body escapes the message (no live script tag)");
check(mailHtml.includes("DeliveryNote-ORD.html") && mailHtml.includes("ORD-2026-0044") && mailHtml.includes("Joan &lt;M&gt;"), "email: HTML body lists attachments, order number and sender");
check(edisp.buildEmailTextBody({ title: "T & P", message: "hello\nworld", orderNumber: "ORD-1", senderName: "Joan", attachments: ["A.html", "B.html"] }).includes("  - A.html"), "email: text body is the plain-text twin with the attachment list");
check(edisp.describeSendError(new Error("Invalid login: bad password=SEKRIT")).includes("password=***") && !edisp.describeSendError(new Error("x password=SEKRIT")).includes("SEKRIT"), "email: send error messages redact password tokens");

check(emailConfigServerSource.includes("WOODTEK_DATA_DIR") && emailConfigServerSource.includes("email-config.json"), "email: server store reads/writes data/email-config.json via WOODTEK_DATA_DIR");
check(emailConfigServerSource.includes("writeJsonAtomic") && emailConfigServerSource.includes("atomicFile.server"), "email: server store writes atomically through the shared helper");

check(emailConfigApiSource.includes("authorize()") && emailConfigApiSource.includes("users:manage"), "email: config API gates GET to sign-in and PUT/POST to Manager (users:manage)");
check(emailConfigApiSource.includes("nodemailer") && emailConfigApiSource.includes("maskEmailConfig"), "email: config API uses nodemailer and answers with maskEmailConfig");
check(emailConfigApiSource.includes("EMAIL_CONFIG_PLACEHOLDER") && emailConfigApiSource.includes("stored.pass"), "email: config API keeps the stored password when the *** placeholder comes back");
check(emailConfigApiSource.includes('body?.action ?? ""') && emailConfigApiSource.includes("SMTP test"), "email: config API POST sends a test email only for action=test");

check(emailDispatchApiSource.includes("authorize()") && emailDispatchApiSource.includes("can(user.role, \"orders:write\")") && emailDispatchApiSource.includes("quality:write") && emailDispatchApiSource.includes("inventory:write") && emailDispatchApiSource.includes("users:manage"), "email: dispatch API enforces canSendEmail (orders:write / quality:write / inventory:write / users:manage)");
check(emailDispatchApiSource.includes("readOrderProductionPlan(orderId)"), "email: dispatch API reads the production plan from the JSON store (no orders.productionPlan column)");
check(!emailDispatchApiSource.includes("orders.productionPlan"), "email: dispatch API never references a productionPlan column on the orders table");
check(emailDispatchApiSource.includes("inventoryItems.name") && emailDispatchApiSource.includes("leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))"), "email: dispatch API joins inventoryItems for the material name (no itemName column)");
check(emailDispatchApiSource.includes("leftJoin(machines, eq(orderOperations.machineId, machines.id))"), "email: dispatch API joins machines for the operation station");
check(emailDispatchApiSource.includes("buildDeliveryNoteHtml") && emailDispatchApiSource.includes("buildDispatchPackHtml") && emailDispatchApiSource.includes("buildJobTicketHtml"), "email: dispatch API builds the three HTML document attachments");
check(emailDispatchApiSource.includes("delivery-photos.json") && emailDispatchApiSource.includes("readDispatchStore"), "email: dispatch API reads delivery-photos.json and dispatch-status.json for the pack");
check(emailDispatchApiSource.includes("nodemailer") && emailDispatchApiSource.includes('logAudit(') && emailDispatchApiSource.includes('"email.dispatch"'), "email: dispatch API sends via nodemailer and audits email.dispatch");
check(emailDispatchApiSource.includes("customerAddress: customers.address"), "email: dispatch API carries the customer address from the customers join");

check(settingsViewSource.includes("/api/email-config") && settingsViewSource.includes("emailCfg") && settingsViewSource.includes("emailHasPass") && settingsViewSource.includes("SMTP"), "email: settings view has the Manager-only SMTP panel wired to /api/email-config");
check(settingsViewSource.includes("saveEmailConfig") && settingsViewSource.includes("testEmailConfig") && settingsViewSource.includes('action: "test"'), "email: settings view saves the config and can send a test email");
check(orderWorkflowSource.includes("openEmailModal") && orderWorkflowSource.includes("Email Docs") && orderWorkflowSource.includes("bg-sky-500"), "email: order workflow exposes the Email Docs button (Mail icon, sky-500)");
check(orderWorkflowSource.includes("sendEmailDispatch") && orderWorkflowSource.includes("/api/email-dispatch") && orderWorkflowSource.includes("includeDispatchPack"), "email: order workflow posts the dispatch with the document checkboxes");
check(orderWorkflowSource.includes("emailResult") && orderWorkflowSource.includes("setEmailOpen(false)"), "email: order workflow shows a result banner and auto-closes the modal");

// ---- optional modules switch layer (44 checks) ----
const optMod = require("./compiled/lib/optionalModules.js");
const optModServer = require("./compiled/lib/optionalModules.server.js");
const repMoney = require("./compiled/lib/reportMoney.js");
check(optMod.OPTIONAL_MODULE_IDS.includes("invoicing") && optMod.OPTIONAL_MODULE_IDS.includes("purchasing") && optMod.OPTIONAL_MODULE_IDS.includes("payroll"), "optional modules: registry has invoicing, purchasing, payroll");
check(optMod.OPTIONAL_MODULES.length === 3 && optMod.OPTIONAL_MODULES.find(m => m.id === "invoicing")?.ready === true, "optional modules: invoicing remains ready");
check(optMod.OPTIONAL_MODULES.find(m => m.id === "purchasing")?.ready === true && optMod.OPTIONAL_MODULES.find(m => m.id === "payroll")?.ready === false, "optional modules: purchasing shipped; payroll stays not ready");
check(optMod.OPTIONAL_MODULE_SCREENS.purchasing.includes("purchasing"), "optional modules: purchasing screen is registered with the grant");
check(optMod.MONEY_MODULE === "invoicing", "optional modules: MONEY_MODULE is invoicing");
check(optMod.MANAGER_ROLE === "Manager", "optional modules: MANAGER_ROLE is Manager");
check(optMod.isOptionalModuleId("invoicing") && !optMod.isOptionalModuleId("unknown"), "optional modules: isOptionalModuleId validates IDs");
check(optMod.moduleDef("invoicing")?.label === "Invoicing & Money", "optional modules: moduleDef returns definition");
check(optMod.moduleLabel("invoicing") === "Invoicing & Money" && optMod.moduleLabel("xyz") === "xyz", "optional modules: moduleLabel returns label or id fallback");
const defCfg = optMod.defaultOptionalModulesConfig();
check(defCfg.version === 1 && defCfg.enabled.includes("invoicing") && defCfg.roles["Sales Coordinator"]?.includes("invoicing"), "optional modules: default config enables invoicing for Sales Coordinator");
const cleanEmpty = optMod.sanitizeOptionalModules(null);
check(cleanEmpty.version === 1 && cleanEmpty.enabled.length === 0, "optional modules: sanitizer handles null/garbage");
const cleanBad = optMod.sanitizeOptionalModules({ enabled: ["bad", "invoicing"], roles: { Manager: ["invoicing"], Sales: ["bad", "invoicing"] }, users: { "abc": ["invoicing"], "05": ["invoicing"], "-3": ["invoicing"] } });
check(cleanBad.enabled.length === 1 && !cleanBad.roles.Manager && cleanBad.roles.Sales?.length === 1 && cleanBad.users["5"]?.length === 1 && !cleanBad.users["abc"], "optional modules: sanitizer drops unknown ids, Manager role and non-numeric user keys");
check(optMod.subjectHasModule("invoicing", { role: "Manager" }, { enabled: [], roles: {}, users: {} }) === true, "optional modules: Manager always has access even if disabled");
check(optMod.subjectHasModule("invoicing", { displayRole: "Manager" }, { enabled: [], roles: {}, users: {} }) === true, "optional modules: Manager via displayRole always has access");
check(optMod.subjectHasModule("invoicing", { role: "Machine Operator" }, { enabled: [], roles: { "Machine Operator": ["invoicing"] }, users: {} }) === false, "optional modules: switched off module is off for non-Manager even if role granted");
check(optMod.subjectHasModule("invoicing", { id: 42, role: "Machine Operator" }, { enabled: ["invoicing"], roles: {}, users: { "42": ["invoicing"] } }) === true, "optional modules: personal grant wins on its own");
check(optMod.subjectHasModule("invoicing", { id: 99, role: "Machine Operator" }, { enabled: ["invoicing"], roles: {}, users: { "42": ["invoicing"] } }) === false, "optional modules: user without personal grant denied when role not granted");
check(optMod.subjectHasModule("invoicing", { role: "Sales Coordinator" }, { enabled: ["invoicing"], roles: { "Sales Coordinator": ["invoicing"] }, users: {} }) === true, "optional modules: role grant on built-in role resolves true");
check(optMod.subjectHasModule("invoicing", { role: "Machine Operator", displayRole: "Custom Role" }, { enabled: ["invoicing"], roles: { "Custom Role": ["invoicing"] }, users: {} }) === true, "optional modules: role grant on custom role name resolves true");
check(optMod.subjectHasModule("invoicing", { role: "Machine Operator", displayRole: "Custom Role" }, { enabled: ["invoicing"], roles: { "Machine Operator": ["invoicing"] }, users: {} }) === true, "optional modules: role grant on inherited base role resolves true");
check(optMod.subjectHasModule("invoicing", null) === false && optMod.subjectHasModule("invoicing", undefined) === false, "optional modules: signed out subject resolves false");
check(optMod.canSeeMoney({ role: "Manager" }) === true && optMod.canSeeMoney({ role: "Machine Operator" }) === false, "optional modules: canSeeMoney follows subjectHasModule(MONEY_MODULE)");
check(optMod.screenOwnerModule("unknown-screen") === null, "optional modules: screenOwnerModule returns null for unowned screen");
check(optMod.screenAllowedForSubject("unknown-screen", { role: "Machine Operator" }) === true, "optional modules: screenAllowedForSubject allows unowned screens");
const diffNone = optMod.summarizeOptionalModuleChange(defCfg, defCfg);
check(diffNone.includes("no change"), "optional modules: audit summary reports no change when identical");
const diffOn = optMod.summarizeOptionalModuleChange({ version: 1, enabled: [], roles: {}, users: {} }, { version: 1, enabled: ["invoicing"], roles: {}, users: {} });
check(diffOn.includes("switched on Invoicing & Money"), "optional modules: audit summary reports switched on module");
const diffOff = optMod.summarizeOptionalModuleChange({ version: 1, enabled: ["invoicing"], roles: {}, users: {} }, { version: 1, enabled: [], roles: {}, users: {} });
check(diffOff.includes("switched off Invoicing & Money"), "optional modules: audit summary reports switched off module");
const diffRole = optMod.summarizeOptionalModuleChange({ version: 1, enabled: ["invoicing"], roles: {}, users: {} }, { version: 1, enabled: ["invoicing"], roles: { "Technician": ["invoicing"] }, users: {} });
check(diffRole.includes("granted Invoicing & Money to role Technician"), "optional modules: audit summary reports role grant");
const diffUser = optMod.summarizeOptionalModuleChange({ version: 1, enabled: ["invoicing"], roles: {}, users: {} }, { version: 1, enabled: ["invoicing"], roles: {}, users: { "7": ["invoicing"] } });
check(diffUser.includes("granted Invoicing & Money to user #7"), "optional modules: audit summary reports personal user grant");

const optTmp = fs.mkdtempSync(path.join(os.tmpdir(), "opt-mod-test-"));
process.env.WOODTEK_DATA_DIR = optTmp;
const initialRead = optModServer.readOptionalModules();
check(initialRead.enabled.includes("invoicing") && initialRead.roles["Sales Coordinator"]?.includes("invoicing"), "optional modules server: reads default config when file does not exist");
check(!fs.existsSync(path.join(optTmp, optModServer.OPTIONAL_MODULES_FILE)), "optional modules server: reading default does not create file on disk");
optModServer.writeOptionalModules({ version: 1, enabled: ["invoicing"], roles: { "Technician": ["invoicing"] }, users: { "12": ["invoicing"] } });
check(fs.existsSync(path.join(optTmp, optModServer.OPTIONAL_MODULES_FILE)), "optional modules server: writeOptionalModules persists file");
const reRead = optModServer.readOptionalModules();
check(reRead.roles["Technician"]?.includes("invoicing") && reRead.users["12"]?.includes("invoicing"), "optional modules server: readOptionalModules re-reads saved config");
check(fs.readdirSync(optTmp).filter(f => f.endsWith(".tmp")).length === 0, "optional modules server: write cleans up temp files (no .tmp left)");
fs.rmSync(optTmp, { recursive: true, force: true });
delete process.env.WOODTEK_DATA_DIR;

const optApiSrc = fs.readFileSync("src/app/api/optional-modules/route.ts", "utf8");
check(optApiSrc.includes("export async function GET") && optApiSrc.includes("authorize()"), "optional modules API: GET is gated on signed-in user");
check(optApiSrc.includes("export async function PUT") && optApiSrc.includes('authorize("users:manage")'), "optional modules API: PUT is gated on Manager (users:manage)");
check(optApiSrc.includes("logAudit(") && optApiSrc.includes('"optional-modules.save"'), "optional modules API: PUT logs audit trail");
check(optApiSrc.includes("readOptionalModules") && optApiSrc.includes("writeOptionalModules"), "optional modules API: uses server store read/write");

const authSrc = fs.readFileSync("src/lib/auth.ts", "utf8");
check(authSrc.includes("export async function authorizeModule"), "auth: exports authorizeModule helper");
check(authSrc.includes("subjectHasModule(") && authSrc.includes("readOptionalModules()"), "auth: authorizeModule checks subjectHasModule with readOptionalModules");
check(authSrc.includes("status: 403") && authSrc.includes("Settings > Optional modules"), "auth: authorizeModule returns 403 with guidance on failure");

check(settingsViewSource.includes("optionalModulesPanel") && settingsViewSource.includes("/api/optional-modules"), "settings: SettingsView includes optionalModulesPanel wired to /api/optional-modules");
check(settingsViewSource.includes("toggleModuleEnabled") && settingsViewSource.includes("toggleRoleModule") && settingsViewSource.includes("toggleUserModule"), "settings: SettingsView provides toggle handlers for master/role/user");
check(settingsViewSource.includes("Blocks") && settingsViewSource.includes("Optional modules"), "settings: SettingsView renders Optional modules button and icon");

// ---- money redaction wave (24 checks) ----
check(repMoney.isMoneyOnlyReport("Order Profitability") === true && repMoney.isMoneyOnlyReport("Production Summary") === false, "report money: isMoneyOnlyReport identifies Order Profitability");
check(repMoney.isMixedMoneyReport("Production Summary") === true && repMoney.isMixedMoneyReport("Order Profitability") === false, "report money: isMixedMoneyReport identifies mixed reports");
check(repMoney.reportCarriesMoney("Order Profitability") && repMoney.reportCarriesMoney("Inventory Status") && !repMoney.reportCarriesMoney("Machine Utilization"), "report money: reportCarriesMoney true only for money reports");

const redProd = repMoney.redactReportMoney("Production Summary", { totalValue: 500, orders: [{ orderNumber: "PO-1", totalValue: 500 }] });
check(redProd.totalValue === null && redProd.orders[0].totalValue === null, "report money: redactReportMoney blanks totalValue in Production Summary");
const redInv = repMoney.redactReportMoney("Inventory Status", { totalValue: 1000, items: [{ sku: "A", unitCost: "10.00", totalValue: "50.00" }] });
check(redInv.totalValue === null && redInv.items[0].unitCost === null && redInv.items[0].totalValue === null, "report money: redactReportMoney blanks unitCost and totalValue in Inventory Status");
const redCust = repMoney.redactReportMoney("Client Activity", { clients: [{ company: "Acme", totalSpend: 500, creditLimit: "1000", currentBalance: "200" }] });
check(redCust.clients[0].totalSpend === null && redCust.clients[0].creditLimit === null && redCust.clients[0].currentBalance === null, "report money: redactReportMoney blanks totalSpend/creditLimit/balance in Client Activity");
const redScrap = repMoney.redactReportMoney("Scrap & Rework Analysis", { kpis: { scrapCost: 100, reworkCost: 50 }, scrapByReason: [{ reason: "cut", cost: 100 }], reworkByReason: [{ reason: "dent", cost: 50 }], byMachine: [{ cost: 150 }] });
check(redScrap.kpis.scrapCost === null && redScrap.scrapByReason[0].cost === null && redScrap.reworkByReason[0].cost === null && redScrap.byMachine[0].cost === null, "report money: redactReportMoney blanks costs in Scrap & Rework");
const redOther = repMoney.redactReportMoney("Machine Utilization", { machines: [{ code: "M1" }] });
check(redOther.machines[0].code === "M1", "report money: redactReportMoney leaves other report types untouched");

check(dataAccessSource.includes("canSeeMoney") && dataAccessSource.includes("readOptionalModules"), "dataAccess: imports canSeeMoney and readOptionalModules");
check(dataAccessSource.includes("!canSeeMoney(user, readOptionalModules())"), "dataAccess: listOrdersForUser hides totalValue when !canSeeMoney");
check(dataAccessSource.includes("if (canSeeMoney(user, readOptionalModules())) return rows as ScopedCustomer[];"), "dataAccess: listCustomersForUser hides creditLimit and balance when !canSeeMoney");

check(orderDetailApiSource.includes("canSeeMoney") && orderDetailApiSource.includes("readOptionalModules"), "orders/[id] API: imports canSeeMoney and readOptionalModules");
check(orderDetailApiSource.includes("noMoney ? null : order.totalValue") && orderDetailApiSource.includes("costPerUnit: null"), "orders/[id] API: redacts order totalValue and material costPerUnit when no money grant");

const custRouteSrc = fs.readFileSync("src/app/api/customers/route.ts", "utf8");
check(custRouteSrc.includes("canSeeMoney") && custRouteSrc.includes("totalSpend: canSeeMoney"), "customers API: GET redacts totalSpend when !canSeeMoney");
check(custRouteSrc.includes("finalCreditLimit") && custRouteSrc.includes("DEFAULT_CREDIT_LIMIT"), "customers API: POST ignores custom creditLimit when !canSeeMoney");

const custIdRouteSrc = fs.readFileSync("src/app/api/customers/[id]/route.ts", "utf8");
check(custIdRouteSrc.includes("canSeeMoney") && custIdRouteSrc.includes("safeOrders") && custIdRouteSrc.includes("safeCustomer"), "customers/[id] API: GET redacts order values, credit limit and balance when !canSeeMoney");
check(custIdRouteSrc.includes("body.creditLimit !== undefined") && custIdRouteSrc.includes("status: 403"), "customers/[id] API: PATCH returns 403 on creditLimit/balance edit without grant");

const ledgerRouteSrc = fs.readFileSync("src/app/api/customers/[id]/ledger/route.ts", "utf8");
check(ledgerRouteSrc.includes("authorizeModule(MONEY_MODULE)") && ledgerRouteSrc.includes("MONEY_MODULE"), "customers/[id]/ledger API: enforces authorizeModule(MONEY_MODULE)");

check(dashboardApiSource.includes("canSeeMoney") && dashboardApiSource.includes("totalPipelineValue: money ?") && dashboardApiSource.includes("scrapCost: money ?"), "dashboard API: redacts totalPipelineValue and scrapCost when !money");

const reportsRouteSrc = fs.readFileSync("src/app/api/reports/route.ts", "utf8");
check(reportsRouteSrc.includes("isMoneyOnlyReport") && reportsRouteSrc.includes("canSeeMoney"), "reports API: imports isMoneyOnlyReport and canSeeMoney");
check(reportsRouteSrc.includes("isMoneyOnlyReport(report.type) && !money") && reportsRouteSrc.includes("status: 403"), "reports API: GET returns 403 when opening saved money-only report without grant");
check(reportsRouteSrc.includes(".filter(r => !isMoneyOnlyReport(r.type))"), "reports API: GET filters money-only reports from saved list when !canSeeMoney");
check(reportsRouteSrc.includes("redactReportMoney(report.type, report.dataJson)") && reportsRouteSrc.includes("redactReportMoney(r.type, r.dataJson)"), "reports API: detail and list redact saved mixed money reports at read time, even if saved by Manager");
check(reportsRouteSrc.includes("isMoneyOnlyReport(type) && !money") && reportsRouteSrc.includes("redactReportMoney(type, reportData)"), "reports API: POST 403 on generating money report without grant and redacts before insert");

const reportViewSrc = fs.readFileSync("src/components/ReportView.tsx", "utf8");
check(reportViewSrc.includes("moneyText") && reportViewSrc.includes("pdfMoneyText") && reportViewSrc.includes("csvMoney"), "report view: formats redacted money figures with em dash, restricted and csv marker");

// ---- Purchasing & Suppliers: optional grants, validation, receipts, stock ----
const purchasing = require("./compiled/lib/purchasing.js");
const rejectsPurchase = (fn, status = 400) => {
  try { fn(); return false; }
  catch (error) { return error instanceof purchasing.PurchasingError && error.status === status; }
};
const supplierParsed = purchasing.parseSupplier({ name: "  Cedar Supply  ", contactName: " Lina ", email: " ORDERS@CEDAR.COM " });
check(supplierParsed.name === "Cedar Supply" && supplierParsed.email === "orders@cedar.com" && supplierParsed.contactName === "Lina", "purchasing: supplier record trims contact and email");
check(rejectsPurchase(() => purchasing.parseSupplier({ name: "", email: "bad" })) && rejectsPurchase(() => purchasing.parseSupplier({ name: "Cedar", email: "invalid" })), "purchasing: supplier name and email are validated");
check(purchasing.priceCents("12.34") === 1234 && purchasing.priceCents("0.5") === 50 && purchasing.moneyFromCents(1005) === "10.05", "purchasing: unit prices use integer cents and exact two-decimal display");
check(rejectsPurchase(() => purchasing.priceCents("-2")) && rejectsPurchase(() => purchasing.priceCents("2.345")) && rejectsPurchase(() => purchasing.priceCents("Infinity")), "purchasing: negative, excess precision and non-finite prices are rejected");
check(rejectsPurchase(() => purchasing.positiveId(true)) && rejectsPurchase(() => purchasing.positiveId("0")) && rejectsPurchase(() => purchasing.positiveId(1.5)), "purchasing: ids cannot be booleans, zero or fractions");
const newPo = { supplierId: 4, expectedAt: "2028-02-29", notes: "Rush", lines: [{ itemId: 3, quantity: 10, unitPrice: "1.25" }] };
check(purchasing.parsePurchaseOrder(newPo, true).lines[0].unitPrice === "1.25", "purchasing: valid supplier, leap-day, item, quantity and price make a PO");
check(rejectsPurchase(() => purchasing.parsePurchaseOrder({ ...newPo, expectedAt: "2026-02-29" }, true)), "purchasing: impossible delivery date is rejected");
check(rejectsPurchase(() => purchasing.parsePurchaseOrder({ ...newPo, lines: [...newPo.lines, newPo.lines[0]] }, true)), "purchasing: duplicate stock lines are rejected");
check(rejectsPurchase(() => purchasing.parsePurchaseOrder({ ...newPo, lines: [{ itemId: 3, quantity: -1, unitPrice: "0" }] }, true)) && rejectsPurchase(() => purchasing.parsePurchaseOrder({ ...newPo, lines: [{ itemId: 3, quantity: 1.5, unitPrice: "0" }] }, true)), "purchasing: negative and fractional quantities are rejected");
check(rejectsPurchase(() => purchasing.parsePurchaseOrder(newPo, false), 403), "purchasing: a purchasing-only grant cannot set a nonzero PO price");
check(purchasing.parsePurchaseOrder({ ...newPo, lines: [{ itemId: 3, quantity: 2 }] }, false).lines[0].unitPrice === "0.00", "purchasing: quantity-only PO is allowed without a money grant");
const uuid = "11111111-2222-4333-8444-555555555555";
const receiptInput = { requestKey: uuid, lines: [{ poLineId: 7, quantity: 4 }] };
check(purchasing.parseGoodsReceipt(receiptInput).requestKey === uuid && purchasing.parseGoodsReceipt(receiptInput).lines[0].quantity === 4, "purchasing: a GRN carries a UUID and actual received quantities");
const lanReceiptKey = purchasing.newReceiptRequestKey({ getRandomValues: (bytes) => { bytes.set(Array.from({ length: 16 }, (_, i) => i)); return bytes; } });
check(lanReceiptKey === "00010203-0405-4607-8809-0a0b0c0d0e0f" && purchasing.parseGoodsReceipt({ ...receiptInput, requestKey: lanReceiptKey }).requestKey === lanReceiptKey, "purchasing: HTTP-LAN browser fallback creates an RFC 4122 v4 receipt key from secure random bytes");
check(purchasing.newReceiptRequestKey({ randomUUID: () => uuid, getRandomValues: () => { throw Error("fallback should not run"); } }) === uuid, "purchasing: secure-context browser uses native randomUUID when available");
check(rejectsPurchase(() => purchasing.parseGoodsReceipt({ ...receiptInput, requestKey: "not-a-uuid" })) && rejectsPurchase(() => purchasing.parseGoodsReceipt({ ...receiptInput, lines: [receiptInput.lines[0], receiptInput.lines[0]] })), "purchasing: invalid receipt key and duplicate PO lines are rejected");
const poLine = { id: 7, itemId: 3, itemSku: "MDF-1", itemName: "MDF", itemUnit: "sheets", quantity: 10, unitPrice: "1.25" };
const pendingPo = purchasing.summarizeOrderLines([poLine], [{ poLineId: 7, quantity: 4 }], "Open", true);
check(pendingPo.orderedQty === 10 && pendingPo.receivedQty === 4 && pendingPo.awaitingQty === 6 && pendingPo.lines[0].remainingQuantity === 6 && pendingPo.total === "12.50" && pendingPo.awaitingValue === "7.50", "purchasing: partial GRN leaves exactly 6 of 10 outstanding and money totals use cents");
check(purchasing.summarizeOrderLines([poLine], [{ poLineId: 7, quantity: 4 }], "Closed", true).awaitingQty === 0, "purchasing: manually closed remainder is no longer awaiting delivery");
const blindPo = purchasing.summarizeOrderLines([poLine], [], "Open", false);
check(blindPo.total === null && blindPo.awaitingValue === null && blindPo.lines[0].unitPrice === null && blindPo.lines[0].lineTotal === null, "purchasing: all PO money fields are null without the Invoicing & Money grant");
check(purchasing.suggestedReorderQty(5, 10) === 15 && purchasing.suggestedReorderQty(5, 10, 8) === 7 && purchasing.suggestedReorderQty(5, 10, 20) === 0, "purchasing: reorder suggestion accounts for stock already awaiting on an open PO");
check(purchasing.purchaseNumber(12) === "PUR-00012" && purchasing.goodsReceiptNumber(8) === "GRN-00008", "purchasing: PO and GRN references are distinct from production order numbers");

// ---- Supplier bills & Accounts Payable: grants, amounts, payment safety, aging ----
const payables = require("./compiled/lib/payables.js");
const rejectsPayable = (fn, status = 400) => {
  try { fn(); return false; }
  catch (error) { return error instanceof purchasing.PurchasingError && error.status === status; }
};
const sampleBill = {
  supplierId: 4, purchaseOrderId: 12, reference: "  INV-4587 ",
  issueDate: "2026-09-01", dueDate: "2026-10-01", amount: "125.50", notes: "Hardware delivery",
};
const parsedBill = payables.parseSupplierBill(sampleBill);
check(parsedBill.supplierId === 4 && parsedBill.purchaseOrderId === 12 && parsedBill.reference === "INV-4587" && parsedBill.totalCents === 12550, "A/P: bill captures supplier reference, PO link, valid dates and exact integer cents");
check(rejectsPayable(() => payables.parseSupplierBill({ ...sampleBill, reference: " " })) && rejectsPayable(() => payables.parseSupplierBill({ ...sampleBill, amount: "0" })) && rejectsPayable(() => payables.parseSupplierBill({ ...sampleBill, amount: "1.239" })), "A/P: blank supplier references, zero bills and excess money precision are rejected");
check(rejectsPayable(() => payables.parseSupplierBill({ ...sampleBill, dueDate: "2026-08-31" })) && rejectsPayable(() => payables.parseSupplierBill({ ...sampleBill, issueDate: "2026-02-29" })), "A/P: bill dates must be real and due date cannot precede issue date");
const billPayment = payables.parseSupplierBillPayment({
  requestKey: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", amount: "25.25", paidAt: "2026-09-30",
  method: "Transfer", reference: "TR-22", notes: "First part",
});
check(billPayment.requestKey === "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" && billPayment.amountCents === 2525 && billPayment.method === "Transfer", "A/P: payment dates, methods, UUID retry keys and cents parse consistently");
check(rejectsPayable(() => payables.parseSupplierBillPayment({ requestKey: "bad", amount: "20", paidAt: "2026-09-30", method: "Transfer" })) && rejectsPayable(() => payables.parseSupplierBillPayment({ requestKey: uuid, amount: "0", paidAt: "2026-09-30", method: "Bitcoin" })), "A/P: payments require a UUID, positive amount and supported method");
check(rejectsPayable(() => payables.parseSupplierBillCancellation({ reason: " " })) && payables.parseSupplierBillVoid({ reason: "  bank returned  " }).reason === "bank returned", "A/P: bill cancellation and payment void require a trimmed audit reason");
check(payables.paymentState(10000, 0) === "Unpaid" && payables.paymentState(10000, 1) === "Partially paid" && payables.paymentState(10000, 10000) === "Paid", "A/P: payment state is derived from posted cents");
check(payables.payableAgingBucket(null, "2026-10-01") === "current" && payables.payableAgingBucket("2026-10-01", "2026-10-01") === "current" && payables.payableAgingBucket("2026-09-01", "2026-10-01") === "d1-30" && payables.payableAgingBucket("2026-08-31", "2026-10-01") === "d31-60" && payables.payableAgingBucket("2026-08-01", "2026-10-01") === "d61-90" && payables.payableAgingBucket("2026-07-02", "2026-10-01") === "d90+", "A/P: due-date aging boundaries are current / 1–30 / 31–60 / 61–90 / 90+");
check(payables.supplierBillNumber(14) === "SB-000014" && purchasing.newSupplierPaymentRequestKey({ randomUUID: () => uuid, getRandomValues: () => { throw Error("fallback should not run"); } }) === uuid, "A/P: internal bill IDs are stable and payment retry keys use secure UUIDs");

const purchasingGrants = { version: 1, enabled: ["invoicing", "purchasing"], roles: { Technician: ["purchasing"] }, users: { "9": ["purchasing"] } };
const renderPurchaseSidebar = (role, cfg, id = 1) => renderToString(React.createElement(Sidebar, { ...props(role), currentUser: { ...props(role).currentUser, id }, optionalModulesConfig: cfg }));
check(mgr.includes("Purchasing &amp; Suppliers"), "purchasing: Manager always sees the new sidebar screen");
check(!renderPurchaseSidebar("Technician", null).includes("Purchasing &amp; Suppliers"), "purchasing: ungranted role cannot see Purchasing in sidebar");
check(renderPurchaseSidebar("Technician", purchasingGrants).includes("Purchasing &amp; Suppliers"), "purchasing: granted role gets the Purchasing screen");
check(renderPurchaseSidebar("Machine Operator", purchasingGrants, 9).includes("Purchasing &amp; Suppliers"), "purchasing: personal grant works even when legacy role screen list excludes purchasing");
check(!renderPurchaseSidebar("Machine Operator", { ...purchasingGrants, enabled: ["invoicing"] }, 9).includes("Purchasing &amp; Suppliers"), "purchasing: switched-off module hides even a personally granted screen");
check(optMod.screenOwnerModule("purchasing") === "purchasing" && optMod.screenAllowedForSubject("purchasing", { id: 9, role: "Machine Operator" }, purchasingGrants), "purchasing: page screen ownership and personal-grant check agree");

const purchaseRoutePaths = [
  "src/app/api/purchasing/route.ts", "src/app/api/purchasing/suppliers/route.ts",
  "src/app/api/purchasing/suppliers/[id]/route.ts", "src/app/api/purchasing/orders/route.ts",
  "src/app/api/purchasing/orders/[id]/route.ts", "src/app/api/purchasing/orders/[id]/receipts/route.ts",
];
check(purchaseRoutePaths.every((p) => fs.readFileSync(p, "utf8").includes('authorizeModule("purchasing")')), "purchasing: EVERY supplier/PO/GRN route enforces the optional module on the server");
const payableRoutePaths = [
  "src/app/api/purchasing/payables/route.ts", "src/app/api/purchasing/bills/route.ts",
  "src/app/api/purchasing/bills/[id]/payments/route.ts", "src/app/api/purchasing/bills/[id]/cancel/route.ts",
  "src/app/api/purchasing/payments/[id]/void/route.ts",
];
check(payableRoutePaths.every((p) => fs.readFileSync(p, "utf8").includes("authorizePayables()")), "A/P: EVERY bill, payment, void and aging route enforces both Purchasing and Money grants");
const payablesApiSource = fs.readFileSync("src/lib/payables.server.ts", "utf8");
const payablesSchemaSource = fs.readFileSync("src/lib/payablesSchema.server.ts", "utf8");
const payablesUiSource = fs.readFileSync("src/components/SupplierBillsView.tsx", "utf8");
const authPayablesSource = fs.readFileSync("src/lib/auth.ts", "utf8");
check(authPayablesSource.includes('authorizeModule("purchasing")') && authPayablesSource.includes("canSeeMoney(user, readOptionalModules())"), "A/P: server authorization requires the independent Purchasing and Invoicing & Money grants");
check(payablesSchemaSource.includes("create table if not exists supplier_bills") && payablesSchemaSource.includes("create table if not exists supplier_bill_payments") && payablesSchemaSource.includes("pg_advisory_xact_lock") && payablesSchemaSource.includes("where status = 'Open'") && !/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(payablesSchemaSource), "A/P: lazy DDL is additive, serialized, reference-deduplicated and allows corrected cancelled bills");
check(payablesApiSource.includes('.for("update")') && payablesApiSource.includes("postedTotal") && payablesApiSource.includes("outstandingCents") && payablesApiSource.includes('isolationLevel: "repeatable read"'), "A/P: bill locks prevent concurrent overpayment/cancel races and board balances use one consistent snapshot");
check(payablesApiSource.includes("requestKey") && payablesSchemaSource.includes("request_key text not null unique") && payablesApiSource.includes("replayed: true") && payablesApiSource.includes('status: "Voided"'), "A/P: payment retries are idempotent and voids retain their audit records");
check(payablesUiSource.includes("A/P aging") && payablesUiSource.includes("/api/purchasing/bills") && payablesUiSource.includes("/void") && payablesUiSource.includes("PAYABLE_AGING_BUCKETS"), "A/P: UI records bills, payments and reasons for cancel/void, and renders aging buckets");
const payablesHtml = renderToString(React.createElement(SupplierBillsView, { suppliers: [], orders: [], supplierId: null }));
check(payablesHtml.includes("Supplier bills") && payablesHtml.includes("A/P aging") && payablesHtml.includes("Supplier bill register"), "A/P: supplier bill and aging screen renders cleanly in its initial state");
const payablesParentUiSource = fs.readFileSync("src/components/PurchasingView.tsx", "utf8");
check(payablesParentUiSource.includes("<SupplierBillsView") && payablesParentUiSource.includes('panel === "payables" && board?.canSeeMoney'), "A/P: supplier bill screen is mounted only inside Purchasing for users with the money grant");
const purchaseApiSource = fs.readFileSync("src/lib/purchasing.server.ts", "utf8");
const purchaseSchemaSource = fs.readFileSync("src/lib/purchasingSchema.server.ts", "utf8");
const purchaseUiSource = fs.readFileSync("src/components/PurchasingView.tsx", "utf8");
check(purchaseSchemaSource.includes("create table if not exists suppliers") && purchaseSchemaSource.includes("goods_receipt_lines_unique_idx") && purchaseSchemaSource.includes("pg_advisory_xact_lock") && !/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(purchaseSchemaSource), "purchasing: additive lazy table setup is transaction-serialized and never destructive");
check(purchaseApiSource.includes('.for("update")') && purchaseApiSource.includes("summary.lines") && purchaseApiSource.includes("requested.quantity > line.remainingQuantity"), "purchasing: PO row lock and outstanding checks prevent concurrent over-receipt");
check(purchaseApiSource.includes("requestKey") && purchaseSchemaSource.includes("request_key text not null unique") && purchaseApiSource.includes("replayed: true"), "purchasing: receipt retry key is unique and replay is stock-idempotent");
check(purchaseApiSource.includes("tx.insert(goodsReceipts)") && purchaseApiSource.includes("tx.insert(goodsReceiptLines)") && purchaseApiSource.includes("tx.update(inventoryItems)") && purchaseApiSource.includes("stockQuantity: sql`") && purchaseApiSource.includes("throw new PurchasingError(\"Stock item unavailable"), "purchasing: GRN and additive stock increment commit in the same transaction or roll back together");
check(purchaseApiSource.includes('isolationLevel: "repeatable read"') && purchaseApiSource.includes("awaitingQuantity"), "purchasing: supplier awaiting list reads a consistent PO/GRN/stock snapshot");
check(purchaseUiSource.includes("/api/purchasing/orders") && purchaseUiSource.includes("newReceiptRequestKey()") && purchaseUiSource.includes("onStockChanged") && purchaseUiSource.includes("suggestedReorderQty"), "purchasing: UI creates POs, posts receipts with a retry key and refreshes stock");
check(pageSource.includes("<PurchasingView") && pageSource.includes("screenAllowedForSubject(activeTab, currentUser, optionalConfig)") && fs.readFileSync("src/components/Sidebar.tsx", "utf8").includes("screenAllowedForSubject"), "purchasing: sidebar, page guard and rendering all honor per-person grants");
check(dashboardSource.includes("onCreatePurchaseOrder(a.itemId)") && fs.readFileSync("src/app/api/alerts/route.ts", "utf8").includes("suggestedReorderQty"), "purchasing: low-stock bell offers a one-click prefilled PO path");
const purchaseInvRouteSource = fs.readFileSync("src/app/api/inventory/route.ts", "utf8");
const purchaseInvIdRouteSource = fs.readFileSync("src/app/api/inventory/[id]/route.ts", "utf8");
const purchaseMachineIdRouteSource = fs.readFileSync("src/app/api/machines/[id]/route.ts", "utf8");
check(purchaseInvRouteSource.includes("canSeeMoney") && purchaseInvIdRouteSource.includes("canSeeMoney") && inventoryImportApiSource.includes("canSeeMoney") && dataAccessSource.includes("if (!canSeeMoney(user, readOptionalModules()))"), "purchasing: inventory reads, writes and costed Excel imports follow money grants");
check(machinesSource.includes("canSeeMoney") && purchaseMachineIdRouteSource.includes("canSeeMoney") && dataAccessSource.includes("if (canSeeMoney(user, readOptionalModules())) return rows"), "purchasing: machine list, detail and mutation rates follow money grants");
check(machinesSource.includes('const hourlyCost = money ? String(body.hourlyCost ?? "65.00") : "0.00"'), "purchasing: no-money machine creation cannot silently set a financial hourly rate");
check(dashboardApiSource.includes("unitCost: money ? i.unitCost : null") && fs.readFileSync("src/app/api/orders/[id]/materials/route.ts", "utf8").includes("return maySeeMoney ? rows : rows.map"), "purchasing: dashboard low-stock items and order BOM list cannot leak material costs");

// =====================================================================
// Invoicing & A/R (PR #10 — quotes, VAT invoices, payments, aging, ledger)
// =====================================================================
const inv = require("./compiled/lib/invoicing.js");
const rejectsInvoice = (fn, status = 400) => {
  try { fn(); return false; }
  catch (error) { return error instanceof inv.InvoicingError && (status === undefined || error.status === status); }
};

check(inv.documentNumber("INV", 2026, 7) === "INV-2026-000007" && inv.documentNumber("QUO", 2026, 42) === "QUO-2026-000042" && inv.seriesFor("Quote") === "QUO" && inv.seriesFor("Invoice") === "INV", "invoicing: legal per-year numbering keeps separate QUO and INV series");
const docInput = { customerId: 4, issueDate: "2026-03-01", dueDate: "2026-03-31", vatRate: "11.00", notes: "50% deposit", lines: [{ description: "Oak kitchen", quantity: "1.5", unitPrice: "1200.00" }] };
const docParsed = inv.parseDocument("Invoice", docInput);
check(docParsed.lines[0].quantityHundredths === 150 && docParsed.lines[0].lineTotalCents === 180000 && docParsed.subtotalCents === 180000 && docParsed.vatCents === 19800 && docParsed.totalCents === 199800, "invoicing: 11% VAT snapshots to cents ($1,800.00 + $198.00 = $1,998.00)");
check(inv.parseDocument("Invoice", { ...docInput, vatRate: "0" }).vatCents === 0 && inv.vatRateBps("11") === 1100 && inv.vatRateFromBps(1100) === "11.00" && inv.parseDocument("Quote", { ...docInput, vatRate: "8.25" }).vatRateBps === 825, "invoicing: VAT defaults to the Lebanese 11% and round-trips exactly");
check(inv.parseDocument("Invoice", { ...docInput, vatRate: "" }).vatRateBps === 1100, "invoicing: a blank VAT rate falls back to 11% (Lebanon default)");
check(rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, vatRate: "101" })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, vatRate: "11.005" })) && rejectsInvoice(() => inv.parseDocument("Note", docInput)), "invoicing: impossible VAT rates and unknown document kinds are rejected");
check(rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [] })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: Array.from({ length: 51 }, () => ({ description: "x", quantity: "1", unitPrice: "0" })) })), "invoicing: documents need 1 to 50 lines");
check(rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ description: "", quantity: "1", unitPrice: "0" }] })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ description: "x", quantity: "0", unitPrice: "0" }] })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ description: "x", quantity: "1.234", unitPrice: "0" }] })), "invoicing: empty descriptions, zero quantities and excess precision are rejected");
check(rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, issueDate: "2026-02-30" })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, issueDate: "01/03/2026" })), "invoicing: impossible or non-ISO issue dates are rejected");
check(inv.parseDocument("Quote", { ...docInput, dueDate: "" }).dueDate === null && inv.quantityHundredths("0.05") === 5 && inv.quantityHundredths("999999.99") === 99999999 && rejectsInvoice(() => inv.quantityHundredths("1000000")), "invoicing: quotes may omit valid-until; quantities allow 2 decimals inside the limits");
check(inv.parseDocument("Invoice", docInput).dueDate < inv.parseDocument("Invoice", docInput).issueDate === false, "invoicing: accepted document dates are ISO-normalized");

const payParsed = inv.parsePayment({ amount: "250.50", paidAt: "2026-03-15", method: "Transfer", reference: "CHQ-9", notes: "" });
check(payParsed.amountCents === 25050 && payParsed.method === "Transfer" && payParsed.reference === "CHQ-9", "invoicing: payments parse to cents with method, date and reference");
check(rejectsInvoice(() => inv.parsePayment({ amount: "0", paidAt: "2026-03-15" })) && rejectsInvoice(() => inv.parsePayment({ amount: "5", paidAt: "2026-3-5" })) && rejectsInvoice(() => inv.parsePayment({ amount: "5", paidAt: "2026-03-15", method: "Crypto" })), "invoicing: zero amounts, bad dates and unknown payment methods are rejected");

check(inv.paymentState(1000, 0) === "Unpaid" && inv.paymentState(1000, 400) === "Partially paid" && inv.paymentState(1000, 1000) === "Paid" && inv.paymentState(1000, 1200) === "Paid", "invoicing: payment state derives from amounts");
check(inv.daysPastDue("2026-03-31", "2026-03-31") === 0 && inv.daysPastDue(null, "2026-03-31") === -1, "invoicing: due today is current, a missing due date never ages");
check(
  inv.agingBucketFor("2026-04-01", "2026-03-31") === "current" && inv.agingBucketFor("2026-03-31", "2026-03-31") === "current"
  && inv.agingBucketFor("2026-03-30", "2026-03-31") === "d1-30" && inv.agingBucketFor("2026-03-01", "2026-03-31") === "d1-30"
  && inv.agingBucketFor("2026-02-28", "2026-03-31") === "d31-60" && inv.agingBucketFor("2026-01-30", "2026-03-31") === "d31-60"
  && inv.agingBucketFor("2026-01-29", "2026-03-31") === "d61-90" && inv.agingBucketFor("2025-12-30", "2026-03-31") === "d90+",
  "invoicing: A/R aging buckets split at 0/30/60/90 days past due",
);
check(inv.addDaysIso("2026-03-01", 30) === "2026-03-31" && inv.addDaysIso("2026-12-28", 5) === "2027-01-02", "invoicing: 30-day payment terms cross month and year ends correctly");

// ---- line stock picker (follow-up: searchable description field) ----
const stockRows = [
  { id: 1, sku: "BOARD-MDF-18-OAK", name: "MDF Oak Board 18mm", category: "Wood & MDF Panels", unit: "sheets" },
  { id: 2, sku: "EB-WHT-22", name: "White Edge Banding 22mm", category: "Edge Banding", unit: "meters" },
  { id: 3, sku: "HNG-35", name: "Soft-close Hinge 35mm", category: "Hardware & Fittings", unit: "pcs" },
];
check(inv.stockLineDescription(stockRows[0]) === "MDF Oak Board 18mm (BOARD-MDF-18-OAK)", "stock picker: the description snapshot is Name (SKU)");
check(inv.stockLineDescription({ name: "Design fee", sku: "" }) === "Design fee" && inv.stockLineDescription({ name: "x".repeat(400), sku: "S" }).length === inv.MAX_LINE_DESCRIPTION, "stock picker: a missing SKU falls back to the name and the snapshot respects the 200-character line limit");
check(inv.filterStockItems(stockRows, "").length === 3 && inv.filterStockItems(stockRows, "oak board").length === 1 && inv.filterStockItems(stockRows, "eb-wht").length === 1 && inv.filterStockItems(stockRows, "edge band").length === 1 && inv.filterStockItems(stockRows, "meters").length === 1 && inv.filterStockItems(stockRows, "nothing here").length === 0, "stock picker: typing filters by item name, SKU, category or unit");
check(inv.filterStockItems(stockRows, "  HINGE  ").length === 1 && inv.filterStockItems(stockRows, "", 2).length === 2 && inv.MAX_STOCK_PICKER_RESULTS === 50, "stock picker: the query is trimmed/case-insensitive and results are capped");
const strippedIdentity = inv.stockIdentity({ ...stockRows[0], unitCost: "55.00", stockQuantity: 900, reorderLevel: 10, location: "Rack 3-B" });
check(Object.keys(strippedIdentity).sort().join(",") === "category,id,name,sku,unit" && strippedIdentity.unitCost === undefined && strippedIdentity.stockQuantity === undefined && inv.STOCK_IDENTITY_KEYS.length === 5, "stock picker: identity helpers strip costs and quantities (never exposed to the picker)");
check(inv.stockPickerQuery("MDF Oak Board 18mm (BOARD-MDF-18-OAK)", stockRows[0]) === "" && inv.stockPickerQuery("MDF Oak", stockRows[0]) === "MDF Oak" && inv.stockPickerQuery("", null) === "", "stock picker: clicking an untouched snapshot browses the whole list while any other text filters it");
const pickedParse = inv.parseDocument("Invoice", { ...docInput, lines: [{ inventoryItemId: 7, description: "", quantity: "2", unitPrice: "10.00" }] });
check(pickedParse.lines[0].inventoryItemId === 7 && pickedParse.lines[0].description === "" && pickedParse.subtotalCents === 2000, "stock picker: a picked link parses even before the server fills the snapshot text");
check(inv.parseDocument("Invoice", docInput).lines[0].inventoryItemId === null && inv.optionalInventoryItemId(undefined) === null && inv.optionalInventoryItemId("") === null && inv.optionalInventoryItemId("12") === 12, "stock picker: custom service/fee lines stay unlinked and optional ids normalize to null");
check(rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ inventoryItemId: 0, description: "x", quantity: "1", unitPrice: "0" }] })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ inventoryItemId: "abc", description: "x", quantity: "1", unitPrice: "0" }] })) && rejectsInvoice(() => inv.parseDocument("Invoice", { ...docInput, lines: [{ inventoryItemId: null, description: "", quantity: "1", unitPrice: "0" }] })), "stock picker: non-positive ids, junk ids and blank custom descriptions are rejected");
check(inv.MAX_DOC_LINES === 50 && inv.parseDocument("Invoice", docInput).lines[0].lineTotalCents === 180000, "stock picker: the link never changes how a line total is computed");
check(i18n.tt("ar", "Invoicing & A/R") === "الفواتير والذمم" && i18n.tt("fr", "Invoicing & A/R") === "Facturation & créances", "invoicing: Arabic and French sidebar labels ship with the screen");

check(mgr.includes("Invoicing &amp; A/R"), "invoicing: Manager always sees the Invoicing & A/R screen");
const invGrants = { version: 1, enabled: ["invoicing"], roles: { Technician: ["invoicing"] }, users: { "9": ["invoicing"] } };
check(!renderPurchaseSidebar("Technician", null).includes("Invoicing &amp; A/R"), "invoicing: ungranted role cannot see Invoicing in the sidebar");
check(renderPurchaseSidebar("Technician", invGrants).includes("Invoicing &amp; A/R"), "invoicing: granted role gets the Invoicing screen");
check(renderPurchaseSidebar("Machine Operator", invGrants, 9).includes("Invoicing &amp; A/R"), "invoicing: personal grant works even when the legacy role list excludes invoicing");
check(!renderPurchaseSidebar("Machine Operator", { ...invGrants, enabled: [] }, 9).includes("Invoicing &amp; A/R"), "invoicing: switched-off module hides even a personally granted screen");
check(optMod.OPTIONAL_MODULE_SCREENS.invoicing.includes("invoicing") && optMod.screenOwnerModule("invoicing") === "invoicing" && optMod.screenAllowedForSubject("invoicing", { id: 9, role: "Machine Operator" }, invGrants), "invoicing: screen ownership and personal-grant check agree");

const invoicingRoutePaths = [
  "src/app/api/invoicing/route.ts", "src/app/api/invoicing/[id]/route.ts",
  "src/app/api/invoicing/[id]/convert/route.ts", "src/app/api/invoicing/[id]/cancel/route.ts",
  "src/app/api/invoicing/[id]/payments/route.ts", "src/app/api/invoicing/payments/[id]/route.ts",
  "src/app/api/invoicing/stock-items/route.ts",
];
check(invoicingRoutePaths.every((p) => fs.readFileSync(p, "utf8").includes('authorizeModule("invoicing")')), "invoicing: EVERY quote/invoice/payment route enforces the optional module on the server");
const invApiSource = fs.readFileSync("src/lib/invoicing.server.ts", "utf8");
const invSchemaSource = fs.readFileSync("src/lib/invoicingSchema.server.ts", "utf8");
const invUiSource = fs.readFileSync("src/components/InvoicingView.tsx", "utf8");
const ledgerRouteSource = fs.readFileSync("src/app/api/customers/[id]/ledger/route.ts", "utf8");
const ledgerServerSource = fs.readFileSync("src/lib/clientLedger.server.ts", "utf8");
check(invSchemaSource.includes("create table if not exists invoices") && invSchemaSource.includes("document_counters") && invSchemaSource.includes("pg_advisory_xact_lock") && !/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(invSchemaSource), "invoicing: additive lazy table setup is transaction-serialized and never destructive");
check(invApiSource.includes('.for("update")') && invApiSource.includes("payload.amountCents > outstandingCents"), "invoicing: invoice row lock + outstanding check stop overpayment and payment races");
check(invApiSource.includes("nextNumber(tx") && invApiSource.includes("onConflictDoUpdate") && invApiSource.includes("lastNumber: sql`"), "invoicing: legal numbers are reserved in the creating transaction (gapless under concurrency)");
check(invApiSource.includes('status: "Converted"') && invApiSource.includes("convertedFromId: quote.id"), "invoicing: quotation conversion copies lines and links both documents");
check(invApiSource.includes("recorded payments cannot be cancelled") && invApiSource.includes('status !== "Open"'), "invoicing: paid invoices cannot be voided and closed documents cannot change");
check(invApiSource.includes('isolationLevel: "repeatable read"') && invApiSource.includes("agingBucketFor") && invApiSource.includes("syncCustomerBalance"), "invoicing: board, aging and balance sync read consistent snapshots");
check(ledgerServerSource.includes('source: "document"') && ledgerServerSource.includes("loadMergedLedger") && ledgerRouteSource.includes("loadMergedLedger") && ledgerRouteSource.includes("Invoicing & A/R are managed there") && ledgerRouteSource.includes("authorizeModule(MONEY_MODULE)"), "invoicing: client ledger merges documents, keeps the money gate and blocks hand-deleting them");
check(ledgerServerSource.includes("currentBalance: String(summary.balance)"), "invoicing: client balance re-syncs so credit checks see document totals");
check(invUiSource.includes("/api/invoicing") && invUiSource.includes("jsPDF") && invUiSource.includes("Convert to invoice") && invUiSource.includes("Record payment") && invUiSource.includes("A/R aging"), "invoicing: UI issues quotes, invoices, payments, aging and printable PDFs");
check(pageSource.includes("<InvoicingView") && pageSource.includes('subjectHasModule("invoicing", currentUser, optionalConfig)'), "invoicing: screen mounts behind the per-person grant");

// ---- line stock picker wiring (follow-up) ----
const invStockRouteSource = fs.readFileSync("src/app/api/invoicing/stock-items/route.ts", "utf8");
const stockListSource = invApiSource.match(/export async function listStockIdentity[\s\S]*?\n}/)?.[0] ?? "";
check(invStockRouteSource.includes('authorizeModule("invoicing")') && invStockRouteSource.includes("INVOICING_NO_STORE") && invStockRouteSource.includes("listStockIdentity"), "stock picker: the stock list route stays behind the Invoicing & Money grant");
check(stockListSource.length > 0 && /map\(stockIdentity\)/.test(stockListSource) && !/unitCost|stockQuantity|reorderLevel|location/.test(stockListSource), "stock picker: the server list selects identity fields only — costs and quantities are never read");
const invCreateSource = invApiSource.match(/export async function createDocument[\s\S]*?\n}/)?.[0] ?? "";
check(invCreateSource.includes("stockIdentityById") && invCreateSource.includes("stockLineDescription") && invCreateSource.includes("InvoicingError(STOCK_GONE"), "stock picker: the server validates every picked id and snapshots the description itself");
const invConvertSource = invApiSource.match(/export async function convertQuote[\s\S]*?\n}/)?.[0] ?? "";
check(/inventoryItemId/.test(invConvertSource) && invConvertSource.includes("description: line.description"), "stock picker: quote conversion copies the stock link with the description snapshot");
check(invSchemaSource.includes("inventory_item_id integer references inventory_items(id) on delete set null") && invSchemaSource.includes("alter table invoice_lines add column if not exists inventory_item_id") && invSchemaSource.includes("create index if not exists invoice_lines_inventory_item_idx"), "stock picker: lazy DDL adds the nullable link and its index additively for existing installations");
check(dbxSchemaSource.includes('inventoryItemId: integer("inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" })') && dbxSchemaSource.includes('index("invoice_lines_inventory_item_idx").on(t.inventoryItemId)'), "stock picker: schema.ts keeps the link and its index in sync with the lazy DDL");
check(invUiSource.includes("/api/invoicing/stock-items") && invUiSource.includes("filterStockItems") && invUiSource.includes("stockLineDescription") && invUiSource.includes("stockPickerQuery") && invUiSource.includes('role="combobox"') && invUiSource.includes('role="listbox"'), "stock picker: every draft line is a searchable stock combobox fed by the granted identity list");
const pickHandlerSource = invUiSource.match(/const pick = \(item: StockItem\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
check(pickHandlerSource.includes("inventoryItemId: item.id") && pickHandlerSource.includes("description: stockLineDescription(item)") && !/unitPrice|quantity/.test(pickHandlerSource), "stock picker: choosing an item stores the link + snapshot and never touches price or quantity");
check(invUiSource.includes("Unlink (keep as custom text)") && invUiSource.includes("Custom service/fee line") && invUiSource.includes("keepLink"), "stock picker: custom service/fee descriptions stay available and editing text unlinks");
check(!/unitCost|stockQuantity|reorderLevel/.test(invUiSource), "stock picker: the invoicing screen never handles costs or quantities");
check(invUiSource.includes("inventoryItemId !== null && (") && invUiSource.includes("Linked to stock"), "stock picker: saved documents mark their stock-linked lines");
const InvoicingViewModule = require("./compiled/components/InvoicingView.js");
const linkedLineHtml = renderToString(React.createElement(InvoicingViewModule.StockPicker, {
  line: { inventoryItemId: stockRows[0].id, description: inv.stockLineDescription(stockRows[0]), quantity: "1", unitPrice: "0.00" },
  index: 0, items: stockRows, status: "ready", onChange: () => {},
}));
const customLineHtml = renderToString(React.createElement(InvoicingViewModule.StockPicker, {
  line: { inventoryItemId: null, description: "Design & installation fee", quantity: "1", unitPrice: "150.00" },
  index: 1, items: stockRows, status: "ready", onChange: () => {},
}));
check(linkedLineHtml.includes('role="combobox"') && linkedLineHtml.includes("MDF Oak Board 18mm (BOARD-MDF-18-OAK)") && linkedLineHtml.includes("Linked to stock") && linkedLineHtml.includes("BOARD-MDF-18-OAK") && linkedLineHtml.includes("Unlink (keep as custom text)") && linkedLineHtml.includes('maxLength="200"'), "stock picker: a picked line renders the combobox with its snapshot and a visible unlink");
check(customLineHtml.includes("Design &amp; installation fee") && customLineHtml.includes("Custom service/fee line") && !customLineHtml.includes("Linked to stock"), "stock picker: a custom service/fee line renders without a stock link");
const loadingHtml = renderToString(React.createElement(InvoicingViewModule.StockPicker, {
  line: { inventoryItemId: null, description: "", quantity: "1", unitPrice: "0.00" },
  index: 0, items: [], status: "error", onChange: () => {},
}));
check(!loadingHtml.includes("unitCost") && !loadingHtml.includes("stockQuantity"), "stock picker: the rendered picker never prints cost or quantity fields");

// =====================================================================
// Job costing & profitability (Phase B item 3)
// =====================================================================
const jc = require("./compiled/lib/jobCosting.js");
const rejectsJc = (fn, status = 400) => {
  try { fn(); return false; }
  catch (error) { return error instanceof jc.JobCostingError && error.status === status; }
};

check(jc.moneyToCents("12.5") === 1250 && jc.moneyToCents("$0.07") === 7 && jc.moneyToCents("100") === 10000 && rejectsJc(() => jc.moneyToCents("-1")) && rejectsJc(() => jc.moneyToCents("1.234")) && rejectsJc(() => jc.moneyToCents("abc")), "job costing: money parses to exact cents and refuses negatives/over-precision");
check(jc.percentToBps("12.5") === 1250 && jc.percentToBps("10%") === 1000 && rejectsJc(() => jc.percentToBps("-5")), "job costing: percentages parse to basis points");
const jcSet = jc.parseJobCostSettings({ laborRate: "18.50", overheadPercent: "12" });
check(jcSet.laborRateCentsPerHour === 1850 && jcSet.overheadBps === 1200, "job costing: Manager settings parse (labor $/h + overhead %)");
check(jc.parseJobCostSettings({}).laborRateCentsPerHour === 0 && jc.parseJobCostSettings({ laborRate: "", overheadPercent: "" }).overheadBps === 0, "job costing: blank settings switch the line off (0)");
check(rejectsJc(() => jc.parseJobCostSettings({ laborRate: "1000000" })) && rejectsJc(() => jc.parseJobCostSettings({ overheadPercent: "501" })), "job costing: absurd labor rates and overhead are refused as typos");
check(jc.sanitizeJobCostSettings({ laborRateCentsPerHour: -5, overheadBps: "x" }).laborRateCentsPerHour === 0 && jc.sanitizeJobCostSettings(null).overheadBps === 0 && jc.sanitizeJobCostSettings({ laborRateCentsPerHour: 2500, overheadBps: 800 }).overheadBps === 800, "job costing: a corrupt settings file falls back to safe defaults");
check(jc.centsToMoney(114950) === "1149.50" && jc.centsToMoney(-5) === "-0.05" && jc.numericToCents("65.00") === 6500 && jc.numericToCents(null) === 0 && jc.numericToCents("-3") === 0, "job costing: cents formatting and numeric(…) text conversion");

const jcNow = new Date("2026-10-01T12:00:00Z");
const jcRates = new Map([[1, 6000], [2, 12000]]);
const jcOrder = (over = {}) => ({ id: 7, orderNumber: "ORD-2026-0007", title: "Oak kitchen", status: "In Production", projectType: "Custom Kitchens", customerId: 3, customerName: "Acme", totalValue: "10000.00", createdAt: "2026-09-01T08:00:00Z", dueDate: "2026-10-20T08:00:00Z", ...over });
const jcMats = [
  { id: 1, itemName: "Oak board", itemSku: "OAK-18", unit: "sheets", quantityUsed: 10, costPerUnit: "50.00", consumed: true, released: false },
  { id: 2, itemName: "Hinge", itemSku: "HNG-1", unit: "pcs", quantityUsed: 2, costPerUnit: "100.00", consumed: false, released: false },
  { id: 3, itemName: "Released board", itemSku: "REL-1", unit: "sheets", quantityUsed: 5, costPerUnit: "99.00", consumed: false, released: true },
];
const jcOps = [
  { id: 11, stepOrder: 1, operationName: "Cut", machineId: 1, machineCode: "BEAM-01", status: "Completed", estimatedMinutes: 100, actualMinutes: 120, startTime: null, endTime: null },
  { id: 12, stepOrder: 2, operationName: "Drill", machineId: 2, machineCode: "DRL-01", status: "Completed", estimatedMinutes: 30, actualMinutes: 0, startTime: "2026-09-10T08:00:00Z", endTime: "2026-09-10T08:30:00Z" },
  { id: 13, stepOrder: 3, operationName: "Assemble", machineId: 1, machineCode: "BEAM-01", status: "Pending", estimatedMinutes: 60, actualMinutes: 0, startTime: null, endTime: null },
];
const jcSettings = { laborRateCentsPerHour: 3000, overheadBps: 1000 };
const jcOpen = jc.costOrder({ order: jcOrder(), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcOpen.materialsCents === 70000 && jcOpen.materialsConsumedCents === 50000 && jcOpen.materialsReservedCents === 20000 && jcOpen.materialLines.length === 2, "job costing: released allocations cost nothing; consumed and reserved are both counted");
check(jcOpen.basis === "Projected" && jcOpen.machineCents === 24000 && jcOpen.laborCents === 10500 && jcOpen.overheadCents === 10450 && jcOpen.costCents === 114950, "job costing: open order = materials + machine + labor + overhead on the PROJECTED plan");
check(jcOpen.actualCostCents === 105050 && jcOpen.projectedCostCents === 114950 && jcOpen.revenueCents === 1000000 && jcOpen.profitCents === 885050 && jcOpen.marginBps === 8851, "job costing: actual-to-date vs projected cost, profit and margin in exact cents");
check(jcOpen.operationLines[1].actualMinutes === 30 && jcOpen.operationLines[1].basis === "recorded" && jcOpen.operationLines[2].projectedMinutes === 60 && jcOpen.operationLines[2].actualMinutes === 0, "job costing: finished step with no minutes uses start→end; unstarted step costs its estimate only in the projection");
const jcFinal = jc.costOrder({ order: jcOrder({ status: "Completed" }), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcFinal.basis === "Final" && jcFinal.costCents === 105050 && jcFinal.machineCents === 18000 && jcFinal.laborCents === 7500, "job costing: a Completed order is judged on ACTUAL time (final margin)");
check(jc.isFinalOrderStatus("Delivered") && jc.isFinalOrderStatus("Completed") && !jc.isFinalOrderStatus("In Production") && !jc.isFinalOrderStatus(null), "job costing: Completed and Delivered are the final statuses");
const jcZero = jc.costOrder({ order: jcOrder(), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jc.DEFAULT_JOB_COST_SETTINGS, now: jcNow });
check(jcZero.laborCents === 0 && jcZero.overheadCents === 0 && jcZero.costCents === 94000, "job costing: unset labor rate / overhead add $0 (machine time still counts)");
const jcRunning = jc.costOrder({ order: jcOrder(), materials: [], operations: [{ id: 21, stepOrder: 1, operationName: "Route", machineId: 1, machineCode: "BEAM-01", status: "In Progress", estimatedMinutes: 30, actualMinutes: 0, startTime: "2026-10-01T10:00:00Z", endTime: null }], quality: [], machineRates: jcRates, settings: jc.DEFAULT_JOB_COST_SETTINGS, now: jcNow });
check(jcRunning.operationLines[0].actualMinutes === 120 && jcRunning.operationLines[0].basis === "elapsed" && jcRunning.machineCents === 12000, "job costing: a step running right now costs its elapsed time once it overruns the plan");
const jcLoss = jc.costOrder({ order: jcOrder({ totalValue: "500.00", status: "Completed" }), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcLoss.profitCents < 0 && jcLoss.flags.includes("loss") && jcLoss.marginBps < 0, "job costing: an order below cost is flagged as losing money");
const jcThin = jc.costOrder({ order: jcOrder({ totalValue: "1100.00", status: "Completed" }), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcThin.flags.includes("low-margin") && !jcThin.flags.includes("loss"), "job costing: margin under 10% is flagged as thin, not as a loss");
const jcNoVal = jc.costOrder({ order: jcOrder({ totalValue: "0.00" }), materials: [], operations: [], quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcNoVal.marginBps === null && jcNoVal.flags.includes("no-revenue") && jcNoVal.flags.includes("no-materials") && jc.marginText(null) === "—", "job costing: a zero-value order has no margin (never a fake 0% or −100%)");
const jcNoTime = jc.costOrder({ order: jcOrder({ status: "Completed" }), materials: [], operations: [{ id: 31, stepOrder: 1, operationName: "Sand", machineId: 9, machineCode: "X", status: "Completed", estimatedMinutes: 45, actualMinutes: 0, startTime: null, endTime: null }], quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcNoTime.flags.includes("no-time") && jcNoTime.flags.includes("rate-missing") && jcNoTime.operationLines[0].basis === "planned" && jcNoTime.actualMinutes === 45, "job costing: untimed finished steps fall back to plan and are flagged, as are machines with no rate");
const jcOver = jc.costOrder({ order: jcOrder(), materials: [], operations: [{ id: 41, stepOrder: 1, operationName: "Cut", machineId: 1, machineCode: "B", status: "Completed", estimatedMinutes: 60, actualMinutes: 90, startTime: null, endTime: null }], quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcOver.flags.includes("time-overrun"), "job costing: more than 15% over the planned time is flagged");
const jcQ = jc.costOrder({ order: jcOrder(), materials: jcMats, operations: jcOps, quality: [{ id: 1, eventType: "scrap", quantity: 2, estimatedCost: "40.00", reason: "Chip" }, { id: 2, eventType: "rework", quantity: 1, estimatedCost: "15.50", reason: "Edge" }], machineRates: jcRates, settings: jcSettings, now: jcNow });
check(jcQ.scrapCents === 8000 && jcQ.reworkCents === 1550 && jcQ.costCents === jcOpen.costCents, "job costing: scrap/rework is a memo and is NOT charged on top of the materials line");

const jcRows = [jcOpen, jcLoss, jcFinal, jc.costOrder({ order: jcOrder({ id: 8, orderNumber: "ORD-2026-0008", customerId: 4, customerName: "Beta", projectType: "Wardrobe Fit-out", status: "Delivered" }), materials: jcMats, operations: jcOps, quality: [], machineRates: jcRates, settings: jcSettings, now: jcNow })];
const jcTot = jc.totalsOf(jcRows);
check(jcTot.orders === 4 && jcTot.lossMaking === 1 && jcTot.revenueCents === jcRows.reduce((s, r) => s + r.revenueCents, 0) && jcTot.profitCents === jcRows.reduce((s, r) => s + r.profitCents, 0) && jcTot.costCents === jcTot.materialsCents + jcTot.machineCents + jcTot.laborCents + jcTot.overheadCents, "job costing: totals are plain sums, so cost = materials + machine + labor + overhead always adds up");
const jcGroups = jc.groupJobCosts(jcRows, (r) => ({ key: String(r.customerId), label: r.customer }));
check(jcGroups.length === 2 && jcGroups[0].profitCents >= jcGroups[1].profitCents && jcGroups.find((g) => g.label === "Acme").orders === 3, "job costing: client roll-up groups orders and ranks the biggest profit first");
check(jc.parseRange("DAYS90") === "days90" && jc.parseRange("junk") === "all" && jc.parseScope("final") === "final" && jc.parseScope("x") === "all", "job costing: range/scope query parameters are whitelisted");
check(jc.rangeStart("all", jcNow) === null && jc.rangeStart("ytd", jcNow).getMonth() === 0 && jc.rangeStart("month", jcNow).getDate() === 1 && Math.round((jcNow - jc.rangeStart("days90", jcNow)) / 86400000) === 90, "job costing: period windows start where they say");
check(jc.inScope("Completed", "final") && !jc.inScope("Completed", "open") && jc.inScope("On Hold", "open") && jc.inScope("Delivered", "all"), "job costing: scope filter separates finished from in-progress");
const jcCsv = jc.jobCostCsv([{ ...jcOpen, title: '=HYPERLINK("x"),evil', customer: "A, B" }]);
check(jcCsv.split("\r\n").length === 2 && jcCsv.includes("\"'=HYPERLINK(\"\"x\"\"),evil\"") && jcCsv.includes('"A, B"') && jcCsv.includes(",88.5,"), "job costing: CSV quotes properly, neutralises spreadsheet formulas and exports margin %");

// ---- wiring: grant, routes, screen, report ----
const jcRoutePaths = ["src/app/api/job-costing/route.ts", "src/app/api/job-costing/[id]/route.ts", "src/app/api/job-costing/settings/route.ts"];
check(jcRoutePaths.every((p) => fs.readFileSync(p, "utf8").includes('authorizeModule("invoicing")')), "job costing: EVERY route enforces the Invoicing & Money grant on the server");
check(fs.readFileSync("src/app/api/job-costing/settings/route.ts", "utf8").includes('user.role !== "Manager"') && fs.readFileSync("src/app/api/job-costing/settings/route.ts", "utf8").includes("logAudit"), "job costing: only a Manager can change labor rate / overhead, and it is audit-logged");
const jcServerSource = fs.readFileSync("src/lib/jobCosting.server.ts", "utf8");
check(jcServerSource.includes("listOrdersForUser(user)") && jcServerSource.includes("listOperationsForUser(user") && jcServerSource.includes("listQualityEventsForUser(user") && !/\.from\(orders\)|\.from\(orderOperations\)/.test(jcServerSource), "job costing: orders/operations/quality go through the deny-by-default scoped readers (a Sales user sees only their own margins)");
check(!/create table|alter table|drop table/i.test(jcServerSource) && jcServerSource.includes("writeJsonAtomic") && jcServerSource.includes("job-costing.json"), "job costing: no new tables or migration — only a crash-safe JSON settings file");
check(optMod.OPTIONAL_MODULE_SCREENS.invoicing.includes("jobcosting") && optMod.screenOwnerModule("jobcosting") === "invoicing", "job costing: the screen belongs to the Invoicing & Money module");
check(mgr.includes("Job Costing &amp; Profit"), "job costing: Manager always sees the Job Costing screen");
check(!renderPurchaseSidebar("Technician", null).includes("Job Costing &amp; Profit") && renderPurchaseSidebar("Technician", invGrants).includes("Job Costing &amp; Profit"), "job costing: hidden without the money grant, visible with it");
check(renderPurchaseSidebar("Machine Operator", invGrants, 9).includes("Job Costing &amp; Profit") && !renderPurchaseSidebar("Machine Operator", { ...invGrants, enabled: [] }, 9).includes("Job Costing &amp; Profit"), "job costing: personal money grant shows it; switching the module off hides it again");
check(i18n.tt("ar", "Job Costing & Profit") !== "Job Costing & Profit" && i18n.tt("fr", "Job Costing & Profit") === "Coût de revient & rentabilité", "job costing: Arabic and French sidebar labels ship with the screen");
const jcUi = fs.readFileSync("src/components/JobCostingView.tsx", "utf8");
check(jcUi.includes("/api/job-costing?range=") && jcUi.includes("/api/job-costing/settings") && jcUi.includes("jobCostCsv") && jcUi.includes("labor rate is not set") && jcUi.includes("canEditRates"), "job costing: UI loads the board + drill-down, exports CSV, warns when labor rate is unset and gates the Rates editor");
check(pageSource.includes("<JobCostingView") && pageSource.includes('activeTab === "jobcosting" && canInvoice') && pageSource.includes('canEditRates={currentUser.role === "Manager"}'), "job costing: screen mounts behind the money grant; only Managers get the Rates editor");
const jcReportSource = fs.readFileSync("src/app/api/reports/route.ts", "utf8");
check(jcReportSource.includes("jobCostRowsForReport(user") && !/db\.select\(\)\.from\(orderMaterials\)/.test(jcReportSource), "job costing: the Order Profitability report now uses the same costing engine (released materials no longer counted, scoped to the user)");

console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
process.exitCode = fails === 0 ? 0 : 1;
