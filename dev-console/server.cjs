// ============================================================================
// WoodTek dev console — local server for the standalone console page.
//
// Runs ONLY on the development PC (the old PC). It serves dev-console/index.html
// and a fixed list of actions. It cannot run arbitrary commands: every button
// maps to one entry in COMMANDS below.
//
//   - "bat" actions open the existing helper in its OWN window, exactly like a
//     double-click (UAC prompts and pause still work).
//   - "capture" actions run a read-only check and show the text here.
//   - "open" actions open a folder in Explorer.
//   - "guide" actions are instructions for FS200. Nothing runs on FS200 from
//     here; the console never reaches that machine.
//
// Safety: binds to 127.0.0.1 only, accepts only localhost Host/Origin headers,
// and requires a JSON content type on POST (a cross-site page cannot send that
// without a CORS preflight, which this server refuses).
//
// Start: dev-console.bat (in the repo root).  Plain Node, no dependencies.
// ============================================================================

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4500;
const REPO_ROOT = path.resolve(__dirname, "..");
const PACK_PATTERN = /^WoodTek-ERP-Update-.*\.zip$/i;

/**
 * The whole list of things the console may do. `tabs` says where a button is shown.
 * Fields: id, tabs, group, title, description, kind, file (bat/guide path), steps, warning.
 */
const COMMANDS = [
  // ---- Old PC: code and update -------------------------------------------
  {
    id: "git-status",
    tabs: ["old-pc"],
    group: "Code and update",
    title: "Check what changed",
    description: "Shows the current branch and any files edited but not committed. Read only.",
    kind: "capture",
  },
  {
    id: "update-woodtek",
    tabs: ["old-pc"],
    group: "Code and update",
    title: "Pull latest code",
    description: "Runs update-woodtek.bat: pulls the newest code from GitHub and refreshes the update tools.",
    kind: "bat",
    file: "update-woodtek.bat",
  },
  {
    id: "unblock-update",
    tabs: ["old-pc"],
    group: "Code and update",
    title: "Unblock a failed pull",
    description: "Use only when git pull says local changes would be overwritten (files were edited by hand).",
    kind: "bat",
    file: "unblock-update.bat",
  },

  // ---- Old PC: build -----------------------------------------------------
  {
    id: "build-update",
    tabs: ["old-pc"],
    group: "Build",
    title: "Build update pack",
    description: "Runs build-update.bat: builds dist-update\\WoodTek-ERP-Update-<version>.zip with its .sha256 file. Stops the running server while it builds.",
    kind: "bat",
    file: "build-update.bat",
  },
  {
    id: "build-installer",
    tabs: ["old-pc"],
    group: "Build",
    title: "Build Windows installer",
    description: "Runs build-installer.bat: builds dist-installer\\WoodTek-ERP-Setup.exe for a fresh PC.",
    kind: "bat",
    file: "build-installer.bat",
  },
  {
    id: "verify-pack",
    tabs: ["old-pc", "fs200"],
    group: "Build",
    title: "Verify latest pack",
    description: "Checks the newest update pack against its .sha256 file, so a damaged copy is caught before it goes to FS200.",
    kind: "capture",
  },
  {
    id: "open-pack-folder",
    tabs: ["old-pc", "fs200"],
    group: "Build",
    title: "Open pack folder",
    description: "Opens dist-update in Explorer, to copy the ZIP and its .sha256 file to a USB stick.",
    kind: "open",
    folder: "dist-update",
  },

  // ---- Old PC: safety and server ------------------------------------------
  {
    id: "snapshot",
    tabs: ["old-pc"],
    group: "Safety and server",
    title: "Snapshot before changes",
    description: "Runs woodtek-snapshot.bat: zips the source and configuration into backups before you change anything.",
    kind: "bat",
    file: "woodtek-snapshot.bat",
  },
  {
    id: "copy-backups-offsite",
    tabs: ["old-pc"],
    group: "Safety and server",
    title: "Copy backups off this PC",
    description: "Copies the newest database dump and data zip to a USB stick or another PC. Deletes nothing.",
    kind: "bat",
    file: "copy-backups-offsite.bat",
  },
  {
    id: "check-server",
    tabs: ["old-pc"],
    group: "Safety and server",
    title: "Check server and database",
    description: "Runs check-server.bat: shows the app folder, database, row counts and /api/health. Read only.",
    kind: "bat",
    file: "check-server.bat",
  },
  {
    id: "start-prod",
    tabs: ["old-pc"],
    group: "Safety and server",
    title: "Start production server here",
    description: "Runs start-woodtek-prod.bat on this PC (for testing a build locally).",
    kind: "bat",
    file: "start-woodtek-prod.bat",
  },
  {
    id: "free-port",
    tabs: ["old-pc"],
    group: "Safety and server",
    title: "Free port 3000",
    description: "Runs woodtek-free-port-3000-v2.bat: stops whatever is holding port 3000 so a build can finish.",
    kind: "bat",
    file: "woodtek-free-port-3000-v2.bat",
  },

  // ---- Old PC: branches --------------------------------------------------
  {
    id: "test-branch",
    tabs: ["old-pc"],
    group: "Branches",
    title: "Test an agent branch",
    description: "Runs woodtek-test-branch.bat: puts this clone on an agent branch, rebuilds and restarts.",
    kind: "bat",
    file: "woodtek-test-branch.bat",
  },
  {
    id: "back-to-main",
    tabs: ["old-pc"],
    group: "Branches",
    title: "Back to released version (main)",
    description: "Runs woodtek-back-to-main.bat: leaves the test branch and returns to the released code.",
    kind: "bat",
    file: "woodtek-back-to-main.bat",
  },

  // ---- FS200 guides (nothing runs on FS200 from this console) -------------
  {
    id: "apply-update",
    tabs: ["fs200"],
    group: "Update",
    title: "Apply update pack",
    description: "Double-click on FS200 after the pack is copied there.",
    kind: "guide",
    file: "installer\\apply-update.bat",
    steps: [
      "On the old PC: Verify latest pack. It must say the checksum matches.",
      "Copy the newest WoodTek-ERP-Update-*.zip and its .sha256 file to a USB stick.",
      "On FS200: put both files in the installer folder, the Desktop, or Downloads.",
      "On FS200: double-click installer\\apply-update.bat and click Yes on the UAC prompt.",
      "Wait for the window to say the update is applied; it finishes by itself.",
      "Then run Check server on FS200 (next card) and open the app to confirm the version in the left menu.",
    ],
  },
  {
    id: "fs200-check-server",
    tabs: ["fs200"],
    group: "After the update",
    title: "Check server",
    description: "Double-click check-server.bat on FS200: shows the database, row counts and /api/health.",
    kind: "guide",
    file: "check-server.bat",
    steps: ["On FS200: double-click check-server.bat. It only reads; nothing changes."],
  },
  {
    id: "fs200-start-prod",
    tabs: ["fs200"],
    group: "After the update",
    title: "Start the app",
    description: "Only if the app is not running after the update.",
    kind: "guide",
    file: "start-woodtek-prod.bat",
    steps: ["On FS200: double-click start-woodtek-prod.bat."],
  },
  {
    id: "fs200-copy-backups",
    tabs: ["fs200"],
    group: "Safety",
    title: "Copy backups off FS200",
    description: "Copies the newest backups to a USB stick.",
    kind: "guide",
    file: "copy-backups-offsite.bat",
    steps: ["On FS200: double-click copy-backups-offsite.bat and pick the USB stick."],
  },
  {
    id: "fs200-unblock-update",
    tabs: ["fs200"],
    group: "Safety",
    title: "Unblock a failed update",
    description: "Use only when the update says local changes would be overwritten.",
    kind: "guide",
    file: "unblock-update.bat",
    steps: ["On FS200: double-click unblock-update.bat, then apply the update again."],
  },
  {
    id: "fs200-restore-migration",
    tabs: ["fs200"],
    group: "Safety",
    title: "Restore factory data on a new server",
    description: "Replaces the database on the server it runs on. Only with the owner's approval.",
    kind: "guide",
    file: "installer\\restore-migration.bat",
    warning: "This replaces the database on the PC it runs on. Do not run it on FS200 unless the owner has approved the migration.",
    steps: ["Only on a new server, when the owner has asked for the migration: double-click installer\\restore-migration.bat."],
  },
];

