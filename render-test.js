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
compile("src/lib/permissions.ts", "lib/permissions.js");
compile("src/lib/menuConfig.ts", "lib/menuConfig.js");
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

console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
process.exitCode = fails === 0 ? 0 : 1;
