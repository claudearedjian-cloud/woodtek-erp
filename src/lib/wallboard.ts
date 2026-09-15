// ============================================================================
// Wall board — the big shop-floor TV view. Pure shaping of the /api/wip
// payload (machineBoard + orderBoard + kpis) into flat rows the TV component
// renders. No fetching, no state — easy to unit-check in render-test.
// ============================================================================

export interface WallMachine {
  id: number;
  code: string;
  name: string;
  category: string;
  state: string;
  currentOrder: string | null;
  currentClient: string | null;
  currentOperation: string | null;
  currentStartMs: number | null;
  queued: number;
  queueMinutes: number;
}

export interface WallOrder {
  orderNumber: string;
  title: string;
  client: string | null;
  status: string;
  priority: string;
  progressPercent: number;
  completedSteps: number;
  totalSteps: number;
}

export interface WallBoard {
  generatedAt: string;
  machines: WallMachine[];
  orders: WallOrder[];
  kpis: { running: number; idle: number; down: number; activeOrders: number };
}

export function buildWallBoard(payload: unknown): WallBoard {
  const data = (payload ?? {}) as Record<string, any>;
  const machineBoard = Array.isArray(data.machineBoard) ? data.machineBoard : [];
  const orderBoard = Array.isArray(data.orderBoard) ? data.orderBoard : [];
  const kpis = (data.kpis ?? {}) as Record<string, any>;

  const machines: WallMachine[] = machineBoard.map((m: Record<string, any>) => {
    const job = (m.currentJob ?? null) as Record<string, any> | null;
    const startedRaw = job ? new Date(job.startTime ?? job.startedAt ?? null).getTime() : NaN;
    return {
      id: Number(m.id),
      code: String(m.code ?? ""),
      name: String(m.name ?? ""),
      category: String(m.category ?? ""),
      state: String(m.state ?? "Idle"),
      currentOrder: job ? String(job.orderNumber ?? "") || null : null,
      currentClient: job ? (job.customerName ?? job.customerCompany ?? null) : null,
      currentOperation: job ? String(job.operationName ?? "") || null : null,
      currentStartMs: Number.isFinite(startedRaw) ? startedRaw : null,
      queued: Array.isArray(m.queue) ? m.queue.length : 0,
      queueMinutes: Number(m.queueMinutes) || 0,
    };
  });

  const orders: WallOrder[] = orderBoard.map((o: Record<string, any>) => ({
    orderNumber: String(o.orderNumber ?? ""),
    title: String(o.title ?? ""),
    client: o.customerName ?? null,
    status: String(o.status ?? ""),
    priority: String(o.priority ?? "Normal"),
    progressPercent: Number(o.progressPercent) || 0,
    completedSteps: Number(o.completedSteps) || 0,
    totalSteps: Number(o.totalSteps) || 0,
  }));

  return {
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
    machines,
    orders,
    kpis: {
      running: Number(kpis.runningStations) || 0,
      idle: Number(kpis.idleStations) || 0,
      down: Number(kpis.machinesDown) || 0,
      activeOrders: Number(kpis.activeOrders) || 0,
    },
  };
}
