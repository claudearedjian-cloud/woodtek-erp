import { NextResponse } from "next/server";
import { db } from "@/db";
import { pimsSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { importPimsInvoice } from "@/lib/pims";
import fs from "node:fs";
import path from "node:path";

/**
 * Scan the configured PIMS export folder for new *.xml invoices, import each,
 * and move successfully processed files into a "processed" subfolder so they
 * are never re-read. Returns a summary of what happened.
 */
export async function POST(request: Request) {
  // The background watcher runs on the ERP PC itself and POSTs to
  // http://127.0.0.1, so loopback calls are trusted. Any other origin must
  // be a signed-in manager.
  const host = request.headers.get("host") || "";
  const isLoopback = host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("::1");
  if (!isLoopback) {
    const { user, error: authError } = await authorize("pims:write");
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [row] = await db.select().from(pimsSettings).where(eq(pimsSettings.settingKey, "folder_path"));
    const folderPath = (row?.settingValue as string)?.trim();
    if (!folderPath) {
      return NextResponse.json({ error: "No PIMS export folder configured. Set it in the PIMS Import screen first." }, { status: 400 });
    }
    if (!fs.existsSync(folderPath)) {
      return NextResponse.json({ error: `Folder not found: ${folderPath}` }, { status: 404 });
    }

    const processedDir = path.join(folderPath, "processed");
    if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

    const files = fs.readdirSync(folderPath).filter(f => /\.xml$/i.test(f)).sort();
    const results: any[] = [];

    for (const file of files) {
      const full = path.join(folderPath, file);
      try {
        const xml = fs.readFileSync(full, "utf8");
        const result = await importPimsInvoice(xml, file);
        results.push({ file, ...result });
        // Move processed (or skipped-as-duplicate) files out of the inbox.
        fs.renameSync(full, path.join(processedDir, file));
      } catch (e: any) {
        results.push({ file, status: "error", message: e?.message || "Failed to import" });
      }
    }

    return NextResponse.json({ folderPath, scanned: files.length, results });
  } catch (error: any) {
    console.error("POST pims scan error:", error);
    return NextResponse.json({ error: error?.message || "Failed to scan PIMS folder" }, { status: 500 });
  }
}
