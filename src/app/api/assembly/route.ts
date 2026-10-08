import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { readAssemblyStore, saveProject, deleteProject } from "@/lib/assemblyStorage.server";
import { parsePolyboardCsv, parsePolyboardProjectFile, matchCixToParts, type PolyboardProject } from "@/lib/polyboard";
import { SAMPLE_PB_PROJ, SAMPLE_CUTLIST_CSV, SAMPLE_CIX_FILES } from "@/lib/samplePolyboardData";
import { logAudit } from "@/lib/audit.server";

export async function GET(req: NextRequest) {
  const { user, error } = await authorize("orders:read");
  if (error) return error;

  const url = new URL(req.url);
  const projectId = url.searchParams.get("id");

  const store = readAssemblyStore();

  // If store is empty, seed demo project so the user has immediate data to test
  if (store.projects.length === 0) {
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
      cixFiles, // Array of { filename: string, content: string }
      notes,
    } = body;

    if (!csvContent && !pbProjContent) {
      return NextResponse.json(
        { error: "Please upload at least a Polyboard CSV cutting list or .pb-proj file." },
        { status: 400 }
      );
    }

    let projectName = rawProjectName?.trim() || "";
    let cabinets: any[] = [];

    // Parse CSV
    if (csvContent) {
      const { cabinetsMap } = parsePolyboardCsv(csvContent);
      cabinets = Array.from(cabinetsMap.values());
    }

    // Parse .pb-proj if provided
    if (pbProjContent) {
      const parsedProj = parsePolyboardProjectFile(pbProjContent, pbProjFilename || "");
      if (!projectName) {
        projectName = parsedProj.projectName;
      }
      // If CSV didn't provide cabinets, use pb-proj cabinets
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

    // Match CIX files if provided
    const validCixList = Array.isArray(cixFiles) ? cixFiles : [];
    if (validCixList.length > 0) {
      matchCixToParts(cabinets, validCixList);
    }

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
    logAudit(user, "assembly.import", "assembly", `Imported project "${projectName}" with ${cabinets.length} cabinets.`);

    return NextResponse.json({
      success: true,
      project: newProject,
      message: `Project "${projectName}" imported with ${cabinets.length} cabinets and ${validCixList.length} CNC CIX files.`,
    });
  } catch (err: any) {
    console.error("Assembly import error:", err);
    return NextResponse.json({ error: err.message || "Failed to import Polyboard files" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await authorize("orders:write");
  if (error) return error;

  const url = new URL(req.url);
  const projectId = url.searchParams.get("id");
  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
  }

  const ok = deleteProject(projectId);
  if (!ok) {
    return NextResponse.json({ error: "Project not found or already deleted" }, { status: 404 });
  }

  logAudit(user, "assembly.delete", "assembly", `Deleted assembly project ${projectId}`);
  return NextResponse.json({ success: true });
}
