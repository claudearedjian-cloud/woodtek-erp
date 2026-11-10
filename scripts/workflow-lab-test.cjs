#!/usr/bin/env node
/* ============================================================================
 * WoodTek Workflow Lab - automated guards (scripts/workflow-lab-test.cjs)
 * ----------------------------------------------------------------------------
 * Proves, without a Windows PC and without a database, that:
 *
 *   1. the instance registry gives the lab its OWN database, port, scheduled
 *      task, backup task, firewall rule, shortcuts and log file;
 *   2. the EXISTING installer (installer/install-engine.ps1) still carries
 *      exactly its old defaults - the original instance keeps port 3000,
 *      database woodtek_erp, task "\WoodTek ERP", firewall rule
 *      "WoodTek ERP Server" and the backup task "WoodTek Nightly Backup";
 *   3. the lab installer and every lab helper target ONLY the lab instance;
 *   4. the safety preflight really refuses the dangerous combinations
 *      (factory folder, factory database, factory port, unrelated data, a
 *      second .env, ...) and accepts the lab values;
 *   5. the four optional modules (invoicing, purchasing, payroll, design) are
 *      hard-locked by the installed edition - for every role including
 *      Manager - while ordinary installations behave exactly as before;
 *   6. the installer database bootstrapper writes the lock and leaves the
 *      ordinary installed-edition.json untouched.
 *
 * Run:  node scripts/workflow-lab-test.cjs   (CI: "Workflow Lab guards")
 * Exit code 0 = every guard passed.
 * ==========================================================================*/

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const preflight = require(path.join(ROOT, "installer", "workflow-lab", "preflight.cjs"));

