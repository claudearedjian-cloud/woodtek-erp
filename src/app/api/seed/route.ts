import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  users,
  customers,
  machines,
  operationTemplates,
  orders,
  orderOperations,
  inventoryItems,
  orderMaterials,
  reports,
  assets,
  maintenanceLogs,
  cmmsSettings,
  qualityEvents,
  downtimeEvents
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { authorize, hashPin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "true";

    // Bootstrap exception: an empty database has no accounts, so nobody could
    // ever sign in to create the first one. Seeding is therefore allowed only
    // while the users table is empty — after that it requires admin:seed.
    const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
    const isBootstrap = !anyUser;

    if (!isBootstrap) {
      const { error: authError } = await authorize("admin:seed");
      if (authError) return authError;
    }

    if (!force) {
      const existingOrders = await db.select().from(orders).limit(1);
      if (existingOrders.length > 0) {
        return NextResponse.json({ message: "Database already seeded with production orders." });
      }
    }

    // Wipe tables in reverse dependency order for clean re-seeding
    await db.delete(maintenanceLogs);
    await db.delete(assets);
    await db.delete(cmmsSettings);
    await db.delete(qualityEvents);
    await db.delete(downtimeEvents);
    await db.delete(reports);
    await db.delete(orderMaterials);
    await db.delete(orderOperations);
    await db.delete(orders);
    await db.delete(operationTemplates);
    await db.delete(machines);
    await db.delete(customers);
    await db.delete(inventoryItems);
    await db.delete(users);

    // 1. Insert Users / Operators
    const [marcus, elena, diego, chloe, stefan, alexei] = await db.insert(users).values([
      { name: "Marcus Vance", email: "m.vance@woodtek.com", role: "Manager", avatarColor: "bg-blue-600", pin: await hashPin("1001"), active: true },
      { name: "Elena Rostova", email: "e.rostova@woodtek.com", role: "Machine Operator", avatarColor: "bg-amber-600", pin: await hashPin("2002"), active: true },
      { name: "Diego Morales", email: "d.morales@woodtek.com", role: "Machine Operator", avatarColor: "bg-emerald-600", pin: await hashPin("3003"), active: true },
      { name: "Chloe Shen", email: "c.shen@woodtek.com", role: "Sales Coordinator", avatarColor: "bg-purple-600", pin: await hashPin("4004"), active: true },
      { name: "Stefan Lindqvist", email: "s.lindqvist@woodtek.com", role: "QA & Dispatch", avatarColor: "bg-rose-600", pin: await hashPin("5005"), active: true },
      { name: "Alexei Petrov", email: "a.petrov@woodtek.com", role: "Technician", avatarColor: "bg-teal-600", pin: await hashPin("6006"), active: true, phone: "+46 70 555 8901", notes: "CNC maintenance specialist. Available for emergency repairs." },
    ]).returning();

    // 2. Insert Customers
    const [nordic, astra, urban, apex] = await db.insert(customers).values([
      {
        name: "Lars Kjellgren",
        company: "Nordic Form Architectural Studio",
        email: "lars@nordicform.se",
        phone: "+46 8 555 1204",
        address: "Hamngatan 14, Stockholm",
        creditLimit: "50000.00",
        currentBalance: "18450.00",
        notes: "High demand for FSC certified solid oak and laser edge-banded melamine."
      },
      {
        name: "Valeria Gomez",
        company: "Astra Architects & Hospitality",
        email: "valeria@astra-arch.com",
        phone: "+1 212 555 0192",
        address: "740 Broadway, 4th Floor, New York",
        creditLimit: "100000.00",
        currentBalance: "34200.00",
        notes: "Hotel renovation projects require precise dimensional tolerances (+-0.2mm)."
      },
      {
        name: "David Chen",
        company: "Urban Loft Interior Fitouts",
        email: "david@urbanloft.co",
        phone: "+1 415 555 0843",
        address: "128 2nd Street, San Francisco",
        creditLimit: "35000.00",
        currentBalance: "6200.00",
        notes: "Fast turnaround closet and kitchen cabinet panel cutting orders."
      },
      {
        name: "Sarah Jenkins",
        company: "Apex Retail Fixtures LLC",
        email: "s.jenkins@apexretail.com",
        phone: "+1 312 555 9218",
        address: "880 N Michigan Ave, Chicago",
        creditLimit: "75000.00",
        currentBalance: "14800.00",
        notes: "Custom shop-fitting displays with multi-angle CNC milling."
      }
    ]).returning();

    // 3. Insert Machines
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const [cnc1, cnc2, edge1, edge2, saw1, drill1, finish1, asm1, baz1, orma1] = await db.insert(machines).values([
      { name: "Rover A CNC", code: "ROVER-A", category: "CNC Router", status: "In-Use", hourlyCost: "85.00", location: "Bay A - Milling Cell", assignedOperatorId: diego.id, maintenanceDue: nextWeek, notes: "Spindle 1 RPM calibration confirmed. High precision vacuum table." },
      { name: "Rover G CNC", code: "ROVER-G", category: "CNC Router", status: "Active", hourlyCost: "95.00", location: "Bay A - Milling Cell", assignedOperatorId: elena.id, maintenanceDue: nextWeek, notes: "Automated offload push table operational." },
      { name: "Brandt Ambition 1600 Edge Bander", code: "EDGE-01", category: "Edge Bander", status: "In-Use", hourlyCost: "65.00", location: "Bay B - Edge Processing", assignedOperatorId: elena.id, maintenanceDue: nextWeek, notes: "PUR glue cartridge inserted. Set for 1mm to 2mm tapes." },
      { name: "Biesse Akron 1400 Laser Bander", code: "EDGE-02", category: "Edge Bander", status: "Active", hourlyCost: "75.00", location: "Bay B - Edge Processing", assignedOperatorId: diego.id, maintenanceDue: nextWeek, notes: "Zero-glue line laser reactivation system for seamless edge finish." },
      { name: "Beam Saw", code: "BEAM-01", category: "Beam Saw", status: "In-Use", hourlyCost: "55.00", location: "Bay C - Raw Sheet Prep", assignedOperatorId: diego.id, notes: "Motorized rip fence & tilting angle display active." },
      { name: "Vitap Point K2 Acoustic CNC Drill", code: "DRL-01", category: "Drill Press", status: "Maintenance", hourlyCost: "60.00", location: "Bay D - Drilling & Doweling", maintenanceDue: tomorrow, notes: "Scheduled dust vacuum filter change and pneumatic clamp lubrications." },
      { name: "Cefla UV Automated Spray & Finish Line", code: "FIN-01", category: "Spray & Finish", status: "Active", hourlyCost: "115.00", location: "Clean Room Bay E", notes: "UV drying lamps tested at 99% efficacy. Inline exhaust active." },
      { name: "Assembly & Pneumatic Press Station Alpha", code: "ASM-01", category: "Assembly Table", status: "Active", hourlyCost: "45.00", location: "Bay F - Assembly & QC", assignedOperatorId: stefan.id, notes: "Heavy-duty carcass pressing clamp table with soft pads." },
      { name: "Baz CNC", code: "BAZ", category: "CNC Router", status: "Active", hourlyCost: "90.00", location: "Bay A - Milling Cell", notes: "Heavy-duty 5-axis CNC for thick panels and press material." },
      { name: "Orma Press 36mm", code: "ORMA-01", category: "Press", status: "Active", hourlyCost: "70.00", location: "Bay G - Press Area", notes: "36mm panel laminating & pressing line. Oversize trim required after press." },
    ]).returning();

    // 4. Operation Routing Templates (the shop's real recipes)
    await db.insert(operationTemplates).values([
      {
        name: "Cutting Only",
        description: "Beam saw cutting only — panels cut to size and dispatched.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 }
        ]
      },
      {
        name: "Cutting + Edging",
        description: "Beam saw cutting, then edge banding on all exposed edges.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 },
          { stepOrder: 2, operationName: "Edge Banding", machineCategory: "Edge Bander", estimatedMinutes: 120 }
        ]
      },
      {
        name: "Cutting + Edging + CNC (after edging)",
        description: "Cut, edge band, then CNC routing / drilling on the edged panel.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 },
          { stepOrder: 2, operationName: "Edge Banding", machineCategory: "Edge Bander", estimatedMinutes: 120 },
          { stepOrder: 3, operationName: "CNC Routing", machineCategory: "CNC Router", estimatedMinutes: 150 }
        ]
      },
      {
        name: "Cutting + CNC + Edging (before edging)",
        description: "Cut, CNC route / drill first, then edge band last.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 },
          { stepOrder: 2, operationName: "CNC Routing", machineCategory: "CNC Router", estimatedMinutes: 150 },
          { stepOrder: 3, operationName: "Edge Banding", machineCategory: "Edge Bander", estimatedMinutes: 120 }
        ]
      },
      {
        name: "Cutting + Edging + 36mm Pressing",
        description: "Cut and edge panels, press to 36mm on the Orma press, then re-cut and re-edge the pressed material.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 },
          { stepOrder: 2, operationName: "Edge Banding", machineCategory: "Edge Bander", estimatedMinutes: 120 },
          { stepOrder: 3, operationName: "Orma 36mm Pressing", machineCategory: "Press", estimatedMinutes: 240 },
          { stepOrder: 4, operationName: "Re-Cut Pressed Panel (Beam Saw)", machineCategory: "Beam Saw", estimatedMinutes: 60 },
          { stepOrder: 5, operationName: "Edge Pressed Panel", machineCategory: "Edge Bander", estimatedMinutes: 90 }
        ]
      },
      {
        name: "Cutting + 36mm Pressing (no pre-edge)",
        description: "Cut raw panels, press directly to 36mm, then re-cut and edge the pressed material.",
        defaultStepsJson: [
          { stepOrder: 1, operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: 90 },
          { stepOrder: 2, operationName: "Orma 36mm Pressing", machineCategory: "Press", estimatedMinutes: 240 },
          { stepOrder: 3, operationName: "Re-Cut Pressed Panel (Beam Saw)", machineCategory: "Beam Saw", estimatedMinutes: 60 },
          { stepOrder: 4, operationName: "Edge Pressed Panel", machineCategory: "Edge Bander", estimatedMinutes: 90 }
        ]
      }
    ]);

    // 5. Inventory Items
    const [oakMdf, melBoard, edgeTrim, hinge, varnish, dowels] = await db.insert(inventoryItems).values([
      { sku: "BRD-OAK-18", name: "White Oak Crown Cut Veneer MDF 18mm", category: "Wood & MDF Panels", stockQuantity: 142, unit: "sheets", unitCost: "115.00", reorderLevel: 25, location: "Aisle 1 - Rack A" },
      { sku: "BRD-MEL-BLK", name: "Charcoal Matte Supermatt Melamine 18mm", category: "Wood & MDF Panels", stockQuantity: 88, unit: "sheets", unitCost: "68.50", reorderLevel: 30, location: "Aisle 1 - Rack B" },
      { sku: "EDG-OAK-22", name: "ABS Oak Textured Edge Band 22x1.2mm (Roll)", category: "Edge Banding", stockQuantity: 2450, unit: "meters", unitCost: "0.85", reorderLevel: 500, location: "Spool Shelf 4" },
      { sku: "HNG-BLUM-110", name: "Blum Clip-Top Soft Close Hinge + Mounting Plate", category: "Hardware & Fittings", stockQuantity: 1200, unit: "pcs", unitCost: "5.40", reorderLevel: 200, location: "Hardware Bin 12" },
      { sku: "FIN-UV-MATTE", name: "Polyurethane UV Anti-Scratch Matte Clear Coat", category: "Coatings & Adhesives", stockQuantity: 48, unit: "liters", unitCost: "42.00", reorderLevel: 10, location: "Chemical Safe Locker 2" },
      { sku: "DWL-BCH-8X30", name: "Fluted Beech Wooden Dowel Pins 8x30mm", category: "Hardware & Fittings", stockQuantity: 15000, unit: "pcs", unitCost: "0.04", reorderLevel: 3000, location: "Hardware Bin 05" },
    ]).returning();

    // 6. Production Orders
    const dueDay1 = new Date(); dueDay1.setDate(dueDay1.getDate() + 3);
    const dueDay2 = new Date(); dueDay2.setDate(dueDay2.getDate() + 5);
    const dueDay3 = new Date(); dueDay3.setDate(dueDay3.getDate() + 8);
    const dueDay4 = new Date(); dueDay4.setDate(dueDay4.getDate() + 2);

    const [ord1, ord2, ord3, ord4] = await db.insert(orders).values([
      {
        orderNumber: "ORD-2026-0419",
        customerId: astra.id,
        title: "28 Luxury Hotel Bathroom Oak Vanity Units",
        projectType: "Custom Hospitality Furniture",
        priority: "Urgent",
        status: "In Production",
        totalValue: "18450.00",
        dueDate: dueDay1,
        progressPercent: 60,
        notes: "Must match custom warm oak tone from client sample. Water-resistant sealant required."
      },
      {
        orderNumber: "ORD-2026-0420",
        customerId: nordic.id,
        title: "Executive Penthouse Modular Kitchen Cabinetry",
        projectType: "Custom Kitchens",
        priority: "High",
        status: "In Production",
        totalValue: "24800.00",
        dueDate: dueDay2,
        progressPercent: 40,
        notes: "Handleless J-pull routing on cabinet drawers and soft-close hinges throughout."
      },
      {
        orderNumber: "ORD-2026-0421",
        customerId: urban.id,
        title: "45 Modular Sliding Wardrobe Panels & Frames",
        projectType: "Wardrobe Fit-out",
        priority: "Normal",
        status: "Pending",
        totalValue: "9600.00",
        dueDate: dueDay3,
        progressPercent: 0,
        notes: "Pre-drilled tracks and floor mounts. Precision squaring is critical for smooth slide."
      },
      {
        orderNumber: "ORD-2026-0422",
        customerId: apex.id,
        title: "Retail Boutique Display Pedestals & Slat Walls",
        projectType: "Commercial Office & Retail",
        priority: "Normal",
        status: "Quality Review",
        totalValue: "11250.00",
        dueDate: dueDay4,
        progressPercent: 90,
        notes: "All milling and finish coating complete. Awaiting final QC inspection and palletizing."
      }
    ]).returning();

    // 7. Order Operations (The core workflow routing for every order!)
    // For Order 1: 2 completed steps, 1 running on Edge Bander, 2 pending
    const now = new Date();
    const past1 = new Date(now.getTime() - 4 * 3600 * 1000);
    const past2 = new Date(now.getTime() - 2 * 3600 * 1000);
    const scheduleToday = new Date(now);
    scheduleToday.setHours(8, 0, 0, 0);
    const scheduleTomorrow = new Date(scheduleToday);
    scheduleTomorrow.setDate(scheduleTomorrow.getDate() + 1);
    const slot = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60 * 1000);

    await db.insert(orderOperations).values([
      // ORD-2026-0419 Operations
      { orderId: ord1.id, machineId: saw1.id, stepOrder: 1, operationName: "Precision Saw Sizing & Squaring", estimatedMinutes: 90, actualMinutes: 85, status: "Completed", operatorId: diego.id, startTime: past1, endTime: past2, qualityNotes: "Clean cuts, diagonal variance under 0.1mm." },
      { orderId: ord1.id, machineId: cnc1.id, stepOrder: 2, operationName: "CNC Plumbing Basin Cutouts & Dowel Drilling", estimatedMinutes: 120, actualMinutes: 125, status: "Completed", operatorId: diego.id, startTime: past2, endTime: now, qualityNotes: "CNC routing precise to DEX CAD profile." },
      { orderId: ord1.id, machineId: edge1.id, stepOrder: 3, operationName: "Waterproof PUR Edge Banding (All edges)", estimatedMinutes: 140, actualMinutes: 60, status: "In Progress", operatorId: elena.id, startTime: now, scheduledStart: scheduleToday, scheduledEnd: slot(scheduleToday, 140), qualityNotes: "Currently halfway through drawer facades." },
      { orderId: ord1.id, machineId: asm1.id, stepOrder: 4, operationName: "Pneumatic Carcass Pressing & Hinge Mounts", estimatedMinutes: 160, status: "Pending", scheduledStart: scheduleTomorrow, scheduledEnd: slot(scheduleTomorrow, 160) },
      { orderId: ord1.id, machineId: asm1.id, stepOrder: 5, operationName: "Final Quality Review & Foam Packaging", estimatedMinutes: 45, status: "Pending" },

      // ORD-2026-0420 Operations (Nordic Penthouse Kitchen)
      { orderId: ord2.id, machineId: saw1.id, stepOrder: 1, operationName: "Melamine & Veneer Sheet Optimization Cut", estimatedMinutes: 120, actualMinutes: 110, status: "Completed", operatorId: diego.id, startTime: past1, endTime: past2, qualityNotes: "No chipping on melamine coat." },
      { orderId: ord2.id, machineId: cnc2.id, stepOrder: 2, operationName: "Nesting & Handleless Groove Milling", estimatedMinutes: 180, actualMinutes: 70, status: "In Progress", operatorId: elena.id, startTime: past2, scheduledStart: slot(scheduleToday, 180), scheduledEnd: slot(scheduleToday, 360) },
      { orderId: ord2.id, machineId: edge2.id, stepOrder: 3, operationName: "Laser Zero-Glue Edge Band Treatment", estimatedMinutes: 110, status: "Ready", scheduledStart: slot(scheduleTomorrow, 180), scheduledEnd: slot(scheduleTomorrow, 290) },
      { orderId: ord2.id, machineId: finish1.id, stepOrder: 4, operationName: "UV Protective Matte Varnish Coating", estimatedMinutes: 150, status: "Pending" },
      { orderId: ord2.id, machineId: asm1.id, stepOrder: 5, operationName: "Assembly & Kitchen Hardware Fit Test", estimatedMinutes: 200, status: "Pending" },

      // ORD-2026-0421 Operations (Urban Loft Wardrobe - all pending/ready)
      { orderId: ord3.id, machineId: saw1.id, stepOrder: 1, operationName: "High-Speed Sizing of Sliding Doors", estimatedMinutes: 100, status: "Ready", scheduledStart: slot(scheduleTomorrow, 360), scheduledEnd: slot(scheduleTomorrow, 460) },
      { orderId: ord3.id, machineId: edge1.id, stepOrder: 2, operationName: "2mm ABS Heavy Duty Edge Treatment", estimatedMinutes: 120, status: "Pending" },
      { orderId: ord3.id, machineId: asm1.id, stepOrder: 3, operationName: "Roller Wheel Track Mounts & Alignment Check", estimatedMinutes: 90, status: "Pending" },

      // ORD-2026-0422 Operations (Apex Retail Display - Quality Review stage)
      { orderId: ord4.id, machineId: saw1.id, stepOrder: 1, operationName: "Panel Saw Slat Sizing", estimatedMinutes: 60, actualMinutes: 55, status: "Completed", operatorId: diego.id },
      { orderId: ord4.id, machineId: cnc1.id, stepOrder: 2, operationName: "Multi-Angle Display Pedestal Miters", estimatedMinutes: 150, actualMinutes: 140, status: "Completed", operatorId: diego.id },
      { orderId: ord4.id, machineId: finish1.id, stepOrder: 3, operationName: "Black Semi-Gloss Spray Polish & Bake", estimatedMinutes: 120, actualMinutes: 115, status: "Completed" },
      { orderId: ord4.id, machineId: asm1.id, stepOrder: 4, operationName: "Final Structural Load Test & Dispatch Prep", estimatedMinutes: 60, status: "Ready", operatorId: stefan.id, scheduledStart: slot(scheduleTomorrow, 540), scheduledEnd: slot(scheduleTomorrow, 600), qualityNotes: "Awaiting inspector sign-off." }
    ]);

    // 8. Order Materials Consumed
    await db.insert(orderMaterials).values([
      { orderId: ord1.id, itemId: oakMdf.id, quantityUsed: 22, costPerUnit: "115.00" },
      { orderId: ord1.id, itemId: edgeTrim.id, quantityUsed: 380, costPerUnit: "0.85" },
      { orderId: ord1.id, itemId: hinge.id, quantityUsed: 56, costPerUnit: "5.40" },
      { orderId: ord2.id, itemId: melBoard.id, quantityUsed: 35, costPerUnit: "68.50" },
      { orderId: ord2.id, itemId: varnish.id, quantityUsed: 12, costPerUnit: "42.00" },
      { orderId: ord3.id, itemId: melBoard.id, quantityUsed: 40, costPerUnit: "68.50" },
      { orderId: ord4.id, itemId: oakMdf.id, quantityUsed: 14, costPerUnit: "115.00" }
    ]);

    // 8b. Scrap & rework sample events (Feature B)
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3600 * 1000);
    await db.insert(qualityEvents).values([
      { orderId: ord1.id, operationId: null, machineId: edge1.id, eventType: "scrap", quantity: 2, unit: "pcs", reason: "Tool wear", disposition: "Scrapped", estimatedCost: "45.00", recordedById: diego.id, notes: "Edge trim burn on two cabinet doors.", createdAt: hoursAgo(5), resolvedAt: hoursAgo(5) },
      { orderId: ord2.id, operationId: null, machineId: cnc1.id, eventType: "rework", quantity: 1, unit: "pcs", reason: "Material defect", disposition: "Open", estimatedCost: "80.00", recordedById: elena.id, notes: "Surface chip on the island top — re-route face.", createdAt: hoursAgo(2), resolvedAt: null },
      { orderId: ord2.id, operationId: null, machineId: saw1.id, eventType: "scrap", quantity: 1, unit: "sheets", reason: "Operator error", disposition: "Scrapped", estimatedCost: "68.50", recordedById: diego.id, notes: "Cut 3mm oversize on a melamine sheet.", createdAt: hoursAgo(7), resolvedAt: hoursAgo(7) },
      { orderId: ord4.id, operationId: null, machineId: finish1.id, eventType: "rework", quantity: 1, unit: "pcs", reason: "Setup issue", disposition: "Reworked & Passed", estimatedCost: "30.00", recordedById: stefan.id, notes: "Slight orange peel — repolished and passed.", createdAt: hoursAgo(26), resolvedAt: hoursAgo(24) },
    ]);

    // 8c. Downtime sample events (Feature B)
    await db.insert(downtimeEvents).values([
      { machineId: drill1.id, reason: "Mechanical Failure", startedAt: hoursAgo(1.5), endedAt: null, durationMinutes: 0, operatorId: elena.id, notes: "Pneumatic clamp won't retract. Maintenance called." },
      { machineId: edge1.id, reason: "Setup & Changeover", startedAt: hoursAgo(4), endedAt: hoursAgo(3.5), durationMinutes: 30, operatorId: diego.id, notes: "PUR glue cartridge swap and temperature ramp." },
      { machineId: cnc1.id, reason: "Material Shortage", startedAt: hoursAgo(9), endedAt: hoursAgo(8), durationMinutes: 60, operatorId: alexei.id, notes: "Oak veneer sheets not yet delivered to the cell." },
    ]);

    // 9. CMMS Plant Asset Registry
    const [gen200, gen220, gen65, cncAsset, edgeAsset, compressor] = await db.insert(assets).values([
      { assetTag: "GEN-200KVA-01", name: "200 kVA Power Generator", brand: "Perkins / Leroy Somer", assetType: "Generators", site: "Power Substation 1", runtimeHours: 410, serviceIntervalHours: 500, lastServiceHours: 0, status: "Operational", criticality: "Critical", serialNumber: "PK-200-8841", series: "2000 Series Industrial", productionYear: 2021, installedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000), notes: "Primary standby set. Diesel, 1500 RPM. Oil filter P/N 2654403.", powerStatus: "Running", loadOutputPercent: 78, fuelReservePercent: 85, oilPressureBar: "4.2", ratingKva: 200, telemetryAt: new Date() },
      { assetTag: "GEN-220KVA-02", name: "220 kVA Prime Generator", brand: "Cummins", assetType: "Generators", site: "Power Substation 1", runtimeHours: 495, serviceIntervalHours: 500, lastServiceHours: 0, status: "Operational", criticality: "Critical", serialNumber: "CM-220-1193", series: "C-Series QSB7", productionYear: 2019, installedAt: new Date(Date.now() - 500 * 24 * 3600 * 1000), notes: "Prime power unit. Approaching 500 hr service — schedule oil & coolant change.", powerStatus: "Standby", loadOutputPercent: 0, fuelReservePercent: 92, oilPressureBar: "3.8", ratingKva: 220, telemetryAt: new Date() },
      { assetTag: "GEN-65KVA-03", name: "65 kVA Emergency Generator", brand: "Caterpillar", assetType: "Generators", site: "Substation 2 / Yard", runtimeHours: 520, serviceIntervalHours: 500, lastServiceHours: 0, status: "Operational", criticality: "High", serialNumber: "CT-65-4021", series: "DE Series Compact", productionYear: 2018, installedAt: new Date(Date.now() - 620 * 24 * 3600 * 1000), notes: "SERVICE OVERDUE. Emergency backup for assembly line lighting.", powerStatus: "Maintenance Required", loadOutputPercent: 0, fuelReservePercent: 40, oilPressureBar: "2.1", ratingKva: 65, telemetryAt: new Date() },
      { assetTag: "CNC-BIESSE-01", name: "5-Axis Heavy Duty CNC Router", brand: "Biesse", assetType: "CNC Routers", site: "Main Plant Bay A", machineId: cnc1.id, runtimeHours: 320, serviceIntervalHours: 750, lastServiceHours: 0, status: "Operational", criticality: "High", serialNumber: "BS-9921-X", series: "Rover A 16", productionYear: 2020, installedAt: new Date(Date.now() - 300 * 24 * 3600 * 1000), notes: "Spindle bearing inspection every 750 hrs. Vacuum pump oil check monthly.", powerStatus: "Running", loadOutputPercent: 64, fuelReservePercent: 100, oilPressureBar: "0.0", ratingKva: 0 },
      { assetTag: "EDG-HOMAG-01", name: "Automatic Industrial Edge bander", brand: "Homag", assetType: "Edge Banders", site: "Assembly Line 3", machineId: edge1.id, runtimeHours: 480, serviceIntervalHours: 600, lastServiceHours: 0, status: "Operational", criticality: "Medium", serialNumber: "HM-5510-2", series: "Ambition 1650", productionYear: 2021, installedAt: new Date(Date.now() - 280 * 24 * 3600 * 1000), notes: "PUR glue pot cleaning cycle required every 600 hrs.", powerStatus: "Running", loadOutputPercent: 55, fuelReservePercent: 100, oilPressureBar: "0.0", ratingKva: 0 },
      { assetTag: "CMP-ATLAS-01", name: "75 kW Rotary Screw Air Compressor", brand: "Generic", assetType: "Compressors", site: "Main Plant Bay A", runtimeHours: 1180, serviceIntervalHours: 2000, lastServiceHours: 800, status: "Operational", criticality: "High", serialNumber: "AT-75-9022", series: "GA 75 VSD+", productionYear: 2017, installedAt: new Date(Date.now() - 800 * 24 * 3600 * 1000), notes: "Supplies pneumatic clamps and dust gates across the whole plant.", powerStatus: "Running", loadOutputPercent: 71, fuelReservePercent: 100, oilPressureBar: "6.5", ratingKva: 90, telemetryAt: new Date() },
    ]).returning();

    // 9b. CMMS configurable master data
    await db.insert(cmmsSettings).values([
      { settingKey: "service_interval_hours", settingValue: 500 },
      { settingKey: "site_locations", settingValue: ["Main Plant Bay A", "Power Substation 1", "Substation 2 / Yard", "Assembly Line 3", "Clean Room Bay E", "Warehouse"] },
      { settingKey: "operation_categories", settingValue: ["Preventative Maintenance", "Oil & Filter Replacement", "Generators Load Test", "Calibration & Alignment", "Emergency Repair"] },
    ]);

    // 10. CMMS Maintenance Event Log
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
    await db.insert(maintenanceLogs).values([
      { assetId: gen200.id, eventType: "Preventive Service", description: "500 hr major service: oil, oil filter, fuel filter and air element replaced. Coolant topped up.", runtimeAtEvent: 0, downtimeMinutes: 180, partsCost: "420.00", laborCost: "260.00", performedById: alexei.id, resetService: true, createdAt: daysAgo(45) },
      { assetId: gen200.id, eventType: "Inspection", description: "Weekly no-load test run 15 min. Battery voltage 13.8V, no leaks detected.", runtimeAtEvent: 380, downtimeMinutes: 15, partsCost: "0.00", laborCost: "40.00", performedById: alexei.id, resetService: false, createdAt: daysAgo(7) },
      { assetId: gen220.id, eventType: "Inspection", description: "Load bank test at 80% capacity. Exhaust temp within spec. Service due within 5 hrs runtime.", runtimeAtEvent: 490, downtimeMinutes: 90, partsCost: "0.00", laborCost: "120.00", performedById: alexei.id, resetService: false, createdAt: daysAgo(3) },
      { assetId: gen65.id, eventType: "Breakdown", description: "Failed to start on auto-transfer. Starter solenoid replaced. Service now OVERDUE by 20 hrs — schedule immediately.", runtimeAtEvent: 515, downtimeMinutes: 240, partsCost: "185.00", laborCost: "300.00", performedById: alexei.id, resetService: false, createdAt: daysAgo(2) },
      { assetId: cncAsset.id, eventType: "Part Replacement", description: "Replaced worn 12mm compression spiral bit and re-calibrated Z-axis zero point.", runtimeAtEvent: 300, downtimeMinutes: 60, partsCost: "95.00", laborCost: "80.00", performedById: alexei.id, resetService: false, createdAt: daysAgo(12) },
      { assetId: edgeAsset.id, eventType: "Preventive Service", description: "Glue pot flushed and Teflon-coated. Pre-milling cutters sharpened.", runtimeAtEvent: 0, downtimeMinutes: 150, partsCost: "140.00", laborCost: "190.00", performedById: alexei.id, resetService: true, createdAt: daysAgo(30) },
      { assetId: compressor.id, eventType: "Preventive Service", description: "2000 hr interval: separator element, oil filter and compressor fluid changed.", runtimeAtEvent: 800, downtimeMinutes: 210, partsCost: "610.00", laborCost: "340.00", performedById: alexei.id, resetService: true, createdAt: daysAgo(90) },
      { assetId: compressor.id, eventType: "Meter Reading", description: "Routine meter capture during monthly plant walk-down. No abnormal noise or vibration.", runtimeAtEvent: 1180, downtimeMinutes: 0, partsCost: "0.00", laborCost: "0.00", performedById: alexei.id, resetService: false, createdAt: daysAgo(5) },
    ]);

    return NextResponse.json({ 
      status: "success", 
      message: "Database successfully seeded with realistic WoodTek ERP data!" 
    });

  } catch (error: any) {
    console.error("Seeding error:", error);
    return NextResponse.json({ status: "error", message: error?.message || "Unknown seed error" }, { status: 500 });
  }
}
