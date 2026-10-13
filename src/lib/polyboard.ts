// ============================================================================
// Polyboard Project, Cabinet, CSV Cutting List, and Hardware Parsers
// Supports .pb-proj (Polyboard project file) and .csv/.txt cutting lists
// ----------------------------------------------------------------------------
// Real Polyboard cut list exports are configured by the user (Cutting list >
// Cutting list options > Format): they can carry a title block, any field
// order, any separator, localized field names or no header row at all. This
// WoodTek exports use length/width/thickness/quantity/material/grain in 1–6,
// part name in 7, L1/L2/W1/W2 edge values in 8–11, project/cabinet in 12–13,
// face-0/face-6 CIX filenames in 14–15, and cabinet part serial in 16.
// Other layouts identify headers by alias AND content and understand section/
// merged-cell layouts instead of assuming a fixed English column order.
// ============================================================================

import { parseCix, type ParsedCixPart } from "./cixParser";
import {
  buildCabinetLayout,
  classifyPartRole,
  deriveCabinetDimensions,
  matchesAny,
  normalizeKey,
  normalizeText,
} from "./polyboardParts";

export interface PolyboardHardware {
  id: string;
  name: string; // e.g. "Concealed Hinge 110°", "Minifix Bolt 34mm", "Wooden Dowel 8x30", "Drawer Slide 500mm Soft-close"
  category: "hinge" | "fastener" | "slide" | "handle" | "bracket" | "other";
  quantity: number;
  cabinetName?: string;
  partReference?: string;
  sku?: string;
}

export type PolyboardCixMatchMethod = "reference" | "name" | "dimensions";

