// Job costing & profitability — live PostgreSQL integration checks.
//
// Run (against a SCRATCH database only; schema from `npx drizzle-kit push`):
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/woodtek_jobcosting_test \
//     npx tsx scripts/job-costing-db-test.ts
//
// Job costing has NO tables of its own: it is a read model over orders,
// order_materials, order_operations, machines and quality_events, plus a JSON
// settings file. This suite seeds a small factory, then checks the money maths
// through the real Drizzle/pg round trip (numeric text -> cents), the scoped
// readers (a Sales user sees only their own margins), the period/scope
// filters, settings re-pricing and the legacy Order Profitability report.
//
// SAFETY: refuses to run unless the database name contains "test". The JSON
// settings file is redirected to a private temp dir (WOODTEK_DATA_DIR), so the
// factory's data/ folder is never touched. The suite deletes only its own
// DBTEST rows.
import { inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index";
import {
  customers, inventoryItems, machines, orderMaterials, orderOperations, orders, qualityEvents, users,
} from "../src/db/schema";
import { JobCostingError } from "../src/lib/jobCosting";
import {
  jobCostDetail, jobCostRowsForReport, jobCostingBoard, readJobCostSettings, writeJobCostSettings,
} from "../src/lib/jobCosting.server";
import type { SessionUser } from "../src/lib/auth";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS: job-costing-db: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: job-costing-db: ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL ?? "";
  const dbName = raw.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" does not look like a scratch database (name must contain "test").`);
  }
  const run = Date.now();
  const fs = await import("node:fs");
  const dataDir = `/tmp/woodtek-jobcosting-db-${run}`;
  process.env.WOODTEK_DATA_DIR = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });

  const orderIds: number[] = [];
  const userIds: number[] = [];
  const customerIds: number[] = [];
  const machineIds: number[] = [];
  const itemIds: number[] = [];

  try {
    // ---- fixtures ----------------------------------------------------------
    const mkUser = async (tag: string, role: string): Promise<SessionUser> => {
      const [row] = await db.insert(users).values({
        name: `DBTEST ${tag} ${run}`, email: `dbtest-jc-${tag}-${run}@example.test`, role,
      }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      userIds.push(row.id);
      return { ...row, avatarColor: "bg-amber-600" };
    };
    const mgr = await mkUser("mgr", "Manager");
    const salesOne = await mkUser("sales1", "Sales Coordinator");
    const salesTwo = await mkUser("sales2", "Sales Coordinator");

    const mkCustomer = async (tag: string, salesId: number) => {
      const [row] = await db.insert(customers).values({
        name: `DBTEST ${tag}`, company: `DBTEST Co ${tag} ${run}`, email: `c-${tag}-${run}@example.test`,
        phone: "01 000 000", address: "Beirut", assignedSalesId: salesId,
      }).returning({ id: customers.id });
      customerIds.push(row.id);
      return row.id;
    };
    const custOne = await mkCustomer("one", salesOne.id);
    const custTwo = await mkCustomer("two", salesTwo.id);

    const mkMachine = async (tag: string, rate: string) => {
      const [row] = await db.insert(machines).values({
        name: `DBTEST machine ${tag}`, code: `DBT-${tag}-${run}`, category: "Beam Saw", hourlyCost: rate,
      }).returning({ id: machines.id });
      machineIds.push(row.id);
      return row.id;
    };
    const m60 = await mkMachine("A", "60.00");
    const m120 = await mkMachine("B", "120.00");

    const mkItem = async (tag: string, cost: string) => {
      const [row] = await db.insert(inventoryItems).values({
        sku: `DBT-${tag}-${run}`, name: `DBTEST item ${tag}`, category: "Wood & MDF Panels", stockQuantity: 1000, unitCost: cost,
      }).returning({ id: inventoryItems.id });
      itemIds.push(row.id);
      return row.id;
    };
    const iOak = await mkItem("OAK", "50.00");
    const iHinge = await mkItem("HNG", "100.00");
    const iRel = await mkItem("REL", "99.00");

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const mkOrder = async (tag: string, o: { customerId: number; salesId: number; status: string; value: string; createdAt?: Date }) => {
      const [row] = await db.insert(orders).values({
        orderNumber: `DBT-${tag}-${run}`, customerId: o.customerId, title: `DBTEST job ${tag}`,
        projectType: tag === "D" ? "Wardrobe Fit-out" : "Custom Kitchens", status: o.status, totalValue: o.value,
        dueDate: new Date(Date.now() + 14 * 86_400_000), createdById: o.salesId, assignedSalesId: o.salesId,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      }).returning({ id: orders.id, orderNumber: orders.orderNumber });
      orderIds.push(row.id);
      return row;
    };

    // A — open, Sales one. The unit-test scenario: cost 114,950¢ on a $10,000 order.
    const oA = await mkOrder("A", { customerId: custOne, salesId: salesOne.id, status: "In Production", value: "10000.00" });
    await db.insert(orderMaterials).values([
      { orderId: oA.id, itemId: iOak, quantityUsed: 10, costPerUnit: "50.00", consumed: true },
      { orderId: oA.id, itemId: iHinge, quantityUsed: 2, costPerUnit: "100.00" },
      { orderId: oA.id, itemId: iRel, quantityUsed: 5, costPerUnit: "99.00", released: true },
    ]);
    await db.insert(orderOperations).values([
      { orderId: oA.id, machineId: m60, stepOrder: 1, operationName: "Cut", estimatedMinutes: 100, actualMinutes: 120, status: "Completed" },
      { orderId: oA.id, machineId: m120, stepOrder: 2, operationName: "Drill", estimatedMinutes: 30, actualMinutes: 0, status: "Completed",
        startTime: new Date("2026-09-10T08:00:00Z"), endTime: new Date("2026-09-10T08:30:00Z") },
      { orderId: oA.id, machineId: m60, stepOrder: 3, operationName: "Assemble", estimatedMinutes: 60, actualMinutes: 0, status: "Pending" },
    ]);
    await db.insert(qualityEvents).values({
      orderId: oA.id, eventType: "scrap", quantity: 2, reason: "Chipped edge", estimatedCost: "40.00", disposition: "Scrapped",
    });

    // B — finished loss-maker, Sales two: $50 order, 1 h on the $60 machine.
    const oB = await mkOrder("B", { customerId: custTwo, salesId: salesTwo.id, status: "Completed", value: "50.00" });
    await db.insert(orderOperations).values({
      orderId: oB.id, machineId: m60, stepOrder: 1, operationName: "Cut", estimatedMinutes: 45, actualMinutes: 60, status: "Completed",
    });

    // C — cancelled: must never appear.
    await mkOrder("C", { customerId: custOne, salesId: salesOne.id, status: "Cancelled", value: "999.00" });

    // D — old, delivered, huge value (numeric round trip), Sales one.
    await mkOrder("D", { customerId: custOne, salesId: salesOne.id, status: "Delivered", value: "12345678.90", createdAt: new Date("2025-01-01T00:00:00Z") });

    // E — running right now: step started 2 h ago, plan 30 min.
    const oE = await mkOrder("E", { customerId: custTwo, salesId: salesTwo.id, status: "In Production", value: "1000.00" });
    await db.insert(orderOperations).values({
      orderId: oE.id, machineId: m60, stepOrder: 1, operationName: "Route", estimatedMinutes: 30, actualMinutes: 0,
      status: "In Progress", startTime: hoursAgo(2),
    });

    writeJobCostSettings({ laborRateCentsPerHour: 3000, overheadBps: 1000 });

    const mine = <T extends { orderNumber: string }>(rows: T[]) => rows.filter((r) => r.orderNumber.endsWith(`-${run}`));
    const pick = <T extends { orderNumber: string }>(rows: T[], tag: string) => rows.find((r) => r.orderNumber === `DBT-${tag}-${run}`);

    // ---- checks ------------------------------------------------------------
    await check("Manager board prices an open order exactly (materials + machine + labor + overhead, released excluded)", async () => {
      const board = await jobCostingBoard(mgr, "all", "all");
      const a = pick(board.orders, "A");
      assert(a, "order A on the board");
      assertEq(a.basis, "Projected", "open order is projected");
      assertEq(a.materialsCents, 70_000, "materials = 10×$50 consumed + 2×$100 reserved; released $495 excluded");
      assertEq(a.materialsConsumedCents, 50_000, "consumed split");
      assertEq(a.materialsReservedCents, 20_000, "reserved split");
      assertEq(a.machineCents, 24_000, "machine time: 120m@$60 + 30m@$120 + 60m@$60 (plan)");
      assertEq(a.laborCents, 10_500, "labor @ $30/h over 210 planned minutes");
      assertEq(a.overheadCents, 10_450, "overhead 10% of direct");
      assertEq(a.costCents, 114_950, "total cost");
      assertEq(a.actualCostCents, 105_050, "cost to date excludes the unstarted step");
      assertEq(a.profitCents, 885_050, "profit");
      assertEq(a.marginBps, 8851, "margin bps");
    });

    await check("cancelled orders never appear; numeric(12+) values survive the round trip", async () => {
      const board = await jobCostingBoard(mgr, "all", "all");
      assert(!pick(board.orders, "C"), "cancelled order excluded");
      const d = pick(board.orders, "D");
      assert(d, "delivered order present");
      assertEq(d.revenueCents, 1_234_567_890, "$12,345,678.90 in cents");
      assertEq(d.basis, "Final", "Delivered is final");
      assert(d.flags.includes("no-materials"), "no materials flag");
    });

    await check("a finished loss-maker is judged on actual time and flagged; board lists worst profit first", async () => {
      const board = await jobCostingBoard(mgr, "all", "all");
      const b = pick(board.orders, "B");
      assert(b, "order B");
      assertEq(b.basis, "Final", "completed is final");
      assertEq(b.machineCents, 6_000, "60m @ $60");
      assertEq(b.laborCents, 3_000, "60m @ $30");
      assertEq(b.overheadCents, 900, "10%");
      assertEq(b.profitCents, 5_000 - 9_900, "$50 order costing $99");
      assert(b.flags.includes("loss"), "loss flag");
      const ours = mine(board.orders);
      assertEq(ours[0].orderNumber, `DBT-B-${run}`, "biggest loss sorts first");
    });

    await check("a step running right now costs its elapsed time once past plan", async () => {
      const board = await jobCostingBoard(mgr, "all", "all");
      const e = pick(board.orders, "E");
      assert(e, "order E");
      assert(e.actualMinutes >= 119 && e.actualMinutes <= 122, `≈120 elapsed minutes, got ${e.actualMinutes}`);
      assertEq(e.machineCents, Math.round((e.projectedMinutes * 6000) / 60), "machine = projected minutes × rate");
    });

    await check("drill-down agrees with the board to the cent and lists every line", async () => {
      const board = await jobCostingBoard(mgr, "all", "all");
      const detail = await jobCostDetail(mgr, oA.id);
      const a = pick(board.orders, "A")!;
      assertEq(detail.costCents, a.costCents, "detail cost = board cost");
      assertEq(detail.profitCents, a.profitCents, "detail profit = board profit");
      assertEq(detail.materialLines.length, 2, "released line not listed");
      assertEq(detail.operationLines.length, 3, "three routed steps");
      assertEq(detail.materialLines.reduce((s, l) => s + l.totalCents, 0), detail.materialsCents, "material lines add up");
      assertEq(detail.operationLines.reduce((s, l) => s + l.machineProjectedCents, 0), detail.machineCents, "machine lines add up");
      assertEq(detail.operationLines[1].basis, "recorded", "start→end span used for the untimed finished step");
      assertEq(detail.operationLines[1].actualMinutes, 30, "30 minute span");
    });

    await check("scrap/rework is reported as a memo and not charged twice", async () => {
      const detail = await jobCostDetail(mgr, oA.id);
      assertEq(detail.scrapCents, 8_000, "2 × $40 scrap");
      assertEq(detail.costCents, 114_950, "cost unchanged by the quality memo");
    });

    await check("Sales sees only their own orders' margins; another user's order is 404", async () => {
      const one = mine((await jobCostingBoard(salesOne, "all", "all")).orders).map((o) => o.orderNumber).sort();
      assertEq(JSON.stringify(one), JSON.stringify([`DBT-A-${run}`, `DBT-D-${run}`]), "Sales one: A and D only");
      const two = mine((await jobCostingBoard(salesTwo, "all", "all")).orders).map((o) => o.orderNumber).sort();
      assertEq(JSON.stringify(two), JSON.stringify([`DBT-B-${run}`, `DBT-E-${run}`]), "Sales two: B and E only");
      let status = 0;
      try { await jobCostDetail(salesOne, oB.id); } catch (e) { status = e instanceof JobCostingError ? e.status : -1; }
      assertEq(status, 404, "foreign order detail is not found");
      const own = await jobCostDetail(salesOne, oA.id);
      assertEq(own.costCents, 114_950, "own order detail works");
    });

    await check("period and scope filters narrow the board", async () => {
      const ytd = mine((await jobCostingBoard(mgr, "ytd", "all")).orders).map((o) => o.orderNumber);
      assert(!ytd.includes(`DBT-D-${run}`) && ytd.includes(`DBT-A-${run}`), "2025 order falls outside this year");
      const month = mine((await jobCostingBoard(mgr, "month", "all")).orders).map((o) => o.orderNumber);
      assert(month.includes(`DBT-A-${run}`) && !month.includes(`DBT-D-${run}`), "month window");
      const fin = mine((await jobCostingBoard(mgr, "all", "final")).orders).map((o) => o.orderNumber).sort();
      assertEq(JSON.stringify(fin), JSON.stringify([`DBT-B-${run}`, `DBT-D-${run}`]), "finished = Completed + Delivered");
      const open = mine((await jobCostingBoard(mgr, "all", "open")).orders).map((o) => o.orderNumber).sort();
      assertEq(JSON.stringify(open), JSON.stringify([`DBT-A-${run}`, `DBT-E-${run}`]), "open = in progress");
    });

    await check("client and project-type roll-ups add up to the board totals", async () => {
      const board = await jobCostingBoard(salesOne, "all", "all");
      const sum = (rows: Array<{ profitCents: number; revenueCents: number; orders: number }>, k: "profitCents" | "revenueCents" | "orders") =>
        rows.reduce((s, r) => s + r[k], 0);
      assertEq(sum(board.byClient, "profitCents"), board.totals.profitCents, "client profit sums to total");
      assertEq(sum(board.byProjectType, "revenueCents"), board.totals.revenueCents, "type revenue sums to total");
      assertEq(sum(board.byClient, "orders"), board.totals.orders, "orders counted once");
      assertEq(board.totals.costCents, board.totals.materialsCents + board.totals.machineCents + board.totals.laborCents + board.totals.overheadCents, "cost breakdown adds up");
    });

    await check("changing the Manager's labor rate / overhead re-prices every order; settings file survives re-read and corruption", async () => {
      writeJobCostSettings({ laborRateCentsPerHour: 0, overheadBps: 0 });
      const zero = pick((await jobCostingBoard(mgr, "all", "all")).orders, "A")!;
      assertEq(zero.costCents, 94_000, "materials + machine only");
      writeJobCostSettings({ laborRateCentsPerHour: 3000, overheadBps: 1000 });
      assertEq(readJobCostSettings().laborRateCentsPerHour, 3000, "re-read after write");
      fs.writeFileSync(`${dataDir}/job-costing.json`, "{ not json");
      const later = new Date(Date.now() + 5_000); // defeat the mtime cache on coarse-timestamp filesystems
      fs.utimesSync(`${dataDir}/job-costing.json`, later, later);
      assertEq(readJobCostSettings().laborRateCentsPerHour, 0, "corrupt file falls back to defaults");
      writeJobCostSettings({ laborRateCentsPerHour: 3000, overheadBps: 1000 });
      assertEq(pick((await jobCostingBoard(mgr, "all", "all")).orders, "A")!.costCents, 114_950, "restored");
    });

    await check("the Order Profitability report rows agree with the Job Costing screen", async () => {
      const rows = mine(await jobCostRowsForReport(mgr, new Date("2024-01-01"), new Date(Date.now() + 86_400_000)));
      const board = mine((await jobCostingBoard(mgr, "all", "all")).orders);
      assertEq(rows.length, board.length, "same orders");
      for (const r of rows) {
        const b = board.find((x) => x.orderNumber === r.orderNumber)!;
        assertEq(r.costCents, b.costCents, `${r.orderNumber} cost`);
        assertEq(r.profitCents, b.profitCents, `${r.orderNumber} profit`);
      }
      const scoped = mine(await jobCostRowsForReport(salesTwo, new Date("2024-01-01"), new Date(Date.now() + 86_400_000)));
      assertEq(scoped.length, 2, "report is scoped to the Sales user's own orders");
      const window = mine(await jobCostRowsForReport(mgr, new Date("2026-01-01"), new Date(Date.now() + 86_400_000)));
      assert(!window.some((r) => r.orderNumber === `DBT-D-${run}`), "report date window applies to creation date");
    });

    await check("a Machine Operator with no routed work sees no orders at all (deny-by-default scope)", async () => {
      const operator = await mkUser("oper", "Machine Operator");
      const board = await jobCostingBoard(operator, "all", "all");
      assertEq(mine(board.orders).length, 0, "operator with no routed work sees nothing");
    });
  } finally {
    try {
      if (orderIds.length > 0) await db.delete(orders).where(inArray(orders.id, orderIds)); // cascades ops/materials/quality
      if (itemIds.length > 0) await db.delete(inventoryItems).where(inArray(inventoryItems.id, itemIds));
      if (machineIds.length > 0) await db.delete(machines).where(inArray(machines.id, machineIds));
      if (customerIds.length > 0) await db.delete(customers).where(inArray(customers.id, customerIds));
      if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    } catch (error) {
      console.log(`note: cleanup incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(failed === 0 ? "ALL PASS" : `${failed} CHECK(S) FAILED`);
  console.log(`PASS ${passed} FAIL ${failed}`);
}

main()
  .catch((error) => {
    failed++;
    console.log("FAIL: job-costing-db: suite crashed");
    console.log(`      ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`PASS ${passed} FAIL ${failed}`);
  })
  .finally(() => pool.end())
  .then(() => process.exit(failed > 0 ? 1 : 0));
