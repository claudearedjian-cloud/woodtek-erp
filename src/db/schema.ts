import { 
  pgTable, 
  serial, 
  text, 
  integer, 
  timestamp, 
  numeric, 
  boolean,
  json,
  date
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Users / Employees for role-based Authentication & Operator tracking
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(), // Manager, Machine Operator, Sales Coordinator, QA & Dispatch, Technician
  avatarColor: text("avatar_color").notNull().default("bg-amber-600"),
  pin: text("pin").notNull().default("1234"),
  active: boolean("active").notNull().default(true),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Saved Reports
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // Production Summary, Machine Utilization, Order Status, Inventory Status, Client Activity
  generatedBy: integer("generated_by").references(() => users.id),
  dateFrom: timestamp("date_from").notNull(),
  dateTo: timestamp("date_to").notNull(),
  filtersJson: json("filters_json"),
  dataJson: json("data_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Customers (Interior designers, contractors, furniture workshops, retail clients)
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  creditLimit: numeric("credit_limit").notNull().default("10000"),
  currentBalance: numeric("current_balance").notNull().default("0"),
  notes: text("notes"),
  // --- Data isolation: which Sales rep owns this customer ---
  // When set, only that Sales user (plus Manager) can see this customer.
  // When null, only Manager can see it (legacy / unassigned).
  assignedSalesId: integer("assigned_sales_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Machines (Shop floor equipment)
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Holz-Her PRO 5000 CNC Router"
  code: text("code").notNull().unique(), // e.g. "CNC-01"
  category: text("category").notNull(), // CNC Router, Edge Bander, Panel Saw, Drill Press, Spray Booth, Assembly
  status: text("status").notNull().default("Active"), // Active, In-Use, Maintenance, Offline
  hourlyCost: numeric("hourly_cost").notNull().default("65.00"),
  location: text("location").notNull().default("Bay A - North Woodshop"),
  maintenanceDue: timestamp("maintenance_due"),
  assignedOperatorId: integer("assigned_operator_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// CMMS: Plant Asset Registry — machines, generators, compressors, HVAC, etc.
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  assetTag: text("asset_tag").notNull().unique(), // e.g. "GEN-200KVA-01"
  name: text("name").notNull(), // e.g. "200 kVA Power Generator"
  brand: text("brand").notNull().default("Generic"), // Perkins / Leroy Somer, Cummins, Caterpillar, Biesse, Homag
  assetType: text("asset_type").notNull().default("Generators"), // Generators, CNC Routers, Edge Banders, Compressors, HVAC, Dust Extraction
  site: text("site").notNull().default("Main Plant Bay A"), // Physical location / site
  // Link back to a production machine when the asset IS a shop-floor machine
  machineId: integer("machine_id").references(() => machines.id),
  runtimeHours: integer("runtime_hours").notNull().default(0), // Current meter reading
  serviceIntervalHours: integer("service_interval_hours").notNull().default(500), // Service every N hours
  lastServiceHours: integer("last_service_hours").notNull().default(0), // Meter value at last service
  status: text("status").notNull().default("Operational"), // Operational, Service Due, Service Overdue, Under Maintenance, Decommissioned
  criticality: text("criticality").notNull().default("Medium"), // Low, Medium, High, Critical
  serialNumber: text("serial_number"),
  installedAt: timestamp("installed_at"),
  notes: text("notes"),
  // --- Identity / spec sheet ---
  series: text("series"), // e.g. "2000 Series Industrial", "Rover A 16"
  productionYear: integer("production_year"),
  imageUrl: text("image_url"), // Data URL or hosted path of the machine photo
  // --- Power / engine telemetry (primarily for generators & powered plant) ---
  powerStatus: text("power_status").notNull().default("Standby"), // Running, Standby, Maintenance Required, Offline
  loadOutputPercent: integer("load_output_percent").notNull().default(0),
  fuelReservePercent: integer("fuel_reserve_percent").notNull().default(100),
  oilPressureBar: numeric("oil_pressure_bar").notNull().default("0.0"),
  ratingKva: integer("rating_kva").notNull().default(0),
  telemetryAt: timestamp("telemetry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// CMMS configurable master data (site locations, operation categories, thresholds)
export const cmmsSettings = pgTable("cmms_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull().unique(), // service_interval_hours | site_locations | operation_categories
  settingValue: json("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// CMMS: Maintenance / inspection event log per asset
export const maintenanceLogs = pgTable("maintenance_logs", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull().default("Inspection"), // Inspection, Preventive Service, Repair, Breakdown, Part Replacement, Meter Reading
  description: text("description").notNull(),
  runtimeAtEvent: integer("runtime_at_event").notNull().default(0),
  downtimeMinutes: integer("downtime_minutes").notNull().default(0),
  partsCost: numeric("parts_cost").notNull().default("0.00"),
  laborCost: numeric("labor_cost").notNull().default("0.00"),
  performedById: integer("performed_by_id").references(() => users.id),
  resetService: boolean("reset_service").notNull().default(false), // Did this event reset the service meter?
  checklistJson: json("checklist_json"), // Technician pre-service inspection results
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Pre-defined operational routing workflows (e.g. Panel Cutting -> Edge Band -> Drilling -> QA)
export const operationTemplates = pgTable("operation_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Complete Kitchen Cabinet Assembly & Finishing"
  description: text("description").notNull(),
  defaultStepsJson: json("default_steps_json").notNull(), // Array of { stepOrder, operationName, defaultMachineCategory, estimatedMinutes }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Production Orders
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(), // e.g. "ORD-2026-0419"
  customerId: integer("customer_id").notNull().references(() => customers.id),
  title: text("title").notNull(), // e.g. "Executive Mahogany Conference Table & Wall Paneling"
  projectType: text("project_type").notNull(), // Custom Kitchens, Commercial Office, Wardrobe Fit-out, Precision Cutting & Banding only
  priority: text("priority").notNull().default("Normal"), // Normal, High, Urgent
  status: text("status").notNull().default("In Production"), // Pending, In Production, Quality Review, Completed, On Hold
  totalValue: numeric("total_value").notNull().default("0.00"),
  dueDate: timestamp("due_date").notNull(),
  progressPercent: integer("progress_percent").notNull().default(0),
  notes: text("notes"),
  // --- Data isolation ---
  // createdById: who created the order (usually the Sales Coordinator).
  // assignedSalesId: who currently owns the customer relationship.
  // When both are set, the Sales user sees the order only if their id
  // matches either column. Manager sees all.
  createdById: integer("created_by_id").references(() => users.id),
  assignedSalesId: integer("assigned_sales_id").references(() => users.id),
  // --- Material accounting ---
  // Computed/cached state of how well-stocked the order's materials are.
  // Updated whenever materials are allocated, released, or consumed.
  // Values: 'unknown' | 'in_stock' | 'partial' | 'out_of_stock' | 'consumed'
  materialsStatus: text("materials_status").notNull().default("unknown"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Order Operations: Individual routed steps assigned to specific machines & operators
export const orderOperations = pgTable("order_operations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  machineId: integer("machine_id").references(() => machines.id), // Assigned machine
  stepOrder: integer("step_order").notNull(), // 1, 2, 3...
  operationName: text("operation_name").notNull(), // e.g. "Automated Panel Cutting"
  estimatedMinutes: integer("estimated_minutes").notNull().default(45),
  actualMinutes: integer("actual_minutes").notNull().default(0),
  status: text("status").notNull().default("Pending"), // Pending, Ready, In Progress, Completed, Rejected/Rework
  operatorId: integer("operator_id").references(() => users.id),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
  qualityNotes: text("quality_notes"),
  rejectReason: text("reject_reason"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Inventory: Raw Materials, Wood Boards, Edge Banding rolls, Hardware & Coatings
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull().unique(), // e.g. "BOARD-MDF-18-OAK"
  name: text("name").notNull(),
  category: text("category").notNull(), // Wood & MDF Panels, Edge Banding, Hardware & Fittings, Coatings & Adhesives
  stockQuantity: integer("stock_quantity").notNull().default(0),
  unit: text("unit").notNull().default("sheets"), // sheets, meters, pcs, liters
  unitCost: numeric("unit_cost").notNull().default("0.00"),
  reorderLevel: integer("reorder_level").notNull().default(10),
  location: text("location").notNull().default("Rack 3-B"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Materials allocated and consumed per order
export const orderMaterials = pgTable("order_materials", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  quantityUsed: integer("quantity_used").notNull().default(1),
  costPerUnit: numeric("cost_per_unit").notNull().default("0.00"),
  // Stock accounting
  consumed: boolean("consumed").notNull().default(false),
  consumedAt: timestamp("consumed_at"),
  released: boolean("released").notNull().default(false),
  releasedAt: timestamp("released_at"),
});

// Audit trail: every consumption event
export const materialConsumptions = pgTable("material_consumptions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  quantity: integer("quantity").notNull(),
  consumedBy: integer("consumed_by").references(() => users.id),
  operationId: integer("operation_id").references(() => orderOperations.id),
  notes: text("notes"),
  consumedAt: timestamp("consumed_at").defaultNow().notNull(),
});

// Relations
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  operations: many(orderOperations),
  materials: many(orderMaterials),
  createdBy: one(users, {
    fields: [orders.createdById],
    references: [users.id],
    relationName: "order_creator",
  }),
  assignedSales: one(users, {
    fields: [orders.assignedSalesId],
    references: [users.id],
    relationName: "order_sales_rep",
  }),
}));

export const orderOperationsRelations = relations(orderOperations, ({ one }) => ({
  order: one(orders, {
    fields: [orderOperations.orderId],
    references: [orders.id],
  }),
  machine: one(machines, {
    fields: [orderOperations.machineId],
    references: [machines.id],
  }),
  operator: one(users, {
    fields: [orderOperations.operatorId],
    references: [users.id],
  }),
}));

export const machinesRelations = relations(machines, ({ one, many }) => ({
  assignedOperator: one(users, {
    fields: [machines.assignedOperatorId],
    references: [users.id],
  }),
  operations: many(orderOperations),
}));

export const orderMaterialsRelations = relations(orderMaterials, ({ one }) => ({
  order: one(orders, {
    fields: [orderMaterials.orderId],
    references: [orders.id],
  }),
  item: one(inventoryItems, {
    fields: [orderMaterials.itemId],
    references: [inventoryItems.id],
  }),
}));

export const materialConsumptionsRelations = relations(materialConsumptions, ({ one }) => ({
  order: one(orders, {
    fields: [materialConsumptions.orderId],
    references: [orders.id],
  }),
  item: one(inventoryItems, {
    fields: [materialConsumptions.itemId],
    references: [inventoryItems.id],
  }),
  consumedByUser: one(users, {
    fields: [materialConsumptions.consumedBy],
    references: [users.id],
    relationName: "consumption_user",
  }),
  operation: one(orderOperations, {
    fields: [materialConsumptions.operationId],
    references: [orderOperations.id],
  }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  orders: many(orders),
  assignedSales: one(users, {
    fields: [customers.assignedSalesId],
    references: [users.id],
    relationName: "customer_sales_rep",
  }),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  machine: one(machines, {
    fields: [assets.machineId],
    references: [machines.id],
  }),
  logs: many(maintenanceLogs),
}));

export const maintenanceLogsRelations = relations(maintenanceLogs, ({ one }) => ({
  asset: one(assets, {
    fields: [maintenanceLogs.assetId],
    references: [assets.id],
  }),
  performedBy: one(users, {
    fields: [maintenanceLogs.performedById],
    references: [users.id],
  }),
}));

// ----------------------------------------------------------------------------
// Workforce: shift definitions, shift assignments (production calendar),
// and time & attendance clock records.
// ----------------------------------------------------------------------------

// Shift definitions (Morning / Afternoon / Night, or custom factory shifts)
export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull().default("06:00"), // "HH:MM" 24h
  endTime: text("end_time").notNull().default("14:00"),     // "HH:MM" 24h
  color: text("color").notNull().default("bg-amber-500"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Who works which shift on which day (production calendar / shift plan)
export const shiftAssignments = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").notNull().references(() => shifts.id),
  workDate: date("work_date", { mode: "string" }).notNull(), // 'YYYY-MM-DD'
  machineId: integer("machine_id").references(() => machines.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Time & attendance: one row per clock-in; clock_out NULL while on shift
export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").references(() => shifts.id),
  clockIn: timestamp("clock_in").notNull().defaultNow(),
  clockOut: timestamp("clock_out"),
  status: text("status").notNull().default("Present"), // Present, Late, Absent (manager-set)
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shiftsRelations = relations(shifts, ({ many }) => ({
  assignments: many(shiftAssignments),
}));

export const shiftAssignmentsRelations = relations(shiftAssignments, ({ one }) => ({
  user: one(users, { fields: [shiftAssignments.userId], references: [users.id] }),
  shift: one(shifts, { fields: [shiftAssignments.shiftId], references: [shifts.id] }),
  machine: one(machines, { fields: [shiftAssignments.machineId], references: [machines.id] }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  user: one(users, { fields: [attendance.userId], references: [users.id] }),
  shift: one(shifts, { fields: [attendance.shiftId], references: [shifts.id] }),
}));

// ----------------------------------------------------------------------------
// Quality: scrap & rework tracking.
// Every defect is logged as an event. The Operator Station creates these
// automatically when an operator rejects a job; QA / Manager can also record
// them directly and resolve open rework items.
// ----------------------------------------------------------------------------
export const qualityEvents = pgTable("quality_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  operationId: integer("operation_id").references(() => orderOperations.id, { onDelete: "set null" }),
  machineId: integer("machine_id").references(() => machines.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), // 'scrap' | 'rework'
  quantity: integer("quantity").notNull().default(1), // pieces scrapped or sent for rework
  unit: text("unit").notNull().default("pcs"),
  reason: text("reason").notNull(), // reject reason (shared with the Operator Station picker)
  // Scrap:  'Scrapped' (closed on creation)
  // Rework: 'Open' -> 'In Rework' -> 'Reworked & Passed' (or 'Scrapped' if rework fails)
  disposition: text("disposition").notNull().default("Open"),
  estimatedCost: numeric("estimated_cost").notNull().default("0.00"),
  recordedById: integer("recorded_by_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// ----------------------------------------------------------------------------
// Downtime logging: one row per stoppage. ended_at is NULL while the stoppage
// is still open (machine is down right now).
// ----------------------------------------------------------------------------
export const downtimeEvents = pgTable("downtime_events", {
  id: serial("id").primaryKey(),
  machineId: integer("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  operationId: integer("operation_id").references(() => orderOperations.id, { onDelete: "set null" }),
  reason: text("reason").notNull(), // Mechanical Failure, Electrical Fault, Material Shortage, Setup & Changeover, Operator Unavailable, Quality Issue, Other
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  operatorId: integer("operator_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const qualityEventsRelations = relations(qualityEvents, ({ one }) => ({
  order: one(orders, {
    fields: [qualityEvents.orderId],
    references: [orders.id],
  }),
  operation: one(orderOperations, {
    fields: [qualityEvents.operationId],
    references: [orderOperations.id],
  }),
  machine: one(machines, {
    fields: [qualityEvents.machineId],
    references: [machines.id],
  }),
  recordedBy: one(users, {
    fields: [qualityEvents.recordedById],
    references: [users.id],
    relationName: "quality_recorder",
  }),
}));

export const downtimeEventsRelations = relations(downtimeEvents, ({ one }) => ({
  machine: one(machines, {
    fields: [downtimeEvents.machineId],
    references: [machines.id],
  }),
  order: one(orders, {
    fields: [downtimeEvents.orderId],
    references: [orders.id],
  }),
  operation: one(orderOperations, {
    fields: [downtimeEvents.operationId],
    references: [orderOperations.id],
  }),
  operator: one(users, {
    fields: [downtimeEvents.operatorId],
    references: [users.id],
    relationName: "downtime_operator",
  }),
}));

// ----------------------------------------------------------------------------
// PIMS bridge: key-value config + an import log (de-duplication key is the
// PIMS invoice number, which must be unique).
// ----------------------------------------------------------------------------
export const pimsSettings = pgTable("pims_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: json("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const pimsImports = pgTable("pims_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerName: text("customer_name"),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  status: text("status").notNull().default("imported"), // imported | skipped
  message: text("message"),
  rawXml: text("raw_xml"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});

export const pimsImportsRelations = relations(pimsImports, ({ one }) => ({
  order: one(orders, {
    fields: [pimsImports.orderId],
    references: [orders.id],
  }),
}));