let failures = 0;
let checks = 0;
function check(condition, name, detail) {
  checks += 1;
  if (condition) {
    console.log("PASS: " + name);
  } else {
    failures += 1;
    console.log("FAIL: " + name + (detail ? " - " + detail : ""));
  }
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wt-lab-" + label + "-"));
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const registry = preflight.loadRegistry();
const lab = registry.instances["workflow-lab"];
const def = registry.instances.default;

/* ---------------------------------------------------------------- 1. registry */
console.log("\n--- instance registry: the lab is its own instance ---");
check(preflight.registryProblems(registry).length === 0, "registry has no collisions between the lab and the default instance", preflight.registryProblems(registry).join(" | "));
check(lab.port !== def.port && lab.port === 3001, "lab port 3001 differs from the default port " + def.port);
check(lab.databaseName === "woodtek_workflow_lab" && lab.databaseName !== def.databaseName, "lab database woodtek_workflow_lab differs from " + def.databaseName);
check(lab.serviceTask === "\\WoodTek Workflow Lab" && lab.serviceTask !== def.serviceTask, "lab scheduled task '\\WoodTek Workflow Lab' differs from '" + def.serviceTask + "'");
check(lab.backupTask === "WoodTek Workflow Lab Nightly Backup" && lab.backupTask !== def.backupTask, "lab backup task differs from '" + def.backupTask + "'");
check(lab.firewallRule === "WoodTek Workflow Lab Server" && lab.firewallRule !== def.firewallRule, "lab firewall rule differs from '" + def.firewallRule + "'");
check(lab.desktopShortcut !== def.desktopShortcut && lab.startMenuFolder !== def.startMenuFolder, "lab shortcuts differ from the default shortcuts");
check(lab.logFile !== def.logFile, "lab log file differs from the default log file");
check(preflight.normalizeDir(lab.installDir) !== preflight.normalizeDir(def.installDir), "lab folder differs from the factory folder");
check(lab.installDir === "C:\\WoodTek-Workflow-Lab", "lab folder defaults to C:\\WoodTek-Workflow-Lab");

const expectedLocks = ["invoicing", "purchasing", "payroll", "design"];
check(
  JSON.stringify(lab.lockedOptionalModules.slice().sort()) === JSON.stringify(expectedLocks.slice().sort()),
  "the four optional modules Invoicing & Money, Purchasing & Suppliers, HR & Payroll and Design are locked in the lab profile",
  JSON.stringify(lab.lockedOptionalModules),
);
check(
  (lab.addons || []).every((addon) => !lab.lockedOptionalModules.includes(addon)),
  "no add-on pack that is locked is also installed in the lab",
);
check(
  !(lab.addons || []).includes("workforce"),
  "the workforce pack (shifts, attendance, HR & Payroll) is not installed in the lab",
);
check(registry.protectedDatabases.includes(def.databaseName), "the factory database name is on the protected list");
check(registry.protectedPorts.map(Number).includes(Number(def.port)), "the factory port is on the protected list");
check(
  registry.protectedPaths.some((p) => preflight.isSameDir(p, def.installDir)),
  "the factory folder is on the protected list",
);

/* ------------------------------------------- 2. existing installer unchanged */
console.log("\n--- the existing installer keeps its old defaults ---");
const engine = read("installer/install-engine.ps1");
check(engine.includes('[string]$InstallDir = "C:\\WoodTek-ERP"'), "install-engine.ps1 still defaults to C:\\WoodTek-ERP");
check(engine.includes("[int]$Port = 3000"), "install-engine.ps1 still defaults to port 3000");
check(engine.includes('postgresql://postgres:$escapedPwd@localhost:5432/woodtek_erp'), "install-engine.ps1 still defaults to the woodtek_erp database");
check(engine.includes('schtasks /Create /F /TN "\\WoodTek ERP"'), "install-engine.ps1 still registers the task '\\WoodTek ERP'");
check(engine.includes('schtasks /Create /F /TN "WoodTek Nightly Backup"'), "install-engine.ps1 still registers the backup task 'WoodTek Nightly Backup'");
check(engine.includes('netsh advfirewall firewall add rule name="WoodTek ERP Server"'), "install-engine.ps1 still creates the firewall rule 'WoodTek ERP Server'");
check(engine.includes('Join-Path $desktopDir "WoodTek ERP.lnk"'), "install-engine.ps1 still creates the desktop shortcut 'WoodTek ERP.lnk'");
check(
  !engine.includes("woodtek_workflow_lab") && !engine.includes("3001") && !engine.includes("WoodTek Workflow Lab Server"),
  "install-engine.ps1 never registers the lab database, port or firewall rule",
);
check(
  engine.includes('$labMarker = Join-Path $InstallDir "workflow-lab-instance.json"') &&
    engine.indexOf('$labMarker = Join-Path') < engine.indexOf('schtasks /End /TN "\\WoodTek ERP"'),
  "install-engine.ps1 refuses to install the factory instance over a Workflow Lab folder (before it stops anything)",
);
check(
  read("installer/apply-update.ps1").includes('Join-Path $InstallDir "workflow-lab-instance.json"'),
  "apply-update.ps1 refuses to apply a factory update pack to a Workflow Lab folder",
);
check(
  read("update-woodtek.bat").includes('if exist "%~dp0workflow-lab-instance.json"') &&
    read("update-woodtek.bat").includes("update-workflow-lab.bat"),
  "update-woodtek.bat refuses to run inside a Workflow Lab folder and points at the lab updater",
);

/* ----------------------------------------------- 3. lab scripts stay in scope */
console.log("\n--- the lab installer and helpers target only the lab ---");
const labInstaller = read("installer/install-workflow-lab.ps1");
check(labInstaller.includes("instance-registry.json") && labInstaller.includes("$LabProfile"), "the lab installer reads every name from instance-registry.json");
check(
  !labInstaller.includes('schtasks /Create /F /TN "\\WoodTek ERP"') &&
    !labInstaller.includes('schtasks /End /TN "\\WoodTek ERP"') &&
    !labInstaller.includes('schtasks /Run /TN "\\WoodTek ERP"'),
  "the lab installer never registers, ends or starts the factory scheduled task",
);
// Comments may mention the factory database (to say it is never touched); the
// executable lines must never contain it.
const psCodeOnly = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
check(
  !psCodeOnly(labInstaller).includes("woodtek_erp"),
  "no executable line of the lab installer names the factory database",
);
check(labInstaller.includes("preflight.cjs"), "the lab installer runs the safety preflight");
check(labInstaller.includes("--locked-modules="), "the lab installer passes the hard module lock to the database bootstrap");
check(
  labInstaller.indexOf("Invoke-LabPreflight $Action.ToLower()") < labInstaller.indexOf("Copy-TreeContents $stage $TargetDir"),
  "the preflight runs before anything is copied into the lab folder",
);
check(labInstaller.includes('Invoke-LabPreflight "verify" ""'), "the lab installer verifies the finished installation");
check(
  labInstaller.includes('if ($Action -eq "Install" -and (Test-TcpPort') &&
    labInstaller.includes('if ($Action -eq "Refresh" -and (Test-TcpPort'),
  "only a fresh install demands a free port (a refresh stops the running lab first)",
);

// 2026-11-09: the first real run on the old PC stopped in the build step with a
// bare exit code, because "npx next build" needs npm/Node on PATH while node.exe
// had been found by full path. The build now calls Next.js through node.exe and
// a checked CLI path, and the runtime folder is put on PATH.
check(
  labInstaller.includes('$env:PATH = "$(Split-Path -Parent $nodeExe);$env:PATH'),
  "the lab installer puts the Node.js runtime folder on PATH",
);
check(
  labInstaller.includes('node_modules\\next\\dist\\bin\\next') &&
    labInstaller.includes('& $nodeExe $nextCli "build"') &&
    !labInstaller.includes('cmd.exe /c "npx next build"'),
  "the lab build calls Next.js through node.exe and a checked CLI path (no npx/PATH dependency)",
);
check(
  labInstaller.includes("has no node_modules") && labInstaller.includes("npm install"),
  "a repository without node_modules fails with an instruction instead of a bare exit code",
);

// A failure must leave a readable trail and a resumable folder.
check(
  labInstaller.includes("trap {") &&
    labInstaller.includes("did not finish") &&
    labInstaller.includes('"lab-install.log"') &&
    labInstaller.includes("it continues from here instead of starting over"),
  "every failure ends with what stopped, that the factory install is untouched, and that re-running resumes",
);
check(
  labInstaller.indexOf("Marked $TargetDir as a Workflow Lab folder") <
    labInstaller.indexOf('Write-Step "Laying down the lab application files"'),
  "the folder is marked as a lab BEFORE the application files are laid down (an interrupted run stays recognisable)",
);
check(
  labInstaller.indexOf('Write-Step "Laying down the lab application files"') <
    labInstaller.indexOf('foreach ($sub in @("data", "logs", "backups", "backups\\nightly"))'),
  "data/logs/backups are created only after the application files are in place",
);
check(
  labInstaller.includes("must never connect to the factory database") &&
    labInstaller.includes("Refusing to reuse it"),
  "an existing .env is only reused when it is the lab's own",
);
check(
  !/schtasks \/End \/TN "\\WoodTek ERP"/.test(labInstaller),
  "the lab installer never ends the factory scheduled task",
);

const createBat = read("Create-WoodTek-Workflow-Lab.bat");
check(createBat.includes("install-workflow-lab.ps1"), "the double-click helper runs the lab installer");
check(createBat.includes("net session >nul 2>&1") && createBat.includes("Verb RunAs"), "the double-click helper asks for administrator rights");
check((createBat.match(/pause/g) || []).length >= 2, "the double-click helper pauses on success and on failure (it never flash-closes)");
check(createBat.includes("NOT created") && createBat.includes("Nothing was changed"), "the double-click helper says the factory installation is untouched when it fails");

const buildInstaller = read("installer/build-installer.ps1");
check(
  buildInstaller.includes("install-workflow-lab.ps1") &&
    buildInstaller.includes("instance-registry.json") &&
    buildInstaller.includes("installer\\workflow-lab"),
  "the .exe payload carries the Workflow Lab installer so an installed PC can create its own lab",
);

const templates = {
  start: read("installer/workflow-lab/templates/start-workflow-lab.bat"),
  silent: read("installer/workflow-lab/templates/start-workflow-lab-silent.bat"),
  stop: read("installer/workflow-lab/templates/stop-workflow-lab.bat"),
  check: read("installer/workflow-lab/templates/check-workflow-lab.bat"),
  update: read("installer/workflow-lab/templates/update-workflow-lab.bat"),
};
const factoryTaskMention = '\\WoodTek ERP"';
for (const [name, text] of Object.entries(templates)) {
  check(!text.includes(factoryTaskMention), "lab helper '" + name + "' never mentions the factory scheduled task");
  check(!text.includes("woodtek_erp"), "lab helper '" + name + "' never mentions the factory database");
  check(!/:3000\b/.test(text), "lab helper '" + name + "' never targets port 3000");
}
check(templates.stop.includes('schtasks /End /TN "\\WoodTek Workflow Lab"'), "stop helper ends only the lab task");
check(templates.stop.includes("findstr /b /i \"PORT=\"") , "stop helper reads the lab port from the lab .env");
check(templates.silent.includes("woodtek-workflow-lab.log"), "the lab task logs to its own log file");
check(templates.update.includes("install-workflow-lab.ps1") && templates.update.includes("-Action Refresh"), "update helper refreshes only this lab folder");
check(templates.update.includes("Verb RunAs"), "update helper asks for administrator rights");

/* ------------------------------------------------------ 4. preflight refuses */
console.log("\n--- safety preflight: it refuses what could hurt the factory install ---");
function refused(opts) {
  const result = preflight.runPreflight(Object.assign({ registry }, opts));
  return result;
}
function reasons(result) {
  return (result.errors || []).join(" | ");
}

check(refused({ targetDir: "C:\\WoodTek-ERP", port: 3001 }).ok === false, "refuses the factory folder C:\\WoodTek-ERP");
check(refused({ targetDir: "C:\\WoodTek-ERP\\lab", port: 3001 }).ok === false, "refuses a folder inside the factory folder");
check(refused({ targetDir: "C:\\", port: 3001 }).ok === false, "refuses a whole drive as the lab folder");
check(refused({ targetDir: "C:\\Program Files\\Lab", port: 3001 }).ok === false, "refuses a folder inside Program Files");
check(refused({ targetDir: "relative\\lab", port: 3001 }).ok === false, "refuses a relative folder");
check(refused({ targetDir: "C:\\WoodTek-Workflow-Lab", port: 3001 }).ok === true, "accepts the default lab folder and port");

const factoryDb = preflight.runPreflight({
  registry,
  targetDir: "C:\\WoodTek-Workflow-Lab",
  port: 3001,
  dbUrl: "postgresql://postgres:postgres@localhost:5432/woodtek_erp",
});
check(factoryDb.ok === false && /woodtek_erp/.test(reasons(factoryDb)), "refuses a database URL that points at the factory database woodtek_erp");
const systemDb = preflight.runPreflight({
  registry,
  targetDir: "C:\\WoodTek-Workflow-Lab",
  port: 3001,
  dbUrl: "postgresql://postgres:postgres@localhost:5432/postgres",
});
check(systemDb.ok === false, "refuses a PostgreSQL system database");
const wrongLabDb = preflight.runPreflight({
  registry,
  targetDir: "C:\\WoodTek-Workflow-Lab",
  port: 3001,
  dbUrl: "postgresql://postgres:postgres@localhost:5432/some_other_db",
});
check(wrongLabDb.ok === false, "refuses any database name that is not the lab database");
const remoteDb = preflight.runPreflight({
  registry,
  targetDir: "C:\\WoodTek-Workflow-Lab",
  port: 3001,
  dbUrl: "postgresql://postgres:postgres@192.168.220.205:5432/woodtek_workflow_lab",
});
check(remoteDb.ok === false, "refuses a lab database on another server");
const goodDb = preflight.runPreflight({
  registry,
  targetDir: "C:\\WoodTek-Workflow-Lab",
  port: 3001,
  dbUrl: "postgresql://postgres:postgres@localhost:5432/woodtek_workflow_lab",
});
check(goodDb.ok === true, "accepts the lab database URL", reasons(goodDb));

check(refused({ targetDir: "C:\\WoodTek-Workflow-Lab", port: 3000 }).ok === false, "refuses the factory port 3000");
check(refused({ targetDir: "C:\\WoodTek-Workflow-Lab", port: 80 }).ok === false, "refuses a privileged port");
check(refused({ targetDir: "C:\\WoodTek-Workflow-Lab", port: "abc" }).ok === false, "refuses a non-numeric port");

// Folder contents (real directories, so this works on any platform).
const emptyDir = tmpDir("empty");
check(preflight.runPreflight({ registry, targetDir: emptyDir, port: 3001 }).ok === true, "accepts an empty folder");
const busyDir = tmpDir("busy");
write(path.join(busyDir, "factory-notes.txt"), "unrelated");
check(
  preflight.runPreflight({ registry, targetDir: busyDir, port: 3001 }).ok === false,
  "refuses a folder that already holds unrelated data",
);
const labDir = tmpDir("lab");
write(path.join(labDir, "workflow-lab-instance.json"), JSON.stringify({ instanceId: "workflow-lab" }));
check(
  preflight.runPreflight({ registry, targetDir: labDir, port: 3001, action: "install" }).ok === true,
  "a lab folder stamped by an unfinished run is resumed instead of refused",
);
const finishedLab = tmpDir("lab-finished");
write(path.join(finishedLab, "workflow-lab-instance.json"), JSON.stringify({ instanceId: "workflow-lab", completed: true }));
check(
  preflight.runPreflight({ registry, targetDir: finishedLab, port: 3001, action: "install" }).ok === false,
  "refuses to install over a finished Workflow Lab",
);
check(
  preflight.runPreflight({ registry, targetDir: finishedLab, port: 3001, action: "refresh" }).ok === true,
  "allows a refresh of a finished Workflow Lab",
);

// The owner's 2026-11-09 case: an earlier attempt created only data/logs/backups
// and then stopped. A plain re-run must continue, not refuse.
const leftover = tmpDir("leftover");
for (const sub of ["data", "logs", "backups"]) write(path.join(leftover, sub, ".keep-is-not-used"), "");
fs.rmSync(path.join(leftover, "data", ".keep-is-not-used"));
fs.rmSync(path.join(leftover, "logs", ".keep-is-not-used"));
fs.rmSync(path.join(leftover, "backups", ".keep-is-not-used"));
const leftoverResult = preflight.runPreflight({ registry, targetDir: leftover, port: 3001 });
check(leftoverResult.ok === true, "continues an interrupted lab that left data/logs/backups behind", reasons(leftoverResult));
check(
  (leftoverResult.warnings || []).some((w) => /unfinished Workflow Lab/.test(w)),
  "says out loud that it is continuing an unfinished lab",
);
const leftoverForeign = tmpDir("leftover-foreign");
write(path.join(leftoverForeign, "data", "uploads", "photo.jpg"), "x");
write(path.join(leftoverForeign, "logs", "woodtek-workflow-lab.log"), "y");
check(
  preflight.runPreflight({ registry, targetDir: leftoverForeign, port: 3001 }).ok === false,
  "still refuses when the lab folders hold something the lab never writes",
);
const leftoverFactoryEnv = tmpDir("leftover-env");
write(path.join(leftoverFactoryEnv, "data", "installed-edition.json"), "{}");
write(path.join(leftoverFactoryEnv, ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_erp\nPORT=3000\n");
check(
  preflight.runPreflight({ registry, targetDir: leftoverFactoryEnv, port: 3001 }).ok === false,
  "refuses a leftover folder holding a factory .env",
);
const leftoverLabEnv = tmpDir("leftover-lab-env");
write(path.join(leftoverLabEnv, "data", "installed-edition.json"), "{}");
write(path.join(leftoverLabEnv, ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_workflow_lab\nPORT=3001\n");
check(
  preflight.runPreflight({ registry, targetDir: leftoverLabEnv, port: 3001 }).ok === true,
  "continues a leftover folder that already holds its own lab .env",
);
check(
  preflight.envIsLabOwned(path.join(leftoverLabEnv, ".env"), registry) === true &&
    preflight.envIsLabOwned(path.join(leftoverFactoryEnv, ".env"), registry) === false,
  "recognises only a lab .env as its own",
);
const otherInstall = tmpDir("other");
write(path.join(otherInstall, "start-prod.cjs"), "// app");
write(path.join(otherInstall, ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_erp\n");

check(
  preflight.runPreflight({ registry, targetDir: otherInstall, port: 3001, action: "install" }).ok === false,
  "refuses a folder that already contains another WoodTek installation",
);

// Source folder rules.
check(
  preflight.checkSourceDir("C:\\WoodTek-ERP", "C:\\WoodTek-ERP", registry).ok === false,
  "refuses to copy an installation into itself",
);
const fakeSource = tmpDir("source");
check(preflight.checkSourceDir(fakeSource, emptyDir, registry).ok === false, "refuses a source folder that is not an installation");
write(path.join(fakeSource, "start-prod.cjs"), "// app");
check(
  preflight.checkSourceDir(fakeSource, emptyDir, registry).ok === false,
  "refuses a source folder without a production build",
);
write(path.join(fakeSource, ".next", "standalone", "server.js"), "// server");
check(preflight.checkSourceDir(fakeSource, emptyDir, registry).ok === true, "accepts a real installation as the source");

// Lock support detection.
check(preflight.appSupportsLabLocks(fakeSource) === false, "detects an app build WITHOUT the lab module lock");
write(
  path.join(fakeSource, ".next", "standalone", ".next", "server", "chunks", "app.js"),
  'var x = cfg.lockedOptionalModules || [];',
);
check(preflight.appSupportsLabLocks(fakeSource) === true, "detects an app build WITH the lab module lock");

/* --------------------------------------- 5. post-install verification works */
console.log("\n--- post-install verification: the lab cannot point at the factory database ---");
function makeLabFolder(label) {
  const dir = tmpDir(label);
  write(path.join(dir, ".next", "standalone", "server.js"), "// server");
  write(
    path.join(dir, ".env"),
    [
      "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_workflow_lab",
      "AUTH_SECRET=" + "a".repeat(43),
      "PORT=3001",
      "HOSTNAME=0.0.0.0",
      "WOODTEK_DATA_DIR=" + path.join(dir, "data"),
    ].join("\n") + "\n",
  );
  write(
    path.join(dir, "workflow-lab-instance.json"),
    JSON.stringify({
      instanceId: "workflow-lab",
      port: 3001,
      databaseName: "woodtek_workflow_lab",
      serviceTask: "\\WoodTek Workflow Lab",
    }),
  );
  write(
    path.join(dir, "data", "installed-edition.json"),
    JSON.stringify({ version: 1, addons: ["cmms"], lockedOptionalModules: expectedLocks }),
  );
  write(path.join(dir, "data", "optional-modules.json"), JSON.stringify({ version: 1, enabled: [], roles: {}, users: {} }));
  return dir;
}

const good = makeLabFolder("verify-ok");
const goodResult = preflight.verifyInstall({ registry, targetDir: good, port: 3001 });
check(goodResult.ok === true, "accepts a correctly built lab folder", (goodResult.errors || []).join(" | "));

const factoryDbLab = makeLabFolder("verify-factory-db");
write(path.join(factoryDbLab, ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_erp\nAUTH_SECRET=" + "a".repeat(43) + "\nPORT=3001\n");
const factoryResult = preflight.verifyInstall({ registry, targetDir: factoryDbLab, port: 3001 });
check(factoryResult.ok === false, "catches a lab .env that points at the factory database");

const wrongPortLab = makeLabFolder("verify-port");
write(path.join(wrongPortLab, ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_workflow_lab\nAUTH_SECRET=" + "a".repeat(43) + "\nPORT=3000\n");
check(preflight.verifyInstall({ registry, targetDir: wrongPortLab, port: 3001 }).ok === false, "catches a lab .env on the factory port");

const enabledLab = makeLabFolder("verify-enabled");
write(path.join(enabledLab, "data", "optional-modules.json"), JSON.stringify({ version: 1, enabled: ["design"], roles: {}, users: {} }));
check(preflight.verifyInstall({ registry, targetDir: enabledLab, port: 3001 }).ok === false, "catches a locked module switched on in the lab");

const grantLab = makeLabFolder("verify-grant");
write(
  path.join(grantLab, "data", "optional-modules.json"),
  JSON.stringify({ version: 1, enabled: [], roles: { Manager: ["invoicing"] }, users: { "3": ["payroll"] } }),
);
check(preflight.verifyInstall({ registry, targetDir: grantLab, port: 3001 }).ok === false, "catches a locked module granted to a role or a person");

const noLockLab = makeLabFolder("verify-nolock");
write(path.join(noLockLab, "data", "installed-edition.json"), JSON.stringify({ version: 1, addons: ["cmms"] }));
check(preflight.verifyInstall({ registry, targetDir: noLockLab, port: 3001 }).ok === false, "catches a lab without the hard module lock");

const strayEnvLab2 = makeLabFolder("verify-stray2");
write(path.join(strayEnvLab2, "installer", ".env"), "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/woodtek_erp\n");
check(preflight.verifyInstall({ registry, targetDir: strayEnvLab2, port: 3001 }).ok === false, "catches a copied factory .env inside the lab");

/* ------------------------------------ 6. hard module lock in the application */
console.log("\n--- the four modules are hard-locked in the app, not just hidden ---");
const ts = require("typescript");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-lab-ts-"));
function compileLib(rel, outName) {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: rel,
  }).outputText;
  const fixed = js.replace(/require\("@\/lib\/([^"]+)"\)/g, 'require("./$1")');
  const outPath = path.join(compileDir, "lib", outName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fixed);
}
["installedEdition", "installedEdition.server", "optionalModules", "optionalModules.server", "atomicFile.server"].forEach((name) => {
  compileLib("src/lib/" + name + ".ts", name + ".js");
});

const edition = require(path.join(compileDir, "lib", "installedEdition.js"));
const optMods = require(path.join(compileDir, "lib", "optionalModules.js"));

const labEdition = edition.sanitizeInstalledEdition({ version: 1, addons: ["cmms"], lockedOptionalModules: expectedLocks });
check(
  JSON.stringify(labEdition.lockedOptionalModules) === JSON.stringify(expectedLocks),
  "installed-edition.json keeps the lab lock list",
);
const plainEdition = edition.sanitizeInstalledEdition({ version: 1, addons: ["invoicing", "purchasing", "cmms", "workforce"] });
check(plainEdition.lockedOptionalModules === undefined, "an ordinary installation has no lock list (behaviour unchanged)");
check(edition.defaultInstalledEdition().addons.length === 4, "an installation without installed-edition.json still defaults to all four packs");

check(edition.isOptionalModuleInstalled("design", labEdition) === false, "design is not installed in the lab edition");
check(edition.isOptionalModuleInstalled("design", plainEdition) === true, "design stays available on an ordinary installation");
check(edition.isOptionalModuleInstalled("invoicing", labEdition) === false, "invoicing is not installed in the lab edition");
check(edition.isOptionalModuleInstalled("payroll", labEdition) === false, "payroll is not installed in the lab edition");
check(edition.isOptionalModuleInstalled("purchasing", labEdition) === false, "purchasing is not installed in the lab edition");
check(edition.isOptionalModuleLocked("design", labEdition) === true, "design reports as locked (Settings can say LOCKED)");

const authSource = read("src/lib/auth.ts");
check(
  authSource.includes("isOptionalModuleLocked(id, edition)") && authSource.includes("is locked in this installation"),
  "the API enforcement point (authorizeModule) refuses a locked module with its own 403",
);
check(
  read("src/app/api/optional-modules/route.ts").includes("isOptionalModuleLocked(modId, edition)"),
  "PUT /api/optional-modules refuses to switch a locked module on",
);
check(
  read("src/components/SettingsView.tsx").includes("moduleLockedByInstallation") &&
    read("src/components/SettingsView.tsx").includes("LOCKED"),
  "Settings shows a locked module as LOCKED instead of offering a switch",
);

const manager = { id: 1, role: "Manager" };
const labCfg = optMods.sanitizeOptionalModules({
  version: 1,
  enabled: ["invoicing", "purchasing", "payroll", "design"],
  roles: { Manager: ["invoicing"], "Sales Coordinator": ["invoicing", "design"] },
  users: { "7": ["payroll", "design"] },
  installedAddons: ["cmms"],
  lockedOptionalModules: expectedLocks,
});
for (const mod of expectedLocks) {
  check(
    optMods.subjectHasModule(mod, manager, labCfg) === false,
    "Manager cannot use the locked module '" + mod + "' in the lab",
  );
  check(labCfg.enabled.includes(mod) === false, "sanitizer drops the locked module '" + mod + "' from the master switches");
}
check(!labCfg.roles["Sales Coordinator"] || !labCfg.roles["Sales Coordinator"].includes("design"), "sanitizer drops a locked module granted to a role");
check(!labCfg.users["7"] || !labCfg.users["7"].includes("payroll"), "sanitizer drops a locked module granted to a person");
check(optMods.moduleLockedByInstallation("design", labCfg) === true, "Settings can distinguish LOCKED from NOT INSTALLED");
check(optMods.canSeeMoney(manager, labCfg) === false, "money stays invisible in the lab, for Manager too");

const plainCfg = optMods.sanitizeOptionalModules({
  version: 1,
  enabled: ["invoicing"],
  roles: { "Sales Coordinator": ["invoicing"] },
  users: {},
  installedAddons: ["invoicing", "purchasing", "cmms", "workforce"],
});
check(optMods.canSeeMoney(manager, plainCfg) === true, "an ordinary installation still gives money to Manager");
check(optMods.subjectHasModule("design", manager, plainCfg) === true, "an ordinary installation still offers design");
for (const mod of ["invoicing", "purchasing", "payroll", "design"]) {
  check(
    optMods.subjectHasModule(mod, { id: 9, role: "Sales Coordinator" }, plainCfg) ===
      (mod === "invoicing"),
    "ordinary grants are unchanged for Sales Coordinator (" + mod + ")",
  );
}

// The server store must apply the installation lock on every read.
const storeDir = tmpDir("store");
write(
  path.join(storeDir, "installed-edition.json"),
  JSON.stringify({ version: 1, addons: ["cmms"], lockedOptionalModules: expectedLocks }),
);
write(path.join(storeDir, "optional-modules.json"), JSON.stringify({ version: 1, enabled: ["design"], roles: {}, users: {} }));
process.env.WOODTEK_DATA_DIR = storeDir;
const optServer = require(path.join(compileDir, "lib", "optionalModules.server.js"));
const loaded = optServer.readOptionalModules();
check(loaded.enabled.length === 0, "reading optional modules from disk drops the locked design module", JSON.stringify(loaded.enabled));
check(JSON.stringify(loaded.lockedOptionalModules) === JSON.stringify(expectedLocks), "the read config carries the lock list to the sidebar and APIs");
const written = optServer.writeOptionalModules({ version: 1, enabled: ["design", "invoicing"], roles: {}, users: {} });
check(written.enabled.length === 0, "saving from Settings cannot switch a locked module on");
const diskAfterSave = JSON.parse(fs.readFileSync(path.join(storeDir, "optional-modules.json"), "utf8"));
check(diskAfterSave.lockedOptionalModules === undefined, "the lock list is never written into the grant file");

/* -------------------------------- 7. installer bootstrapper writes the lock */
console.log("\n--- the database bootstrapper writes the hard lock ---");
const bootDir = tmpDir("boot");
execFileSync(
  process.execPath,
  [path.join(ROOT, "installer", "bootstrap-db.cjs"), "--config-only", "--addons=" + lab.addons.join(","), "--locked-modules=" + expectedLocks.join(","), "--data-dir=" + bootDir],
  { stdio: "pipe" },
);
const bootEdition = JSON.parse(fs.readFileSync(path.join(bootDir, "installed-edition.json"), "utf8"));
check(JSON.stringify(bootEdition.addons) === JSON.stringify(lab.addons), "the lab installation writes only the lab add-on packs", JSON.stringify(bootEdition.addons));
check(JSON.stringify(bootEdition.lockedOptionalModules) === JSON.stringify(expectedLocks), "the lab installation writes the four locked modules");
const bootOpt = JSON.parse(fs.readFileSync(path.join(bootDir, "optional-modules.json"), "utf8"));
check(bootOpt.enabled.length === 0, "the lab starts with no optional module switched on");

const bootDefaultDir = tmpDir("boot-default");
execFileSync(
  process.execPath,
  [path.join(ROOT, "installer", "bootstrap-db.cjs"), "--config-only", "--addons=invoicing,purchasing,cmms,workforce", "--data-dir=" + bootDefaultDir],
  { stdio: "pipe" },
);
const defaultEdition = JSON.parse(fs.readFileSync(path.join(bootDefaultDir, "installed-edition.json"), "utf8"));
check(defaultEdition.lockedOptionalModules === undefined, "the ordinary installer still writes an installed-edition.json with no lock list");
check(
  JSON.stringify(defaultEdition.addons) === JSON.stringify(["invoicing", "purchasing", "cmms", "workforce"]),
  "the ordinary installer still installs all four add-on packs",
);

let refusedBoth = false;
try {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "installer", "bootstrap-db.cjs"), "--config-only", "--addons=cmms,invoicing", "--locked-modules=invoicing", "--data-dir=" + tmpDir("boot-clash")],
    { stdio: "pipe" },
  );
} catch {
  refusedBoth = true;
}
check(refusedBoth, "the bootstrapper refuses to both install and lock the same module");

/* --------------------- 9. the PostgreSQL login (never retyped by the owner) */
console.log("\n--- the lab reuses the factory's PostgreSQL login instead of guessing ---");

// 2026-11-10: the first real run died on "password authentication failed for user
// postgres" - the installer had assumed the setup default password. The factory
// installation already has a working login in its .env; the lab now reuses that
// login with its own database name, so a resume needs no password typing.
const factoryDir = tmpDir("factory-env");
const factoryEnv = path.join(factoryDir, ".env");
write(factoryEnv, "DATABASE_URL=postgresql://postgres:Tr0ub4dor%26x@localhost:5432/woodtek_erp\r\nPORT=3000\r\n");

const reused = preflight.resolveLabDatabaseUrl({ registry, factoryEnvPath: factoryEnv });
const reusedUrl = new URL(reused.url);
check(reused.source === "factory-env", "takes the PostgreSQL login from the factory installation", reused.note);
check(
  reusedUrl.pathname === "/woodtek_workflow_lab" && reusedUrl.hostname === "localhost" && reusedUrl.port === "5432",
  "swaps only the database name (same server, same port)",
  reused.url.replace(/:[^:@/]+@/, ":***@"),
);
check(
  decodeURIComponent(reusedUrl.password) === "Tr0ub4dor&x" && decodeURIComponent(reusedUrl.username) === "postgres",
  "keeps the factory user and password intact (including encoded characters)",
);

const explicit = preflight.resolveLabDatabaseUrl({
  registry,
  factoryEnvPath: factoryEnv,
  overrideUrl: "postgresql://u:p@localhost:5432/woodtek_workflow_lab",
});
check(explicit.source === "argument" && explicit.url === "postgresql://u:p@localhost:5432/woodtek_workflow_lab", "an explicit -DbUrl wins over the factory login");

const pwGiven = preflight.resolveLabDatabaseUrl({ registry, factoryEnvPath: factoryEnv, password: "typed", passwordProvided: true, port: 6543 });
check(
  pwGiven.source === "argument" && pwGiven.url === "postgresql://postgres:typed@localhost:6543/woodtek_workflow_lab",
  "an explicitly typed password wins and honours -PgPort",
);

const remoteEnv = path.join(factoryDir, "remote.env");
write(remoteEnv, "DATABASE_URL=postgresql://app:pw@db.example.com:5432/woodtek_erp\n");
const remote = preflight.resolveLabDatabaseUrl({ registry, factoryEnvPath: remoteEnv });
check(
  remote.source === "default" && remote.url.includes("@localhost:5432/"),
  "never reuses a remote factory database login (the lab stays local)",
  remote.note,
);

const missingEnv = preflight.resolveLabDatabaseUrl({ registry, factoryEnvPath: path.join(factoryDir, "nope.env") });
check(missingEnv.source === "default" && missingEnv.url.includes("woodtek_workflow_lab"), "falls back to the setup default when there is no factory .env");

const described = preflight.describeDatabaseUrl(reused.url);
check(
  !described.includes("Tr0ub4dor") && described === "postgres@localhost:5432/woodtek_workflow_lab",
  "the login can be printed without ever showing the password",
);
check(preflight.databaseUrlWithName("mysql://u:p@localhost/woodtek_erp", "woodtek_workflow_lab") === null, "refuses to rewrite a non-PostgreSQL URL");

// The installer asks the preflight for the login and receives it through a file,
// so the password never appears in the console or in a log.
const outFile = path.join(factoryDir, "resolved.txt");
const cliOutput = execFileSync(
  process.execPath,
  [
    path.join(ROOT, "installer", "workflow-lab", "preflight.cjs"),
    "--action", "dburl",
    "--registry", path.join(ROOT, "installer", "instance-registry.json"),
    "--factory-env", factoryEnv,
    "--out", outFile,
  ],
  { encoding: "utf8" },
);
check(
  fs.readFileSync(outFile, "utf8").includes("woodtek_workflow_lab") && fs.readFileSync(outFile, "utf8").includes("Tr0ub4dor"),
  "--action dburl hands the resolved login to the installer through a file",
);
check(!cliOutput.includes("Tr0ub4dor") && !cliOutput.includes("password authentication"), "the resolved password is never printed");

check(
  labInstaller.includes('"--action", "dburl"') && labInstaller.includes('"--factory-env"'),
  "the lab installer asks the preflight for the factory's PostgreSQL login",
);
check(
  labInstaller.indexOf('Write-Step "Checking the PostgreSQL login') <
    labInstaller.indexOf('Write-Step "Writing the lab .env'),
  "the PostgreSQL login is proven BEFORE the lab .env is written",
);
check(
  labInstaller.includes("PostgreSQL rejected the login") && labInstaller.includes("no scheduled task, no firewall rule"),
  "a rejected login names the cause and says nothing was written",
);
check(
  labInstaller.includes("Updated the DATABASE_URL in the existing lab .env") &&
    labInstaller.includes('$envLinesExisting[$i] = "DATABASE_URL=$DbUrl"'),
  "a resume repairs a stale DATABASE_URL in the lab's own .env instead of keeping a bad password",
);
check(
  !/Write-(Host|Info|Warn)[^\n]*\$DbUrl/.test(labInstaller),
  "the installer never prints the connection string (and therefore never the password)",
);

const bootstrapSrc = read("installer/bootstrap-db.cjs");
check(bootstrapSrc.includes('"--check-db"') && bootstrapSrc.includes("checkLoginOnly"), "the database bootstrapper can prove a login without creating anything");
const checkBody = bootstrapSrc.slice(bootstrapSrc.indexOf("async function checkLoginOnly"), bootstrapSrc.indexOf("async function ensureDatabaseAndSchema"));
check(
  !/CREATE\s+DATABASE|execSync|spawnSync/i.test(checkBody) && !checkBody.includes("ensureDatabaseAndSchema"),
  "--check-db creates nothing and runs no schema",
);
check(
  bootstrapSrc.includes("password authentication failed") &&
    bootstrapSrc.replace(/\s+/g, " ").includes("same PostgreSQL user and password as the factory installation"),
  "a rejected password is explained in plain language",
);

let checkDbFails = false;
try {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "installer", "bootstrap-db.cjs"), "--check-db", "--db-url=postgresql://postgres:wrong@127.0.0.1:5999/woodtek_workflow_lab"],
    { stdio: "pipe" },
  );
} catch (err) {
  checkDbFails = true;
  const text = String(err.stdout || "") + String(err.stderr || "");
  check(/ERROR/.test(text) && !text.includes("wrong@"), "--check-db fails loudly without echoing the password");
}
check(checkDbFails, "--check-db exits non-zero when PostgreSQL is unreachable");

/* -------------------------------------------------------------- summary */
console.log("");
if (failures === 0) {
  console.log("ALL PASS - " + checks + " Workflow Lab guards");
  process.exit(0);
}
console.log(failures + " of " + checks + " Workflow Lab guards FAILED");
process.exit(1);