export interface PolyboardPart {
  id: string; // unique part identifier / cix reference / barcode
  cabinetName: string;
  name: string; // e.g. "Left Side", "Right Side", "Top", "Bottom", "Shelf", "Back", "Door"
  material: string;
  quantity: number;
  length: number;    // Net / overall length (mm)
  width: number;     // Net / overall width (mm)
  thickness: number; // Net thickness (mm)
  /** Primary CIX reference (face 0 when present, otherwise face 6). */
  cixFilename?: string;
  /** Face-specific references declared in WoodTek CSV columns 14 and 15. */
  cixFilenameFace0?: string;
  cixFilenameFace6?: string;
  /** Actual uploaded filenames attached to the face-specific parsed programs. */
  cixMatchedFilenameFace0?: string;
  cixMatchedFilenameFace6?: string;
  /** Whether a WoodTek CSV declares machining on each face; false means no machining. */
  cixFace0Expected?: boolean;
  cixFace6Expected?: boolean;
  cixReferenceExplicit?: boolean; // Column 14 names a specific face-0 CNC file.
  cixReferenceFace6Explicit?: boolean; // Column 15 names a specific face-6 CNC file.
  cixMatchMethod?: PolyboardCixMatchMethod; // How the face-0 or legacy CNC program was linked.
  cixMatchMethodFace6?: PolyboardCixMatchMethod;
  partSerial?: string; // Column 16: serial within the cabinet.
  barcode: string;   // Barcode printed on part label (e.g., CIX program name or part ID)
  isScanned?: boolean;
  scannedAt?: string;
  scannedBy?: string;
  cixData?: ParsedCixPart; // Face 0, retained for backward compatibility.
  cixDataFace6?: ParsedCixPart;
  grain?: number;
  edgeBanding?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

export interface PolyboardCabinet {
  id: string;
  name: string;
  type?: string;
  width: number;
  height: number;
  depth: number;
  quantity: number;
  parts: PolyboardPart[];
  hardware?: PolyboardHardware[];
  isReadyForAssembly?: boolean;
  assembledAt?: string;
  linkedOrderId?: number;
}

export interface PolyboardProject {
  id: string;
  name: string;
  importedAt: string;
  importedBy?: string;
  notes?: string;
  sourceFiles: {
    pbProjName?: string;
    csvName?: string;
    cixFiles: string[];
  };
  cabinets: PolyboardCabinet[];
  globalHardware?: PolyboardHardware[];
}

/** One-based positions in the owner's Polyboard cutting-list export. */
export const WOODTEK_CSV_COLUMNS = {
  length: 1,
  width: 2,
  thickness: 3,
  quantity: 4,
  material: 5,
  grain: 6,
  part: 7,
  edgeL1: 8,
  edgeL2: 9,
  edgeW1: 10,
  edgeW2: 11,
  project: 12,
  cabinet: 13,
  cix: 14,
  cixFace6: 15,
  partSerial: 16,
} as const;
export type PolyboardCsvLayout = "woodtek" | "auto";
const WOODTEK_IDENTITY_INDICES = [
  WOODTEK_CSV_COLUMNS.part,
  WOODTEK_CSV_COLUMNS.project,
  WOODTEK_CSV_COLUMNS.cabinet,
  WOODTEK_CSV_COLUMNS.cix,
  WOODTEK_CSV_COLUMNS.cixFace6,
  WOODTEK_CSV_COLUMNS.partSerial,
].map((column) => column - 1);

export interface PolyboardSkippedRow {
  line: number;
  reason: "repeated-header" | "total" | "boilerplate" | "empty";
  /** Column-14/15 face reference on that line (WoodTek layout), when present. */
  cix?: string;
  text: string;
}

/** Human readable report of what the importer understood from a CSV file. */
export interface PolyboardCsvDiagnostics {
  layout: PolyboardCsvLayout;
  projectNames: string[];
  delimiter: string;
  delimiterLabel: string;
  headerRowIndex: number | null; // null = no header row found (positional parse)
  headerLabels: string[];
  headerless: boolean;
  detectedColumns: Record<string, string>;
  columnsInferredFromContent: string[];
  cabinetGrouping: "column" | "sections" | "blocks" | "single";
  rowsParsed: number;
  rowsSkipped: number;
  /** One entry per skipped line (1-based file line), so a dropped part is never silent. */
  skippedRows: PolyboardSkippedRow[];
  sectionRows: number;
  warnings: string[];
}

export interface PolyboardCsvResult {
  projectName: string;
  cabinetsMap: Map<string, PolyboardCabinet>;
  parts: PolyboardPart[];
  diagnostics: PolyboardCsvDiagnostics;
}

/**
 * Splits CSV lines safely handling quotes and commas/semicolons/tabs/pipes
 */
function parseCsvLine(line: string, delimiter: string = ","): string[] {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) {
        if (line[i + 1] === quote) {
          current += char;
          i++;
        } else {
          quote = null;
        }
      } else {
        current += char;
      }
    } else if ((char === '"' || char === "'") && !current.trim()) {
      quote = char;
    } else if (char === delimiter) {
      result.push(current.trim());
      current = "";
    } else {
      // An apostrophe in a name (Fond d'armoire) is not an opening CSV quote.
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const DELIMITERS: Array<{ char: string; label: string }> = [
  { char: ";", label: "semicolon (;)" },
  { char: "\t", label: "tab" },
  { char: ",", label: "comma (,)" },
  { char: "|", label: "pipe (|)" },
];

/**
 * Detect the separator used by the file by counting candidates over several
 * lines (the first lines can be a title block without any separator).
 */
function detectSeparator(lines: string[]): { char: string; label: string } {
  const scores = DELIMITERS.map((d) => ({ ...d, count: 0 }));
  for (const line of lines.slice(0, 40)) {
    for (const score of scores) {
      if (line.includes(score.char)) score.count += (line.match(new RegExp(`\\${score.char}`, "g")) || []).length;
    }
  }
  scores.sort((a, b) => b.count - a.count);
  return scores[0].count > 0 ? scores[0] : { char: ",", label: "comma (,)" };
}

// ---------------------------------------------------------------------------
// Header alias dictionary (EN / FR / DE / ES / IT / NL)
// ---------------------------------------------------------------------------

type CsvRole =
  | "project"
  | "cabinet"
  | "part"
  | "material"
  | "qty"
  | "length"
  | "width"
  | "thickness"
  | "depth"
  | "dimCombined"
  | "cix"
  | "edge1"
  | "edge2"
  | "edge3"
  | "edge4"
  | "grain";

const HEADER_ALIASES: Record<CsvRole, string[]> = {
  project: [
    "project", "projectname", "projet", "projetname", "nomprojet", "nomduprojet", "job", "jobname", "chantier",
    "projekt", "projektname", "progetto", "proyecto", "auftrag", "auftragsname",
  ],
  cabinet: [
    "cabinet", "cabinets", "cabinetname", "meuble", "meubles", "nomdumeuble", "nommeuble", "modele", "model", "models",
    "modell", "modello", "modelo", "unite", "unit", "units", "armoire", "armoires", "schrank", "caisson", "caissons",
    "corps", "carcass", "carcassname", "korpuss", "cuerpo", "corpo", "element", "elemento", "furniture", "item", "itemname",
    "article", "assembly", "box", "boxname", "ensemble",
  ],
  part: [
    "part", "parts", "partname", "partlabel", "piece", "pieces", "nomdelapiece", "nompiece", "nom", "name", "description",
    "desc", "designation", "designacion", "bezeichnung", "beschreibung", "label", "libelle", "component", "composant",
    "teil", "teilename", "panel", "panels", "panneau", "panneaux",
  ],
  material: [
    "material", "materials", "materiau", "materiaux", "matiere", "matieres", "mat", "platte", "werkstoff", "madera",
    "legno", "decor", "decoro", "decorcode", "finish", "finition", "color", "colour", "substrate", "board", "panelmaterial",
  ],
  qty: [
    "qty", "quantity", "quantite", "quantites", "quantita", "menge", "cantidad", "qte", "qt", "qta", "anzahl", "count",
    "pcs", "pc", "nb", "nombre", "nbre", "piececount", "number", "numberofparts",
  ],
  length: [
    "length", "longueur", "lang", "lange", "largo", "lunghezza", "height", "hauteur", "hohe", "altura", "altezza", "lpx",
    "h", "l", "cutlength", "grosslength",
  ],
  width: ["width", "largeur", "breite", "ancho", "larghezza", "lpy", "w", "cutwidth", "grosswidth", "broad"],
  thickness: ["thickness", "epaisseur", "dicke", "espesor", "spessore", "thk", "thick", "lpz", "t", "gauge", "materialthickness"],
  depth: ["depth", "profondeur", "tiefe", "profundidad", "profondita", "ply", "d"],
  dimCombined: ["dimension", "dimensions", "dim", "dims", "size", "taille", "grosse", "abmessungen", "medidas", "misure", "lwx"],
  cix: [
    "cix", "cixfile", "cixname", "cnc", "cncfile", "cncprogram", "barcode", "codebarre", "bar", "code", "ref", "reference",
    "program", "programme", "programname", "file", "filename", "fichier", "etiquette", "machine", "partid", "id", "partcode",
    "labelcode",
  ],
  edge1: ["edge1", "edgea", "chant1", "chantface", "chantface1", "kante1", "canto1", "bordo1", "edgetop", "chant haut", "chant", "edge", "kante", "canto", "bordo", "banding", "bord", "banda"],
  edge2: ["edge2", "edgeb", "chant2", "chantface2", "kante2", "canto2", "bordo2", "edgebottom", "chant bas"],
  edge3: ["edge3", "edgec", "chant3", "chantface3", "kante3", "canto3", "bordo3", "edgeleft", "chant gauche"],
  edge4: ["edge4", "edged", "chant4", "chantface4", "kante4", "canto4", "bordo4", "edgeright", "chant droit"],
  grain: ["grain", "graindirection", "fil", "faser", "hilo", "vena", "sensdufil", "dir"],
};

const NUMERIC_LIKE = /^-?\d+(?:[.,]\d+)?\s*(?:mm|cm|m"|mm\.)?$/i;
const COMBINED_DIMS = /^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?(?:\s*[x×*]\s*\d+(?:[.,]\d+)?)?\s*$/i;
const SUMMARY_ROW = /^(total|totaux|sous[\s-]?total|sub[\s-]?total|sum|summe|gesamt|totale|total\s+general|nombre\s+de|number\s+of|total\s+pcs|count|cantidad\s+total|anzahl)\b/i;

/** Score how well a header cell matches each role. Exact matches win. */
function scoreHeaderCell(cell: string): Array<{ role: CsvRole; score: number }> {
  const key = normalizeKey(cell);
  if (!key) return [];
  const scored: Array<{ role: CsvRole; score: number }> = [];

  (Object.keys(HEADER_ALIASES) as CsvRole[]).forEach((role) => {
    let best = 0;
    for (const alias of HEADER_ALIASES[role]) {
      const a = normalizeKey(alias);
      if (!a) continue;
      if (key === a) best = Math.max(best, 6);
      else if (a.length >= 3 && key.startsWith(a)) best = Math.max(best, 4);
      else if (a.length >= 4 && key.includes(a)) best = Math.max(best, 3);
      else if (key.length >= 4 && a.includes(key) && a.length - key.length <= 2) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ role, score: best });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function rowHeaderScore(cells: string[]): number {
  let total = 0;
  const seen = new Set<CsvRole>();
  cells.forEach((cell) => {
    const best = scoreHeaderCell(cell)[0];
    if (best && !seen.has(best.role)) {
      seen.add(best.role);
      total += best.score;
    }
  });
  return total;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/(\d)[.,](\d)/, "$1.$2");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function looksNumeric(value: string | undefined): boolean {
  return !!value && NUMERIC_LIKE.test(value.trim());
}

/** Actual dimensions distinguish part rows from header-like project/file names. */
function hasPartDimensions(cells: string[], woodtekColumns = false): boolean {
  const sizeCells = woodtekColumns ? cells.filter((_, column) => !WOODTEK_IDENTITY_INDICES.includes(column)) : cells;
  const dimensionRoles: CsvRole[] = ["length", "width", "thickness", "qty", "dimCombined"];
  const hasDimensionTitles = sizeCells.some((cell) =>
    scoreHeaderCell(cell).some(({ role, score }) => score === 6 && dimensionRoles.includes(role)),
  );
  if (hasDimensionTitles) return false;
  return sizeCells.filter(looksNumeric).length >= 2 || sizeCells.some((cell) => COMBINED_DIMS.test(cell));
}

/** Title-ish lines that are not cabinet names (repeated report headings). */
const TITLE_ROW = /^(polyboard|wood ?designer|liste de debit|liste des debits|debits|cutting list|cut ?list|cutlist|projet|project|project name|erp|export|impression|page)\b/i;

function isSectionLabel(cell: string): boolean {
  const text = (cell || "").trim();
  if (!text || looksNumeric(text)) return false;
  const normalized = normalizeText(text);
  if (SUMMARY_ROW.test(normalized)) return false;
  if (TITLE_ROW.test(text) || TITLE_ROW.test(normalized)) return false;
  return true;
}

/** Strips a leading "Meuble:", "Model -", "Unit =" style prefix from a section row. */
function cleanSectionLabel(cell: string): string {
  return cell
    .trim()
    .replace(/^(cabinet|meuble|meubles|modele|model|modell|unit|unite|caisson|armoire|box|project|projet|assembly)\s*[:=\-–]\s*/i, "")
    .trim();
}

interface ColumnMapping {
  [role: string]: number;
}

/**
 * Finds the header row (tolerating title blocks) and maps roles to columns.
 * Content based inference fills anything the header didn't give us.
 */
function buildColumnMapping(
  rows: string[][],
  headerRowIndex: number | null,
  options: { preferSections?: boolean; woodtekColumns?: boolean } = {},
): { mapping: ColumnMapping; labels: Record<string, string>; inferred: string[] } {
  const mapping: ColumnMapping = {};
  const labels: Record<string, string> = {};
  const inferred: string[] = [];
  const assignedCols = new Set<number>();

  const assign = (role: string, col: number, label: string) => {
    if (mapping[role] !== undefined) return;
    mapping[role] = col;
    labels[role] = label;
    assignedCols.add(col);
  };

  // Reserve the fixed WoodTek export columns BEFORE header matching or
  // inference. Numeric identity fields must never become sizes or quantities.
  if (options.woodtekColumns) {
    assign("length", WOODTEK_CSV_COLUMNS.length - 1, "column 1 (length)");
    assign("width", WOODTEK_CSV_COLUMNS.width - 1, "column 2 (width)");
    assign("thickness", WOODTEK_CSV_COLUMNS.thickness - 1, "column 3 (thickness)");
    assign("qty", WOODTEK_CSV_COLUMNS.quantity - 1, "column 4 (quantity)");
    assign("material", WOODTEK_CSV_COLUMNS.material - 1, "column 5 (material)");
    assign("grain", WOODTEK_CSV_COLUMNS.grain - 1, "column 6 (grain)");
    assign("part", WOODTEK_CSV_COLUMNS.part - 1, "column 7 (part name)");
    assign("edge1", WOODTEK_CSV_COLUMNS.edgeL1 - 1, "column 8 (edge L1)");
    assign("edge2", WOODTEK_CSV_COLUMNS.edgeL2 - 1, "column 9 (edge L2)");
    assign("edge3", WOODTEK_CSV_COLUMNS.edgeW1 - 1, "column 10 (edge W1)");
    assign("edge4", WOODTEK_CSV_COLUMNS.edgeW2 - 1, "column 11 (edge W2)");
    assign("project", WOODTEK_CSV_COLUMNS.project - 1, "column 12 (project name)");
    assign("cabinet", WOODTEK_CSV_COLUMNS.cabinet - 1, "column 13 (cabinet name)");
    assign("cix", WOODTEK_CSV_COLUMNS.cix - 1, "column 14 (face 0 CIX filename)");
    assign("cixFace6", WOODTEK_CSV_COLUMNS.cixFace6 - 1, "column 15 (face 6 CIX filename)");
    assign("partSerial", WOODTEK_CSV_COLUMNS.partSerial - 1, "column 16 (cabinet part serial)");
  }

  if (headerRowIndex !== null) {
    const headerCells = rows[headerRowIndex];
    const claims: Array<{ role: CsvRole; score: number; col: number }> = [];

    headerCells.forEach((cell, col) => {
      scoreHeaderCell(cell).forEach((s) => claims.push({ ...s, col }));
    });

    // Highest score first; each role and each column are used only once.
    claims.sort((a, b) => b.score - a.score || a.col - b.col);
    const edgeOrder: CsvRole[] = ["edge1", "edge2", "edge3", "edge4"];
    claims.forEach((claim) => {
      if (assignedCols.has(claim.col)) return;
      let role: CsvRole = claim.role;
      // Generic "Chant" / "Edge" columns fill the first free edge slot.
      if (edgeOrder.includes(role) && mapping[role] !== undefined) {
        const free = edgeOrder.find((r) => mapping[r] === undefined);
        if (!free) return;
        role = free;
      }
      if (mapping[role] !== undefined) return;
      assign(role, claim.col, (headerCells[claim.col] || "").replace(/^["']|["']$/g, "").trim());
    });
  }

  const dataRows = rows.filter((_, i) => headerRowIndex === null || i > headerRowIndex);
  const maxCols = Math.max(0, ...dataRows.map((r) => r.length));

  const columnValues = (col: number) => dataRows.map((r) => (r[col] || "").trim()).filter(Boolean);
  const columnStats = (col: number) => {
    const rawValues = dataRows.map((r) => (r[col] || "").trim());
    const values = rawValues.filter(Boolean);
    const numbers = values.filter(looksNumeric).map(toNumber);
    const numericRatio = values.length > 0 ? numbers.length / values.length : 0;
    return {
      rawValues,
      values,
      numbers,
      numericRatio,
      min: numbers.length ? Math.min(...numbers) : 0,
      max: numbers.length ? Math.max(...numbers) : 0,
      distinct: new Set(values.map((v) => normalizeKey(v))).size,
      blocks: countBlocks(rawValues.map((v) => normalizeKey(v))),
    };
  };

  // Combined dimension column ("720 x 560 x 18") found by content
  if (mapping.dimCombined === undefined) {
    for (let col = 0; col < maxCols; col++) {
      if (assignedCols.has(col)) continue;
      const values = columnValues(col);
      if (values.length >= 2 && values.filter((v) => COMBINED_DIMS.test(v)).length / values.length >= 0.6) {
        assign("dimCombined", col, labels.dimCombined || `column ${col + 1} (size)`);
        inferred.push("dimCombined");
        break;
      }
    }
  }

  // Numeric roles still missing: infer from value ranges
  const freeNumericCols: Array<{ col: number; stats: ReturnType<typeof columnStats> }> = [];
  for (let col = 0; col < maxCols; col++) {
    if (assignedCols.has(col) || mapping.dimCombined === col) continue;
    const stats = columnStats(col);
    if (stats.numericRatio >= 0.7 && stats.values.length >= 2) freeNumericCols.push({ col, stats });
  }

  // Quantity: small, integral, few distinct values. Thickness: small numbers
  // too, so the larger of the two "small" columns wins thickness.
  const smallCols = freeNumericCols.filter((c) => c.stats.max <= 60 && c.stats.min >= 0);
  const qtyCandidates = freeNumericCols.filter(
    (c) => c.stats.max <= 100 && c.stats.min >= 0 && c.stats.distinct <= 12 && c.stats.numbers.every((n) => Number.isInteger(n)),
  );
  if (mapping.thickness === undefined && smallCols.length > 0) {
    const pick = smallCols.slice().sort((a, b) => b.stats.max - a.stats.max || a.col - b.col)[0];
    assign("thickness", pick.col, `column ${pick.col + 1} (thickness)`);
    inferred.push("thickness");
  }
  if (mapping.qty === undefined && qtyCandidates.length > 0) {
    const pick = qtyCandidates
      .filter((c) => c.col !== mapping.thickness)
      .sort((a, b) => b.stats.max - a.stats.max || a.col - b.col)[0];
    if (pick && pick.stats.max <= 50) {
      assign("qty", pick.col, `column ${pick.col + 1} (quantity)`);
      inferred.push("qty");
    }
  }

  // Dimensions: the two largest numeric columns are length then width.
  const dimCandidates = freeNumericCols
    .filter((c) => c.col !== mapping.thickness && c.col !== mapping.qty && c.stats.max > 60)
    .sort((a, b) => b.stats.max - a.stats.max || a.col - b.col);
  if (mapping.length === undefined && dimCandidates.length > 0) {
    const pick = dimCandidates.shift()!;
    assign("length", pick.col, `column ${pick.col + 1} (length)`);
    inferred.push("length");
  }
  if (mapping.width === undefined && dimCandidates.length > 0) {
    const pick = dimCandidates.shift()!;
    assign("width", pick.col, `column ${pick.col + 1} (width)`);
    inferred.push("width");
  }
  if (mapping.depth === undefined && dimCandidates.length > 0 && dimCandidates[0].stats.max >= 100) {
    assign("depth", dimCandidates[0].col, `column ${dimCandidates[0].col + 1} (depth)`);
    inferred.push("depth");
  }

  // Text roles: cabinet = leftmost blocky text column, part = most unique text
  // column, material = middle ground (only if nothing matched by name).
  const freeTextCols: Array<{ col: number; stats: ReturnType<typeof columnStats> }> = [];
  for (let col = 0; col < maxCols; col++) {
    if (assignedCols.has(col)) continue;
    const stats = columnStats(col);
    if (stats.values.length >= 2 && stats.numericRatio < 0.4) freeTextCols.push({ col, stats });
  }

  const blocky = freeTextCols.filter((c) => c.stats.blocks >= 2 && c.stats.blocks <= 60 && c.stats.distinct >= 2);
  if (mapping.cabinet === undefined && blocky.length > 0 && !options.preferSections) {
    // A cabinet column repeats its value over a block of rows: prefer the
    // column with the fewest repeating blocks, leftmost first.
    const pick = blocky.sort(
      (a, b) =>
        a.stats.blocks - b.stats.blocks ||
        b.stats.values.length / Math.max(1, b.stats.blocks) - a.stats.values.length / Math.max(1, a.stats.blocks) ||
        a.col - b.col,
    )[0];
    assign("cabinet", pick.col, `column ${pick.col + 1} (cabinet)`);
    inferred.push("cabinet");
  }

  const textRemainder = freeTextCols.filter((c) => c.col !== mapping.cabinet);
  if (mapping.part === undefined && textRemainder.length > 0) {
    const pick = textRemainder
      .slice()
      .sort((a, b) => b.stats.distinct / Math.max(1, b.stats.values.length) - a.stats.distinct / Math.max(1, a.stats.values.length) || a.col - b.col)[0];
    assign("part", pick.col, `column ${pick.col + 1} (part)`);
    inferred.push("part");
  }

  const materialRemainder = freeTextCols.filter((c) => c.col !== mapping.cabinet && c.col !== mapping.part);
  if (mapping.material === undefined && materialRemainder.length > 0) {
    const pick = materialRemainder
      .slice()
      .sort((a, b) => a.stats.distinct - b.stats.distinct || a.col - b.col)
      .find((c) => !matchesAny(normalizeText(c.stats.values[0]), ["mm", "x"]));
    if (pick) {
      assign("material", pick.col, `column ${pick.col + 1} (material)`);
      inferred.push("material");
    }
  }

  return { mapping, labels, inferred };
}

/** Counts contiguous value blocks, e.g. A,A,B,B,A -> 4 (used to spot "group by cabinet" columns). */
function countBlocks(values: string[]): number {
  let blocks = 0;
  let previous: string | null = null;
  for (const value of values) {
    if (value !== previous) {
      blocks++;
      previous = value;
    }
  }
  return blocks;
}

/**
 * Parses a Polyboard cutting list CSV/TXT export.
 */
export function parsePolyboardCsv(
  csvContent: string,
  options: { layout?: PolyboardCsvLayout } = {},
): PolyboardCsvResult {
  const diagnostics: PolyboardCsvDiagnostics = {
    layout: "auto",
    projectNames: [],
    delimiter: ",",
    delimiterLabel: "comma (,)",
    headerRowIndex: null,
    headerLabels: [],
    headerless: false,
    detectedColumns: {},
    columnsInferredFromContent: [],
    cabinetGrouping: "single",
    rowsParsed: 0,
    rowsSkipped: 0,
    skippedRows: [],
    sectionRows: 0,
    warnings: [],
  };

  const cabinetsMap = new Map<string, PolyboardCabinet>();
  const allParts: PolyboardPart[] = [];

  const rawContent = (csvContent || "").replace(/^\uFEFF/, "");
  const lines: string[] = [];
  const lineNumbers: number[] = []; // 1-based line in the original file, for the report
  rawContent.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return;
    lines.push(line);
    lineNumbers.push(index + 1);
  });

  if (lines.length === 0) {
    diagnostics.warnings.push("The cutting list file is empty.");
    return { projectName: "", cabinetsMap, parts: allParts, diagnostics };
  }

  const delimiter = detectSeparator(lines);
  diagnostics.delimiter = delimiter.char;
  diagnostics.delimiterLabel = delimiter.label;

  const rows = lines.map((l) => parseCsvLine(l, delimiter.char));
  // Shorter, existing exports (including the sample) keep automatic detection.
  const woodtekColumns = options.layout !== "auto" && rows.some((row) => row.length >= WOODTEK_CSV_COLUMNS.cix);
  diagnostics.layout = woodtekColumns ? "woodtek" : "auto";

  // 1. Find the header row: the best scoring row in the first 25 lines.
  let headerRowIndex: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (hasPartDimensions(rows[i], woodtekColumns)) continue;
    const score = rowHeaderScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = i;
    }
    if (score >= 10) break; // clearly the header, stop early
  }
  if (bestScore < 5) {
    headerRowIndex = null;
    diagnostics.headerless = true;
  }
  diagnostics.headerRowIndex = headerRowIndex;
  if (headerRowIndex !== null) {
    diagnostics.headerLabels = rows[headerRowIndex].map((c) => c.trim());
  }

  // 2. Reserve fixed identity columns, then map other headers/content. A section row
  // ("Caisson bas 600" on its own line) is a stronger grouping signal than a
  // guessed column, so the block-guess is skipped when sections are present.
  const dataStart = headerRowIndex === null ? 0 : headerRowIndex + 1;
  const dataRows = rows.slice(dataStart);
  const hasSectionRows = dataRows.some((cells) => {
    const filled = cells.map((c) => (c || "").trim()).filter(Boolean);
    return filled.length === 1 && isSectionLabel(filled[0]);
  });
  const { mapping, labels, inferred } = buildColumnMapping(rows, headerRowIndex, {
    preferSections: hasSectionRows,
    woodtekColumns,
  });
  diagnostics.detectedColumns = labels;
  diagnostics.columnsInferredFromContent = inferred;

  // A headerless WoodTek export is the normal case: the fixed identity columns
  // are reported in the import details, so it is not a warning.
  if (headerRowIndex === null && !woodtekColumns) {
    diagnostics.warnings.push(
      "No header row was detected, so columns were identified from their contents (dimensions / quantities). " +
        "Enable field titles in Polyboard (Cutting list > Cutting list options > Format) for a precise import.",
    );
  }
  if (mapping.length === undefined && mapping.dimCombined === undefined) {
    diagnostics.warnings.push(
      "No length/height column was found in the cutting list: part sizes will be estimated from the cabinet.",
    );
  }

  // 3. Walk the rows.
  let partCounter = 1;
  let currentSection: string | null = null;
  let lastCabinetName = "";
  let usedSections = false;
  const sectionNames: string[] = [];

  const projectColumn = mapping.project;
  const cabinetColumn = mapping.cabinet;
  const partColumn = mapping.part;
  const materialColumn = mapping.material;
  const qtyColumn = mapping.qty;
  const cixColumn = mapping.cix;
  const cixFace6Column = mapping.cixFace6;
  const partSerialColumn = mapping.partSerial;

  const ensureCabinet = (name: string): PolyboardCabinet => {
    const clean = (name || "").trim() || "Cabinet 1";
    if (!cabinetsMap.has(clean)) {
      const baseId = clean.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "cabinet";
      let id = `cab-${baseId}`;
      let suffix = 2;
      while (Array.from(cabinetsMap.values()).some((c) => c.id === id)) {
        id = `cab-${baseId}-${suffix++}`;
      }
      cabinetsMap.set(clean, {
        id,
        name: clean,
        width: 0,
        height: 0,
        depth: 0,
        quantity: 1,
        parts: [],
        hardware: [],
        isReadyForAssembly: false,
      });
    }
    return cabinetsMap.get(clean)!;
  };

  const headerKeys = headerRowIndex === null ? [] : rows[headerRowIndex].map((cell) => normalizeKey(cell || ""));
  const headerFilledCount = headerKeys.filter(Boolean).length;
  /** True when a row repeats the detected header cell-for-cell (most of it). */
  const repeatsHeader = (cells: string[]): boolean => {
    if (headerFilledCount === 0) return false;
    let same = 0;
    headerKeys.forEach((key, col) => {
      if (key && normalizeKey(cells[col] || "") === key) same++;
    });
    return same / headerFilledCount >= 0.6;
  };

  const skipRow = (rowIndex: number, reason: PolyboardSkippedRow["reason"], cells: string[]) => {
    diagnostics.rowsSkipped++;
    const cix = woodtekColumns && reason !== "repeated-header"
      ? [cells[WOODTEK_CSV_COLUMNS.cix - 1], cells[WOODTEK_CSV_COLUMNS.cixFace6 - 1]].filter(Boolean).join(" / ").trim()
      : "";
    diagnostics.skippedRows.push({
      line: lineNumbers[dataStart + rowIndex],
      reason,
      ...(cix ? { cix } : {}),
      text: cells.filter(Boolean).join(" | ").slice(0, 160),
    });
  };

  dataRows.forEach((cells, rowIndex) => {
    const trimmed = cells.map((c) => (c || "").trim());
    const filled = trimmed.filter(Boolean);
    if (filled.length === 0) return;

    // A real WoodTek part row with a face reference in column 14 or 15 is
    // never a title, repeated header or totals line.
    const declaresCix = woodtekColumns && [WOODTEK_CSV_COLUMNS.cix, WOODTEK_CSV_COLUMNS.cixFace6].some((column) => {
      const value = trimmed[column - 1] || "";
      return !!value && normalizeKey(value) !== headerKeys[column - 1];
    });

    // Repeated header (some exports repeat titles for every cabinet). Only
    // possible when the file HAS a header; a part row carrying a one-letter
    // grain/edge code ("L", "W", "H", "T") must never be mistaken for one.
    if (
      headerRowIndex !== null &&
      !declaresCix &&
      filled.length >= 2 &&
      (repeatsHeader(trimmed) ||
        (trimmed.every((cell) => !looksNumeric(cell)) &&
          !hasPartDimensions(trimmed, woodtekColumns) &&
          rowHeaderScore(trimmed) >= Math.max(5, bestScore * 0.7)))
    ) {
      skipRow(rowIndex, "repeated-header", trimmed);
      return;
    }

    // A row with a single filled cell is either a section heading announcing
    // the next cabinet ("Caisson 600") or report boilerplate - never a part.
    if (filled.length === 1) {
      if (isSectionLabel(filled[0]) && normalizeText(filled[0]) !== normalizeText(rows[0]?.[0] ?? "")) {
        const label = cleanSectionLabel(filled[0]);
        if (label) {
          currentSection = label;
          lastCabinetName = label;
          usedSections = true;
          if (!sectionNames.includes(label)) sectionNames.push(label);
        }
        diagnostics.sectionRows++;
      } else {
        skipRow(rowIndex, "boilerplate", trimmed);
      }
      return;
    }

    // Footer / totals rows
    if (!declaresCix && SUMMARY_ROW.test(normalizeText(filled[0])) && trimmed.length >= 2 && trimmed.filter((c) => looksNumeric(c)).length <= 2) {
      skipRow(rowIndex, "total", trimmed);
      return;
    }

    const cellAt = (col: number | undefined) => (col === undefined ? "" : trimmed[col] || "");

    let cabinetName = cellAt(cabinetColumn);
    if (!cabinetName && cabinetColumn !== undefined) cabinetName = lastCabinetName;
    if (!cabinetName && usedSections && currentSection) cabinetName = currentSection;
    if (!cabinetName) cabinetName = lastCabinetName || "Cabinet 1";
    lastCabinetName = cabinetName;

    const partName = partColumn !== undefined && cellAt(partColumn) ? cellAt(partColumn) : `Part ${partCounter}`;

    let length = mapping.dimCombined !== undefined ? 0 : toNumber(cellAt(mapping.length));
    let width = mapping.dimCombined !== undefined ? 0 : toNumber(cellAt(mapping.width));
    let thickness = mapping.dimCombined !== undefined ? 0 : toNumber(cellAt(mapping.thickness));
    if (mapping.dimCombined !== undefined) {
      const parts = cellAt(mapping.dimCombined).split(/[x×*]/i).map((v) => toNumber(v));
      if (parts.length >= 2) {
        length = parts[0];
        width = parts[1];
        if (parts.length >= 3) thickness = parts[2];
      }
    }
    if (thickness <= 0 && mapping.depth !== undefined && width <= 0) {
      width = toNumber(cellAt(mapping.depth));
    }

    let qty = qtyColumn !== undefined ? Math.round(toNumber(cellAt(qtyColumn))) : 0;
    if (qty <= 0) qty = 1;
    if (qty > 500) {
      diagnostics.warnings.push(`Unusually large quantity (${qty}) on line ${lineNumbers[dataStart + rowIndex]} was capped at 500.`);
      qty = 500;
    }

    const material = materialColumn !== undefined && cellAt(materialColumn) ? cellAt(materialColumn) : "";

    if (!partName && length <= 0 && width <= 0) {
      skipRow(rowIndex, "empty", trimmed);
      return;
    }

    const normalizeCixFilename = (value: string) => {
      const basename = value.trim().split(/[\\/]/).pop() || "";
      if (!basename) return "";
      return /\.(?:cix|cid|txt)$/i.test(basename) ? basename : `${basename}.cix`;
    };
    const face0Filename = normalizeCixFilename(cixColumn !== undefined ? cellAt(cixColumn) : "");
    const face6Filename = normalizeCixFilename(cixFace6Column !== undefined ? cellAt(cixFace6Column) : "");
    const cixReferenceExplicit = !!face0Filename;
    const cixReferenceFace6Explicit = !!face6Filename;
    const generatedBarcode = `${cabinetName.replace(/[^a-zA-Z0-9]/g, "_")}_${partName.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const barcodeRef = face0Filename || face6Filename || generatedBarcode;
    const barcode = barcodeRef.replace(/\.(?:cix|cid|txt)$/i, "").trim();
    const partSerial = partSerialColumn !== undefined ? cellAt(partSerialColumn).trim() : "";
    const cab = ensureCabinet(cabinetName);
    const csvProjectName = cellAt(projectColumn);
    if (csvProjectName && !diagnostics.projectNames.includes(csvProjectName)) {
      diagnostics.projectNames.push(csvProjectName);
    }

    const edgeBanding = {
      top: mapping.edge1 !== undefined ? cellAt(mapping.edge1) : undefined,
      bottom: mapping.edge2 !== undefined ? cellAt(mapping.edge2) : undefined,
      left: mapping.edge3 !== undefined ? cellAt(mapping.edge3) : undefined,
      right: mapping.edge4 !== undefined ? cellAt(mapping.edge4) : undefined,
    };

    for (let q = 1; q <= qty; q++) {
      const partBarcode = qty > 1 ? `${barcode}-${q}` : barcode;
      const part: PolyboardPart = {
        id: `p-${partCounter++}`,
        cabinetName,
        name: qty > 1 ? `${partName} (#${q})` : partName,
        material: material || "Standard MFC",
        quantity: 1,
        length,
        width,
        thickness,
        cixFilename: face0Filename || face6Filename || undefined,
        ...(face0Filename ? { cixFilenameFace0: face0Filename } : {}),
        ...(face6Filename ? { cixFilenameFace6: face6Filename } : {}),
        ...(woodtekColumns ? { cixFace0Expected: !!face0Filename, cixFace6Expected: !!face6Filename } : {}),
        cixReferenceExplicit,
        cixReferenceFace6Explicit,
        ...(partSerial ? { partSerial } : {}),
        barcode: partBarcode,
        isScanned: false,
        edgeBanding,
      };
      if (mapping.grain !== undefined) part.grain = Math.round(toNumber(cellAt(mapping.grain)));

      cab.parts.push(part);
      allParts.push(part);
      diagnostics.rowsParsed++;
    }
  });

  const skippedWithCix = diagnostics.skippedRows.filter((row) => row.cix);
  if (skippedWithCix.length > 0) {
    diagnostics.warnings.push(
      `${skippedWithCix.length} line(s) naming a CIX file in column 14 or 15 were not imported as parts: ` +
        skippedWithCix.slice(0, 8).map((row) => `line ${row.line} (${row.cix})`).join(", ") +
        (skippedWithCix.length > 8 ? "…" : "") + ".",
    );
  }


  // 4. Report how the parts were grouped per cabinet.
  if (cabinetColumn !== undefined) {
    diagnostics.cabinetGrouping = inferred.includes("cabinet") ? "blocks" : "column";
  } else if (usedSections) {
    diagnostics.cabinetGrouping = "sections";
  } else {
    diagnostics.cabinetGrouping = "single";
  }

  if (diagnostics.cabinetGrouping === "single" && cabinetsMap.size <= 1) {
    diagnostics.warnings.push(
      "No cabinet / model column was found in the cutting list, so all parts were loaded as one cabinet. " +
        "To split them automatically, add the cabinet field in Polyboard: Cutting list > Cutting list options > Format.",
    );
  }
  if (diagnostics.cabinetGrouping === "blocks") {
    diagnostics.warnings.push(
      `Cabinet names were inferred from the "${
        labels.cabinet || "first text column"
      }" column. Check the cabinet list, or add the cabinet field in Polyboard (Cutting list > Cutting list options > Format) for a guaranteed split.`,
    );
  }

  if (woodtekColumns && diagnostics.projectNames.length === 0) {
    diagnostics.warnings.push("CSV column 12 contains no project name. The entered project name or source filename will be used instead.");
  }

  // 5. Finish each cabinet: cubic size, per-role dimensions, hardware list.
  for (const cab of cabinetsMap.values()) {
    const derived = deriveCabinetDimensions(cab);
    const layout = buildCabinetLayout(cab);
    cab.parts.forEach((part, index) => {
      const size = layout.placements[index]?.size;
      if (size) {
        if (!(part.length > 0)) part.length = Math.round(size.length);
        if (!(part.width > 0)) part.width = Math.round(size.width);
        if (!(part.thickness > 0)) part.thickness = Math.round(size.thickness);
      }
      if (part.grain === undefined) part.grain = 0;
    });
    cab.width = derived.width;
    cab.height = derived.height;
    cab.depth = derived.depth;
    cab.hardware = buildHardwareChecklist(cab);
  }

  return { projectName: diagnostics.projectNames[0] || "", cabinetsMap, parts: allParts, diagnostics };
}

/** Automated hardware fittings checklist per cabinet based on its parts. */
function buildHardwareChecklist(cab: PolyboardCabinet): PolyboardHardware[] {
  let shelfCount = 0;
  let doorCount = 0;
  let drawerCount = 0;

  cab.parts.forEach((p, i) => {
    const role = classifyPartRole(p, i, cab.parts.length);
    if (role === "shelf") shelfCount++;
    if (role === "door") doorCount++;
    if (role === "drawer-front") drawerCount++;
  });

  const hw: PolyboardHardware[] = [];
  const dowelQty = Math.max(8, cab.parts.length * 2);
  hw.push({
    id: `hw-dowel-${cab.id}`,
    name: "Fluted Wooden Dowels 8x30mm",
    category: "fastener",
    quantity: dowelQty,
    cabinetName: cab.name,
    sku: "DOWEL-8X30",
  });
  hw.push({
    id: `hw-minifix-${cab.id}`,
    name: "Minifix Cam & Dowel Connectors (15mm)",
    category: "fastener",
    quantity: Math.max(4, Math.floor(cab.parts.length * 1.5)),
    cabinetName: cab.name,
    sku: "MINIFIX-15",
  });

  if (shelfCount > 0) {
    hw.push({
      id: `hw-shelf-${cab.id}`,
      name: "5mm Nickel Shelf Support Studs",
      category: "bracket",
      quantity: shelfCount * 4,
      cabinetName: cab.name,
      sku: "PIN-5MM",
    });
  }

  if (doorCount > 0) {
    hw.push({
      id: `hw-hinge-${cab.id}`,
      name: "Concealed 110° Soft-Close Hinges + Plates",
      category: "hinge",
      quantity: doorCount * 2,
      cabinetName: cab.name,
      sku: "HINGE-110-SC",
    });
    hw.push({
      id: `hw-handle-${cab.id}`,
      name: "Matt Black Bar Handle 160mm + M4 Screws",
      category: "handle",
      quantity: doorCount,
      cabinetName: cab.name,
      sku: "HNDL-160-BLK",
    });
  }

  if (drawerCount > 0) {
    hw.push({
      id: `hw-slide-${cab.id}`,
      name: "Undermount Soft-Close Slides 500mm Pair",
      category: "slide",
      quantity: drawerCount,
      cabinetName: cab.name,
      sku: "SLIDE-500-SC",
    });
  }

  return hw;
}

/**
 * Parses Polyboard .pb-proj (project file) or .pb-cab text content
 */
export function parsePolyboardProjectFile(content: string, filename: string = ""): {
  projectName: string;
  cabinets: Array<{
    name: string;
    width: number;
    height: number;
    depth: number;
    quantity: number;
  }>;
} {
  const stripped = (content || "").replace(/^\uFEFF/, "");
  const projectName = filename.replace(/\.pb-proj$/i, "").replace(/[-_]/g, " ").trim() || "Polyboard Project";
  const cabinets: Array<{
    name: string;
    width: number;
    height: number;
    depth: number;
    quantity: number;
  }> = [];

  if (!stripped || /[\u0000-\u0008\u000E-\u001F]/.test(stripped.slice(0, 512))) {
    // Binary / non text project file: keep the filename as the project name and
    // let the cutting list drive the cabinet list.
    return { projectName, cabinets };
  }

  const lines = stripped.split(/\r\n|\r|\n/);
  let currentCab: { name: string; width: number; height: number; depth: number; quantity: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cabMatch =
      trimmed.match(/^\[Cabinet:?\s*([^\]]+)\]/i) ||
      trimmed.match(/^Cabinet\s*=\s*(.+)/i) ||
      trimmed.match(/^Model\s*[:=]\s*(.+)/i) ||
      trimmed.match(/^Meuble\s*[:=]\s*(.+)/i) ||
      trimmed.match(/<Cabinet\s+name="([^"]+)"/i);
    if (cabMatch) {
      if (currentCab) cabinets.push(currentCab);
      currentCab = {
        name: cabMatch[1].trim(),
        width: 0,
        height: 0,
        depth: 0,
        quantity: 1,
      };
      continue;
    }

    if (currentCab) {
      const dimMatch = trimmed.match(/(?:Dimensions|Dimension|Dim|Size|Taille|Abmessungen)\s*=\s*([0-9.]+)\s*[,xX;*]\s*([0-9.]+)\s*[,xX;*]\s*([0-9.]+)/i);
      if (dimMatch) {
        currentCab.width = parseFloat(dimMatch[1]) || currentCab.width;
        currentCab.height = parseFloat(dimMatch[2]) || currentCab.height;
        currentCab.depth = parseFloat(dimMatch[3]) || currentCab.depth;
      }
      const wMatch = trimmed.match(/(?:Width|Largeur|Breite|Ancho|Larghezza)\s*=\s*([0-9.]+)/i);
      if (wMatch) currentCab.width = parseFloat(wMatch[1]) || currentCab.width;
      const hMatch = trimmed.match(/(?:Height|Hauteur|Hohe|Altura|Altezza)\s*=\s*([0-9.]+)/i);
      if (hMatch) currentCab.height = parseFloat(hMatch[1]) || currentCab.height;
      const dMatch = trimmed.match(/(?:Depth|Profondeur|Tiefe|Profundidad|Profondita)\s*=\s*([0-9.]+)/i);
      if (dMatch) currentCab.depth = parseFloat(dMatch[1]) || currentCab.depth;
      const qMatch = trimmed.match(/(?:Quantity|Quantite|Quantita|Qty|Menge|Cantidad)\s*=\s*([0-9]+)/i);
      if (qMatch) currentCab.quantity = parseInt(qMatch[1], 10) || 1;
    }
  }

  if (currentCab) {
    cabinets.push(currentCab);
  }

  cabinets.forEach((cab) => {
    if (!(cab.width > 0)) cab.width = 600;
    if (!(cab.height > 0)) cab.height = 720;
    if (!(cab.depth > 0)) cab.depth = 560;
  });

  return { projectName, cabinets };
}

