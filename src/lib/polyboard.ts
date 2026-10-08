// ============================================================================
// Polyboard Project, Cabinet, CSV Cutting List, and Hardware Parsers
// Supports .pb-proj (Polyboard project file) and .csv cutting lists
// ============================================================================

import { parseCix, type ParsedCixPart } from "./cixParser";

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

/**
 * Splits CSV lines safely handling quotes and commas/semicolons/tabs
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

/**
 * Detect the separator in CSV (comma, semicolon, or tab)
 */
function detectSeparator(headerLine: string): string {
  const commas = (headerLine.match(/,/g) || []).length;
  const semicolons = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;

  if (semicolons > commas && semicolons > tabs) return ";";
  if (tabs > commas && tabs > semicolons) return "\t";
  return ",";
}

/**
 * Normalizes header string for fuzzy matching
 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parses Polyboard cutting list CSV
 */
export function parsePolyboardCsv(csvContent: string): {
  cabinetsMap: Map<string, PolyboardCabinet>;
  parts: PolyboardPart[];
} {
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { cabinetsMap: new Map(), parts: [] };
  }

  const delimiter = detectSeparator(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);

  // Column finder helpers
  const findCol = (...candidates: string[]): number => {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colCabinet = findCol("cabinet", "meuble", "assembly", "box", "unit");
  const colPart = findCol("part", "piece", "nom", "name", "description", "label");
  const colMaterial = findCol("material", "materiau", "mat", "panel");
  const colQty = findCol("qty", "quantite", "quantity", "qte", "count");
  const colLength = findCol("length", "longueur", "len", "height", "hauteur", "lpx");
  const colWidth = findCol("width", "largeur", "larg", "lpy");
  const colThickness = findCol("thickness", "epaisseur", "thk", "thick", "epais", "lpz");
  const colCix = findCol("cix", "barcode", "codebarre", "reference", "ref", "program", "programme", "file");
  const colEdge1 = findCol("edge1", "chant1", "edgetop", "edge_top");
  const colEdge2 = findCol("edge2", "chant2", "edgebottom", "edge_bot");
  const colEdge3 = findCol("edge3", "chant3", "edgeleft", "edge_left");
  const colEdge4 = findCol("edge4", "chant4", "edgeright", "edge_right");

  const cabinetsMap = new Map<string, PolyboardCabinet>();
  const allParts: PolyboardPart[] = [];

  let partCounter = 1;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const cols = parseCsvLine(rawLine, delimiter);
    if (cols.length < 2) continue;

    const cabinetName = (colCabinet !== -1 && cols[colCabinet]) ? cols[colCabinet].trim() : "Cabinet 1";
    const partName = (colPart !== -1 && cols[colPart]) ? cols[colPart].trim() : `Part ${partCounter}`;
    const material = (colMaterial !== -1 && cols[colMaterial]) ? cols[colMaterial].trim() : "Standard MFC";
    const qty = (colQty !== -1 && parseInt(cols[colQty], 10)) ? parseInt(cols[colQty], 10) : 1;
    const length = (colLength !== -1 && parseFloat(cols[colLength])) ? parseFloat(cols[colLength]) : 700;
    const width = (colWidth !== -1 && parseFloat(cols[colWidth])) ? parseFloat(cols[colWidth]) : 400;
    const thickness = (colThickness !== -1 && parseFloat(cols[colThickness])) ? parseFloat(cols[colThickness]) : 18;

    let cixRef = (colCix !== -1 && cols[colCix]) ? cols[colCix].trim() : "";
    if (!cixRef) {
      const cleanCab = cabinetName.replace(/[^a-zA-Z0-9]/g, "_");
      const cleanPart = partName.replace(/[^a-zA-Z0-9]/g, "_");
      cixRef = `${cleanCab}_${cleanPart}`;
    }

    const barcode = cixRef.replace(/\.cix$/i, "").trim();

    // Edgebanding
    const edgeBanding = {
      top: colEdge1 !== -1 ? cols[colEdge1]?.trim() : "1.0mm PVC",
      bottom: colEdge2 !== -1 ? cols[colEdge2]?.trim() : "1.0mm PVC",
      left: colEdge3 !== -1 ? cols[colEdge3]?.trim() : "0.4mm Melamine",
      right: colEdge4 !== -1 ? cols[colEdge4]?.trim() : "0.4mm Melamine",
    };

    // Ensure cabinet exists
    if (!cabinetsMap.has(cabinetName)) {
      cabinetsMap.set(cabinetName, {
        id: `cab-${cabinetName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        name: cabinetName,
        width: 600,
        height: 720,
        depth: 560,
        quantity: 1,
        parts: [],
        hardware: [],
        isReadyForAssembly: false,
      });
    }

    const cab = cabinetsMap.get(cabinetName)!;

    for (let q = 1; q <= qty; q++) {
      const partBarcode = qty > 1 ? `${barcode}-${q}` : barcode;

      const part: PolyboardPart = {
        id: `p-${partCounter++}`,
        cabinetName,
        name: qty > 1 ? `${partName} (#${q})` : partName,
        material,
        quantity: 1,
        length,
        width,
        thickness,
        cixFilename: cixRef.endsWith(".cix") ? cixRef : `${cixRef}.cix`,
        barcode: partBarcode,
        isScanned: false,
        edgeBanding,
      };

      cab.parts.push(part);
      allParts.push(part);
    }
  }

  // Generate automated hardware fittings checklist per cabinet based on its parts
  for (const cab of cabinetsMap.values()) {
    let maxL = 0;
    let maxW = 0;
    let shelfCount = 0;
    let doorCount = 0;
    let drawerCount = 0;

    for (const p of cab.parts) {
      if (p.length > maxL) maxL = p.length;
      if (p.width > maxW) maxW = p.width;
      const lower = p.name.toLowerCase();
      if (lower.includes("shelf")) shelfCount++;
      if (lower.includes("door")) doorCount++;
      if (lower.includes("drawer")) drawerCount++;
    }
    if (maxL > 0) cab.height = maxL;
    if (maxW > 0) cab.width = maxW;

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

    cab.hardware = hw;
  }

  return { cabinetsMap, parts: allParts };
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
  const projectName = filename.replace(/\.pb-proj$/i, "").replace(/[-_]/g, " ") || "Polyboard Project";
  const cabinets: Array<{
    name: string;
    width: number;
    height: number;
    depth: number;
    quantity: number;
  }> = [];

  const lines = content.split(/\r?\n/);
  let currentCab: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cabMatch = trimmed.match(/^\[Cabinet:?\s*([^\]]+)\]/i) || trimmed.match(/^Cabinet\s*=\s*(.+)/i) || trimmed.match(/<Cabinet\s+name="([^"]+)"/i);
    if (cabMatch) {
      if (currentCab) cabinets.push(currentCab);
      currentCab = {
        name: cabMatch[1].trim(),
        width: 600,
        height: 720,
        depth: 560,
        quantity: 1,
      };
      continue;
    }

    if (currentCab) {
      const dimMatch = trimmed.match(/(?:Dimensions|Dim|Size)\s*=\s*([0-9.]+)\s*[,xX;]\s*([0-9.]+)\s*[,xX;]\s*([0-9.]+)/i);
      if (dimMatch) {
        currentCab.width = parseFloat(dimMatch[1]) || currentCab.width;
        currentCab.height = parseFloat(dimMatch[2]) || currentCab.height;
        currentCab.depth = parseFloat(dimMatch[3]) || currentCab.depth;
      }
      const wMatch = trimmed.match(/(?:Width|Largeur)\s*=\s*([0-9.]+)/i);
      if (wMatch) currentCab.width = parseFloat(wMatch[1]) || currentCab.width;
      const hMatch = trimmed.match(/(?:Height|Hauteur)\s*=\s*([0-9.]+)/i);
      if (hMatch) currentCab.height = parseFloat(hMatch[1]) || currentCab.height;
      const dMatch = trimmed.match(/(?:Depth|Profondeur)\s*=\s*([0-9.]+)/i);
      if (dMatch) currentCab.depth = parseFloat(dMatch[1]) || currentCab.depth;
      const qMatch = trimmed.match(/(?:Quantity|Quantite|Qty)\s*=\s*([0-9]+)/i);
      if (qMatch) currentCab.quantity = parseInt(qMatch[1], 10) || 1;
    }
  }

  if (currentCab) {
    cabinets.push(currentCab);
  }

  if (cabinets.length === 0) {
    cabinets.push({
      name: projectName,
      width: 800,
      height: 720,
      depth: 560,
      quantity: 1,
    });
  }

  return { projectName, cabinets };
}

