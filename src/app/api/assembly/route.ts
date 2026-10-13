import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import {
  assemblyStoreExists,
  readAssemblyStore,
  saveProject,
  updateProjectDetails,
  deleteProject,
} from "@/lib/assemblyStorage.server";
import { parseAssemblyProjectDetails } from "@/lib/assemblyProject";
import {
  parsePolyboardCsv,
  parsePolyboardProjectFile,
  matchCixToParts,
  type PolyboardCsvDiagnostics,
  type PolyboardCixMatchResult,
  type PolyboardProject,
  type PolyboardCabinet,
} from "@/lib/polyboard";
import { SAMPLE_PB_PROJ, SAMPLE_CUTLIST_CSV, SAMPLE_CIX_FILES } from "@/lib/samplePolyboardData";
import { logAudit } from "@/lib/audit.server";

export async function GET(req: NextRequest) {
  const { error } = await authorize("orders:read");
  if (error) return error;

  const url = new URL(req.url);
  const projectId = url.searchParams.get("id");

  const store = readAssemblyStore();

  // Seed only on first use, never after the user deletes the last project.
  if (store.projects.length === 0 && !assemblyStoreExists()) {
    const { projectName } = parsePolyboardProjectFile(SAMPLE_PB_PROJ, "Kitchen-Villa-42.pb-proj");
    const { cabinetsMap } = parsePolyboardCsv(SAMPLE_CUTLIST_CSV);
    const cabinets = Array.from(cabinetsMap.values());

    // Match CIX files
    const cixList = Object.entries(SAMPLE_CIX_FILES).map(([filename, content]) => ({
      filename,
      content,
    }));
    matchCixToParts(cabinets, cixList);

    const demoProject: PolyboardProject = {
      id: "polyboard-demo-villa-42",
      name: projectName || "Villa 42 Kitchen Cabinets",
      importedAt: new Date().toISOString(),
      importedBy: "Demo System",
      notes: "Sample Polyboard project with CNC Biesse Rover A CIX machine files and CSV cutting list.",
      sourceFiles: {
        pbProjName: "Kitchen-Villa-42.pb-proj",
        csvName: "Kitchen-Villa-42-cutlist.csv",
        cixFiles: Object.keys(SAMPLE_CIX_FILES),
      },
      cabinets,
    };
    saveProject(demoProject);
    store.projects.push(demoProject);
  }

  if (projectId) {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  }

  return NextResponse.json({ projects: store.projects });
}

