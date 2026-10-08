// ============================================================================
// Assembly Projects Storage (Server-Side)
// Stores imported Polyboard assembly projects atomically in data/assembly-projects.json
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import type { PolyboardProject, PolyboardCabinet, PolyboardPart } from "./polyboard";

export interface AssemblyStore {
  version: 1;
  projects: PolyboardProject[];
}

function getStoragePath(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "assembly-projects.json");
}

export function readAssemblyStore(): AssemblyStore {
  try {
    const raw = fs.readFileSync(getStoragePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.projects)) {
      return parsed as AssemblyStore;
    }
  } catch {
    /* first run or file does not exist yet */
  }
  return { version: 1, projects: [] };
}

export function writeAssemblyStore(store: AssemblyStore): void {
  writeJsonAtomic(getStoragePath(), store);
}

export function getProjectById(projectId: string): PolyboardProject | null {
  const store = readAssemblyStore();
  return store.projects.find((p) => p.id === projectId) || null;
}

export function saveProject(project: PolyboardProject): PolyboardProject {
  const store = readAssemblyStore();
  const existingIdx = store.projects.findIndex((p) => p.id === project.id);
  if (existingIdx !== -1) {
    store.projects[existingIdx] = project;
  } else {
    store.projects.unshift(project);
  }
  writeAssemblyStore(store);
  return project;
}

export function deleteProject(projectId: string): boolean {
  const store = readAssemblyStore();
  const initialLen = store.projects.length;
  store.projects = store.projects.filter((p) => p.id !== projectId);
  if (store.projects.length !== initialLen) {
    writeAssemblyStore(store);
    return true;
  }
  return false;
}

/**
 * Scan part barcode or enter manual CIX number.
 * Marks the part as available (scanned) in the cabinet, checks if all parts in
 * that cabinet are scanned, and if so marks the cabinet as ready for assembly!
 */
