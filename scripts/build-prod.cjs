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