export async function POST(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  try {
    const body = await req.json();
    const {
      projectName: rawProjectName,
      pbProjContent,
      pbProjFilename,
      csvContent,
      csvFilename,
      csvLayout,
      cixFiles, // Array of { filename: string, content: string }
      notes,
    } = body;

    if (!csvContent && !pbProjContent) {
      return NextResponse.json(
        { error: "Please upload at least a Polyboard CSV cutting list or .pb-proj file." },
        { status: 400 }
      );
    }

    if (csvLayout !== undefined && csvLayout !== "woodtek" && csvLayout !== "auto") {
      return NextResponse.json({ error: "Invalid CSV layout" }, { status: 400 });
    }

    let projectName = typeof rawProjectName === "string" ? rawProjectName.trim() : "";
    let cabinets: PolyboardCabinet[] = [];
    let csvDiagnostics: PolyboardCsvDiagnostics | null = null;

    // Parse the cutting list (CSV/TXT export)
    if (csvContent) {
      const parsedCsv = parsePolyboardCsv(csvContent, { layout: csvLayout });
      if (parsedCsv.diagnostics.projectNames.length > 1) {
        return NextResponse.json({
          error: "The cutting list contains multiple project names. Export and import one project at a time to avoid mixing cabinets.",
        }, { status: 400 });
      }
      if (!projectName) projectName = parsedCsv.projectName;
      cabinets = Array.from(parsedCsv.cabinetsMap.values());
      csvDiagnostics = parsedCsv.diagnostics;
    }

    // Parse .pb-proj if provided (project-name fallback after CSV column 12; when the
    // cutting list has no cabinet breakdown at all, for the cabinet list)
    let pbProjCabinetCount = 0;
    if (pbProjContent) {
      const parsedProj = parsePolyboardProjectFile(pbProjContent, pbProjFilename || "");
      pbProjCabinetCount = parsedProj.cabinets.length;
      if (!projectName) {
        projectName = parsedProj.projectName;
      }
      if (cabinets.length === 0) {
        cabinets = parsedProj.cabinets.map((c, idx) => ({
          id: `cab-${idx + 1}`,
          name: c.name,
          width: c.width,
          height: c.height,
          depth: c.depth,
          quantity: c.quantity,
          parts: [],
          isReadyForAssembly: false,
        }));
      }
    }

    if (!projectName) {
      projectName = (csvFilename || pbProjFilename || "Polyboard Project").replace(/\.[^/.]+$/, "");
    }

    // A cutting list without any cabinet identification loads as one cabinet:
    // name it after the project so the list stays readable.
    if (cabinets.length === 1 && csvDiagnostics && csvDiagnostics.cabinetGrouping === "single") {
      cabinets[0].name = projectName || cabinets[0].name;
    }

    // Match CIX files if provided
    const validCixList = Array.isArray(cixFiles) ? cixFiles : [];
    let cixMatch: PolyboardCixMatchResult | null = null;
    cixMatch = matchCixToParts(cabinets, validCixList);

    const totalParts = cabinets.reduce((sum, cabinet) => sum + cabinet.parts.length, 0);

    const projectId = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newProject: PolyboardProject = {
      id: projectId,
      name: projectName,
      importedAt: new Date().toISOString(),
      importedBy: user.name,
      notes: notes || undefined,
      sourceFiles: {
        pbProjName: pbProjFilename,
        csvName: csvFilename,
        cixFiles: validCixList.map((f: any) => f.filename),
      },
      cabinets,
    };

    saveProject(newProject);
    logAudit(
      user,
      "assembly.import",
      "assembly",
      `Imported project "${projectName}" with ${cabinets.length} cabinets and ${totalParts} parts.`,
    );

    const warnings: string[] = [...(csvDiagnostics?.warnings || [])];
    if (cixMatch && cixMatch.unmatchedCix.length > 0) {
      const describe = (file: PolyboardCixMatchResult["unmatchedDetails"][number]) => {
        const size = file.length > 0 && file.width > 0
          ? ` ${Math.round(file.length)}×${Math.round(file.width)}${file.thickness > 0 ? `×${Math.round(file.thickness)}` : ""}`
          : "";
        const inside = file.partName || size ? ` (${[file.partName, size.trim()].filter(Boolean).join(" ")})` : "";
        return `${file.filename}${inside}`;
      };
      const notInCsv = cixMatch.unmatchedDetails.filter((file) => !file.referencedInCsv);
      const otherUnlinked = cixMatch.unmatchedDetails.filter((file) => file.referencedInCsv);
      const list = (files: typeof notInCsv) => `${files.slice(0, 8).map(describe).join(", ")}${files.length > 8 ? "…" : ""}`;
      if (notInCsv.length > 0) {
        warnings.push(
          `${notInCsv.length} CIX file(s) are not named in column 14 or 15 of any imported cutting-list row: ${list(notInCsv)}. ` +
            "They were left unassigned: CIX operation contents are not used to infer links, blank WoodTek face references mean no machining, and ambiguous size candidates stay unassigned.",
        );
      }
      if (otherUnlinked.length > 0) {
        warnings.push(`Not linked to any part/face: ${list(otherUnlinked)}`);
      }
    }
    if (cixMatch && cixMatch.matchedByMethod.dimensions > 0) {
      const sizeLinks = cixMatch.links.filter((link) => link.method === "dimensions");
      const describe = (link: (typeof sizeLinks)[number]) => {
        const size = link.length > 0 && link.width > 0
          ? ` (${Math.round(link.length)}×${Math.round(link.width)}${link.thickness > 0 ? `×${Math.round(link.thickness)}` : ""})`
          : "";
        const serial = link.partSerial ? ` #${link.partSerial}` : "";
        return `${link.filename} → ${link.cabinetName} / ${link.partName}${serial} (face ${link.face})${size}`;
      };
      warnings.push(
        `${sizeLinks.length} CIX link(s) were attached by a unique size-only fallback without a matching uploaded face-specific filename; review the cabinet/part association: ` +
          `${sizeLinks.slice(0, 8).map(describe).join(", ")}${sizeLinks.length > 8 ? "…" : ""}.`,
      );
    }
    if (cixMatch && cixMatch.ambiguousSizeMatches.length > 0) {
      const ambiguous = cixMatch.ambiguousSizeMatches;
      const describe = (match: (typeof ambiguous)[number]) => {
        const size = match.length > 0 && match.width > 0
          ? ` ${Math.round(match.length)}×${Math.round(match.width)}${match.thickness > 0 ? `×${Math.round(match.thickness)}` : ""}`
          : "";
        const serial = match.partSerial ? ` #${match.partSerial}` : "";
        return `${match.cabinetName} / ${match.partName}${serial} (face ${match.face})${size}: ${match.candidateFiles.join(" / ")}`;
      };
      warnings.push(
        `${ambiguous.length} unlinked face(s) have non-unique size matches across files/parts, so no automatic choice was made: ` +
          `${ambiguous.slice(0, 8).map(describe).join(", ")}${ambiguous.length > 8 ? "…" : ""}.`,
      );
    }
    if (cixMatch && cixMatch.unlinkedParts.length > 0) {
      const unlinked = cixMatch.unlinkedParts.filter((part) => !part.referenceExplicit);
      const describe = (part: (typeof unlinked)[number]) => {
        const size = part.length > 0 && part.width > 0
          ? ` (${Math.round(part.length)}×${Math.round(part.width)}${part.thickness > 0 ? `×${Math.round(part.thickness)}` : ""})`
          : "";
        const serial = part.partSerial ? ` #${part.partSerial}` : "";
        return `${part.cabinetName} / ${part.partName}${serial} (face ${part.face})${size}`;
      };
      if (unlinked.length > 0) {
        warnings.push(
          `${unlinked.length} eligible face(s) still have no CIX data: ${unlinked.slice(0, 8).map(describe).join(", ")}${unlinked.length > 8 ? "…" : ""}.`,
        );
      }
    }
    if (cixMatch && cixMatch.missingCix.length > 0) {
      const missing = cixMatch.missingCix;
      warnings.push(
        `${missing.length} face reference(s) name a CIX file that was not uploaded: ` +
          missing.slice(0, 8).map((m) => `${m.reference} (face ${m.face}, ${m.cabinetName} / ${m.partName}${m.partSerial ? ` #${m.partSerial}` : ""})`).join(", ") +
          (missing.length > 8 ? "…" : "") + ".",
      );
    }
    if (cabinets.length === 0) {
      warnings.push("No parts were found in the cutting list - check the file and its separator (Polyboard: Cutting list > Cutting list options > Format).");
    }

    return NextResponse.json({
      success: true,
      project: newProject,
      message: `Project "${projectName}" imported with ${cabinets.length} cabinet${cabinets.length === 1 ? "" : "s"}, ${totalParts} parts and ${validCixList.length} CNC CIX file${validCixList.length === 1 ? "" : "s"}.`,
      diagnostics: {
        csv: csvDiagnostics,
        cix: cixMatch,
        pbProjCabinetCount,
        totalParts,
        warnings,
      },
    });
  } catch (err: any) {
    console.error("Assembly import error:", err);
    return NextResponse.json({ error: err.message || "Failed to import Polyboard files" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  const projectId = new URL(req.url).searchParams.get("id")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid project details" }, { status: 400 });
  }
  const parsed = parseAssemblyProjectDetails(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const project = updateProjectDetails(projectId, parsed.details);
    if (!project) {
      return NextResponse.json({ error: "Project not found or already deleted" }, { status: 404 });
    }

    logAudit(user, "assembly.edit", "assembly", `Updated assembly project "${project.name}"`, project.id);
    return NextResponse.json({ success: true, project });
  } catch (err: unknown) {
    console.error("Assembly project update error:", err);
    return NextResponse.json({ error: "Failed to save project changes" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  const projectId = new URL(req.url).searchParams.get("id")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
  }

  try {
    const ok = deleteProject(projectId);
    if (!ok) {
      return NextResponse.json({ error: "Project not found or already deleted" }, { status: 404 });
    }

    logAudit(user, "assembly.delete", "assembly", `Deleted assembly project ${projectId}`, projectId);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("Assembly project deletion error:", err);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
