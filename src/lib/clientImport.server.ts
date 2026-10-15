// Server-only: read a client workbook and build the blank template.
import ExcelJS from "exceljs";
import { CLIENT_IMPORT_HEADERS } from "@/lib/clientImport";

export class ClientWorkbookError extends Error {}

/** First worksheet as a matrix of cell values (rows of cells). */
export async function parseClientWorkbook(bytes: Uint8Array): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(bytes);
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ClientWorkbookError("The workbook could not be read. Download a fresh template and try again.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ClientWorkbookError("The workbook has no worksheet.");
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    matrix.push(values.map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "");
      if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return v;
    }));
  });
  return matrix;
}

/** Blank template with the header row and one example row. */
export async function buildClientImportTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clients");
  sheet.addRow([...CLIENT_IMPORT_HEADERS]);
  sheet.addRow(["Lars Kjellgren", "Nordic Form Studio", "lars@example.com", "+46 8 555 1204", "Hamngatan 14, Stockholm", 50000, "Prefers oak"]);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.columns = [
    { width: 26 }, { width: 28 }, { width: 28 }, { width: 18 }, { width: 34 }, { width: 14 }, { width: 30 },
  ];
  const bytes = await workbook.xlsx.writeBuffer();
  return new Uint8Array(bytes as ArrayBuffer);
}