const BAT_RUNNABLE = new Set(COMMANDS.filter((c) => c.kind === "bat").map((c) => c.id));

function commandById(id) {
  return COMMANDS.find((command) => command.id === id) || null;
}

/** The public view of the command list (no internal paths beyond the file name). */
function publicCommands() {
  return COMMANDS.map((command) => ({
    id: command.id,
    tabs: command.tabs,
    group: command.group,
    title: command.title,
    description: command.description,
    kind: command.kind,
    file: command.file || null,
    steps: command.steps || [],
    warning: command.warning || null,
  }));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function latestPack(root) {
  const dir = path.join(root, "dist-update");
  if (!fs.existsSync(dir)) return null;
  const packs = fs
    .readdirSync(dir)
    .filter((name) => PACK_PATTERN.test(name))
    .map((name) => ({ name, file: path.join(dir, name), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return packs[0] || null;
}

function verifyPack(root) {
  const pack = latestPack(root);
  if (!pack) {
    return { ok: false, output: "No update pack has been built yet. Run Build update pack first." };
  }
  const actual = sha256File(pack.file);
  const shaFile = `${pack.file}.sha256`;
  const lines = [
    `Pack: ${pack.name}`,
    `Size: ${(fs.statSync(pack.file).size / (1024 * 1024)).toFixed(2)} MB`,
    `Built: ${new Date(pack.mtimeMs).toLocaleString()}`,
    `SHA-256: ${actual}`,
  ];
  if (!fs.existsSync(shaFile)) {
    lines.push("No .sha256 file next to the pack. Rebuild the pack before copying it.");
    return { ok: false, output: lines.join("\n") };
  }
  const expected = fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0].toLowerCase();
  if (expected === actual) {
    lines.push("Checksum matches the .sha256 file. Safe to copy to FS200.");
    return { ok: true, output: lines.join("\n") };
  }
  lines.push("CHECKSUM MISMATCH. Do not copy this pack; rebuild it.");
  return { ok: false, output: lines.join("\n") };
}

function readVersion(root) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
    return `${info.product || "WOODTEK-ERP"} V${info.major}.${info.minor}`;
  } catch {
    return "unknown";
  }
}

function runGit(root, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: root, timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, output: (stderr || error.message || "git failed").toString().trim() });
      else resolve({ ok: true, output: stdout.toString().trim() || "(nothing to report)" });
    });
  });
}

