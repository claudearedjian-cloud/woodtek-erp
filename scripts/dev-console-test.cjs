// Route checks for the standalone dev console (dev-console/server.cjs).
// Runs the real server on a random local port in dry-run mode, against a
// throwaway folder, so nothing is launched and no repo file is touched.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

module.exports = async function devConsoleChecks({ check }) {
  const { createServer } = require("../dev-console/server.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-console-"));
  fs.mkdirSync(path.join(root, "dist-update"));
  fs.writeFileSync(path.join(root, "update-woodtek.bat"), "@echo off\r\n");
  fs.writeFileSync(path.join(root, "dist-update", "WoodTek-ERP-Update-1.0.zip"), "pack-bytes");

  const server = createServer({ root, dryRun: true, platform: "linux" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const postJson = (p, extra = {}) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: "{}" });

  try {
    const page = await (await fetch(base + "/")).text();
    check(page.includes("Old PC (development)") && page.includes("FS200 (factory server)"), "dev console: the standalone page has both tabs");
    const list = (await (await fetch(base + "/api/commands")).json()).commands;
    check(list.some((c) => c.id === "apply-update" && c.tabs.includes("fs200") && c.kind === "guide"), "dev console: apply-update is an FS200 guide");
    check(list.some((c) => c.id === "update-woodtek" && c.tabs.includes("old-pc") && c.kind === "bat"), "dev console: update-woodtek opens on the old PC");
    check((await postJson("/api/run/apply-update")).status === 404, "dev console: FS200 guides cannot be launched from the console");
    check((await postJson("/api/run/rm-rf")).status === 404, "dev console: unknown actions are refused");
    check((await fetch(base + "/api/run/update-woodtek", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "" })).status === 415, "dev console: a POST that is not JSON is refused");
    check((await postJson("/api/run/update-woodtek", { Origin: "http://evil.example" })).status === 403, "dev console: a cross-site origin is refused");
    const hostStatus = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/status", headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    check(hostStatus === 403, "dev console: a non-local host header is refused");
    const bat = await (await postJson("/api/run/update-woodtek")).json();
    check(bat.ok === true && bat.output.includes("Dry run"), "dev console: a helper is only reported in dry run");
    const noSha = await (await postJson("/api/run/verify-pack")).json();
    check(noSha.ok === false && noSha.output.includes("No .sha256 file"), "dev console: a pack without a checksum file is flagged");
    const hash = crypto.createHash("sha256").update("pack-bytes").digest("hex");
    fs.writeFileSync(path.join(root, "dist-update", "WoodTek-ERP-Update-1.0.zip.sha256"), `${hash}  WoodTek-ERP-Update-1.0.zip\n`);
    const good = await (await postJson("/api/run/verify-pack")).json();
    check(good.ok === true && good.output.includes("Safe to copy"), "dev console: a matching checksum passes");
    fs.writeFileSync(path.join(root, "dist-update", "WoodTek-ERP-Update-1.0.zip.sha256"), "deadbeef  WoodTek-ERP-Update-1.0.zip\n");
    const bad = await (await postJson("/api/run/verify-pack")).json();
    check(bad.ok === false && bad.output.includes("CHECKSUM MISMATCH"), "dev console: a wrong checksum is refused");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
};
