// ============================================================================
// Dispatch flow for independent material batches — pure, client-safe.
// Rows reserve a Dispatch place at order issue and become actionable after
// their own production route finishes.
//   Service categories  -> straight to "Awaiting delivery".
//   Everything else     -> Cleaning -> QC -> Packing -> Awaiting delivery.
// Stages are stored by /api/dispatch (data/dispatch-status.json).
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

export type PartialDeliveryPercentResult =
  | { ok: true; percent: number }
  | { ok: false; error: string; status: 400 | 409 };

/** Validate a new cumulative partial-delivery percentage (100% needs proof). */
export function validatePartialDeliveryPercent(currentValue: unknown, requestedValue: unknown): PartialDeliveryPercentResult {
  const current = Math.max(0, Math.min(99, Math.floor(Number(currentValue) || 0)));
  const requested = Number(requestedValue);
  if (!Number.isInteger(requested) || requested < 1 || requested > 99) {
    return { ok: false, error: "Enter a whole delivery percentage from 1 to 99. Use full delivery confirmation at 100%.", status: 400 };
  }
  if (requested <= current) {
    return { ok: false, error: `Delivery is already recorded at ${current}%. Enter a higher total percentage.`, status: 409 };
  }
  return { ok: true, percent: requested };
}

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

export function dispatchBatchKey(materialBatchId: number): string {
  return `batch:${Number(materialBatchId)}`;
}

export function dispatchLegacyOrderKey(orderId: number): string {
  return `order:${Number(orderId)}`;
}

/** Parent delivery is an all-current-batches invariant, never a single-row side effect. */
export function allCurrentBatchesDelivered(
  materialBatchIds: readonly number[],
  stages: Record<string, { stage?: string } | null | undefined>,
): boolean {
  const ids = materialBatchIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 && ids.every((id) => stages[String(id)]?.stage === "delivered");
}
