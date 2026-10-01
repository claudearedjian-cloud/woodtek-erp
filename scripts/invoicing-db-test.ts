// Invoicing & A/R — live PostgreSQL integration checks.
//
// Run (against a SCRATCH database only):
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/woodtek_invoicing_test \
//     npx tsx scripts/invoicing-db-test.ts [--fresh]
//
// --fresh drops the four invoicing tables first, exercising the factory's
// lazy first-visit DDL (invoicingSchema.server.ts). Without it the run
// exercises the restart path (create-if-not-exists against existing tables).
// Run once with --fresh and once without to cover both.
//
// SAFETY: refuses to run unless the database name contains "test". The client
// ledger overlay is redirected to a private temp directory (WOODTEK_DATA_DIR)
// so the factory's data/ folder is never touched. Checks run in order and
// share their fixtures; the suite deletes only its own DBTEST rows.
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index";
import {
  customers,
  documentCounters,
  invoiceLines,
  invoicePayments,
  invoices,
  users,
} from "../src/db/schema";
import { InvoicingError, addDaysIso, documentNumber, paymentState, todayIso } from "../src/lib/invoicing";
import {
  cancelDocument,
  convertQuote,
  createDocument,
  deletePayment,
  documentDetail,
  invoicingBoard,
  recordPayment,
} from "../src/lib/invoicing.server";
import { ensureInvoicingSchema } from "../src/lib/invoicingSchema.server";
import {
  loadMergedLedger,
  readLedgerFile,
  syncCustomerBalance,
  writeLedgerFile,
} from "../src/lib/clientLedger.server";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS: invoicing-db: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: invoicing-db: ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function expectFailure(
  fn: () => Promise<unknown>,
  match: { status?: number; message: RegExp },
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const err = error as InvoicingError;
    if (match.status !== undefined) assertEq(err.status ?? null, match.status, "unexpected error status");
    assert(match.message.test(err.message), `error ${JSON.stringify(err.message)} does not match ${match.message}`);
    return;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

async function main(): Promise<void> {
  // ---- safety guards ----
  const raw = process.env.DATABASE_URL ?? "";
  const dbName = raw.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" does not look like a scratch database (name must contain "test").`);
  }
  const run = Date.now();
  // Keep the factory's data/ folder out of the blast radius.
  process.env.WOODTEK_DATA_DIR = `/tmp/woodtek-invoicing-db-${run}`;
  const fs = await import("node:fs");
  fs.mkdirSync(process.env.WOODTEK_DATA_DIR, { recursive: true });

  const usedCounters: Array<{ series: string; year: number }> = [];
  const customerIds: number[] = [];

  if (process.argv.includes("--fresh")) {
    await db.execute(sql`drop table if exists payments cascade`);
    await db.execute(sql`drop table if exists invoice_lines cascade`);
    await db.execute(sql`drop table if exists invoices cascade`);
    await db.execute(sql`drop table if exists document_counters cascade`);
    console.log("note: invoicing tables dropped (--fresh) — lazy first-visit DDL will recreate them");
  }

  try {
    await check("lazy DDL creates the four tables with the columns Drizzle maps", async () => {
      await ensureInvoicingSchema();
      const result = await db.execute(sql`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('invoices','invoice_lines','payments','document_counters')
      `);
      const present = new Set(
        (result.rows as Array<{ table_name: string; column_name: string }>)
          .map((row) => `${row.table_name}.${row.column_name}`),
      );
      for (const ref of [
        "invoices.kind", "invoices.number", "invoices.customer_name", "invoices.issue_date",
        "invoices.vat_rate", "invoices.subtotal_cents", "invoices.total_cents", "invoices.converted_from_id",
        "invoice_lines.description", "invoice_lines.quantity", "invoice_lines.unit_price_cents",
        "payments.amount_cents", "payments.paid_at", "payments.method",
        "document_counters.series", "document_counters.year", "document_counters.last_number",
      ]) {
        assert(present.has(ref), `missing column ${ref}`);
      }
      // Drizzle can read every table: the raw DDL and schema.ts agree.
      await db.select().from(invoices).limit(1);
      await db.select().from(invoiceLines).limit(1);
      await db.select().from(invoicePayments).limit(1);
      await db.select().from(documentCounters).limit(1);
    });

    await check("schema setup is safe to run again on existing tables (restart path)", async () => {
      await ensureInvoicingSchema();
    });

    // ---- fixtures ----
    const userRows = await db.insert(users).values({
      name: `DBTEST clerk ${run}`,
      email: `dbtest-inv-${run}@example.test`,
      role: "Manager",
    }).returning({ id: users.id });
    const createdById = userRows[0].id;
    const makeCustomer = async (tag: string): Promise<number> => {
      const rows = await db.insert(customers).values({
        name: `DBTEST INV ${run} ${tag}`, company: `DBTEST ${tag} ${run}`,
        email: `client-${tag}-${run}@example.test`, phone: "01 000 000", address: "Beirut",
      }).returning({ id: customers.id });
      customerIds.push(rows[0].id);
      return rows[0].id;
    };
    // One client per scenario: the ledger bridge and A/R aging read per
    // customer, so shared fixtures would leak between checks.
    const customerId = await makeCustomer("main");

    const docPayload = (over: Record<string, unknown> = {}) => ({
      customerId,
      issueDate: "2026-03-01",
      dueDate: "2026-03-31",
      vatRate: "11.00",
      notes: "DBTEST document",
      lines: [{ description: "Oak reception desk", quantity: "1.5", unitPrice: "1200.00" }],
      ...over,
    });

    // ---- numbering ----
    let invoiceNumber = "";
    await check("VAT invoice numbers legally in the INV series and totals round-trip", async () => {
      const created = await createDocument("Invoice", docPayload(), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      invoiceNumber = created.number;
      assertEq(created.number, documentNumber("INV", 2026, Number(created.number.split("-")[2])), "number uses the legal INV-YYYY-###### format");
      const detail = await documentDetail(created.id);
      assertEq(detail.subtotalCents, 180_000, "subtotal $1,800.00");
      assertEq(detail.vatCents, 19_800, "VAT 11% = $198.00");
      assertEq(detail.totalCents, 199_800, "total $1,998.00");
      assertEq(detail.customerName, `DBTEST INV ${run} main`, "customer snapshot");
      assertEq(detail.status, "Open", "new invoice is open");
    });

    await check("concurrent creates get unique sequential numbers with no gaps", async () => {
      const before = await db.select().from(documentCounters)
        .where(eq(documentCounters.series, "INV"));
      const lastBefore = before.find((row) => row.year === 2026)?.lastNumber ?? 0;
      const results = await Promise.all(
        Array.from({ length: 4 }, () => createDocument("Invoice", docPayload({ issueDate: "2026-04-01", dueDate: "2026-04-30" }), createdById)),
      );
      usedCounters.push({ series: "INV", year: 2026 });
      const numbers = results.map((row) => Number(row.number.split("-")[2]));
      assertEq(new Set(numbers).size, 4, "four distinct numbers");
      numbers.sort((a, b) => a - b);
      assertEq(numbers.join(","), `${lastBefore + 1},${lastBefore + 2},${lastBefore + 3},${lastBefore + 4}`, "numbers are consecutive without gaps");
      const after = await db.select().from(documentCounters).where(eq(documentCounters.series, "INV"));
      assertEq(after.find((row) => row.year === 2026)?.lastNumber, lastBefore + 4, "counter advanced by exactly four");
    });

    // ---- quotation -> invoice ----
    await check("conversion copies lines and VAT, links both documents and closes the quote", async () => {
      const quote = await createDocument("Quote", docPayload({ issueDate: "2026-05-01", dueDate: "2026-05-31", notes: "validity month" }), createdById);
      usedCounters.push({ series: "QUO", year: 2026 });
      assert(quote.number.startsWith("QUO-2026-"), `quote uses the QUO series (${quote.number})`);
      // A converted invoice is issued TODAY with fresh payment terms.
      const requestedDue = addDaysIso(todayIso(), 45);
      const invoice = await convertQuote(quote.id, { dueDate: requestedDue }, createdById);
      usedCounters.push({ series: "INV", year: Number(invoice.number.split("-")[1]) });
      assert(invoice.number.startsWith("INV-"), `converted doc uses the INV series (${invoice.number})`);
      const detail = await documentDetail(invoice.id);
      assertEq(detail.convertedFromId, quote.id, "invoice links back to its quote");
      assertEq(detail.totalCents, 199_800, "totals carry over");
      assertEq(detail.issueDate, todayIso(), "converted invoice is issued today");
      assertEq(detail.dueDate, requestedDue, "requested payment terms apply");
      assertEq(detail.lines[0].description, "Oak reception desk", "line descriptions copy");
      const quoteDetail = await documentDetail(quote.id);
      assertEq(quoteDetail.status, "Converted", "quote is marked converted");
      await expectFailure(() => convertQuote(quote.id, {}, createdById), { status: 409, message: /already converted/i });
    });

    await check("an invoice cannot convert again and a quote can be cancelled only while open", async () => {
      const quote = await createDocument("Quote", docPayload({ issueDate: "2026-05-02", dueDate: "2026-06-30" }), createdById);
      usedCounters.push({ series: "QUO", year: 2026 });
      await expectFailure(() => convertQuote(1_000_000, {}, createdById), { status: 404, message: /not found/i });
      const cancelled = await cancelDocument(quote.id);
      assertEq(cancelled.status, "Cancelled", "open quote cancels");
      await expectFailure(() => convertQuote(quote.id, {}, createdById), { status: 409, message: /converted or cancelled/i });
      await expectFailure(() => cancelDocument(quote.id), { status: 409, message: /already cancelled or converted/i });
    });

    // ---- payments ----
    let payInvoiceId = 0;
    await check("partial then full payment derives the payment state and blocks overpayment", async () => {
      const invoice = await createDocument("Invoice", docPayload({ issueDate: "2026-06-01", dueDate: "2026-06-30" }), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      payInvoiceId = invoice.id;
      await recordPayment(invoice.id, { amount: "100.00", paidAt: "2026-06-10", method: "Cash" }, createdById);
      const partial = await documentDetail(invoice.id);
      assertEq(partial.paidCents, 10_000, "one payment registered");
      assertEq(paymentState(partial.totalCents, partial.paidCents), "Partially paid", "derived state is partial");
      await expectFailure(
        () => recordPayment(invoice.id, { amount: "100000.00", paidAt: "2026-06-11", method: "Transfer" }, createdById),
        { status: 409, message: /larger than the .* still outstanding/i },
      );
      const stillPartial = await documentDetail(invoice.id);
      assertEq(stillPartial.paidCents, 10_000, "overpayment was rolled back");
      await recordPayment(invoice.id, { amount: "1898.00", paidAt: "2026-06-12", method: "Transfer" }, createdById);
      const full = await documentDetail(invoice.id);
      assertEq(full.outstandingCents, 0, "invoice fully paid");
      assertEq(paymentState(full.totalCents, full.paidCents), "Paid", "derived state is paid");
    });

    await check("concurrent payments cannot overpay one invoice", async () => {
      const invoice = await createDocument("Invoice", docPayload({ issueDate: "2026-07-01", dueDate: "2026-07-31" }), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      const results = await Promise.allSettled([
        recordPayment(invoice.id, { amount: "1500.00", paidAt: "2026-07-05", method: "Cash" }, createdById),
        recordPayment(invoice.id, { amount: "1500.00", paidAt: "2026-07-05", method: "Cash" }, createdById),
      ]);
      const fulfilled = results.filter((entry) => entry.status === "fulfilled");
      const rejected = results.filter((entry) => entry.status === "rejected") as PromiseRejectedResult[];
      assertEq(fulfilled.length, 1, "exactly one payment fits into $1,998.00");
      assertEq(rejected.length, 1, "the concurrent payment is refused");
      const detail = await documentDetail(invoice.id);
      assertEq(detail.paidCents, 150_000, "only one payment posted");
    });

    await check("deleting a payment restores the outstanding balance", async () => {
      const detailBefore = await documentDetail(payInvoiceId);
      const paymentId = detailBefore.payments[0].id;
      await deletePayment(paymentId, createdById);
      const after = await documentDetail(payInvoiceId);
      assertEq(after.paidCents, 189_800, "first payment removed, second kept");
      assertEq(after.outstandingCents, 10_000, "outstanding restored");
      await expectFailure(() => deletePayment(paymentId, createdById), { status: 404, message: /not found/i });
    });

    await check("cancel rules: paid invoices refuse, unpaid invoices void, cancelled refuse payments", async () => {
      await expectFailure(() => cancelDocument(payInvoiceId), { status: 409, message: /recorded payments cannot be cancelled/i });
      const invoice = await createDocument("Invoice", docPayload({ issueDate: "2026-08-01", dueDate: null }), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      await recordPayment(invoice.id, { amount: "50.00", paidAt: "2026-08-02", method: "Cash" }, createdById);
      await expectFailure(() => cancelDocument(invoice.id), { status: 409, message: /recorded payments cannot be cancelled/i });
      const [payment] = (await documentDetail(invoice.id)).payments;
      await deletePayment(payment.id, createdById);
      const cancelled = await cancelDocument(invoice.id);
      assertEq(cancelled.status, "Cancelled", "payment-free invoice cancels");
      await expectFailure(
        () => recordPayment(invoice.id, { amount: "10.00", paidAt: "2026-08-03", method: "Cash" }, createdById),
        { status: 409, message: /cancelled/i },
      );
    });

    // ---- client ledger bridge ----
    await check("documents merge into the client ledger and re-sync the cached balance", async () => {
      // One client for this scenario only: the merge is per customer.
      const ledgerCustomerId = await makeCustomer("ledger");
      // A manual opening-balance entry in the JSON overlay ($40).
      const data = readLedgerFile();
      data.entries[String(ledgerCustomerId)] = [{
        id: 1, type: "invoice", amount: 40, reference: "Opening balance", notes: null,
        at: "2026-01-01T08:00:00.000Z", source: "manual",
      }];
      writeLedgerFile(data);

      const invoice = await createDocument("Invoice", docPayload({ customerId: ledgerCustomerId, issueDate: "2026-09-01", dueDate: "2026-09-30" }), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      await recordPayment(invoice.id, { amount: "1998.00", paidAt: "2026-09-20", method: "Cash", reference: "CH-77" }, createdById);

      const merged = await loadMergedLedger(ledgerCustomerId);
      const docEntries = merged.entries.filter((entry) => entry.source === "document");
      assertEq(docEntries.length, 2, "invoice + payment document entries merged");
      assert(docEntries.some((entry) => entry.type === "invoice" && entry.reference === invoice.number), "invoice entry carries its legal number");
      assert(docEntries.some((entry) => entry.type === "payment" && entry.reference === "CH-77"), "payment entry carries its reference");
      assertEq(merged.entries.filter((entry) => entry.source === "manual").length, 1, "manual entries stay untouched");
      assertEq(merged.invoiced, 40 + 1998, "invoiced total includes manual + documents");
      assertEq(merged.paid, 1998, "paid total from documents");
      assertEq(merged.balance, 40, "balance = opening $40 + fully paid invoice");

      await syncCustomerBalance(ledgerCustomerId);
      const rows = await db.select({ balance: customers.currentBalance }).from(customers).where(eq(customers.id, ledgerCustomerId));
      assertEq(rows[0].balance, "40", "cached currentBalance matches the merged ledger");

      // A cancelled invoice leaves the account again.
      const doomed = await createDocument("Invoice", docPayload({ customerId: ledgerCustomerId, issueDate: "2026-09-25", dueDate: null }), createdById);
      usedCounters.push({ series: "INV", year: 2026 });
      await cancelDocument(doomed.id);
      const afterCancel = await loadMergedLedger(ledgerCustomerId);
      assert(!afterCancel.entries.some((entry) => entry.reference === doomed.number), "cancelled invoice disappears from the ledger");
    });

    // ---- A/R aging ----
    await check("A/R aging buckets unpaid remainders by days past due", async () => {
      const agingCustomerId = await makeCustomer("aging");
      const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
      const recent = await createDocument("Invoice", docPayload({ customerId: agingCustomerId, issueDate: iso(30), dueDate: iso(5) }), createdById);
      const old = await createDocument("Invoice", docPayload({ customerId: agingCustomerId, issueDate: iso(150), dueDate: iso(120) }), createdById);
      for (const created of [recent, old]) {
        usedCounters.push({ series: "INV", year: Number(created.number.split("-")[1]) });
      }
      await recordPayment(recent.id, { amount: "998.00", paidAt: iso(4), method: "Cash" }, createdById);
      const board = await invoicingBoard();
      const row = board.aging.find((entry) => entry.customerId === agingCustomerId);
      assert(row, "customer appears in A/R aging");
      assertEq(row.buckets["d1-30"], 100_000, "5-days-late remainder lands in 1-30");
      assertEq(row.buckets["d90+"], 199_800, "120-days-late remainder lands in 90+");
      assertEq(row.totalCents, 299_800, "aging totals the unpaid remainders");
      assertEq(row.overdueCents, 299_800, "both due dates are past the board clock");
    });
  } finally {
    // Best-effort cleanup so the scratch database can be reused.
    try {
      if (customerIds.length > 0) {
        const invoiceIdRows = await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.customerId, customerIds));
        const invoiceIdList = invoiceIdRows.map((row) => row.id);
        if (invoiceIdList.length > 0) {
          await db.delete(invoicePayments).where(inArray(invoicePayments.invoiceId, invoiceIdList));
          await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIdList));
          await db.delete(invoices).where(inArray(invoices.id, invoiceIdList));
        }
        await db.delete(customers).where(inArray(customers.id, customerIds));
      }
      await db.delete(users).where(eq(users.email, `dbtest-inv-${run}@example.test`));
      for (const entry of usedCounters) {
        await db.delete(documentCounters).where(sql`${documentCounters.series} = ${entry.series} and ${documentCounters.year} = ${entry.year}`);
      }
    } catch (error) {
      console.log(`note: cleanup incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(failed === 0 ? "ALL PASS" : `${failed} CHECK(S) FAILED`);
  console.log(`PASS ${passed} FAIL ${failed}`);
}

main()
  .catch((error) => {
    failed++;
    console.log("FAIL: invoicing-db: suite crashed");
    console.log(`      ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`PASS ${passed} FAIL ${failed}`);
  })
  .finally(() => pool.end())
  .then(() => process.exit(failed > 0 ? 1 : 0));
