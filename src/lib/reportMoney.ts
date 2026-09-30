// ============================================================================
// Money inside reports.
//
// Two categories:
//   MONEY-ONLY  — the whole report IS money (Order Profitability). Without the
//                 Invoicing & Money grant a user may not generate, read or even
//                 see it in the saved list.
//   MIXED       — a report that is mostly operational but carries money columns
//                 (Production Summary, Inventory Status, Client Activity,
//                 Scrap & Rework). These stay generateable; only the money
//                 columns are blanked.
//
// Hiding a screen is not hiding data, so `redactReportMoney()` runs BEFORE the
// report row is inserted: the stored copy cannot leak either. A redacted figure
// is `null`, which the report viewer renders as an em dash on screen and as
// "restricted" in the PDF — never as a fake $0.
// ============================================================================

export const MONEY_ONLY_REPORT_TYPES = ["Order Profitability"] as const;

export const MIXED_MONEY_REPORT_TYPES = [
  "Production Summary",
  "Inventory Status",
  "Client Activity",
  "Scrap & Rework Analysis",
] as const;

export function isMoneyOnlyReport(type: string | null | undefined): boolean {
  return (MONEY_ONLY_REPORT_TYPES as readonly string[]).includes(String(type ?? ""));
}

export function isMixedMoneyReport(type: string | null | undefined): boolean {
  return (MIXED_MONEY_REPORT_TYPES as readonly string[]).includes(String(type ?? ""));
}

/** True when the report contains any money at all. */
export function reportCarriesMoney(type: string | null | undefined): boolean {
  return isMoneyOnlyReport(type) || isMixedMoneyReport(type);
}

type Row = Record<string, unknown>;

/** Null out the listed keys, keeping every other column untouched. */
function blank(row: Row, keys: string[]): Row {
  const out: Row = { ...row };
  for (const key of keys) {
    if (key in out) out[key] = null;
  }
  return out;
}

function blankEach(rows: unknown, keys: string[]): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => (row && typeof row === "object" ? blank(row as Row, keys) : row));
}

/**
 * Returns a copy of the generated report with every money figure replaced by
 * null. Unknown report types are returned untouched (they carry no money).
 */
export function redactReportMoney(type: string | null | undefined, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Row;

  switch (String(type ?? "")) {
    case "Production Summary":
      return {
        ...blank(d, ["totalValue"]),
        orders: blankEach(d.orders, ["totalValue"]),
      };

    case "Inventory Status":
      return {
        ...blank(d, ["totalValue"]),
        items: blankEach(d.items, ["unitCost", "totalValue"]),
      };

    case "Client Activity":
      return {
        clients: blankEach(d.clients, ["totalSpend", "creditLimit", "currentBalance"]),
      };

    case "Scrap & Rework Analysis":
      return {
        ...d,
        kpis: blank((d.kpis as Row) ?? {}, ["scrapCost", "reworkCost"]),
        scrapByReason: blankEach(d.scrapByReason, ["cost"]),
        reworkByReason: blankEach(d.reworkByReason, ["cost"]),
        byMachine: blankEach(d.byMachine, ["cost"]),
      };

    default:
      return d;
  }
}