export interface PolyboardUnmatchedCix {
  filename: string;
  /** Part name stored inside the CIX header (CUSTSTR), when it has one. */
  partName?: string;
  length: number;
  width: number;
  thickness: number;
  /** False when no row of the cutting list names this file. */
  referencedInCsv: boolean;
}

export interface PolyboardMissingCix {
  reference: string;
  face: 0 | 6;
  cabinetName: string;
  partName: string;
  partSerial?: string;
}

export interface PolyboardCixLink {
  filename: string;
  face: 0 | 6;
  cabinetName: string;
  partName: string;
  partSerial?: string;
  method: PolyboardCixMatchMethod;
  length: number;
  width: number;
  thickness: number;
}

export interface PolyboardUnlinkedPart {
  cabinetName: string;
  partName: string;
  partSerial?: string;
  face: 0 | 6;
  reference: string;
  referenceExplicit: boolean;
  length: number;
  width: number;
  thickness: number;
}

export interface PolyboardSizeMatchAmbiguity {
  cabinetName: string;
  partName: string;
  partSerial?: string;
  face: 0 | 6;
  length: number;
  width: number;
  thickness: number;
  candidateFiles: string[];
}

export interface PolyboardCixMatchResult {
  /** Number of CIX file-to-face links (a part can have face-0 and face-6 programs). */
  matchedCount: number;
  partsWithCix: number;
  totalCix: number;
  unmatchedCix: string[];
  unmatchedDetails: PolyboardUnmatchedCix[];
  /** Face-specific files named in columns 14/15 that were not uploaded. */
  missingCix: PolyboardMissingCix[];
  partsWithoutCix: number;
  matchedByCabinet: Record<string, number>;
  matchedByMethod: Record<PolyboardCixMatchMethod, number>;
  /** One entry per linked face program; dimensions-only links are called out in reports. */
  links: PolyboardCixLink[];
  unlinkedParts: PolyboardUnlinkedPart[];
  /** Size-only candidates that are ambiguous across files or differently named parts. */
  ambiguousSizeMatches: PolyboardSizeMatchAmbiguity[];
}

