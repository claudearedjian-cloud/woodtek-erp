// ============================================================================
// Polyboard Project, Cabinet, CSV Cutting List, and Hardware Parsers
// Supports .pb-proj (Polyboard project file) and .csv/.txt cutting lists
// ----------------------------------------------------------------------------
// Real Polyboard cut list exports are configured by the user (Cutting list >
// Cutting list options > Format): they can carry a title block, any field
// order, any separator, localized field names or no header row at all. This
// parser therefore identifies the header row, matches columns by alias AND by
// content, and understands section/merged-cell layouts instead of assuming a
// fixed English column order.
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

export interface PolyboardPart {
  id: string; // unique part identifier / cix reference / barcode
  cabinetName: string;
  name: string; // e.g. "Left Side", "Right Side", "Top", "Bottom", "Shelf", "Back", "Door"
  material: string;
  quantity: number;
  length: number;    // Net / overall length (mm)
  width: number;     // Net / overall width (mm)
  thickness: number; // Net thickness (mm)
  cixFilename?: string;
  barcode: string;   // Barcode printed on part label (e.g., CIX program name or part ID)
  isScanned?: boolean;
  scannedAt?: string;
  scannedBy?: string;
  cixData?: ParsedCixPart;
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

/** Human readable report of what the importer understood from a CSV file. */
export interface PolyboardCsvDiagnostics {
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
  sectionRows: number;
  warnings: string[];
}

export interface PolyboardCsvResult {
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
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
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
  cabinet: [
    "cabinet", "cabinets", "cabinetname", "meuble", "meubles", "nomdumeuble", "nommeuble", "modele", "model", "models",
    "modell", "modello", "modelo", "unite", "unit", "units", "armoire", "armoires", "schrank", "caisson", "caissons",
    "corps", "carcass", "carcassname", "korpuss", "cuerpo", "corpo", "element", "elemento", "furniture", "item", "itemname",
    "article", "assembly", "box", "boxname", "projet", "project", "projetname", "projectname", "ensemble",
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
  options: { preferSections?: boolean } = {},
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
export function parsePolyboardCsv(csvContent: string): PolyboardCsvResult {
  const diagnostics: PolyboardCsvDiagnostics = {
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
    sectionRows: 0,
    warnings: [],
  };

  const cabinetsMap = new Map<string, PolyboardCabinet>();
  const allParts: PolyboardPart[] = [];

  const rawContent = (csvContent || "").replace(/^\uFEFF/, "");
  const lines = rawContent
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    diagnostics.warnings.push("The cutting list file is empty.");
    return { cabinetsMap, parts: allParts, diagnostics };
  }

  const delimiter = detectSeparator(lines);
  diagnostics.delimiter = delimiter.char;
  diagnostics.delimiterLabel = delimiter.label;

  const rows = lines.map((l) => parseCsvLine(l, delimiter.char));

  // 1. Find the header row: the best scoring row in the first 25 lines.
  let headerRowIndex: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
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

  // 2. Map columns (aliases first, then content inference). A section row
  // ("Caisson bas 600" on its own line) is a stronger grouping signal than a
  // guessed column, so the block-guess is skipped when sections are present.
  const dataStart = headerRowIndex === null ? 0 : headerRowIndex + 1;
  const dataRows = rows.slice(dataStart);
  const hasSectionRows = dataRows.some((cells) => {
    const filled = cells.map((c) => (c || "").trim()).filter(Boolean);
    return filled.length === 1 && isSectionLabel(filled[0]);
  });
  const { mapping, labels, inferred } = buildColumnMapping(rows, headerRowIndex, { preferSections: hasSectionRows });
  diagnostics.detectedColumns = labels;
  diagnostics.columnsInferredFromContent = inferred;

  if (headerRowIndex === null) {
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

  const cabinetColumn = mapping.cabinet;
  const partColumn = mapping.part;
  const materialColumn = mapping.material;
  const qtyColumn = mapping.qty;
  const cixColumn = mapping.cix;

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

  dataRows.forEach((cells, rowIndex) => {
    const trimmed = cells.map((c) => (c || "").trim());
    const filled = trimmed.filter(Boolean);
    if (filled.length === 0) return;

    // Repeated header (some exports repeat titles for every cabinet)
    if (filled.length >= 2 && rowHeaderScore(trimmed) >= Math.max(5, bestScore * 0.7)) {
      diagnostics.rowsSkipped++;
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
        diagnostics.rowsSkipped++;
      }
      return;
    }

    // Footer / totals rows
    if (SUMMARY_ROW.test(normalizeText(filled[0])) && trimmed.length >= 2 && trimmed.filter((c) => looksNumeric(c)).length <= 2) {
      diagnostics.rowsSkipped++;
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
      diagnostics.warnings.push(`Unusually large quantity (${qty}) on row ${dataStart + rowIndex + 1} was capped at 500.`);
      qty = 500;
    }

    const material = materialColumn !== undefined && cellAt(materialColumn) ? cellAt(materialColumn) : "";

    if (!partName && length <= 0 && width <= 0) {
      diagnostics.rowsSkipped++;
      return;
    }

    let cixRef = cixColumn !== undefined ? cellAt(cixColumn) : "";
    if (!cixRef) {
      const cleanCab = cabinetName.replace(/[^a-zA-Z0-9]/g, "_");
      const cleanPart = partName.replace(/[^a-zA-Z0-9]/g, "_");
      cixRef = `${cleanCab}_${cleanPart}`;
    }

    const barcode = cixRef.replace(/\.cix$/i, "").trim();
    const cab = ensureCabinet(cabinetName);

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
        cixFilename: cixRef.endsWith(".cix") ? cixRef : `${cixRef}.cix`,
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

  return { cabinetsMap, parts: allParts, diagnostics };
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

export interface PolyboardCixMatchResult {
  matchedCount: number;
  totalCix: number;
  unmatchedCix: string[];
  partsWithoutCix: number;
  matchedByCabinet: Record<string, number>;
}

/**
 * Matches imported CIX files against project parts.
 * A file is linked by, in order of confidence:
 *   1. its file name (with or without .cix) or its CIX program name,
 *   2. the barcode / CIX reference on the part,
 *   3. the part name stored inside the CIX header (CUSTSTR), when the sizes agree.
 * Unused files always win, and a fuzzy match can never steal a file that is
 * already serving another cabinet.
 */
export function matchCixToParts(
  cabinets: PolyboardCabinet[],
  cixFiles: Array<{ filename: string; content: string }>,
): PolyboardCixMatchResult {
  const parsedCixList = cixFiles.map((f) => parseCix(f.content, f.filename));

  const key = (value: string | undefined) => normalizeKey(value || "");
  const loose = (value: string | undefined) => normalizeText(value || "").replace(/ /g, "");

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

  const entries: CixEntry[] = parsedCixList.map((parsed, i) => {
    const filename = cixFiles[i].filename;
    const base = filename.replace(/\.cix$/i, "");
    const fileKeys = new Set<string>();
    const looseFileKeys = new Set<string>();
    const addFile = (value?: string) => {
      const k = key(value);
      if (k) fileKeys.add(k);
      const l = loose(value);
      if (l) looseFileKeys.add(l);
    };
    addFile(filename);
    addFile(base);
    addFile(base.replace(/[-_ ]?\(?\d+\)?$/, ""));
    if (parsed.programName) addFile(parsed.programName);

    const nameKeys = new Set<string>();
    const looseNameKeys = new Set<string>();
    if (parsed.partName) {
      const k = key(parsed.partName);
      if (k && !fileKeys.has(k)) nameKeys.add(k);
      const l = loose(parsed.partName);
      if (l && !looseFileKeys.has(l)) looseNameKeys.add(l);
    }

    return { parsed, filename, fileKeys, looseFileKeys, nameKeys, looseNameKeys, used: 0, usedByCabinets: new Set<string>() };
  });

  let matchedCount = 0;
  const matchedByCabinet: Record<string, number> = {};

  for (const cab of cabinets) {
    matchedByCabinet[cab.name] = matchedByCabinet[cab.name] || 0;

    for (const part of cab.parts) {
      const partName = (part.name || "").replace(/\s*\(#\d+\)$/, "");
      const candidates = [
        part.cixFilename || "",
        (part.cixFilename || "").replace(/\.cix$/i, ""),
        part.barcode,
        part.barcode.replace(/-\d+$/, ""),
        partName,
        `${cab.name} ${partName}`,
        `${cab.name}-${partName}`,
      ].filter(Boolean);

      const dimsAgree = (entry: CixEntry): boolean => {
        const checks: Array<[number, number]> = [
          [entry.parsed.length, part.length],
          [entry.parsed.width, part.width],
        ];
        return checks.every(([fileDim, partDim]) => {
          if (!(fileDim > 0) || !(partDim > 0)) return true;
          return Math.abs(fileDim - partDim) <= Math.max(15, fileDim * 0.15);
        });
      };

      const scoreFor = (entry: CixEntry): number => {
        let value = 0;
        for (const candidate of candidates) {
          const k = key(candidate);
          const l = loose(candidate);
          if (!k) continue;
          if (entry.fileKeys.has(k)) value = Math.max(value, 120);
          else if (l.length >= 3 && entry.looseFileKeys.has(l) && dimsAgree(entry)) value = Math.max(value, 100);
          else if ((entry.nameKeys.has(k) || entry.looseNameKeys.has(l)) && dimsAgree(entry)) value = Math.max(value, 80);
          else if (
            l.length >= 5 &&
            dimsAgree(entry) &&
            Array.from(entry.looseFileKeys).concat(Array.from(entry.looseNameKeys)).some((other) => other.includes(l) || l.includes(other))
          ) {
            value = Math.max(value, 40);
          }
        }
        return value;
      };

      const scored = entries
        .map((entry) => ({ entry, value: scoreFor(entry) }))
        .filter((candidate) => candidate.value > 0)
        .sort((a, b) => b.value - a.value);

      let chosen = scored.find((candidate) => candidate.entry.used === 0)?.entry;
      if (!chosen) {
        const bestScored = scored[0];
        if (bestScored && bestScored.value >= 120) chosen = bestScored.entry; // explicit reference
        else if (bestScored && bestScored.value >= 80 && bestScored.entry.usedByCabinets.has(cab.name)) {
          chosen = bestScored.entry; // identical part of the same cabinet (quantity > 1)
        }
      }

      if (chosen) {
        part.cixData = chosen.parsed;
        chosen.used++;
        chosen.usedByCabinets.add(cab.name);
        matchedCount++;
        matchedByCabinet[cab.name]++;
        if (chosen.parsed.length > 0 && !(part.length > 0)) part.length = chosen.parsed.length;
        if (chosen.parsed.width > 0 && !(part.width > 0)) part.width = chosen.parsed.width;
        if (chosen.parsed.thickness > 0 && !(part.thickness > 0)) part.thickness = chosen.parsed.thickness;
        if (chosen.parsed.material && (!part.material || part.material === "Standard MFC")) part.material = chosen.parsed.material;
      }
    }
  }

  const totalParts = cabinets.reduce((sum, c) => sum + c.parts.length, 0);
  return {
    matchedCount,
    totalCix: cixFiles.length,
    unmatchedCix: entries.filter((entry) => entry.used === 0).map((entry) => entry.filename),
    partsWithoutCix: Math.max(0, totalParts - matchedCount),
    matchedByCabinet,
  };
}
