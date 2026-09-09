// ============================================================================
// Dispatch flow for completed orders — pure, client-safe.
//   Service categories  -> straight to "Awaiting delivery".
//   Everything else     -> Cleaning -> QC -> Packing -> Awaiting delivery.
// The stage itself is stored by /api/dispatch (data/dispatch-status.json).
// ============================================================================

export type DispatchStage = "cleaning" | "qc" | "packing" | "awaiting_delivery" | "delivered";

export const PROJECT_FLOW: DispatchStage[] = ["cleaning", "qc", "packing", "awaiting_delivery", "delivered"];
export const SERVICE_FLOW: DispatchStage[] = ["awaiting_delivery", "delivered"];

export const STAGE_LABELS: Record<DispatchStage, string> = {
  cleaning: "Cleaning",
  qc: "QC",
  packing: "Packing",
  awaiting_delivery: "Awaiting delivery",
  delivered: "Delivered",
};

export const ALL_STAGES: DispatchStage[] = PROJECT_FLOW;

/** Orders whose project category mentions "service" skip the prep pipeline. */
export function isServiceFlow(projectType: string | null | undefined): boolean {
  return /service/i.test(String(projectType ?? ""));
}

export function flowFor(projectType: string | null | undefined): DispatchStage[] {
  return isServiceFlow(projectType) ? SERVICE_FLOW : PROJECT_FLOW;
}

export function defaultStage(projectType: string | null | undefined): DispatchStage {
  return isServiceFlow(projectType) ? "awaiting_delivery" : "cleaning";
}

export function nextStage(
  projectType: string | null | undefined,
  stage: DispatchStage,
): DispatchStage | null {
  const flow = flowFor(projectType);
  const i = flow.indexOf(stage);
  if (i < 0 || i >= flow.length - 1) return null;
  return flow[i + 1];
}