/**
 * Canonical form of a CIX reference: basename, no extension, case-insensitive,
 * and numeric names without leading zeros, so "48", "00000048" and
 * "C:\\CNC\\00000048.CIX" are the same program (spreadsheets drop the zeros).
 */
export function canonicalCixReference(value: string | undefined): string {
  const base = (value || "").trim().split(/[\\/]/).pop() || "";
  const stem = base.replace(/\.(?:cix|cid|txt)$/i, "").trim().toLowerCase();
  return /^\d+$/.test(stem) ? stem.replace(/^0+(?=\d)/, "") : stem;
}

/**
 * Matches imported CIX files against project part faces.
 * A file is linked by, in order of confidence:
 *   1. an explicit face-specific CSV filename reference,
 *   2. the file name, barcode, or CUSTSTR part name for legacy/generic layouts,
 *   3. a unique, close match of the part's length, width and (when present)
 *      thickness. Dimensions-only matches are always marked for review.
 * A blank WoodTek face reference means no machining and is never eligible for
 * name/size matching. A nonblank reference that is not among the uploads may
 * fall back to a unique size-only candidate, while the missing reference is
 * still reported for review.
 */
export function matchCixToParts(
  cabinets: PolyboardCabinet[],
  cixFiles: Array<{ filename: string; content: string }>,
): PolyboardCixMatchResult {
  const parsedCixList = cixFiles.map((file) => parseCix(file.content, file.filename));
  const key = (value: string | undefined) => normalizeKey(value || "");
  const loose = (value: string | undefined) => normalizeText(value || "").replace(/ /g, "");
  type CixFace = 0 | 6;

  interface CixEntry {
    parsed: ParsedCixPart;
    filename: string;
    fileKeys: Set<string>;
    looseFileKeys: Set<string>;
    nameKeys: Set<string>;
    looseNameKeys: Set<string>;
    used: number;
    usedByCabinets: Set<string>;
  }

  const entries: CixEntry[] = parsedCixList.map((parsed, index) => {
    const filename = cixFiles[index].filename;
    const base = filename.replace(/\.(?:cix|cid|txt)$/i, "");
    const fileKeys = new Set<string>();
    const looseFileKeys = new Set<string>();
    const addFile = (value?: string) => {
      const normalized = key(value);
      if (normalized) fileKeys.add(normalized);
      const looseValue = loose(value);
      if (looseValue) looseFileKeys.add(looseValue);
    };
    addFile(filename);
    addFile(base);
    addFile(base.replace(/[-_ ]?\(?\d+\)?$/, ""));
    if (parsed.programName) addFile(parsed.programName);

    const nameKeys = new Set<string>();
    const looseNameKeys = new Set<string>();
    if (parsed.partName) {
      const normalized = key(parsed.partName);
      if (normalized && !fileKeys.has(normalized)) nameKeys.add(normalized);
      const looseValue = loose(parsed.partName);
      if (looseValue && !looseFileKeys.has(looseValue)) looseNameKeys.add(looseValue);
    }

    return {
      parsed,
      filename,
      fileKeys,
      looseFileKeys,
      nameKeys,
      looseNameKeys,
      used: 0,
      usedByCabinets: new Set<string>(),
    };
  });

  interface CixTarget {
    cabinet: PolyboardCabinet;
    part: PolyboardPart;
    partName: string;
    face: CixFace;
    reference: string;
    explicit: boolean;
  }

  const displayPartName = (part: PolyboardPart) => (part.name || "").replace(/\s*\(#\d+\)$/, "");
  const hasFaceData = (part: PolyboardPart, face: CixFace) => face === 0 ? !!part.cixData : !!part.cixDataFace6;
  const getTargets = (): CixTarget[] => cabinets.flatMap((cabinet) => cabinet.parts.flatMap((part) => {
    const partName = displayPartName(part);
    const faces: CixFace[] = [0, 6];
    return faces.flatMap((face) => {
      const expected = face === 0 ? part.cixFace0Expected : part.cixFace6Expected;
      const reference = face === 0
        ? (part.cixFilenameFace0 || (part.cixReferenceFace6Explicit ? "" : part.cixFilename) || "")
        : (part.cixFilenameFace6 || "");
      const explicit = face === 0
        ? !!(part.cixReferenceExplicit || part.cixFilenameFace0)
        : !!(part.cixReferenceFace6Explicit || part.cixFilenameFace6);
      if (expected === false || hasFaceData(part, face)) return [];
      // A WoodTek blank means no machining on that face. Generic imports retain
      // legacy name/size matching for face 0; face 6 only exists when declared.
      if (face === 6 && expected !== true && !reference && !explicit) return [];
      return [{ cabinet, part, partName, face, reference, explicit: explicit && !!reference }];
    });
  }));

  const targets = getTargets();
  let matchedCount = 0;
  const matchedByCabinet: Record<string, number> = {};
  const matchedByMethod: Record<PolyboardCixMatchMethod, number> = { reference: 0, name: 0, dimensions: 0 };
  const links: PolyboardCixLink[] = [];
  const declaredReferences = new Set<string>();
  const missingCix: PolyboardMissingCix[] = [];
  const missingSeen = new Set<string>();
  const sizeFallbackTargets = new Set<CixTarget>();

  const dimensionsAgreeForName = (entry: CixEntry, part: PolyboardPart): boolean => {
    const checks: Array<[number, number]> = [
      [entry.parsed.length, part.length],
      [entry.parsed.width, part.width],
    ];
    return checks.every(([fileDimension, partDimension]) => {
      if (!(fileDimension > 0) || !(partDimension > 0)) return true;
      return Math.abs(fileDimension - partDimension) <= Math.max(15, fileDimension * 0.15);
    });
  };

  /** Tight, orientation-independent comparison used only as a last-resort link. */
  const dimensionsMatchScore = (entry: CixEntry, part: PolyboardPart): number | null => {
    const fileLength = entry.parsed.length;
    const fileWidth = entry.parsed.width;
    const partLength = part.length;
    const partWidth = part.width;
    if (![fileLength, fileWidth, partLength, partWidth].every((dimension) => dimension > 0)) return null;

    const axisScore = (fileDimension: number, partDimension: number): number | null => {
      const tolerance = Math.max(2, Math.max(fileDimension, partDimension) * 0.005);
      const difference = Math.abs(fileDimension - partDimension);
      return difference <= tolerance ? difference / tolerance : null;
    };

    const directLengthScore = axisScore(fileLength, partLength);
    const directWidthScore = axisScore(fileWidth, partWidth);
    const swappedLengthScore = axisScore(fileLength, partWidth);
    const swappedWidthScore = axisScore(fileWidth, partLength);
    const direct = directLengthScore === null || directWidthScore === null
      ? null
      : directLengthScore + directWidthScore;
    const swapped = swappedLengthScore === null || swappedWidthScore === null
      ? null
      : swappedLengthScore + swappedWidthScore;
    const axisTotal = direct === null ? swapped : swapped === null ? direct : Math.min(direct, swapped);
    if (axisTotal === null) return null;

    let score = axisTotal;
    const fileThickness = entry.parsed.thickness;
    const partThickness = part.thickness;
    if (fileThickness > 0 && partThickness > 0) {
      const tolerance = Math.max(1, Math.max(fileThickness, partThickness) * 0.03);
      const difference = Math.abs(fileThickness - partThickness);
      if (difference > tolerance) return null;
      score += difference / tolerance;
    }
    return score;
  };

  const recordMatch = (
    target: CixTarget,
    entry: CixEntry,
    method: PolyboardCixMatchMethod,
  ) => {
    const { cabinet, part, partName, face } = target;
    if (face === 0) {
      part.cixData = entry.parsed;
      part.cixMatchMethod = method;
      part.cixMatchedFilenameFace0 = entry.filename;
      if (!part.cixFilenameFace0) part.cixFilenameFace0 = entry.filename;
    } else {
      part.cixDataFace6 = entry.parsed;
      part.cixMatchMethodFace6 = method;
      part.cixMatchedFilenameFace6 = entry.filename;
      if (!part.cixFilenameFace6) part.cixFilenameFace6 = entry.filename;
    }
    if (!part.cixFilename) part.cixFilename = entry.filename;
    entry.used++;
    entry.usedByCabinets.add(cabinet.name);
    matchedCount++;
    matchedByCabinet[cabinet.name] = (matchedByCabinet[cabinet.name] || 0) + 1;
    matchedByMethod[method]++;
    links.push({
      filename: entry.filename,
      face,
      cabinetName: cabinet.name,
      partName,
      ...(part.partSerial ? { partSerial: part.partSerial } : {}),
      method,
      length: part.length,
      width: part.width,
      thickness: part.thickness,
    });
    if (entry.parsed.length > 0 && !(part.length > 0)) part.length = entry.parsed.length;
    if (entry.parsed.width > 0 && !(part.width > 0)) part.width = entry.parsed.width;
    if (entry.parsed.thickness > 0 && !(part.thickness > 0)) part.thickness = entry.parsed.thickness;
    if (entry.parsed.material && (!part.material || part.material === "Standard MFC")) {
      part.material = entry.parsed.material;
    }
  };

  for (const cabinet of cabinets) matchedByCabinet[cabinet.name] = 0;

  // First honor each face's explicit CSV filename; never substitute a different
  // program just because its dimensions happen to fit.
  for (const target of targets) {
    const { cabinet, part, partName, face, reference, explicit } = target;
    const candidates = [
      reference,
      reference.replace(/\.(?:cix|cid|txt)$/i, ""),
      part.barcode,
      part.barcode.replace(/-\d+$/, ""),
      partName,
      `${cabinet.name} ${partName}`,
      `${cabinet.name}-${partName}`,
      ...(part.partSerial ? [`${cabinet.name} ${part.partSerial}`, `${cabinet.name}-${part.partSerial}`] : []),
    ].filter(Boolean);

    const scoreFor = (entry: CixEntry): number => {
      let value = 0;
      for (const candidate of candidates) {
        const normalized = key(candidate);
        const looseValue = loose(candidate);
        if (!normalized) continue;
        if (entry.fileKeys.has(normalized)) value = Math.max(value, 120);
        else if (looseValue.length >= 3 && entry.looseFileKeys.has(looseValue) && dimensionsAgreeForName(entry, part)) {
          value = Math.max(value, 100);
        } else if ((entry.nameKeys.has(normalized) || entry.looseNameKeys.has(looseValue)) && dimensionsAgreeForName(entry, part)) {
          value = Math.max(value, 80);
        } else if (
          looseValue.length >= 5 &&
          dimensionsAgreeForName(entry, part) &&
          Array.from(entry.looseFileKeys).concat(Array.from(entry.looseNameKeys)).some((other) => other.includes(looseValue) || looseValue.includes(other))
        ) {
          value = Math.max(value, 40);
        }
      }
      return value;
    };

    const declaredReference = explicit ? canonicalCixReference(reference) : "";
    const explicitEntries = explicit
      ? entries.filter((entry) =>
          canonicalCixReference(entry.filename) === declaredReference ||
          canonicalCixReference(entry.parsed.programName) === declaredReference,
        )
      : [];
    if (explicit && declaredReference) declaredReferences.add(declaredReference);

    if (explicit && explicitEntries.length === 0) {
      const missingKey = `${cabinet.name}\u0000${part.id}\u0000${face}\u0000${declaredReference}`;
      if (declaredReference && !missingSeen.has(missingKey)) {
        missingSeen.add(missingKey);
        missingCix.push({
          reference,
          face,
          cabinetName: cabinet.name,
          partName,
          ...(part.partSerial ? { partSerial: part.partSerial } : {}),
        });
      }
      // The CSV does name machining for this face, but none of the uploaded
      // files matches that reference. Let only the unique-size fallback try;
      // never replace a blank face reference this way.
      sizeFallbackTargets.add(target);
      continue;
    }

    const scored = explicit
      ? []
      : entries
          .map((entry) => ({ entry, value: scoreFor(entry) }))
          .filter((candidate) => candidate.value > 0)
          .sort((a, b) => b.value - a.value);

    let chosen: CixEntry | undefined;
    let method: PolyboardCixMatchMethod | undefined;
    if (explicit) {
      chosen = explicitEntries.find((entry) => entry.used === 0) || explicitEntries[0];
      if (chosen) method = "reference";
    } else {
      const available = scored.find((candidate) => candidate.entry.used === 0);
      if (available) {
        chosen = available.entry;
        method = "name";
      } else {
        const bestScored = scored[0];
        if (bestScored && bestScored.value >= 120) {
          chosen = bestScored.entry;
          method = "name";
        } else if (bestScored && bestScored.value >= 80 && bestScored.entry.usedByCabinets.has(cabinet.name)) {
          chosen = bestScored.entry;
          method = "name";
        }
      }
    }

    if (chosen && method) recordMatch(target, chosen, method);
  }

  // Size fallback applies only to eligible face targets (not a blank WoodTek
  // face, which explicitly means no machining) and is accepted only when unique.
  // Explicit but unavailable references are eligible for this last-resort path.
  let pendingTargets = targets.filter((target) =>
    !hasFaceData(target.part, target.face) && (!target.explicit || sizeFallbackTargets.has(target)),
  );

  const uniqueBest = <T extends object>(
    options: Array<{ item: T; score: number }>,
  ): T | null => {
    if (options.length === 0) return null;
    const sorted = options.slice().sort((a, b) => a.score - b.score);
    if (sorted.length > 1 && sorted[1].score - sorted[0].score < 0.1) return null;
    return sorted[0].item;
  };

  while (pendingTargets.length > 0) {
    const availableEntries = entries.filter((entry) => entry.used === 0);
    if (availableEntries.length === 0) break;

    const scoresByTarget = new Map<CixTarget, Array<{ item: CixEntry; score: number }>>();
    const scoresByEntry = new Map<CixEntry, Array<{ item: CixTarget; score: number }>>();
    for (const target of pendingTargets) {
      const options: Array<{ item: CixEntry; score: number }> = [];
      for (const entry of availableEntries) {
        const score = dimensionsMatchScore(entry, target.part);
        if (score === null) continue;
        options.push({ item: entry, score });
        const reverse = scoresByEntry.get(entry) || [];
        reverse.push({ item: target, score });
        scoresByEntry.set(entry, reverse);
      }
      scoresByTarget.set(target, options);
    }

    const mutualBest: Array<{ target: CixTarget; entry: CixEntry }> = [];
    for (const target of pendingTargets) {
      const bestEntry = uniqueBest(scoresByTarget.get(target) || []);
      if (!bestEntry) continue;
      const bestTarget = uniqueBest(scoresByEntry.get(bestEntry) || []);
      if (bestTarget === target) mutualBest.push({ target, entry: bestEntry });
    }

    if (mutualBest.length > 0) {
      const matchedTargets = new Set<CixTarget>();
      const matchedEntries = new Set<CixEntry>();
      for (const { target, entry } of mutualBest) {
        if (matchedTargets.has(target) || matchedEntries.has(entry) || entry.used !== 0) continue;
        recordMatch(target, entry, "dimensions");
        matchedTargets.add(target);
        matchedEntries.add(entry);
      }
      if (matchedTargets.size > 0) {
        pendingTargets = pendingTargets.filter((target) => !matchedTargets.has(target));
        continue;
      }
    }

    // One program may be reused only for repeated identical pieces in the same
    // cabinet, on the same face, with the same part label/serial/reference and dimensions.
    const repeatedPartGroups = new Map<string, CixTarget[]>();
    for (const target of pendingTargets) {
      const sortedAxes = [target.part.length, target.part.width].sort((a, b) => a - b);
      const groupKey = [
        normalizeKey(target.cabinet.name),
        normalizeKey(target.partName),
        normalizeKey(target.part.partSerial || ""),
        target.explicit ? canonicalCixReference(target.reference) : "",
        target.face,
        sortedAxes.join("x"),
        target.part.thickness,
      ].join("\u0000");
      const group = repeatedPartGroups.get(groupKey) || [];
      group.push(target);
      repeatedPartGroups.set(groupKey, group);
    }

    const repeatedGroupsMatched = new Set<CixTarget>();
    for (const group of repeatedPartGroups.values()) {
      if (group.length < 2) continue;
      const groupMembers = new Set(group);
      const groupEntries = availableEntries.filter((entry) =>
        entry.used === 0 &&
        group.every((target) => dimensionsMatchScore(entry, target.part) !== null) &&
        !pendingTargets.some((target) =>
          !groupMembers.has(target) && dimensionsMatchScore(entry, target.part) !== null,
        ),
      );
      if (groupEntries.length !== 1) continue;
      const [entry] = groupEntries;
      for (const target of group) {
        recordMatch(target, entry, "dimensions");
        repeatedGroupsMatched.add(target);
      }
    }
    if (repeatedGroupsMatched.size > 0) {
      pendingTargets = pendingTargets.filter((target) => !repeatedGroupsMatched.has(target));
      continue;
    }

    break;
  }

  const unmatchedEntries = entries.filter((entry) => entry.used === 0);
  const unlinkedTargets = targets.filter((target) => !hasFaceData(target.part, target.face));
  const unlinkedParts: PolyboardUnlinkedPart[] = unlinkedTargets.map((target) => ({
    cabinetName: target.cabinet.name,
    partName: target.partName,
    ...(target.part.partSerial ? { partSerial: target.part.partSerial } : {}),
    face: target.face,
    reference: target.reference,
    referenceExplicit: target.explicit,
    length: target.part.length || 0,
    width: target.part.width || 0,
    thickness: target.part.thickness || 0,
  }));

  const ambiguousSizeMatches: PolyboardSizeMatchAmbiguity[] = unlinkedTargets.flatMap((target) => {
    if (target.explicit && !sizeFallbackTargets.has(target)) return [];
    const matchingEntries = entries.filter((entry) => entry.used === 0 && dimensionsMatchScore(entry, target.part) !== null);
    const contested = matchingEntries.some((entry) =>
      unlinkedTargets.some((other) =>
        other !== target &&
        (other.cabinet.name !== target.cabinet.name ||
          normalizeKey(other.partName) !== normalizeKey(target.partName) ||
          normalizeKey(other.part.partSerial || "") !== normalizeKey(target.part.partSerial || "") ||
          other.face !== target.face ||
          (target.explicit && other.explicit && canonicalCixReference(other.reference) !== canonicalCixReference(target.reference))) &&
        dimensionsMatchScore(entry, other.part) !== null,
      ),
    );
    if (matchingEntries.length < 2 && !contested) return [];
    return [{
      cabinetName: target.cabinet.name,
      partName: target.partName,
      ...(target.part.partSerial ? { partSerial: target.part.partSerial } : {}),
      face: target.face,
      length: target.part.length,
      width: target.part.width,
      thickness: target.part.thickness,
      candidateFiles: matchingEntries.map((entry) => entry.filename),
    }];
  });

  const partsWithCix = new Set<PolyboardPart>(
    cabinets.flatMap((cabinet) => cabinet.parts.filter((part) => !!part.cixData || !!part.cixDataFace6)),
  ).size;
  const expectedParts = new Set<PolyboardPart>(targets.map((target) => target.part));
  const partsWithoutCix = [...expectedParts].filter((part) => !part.cixData && !part.cixDataFace6).length;

  return {
    matchedCount,
    partsWithCix,
    totalCix: cixFiles.length,
    unmatchedCix: unmatchedEntries.map((entry) => entry.filename),
    unmatchedDetails: unmatchedEntries.map((entry) => {
      const internalName = (entry.parsed.partName || "").trim();
      return {
        filename: entry.filename,
        ...(internalName && canonicalCixReference(internalName) !== canonicalCixReference(entry.filename)
          ? { partName: internalName }
          : {}),
        length: entry.parsed.length || 0,
        width: entry.parsed.width || 0,
        thickness: entry.parsed.thickness || 0,
        referencedInCsv:
          declaredReferences.has(canonicalCixReference(entry.filename)) ||
          declaredReferences.has(canonicalCixReference(entry.parsed.programName)),
      };
    }),
    missingCix,
    partsWithoutCix,
    matchedByCabinet,
    matchedByMethod,
    links,
    unlinkedParts,
    ambiguousSizeMatches,
  };
}
