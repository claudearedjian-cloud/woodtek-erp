// Editable assembly metadata only. Imported geometry, CNC data, scan history and
// ERP order links are deliberately not accepted from the project edit form.
export const ASSEMBLY_PROJECT_NAME_MAX = 200;
export const ASSEMBLY_PROJECT_NOTES_MAX = 5000;

export interface AssemblyProjectDetails {
  name: string;
  /** Omitted notes are left unchanged; an empty string clears them. */
  notes?: string;
}

export function parseAssemblyProjectDetails(input: unknown):
  | { ok: true; details: AssemblyProjectDetails }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Project details are required." };
  }

  const body = input as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name.trim()) {
    return { ok: false, error: "Please enter a project name." };
  }
  const name = body.name.trim();
  if (name.length > ASSEMBLY_PROJECT_NAME_MAX) {
    return { ok: false, error: `Project name must be ${ASSEMBLY_PROJECT_NAME_MAX} characters or fewer.` };
  }

  if (body.notes !== undefined && typeof body.notes !== "string") {
    return { ok: false, error: "Project notes must be text." };
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;
  if (notes !== undefined && notes.length > ASSEMBLY_PROJECT_NOTES_MAX) {
    return { ok: false, error: `Project notes must be ${ASSEMBLY_PROJECT_NOTES_MAX} characters or fewer.` };
  }

  return { ok: true, details: { name, ...(notes !== undefined ? { notes } : {}) } };
}
