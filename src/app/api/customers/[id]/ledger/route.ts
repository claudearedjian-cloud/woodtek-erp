import { NextResponse } from "next/server";
import { authorize, authorizeModule } from "@/lib/auth";
import { MONEY_MODULE } from "@/lib/optionalModules";
import {
  loadMergedLedger,
  readLedgerFile,
  summarize,
  syncCustomerBalance,
  writeLedgerFile,
  type LedgerEntry,
} from "@/lib/clientLedger.server";


// ============================================================================
// Client ledger: invoices vs payments per client. Manual adjustments live in
// a JSON overlay (data/client-ledger.json — same pattern as bom-status /
// dispatch-status, no DB migration); structured documents from Invoicing & A/R
// (VAT invoices and their payments) are merged in at read time and carry
// source:"document". After every change the client's currentBalance column is
// re-synced so credit checks elsewhere see the real outstanding amount.
//   GET    — merged entries + summary (customers:read + money grant)
//   POST   — add a manual invoice or payment entry (customers:write + money)
//   DELETE — remove a MANUAL entry (?entryId=; document entries are managed
//            in Invoicing & A/R and cannot be deleted here)
// ============================================================================

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:read");
  if (authError) return authError;
  // The ledger is money: it belongs to the Invoicing & Money module, so the
  // grant - not the role - decides whether it can be read at all.
  const { error: moneyError } = await authorizeModule(MONEY_MODULE);
  if (moneyError) return moneyError;
  try {
    const { id } = await context.params;
    const merged = await loadMergedLedger(Number(id));
    return NextResponse.json(merged);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load the client ledger" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:write");
  if (authError) return authError;
  // The ledger is money: adding or removing an entry needs the Invoicing &
  // Money grant, not just customers:write.
  const { error: moneyError } = await authorizeModule(MONEY_MODULE);
  if (moneyError) return moneyError;
  try {
    const { id } = await context.params;
    const customerId = Number(id);
    const body = await request.json();
    const type = body.type === "payment" ? "payment" : "invoice";
    const amount = Math.round(Math.abs(Number(body.amount)) * 100) / 100;
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
    }

    const data = readLedgerFile();
    const list = data.entries[String(customerId)] ?? [];
    const entry: LedgerEntry = {
      id: Date.now(),
      type,
      amount,
      reference: body.reference ? String(body.reference).slice(0, 80) : null,
      notes: body.notes ? String(body.notes).slice(0, 300) : null,
      at: new Date().toISOString(),
      source: "manual",
    };
    list.push(entry);
    data.entries[String(customerId)] = list;
    writeLedgerFile(data);

    await syncCustomerBalance(customerId);
    return NextResponse.json(await loadMergedLedger(customerId), { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to record the ledger entry" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:write");
  if (authError) return authError;
  // The ledger is money: adding or removing an entry needs the Invoicing &
  // Money grant, not just customers:write.
  const { error: moneyError } = await authorizeModule(MONEY_MODULE);
  if (moneyError) return moneyError;
  try {
    const { id } = await context.params;
    const customerId = Number(id);
    const rawId = new URL(request.url).searchParams.get("entryId");
    const entryId = Number(rawId);
    if (!entryId || !Number.isFinite(entryId)) {
      return NextResponse.json(
        { error: "Entries from Invoicing & A/R are managed there — void the invoice or delete the payment instead." },
        { status: 400 },
      );
    }

    const data = readLedgerFile();
    const list = (data.entries[String(customerId)] ?? []).filter((e) => e.id !== entryId);
    data.entries[String(customerId)] = list;
    writeLedgerFile(data);

    await syncCustomerBalance(customerId);
    return NextResponse.json(await loadMergedLedger(customerId));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete the ledger entry" }, { status: 500 });
  }
}
