// ============================================================================
// Client statement — pure, client-safe. Turns raw ledger entries
// (data/client-ledger.json shape: {type, amount, reference, notes, at}) into
// chronological statement rows with a running balance, ready for the
// Statement PDF and the ledger UI.
// ============================================================================

export interface StatementEntry {
  type: "invoice" | "payment";
  amount: number;
  reference?: string | null;
  notes?: string | null;
  at: string;
}

export interface StatementRow {
  at: string;
  type: "invoice" | "payment";
  reference: string;
  invoiced: number;
  paid: number;
  balance: number;
}

export interface StatementResult {
  rows: StatementRow[];
  invoiced: number;
  paid: number;
  balance: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Chronological statement with a running balance. Invoices increase the
 * balance, payments decrease it. Entries are sorted by their timestamp so a
 * hand-edited JSON file cannot scramble the statement.
 */
export function buildStatement(entries: StatementEntry[]): StatementResult {
  const sorted = [...(entries ?? [])].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  let balance = 0;
  let invoiced = 0;
  let paid = 0;
  const rows: StatementRow[] = sorted.map((e) => {
    const amount = round2(Math.abs(Number(e.amount) || 0));
    if (e.type === "payment") {
      paid = round2(paid + amount);
      balance = round2(balance - amount);
    } else {
      invoiced = round2(invoiced + amount);
      balance = round2(balance + amount);
    }
    return {
      at: e.at,
      type: e.type === "payment" ? "payment" : "invoice",
      reference: e.reference || e.notes || "",
      invoiced: e.type === "payment" ? 0 : amount,
      paid: e.type === "payment" ? amount : 0,
      balance,
    };
  });
  return { rows, invoiced, paid, balance: round2(invoiced - paid) };
}
