// Shared, deterministic validation for the Stock Excel importer.
// This module is intentionally browser/server safe so its all-row rules can be
// regression-tested without loading ExcelJS or connecting to PostgreSQL.

export const INVENTORY_IMPORT_HEADERS = [
  "SKU",
  "Name",
  "Category",
  "Stock Quantity",
  "Unit",
  "Unit Cost",
  "Reorder Level",
  "Location",
] as const;

export const INVENTORY_IMPORT_MAX_ROWS = 2_000;
export const INVENTORY_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const INVENTORY_IMPORT_CATEGORIES = [
  "Wood & MDF Panels",
  "Edge Banding",
  "Hardware & Fittings",
  "Coatings & Adhesives",
] as const;

export type InventoryImportAction = "create" | "update";

export interface ExistingInventorySku {
  id: number;
  sku: string;
}

export interface InventoryImportRow {
  rowNumber: number;
  sku: string;
  name: string;
  category: string;
  stockQuantity: number;
  unit: string;
  /** Canonical decimal text, ready for PostgreSQL numeric. */
  unitCost: string;
  reorderLevel: number;
  location: string;
  action: InventoryImportAction;
  existingId: number | null;
  /** Existing casing is retained on updates to avoid changing a unique key. */
  matchedSku: string | null;
}

export interface InventoryImportError {
  rowNumber: number;
  sku?: string;
  messages: string[];
}

export interface InventoryImportValidation {
  valid: boolean;
  rows: InventoryImportRow[];
  errors: InventoryImportError[];
  summary: {
    total: number;
    creates: number;
    updates: number;
  };
}

export interface UnsupportedInventoryImportCell {
  __woodtekInventoryImportUnsupported: string;
}

/** Used by the workbook adapter to preserve a precise, row-level cell error. */
export function unsupportedInventoryImportCell(reason: string): UnsupportedInventoryImportCell {
  return { __woodtekInventoryImportUnsupported: reason };
}

function unsupportedCellReason(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const reason = (value as Partial<UnsupportedInventoryImportCell>).__woodtekInventoryImportUnsupported;
  return typeof reason === "string" && reason ? reason : null;
}

const HEADER_LOOKUP = new Map(
  INVENTORY_IMPORT_HEADERS.map((header) => [normalizeHeader(header), header]),
);

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Trim, Unicode-normalize and case-fold an SKU for matching/deduplication. */
export function normalizeInventorySku(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFKC").trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "boolean" || value instanceof Date) return null;
  const raw = typeof value === "number"
    ? value
    : Number(String(value ?? "").trim().replace(/,/g, ""));
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > 2_147_483_647) return null;
  return raw;
}

function parseMoney(value: unknown): string | null {
  if (typeof value === "boolean" || value instanceof Date) return null;
  const text = typeof value === "number"
    ? String(value)
    : String(value ?? "").trim().replace(/,/g, "");
  if (!text || !/^(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999.99) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-7) return null;
  return (cents / 100).toFixed(2);
}

function addError(
  map: Map<number, InventoryImportError>,
  rowNumber: number,
  message: string,
  sku?: string,
): void {
  const existing = map.get(rowNumber);
  if (existing) {
    if (!existing.messages.includes(message)) existing.messages.push(message);
    if (!existing.sku && sku) existing.sku = sku;
    return;
  }
  map.set(rowNumber, { rowNumber, ...(sku ? { sku } : {}), messages: [message] });
}

function emptyResult(errors: InventoryImportError[]): InventoryImportValidation {
  return {
    valid: false,
    rows: [],
    errors,
    summary: { total: 0, creates: 0, updates: 0 },
  };
}

/**
 * Validate a worksheet represented as rows/cells. Row 1 must carry the
 * canonical headers; additional columns are ignored. Every data row is checked
 * before the caller is allowed to write anything.
 */