export function scanPart(
  projectId: string,
  cabinetId: string,
  barcodeOrCixRef: string,
  scannedBy?: string,
): {
  success: boolean;
  message: string;
  matchedPart?: PolyboardPart;
  cabinetReady: boolean;
  totalParts: number;
  scannedParts: number;
  project: PolyboardProject | null;
} {
  const store = readAssemblyStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) {
    return {
      success: false,
      message: "Project not found.",
      cabinetReady: false,
      totalParts: 0,
      scannedParts: 0,
      project: null,
    };
  }

  const cab = project.cabinets.find((c) => c.id === cabinetId);
  if (!cab) {
    return {
      success: false,
      message: "Cabinet not found in this project.",
      cabinetReady: false,
      totalParts: 0,
      scannedParts: 0,
      project,
    };
  }

  const needle = barcodeOrCixRef.trim().toLowerCase().replace(/\.cix$/i, "");
  
  // Find matching part in this cabinet (preferably unscanned first)
  let targetPart = cab.parts.find(
    (p) =>
      !p.isScanned &&
      (p.barcode.toLowerCase() === needle ||
        p.id.toLowerCase() === needle ||
        (p.cixFilename && p.cixFilename.toLowerCase().replace(/\.cix$/i, "") === needle) ||
        p.name.toLowerCase() === needle)
  );

  // If none unscanned, find already scanned matching one (for feedback)
  if (!targetPart) {
    targetPart = cab.parts.find(
      (p) =>
        p.barcode.toLowerCase() === needle ||
        p.id.toLowerCase() === needle ||
        (p.cixFilename && p.cixFilename.toLowerCase().replace(/\.cix$/i, "") === needle) ||
        p.name.toLowerCase() === needle
    );
    if (targetPart && targetPart.isScanned) {
      const scannedCount = cab.parts.filter((p) => p.isScanned).length;
      return {
        success: true,
        message: `Part "${targetPart.name}" is already marked as available.`,
        matchedPart: targetPart,
        cabinetReady: !!cab.isReadyForAssembly,
        totalParts: cab.parts.length,
        scannedParts: scannedCount,
        project,
      };
    }
  }

  // Also support partial/fuzzy match (e.g. barcode suffix or prefix)
  if (!targetPart) {
    targetPart = cab.parts.find(
      (p) =>
        !p.isScanned &&
        (p.barcode.toLowerCase().includes(needle) ||
          needle.includes(p.barcode.toLowerCase()) ||
          (p.cixFilename && p.cixFilename.toLowerCase().includes(needle)))
    );
  }

  if (!targetPart) {
    // Check if the part belongs to another cabinet in the project to give helpful feedback
    let otherCabinetName = "";
    for (const otherCab of project.cabinets) {
      if (otherCab.id !== cab.id) {
        const foundOther = otherCab.parts.find(
          (p) =>
            p.barcode.toLowerCase() === needle ||
            (p.cixFilename && p.cixFilename.toLowerCase().replace(/\.cix$/i, "") === needle) ||
            p.barcode.toLowerCase().includes(needle)
        );
        if (foundOther) {
          otherCabinetName = otherCab.name;
          break;
        }
      }
    }

    const errorMsg = otherCabinetName
      ? `Part "${barcodeOrCixRef}" belongs to "${otherCabinetName}", not this cabinet!`
      : `No matching part found for barcode/CIX "${barcodeOrCixRef}" in this cabinet.`;

    const scannedCount = cab.parts.filter((p) => p.isScanned).length;
    return {
      success: false,
      message: errorMsg,
      cabinetReady: !!cab.isReadyForAssembly,
      totalParts: cab.parts.length,
      scannedParts: scannedCount,
      project,
    };
  }

  // Mark part as scanned
  targetPart.isScanned = true;
  targetPart.scannedAt = new Date().toISOString();
  if (scannedBy) targetPart.scannedBy = scannedBy;

  // Check if all parts are now scanned
  const allScanned = cab.parts.every((p) => p.isScanned);
  if (allScanned) {
    cab.isReadyForAssembly = true;
    cab.assembledAt = new Date().toISOString();
  }

  writeAssemblyStore(store);

  const scannedCount = cab.parts.filter((p) => p.isScanned).length;
  const readyMsg = allScanned
    ? `🎉 ALL parts available! Cabinet "${cab.name}" is READY FOR ASSEMBLY!`
    : `Part "${targetPart.name}" verified (${scannedCount}/${cab.parts.length} parts ready).`;

  return {
    success: true,
    message: readyMsg,
    matchedPart: targetPart,
    cabinetReady: allScanned,
    totalParts: cab.parts.length,
    scannedParts: scannedCount,
    project,
  };
}

/**
 * Toggle or reset part scanned status
 */
export function togglePartStatus(
  projectId: string,
  cabinetId: string,
  partId: string,
  forceStatus?: boolean,
  operatorName?: string,
): {
  success: boolean;
  project: PolyboardProject | null;
  cabinetReady: boolean;
} {
  const store = readAssemblyStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return { success: false, project: null, cabinetReady: false };

  const cab = project.cabinets.find((c) => c.id === cabinetId);
  if (!cab) return { success: false, project, cabinetReady: false };

  const part = cab.parts.find((p) => p.id === partId);
  if (!part) return { success: false, project, cabinetReady: !!cab.isReadyForAssembly };

  const nextStatus = forceStatus !== undefined ? forceStatus : !part.isScanned;
  part.isScanned = nextStatus;
  if (nextStatus) {
    part.scannedAt = new Date().toISOString();
    if (operatorName) part.scannedBy = operatorName;
  } else {
    part.scannedAt = undefined;
    part.scannedBy = undefined;
  }

  const allScanned = cab.parts.every((p) => p.isScanned);
  cab.isReadyForAssembly = allScanned;
  if (allScanned) {
    cab.assembledAt = new Date().toISOString();
  } else {
    cab.assembledAt = undefined;
  }

  writeAssemblyStore(store);
  return { success: true, project, cabinetReady: allScanned };
}
