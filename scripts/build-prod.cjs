// ============================================================================
// WoodTek ERP - production build
// ----------------------------------------------------------------------------
// Builds the Next.js production bundle and assembles the standalone folder so
// it can be run directly with:  node start-prod.cjs
// (i.e. `node .next/standalone/server.js`, with static + public assets in place)
//
// Usage:  node scripts/build-prod.cjs        (or double-click build-woodtek-prod.bat)
// ============================================================================

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

function log(msg) { console.log(`\n\x1b[36m[build-prod]\x1b[0m ${msg}`); }
function run(cmd, extraEnv) { log(`> ${cmd}`); execSync(cmd, { stdio: "inherit", cwd: ROOT, ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}) }); }

// If the WoodTek server is still listening, the build cannot replace
// .next/standalone (EBUSY). Fail fast with the exact fix instead.
function serverRunning(port) {
  return new Promise((resolve) => {
    const net = require("node:net");
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(1000, () => done(false));
  });
}

// Windows: is this process elevated? ("net session" only succeeds elevated.)
function isElevated() {
  if (process.platform !== "win32") return false;
  try {
    execSync("net session", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// EVERY pid listening on `port` (Windows netstat), so leftovers can all be
// killed - one stale child can otherwise keep the port while the build waits.
function findPortOwners(port) {
  const pids = new Set();
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", timeout: 8000 });
    const re = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/;
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m && m[1] === String(port)) pids.add(Number(m[2]));
    }
  } catch {
    /* netstat unavailable */
  }
  return [...pids];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stop the app the way the owner's PC actually runs it: a SYSTEM scheduled
// task ("\WoodTek ERP") supervises the server, so ending the task AND killing
// a leftover listener both need an ELEVATED window. On 2026-10-14 an
// unelevated build window watched both commands fail silently and stopped
// with "Port 3000 is STILL occupied" - retrying a few times, killing every
// listener, and then explaining the rights cause is the cure (the build .bat
// files now ask for the rights by themselves).
async function stopWoodTekServer(port) {
  const attempts = 4;
  for (let i = 1; i <= attempts; i++) {
    try {
      execSync('schtasks /End /TN "\\WoodTek ERP"', { stdio: "ignore", timeout: 10000 });
    } catch {
      /* not running / no rights - the kill below still gets a chance */
    }
    await sleep(2000);
    if (!(await serverRunning(port))) return true;

    for (const pid of findPortOwners(port)) {
      log(`Attempt ${i}/${attempts}: killing process ${pid} holding port ${port}...`);
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", timeout: 10000 });
      } catch {
        /* needs elevation */
      }
    }
    await sleep(2000);
    if (!(await serverRunning(port))) return true;
  }
  return false;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  log("=== WoodTek ERP production build ===\n");

  const port = Number(process.env.PORT || 3000);
  if (await serverRunning(port)) {
    if (process.platform === "win32") {
      log(`A server is listening on port ${port} - stopping it...`);
      await stopWoodTekServer(port);
    }
    if (await serverRunning(port)) {
      console.error(`\n[build-prod] Port ${port} is STILL occupied and could not be freed automatically.`);
      if (process.platform === "win32" && !isElevated()) {
        console.error(
          `[build-prod] This window is NOT an administrator window, and the WoodTek server`,
          `\n[build-prod] runs as a background SYSTEM task - stopping it needs administrator`,
          `\n[build-prod] rights. The build helpers (build-update.bat, build-installer.bat) ask`,
          `\n[build-prod] for those rights by themselves: close this window, double-click the`,
          `\n[build-prod] build file again and click Yes on the UAC prompt.`,
        );
      } else if (process.platform === "win32") {
        console.error(
          `[build-prod] This window IS elevated, so something keeps restarting the server.`,
          `\n[build-prod] In Task Scheduler stop "\\WoodTek ERP", then re-run this build.`,
        );
      }
      console.error(
        `\n[build-prod] Manual way (in an ADMINISTRATOR window):`,
        `\n    schtasks /End /TN "\\WoodTek ERP"`,
        `\n    netstat -ano | findstr :${port}`,
        `\n    taskkill /F /T /PID <the PID from the LISTENING line>`,
        `\nThen re-run this build.\n`,
      );
      process.exit(1);
    }
    log(`Port ${port} is free - continuing.`);
  }

  // Every production build is one update: raise the minor version (V1.0 -> V1.1 ...).
  // next.config.ts reads version.json, so the new number goes into this build.
  const versionFile = path.join(ROOT, "version.json");
  const versionInfo = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  versionInfo.minor = Number(versionInfo.minor || 0) + 1;
  fs.writeFileSync(versionFile, JSON.stringify(versionInfo, null, 2) + "\n");
  log(`App version for this update: ${versionInfo.product || "WOODTEK-ERP"} V${versionInfo.major}.${versionInfo.minor}`);

  log("Step 1/3: Building Next.js production bundle (standalone)...");
  // Stamp the built app with the current git commit so the Settings screen
  // can show exactly which version is running (support asks this first).
  let buildSha = "unknown";
  try {
    buildSha = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    /* not a git checkout - fall back to "unknown" */
  }
  run("npx next build", { NEXT_PUBLIC_WOODTEK_BUILD: buildSha });

  if (!fs.existsSync(STANDALONE)) {
    throw new Error(`Expected standalone build at ${STANDALONE} but it does not exist.`);
  }

  log("Step 2/3: Copying static assets into standalone...");
  const nextStatic = path.join(ROOT, ".next", "static");
  if (fs.existsSync(nextStatic)) copyDir(nextStatic, path.join(STANDALONE, ".next", "static"));
  const publicDir = path.join(ROOT, "public");
  if (fs.existsSync(publicDir)) copyDir(publicDir, path.join(STANDALONE, "public"));

  log("Step 3/3: Build complete.");
  console.log("\n  Start the app with:  start-woodtek-prod.bat   (double-click)");
  console.log("  or:                  node start-prod.cjs\n");
}

main().catch((err) => {
  console.error("\n[build-prod] FAILED:", err.message);
  process.exit(1);
});