export function validateInventoryImportMatrix(
  matrix: unknown[][],
  existingInventory: ExistingInventorySku[],
): InventoryImportValidation {
  const errorMap = new Map<number, InventoryImportError>();
  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const columnByHeader = new Map<(typeof INVENTORY_IMPORT_HEADERS)[number], number>();

  headerRow.forEach((value, index) => {
    const canonical = HEADER_LOOKUP.get(normalizeHeader(value));
    if (!canonical) return;
    if (columnByHeader.has(canonical)) {
      addError(errorMap, 1, `Header “${canonical}” appears more than once.`);
      return;
    }
    columnByHeader.set(canonical, index);
  });

  for (const header of INVENTORY_IMPORT_HEADERS) {
    if (!columnByHeader.has(header)) addError(errorMap, 1, `Missing required header “${header}”.`);
  }
  if (errorMap.has(1)) return emptyResult([...errorMap.values()]);

  const rawDataRows = matrix.slice(1);
  if (rawDataRows.length > INVENTORY_IMPORT_MAX_ROWS) {
    addError(errorMap, 1, `Workbook has more than ${INVENTORY_IMPORT_MAX_ROWS.toLocaleString()} data rows.`);
    return emptyResult([...errorMap.values()]);
  }

  const existingByNormalizedSku = new Map<string, ExistingInventorySku[]>();
  for (const item of existingInventory) {
    const key = normalizeInventorySku(item.sku);
    if (!key) continue;
    const bucket = existingByNormalizedSku.get(key) ?? [];
    bucket.push(item);
    existingByNormalizedSku.set(key, bucket);
  }

  const rows: InventoryImportRow[] = [];
  const sourceRowsBySku = new Map<string, number[]>();
  const valueAt = (row: unknown[], header: (typeof INVENTORY_IMPORT_HEADERS)[number]): unknown =>
    row[columnByHeader.get(header)!];

  rawDataRows.forEach((candidate, zeroBasedIndex) => {
    const row = Array.isArray(candidate) ? candidate : [];
    const rowNumber = zeroBasedIndex + 2;
    const mappedValues = INVENTORY_IMPORT_HEADERS.map((header) => valueAt(row, header));
    if (mappedValues.every((value) => String(value ?? "").trim() === "")) return;

    mappedValues.forEach((value, index) => {
      const reason = unsupportedCellReason(value);
      if (reason) addError(errorMap, rowNumber, `${INVENTORY_IMPORT_HEADERS[index]}: ${reason}`);
    });

    const sku = normalizeInventorySku(unsupportedCellReason(valueAt(row, "SKU")) ? "" : valueAt(row, "SKU"));
    const name = cellText(unsupportedCellReason(valueAt(row, "Name")) ? "" : valueAt(row, "Name"));
    const categoryInput = cellText(unsupportedCellReason(valueAt(row, "Category")) ? "" : valueAt(row, "Category"));
    const category = INVENTORY_IMPORT_CATEGORIES.find((candidate) => candidate.toLowerCase() === categoryInput.toLowerCase()) ?? categoryInput;
    const unit = cellText(unsupportedCellReason(valueAt(row, "Unit")) ? "" : valueAt(row, "Unit"));
    const location = cellText(unsupportedCellReason(valueAt(row, "Location")) ? "" : valueAt(row, "Location"));
    const stockQuantity = parseInteger(unsupportedCellReason(valueAt(row, "Stock Quantity")) ? null : valueAt(row, "Stock Quantity"));
    const unitCost = parseMoney(unsupportedCellReason(valueAt(row, "Unit Cost")) ? null : valueAt(row, "Unit Cost"));
    const reorderLevel = parseInteger(unsupportedCellReason(valueAt(row, "Reorder Level")) ? null : valueAt(row, "Reorder Level"));

    if (!sku) addError(errorMap, rowNumber, "SKU is required.");
    else if (sku.length > 80) addError(errorMap, rowNumber, "SKU must be 80 characters or fewer.", sku);
    else if (/[\u0000-\u001F\u007F]/.test(sku)) {
      addError(errorMap, rowNumber, "SKU cannot contain control characters or line breaks.", sku);
    }
    if (!name) addError(errorMap, rowNumber, "Name is required.", sku);
    else if (name.length > 200) addError(errorMap, rowNumber, "Name must be 200 characters or fewer.", sku);
    if (!category) addError(errorMap, rowNumber, "Category is required.", sku);
    else if (!INVENTORY_IMPORT_CATEGORIES.includes(category as (typeof INVENTORY_IMPORT_CATEGORIES)[number])) {
      addError(errorMap, rowNumber, `Category must be one of: ${INVENTORY_IMPORT_CATEGORIES.join(", ")}.`, sku);
    }
    if (stockQuantity === null) addError(errorMap, rowNumber, "Stock Quantity must be a whole number from 0 to 2,147,483,647.", sku);
    if (!unit) addError(errorMap, rowNumber, "Unit is required.", sku);
    else if (unit.length > 24) addError(errorMap, rowNumber, "Unit must be 24 characters or fewer.", sku);
    if (unitCost === null) addError(errorMap, rowNumber, "Unit Cost must be a non-negative number with at most 2 decimal places and a maximum of 999,999,999.99.", sku);
    if (reorderLevel === null) addError(errorMap, rowNumber, "Reorder Level must be a whole number from 0 to 2,147,483,647.", sku);
    if (!location) addError(errorMap, rowNumber, "Location is required.", sku);
    else if (location.length > 120) addError(errorMap, rowNumber, "Location must be 120 characters or fewer.", sku);

    if (sku) {
      const sourceRows = sourceRowsBySku.get(sku) ?? [];
      sourceRows.push(rowNumber);
      sourceRowsBySku.set(sku, sourceRows);

      const matches = existingByNormalizedSku.get(sku) ?? [];
      if (matches.length > 1) {
        addError(
          errorMap,
          rowNumber,
          `SKU matches multiple existing stock rows (${matches.map((match) => match.sku).join(", ")}); resolve the duplicate database SKUs first.`,
          sku,
        );
      }
    }

    if (
      !errorMap.has(rowNumber)
      && stockQuantity !== null
      && unitCost !== null
      && reorderLevel !== null
    ) {
      const existing = existingByNormalizedSku.get(sku)?.[0] ?? null;
      rows.push({
        rowNumber,
        sku,
        name,
        category,
        stockQuantity,
        unit,
        unitCost,
        reorderLevel,
        location,
        action: existing ? "update" : "create",
        existingId: existing?.id ?? null,
        matchedSku: existing?.sku ?? null,
      });
    }
  });

  for (const [sku, sourceRows] of sourceRowsBySku) {
    if (sourceRows.length < 2) continue;
    for (const rowNumber of sourceRows) {
      addError(
        errorMap,
        rowNumber,
        `Duplicate SKU in workbook; it also appears on row(s) ${sourceRows.filter((row) => row !== rowNumber).join(", ")}.`,
        sku,
      );
    }
  }

  if (sourceRowsBySku.size === 0) {
    addError(errorMap, 2, "No inventory rows were found below the header.");
  }

  const errors = [...errorMap.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  // Rows with a late duplicate error were provisionally added above; never
  // expose them as commit-ready when any validation error exists.
  const validRows = errors.length === 0 ? rows : [];
  const creates = validRows.filter((row) => row.action === "create").length;
  const updates = validRows.filter((row) => row.action === "update").length;
  return {
    valid: errors.length === 0,
    rows: validRows,
    errors,
    summary: { total: validRows.length, creates, updates },
  };
}