/** Read-only checks and folder opening. Returns { status, ok, output }. */
async function runCapture(id, opts) {
  if (id === "git-status") {
    const branch = await runGit(opts.root, ["branch", "--show-current"]);
    const status = await runGit(opts.root, ["status", "-sb"]);
    return { ok: branch.ok && status.ok, output: `Branch: ${branch.output}\n\n${status.output}` };
  }
  if (id === "verify-pack") return verifyPack(opts.root);
  if (id === "open-pack-folder") {
    const dir = path.join(opts.root, "dist-update");
    if (!fs.existsSync(dir)) return { ok: false, output: "dist-update does not exist yet. Build the update pack first." };
    if (opts.dryRun) return { ok: true, output: `Dry run: would open ${dir}` };
    if (opts.platform !== "win32") return { ok: false, output: "Opening folders works on the Windows PC only." };
    spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, output: `Opened ${dir}` };
  }
  return { ok: false, output: "Unknown check." };
}

/** Launches a helper in its own window, as a double-click would. */
function launchBat(command, opts) {
  const full = path.join(opts.root, command.file);
  if (!fs.existsSync(full)) return { ok: false, status: 404, output: `${command.file} was not found in the app folder.` };
  if (opts.dryRun) return { ok: true, status: 200, output: `Dry run: would open ${command.file} in its own window.` };
  if (opts.platform !== "win32") return { ok: false, status: 501, output: "These helpers run on the Windows PC only." };
  spawn("cmd.exe", ["/c", "start", "", "/D", opts.root, command.file], { detached: true, stdio: "ignore" }).unref();
  return { ok: true, status: 200, output: `${command.file} opened in its own window. Follow it there.` };
}

function allowedHostname(value) {
  return value === "127.0.0.1" || value === "localhost";
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function createServer(options = {}) {
  const opts = {
    root: options.root || REPO_ROOT,
    dryRun: Boolean(options.dryRun),
    platform: options.platform || process.platform,
  };

  return http.createServer(async (req, res) => {
    const host = hostnameOf(`http://${req.headers.host || ""}`);
    if (!allowedHostname(host)) return sendJson(res, 403, { ok: false, output: "Only the local PC can use this console." });
    if (req.headers.origin && !allowedHostname(hostnameOf(req.headers.origin))) {
      return sendJson(res, 403, { ok: false, output: "Request refused: cross-site request." });
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/") {
      const html = fs.readFileSync(path.join(__dirname, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const commit = await runGit(opts.root, ["rev-parse", "--short", "HEAD"]);
      const pack = latestPack(opts.root);
      return sendJson(res, 200, {
        version: readVersion(opts.root),
        commit: commit.ok ? commit.output : "unknown",
        latestPack: pack ? pack.name : null,
        dryRun: opts.dryRun,
        platform: opts.platform,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/commands") {
      return sendJson(res, 200, { commands: publicCommands() });
    }

    const runMatch = url.pathname.match(/^\/api\/run\/([a-z0-9-]+)$/);
    if (req.method === "POST" && runMatch) {
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        return sendJson(res, 415, { ok: false, output: "Send the request as JSON." });
      }
      const command = commandById(runMatch[1]);
      if (!command || command.kind === "guide") return sendJson(res, 404, { ok: false, output: "Unknown action." });

      // Drain the (empty) body before answering.
      req.resume();
      await new Promise((resolve) => req.on("end", resolve));

      if (command.kind === "bat") {
        if (!BAT_RUNNABLE.has(command.id)) return sendJson(res, 404, { ok: false, output: "Unknown action." });
        const result = launchBat(command, opts);
        return sendJson(res, result.status, { ok: result.ok, output: result.output });
      }
      const result = await runCapture(command.id, opts);
      return sendJson(res, 200, { ok: result.ok, output: result.output });
    }

    return sendJson(res, 404, { ok: false, output: "Not found." });
  });
}

if (require.main === module) {
  const port = Number(process.env.DEV_CONSOLE_PORT) || DEFAULT_PORT;
  const dryRun = process.env.DEV_CONSOLE_DRY_RUN === "1";
  const server = createServer({ dryRun });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    console.log(`WoodTek dev console: ${url}`);
    console.log("Close this window to stop the console.");
    if (process.platform === "win32" && !dryRun) {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
  });
}

module.exports = { createServer, COMMANDS, verifyPack, latestPack, sha256File };
