// ============================================================================
// Client (customer) Excel import — pure planning rules, no node imports.
// The workbook is read on the server (clientImport.server.ts); this module
// decides, row by row, what would be created, skipped or refused.
//
// Columns (header names are matched case-insensitively):
//   Name*  Company  Email  Phone  Address  Credit limit  Notes
//   * required. A row needs a name. Email is the duplicate key when present;
//   without an email, name + company is the key. Existing clients are never
//   changed by an import — they are reported as "already exists" and skipped.
// New clients are created as shared (no sales rep assigned), like any new client
// without an owner. A Manager can assign them afterwards.
// ============================================================================

export const CLIENT_IMPORT_HEADERS = ["Name", "Company", "Email", "Phone", "Address", "Credit limit", "Notes"] as const;
export const CLIENT_IMPORT_MAX_ROWS = 2000;
export const CLIENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ClientImportAction = "create" | "exists" | "error";

export interface ClientImportPlanRow {
  rowNumber: number; // spreadsheet row number (header is row 1)
  action: ClientImportAction;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  creditLimit: string;
  notes: string;
  reason: string; // "" for create; the explanation for exists / error
}

export interface ClientImportPlan {
  valid: boolean; // true when there are no error rows and at least one row
  headerError: string; // "" when the header row is fine
  rows: ClientImportPlanRow[];
  createCount: number;
  existsCount: number;
  errorCount: number;
}

export interface ExistingClientKey {
  name: string;
  company: string;
  email: string;
}

const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: string): string => v.toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Column index per known header, or -1. */
function headerIndexes(headerRow: unknown[]): Record<(typeof CLIENT_IMPORT_HEADERS)[number], number> {
  const cells = headerRow.map((c) => key(norm(c)));
  const find = (label: string) => cells.indexOf(label.toLowerCase());
  return Object.fromEntries(CLIENT_IMPORT_HEADERS.map((h) => [h, find(h)])) as Record<(typeof CLIENT_IMPORT_HEADERS)[number], number>;
}

export function planClientImport(matrix: unknown[][], existing: ExistingClientKey[]): ClientImportPlan {
  const empty = (headerError: string): ClientImportPlan => ({ valid: false, headerError, rows: [], createCount: 0, existsCount: 0, errorCount: 0 });
  if (!Array.isArray(matrix) || matrix.length === 0) return empty("The workbook is empty.");

  const idx = headerIndexes(matrix[0] ?? []);
  if (idx.Name < 0) return empty("The first row must contain a \"Name\" column. Download the template and try again.");

  const existingEmails = new Set(existing.map((c) => key(norm(c.email))).filter(Boolean));
  const existingPairs = new Set(existing.map((c) => `${key(norm(c.name))}|${key(norm(c.company))}`));
  const seenEmails = new Set<string>();
  const seenPairs = new Set<string>();

  const body = matrix.slice(1);
  const rows: ClientImportPlanRow[] = [];
  let dataRows = 0;
  for (let i = 0; i < body.length; i++) {
    const raw = body[i] ?? [];
    const cell = (label: (typeof CLIENT_IMPORT_HEADERS)[number]) => (idx[label] >= 0 ? raw[idx[label]] : "");
    const row = {
      name: norm(cell("Name")),
      company: norm(cell("Company")),
      email: norm(cell("Email")),
      phone: norm(cell("Phone")),
      address: norm(cell("Address")),
      creditLimit: norm(cell("Credit limit")),
      notes: String(cell("Notes") ?? "").trim(),
    };
    const rowNumber = i + 2;
    // Fully blank rows are ignored (spreadsheets keep formatted empty rows).
    if (!Object.values(row).some((v) => v !== "")) continue;
    dataRows++;
    if (dataRows > CLIENT_IMPORT_MAX_ROWS) {
      rows.push({ ...row, rowNumber, action: "error", reason: `More than ${CLIENT_IMPORT_MAX_ROWS} rows; split the file.` });
      break;
    }

    const fail = (reason: string) => {
      rows.push({ ...row, rowNumber, action: "error", reason });
    };
    if (!row.name) { fail("Name is required."); continue; }
    if (row.name.length > 120) { fail("Name is longer than 120 characters."); continue; }
    if (row.company.length > 160 || row.address.length > 300 || row.phone.length > 60) { fail("Company, address or phone is too long."); continue; }
    if (row.email && !EMAIL_RE.test(row.email)) { fail(`"${row.email}" is not a valid email address.`); continue; }
    let limit = 10000;
    if (row.creditLimit !== "") {
      const parsed = Number(row.creditLimit.replace(/,/g, ""));
      if (!Number.isFinite(parsed) || parsed < 0) { fail("Credit limit must be a number of zero or more."); continue; }
      limit = parsed;
    }
    const pair = `${key(row.name)}|${key(row.company)}`;
    const emailKey = key(row.email);

    if (emailKey && existingEmails.has(emailKey)) {
      rows.push({ ...row, creditLimit: String(limit), rowNumber, action: "exists", reason: "A client with this email already exists." });
      continue;
    }
    if (!emailKey && existingPairs.has(pair)) {
      rows.push({ ...row, creditLimit: String(limit), rowNumber, action: "exists", reason: "A client with this name and company already exists." });
      continue;
    }
    if (emailKey && seenEmails.has(emailKey)) { fail("This email appears twice in the file."); continue; }
    if (!emailKey && seenPairs.has(pair)) { fail("This name and company appear twice in the file."); continue; }
    if (emailKey) seenEmails.add(emailKey);
    seenPairs.add(pair);
    rows.push({ ...row, creditLimit: String(limit), rowNumber, action: "create", reason: "" });
  }

  const createCount = rows.filter((r) => r.action === "create").length;
  const existsCount = rows.filter((r) => r.action === "exists").length;
  const errorCount = rows.filter((r) => r.action === "error").length;
  if (dataRows === 0) return { ...empty(""), headerError: "The file has no client rows under the header." };
  return { valid: errorCount === 0, headerError: "", rows, createCount, existsCount, errorCount };
}
