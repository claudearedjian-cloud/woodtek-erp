// ============================================================================
// WoodTek ERP — production build
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
function run(cmd) { log(`> ${cmd}`); execSync(cmd, { stdio: "inherit", cwd: ROOT }); }

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

// PID currently listening on `port` (Windows netstat), or null.
function findPortOwner(port) {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", timeout: 8000 });
    const re = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/;
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m && m[1] === String(port)) return Number(m[2]);
    }
  } catch {
    /* netstat unavailable */
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      // Self-heal: end the task, then kill any orphaned server on the port.
      // (schtasks /End stops the supervisor but can leave the child server alive.)
      log(`A server is listening on port ${port} — stopping it...`);
      try { execSync('schtasks /End /TN "\\WoodTek ERP"', { stdio: "ignore" }); } catch { /* not running / no rights */ }
      await sleep(2000);
      if (await serverRunning(port)) {
        const pid = findPortOwner(port);
        if (pid) {
          log(`Killing leftover server process (PID ${pid})...`);
          try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch { /* needs elevation */ }
          await sleep(1500);
        }
      }
    }
    if (await serverRunning(port)) {
      console.error(
        `\n[build-prod] Port ${port} is STILL occupied and could not be freed automatically.`,
        `\n[build-prod] In an ADMINISTRATOR window run:`,
        `\n    schtasks /End /TN "\\WoodTek ERP"`,
        `\n    netstat -ano | findstr :${port}`,
        `\n    taskkill /F /T /PID <the PID from the LISTENING line>`,
        `\nThen re-run this build.\n`,
      );
      process.exit(1);
    }
    log(`Port ${port} is free — continuing.`);
  }

  log("Step 1/3: Building Next.js production bundle (standalone)...");
  run("npx next build");

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
