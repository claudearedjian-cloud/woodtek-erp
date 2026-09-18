import "server-only";

import ExcelJS from "exceljs";
import {
  INVENTORY_IMPORT_CATEGORIES,
  INVENTORY_IMPORT_HEADERS,
  INVENTORY_IMPORT_MAX_ROWS,
  unsupportedInventoryImportCell,
} from "@/lib/inventoryImport";

const MAX_WORKSHEET_COLUMNS = 64;

export class InventoryWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryWorkbookError";
  }
}

function primitiveCellValue(value: ExcelJS.CellValue): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
    return value ?? "";
  }
  if (typeof value !== "object") return String(value);

  if ("formula" in value || "sharedFormula" in value) {
    return unsupportedInventoryImportCell("formulas are not supported; paste the calculated value instead.");
  }
  if ("error" in value) {
    return unsupportedInventoryImportCell(`Excel error ${String(value.error || "value")}; replace it with a value.`);
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("text" in value && typeof value.text === "string") return value.text;
  return unsupportedInventoryImportCell("unsupported Excel cell type; replace it with plain text or a number.");
}

/** Load the first/Stock Import worksheet into a bounded, plain cell matrix. */
export async function parseInventoryWorkbook(bytes: Uint8Array): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    throw new InventoryWorkbookError("The workbook could not be opened. Upload an unencrypted .xlsx file created from the WoodTek template.");
  }

  if (workbook.worksheets.length === 0) {
    throw new InventoryWorkbookError("The workbook does not contain a worksheet.");
  }
  const worksheet = workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === "stock import")
    ?? workbook.worksheets[0];

  if (worksheet.rowCount > INVENTORY_IMPORT_MAX_ROWS + 1) {
    throw new InventoryWorkbookError(`The Stock Import sheet exceeds the ${INVENTORY_IMPORT_MAX_ROWS.toLocaleString()}-row limit.`);
  }
  if (worksheet.columnCount > MAX_WORKSHEET_COLUMNS) {
    throw new InventoryWorkbookError(`The Stock Import sheet exceeds the ${MAX_WORKSHEET_COLUMNS}-column safety limit.`);
  }

  const rowCount = Math.max(1, worksheet.rowCount);
  const columnCount = Math.max(INVENTORY_IMPORT_HEADERS.length, worksheet.columnCount);
  const matrix: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const sourceRow = worksheet.getRow(rowNumber);
    const row: unknown[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      row.push(primitiveCellValue(sourceRow.getCell(columnNumber).value));
    }
    matrix.push(row);
  }
  return matrix;
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FFF59E0B" } },
    };
  });
}

/** Build the owner-facing .xlsx template entirely in memory. */
export async function buildInventoryImportTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WoodTek ERP";
  workbook.company = "WoodTek";
  workbook.subject = "Wood & Edge Stock bulk import";
  workbook.title = "WoodTek Stock Import Template";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Stock Import", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.addRow([...INVENTORY_IMPORT_HEADERS]);
  styleHeader(sheet.getRow(1));
  sheet.autoFilter = { from: "A1", to: "H1" };
  sheet.columns = [
    { key: "sku", width: 22 },
    { key: "name", width: 42 },
    { key: "category", width: 26 },
    { key: "stockQuantity", width: 18 },
    { key: "unit", width: 14 },
    { key: "unitCost", width: 16 },
    { key: "reorderLevel", width: 18 },
    { key: "location", width: 28 },
  ];

  for (let row = 2; row <= INVENTORY_IMPORT_MAX_ROWS + 1; row += 1) {
    sheet.getCell(`A${row}`).numFmt = "@"; // Preserve leading zeroes in SKUs.
    sheet.getCell(`C${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${INVENTORY_IMPORT_CATEGORIES.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Choose a category",
      error: "Select one of the WoodTek stock categories.",
    };
    sheet.getCell(`D${row}`).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      formulae: [0],
      allowBlank: false,
      showErrorMessage: true,
      errorTitle: "Whole number required",
      error: "Stock Quantity must be zero or a positive whole number.",
    };
    sheet.getCell(`F${row}`).numFmt = "0.00";
    sheet.getCell(`F${row}`).dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      formulae: [0],
      allowBlank: false,
      showErrorMessage: true,
      errorTitle: "Non-negative cost required",
      error: "Unit Cost must be zero or a positive number.",
    };
    sheet.getCell(`G${row}`).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      formulae: [0],
      allowBlank: false,
      showErrorMessage: true,
      errorTitle: "Whole number required",
      error: "Reorder Level must be zero or a positive whole number.",
    };
  }

  const instructions = workbook.addWorksheet("Instructions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  instructions.columns = [{ width: 25 }, { width: 92 }];
  instructions.addRow(["Rule", "What to enter"]);
  styleHeader(instructions.getRow(1));
  const instructionRows: Array<[string, string]> = [
    ["Before importing", "Keep the eight headers on row 1 of the Stock Import sheet. Put one stock item on each following row."],
    ["All-or-nothing", "WoodTek validates every populated row first. If any row is invalid, nothing in the workbook is written."],
    ["SKU", "Required. Keep this column as Text so any leading zeroes are preserved."],
    ["SKU matching", "SKUs are trimmed and matched case-insensitively. A matching SKU updates that stock row; a new SKU creates a row."],
    ["Stock Quantity", "Enter the absolute on-hand quantity. Import REPLACES the current quantity; it does not add to it."],
    ["Unit Cost", "Enter a non-negative number without a currency symbol. Use 0.00 when there is no cost."],
    ["Reorder Level", "Enter a non-negative whole number."],
    ["Blank rows", "Blank rows are ignored. Formula cells are rejected; paste their calculated values before upload."],
    ["Limits", `Maximum ${INVENTORY_IMPORT_MAX_ROWS.toLocaleString()} populated data rows and a 5 MB .xlsx file.`],
  ];
  for (const [rule, detail] of instructionRows) {
    const row = instructions.addRow([rule, detail]);
    row.getCell(1).font = { bold: true, color: { argb: "FF92400E" } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.height = 34;
  }

  const examples = workbook.addWorksheet("Example (do not import)");
  examples.addRow([...INVENTORY_IMPORT_HEADERS]);
  styleHeader(examples.getRow(1));
  examples.addRow([
    "BRD-OAK-18",
    "White Oak Crown Cut Veneer MDF 18mm",
    "Wood & MDF Panels",
    142,
    "sheets",
    115,
    25,
    "Aisle 1 - Rack A",
  ]);
  examples.columns = sheet.columns.map((column) => ({ width: column.width }));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
