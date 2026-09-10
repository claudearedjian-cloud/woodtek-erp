import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

// ============================================================================
// Client ledger: invoices vs payments per client. Stored in a JSON overlay
// (data/client-ledger.json — same pattern as bom-status / dispatch-status,
// no DB migration). After every change the client's currentBalance column is
// re-synced so credit checks elsewhere see the real outstanding amount.
//   GET    — entries + summary (customers:read)
//   POST   — add an invoice or payment entry (customers:write)
//   DELETE — remove an entry (?entryId=, customers:write)
// ============================================================================

interface LedgerEntry {
  id: number;
  type: "invoice" | "payment";
  amount: number;
  reference: string | null;
  notes: string | null;
  at: string;
}

type LedgerFile = { version: 1; entries: Record<string, LedgerEntry[]> };

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "client-ledger.json");
}

function readFile(): LedgerFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (parsed?.entries && typeof parsed.entries === "object") return { version: 1, entries: parsed.entries };
  } catch {
    /* first run */
  }
  return { version: 1, entries: {} };
}

function writeFile(data: LedgerFile) {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function summarize(entries: LedgerEntry[]) {
  const invoiced = entries.filter((e) => e.type === "invoice").reduce((s, e) => s + e.amount, 0);
  const paid = entries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
  const balance = Math.round((invoiced - paid) * 100) / 100;
  return { invoiced: Math.round(invoiced * 100) / 100, paid: Math.round(paid * 100) / 100, balance };
}

async function syncBalance(customerId: number, balance: number) {
  await db.update(customers).set({ currentBalance: String(balance) }).where(eq(customers.id, customerId));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:read");
  if (authError) return authError;
  try {
    const { id } = await context.params;
    const entries = readFile().entries[String(Number(id))] ?? [];
    return NextResponse.json({ entries, ...summarize(entries) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load the client ledger" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:write");
  if (authError) return authError;
  try {
    const { id } = await context.params;
    const customerId = Number(id);
    const body = await request.json();
    const type = body.type === "payment" ? "payment" : "invoice";
    const amount = Math.round(Math.abs(Number(body.amount)) * 100) / 100;
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
    }

    const data = readFile();
    const list = data.entries[String(customerId)] ?? [];
    const entry: LedgerEntry = {
      id: Date.now(),
      type,
      amount,
      reference: body.reference ? String(body.reference).slice(0, 80) : null,
      notes: body.notes ? String(body.notes).slice(0, 300) : null,
      at: new Date().toISOString(),
    };
    list.push(entry);
    data.entries[String(customerId)] = list;
    writeFile(data);

    const summary = summarize(list);
    await syncBalance(customerId, summary.balance);
    return NextResponse.json({ entries: list, ...summary }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to record the ledger entry" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:write");
  if (authError) return authError;
  try {
    const { id } = await context.params;
    const customerId = Number(id);
    const entryId = Number(new URL(request.url).searchParams.get("entryId"));
    if (!entryId) return NextResponse.json({ error: "Entry ID required" }, { status: 400 });

    const data = readFile();
    const list = (data.entries[String(customerId)] ?? []).filter((e) => e.id !== entryId);
    data.entries[String(customerId)] = list;
    writeFile(data);

    const summary = summarize(list);
    await syncBalance(customerId, summary.balance);
    return NextResponse.json({ entries: list, ...summary });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete the ledger entry" }, { status: 500 });
  }
}