/**
 * Matches imported CIX files against project parts
 */
export function matchCixToParts(
  cabinets: PolyboardCabinet[],
  cixFiles: Array<{ filename: string; content: string }>,
): {
  matchedCount: number;
  totalCix: number;
} {
  const parsedCixList = cixFiles.map(f => parseCix(f.content, f.filename));
  const cixByName = new Map<string, ParsedCixPart>();

  for (const cix of parsedCixList) {
    cixByName.set(cix.filename.toLowerCase(), cix);
    cixByName.set(cix.filename.replace(/\.cix$/i, "").toLowerCase(), cix);
    if (cix.programName) {
      cixByName.set(cix.programName.toLowerCase(), cix);
    }
    if (cix.partName) {
      cixByName.set(cix.partName.toLowerCase(), cix);
    }
  }

  let matchedCount = 0;

  for (const cab of cabinets) {
    for (const part of cab.parts) {
      const candidates = [
        part.cixFilename?.toLowerCase() || "",
        part.barcode.toLowerCase(),
        part.id.toLowerCase(),
        part.name.toLowerCase(),
        `${cab.name}_${part.name}`.toLowerCase(),
      ].filter(Boolean);

      let found: ParsedCixPart | undefined;
      for (const cand of candidates) {
        if (cixByName.has(cand)) {
          found = cixByName.get(cand);
          break;
        }
        if (cixByName.has(`${cand}.cix`)) {
          found = cixByName.get(`${cand}.cix`);
          break;
        }
      }

      if (!found) {
        for (const [key, cix] of cixByName.entries()) {
          const cleanPartName = part.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const cleanKey = key.replace(/[^a-z0-9]/g, "");
          if (cleanKey.includes(cleanPartName) || cleanPartName.includes(cleanKey)) {
            found = cix;
            break;
          }
        }
      }

      if (found) {
        part.cixData = found;
        if (found.length > 0 && part.length === 0) part.length = found.length;
        if (found.width > 0 && part.width === 0) part.width = found.width;
        if (found.thickness > 0 && part.thickness === 0) part.thickness = found.thickness;
        if (found.material && !part.material) part.material = found.material;
        matchedCount++;
      }
    }
  }

  return { matchedCount, totalCix: cixFiles.length };
}
