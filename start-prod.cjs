#!/usr/bin/env node
// ============================================================================
// WoodTek ERP — production launcher (watchdog + browser auto-open) — v2
// ----------------------------------------------------------------------------
// Loads .env from the app folder, runs the Next.js standalone production
// server, restarts it automatically if it crashes, and opens the browser
// once the server reports healthy.
//
//   node start-prod.cjs               # interactive (opens browser)
//   node start-prod.cjs --no-browser  # for scheduled tasks / services
//
// v2 changes (fixes the EADDRINUSE crash-loop):
//  * Preflight check: if PORT is already taken, report WHO owns it and exit
//    cleanly instead of crash-looping six times. If the owner answers
//    /api/health, it is almost certainly the background scheduled-task copy
//    started by start-woodtek-prod-silent.bat.
//  * EADDRINUSE is never retried.
//  * The health probe only reports "Server healthy" while THIS supervisor's
//    child process is alive, so a foreign server can no longer fake health.
// ============================================================================

const { spawn, execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const ROOT = path.resolve(__dirname);
const STANDALONE = path.join(ROOT, ".next", "standalone");
const SERVER = path.join(STANDALONE, "server.js");
const NO_BROWSER = process.argv.includes("--no-browser");

// Load .env (dotenv is a project dependency).
try {
  require("dotenv").config({ path: path.join(ROOT, ".env") });
} catch (e) {
  // dotenv missing — fall back to whatever is already in the environment.
}

const PORT = process.env.PORT || "3000";
const HOST = process.env.HOSTNAME || "0.0.0.0";

function log(msg) {
  console.log(`${new Date().toISOString()} [WoodTek] ${msg}`);
}

if (!process.env.DATABASE_URL) {
  log("FATAL: DATABASE_URL is not set. Create a .env next to the app (see .env.example).");
  process.exit(1);
}
if (!process.env.AUTH_SECRET) {
  log("WARNING: AUTH_SECRET is not set. Sessions will not survive a restart. Run: powershell -File ops\\set-auth-secret.ps1");
}
if (!fs.existsSync(SERVER)) {
  log("FATAL: production build not found at " + STANDALONE + ". Run: node scripts/build-prod.cjs");
  process.exit(1);
}

let child = null;
let shuttingDown = false;
let restartCount = 0;
let windowStart = Date.now();
let sawAddrInUse = false;
let browserOpened = false;
let probing = false;

function childAlive() {
  return !!child && child.exitCode === null && child.signalCode === null;
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: Number(PORT), path: "/api/health", timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Returns the PID listening on `port`, or null. (Windows: netstat -ano.)
function findPortOwner(port) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "netstat.exe" : "ss";
    const args = isWin ? ["-ano"] : ["-tlnp"];
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const re = isWin
        ? /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/
        : /^\S*\s*LISTEN\s+\S+\s+\S+\s+\S+:(\d+)\s+\S+\s+.*?pid=(\d+)/;
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(re);
        if (m && m[1] === String(port)) return resolve(Number(m[2]));
      }
      resolve(null);
    });
  });
}

async function reportPortConflict(healthy) {
  const pid = await findPortOwner(PORT);
  log(`Port ${PORT} is already in use${pid ? ` (PID ${pid})` : ""} — not starting a second copy.`);
  if (healthy) {
    log("The process on the port answers /api/health, so a WoodTek server is ALREADY");
    log("running — typically the background scheduled task (start-woodtek-prod-silent.bat).");
  } else {
    log("The process on the port does NOT answer /api/health (another application owns it).");
  }
  log("To let this window serve instead, free the port first:");
  if (pid) {
    log(`  1) elevated prompt:  taskkill /F /T /PID ${pid}`);
  }
  log('  2) or end the task:  schtasks /Query /FO CSV | findstr /I woodtek');
  log('     then:             schtasks /End /TN "<task name>"  (and re-run with schtasks /Run)');
  log("Then re-run this launcher.");
}

function openBrowser() {
  const c = spawn("cmd", ["/c", "start", "", `http://localhost:${PORT}/`], {
    stdio: "ignore",
    detached: true,
  });
  c.on("error", () => log("(could not auto-open a browser on this platform)"));
  c.unref();
}

function openBrowserWhenReady() {
  if (NO_BROWSER || browserOpened || probing) return;
  probing = true;
  const started = Date.now();
  const tryOnce = async () => {
    if (shuttingDown || browserOpened) {
      probing = false;
      return;
    }
    if (Date.now() - started > 60_000) {
      probing = false;
      return; // give up silently after 60s
    }
    // v2: a 200 from SOMEONE ELSE does not count — our child must be alive.
    if (!childAlive()) {
      setTimeout(tryOnce, 1000);
      return;
    }
    if (await checkHealth()) {
      browserOpened = true;
      probing = false;
      log("Server healthy — opening browser.");
      openBrowser();
    } else {
      setTimeout(tryOnce, 1000);
    }
  };
  setTimeout(tryOnce, 1000);
}

function startServer() {
  log(`Starting server on ${HOST}:${PORT}`);
  sawAddrInUse = false;
  child = spawn(process.execPath, [SERVER], {
    cwd: STANDALONE,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, HOSTNAME: HOST, PORT, WOODTEK_DATA_DIR: path.join(ROOT, "data") },
  });

  const tap = (stream, out) =>
    stream.on("data", (d) => {
      if (String(d).includes("EADDRINUSE")) sawAddrInUse = true;
      out.write(d);
    });
  tap(child.stdout, process.stdout);
  tap(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    if (sawAddrInUse) {
      // v2: a port conflict is not a crash — never retry-loop on it.
      log("Server exited with EADDRINUSE — the port is taken. Not retrying.");
      checkHealth().then((healthy) =>
        reportPortConflict(healthy).then(() => process.exit(1)),
      );
      return;
    }

    restartCount += 1;
    if (Date.now() - windowStart > 60_000) {
      restartCount = 0;
      windowStart = Date.now();
    }
    if (restartCount > 5) {
      log(`Server crashed ${restartCount} times in a minute — giving up. Check the logs above.`);
      process.exit(1);
    }
    log(`Server exited (code ${code}${signal ? ", signal " + signal : ""}). Restarting in 3s…`);
    setTimeout(startServer, 3000);
  });

  openBrowserWhenReady();
}

process.on("SIGINT", () => {
  shuttingDown = true;
  if (child) child.kill("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  shuttingDown = true;
  if (child) child.kill("SIGTERM");
  process.exit(0);
});

// Best effort: if this supervisor exits for ANY reason while the server child
// is alive, take the child down with it (reduces orphaned port holders when
// Task Scheduler hard-terminates the supervisor).
process.on("exit", () => {
  try {
    if (childAlive()) child.kill();
  } catch {
    /* nothing more we can do */
  }
});

(async () => {
  // v2 preflight: never spawn into a taken port.
  const owner = await findPortOwner(PORT);
  if (owner) {
    const healthy = await checkHealth();
    await reportPortConflict(healthy);
    process.exit(healthy ? 0 : 1);
  }
  startServer();
})();
